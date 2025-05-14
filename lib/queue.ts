import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { processTweetSchedule } from '../services/scheduler';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {maxRetriesPerRequest: null});

export const tweetQueue = new Queue<TweetJobData>('tweets', { connection });

// Define job data types
export interface TweetJobData {
  userId: string;
  botId: string;
}

export const initializeQueue = async () => {
  const worker = new Worker('tweets', processTweetSchedule, { connection });
  
  worker.on('completed', job => {
    console.log(`Job ${job.id} completed`);
  });
  
  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err);
  });
  
  return { tweetQueue, worker };
};

// Add job to queue
export async function addJob(
  type: 'tweet',
  data: TweetJobData,
  options: { delay?: number; attempts?: number } = {}
) {
  const { delay = 0, attempts = 1 } = options;

  switch (type) {
    case 'tweet':
      const job = await tweetQueue.add(
        'test-tweeting',
        { userId: data.userId, botId: data.botId },
        {
          delay,
          attempts,
          removeOnComplete: true,
          removeOnFail: false
        }
      );
      return job.id;
    default:
      throw new Error(`Unknown job type: ${type}`);
  }
}