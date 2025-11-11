/**
 * USER MONITOR (DATABASE VERSION)
 *
 * Migrated from in-memory to PostgreSQL
 * - Monitor events stored in database
 * - Active monitoring tasks in Redis
 */

import { TaskManager } from '../advanced/TaskManager';
import { AnalyzedMessage } from '../types/Message.types';
import { SicilRepository } from '../database/repositories';
import { getDatabaseService } from '../database/DatabaseService';
import { createLogger } from '../services/Logger';

const logger = createLogger('UserMonitorDB');

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

export class UserMonitorDB {
  private taskManager: TaskManager;
  private sicilRepo: SicilRepository;
  private db = getDatabaseService();
  private maxLogSize = 1000;

  constructor(taskManager: TaskManager) {
    this.taskManager = taskManager;
    this.sicilRepo = new SicilRepository();
    logger.info('UserMonitorDB initialized (database-backed)');
  }

  /**
   * Process incoming message for monitoring
   */
  async processMessage(message: AnalyzedMessage): Promise<void> {
    // Get all active monitoring tasks for this guild
    const monitoringTasks = this.taskManager.getMonitoringTasks(message.guildId);

    if (monitoringTasks.length === 0) return;

    logger.debug(`Checking ${monitoringTasks.length} monitoring tasks...`);

    for (const task of monitoringTasks) {
      // Only check messages from the target user
      if (task.target.userId !== message.authorId) continue;

      logger.debug(`Task ${task.id}: watching ${task.target.userName}`);

      // Check if message matches cancel condition
      const matched = this.taskManager.checkCancelCondition(
        task.id,
        message.content,
        message.authorId
      );

      // Log the event to database
      await this.logEvent({
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
        logger.info(`Pattern matched! Cancel condition triggered for task ${task.id}`);
      }
    }
  }

  /**
   * Log monitoring event to database
   */
  private async logEvent(event: MonitorEvent): Promise<void> {
    try {
      await this.sicilRepo.logAction({
        server_id: event.guildId,
        user_id: event.userId,
        action_type: 'monitor_event',
        content: event.message,
        metadata: {
          matched: event.matched,
          matchedPattern: event.matchedPattern,
          taskId: event.taskId
        }
      });
    } catch (error) {
      logger.error('Failed to log monitor event', error);
    }
  }

  /**
   * Get monitoring history for user
   */
  async getMonitoringHistory(
    guildId: string,
    userId: string,
    limit: number = 100
  ): Promise<MonitorEvent[]> {
    try {
      const actions = await this.sicilRepo.getUserActions(guildId, userId, limit);

      return actions
        .filter(a => a.action_type === 'monitor_event')
        .map(a => ({
          userId: a.user_id,
          userName: '', // Would need to join with users table
          guildId: a.server_id,
          message: a.content || '',
          timestamp: a.timestamp,
          matched: a.metadata?.matched || false,
          matchedPattern: a.metadata?.matchedPattern,
          taskId: a.metadata?.taskId
        }));
    } catch (error) {
      logger.error('Failed to get monitoring history', error);
      return [];
    }
  }

  /**
   * Get recent monitoring events
   */
  async getRecentEvents(
    guildId: string,
    limit: number = 100
  ): Promise<MonitorEvent[]> {
    try {
      const cacheKey = `monitor_events:${guildId}:${limit}`;

      return await this.db.cached<MonitorEvent[]>(
        cacheKey,
        60, // 1 minute
        async () => {
          // This would need a proper SQL query
          // Simplified for now
          return [];
        }
      );
    } catch (error) {
      logger.error('Failed to get recent events', error);
      return [];
    }
  }

  /**
   * Clear old events (cleanup job)
   */
  async clearOldEvents(daysToKeep: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

      const result = await this.db.query(
        `DELETE FROM user_actions
         WHERE action_type = 'monitor_event' AND timestamp < $1`,
        [cutoffDate]
      );

      const deleted = result.rowCount || 0;
      logger.info(`Cleared ${deleted} old monitor events`);
      return deleted;
    } catch (error) {
      logger.error('Failed to clear old events', error);
      return 0;
    }
  }
}
