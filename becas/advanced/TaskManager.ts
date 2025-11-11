// TaskManager.ts

import { v4 as uuidv4 } from 'uuid';
import { StorageService } from '../services/StorageService';
import { Task, TaskAction, TaskCondition, CancelCondition, MonitoringConfig, TaskUpdate } from '../types/Task.types';

interface CreateTaskInput {
  type: 'immediate' | 'scheduled' | 'conditional';
  action: TaskAction;
  target: {
    userId: string;
    userName: string;
  };
  createdBy: {
    userId: string;
    userName: string;
  };
  guildId: string;
  condition?: TaskCondition;
  executeAt?: Date;
  cancelCondition?: CancelCondition;
  monitoring?: MonitoringConfig;
}

export class TaskManager {
  private storage: StorageService;
  private tasks: Map<string, Task> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(storage: StorageService) {
    this.storage = storage;
    this.loadTasks();
    this.startTaskProcessor();
  }

  /**
   * Load tasks from storage
   */
  private async loadTasks(): Promise<void> {
    try {
      const data = await this.storage.read('tasks', 'active_tasks.json');
      if (data && Array.isArray(data)) {
        data.forEach((task: Task) => {
          // Convert date strings back to Date objects
          task.createdAt = new Date(task.createdAt);
          task.updatedAt = new Date(task.updatedAt);
          if (task.executeAt) task.executeAt = new Date(task.executeAt);
          if (task.executedAt) task.executedAt = new Date(task.executedAt);

          this.tasks.set(task.id, task);
        });
        console.log(`=� Loaded ${this.tasks.size} tasks`);
      }
    } catch (error) {
      console.log('No existing tasks found');
    }
  }

  /**
   * Save tasks to storage
   */
  private async saveTasks(): Promise<void> {
    const tasksArray = Array.from(this.tasks.values());
    await this.storage.write('tasks', 'active_tasks.json', tasksArray);
  }

  /**
   * Create a new task
   */
  async createTask(input: CreateTaskInput): Promise<Task> {
    const task: Task = {
      id: uuidv4(),
      type: input.type,
      action: input.action,
      target: input.target,
      createdBy: input.createdBy,
      guildId: input.guildId,
      condition: input.condition,
      executeAt: input.executeAt,
      cancelCondition: input.cancelCondition,
      monitoring: input.monitoring,
      status: input.monitoring ? 'monitoring' : (input.type === 'scheduled' ? 'pending' : 'executing'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.tasks.set(task.id, task);
    await this.saveTasks();

    console.log(` Task created: ${task.id} (${task.type})`);

    return task;
  }

  /**
   * Get all monitoring tasks for a guild
   */
  getMonitoringTasks(guildId?: string): Task[] {
    const tasks = Array.from(this.tasks.values());

    if (guildId) {
      return tasks.filter(t =>
        t.guildId === guildId &&
        (t.status === 'monitoring' || t.status === 'pending')
      );
    }

    return tasks.filter(t => t.status === 'monitoring' || t.status === 'pending');
  }

  /**
   * Check if message matches cancel condition
   */
  checkCancelCondition(taskId: string, messageContent: string, userId: string): boolean {
    const task = this.tasks.get(taskId);

    if (!task || !task.cancelCondition) {
      return false;
    }

    // Check if message is from the target user
    if (task.target.userId !== userId) {
      return false;
    }

    const condition = task.cancelCondition;
    const lower = messageContent.toLowerCase();
    const pattern = String(condition.value).toLowerCase();

    let matched = false;

    switch (condition.type) {
      case 'message_pattern':
        matched = lower.includes(pattern);
        break;

      case 'user_action':
        // Check for specific actions like apology
        if (pattern.includes('apolog')) {
          matched = lower.includes('sorry') ||
                   lower.includes('apologize') ||
                   lower.includes('apology') ||
                   lower.includes('my bad');
        } else {
          matched = lower.includes(pattern);
        }
        break;

      default:
        matched = false;
    }

    if (matched) {
      console.log(`=� Cancel condition matched for task ${taskId}`);
      this.updateTask(taskId, {
        status: 'cancelled',
        result: `Cancelled: user said "${pattern}"`,
      });
    }

    return matched;
  }

  /**
   * Update task status
   */
  async updateTask(taskId: string, update: TaskUpdate): Promise<void> {
    const task = this.tasks.get(taskId);

    if (!task) {
      console.warn(`Task ${taskId} not found`);
      return;
    }

    if (update.status) task.status = update.status;
    if (update.result) task.result = update.result;
    if (update.error) task.error = update.error;
    if (update.executedAt) task.executedAt = update.executedAt;

    task.updatedAt = new Date();

    await this.saveTasks();
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks for a guild
   */
  getGuildTasks(guildId: string): Task[] {
    return Array.from(this.tasks.values())
      .filter(t => t.guildId === guildId);
  }

  /**
   * Delete task
   */
  async deleteTask(taskId: string): Promise<void> {
    this.tasks.delete(taskId);
    await this.saveTasks();
  }

  /**
   * Process tasks periodically
   */
  private startTaskProcessor(): void {
    // Check tasks every 10 seconds
    this.checkInterval = setInterval(() => {
      this.processTasks();
    }, 10000);
  }

  /**
   * Process scheduled and monitoring tasks
   */
  private async processTasks(): Promise<void> {
    const now = new Date();

    for (const task of this.tasks.values()) {
      // Check scheduled tasks
      if (task.type === 'scheduled' && task.status === 'pending' && task.executeAt) {
        if (now >= task.executeAt) {
          console.log(`� Scheduled task ${task.id} is ready to execute`);
          await this.updateTask(task.id, {
            status: 'completed',
            executedAt: now,
            result: 'Ready for execution',
          });
        }
      }

      // Check monitoring tasks
      if (task.status === 'monitoring' && task.monitoring) {
        const monitoringSince = task.createdAt.getTime();
        const monitoringDuration = task.monitoring.duration;

        if (now.getTime() - monitoringSince >= monitoringDuration) {
          console.log(`� Monitoring period ended for task ${task.id}`);
          await this.updateTask(task.id, {
            status: 'completed',
            result: 'Monitoring period ended - executing action',
          });
        }
      }

      // Clean up old completed/cancelled tasks (older than 24 hours)
      if ((task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed') &&
          now.getTime() - task.updatedAt.getTime() > 86400000) {
        console.log(`>� Cleaning up old task ${task.id}`);
        await this.deleteTask(task.id);
      }
    }
  }

  /**
   * Stop task processor
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Get statistics
   */
  getStats(guildId?: string): {
    total: number;
    pending: number;
    monitoring: number;
    completed: number;
    cancelled: number;
    failed: number;
  } {
    const tasks = guildId
      ? Array.from(this.tasks.values()).filter(t => t.guildId === guildId)
      : Array.from(this.tasks.values());

    return {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      monitoring: tasks.filter(t => t.status === 'monitoring').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      cancelled: tasks.filter(t => t.status === 'cancelled').length,
      failed: tasks.filter(t => t.status === 'failed').length,
    };
  }
}
