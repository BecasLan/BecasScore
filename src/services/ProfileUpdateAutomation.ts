/**
 * PROFILE UPDATE AUTOMATION - Keep user profiles fresh and accurate
 *
 * Strategies:
 * 1. Incremental Updates: Update profile traits after each message (lightweight)
 * 2. Periodic Rebuilds: Full profile rebuild every N messages or N days
 * 3. Event-Triggered Rebuilds: Rebuild after significant events (ban, unban, promotion)
 * 4. Background Batch Updates: Update all active users during low traffic
 *
 * Goals:
 * - Profiles stay accurate without constant full rebuilds
 * - Performance-friendly (don't block message processing)
 * - Detect behavior changes quickly
 */

import { Message } from 'discord.js';
import { ProfileBuilder, UserCharacterProfile } from './ProfileBuilder';
import { AnalyzedMessage } from '../types/Message.types';
import { UserRepository } from '../database/repositories/UserRepository';
import { MessageRepository } from '../database/repositories/MessageRepository';
import { SicilRepository } from '../database/repositories/SicilRepository';
import { createLogger } from './Logger';

const logger = createLogger('ProfileUpdateAutomation');

export interface ProfileUpdateConfig {
  incrementalUpdatesEnabled: boolean;  // Update after each message
  messagesPerRebuild: number;          // Full rebuild every N messages (default: 50)
  daysPerRebuild: number;              // Full rebuild every N days (default: 7)
  rebuildOnEvents: boolean;            // Rebuild on bans/unbans/role changes
  backgroundUpdatesEnabled: boolean;   // Batch update all profiles nightly
}

export interface UpdateTrigger {
  type: 'message' | 'event' | 'periodic' | 'manual';
  userId: string;
  serverId: string;
  reason: string;
  timestamp: Date;
}

export class ProfileUpdateAutomation {
  private config: ProfileUpdateConfig;
  private lastFullRebuild: Map<string, Date> = new Map(); // userId:serverId → timestamp
  private messagesSinceRebuild: Map<string, number> = new Map(); // userId:serverId → count
  private updateQueue: UpdateTrigger[] = [];
  private isProcessingQueue = false;

  constructor(
    private profileBuilder: ProfileBuilder,
    private userRepo: UserRepository,
    private messageRepo: MessageRepository,
    private sicilRepo: SicilRepository,
    config?: Partial<ProfileUpdateConfig>
  ) {
    this.config = {
      incrementalUpdatesEnabled: true,
      messagesPerRebuild: 50,
      daysPerRebuild: 7,
      rebuildOnEvents: true,
      backgroundUpdatesEnabled: false, // Disabled by default (expensive)
      ...config,
    };

    logger.info('ProfileUpdateAutomation initialized', this.config);
  }

  /**
   * Handle message (incremental update + check if full rebuild needed)
   */
  async onMessage(
    message: Message,
    analyzedMessage: AnalyzedMessage
  ): Promise<void> {
    const key = `${message.author.id}:${message.guildId}`;

    try {
      // 1. Incremental update (lightweight)
      if (this.config.incrementalUpdatesEnabled) {
        await this.incrementalUpdate(message.author.id, message.guildId!, analyzedMessage);
      }

      // 2. Track messages since last rebuild
      const messageCount = (this.messagesSinceRebuild.get(key) || 0) + 1;
      this.messagesSinceRebuild.set(key, messageCount);

      // 3. Check if full rebuild needed
      if (this.shouldRebuildProfile(message.author.id, message.guildId!, messageCount)) {
        logger.info(`Triggering full profile rebuild for ${message.author.id} (${messageCount} messages since last rebuild)`);
        this.queueUpdate({
          type: 'periodic',
          userId: message.author.id,
          serverId: message.guildId!,
          reason: `${messageCount} messages since last rebuild`,
          timestamp: new Date(),
        });
      }

    } catch (error) {
      logger.error(`Error handling message for profile update`, error);
    }
  }

  /**
   * Handle significant event (ban, unban, role change, etc.)
   */
  async onEvent(
    eventType: 'ban' | 'unban' | 'timeout' | 'role_change' | 'promotion' | 'demotion',
    userId: string,
    serverId: string
  ): Promise<void> {
    if (!this.config.rebuildOnEvents) return;

    logger.info(`Event-triggered profile rebuild: ${eventType} for user ${userId}`);
    this.queueUpdate({
      type: 'event',
      userId,
      serverId,
      reason: `Event: ${eventType}`,
      timestamp: new Date(),
    });
  }

  /**
   * Manual rebuild trigger (e.g., from admin API)
   */
  async manualRebuild(userId: string, serverId: string): Promise<UserCharacterProfile | null> {
    logger.info(`Manual profile rebuild requested for ${userId}`);

    const profile = await this.profileBuilder.buildProfile(userId, serverId, 10);

    if (profile) {
      const key = `${userId}:${serverId}`;
      this.lastFullRebuild.set(key, new Date());
      this.messagesSinceRebuild.set(key, 0);
    }

    return profile;
  }

  /**
   * Incremental update (update specific traits without full rebuild)
   */
  private async incrementalUpdate(
    userId: string,
    serverId: string,
    analyzedMessage: AnalyzedMessage
  ): Promise<void> {
    // TODO: Implement incremental updates
    // For now, this is a placeholder
    // Real implementation would:
    // 1. Load current profile
    // 2. Update specific traits based on this message
    // 3. Recalculate aggregates (running averages)
    // 4. Save updated profile

    logger.debug(`Incremental update for ${userId} (not fully implemented)`);
  }

  /**
   * Check if profile needs full rebuild
   */
  private shouldRebuildProfile(
    userId: string,
    serverId: string,
    messageCount: number
  ): boolean {
    const key = `${userId}:${serverId}`;

    // Check message count threshold
    if (messageCount >= this.config.messagesPerRebuild) {
      return true;
    }

    // Check time threshold
    const lastRebuild = this.lastFullRebuild.get(key);
    if (lastRebuild) {
      const daysSince = (Date.now() - lastRebuild.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince >= this.config.daysPerRebuild) {
        return true;
      }
    } else {
      // No rebuild record = needs rebuild
      return true;
    }

    return false;
  }

  /**
   * Queue update for background processing
   */
  private queueUpdate(trigger: UpdateTrigger): void {
    // Check if already queued
    const isDuplicate = this.updateQueue.some(
      t => t.userId === trigger.userId && t.serverId === trigger.serverId
    );

    if (!isDuplicate) {
      this.updateQueue.push(trigger);
      logger.debug(`Queued profile update: ${trigger.reason}`);
    }

    // Process queue if not already running
    if (!this.isProcessingQueue) {
      this.processQueue();
    }
  }

  /**
   * Background queue processor
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.updateQueue.length === 0) return;

    this.isProcessingQueue = true;
    logger.info(`Processing ${this.updateQueue.length} queued profile updates`);

    while (this.updateQueue.length > 0) {
      const trigger = this.updateQueue.shift()!;

      try {
        logger.debug(`Processing: ${trigger.type} update for ${trigger.userId}`);

        const profile = await this.profileBuilder.buildProfile(
          trigger.userId,
          trigger.serverId,
          10
        );

        if (profile) {
          const key = `${trigger.userId}:${trigger.serverId}`;
          this.lastFullRebuild.set(key, new Date());
          this.messagesSinceRebuild.set(key, 0);
          logger.info(`✅ Profile rebuilt for ${trigger.userId}`);
        } else {
          logger.warn(`⚠️ Profile rebuild failed for ${trigger.userId} (not enough messages)`);
        }

        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        logger.error(`Failed to process profile update for ${trigger.userId}`, error);
      }
    }

    this.isProcessingQueue = false;
    logger.info('✅ Profile update queue processed');
  }

  /**
   * Background batch update (runs during low traffic, e.g., 3 AM)
   */
  async batchUpdateActiveUsers(serverId: string, limit = 100): Promise<number> {
    if (!this.config.backgroundUpdatesEnabled) {
      logger.debug('Background updates disabled');
      return 0;
    }

    logger.info(`Starting batch profile update for server ${serverId}`);

    try {
      // Get active users who need profile updates
      // TODO: Query database for users who:
      // 1. Have messages in last 7 days
      // 2. Haven't had profile rebuild in last 7 days
      // 3. Limit to top N most active users

      // Placeholder: Would query database
      const activeUsers: string[] = [];

      let updated = 0;
      for (const userId of activeUsers) {
        try {
          const profile = await this.profileBuilder.buildProfile(userId, serverId, 10);
          if (profile) {
            updated++;
            logger.debug(`Batch updated profile for ${userId}`);
          }
        } catch (error) {
          logger.error(`Batch update failed for ${userId}`, error);
        }

        // Delay between updates
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      logger.info(`✅ Batch update complete: ${updated}/${activeUsers.length} profiles updated`);
      return updated;

    } catch (error) {
      logger.error('Batch update failed', error);
      return 0;
    }
  }

  /**
   * Get update statistics
   */
  getStats(): {
    queueLength: number;
    isProcessing: boolean;
    trackedUsers: number;
    config: ProfileUpdateConfig;
  } {
    return {
      queueLength: this.updateQueue.length,
      isProcessing: this.isProcessingQueue,
      trackedUsers: this.lastFullRebuild.size,
      config: this.config,
    };
  }

  /**
   * Clear all update tracking (useful for debugging)
   */
  clear(): void {
    this.lastFullRebuild.clear();
    this.messagesSinceRebuild.clear();
    this.updateQueue = [];
    this.isProcessingQueue = false;
    logger.info('Profile update tracking cleared');
  }
}
