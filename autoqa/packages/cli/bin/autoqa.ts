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

program
  .command('watch')
  .description('Watch git repository for new commits, discover features, and enqueue them')
  .option('--url <url>', 'Local dev server URL (overrides config)')
  .action(async (options) => {
    requireConfig();
    const url = options.url || globalConfig.targetUrl;
    try {
      await startWatcher(process.cwd(), url);
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
          name: 'geminiKey',
          message: 'Enter your Google Gemini API Key:',
          initial: process.env.GEMINI_API_KEY || ''
        },
        {
          type: 'text',
          name: 'ignoredPaths',
          message: 'Comma-separated paths to ignore in watcher:',
          initial: 'node_modules,dist,build,coverage'
        }
      ]);

      if (!response.targetUrl) {
        console.log(chalk.red('Initialization cancelled.'));
        return;
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
        geminiApiKey: response.geminiKey,
        ignoredPaths: response.ignoredPaths.split(',').map((s: string) => s.trim()),
        databaseUrl: `file:${dbPath}`
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

      console.log(chalk.green.bold('\nAutoQA is ready! You can now run `autoqa watch` or `autoqa smoke`.'));
      
    } catch (err: any) {
      console.error(chalk.red('Error during init:'), err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
