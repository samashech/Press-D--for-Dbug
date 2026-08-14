#!/usr/bin/env npx tsx
import 'dotenv/config';
import { Command } from 'commander';
import { prisma } from '@autoqa/db';
import { startWatcher, runTestExecution, startWorker, startDashboardServer } from '@autoqa/orchestrator';
import chalk from 'chalk';
import prompts from 'prompts';

const program = new Command();

program
  .name('autoqa')
  .description('Autonomous feature-testing agent')
  .version('1.0.0');

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
  .description('Watch git repository for new commits, discover features, and enqueue them')
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
  .command('worker')
  .description('Start the BullMQ worker to process queued tests autonomously')
  .action(() => {
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
  .action(() => {
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

program.parse(process.argv);
