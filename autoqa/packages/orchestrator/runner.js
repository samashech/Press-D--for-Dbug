"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTestExecution = runTestExecution;
const db_1 = require("@autoqa/db");
const llm_agents_1 = require("@autoqa/llm-agents");
const test_executor_1 = require("@autoqa/test-executor");
const server_1 = require("./server");
const chalk_1 = __importDefault(require("chalk"));
async function runTestExecution(featureId, instruction, url) {
    const testRun = await db_1.prisma.testRun.create({
        data: {
            featureId,
            triggeredBy: 'auto',
            status: 'running',
        },
    });
    const testCase = await db_1.prisma.testCase.create({
        data: {
            testRunId: testRun.id,
            type: 'ui',
            description: instruction,
            status: 'pending',
        },
    });
    await (0, server_1.broadcastUpdate)(testRun.id);
    console.log(chalk_1.default.blue('Generating test plan with test-planner LLM...'));
    const plan = await (0, llm_agents_1.generateTestPlan)(instruction, url);
    console.log(chalk_1.default.gray(`Generated ${plan.steps.length} steps.`));
    console.log(chalk_1.default.blue('Executing test plan...'));
    const start = Date.now();
    const artifacts = await (0, test_executor_1.executeTest)(testRun.id, url, plan.steps);
    const durationMs = Date.now() - start;
    console.log(chalk_1.default.gray(`Execution finished. Screenshot saved to ${artifacts.screenshotPath}`));
    console.log(chalk_1.default.blue('Analyzing results with result-analyzer LLM...'));
    const analysis = await (0, llm_agents_1.analyzeResults)(artifacts);
    await db_1.prisma.testRun.update({
        where: { id: testRun.id },
        data: {
            status: analysis.status === 'pass' ? 'passed' : 'failed',
            finishedAt: new Date()
        }
    });
    await db_1.prisma.testCase.update({
        where: { id: testCase.id },
        data: {
            status: analysis.status,
            durationMs
        }
    });
    console.log('\n================================================================================');
    if (analysis.status === 'pass') {
        console.log(chalk_1.default.green.bold('✅ TEST PASSED'));
        console.log(chalk_1.default.white(`Title: ${analysis.title}`));
        console.log(chalk_1.default.gray(`Explanation: ${analysis.explanation}`));
    }
    else {
        console.log(chalk_1.default.red.bold('❌ TEST FAILED - BUG DETECTED'));
        console.log(chalk_1.default.white.bold(`Title: ${analysis.title}`));
        console.log(chalk_1.default.yellow(`Severity: ${analysis.severity?.toUpperCase() || 'UNKNOWN'}`));
        console.log(`\n${chalk_1.default.cyan('Expected:')} ${analysis.expected}`);
        console.log(`${chalk_1.default.magenta('Actual:')} ${analysis.actual}`);
        if (analysis.likelyCause) {
            console.log(`\n${chalk_1.default.yellow('Likely Cause:')}`);
            console.log(analysis.likelyCause);
        }
        if (analysis.reproSteps && analysis.reproSteps.length > 0) {
            console.log(`\n${chalk_1.default.blue('Reproduction Steps:')}`);
            analysis.reproSteps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
        }
        console.log(`\n${chalk_1.default.gray(`Screenshot artifact: ${artifacts.screenshotPath}`)}`);
        await db_1.prisma.bugReport.create({
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
    await (0, server_1.broadcastUpdate)(testRun.id);
}
