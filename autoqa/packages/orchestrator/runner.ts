import { prisma } from '@autoqa/db';
import { generateTestPlan, analyzeResults } from '@autoqa/llm-agents';
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
  await broadcastUpdate(testRun.id);
}
