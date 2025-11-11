// UserMonitor.ts

import { TaskManager } from '../advanced/TaskManager';
import { AnalyzedMessage } from '../types/Message.types';

export interface MonitorEvent {
  userId: string;
  userName: string;
  guildId: string;
  message: string;
  timestamp: Date;
  matched: boolean;
  matchedPattern?: string;
  taskId?: string;
}

export class UserMonitor {
  private taskManager: TaskManager;
  private eventLog: MonitorEvent[] = [];
  private maxLogSize = 1000;

  constructor(taskManager: TaskManager) {
    this.taskManager = taskManager;
  }

  /**
   * Process incoming message for monitoring
   */
  processMessage(message: AnalyzedMessage): void {
    // Get all active monitoring tasks for this guild
    const monitoringTasks = this.taskManager.getMonitoringTasks(message.guildId);

    if (monitoringTasks.length === 0) return;

    console.log(`👁️ Checking ${monitoringTasks.length} monitoring tasks...`);

    for (const task of monitoringTasks) {
      // Only check messages from the target user
      if (task.target.userId !== message.authorId) continue;

      console.log(`   Task ${task.id}: watching ${task.target.userName}`);

      // Check if message matches cancel condition
      const matched = this.taskManager.checkCancelCondition(
        task.id,
        message.content,
        message.authorId
      );

      // Log the event
      this.logEvent({
        userId: message.authorId,
        userName: message.authorName,
        guildId: message.guildId,
        message: message.content,
        timestamp: new Date(),
        matched,
        matchedPattern: task.cancelCondition?.value,
        taskId: task.id,
      });

      if (matched) {
        console.log(`✓ Pattern matched! Cancel condition triggered for task ${task.id}`);
      }
    }
  }

  /**
   * Log monitoring event
   */
  private logEvent(event: MonitorEvent): void {
    this.eventLog.push(event);

    // Keep log size manageable
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }
  }

  /**
   * Get recent events for a user
   */
  getUserEvents(userId: string, guildId: string, limit: number = 10): MonitorEvent[] {
    return this.eventLog
      .filter(e => e.userId === userId && e.guildId === guildId)
      .slice(-limit);
  }

  /**
   * Get matched events (when patterns triggered)
   */
  getMatchedEvents(guildId?: string, limit: number = 20): MonitorEvent[] {
    return this.eventLog
      .filter(e => e.matched && (!guildId || e.guildId === guildId))
      .slice(-limit);
  }

  /**
   * Clear old events
   */
  cleanup(olderThanMs: number = 86400000): void {
    const cutoff = Date.now() - olderThanMs;
    const before = this.eventLog.length;
    
    this.eventLog = this.eventLog.filter(e => e.timestamp.getTime() > cutoff);
    
    const removed = before - this.eventLog.length;
    if (removed > 0) {
      console.log(`🧹 Cleaned up ${removed} old monitor events`);
    }
  }

  /**
   * Get monitoring statistics
   */
  getStats(guildId?: string): {
    totalEvents: number;
    matchedEvents: number;
    uniqueUsers: number;
    activeTasks: number;
  } {
    const events = guildId 
      ? this.eventLog.filter(e => e.guildId === guildId)
      : this.eventLog;

    const uniqueUsers = new Set(events.map(e => e.userId)).size;
    const matchedEvents = events.filter(e => e.matched).length;
    const activeTasks = this.taskManager.getMonitoringTasks(guildId).length;

    return {
      totalEvents: events.length,
      matchedEvents,
      uniqueUsers,
      activeTasks,
    };
  }
}