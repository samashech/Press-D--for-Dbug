"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWatcher = startWatcher;
const chokidar_1 = __importDefault(require("chokidar"));
const simple_git_1 = __importDefault(require("simple-git"));
const path_1 = __importDefault(require("path"));
const db_1 = require("@autoqa/db");
const llm_agents_1 = require("@autoqa/llm-agents");
const queue_1 = require("./queue");
async function startWatcher(repoPath, localUrl) {
    const git = (0, simple_git_1.default)(repoPath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
        throw new Error('Provided path is not a git repository');
    }
    // Ensure project exists
    let project = await db_1.prisma.project.findFirst({ where: { repoPath } });
    if (!project) {
        project = await db_1.prisma.project.create({
            data: {
                name: path_1.default.basename(repoPath),
                repoPath,
                localUrl,
            }
        });
    }
    const projectId = project.id;
    const gitRoot = await git.revparse(['--show-toplevel']);
    const gitLogsPath = path_1.default.join(gitRoot.trim(), '.git', 'logs', 'HEAD');
    console.log(`Watching for commits at ${gitLogsPath}...`);
    let isProcessing = false;
    chokidar_1.default.watch(gitLogsPath, { persistent: true, ignoreInitial: true }).on('change', async () => {
        if (isProcessing)
            return;
        isProcessing = true;
        try {
            const log = await git.log({ maxCount: 1 });
            const latestCommit = log.latest;
            if (!latestCommit)
                return;
            const existingCommit = await db_1.prisma.commit.findUnique({
                where: { id: latestCommit.hash } // We use hash as ID for simplicity
            });
            if (existingCommit) {
                return; // Already processed
            }
            console.log(`\nNew commit detected: ${latestCommit.hash.substring(0, 7)} - ${latestCommit.message}`);
            const diff = await git.show([latestCommit.hash]);
            console.log('Analyzing diff...');
            const analysis = await (0, llm_agents_1.analyzeDiff)(diff);
            const commitRecord = await db_1.prisma.commit.create({
                data: {
                    id: latestCommit.hash,
                    projectId,
                    hash: latestCommit.hash,
                    diffSummary: analysis.description,
                }
            });
            const featureRecord = await db_1.prisma.feature.create({
                data: {
                    projectId,
                    commitId: commitRecord.id,
                    name: analysis.featureName,
                    description: analysis.description,
                    status: 'discovered',
                }
            });
            console.log(`Feature discovered and saved: "${analysis.featureName}"`);
            console.log(`Adding to BullMQ testQueue for autonomous testing...`);
            await queue_1.testQueue.add('run-test', {
                featureId: featureRecord.id,
                instruction: analysis.description,
                url: localUrl
            });
            console.log(`Job enqueued successfully.\n`);
        }
        catch (err) {
            console.error('Error processing commit:', err);
        }
        finally {
            isProcessing = false;
        }
    });
}
