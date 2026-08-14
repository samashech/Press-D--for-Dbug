#!/usr/bin/env npx tsx
import 'dotenv/config';
import { Command } from 'commander';
import { prisma } from '@autoqa/db';
import { generateTestPlan, analyzeResults } from '@autoqa/llm-agents';
import { executeTest } from '@autoqa/test-executor';
import { startWatcher } from '@autoqa/orchestrator';
import chalk from 'chalk';
import prompts from 'prompts';

const program = new Command();

program
  .name('autoqa')
  .description('Autonomous feature-testing agent')
  .version('1.0.0');

// helper function for running a test
async function runTestExecution(featureId: string, instruction: string, url: string) {
  const testRun = await prisma.testRun.create({
    data: {
      featureId,
      triggeredBy: 'manual',
      status: 'running',
    },
  });

  const testCase = await prisma.testCase.create({
    data: {
      testRunId: testRun.id,
      type: 'ui',
      description: instruction,
      status: 'pending',
    },
  });

  console.log(chalk.blue('Generating test plan with test-planner LLM...'));
  const plan = await generateTestPlan(instruction, url);
  console.log(chalk.gray(`Generated ${plan.steps.length} steps.`));
  
  console.log(chalk.blue('Executing test plan...'));
  const start = Date.now();
  const artifacts = await executeTest(testRun.id, url, plan.steps);
  const durationMs = Date.now() - start;
  console.log(chalk.gray(`Execution finished. Screenshot saved to ${artifacts.screenshotPath}`));

  console.log(chalk.blue('Analyzing results with result-analyzer LLM...'));
  const analysis = await analyzeResults(artifacts);
  
  await prisma.testRun.update({
    where: { id: testRun.id },
    data: { 
      status: analysis.status === 'pass' ? 'passed' : 'failed',
      finishedAt: new Date()
    }
  });
  
  await prisma.testCase.update({
    where: { id: testCase.id },
    data: {
      status: analysis.status,
      durationMs
    }
  });

  console.log('\n================================================================================');
  
  if (analysis.status === 'pass') {
    console.log(chalk.green.bold('✅ TEST PASSED'));
    console.log(chalk.white(`Title: ${analysis.title}`));
    console.log(chalk.gray(`Explanation: ${analysis.explanation}`));
  } else {
    console.log(chalk.red.bold('❌ TEST FAILED - BUG DETECTED'));
    console.log(chalk.white.bold(`Title: ${analysis.title}`));
    console.log(chalk.yellow(`Severity: ${analysis.severity?.toUpperCase() || 'UNKNOWN'}`));
    console.log(`\n${chalk.cyan('Expected:')} ${analysis.expected}`);
    console.log(`${chalk.magenta('Actual:')} ${analysis.actual}`);
    
    if (analysis.likelyCause) {
      console.log(`\n${chalk.yellow('Likely Cause:')}`);
      console.log(analysis.likelyCause);
    }

    if (analysis.reproSteps && analysis.reproSteps.length > 0) {
      console.log(`\n${chalk.blue('Reproduction Steps:')}`);
      analysis.reproSteps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
    }
    
    console.log(`\n${chalk.gray(`Screenshot artifact: ${artifacts.screenshotPath}`)}`);

    await prisma.bugReport.create({
      data: {
        testCaseId: testCase.id,
        severity: analysis.severity || 'medium',
        title: analysis.title,
        expected: analysis.expected,
        actual: analysis.actual,
        screenshotPath: artifacts.screenshotPath,
      }
    });
  }
  console.log('================================================================================\n');
}

program
  .command('test')
  .description('Run a test against a local URL')
  .argument('<instruction>', 'Test instruction in plain English')
  .requiredOption('--url <url>', 'Local dev server URL')
  .action(async (instruction, options) => {
    try {
      console.log(chalk.blue('Setting up project and db records...'));
      let project = await prisma.project.findFirst();
      if (!project) {
        project = await prisma.project.create({
          data: {
            name: 'autoqa-test',
            repoPath: process.cwd(),
            localUrl: options.url,
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

      await runTestExecution(feature.id, instruction, options.url);

    } catch (err: any) {
      console.error(chalk.red('Error during test:'), err.message);
      process.exit(1);
    }
  });

program
  .command('watch')
  .description('Watch git repository for new commits and discover features')
  .requiredOption('--url <url>', 'Local dev server URL to associate with project')
  .action(async (options) => {
    try {
      await startWatcher(process.cwd(), options.url);
    } catch (err: any) {
      console.error(chalk.red('Error starting watcher:'), err.message);
      process.exit(1);
    }
  });

program
  .command('review')
  .description('Review discovered features and trigger tests')
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

program.parse(process.argv);
