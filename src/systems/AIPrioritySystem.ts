import { createLogger } from '../services/Logger';

const logger = createLogger('AIPrioritySystem');

export enum Priority {
  CRITICAL = 1,  // Must run: Scam detection, crisis detection
  HIGH = 2,      // Should run: Sentiment, toxicity analysis
  MEDIUM = 3,    // Nice to have: Conflict prediction
  LOW = 4,       // Background: User profiling, network analysis
}

export interface AITask {
  id: string;
  name: string;
  priority: Priority;
  estimatedCost: number; // Relative cost (1-10)
  execute: () => Promise<any>;
  timeout?: number;
}

export interface AITaskResult {
  taskId: string;
  success: boolean;
  result?: any;
  error?: Error;
  duration: number;
  skipped: boolean;
  reason?: string;
}

export class AIPrioritySystem {
  private callCount: Map<string, number> = new Map(); // Track calls per message
  private taskQueue: AITask[] = [];

  /**
   * Add task to queue
   */
  addTask(task: AITask): void {
    this.taskQueue.push(task);
    logger.debug(`Task added: ${task.name} (Priority: ${task.priority}, Cost: ${task.estimatedCost})`);
  }

  /**
   * Execute tasks based on budget and priority
   */
  async executeTasks(messageId: string, maxCalls: number): Promise<AITaskResult[]> {
    const startTime = Date.now();

    // Sort by priority (lowest number = highest priority)
    this.taskQueue.sort((a, b) => a.priority - b.priority);

    const results: AITaskResult[] = [];
    let callsUsed = 0;
    const currentCount = this.callCount.get(messageId) || 0;

    logger.info(`Executing AI tasks for message ${messageId.slice(0, 8)}... (Budget: ${maxCalls})`);

    for (const task of this.taskQueue) {
      // Check if we've exceeded budget
      if (currentCount + callsUsed >= maxCalls) {
        logger.warn(`Budget exceeded, skipping task: ${task.name}`);
        results.push({
          taskId: task.id,
          success: false,
          skipped: true,
          reason: 'Budget exceeded',
          duration: 0,
        });
        continue;
      }

      // Execute task with timeout
      const taskStart = Date.now();
      try {
        logger.debug(`Executing task: ${task.name}`);

        const timeout = task.timeout || 5000;
        const result = await Promise.race([
          task.execute(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Task timeout')), timeout)
          ),
        ]);

        const duration = Date.now() - taskStart;
        callsUsed += task.estimatedCost;

        results.push({
          taskId: task.id,
          success: true,
          result,
          duration,
          skipped: false,
        });

        logger.debug(`Task completed: ${task.name} (${duration}ms)`);
      } catch (error) {
        const duration = Date.now() - taskStart;
        logger.error(`Task failed: ${task.name}`, error);

        results.push({
          taskId: task.id,
          success: false,
          error: error as Error,
          duration,
          skipped: false,
        });

        // For critical tasks, we still count them against budget even if they fail
        callsUsed += task.estimatedCost;
      }
    }

    // Update call count
    this.callCount.set(messageId, currentCount + callsUsed);

    // Auto-cleanup after 1 minute
    setTimeout(() => {
      this.callCount.delete(messageId);
    }, 60000);

    const totalDuration = Date.now() - startTime;
    logger.info(`AI tasks completed: ${results.filter(r => r.success).length}/${results.length} successful (${totalDuration}ms, ${callsUsed} calls used)`);

    // Clear queue
    this.taskQueue = [];

    return results;
  }

  /**
   * Get remaining budget for message
   */
  getRemainingBudget(messageId: string, maxCalls: number): number {
    const used = this.callCount.get(messageId) || 0;
    return Math.max(0, maxCalls - used);
  }

  /**
   * Clear all tasks (emergency stop)
   */
  clearTasks(): void {
    this.taskQueue = [];
    logger.warn('All AI tasks cleared');
  }

  /**
   * Get queue status
   */
  getQueueStatus(): { pending: number; byPriority: Record<Priority, number> } {
    const byPriority: Record<Priority, number> = {
      [Priority.CRITICAL]: 0,
      [Priority.HIGH]: 0,
      [Priority.MEDIUM]: 0,
      [Priority.LOW]: 0,
    };

    this.taskQueue.forEach(task => {
      byPriority[task.priority]++;
    });

    return {
      pending: this.taskQueue.length,
      byPriority,
    };
  }
}

// Predefined task templates
export class AITaskTemplates {
  /**
   * Critical: Scam detection
   */
  static scamDetection(content: string, detector: any): AITask {
    return {
      id: 'scam-detection',
      name: 'Scam Detection',
      priority: Priority.CRITICAL,
      estimatedCost: 1,
      timeout: 3000,
      execute: async () => {
        return await detector.analyze(content);
      },
    };
  }

  /**
   * Critical: Crisis detection (suicide/self-harm)
   */
  static crisisDetection(content: string, username: string, detector: any): AITask {
    return {
      id: 'crisis-detection',
      name: 'Crisis Detection',
      priority: Priority.CRITICAL,
      estimatedCost: 1,
      timeout: 3000,
      execute: async () => {
        return await detector.detectCrisis(content, username);
      },
    };
  }

  /**
   * High: Message analysis (sentiment, toxicity)
   */
  static messageAnalysis(context: any, processor: any): AITask {
    return {
      id: 'message-analysis',
      name: 'Message Analysis',
      priority: Priority.HIGH,
      estimatedCost: 1,
      timeout: 5000,
      execute: async () => {
        return await processor.analyzeMessage(context);
      },
    };
  }

  /**
   * High: Language detection
   */
  static languageDetection(content: string, detector: any): AITask {
    return {
      id: 'language-detection',
      name: 'Language Detection',
      priority: Priority.HIGH,
      estimatedCost: 1,
      timeout: 3000,
      execute: async () => {
        return await detector.analyze(content);
      },
    };
  }

  /**
   * Medium: Conflict prediction
   */
  static conflictPrediction(analyzed: any, recentMessages: string[], predictor: any): AITask {
    return {
      id: 'conflict-prediction',
      name: 'Conflict Prediction',
      priority: Priority.MEDIUM,
      estimatedCost: 1,
      timeout: 4000,
      execute: async () => {
        return await predictor.analyzeForConflict(analyzed, recentMessages);
      },
    };
  }

  /**
   * Low: User profiling
   */
  static userProfiling(analyzed: any, profiler: any): AITask {
    return {
      id: 'user-profiling',
      name: 'User Profiling',
      priority: Priority.LOW,
      estimatedCost: 1,
      timeout: 5000,
      execute: async () => {
        return await profiler.detectAnomaly(analyzed);
      },
    };
  }

  /**
   * Low: Image analysis
   */
  static imageAnalysis(url: string, analyzer: any): AITask {
    return {
      id: 'image-analysis',
      name: 'Image Analysis',
      priority: Priority.HIGH, // Actually important for moderation
      estimatedCost: 2, // More expensive
      timeout: 8000,
      execute: async () => {
        return await analyzer.analyzeImage(url);
      },
    };
  }
}
