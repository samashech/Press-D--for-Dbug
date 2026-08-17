"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testQueue = void 0;
exports.startWorker = startWorker;
const bullmq_1 = require("bullmq");
const runner_1 = require("./runner");
const connection = {
    host: '127.0.0.1',
    port: 6379
};
exports.testQueue = new bullmq_1.Queue('testQueue', { connection });
function startWorker() {
    const worker = new bullmq_1.Worker('testQueue', async (job) => {
        const { featureId, instruction, url } = job.data;
        console.log(`\n[Queue] Processing job ${job.id} for feature ${featureId}...`);
        try {
            await (0, runner_1.runTestExecution)(featureId, instruction, url);
            console.log(`[Queue] Job ${job.id} completed successfully.`);
        }
        catch (error) {
            console.error(`[Queue] Job ${job.id} failed:`, error);
            throw error;
        }
    }, { connection });
    worker.on('failed', (job, err) => {
        console.log(`${job?.id} has failed with ${err.message}`);
    });
    console.log('BullMQ Worker started, listening to "testQueue"...');
    return worker;
}
