import { Queue, Worker, Job } from 'bullmq';
import { runTestExecution } from './runner';

const connection = {
  host: '127.0.0.1',
  port: 6379
};

export const testQueue = new Queue('testQueue', { connection });

export function startWorker() {
  const worker = new Worker('testQueue', async (job: Job) => {
    const { featureId, instruction, url } = job.data;
    console.log(`\n[Queue] Processing job ${job.id} for feature ${featureId}...`);
    try {
      await runTestExecution(featureId, instruction, url);
      console.log(`[Queue] Job ${job.id} completed successfully.`);
    } catch (error) {
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
