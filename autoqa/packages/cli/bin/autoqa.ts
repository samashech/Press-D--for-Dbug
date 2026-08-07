#!/usr/bin/env npx tsx
import 'dotenv/config';
import { Command } from 'commander';
import { prisma } from '@autoqa/db';
import { generateTestPlan, analyzeResults } from '@autoqa/llm-agents';
import { executeTest } from '@autoqa/test-executor';

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
      console.log('1. Setting up project and db records...');
      // Ensure we have a project to associate with
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

      const testRun = await prisma.testRun.create({
        data: {
          featureId: feature.id,
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

      console.log('2. Generating test plan with test-planner LLM...');
      const plan = await generateTestPlan(instruction, options.url);
      console.log(`Generated ${plan.steps.length} steps.`);
      
      console.log('3. Executing test plan...');
      const start = Date.now();
      const artifacts = await executeTest(testRun.id, options.url, plan.steps);
      const durationMs = Date.now() - start;
      console.log(`Execution finished. Screenshot saved to ${artifacts.screenshotPath}`);

      console.log('4. Analyzing results with result-analyzer LLM...');
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

      console.log('\n================================');
      console.log(`Result: ${analysis.status.toUpperCase()}`);
      console.log(`Title: ${analysis.title}`);
      console.log(`Expected: ${analysis.expected}`);
      console.log(`Actual: ${analysis.actual}`);
      console.log(`Explanation: ${analysis.explanation}`);
      console.log('================================\n');

    } catch (err: any) {
      console.error('Error during test:', err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
