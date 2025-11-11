// ActionScheduler.ts

import { Task } from '../types/Task.types';

export interface ScheduledAction {
  id: string;
  taskId: string;
  executeAt: Date;
  action: () => Promise<void>;
  timer?: NodeJS.Timeout;
  status: 'pending' | 'executing' | 'completed' | 'cancelled';
}

export class ActionScheduler {
  private scheduledActions: Map<string, ScheduledAction> = new Map();

  /**
   * Schedule an action for future execution
   */
  schedule(task: Task, action: () => Promise<void>): string {
    if (!task.executeAt) {
      throw new Error('Task must have executeAt date');
    }

    const delay = task.executeAt.getTime() - Date.now();

    if (delay <= 0) {
      // Execute immediately
      console.log(`⚡ Executing task ${task.id} immediately (scheduled time passed)`);
      this.executeNow(task.id, action);
      return task.id;
    }

    const scheduledAction: ScheduledAction = {
      id: task.id,
      taskId: task.id,
      executeAt: task.executeAt,
      action,
      status: 'pending',
    };

    const timer = setTimeout(async () => {
      await this.execute(task.id);
    }, delay);

    scheduledAction.timer = timer;
    this.scheduledActions.set(task.id, scheduledAction);

    console.log(`⏰ Scheduled task ${task.id} for ${this.formatDelay(delay)} from now`);

    return task.id;
  }

  /**
   * Execute a scheduled action
   */
  private async execute(actionId: string): Promise<void> {
    const scheduled = this.scheduledActions.get(actionId);
    
    if (!scheduled || scheduled.status !== 'pending') {
      return;
    }

    console.log(`⚡ Executing scheduled action ${actionId}`);

    scheduled.status = 'executing';

    try {
      await scheduled.action();
      scheduled.status = 'completed';
      console.log(`✓ Scheduled action ${actionId} completed`);
    } catch (error) {
      console.error(`✗ Scheduled action ${actionId} failed:`, error);
      scheduled.status = 'cancelled';
    }

    // Clean up after 1 minute
    setTimeout(() => {
      this.scheduledActions.delete(actionId);
    }, 60000);
  }

  /**
   * Execute action immediately
   */
  private async executeNow(actionId: string, action: () => Promise<void>): Promise<void> {
    const scheduled: ScheduledAction = {
      id: actionId,
      taskId: actionId,
      executeAt: new Date(),
      action,
      status: 'executing',
    };

    this.scheduledActions.set(actionId, scheduled);

    try {
      await action();
      scheduled.status = 'completed';
    } catch (error) {
      console.error(`Failed to execute action ${actionId}:`, error);
      scheduled.status = 'cancelled';
    }
  }

  /**
   * Cancel a scheduled action
   */
  cancel(actionId: string): boolean {
    const scheduled = this.scheduledActions.get(actionId);

    if (!scheduled) {
      return false;
    }

    if (scheduled.timer) {
      clearTimeout(scheduled.timer);
    }

    scheduled.status = 'cancelled';
    console.log(`❌ Cancelled scheduled action ${actionId}`);

    return true;
  }

  /**
   * Reschedule an action
   */
  reschedule(actionId: string, newExecuteAt: Date): boolean {
    const scheduled = this.scheduledActions.get(actionId);

    if (!scheduled || scheduled.status !== 'pending') {
      return false;
    }

    // Cancel existing timer
    if (scheduled.timer) {
      clearTimeout(scheduled.timer);
    }

    // Set new schedule
    const delay = newExecuteAt.getTime() - Date.now();

    if (delay <= 0) {
      this.execute(actionId);
      return true;
    }

    scheduled.executeAt = newExecuteAt;
    scheduled.timer = setTimeout(async () => {
      await this.execute(actionId);
    }, delay);

    console.log(`🔄 Rescheduled action ${actionId} for ${this.formatDelay(delay)} from now`);

    return true;
  }

  /**
   * Get scheduled action info
   */
  getScheduled(actionId: string): ScheduledAction | undefined {
    return this.scheduledActions.get(actionId);
  }

  /**
   * Get all pending actions
   */
  getPending(): ScheduledAction[] {
    return Array.from(this.scheduledActions.values())
      .filter(a => a.status === 'pending');
  }

  /**
   * Get time until execution
   */
  getTimeUntilExecution(actionId: string): number | null {
    const scheduled = this.scheduledActions.get(actionId);

    if (!scheduled || scheduled.status !== 'pending') {
      return null;
    }

    return scheduled.executeAt.getTime() - Date.now();
  }

  /**
   * Format delay for human reading
   */
  private formatDelay(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Clean up completed/cancelled actions
   */
  cleanup(): void {
    let cleaned = 0;

    for (const [id, scheduled] of this.scheduledActions.entries()) {
      if (scheduled.status === 'completed' || scheduled.status === 'cancelled') {
        this.scheduledActions.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} scheduled actions`);
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    pending: number;
    executing: number;
    completed: number;
    cancelled: number;
  } {
    const actions = Array.from(this.scheduledActions.values());

    return {
      pending: actions.filter(a => a.status === 'pending').length,
      executing: actions.filter(a => a.status === 'executing').length,
      completed: actions.filter(a => a.status === 'completed').length,
      cancelled: actions.filter(a => a.status === 'cancelled').length,
    };
  }
}