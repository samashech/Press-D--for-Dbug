#!/usr/bin/env npx tsx
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const commander_1 = require("commander");
const db_1 = require("@autoqa/db");
const orchestrator_1 = require("@autoqa/orchestrator");
const chalk_1 = __importDefault(require("chalk"));
const prompts_1 = __importDefault(require("prompts"));
const program = new commander_1.Command();
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
        console.log(chalk_1.default.blue('Setting up project and db records...'));
        let project = await db_1.prisma.project.findFirst();
        if (!project) {
            project = await db_1.prisma.project.create({
                data: {
                    name: 'autoqa-test',
                    repoPath: process.cwd(),
                    localUrl: options.url,
                },
            });
        }
        const feature = await db_1.prisma.feature.create({
            data: {
                projectId: project.id,
                name: 'Manual Test',
                description: instruction,
                status: 'testing',
            },
        });
        await (0, orchestrator_1.runTestExecution)(feature.id, instruction, options.url);
    }
    catch (err) {
        console.error(chalk_1.default.red('Error during test:'), err.message);
        process.exit(1);
    }
});
program
    .command('watch')
    .description('Watch git repository for new commits, discover features, and enqueue them')
    .requiredOption('--url <url>', 'Local dev server URL to associate with project')
    .action(async (options) => {
    try {
        await (0, orchestrator_1.startWatcher)(process.cwd(), options.url);
    }
    catch (err) {
        console.error(chalk_1.default.red('Error starting watcher:'), err.message);
        process.exit(1);
    }
});
program
    .command('worker')
    .description('Start the BullMQ worker to process queued tests autonomously')
    .action(() => {
    try {
        (0, orchestrator_1.startWorker)();
    }
    catch (err) {
        console.error(chalk_1.default.red('Error starting worker:'), err.message);
        process.exit(1);
    }
});
program
    .command('dashboard-server')
    .description('Start the real-time Socket.IO dashboard backend')
    .action(() => {
    try {
        (0, orchestrator_1.startDashboardServer)();
    }
    catch (err) {
        console.error(chalk_1.default.red('Error starting dashboard server:'), err.message);
        process.exit(1);
    }
});
program
    .command('review')
    .description('Review discovered features and trigger tests (Legacy Phase 3 mode)')
    .action(async () => {
    try {
        const project = await db_1.prisma.project.findFirst();
        if (!project) {
            console.log(chalk_1.default.red('No project found. Run watch or test first.'));
            return;
        }
        const discovered = await db_1.prisma.feature.findMany({
            where: { status: 'discovered' },
            orderBy: { firstSeenAt: 'asc' }
        });
        if (discovered.length === 0) {
            console.log(chalk_1.default.green('No pending features to review!'));
            return;
        }
        console.log(chalk_1.default.blue(`Found ${discovered.length} discovered feature(s).`));
        for (const feature of discovered) {
            console.log(`\n---------------------------------`);
            console.log(chalk_1.default.cyan.bold(`Feature: ${feature.name}`));
            console.log(chalk_1.default.white(`Description: ${feature.description}`));
            console.log(`---------------------------------`);
            const response = await (0, prompts_1.default)({
                type: 'confirm',
                name: 'runTest',
                message: 'Would you like to auto-generate and run a test for this feature?',
                initial: true
            });
            if (response.runTest) {
                await db_1.prisma.feature.update({
                    where: { id: feature.id },
                    data: { status: 'testing' }
                });
                await (0, orchestrator_1.runTestExecution)(feature.id, feature.description, project.localUrl);
            }
            else {
                console.log(chalk_1.default.yellow('Skipping test generation for this feature.'));
            }
        }
    }
    catch (err) {
        console.error(chalk_1.default.red('Error during review:'), err.message);
        process.exit(1);
    }
});
program.parse(process.argv);
