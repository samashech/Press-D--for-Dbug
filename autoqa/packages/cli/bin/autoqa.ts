#!/usr/bin/env npx tsx
import 'dotenv/config';
import { globalConfig } from './configLoader';
import { Command } from 'commander';
import { prisma } from '@autoqa/db';
import { startWatcher, runTestExecution, startWorker, startDashboardServer, testQueue } from '@autoqa/orchestrator';
import chalk from 'chalk';
import prompts from 'prompts';

const program = new Command();

async function requireConfig() {
  if (!globalConfig) {
    console.error(chalk.red('Error: autoqa.config.json is missing. Please run `autoqa init` first.'));
    process.exit(1);
  }

  // 1. Check Target URL
  try {
    await fetch(globalConfig.targetUrl);
  } catch (e: any) {
    if (e.cause?.code === 'ECONNREFUSED' || e.code === 'ECONNREFUSED') {
      console.error(chalk.red(`Error: Target URL ${globalConfig.targetUrl} is unreachable. Is your dev server running?`));
      process.exit(1);
    }
  }

  // 2. Check Redis (BullMQ dependency)
  const net = require('net');
  const checkRedis = () => new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
    socket.on('error', (err: any) => { socket.destroy(); reject(err); });
    socket.connect(6379, '127.0.0.1');
  });

  try {
    await checkRedis();
  } catch (e) {
    console.error(chalk.red('Error: Redis is not running on 127.0.0.1:6379. AutoQA requires Redis for its background worker queue.'));
    process.exit(1);
  }

  // 3. Canary checks
  await verifyCanary(globalConfig);
}

async function verifyCanary(config: any) {
  if (!config.llm) return;
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const crypto = require('crypto');

  const dbDir = path.join(os.homedir(), '.autoqa');
  const canaryHashFile = path.join(dbDir, 'canary_hash');
  const currentHash = crypto.createHash('md5').update(JSON.stringify(config.llm)).digest('hex');

  let lastHash = '';
  if (fs.existsSync(canaryHashFile)) {
    lastHash = fs.readFileSync(canaryHashFile, 'utf8');
  }

  if (lastHash !== currentHash) {
    console.log(chalk.blue('Config changed. Running LLM canary checks...'));
    const { getRoleProvider } = require('@autoqa/llm-agents/providers/factory');
    const { runCanaryCheck } = require('@autoqa/llm-agents/providers/canary');

    const roles = ['diffAnalyzer', 'testPlanner', 'resultAnalyzer'];
    for (const role of roles) {
      if (config.llm[role]) {
        console.log(chalk.gray(`Testing ${role} provider...`));
        const provider = getRoleProvider(role as any);
        const result = await runCanaryCheck(provider);
        if (!result.success) {
          console.error(chalk.red(`⚠️ Warning: ${role} provider (${provider.name}) failed compatibility check:`), result.reason);
          console.error(chalk.yellow(`This provider/model may not be reliable for tool-calling or structured JSON.`));
        } else {
          console.log(chalk.green(`✅ ${role} provider (${provider.name}) passed.`));
        }
      }
    }
    fs.writeFileSync(canaryHashFile, currentHash);
  }
}

program
  .name('autoqa')
  .description('Autonomous feature-testing agent')
  .version('1.0.0');

program
  .command('test')
  .description('Run a test against a local URL')
  .argument('<instruction>', 'Test instruction in plain English')
  .option('--url <url>', 'Local dev server URL (overrides config)')
  .action(async (instruction, options) => {
    await requireConfig();
    const url = options.url || globalConfig.targetUrl;
    try {
      console.log(chalk.blue('Setting up project and db records...'));
      let project = await prisma.project.findFirst();
      if (!project) {
        project = await prisma.project.create({
          data: {
            name: 'autoqa-test',
            repoPath: process.cwd(),
            localUrl: url,
          },
        });
      }

      const feature = await prisma.feature.create({
        data: {
          projectId: project.id,
          name: 'Manual Test',
          description: instruction,
          status: 'testing',
        },
      });

      await runTestExecution(feature.id, instruction, url);

    } catch (err: any) {
      console.error(chalk.red('Error during test:'), err.message);
      process.exit(1);
    }
  });

program
  .command('smoke')
  .description('Run a deterministic smoke test skipping the LLM')
  .option('--url <url>', 'Local dev server URL (overrides config)')
  .action(async (options) => {
    requireConfig();
    const url = options.url || globalConfig.targetUrl;
    try {
      console.log(chalk.blue('Setting up smoke test records...'));
      let project = await prisma.project.findFirst();
      if (!project) {
        project = await prisma.project.create({
          data: {
            name: 'autoqa-smoke',
            repoPath: process.cwd(),
            localUrl: url,
          },
        });
      }

      const feature = await prisma.feature.create({
        data: {
          projectId: project.id,
          name: 'Smoke Test Feature',
          description: '__SMOKE_TEST__',
          status: 'testing',
        },
      });

      console.log(chalk.blue('Pushing smoke test to queue...'));
      await testQueue.add('test', {
        featureId: feature.id,
        instruction: '__SMOKE_TEST__',
        url: url
      });
      console.log(chalk.green('Smoke test queued successfully. Make sure the worker is running!'));

    } catch (err: any) {
      console.error(chalk.red('Error during smoke test:'), err.message);
      process.exit(1);
    }
  });

async function getOrCreateProject(repoPath: string, localUrl: string) {
  const path = require('path');
  let project = await prisma.project.findFirst({ where: { repoPath } });
  if (!project) {
    project = await prisma.project.create({
      data: {
        name: path.basename(repoPath),
        repoPath,
        localUrl,
      }
    });
  }
  return project.id;
}

program
  .command('audit')
  .description('Audit the current project by crawling and classifying features, saving them to the DB')
  .argument('[repoPath]', 'Repository path to audit', process.cwd())
  .option('--url <url>', 'Local dev server URL (overrides config)')
  .action(async (repoPath, options) => {
    const path = require('path');
    await requireConfig();
    const url = options.url || globalConfig.targetUrl;
    
    console.log(chalk.blue('Starting Phase A: Discovery Crawler...'));
    const { runCrawl } = require('@autoqa/test-executor');
    const featureMap = await runCrawl(url, path.resolve(repoPath));
    
    console.log(chalk.blue('\nStarting Phase B: Feature Classification...'));
    const { getRoleProvider } = require('@autoqa/llm-agents/providers/factory');
    const { classifyFeatures } = require('@autoqa/llm-agents');
    
    const provider = getRoleProvider('featureClassifier');
    let totalFeatures = 0;
    
    for (const page of featureMap.pages) {
      console.log(chalk.gray(`Classifying features for ${page.url}...`));
      const result = await classifyFeatures(page.url, page.a11y, page.endpoints, featureMap.integrations, provider);
      
      const projectId = await getOrCreateProject(path.resolve(repoPath), url);
      
      for (const feature of result.features) {
        await prisma.feature.create({
          data: {
            projectId,
            name: feature.name,
            description: feature.description,
            status: 'discovered',
            discoveredVia: 'crawl',
            pageUrl: feature.pageUrl || page.url,
            selector: feature.selector,
            featureType: feature.featureType
          }
        });
        totalFeatures++;
        console.log(chalk.green(`  + Discovered [${feature.featureType}]: ${feature.name}`));
      }
    }
    
    console.log(chalk.bold.green(`\nAudit Discovery Complete! Saved ${totalFeatures} features to the database.`));
  });

program
  .command('watch')
  .description('Watch git repository for new commits, discover features, and enqueue them')
  .argument('[repoPath]', 'Repository path to watch', process.cwd())
  .option('--url <url>', 'Local dev server URL (overrides config)')
  .action(async (repoPath, options) => {
    const path = require('path');
    await requireConfig();
    const url = options.url || globalConfig.targetUrl;
    try {
      await startWatcher(path.resolve(repoPath), url);
    } catch (err: any) {
      console.error(chalk.red('Error starting watcher:'), err.message);
      process.exit(1);
    }
  });

program
  .command('worker')
  .description('Start the BullMQ worker to process queued tests autonomously')
  .action(async () => {
    await requireConfig();
    try {
      startWorker();
    } catch (err: any) {
      console.error(chalk.red('Error starting worker:'), err.message);
      process.exit(1);
    }
  });

program
  .command('dashboard-server')
  .description('Start the real-time Socket.IO dashboard backend')
  .action(async () => {
    await requireConfig();
    try {
      startDashboardServer();
    } catch (err: any) {
      console.error(chalk.red('Error starting dashboard server:'), err.message);
      process.exit(1);
    }
  });

program
  .command('review')
  .description('Review discovered features and trigger tests (Legacy Phase 3 mode)')
  .action(async () => {
    try {
      const project = await prisma.project.findFirst();
      if (!project) {
        console.log(chalk.red('No project found. Run watch or test first.'));
        return;
      }

      const discovered = await prisma.feature.findMany({
        where: { status: 'discovered' },
        orderBy: { firstSeenAt: 'asc' }
      });

      if (discovered.length === 0) {
        console.log(chalk.green('No pending features to review!'));
        return;
      }

      console.log(chalk.blue(`Found ${discovered.length} discovered feature(s).`));

      for (const feature of discovered) {
        console.log(`\n---------------------------------`);
        console.log(chalk.cyan.bold(`Feature: ${feature.name}`));
        console.log(chalk.white(`Description: ${feature.description}`));
        console.log(`---------------------------------`);

        const response = await prompts({
          type: 'confirm',
          name: 'runTest',
          message: 'Would you like to auto-generate and run a test for this feature?',
          initial: true
        });

        if (response.runTest) {
          await prisma.feature.update({
            where: { id: feature.id },
            data: { status: 'testing' }
          });
          await runTestExecution(feature.id, feature.description, project.localUrl);
        } else {
          console.log(chalk.yellow('Skipping test generation for this feature.'));
        }
      }

    } catch (err: any) {
      console.error(chalk.red('Error during review:'), err.message);
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Initialize AutoQA configuration in the current project')
  .action(async () => {
    try {
      console.log(chalk.blue('Initializing AutoQA...'));
      const response = await prompts([
        {
          type: 'text',
          name: 'targetUrl',
          message: 'What is the target dev server URL?',
          initial: 'http://localhost:3000'
        },
        {
          type: 'text',
          name: 'ignoredPaths',
          message: 'Comma-separated paths to ignore in watcher:',
          initial: 'node_modules,dist,build,coverage'
        },
        {
          type: 'confirm',
          name: 'sameConfig',
          message: 'Use the same LLM provider and model for all roles?',
          initial: true
        }
      ]);

      if (!response.targetUrl) {
        console.log(chalk.red('Initialization cancelled.'));
        return;
      }

      async function askProviderConfig(role: string) {
        const pResponse = await prompts([
          {
            type: 'select',
            name: 'provider',
            message: `Which provider for ${role}?`,
            choices: [
              { title: 'Gemini', value: 'gemini' },
              { title: 'Claude', value: 'claude' },
              { title: 'OpenAI', value: 'openai' },
              { title: 'Local (Ollama/LM Studio)', value: 'local' }
            ]
          },
          {
            type: 'text',
            name: 'model',
            message: `Which model for ${role}?`,
            initial: (prev) => {
              if (prev === 'gemini') return 'gemini-2.5-flash';
              if (prev === 'claude') return 'claude-3-5-sonnet-20241022';
              if (prev === 'openai') return 'gpt-4o';
              if (prev === 'local') return 'llama3.1';
              return '';
            }
          }
        ]);
        
        let apiKey: string | undefined;
        let baseUrl: string | undefined;

        if (pResponse.provider === 'local') {
          const localResp = await prompts({
            type: 'text',
            name: 'baseUrl',
            message: `Base URL for local provider (${role}):`,
            initial: 'http://localhost:11434/v1'
          });
          baseUrl = localResp.baseUrl;
        } else {
          const defaultEnv = {
            'gemini': 'GEMINI_API_KEY',
            'claude': 'ANTHROPIC_API_KEY',
            'openai': 'OPENAI_API_KEY'
          }[pResponse.provider as string] || '';
          
          const keyResp = await prompts({
            type: 'text',
            name: 'apiKeyEnv',
            message: `Environment variable for ${pResponse.provider} API key (${role}):`,
            initial: defaultEnv
          });
          if (keyResp.apiKeyEnv) {
            apiKey = `env:${keyResp.apiKeyEnv}`;
          }
        }

        return { provider: pResponse.provider, model: pResponse.model, apiKey, baseUrl };
      }

      const llmConfig: any = {};
      if (response.sameConfig) {
        const sharedConfig = await askProviderConfig('all roles');
        llmConfig.diffAnalyzer = { ...sharedConfig };
        llmConfig.testPlanner = { ...sharedConfig };
        llmConfig.resultAnalyzer = { ...sharedConfig };
      } else {
        llmConfig.diffAnalyzer = await askProviderConfig('diffAnalyzer');
        llmConfig.testPlanner = await askProviderConfig('testPlanner');
        llmConfig.resultAnalyzer = await askProviderConfig('resultAnalyzer');
      }

      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const { execSync } = require('child_process');

      const dbDir = path.join(os.homedir(), '.autoqa');
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      const dbPath = path.join(dbDir, 'dev.db');
      
      const config = {
        targetUrl: response.targetUrl,
        ignoredPaths: response.ignoredPaths.split(',').map((s: string) => s.trim()),
        databaseUrl: `file:${dbPath}`,
        llm: llmConfig
      };

      fs.writeFileSync(
        path.join(process.cwd(), 'autoqa.config.json'),
        JSON.stringify(config, null, 2)
      );

      console.log(chalk.green('Created autoqa.config.json'));
      
      // Push prisma schema
      console.log(chalk.blue('Initializing database schema...'));
      process.env.DATABASE_URL = config.databaseUrl;
      
      try {
        const dbPackageJson = require.resolve('@autoqa/db/package.json');
        const schemaPath = path.join(path.dirname(dbPackageJson), 'prisma', 'schema.prisma');
        execSync(`npx prisma@5 db push --schema="${schemaPath}"`, { stdio: 'inherit' });
        console.log(chalk.green('Database initialized successfully at ' + dbPath));
      } catch (e: any) {
        console.error(chalk.yellow('Failed to automatically push database schema. You may need to do it manually. ' + e.message));
      }

      await verifyCanary(config);

      console.log(chalk.green.bold('\nAutoQA is ready! You can now run `autoqa watch` or `autoqa smoke`.'));
      
    } catch (err: any) {
      console.error(chalk.red('Error during init:'), err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
