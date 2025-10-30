import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import logger from '../utils/logger';

/**
 * EventQueue
 *
 * High-performance event queue system using BullMQ + Redis.
 * Prevents Discord event processing from blocking the main thread.
 *
 * Benefits:
 * - Async processing: Handle bursts without dropping events
 * - Retry logic: Auto-retry failed jobs with exponential backoff
 * - Rate limiting: Prevent API overload
 * - Priority queue: Process critical events first
 * - Job persistence: Survive crashes
 * - Scalable: Multiple workers can process same queue
 *
 * Queues:
 * - message-analysis: Message content analysis
 * - moderation-actions: Timeout, ban, warn, etc.
 * - analytics: Analytics updates
 * - ai-inference: AI model calls
 * - notifications: Alert sending
 */

export interface QueueConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  concurrency?: number;
  limiter?: {
    max: number;  // Max jobs per duration
    duration: number;  // Duration in ms
  };
}

export class EventQueue {
  private connection: IORedis;
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private queueEvents: Map<string, QueueEvents> = new Map();

  constructor(private config: QueueConfig) {
    this.connection = new IORedis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db || 0,
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    });
  }

  /**
   * Initialize queues
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Event Queue System...');

      // Create queues
      this.createQueue('message-analysis', {
        limiter: { max: 100, duration: 1000 }  // 100/sec
      });

      this.createQueue('moderation-actions', {
        limiter: { max: 50, duration: 1000 }  // 50/sec
      });

      this.createQueue('analytics', {
        limiter: { max: 20, duration: 1000 }  // 20/sec
      });

      this.createQueue('ai-inference', {
        limiter: { max: 10, duration: 1000 }  // 10/sec
      });

      this.createQueue('notifications', {
        limiter: { max: 30, duration: 1000 }  // 30/sec
      });

      logger.info('✓ Event Queue System initialized');
    } catch (error) {
      logger.error('Failed to initialize Event Queue:', error);
      throw error;
    }
  }

  /**
   * Create queue
   */
  private createQueue(name: string, options: any = {}): void {
    const queue = new Queue(name, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000
        },
        removeOnComplete: 100,  // Keep last 100 completed
        removeOnFail: 500       // Keep last 500 failed
      },
      ...options
    });

    this.queues.set(name, queue);

    // Set up queue events
    const events = new QueueEvents(name, {
      connection: this.connection
    });

    events.on('completed', ({ jobId }) => {
      logger.debug(`Job ${jobId} completed in queue ${name}`);
    });

    events.on('failed', ({ jobId, failedReason }) => {
      logger.error(`Job ${jobId} failed in queue ${name}:`, failedReason);
    });

    this.queueEvents.set(name, events);

    logger.debug(`Created queue: ${name}`);
  }

  /**
   * Register worker for queue
   */
  registerWorker(
    queueName: string,
    processor: (job: Job) => Promise<any>,
    concurrency: number = 5
  ): void {
    const worker = new Worker(queueName, processor, {
      connection: this.connection,
      concurrency,
      limiter: this.config.limiter
    });

    worker.on('completed', (job) => {
      logger.debug(`Worker completed job ${job.id} in ${queueName}`);
    });

    worker.on('failed', (job, err) => {
      logger.error(`Worker failed job ${job?.id} in ${queueName}:`, err);
    });

    worker.on('error', (err) => {
      logger.error(`Worker error in ${queueName}:`, err);
    });

    this.workers.set(queueName, worker);

    logger.info(`Registered worker for queue: ${queueName} (concurrency: ${concurrency})`);
  }

  /**
   * Add job to queue
   */
  async addJob(
    queueName: string,
    data: any,
    options: {
      priority?: number;  // 1 (highest) to 10 (lowest)
      delay?: number;     // Delay in ms
      jobId?: string;     // Custom job ID
    } = {}
  ): Promise<Job> {
    const queue = this.queues.get(queueName);

    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const job = await queue.add(queueName, data, options);

    logger.debug(`Added job ${job.id} to queue ${queueName}`);

    return job;
  }

  /**
   * Add bulk jobs
   */
  async addBulk(
    queueName: string,
    jobs: Array<{ data: any; opts?: any }>
  ): Promise<Job[]> {
    const queue = this.queues.get(queueName);

    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const bulkJobs = jobs.map(job => ({
      name: queueName,
      data: job.data,
      opts: job.opts || {}
    }));

    const addedJobs = await queue.addBulk(bulkJobs);

    logger.debug(`Added ${addedJobs.length} jobs to queue ${queueName}`);

    return addedJobs;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: string): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: boolean;
  }> {
    const queue = this.queues.get(queueName);

    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const [waiting, active, completed, failed, delayed, isPaused] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
      queue.isPaused()
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused: isPaused
    };
  }

  /**
   * Get all queue statistics
   */
  async getAllStats(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};

    for (const [name, queue] of this.queues.entries()) {
      stats[name] = await this.getQueueStats(name);
    }

    return stats;
  }

  /**
   * Pause queue
   */
  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);

    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.pause();
    logger.info(`Queue ${queueName} paused`);
  }

  /**
   * Resume queue
   */
  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);

    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.resume();
    logger.info(`Queue ${queueName} resumed`);
  }

  /**
   * Clear queue
   */
  async clearQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);

    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.obliterate({ force: true });
    logger.info(`Queue ${queueName} cleared`);
  }

  /**
   * Retry failed jobs
   */
  async retryFailedJobs(queueName: string): Promise<number> {
    const queue = this.queues.get(queueName);

    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const failedJobs = await queue.getFailed();
    let retried = 0;

    for (const job of failedJobs) {
      await job.retry();
      retried++;
    }

    logger.info(`Retried ${retried} failed jobs in queue ${queueName}`);

    return retried;
  }

  /**
   * Get job by ID
   */
  async getJob(queueName: string, jobId: string): Promise<Job | undefined> {
    const queue = this.queues.get(queueName);

    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    return await queue.getJob(jobId);
  }

  /**
   * Remove job
   */
  async removeJob(queueName: string, jobId: string): Promise<void> {
    const job = await this.getJob(queueName, jobId);

    if (job) {
      await job.remove();
      logger.debug(`Removed job ${jobId} from queue ${queueName}`);
    }
  }

  /**
   * Shutdown gracefully
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Event Queue System...');

    // Close workers
    for (const [name, worker] of this.workers.entries()) {
      await worker.close();
      logger.debug(`Closed worker for queue: ${name}`);
    }

    // Close queue events
    for (const [name, events] of this.queueEvents.entries()) {
      await events.close();
      logger.debug(`Closed events for queue: ${name}`);
    }

    // Close queues
    for (const [name, queue] of this.queues.entries()) {
      await queue.close();
      logger.debug(`Closed queue: ${name}`);
    }

    // Close Redis connection
    this.connection.disconnect();

    logger.info('Event Queue System shut down');
  }
}

/**
 * Usage example:
 *
 * // Initialize queue
 * const queue = new EventQueue({
 *   redis: {
 *     host: 'localhost',
 *     port: 6379
 *   },
 *   concurrency: 5,
 *   limiter: { max: 100, duration: 1000 }
 * });
 *
 * await queue.initialize();
 *
 * // Register workers
 * queue.registerWorker('message-analysis', async (job) => {
 *   const { message } = job.data;
 *   // Process message
 *   const result = await analyzeMessage(message);
 *   return result;
 * }, 10);
 *
 * // Add jobs
 * await queue.addJob('message-analysis', {
 *   message: 'Hello world'
 * }, {
 *   priority: 1  // High priority
 * });
 *
 * // Get stats
 * const stats = await queue.getAllStats();
 * console.log('Queue stats:', stats);
 */

export default EventQueue;
