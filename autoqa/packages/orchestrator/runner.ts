import { prisma } from '@autoqa/db';
import { executeTestAutonomous, analyzeResults } from '@autoqa/llm-agents';
import { executeTest } from '@autoqa/test-executor';
import { broadcastUpdate } from './server';
import chalk from 'chalk';

export async function runTestExecution(featureId: string, instruction: string, url: string) {
  const testRun = await prisma.testRun.create({
    data: {
      featureId,
      triggeredBy: 'auto',
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

  await broadcastUpdate(testRun.id);

  let analysis;
  let artifacts;
  let durationMs = 0;

  try {
    if (instruction === '__SMOKE_TEST__') {
      console.log(chalk.blue('Skipping LLM - Running deterministic smoke test plan...'));
      const plan = {
        steps: [
          { action: 'navigate', description: 'Navigate to target URL' }
        ]
      };
      
      console.log(chalk.blue('Executing test plan...'));
      const start = Date.now();
      artifacts = await executeTest(testRun.id, url, plan.steps);
      durationMs = Date.now() - start;
      console.log(chalk.gray(`Execution finished. Screenshot saved to ${artifacts?.screenshotPath}`));

      analysis = {
        status: 'pass',
        title: 'Smoke Test Passed',
        explanation: 'Determinstic smoke test completed successfully.'
      };
    } else {
      console.log(chalk.blue('Running autonomous test execution with MCP...'));
      const start = Date.now();
      try {
        artifacts = await executeTestAutonomous(testRun.id, instruction, url);
        durationMs = Date.now() - start;
        console.log(chalk.gray(`Execution finished. Screenshot saved to ${artifacts?.screenshotPath}`));

        console.log(chalk.blue('Analyzing results with result-analyzer LLM...'));
        analysis = await analyzeResults(artifacts);
      } catch (err: any) {
        durationMs = Date.now() - start;
        analysis = {
          status: 'inconclusive',
          title: 'Execution Inconclusive',
          explanation: `Agent loop was aborted: ${err.message}`,
          severity: 'low',
          expected: 'Test should complete execution.',
          actual: err.message,
        };
      }
    }
    
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
        analysis.reproSteps.forEach((step: string, i: number) => console.log(`  ${i + 1}. ${step}`));
      }
      
      console.log(`\n${chalk.gray(`Screenshot artifact: ${artifacts?.screenshotPath}`)}`);

      await prisma.bugReport.create({
        data: {
          testCaseId: testCase.id,
          severity: analysis.severity || 'medium',
          title: analysis.title,
          expected: analysis.expected,
          actual: analysis.actual,
          screenshotPath: artifacts?.screenshotPath || null,
        }
      });
    }
    console.log('================================================================================\n');
  } catch (error: any) {
    console.error(chalk.red(`[Runner] Error executing test:`), error.message);
    
    await prisma.testRun.update({
      where: { id: testRun.id },
      data: { status: 'failed', finishedAt: new Date() }
    });
    
    await prisma.testCase.update({
      where: { id: testCase.id },
      data: { status: 'fail' }
    });
    
    await prisma.bugReport.create({
      data: {
        testCaseId: testCase.id,
        severity: 'high',
        title: 'Execution Error',
        expected: 'Test to complete successfully',
        actual: error.message,
        screenshotPath: artifacts?.screenshotPath || null,
      }
    });
    
    await broadcastUpdate(testRun.id);
    throw error;
  }
  
  await broadcastUpdate(testRun.id);
}
