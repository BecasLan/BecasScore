import { Message } from 'discord.js';
import { createLogger } from '../services/Logger';
import { createHash } from 'crypto';

const logger = createLogger('EventGateway');

/**
 * EVENT GATEWAY - Single point of entry for all Discord events
 *
 * Responsibilities:
 * 1. Message deduplication (prevent double-processing)
 * 2. Rate limiting (per user, per channel, per guild)
 * 3. Event routing (reflex vs cognitive)
 * 4. Bot filtering (ignore other bots)
 * 5. Context stabilization
 */

export interface StableContext {
  message: Message;
  hash: string;
  timestamp: number;
  isFirstOccurrence: boolean;
  rateLimitStatus: {
    user: { current: number; max: number; limited: boolean };
    channel: { current: number; max: number; limited: boolean };
    guild: { current: number; max: number; limited: boolean };
  };
}

export interface EventGatewayConfig {
  rateLimits: {
    perUser: { max: number; windowMs: number };
    perChannel: { max: number; windowMs: number };
    perGuild: { max: number; windowMs: number };
  };
  deduplication: {
    cacheSize: number;
    ttlMs: number;
  };
}

export const DEFAULT_GATEWAY_CONFIG: EventGatewayConfig = {
  rateLimits: {
    perUser: { max: 10, windowMs: 60000 },      // 10 messages per minute per user
    perChannel: { max: 100, windowMs: 60000 },  // 100 messages per minute per channel
    perGuild: { max: 500, windowMs: 60000 },    // 500 messages per minute per guild
  },
  deduplication: {
    cacheSize: 10000,     // Keep last 10k message hashes
    ttlMs: 300000,        // 5 minutes
  },
};

export class EventGateway {
  private config: EventGatewayConfig;

  // Deduplication cache
  private processedHashes: Map<string, number> = new Map();
  private cleanupInterval?: NodeJS.Timeout;

  // Rate limiting trackers
  private userCounts: Map<string, { count: number; resetAt: number }> = new Map();
  private channelCounts: Map<string, { count: number; resetAt: number }> = new Map();
  private guildCounts: Map<string, { count: number; resetAt: number }> = new Map();

  // Context locks (prevent race conditions)
  private contextLocks: Map<string, Promise<void>> = new Map();

  constructor(config: Partial<EventGatewayConfig> = {}) {
    this.config = { ...DEFAULT_GATEWAY_CONFIG, ...config };
    this.startCleanupScheduler();
    logger.info('EventGateway initialized');
  }

  /**
   * Main entry point - stabilize and validate incoming message
   */
  async processMessage(message: Message): Promise<StableContext | null> {
    // 1. Bot filter
    if (message.author.bot) {
      return null; // Silently ignore bots
    }

    // 2. Generate unique hash for deduplication
    const hash = this.generateHash(message);

    // 3. Check if already processed
    if (this.processedHashes.has(hash)) {
      logger.debug(`Duplicate message detected: ${hash.substring(0, 8)}`);
      return null;
    }

    // 4. Acquire context lock to prevent race conditions
    const lockKey = `${message.guildId}:${message.channelId}:${message.author.id}`;
    await this.acquireLock(lockKey);

    try {
      // 5. Check rate limits
      const rateLimitStatus = this.checkRateLimits(message);

      if (rateLimitStatus.user.limited) {
        logger.warn(`User ${message.author.id} rate limited`);
        await message.reply('⚠️ You\'re sending messages too quickly. Please slow down.');
        this.markAsProcessed(hash);
        return null;
      }

      if (rateLimitStatus.channel.limited) {
        logger.warn(`Channel ${message.channelId} rate limited`);
        // Don't reply to avoid spam
        this.markAsProcessed(hash);
        return null;
      }

      if (rateLimitStatus.guild.limited) {
        logger.warn(`Guild ${message.guildId} rate limited (potential raid)`);
        // Emergency: This might be a raid
        this.markAsProcessed(hash);
        return null;
      }

      // 6. Mark as processed
      this.markAsProcessed(hash);

      // 7. Increment rate limit counters
      this.incrementRateLimits(message);

      // 8. Build stable context
      const stableContext: StableContext = {
        message,
        hash,
        timestamp: Date.now(),
        isFirstOccurrence: true,
        rateLimitStatus,
      };

      logger.debug(`Message processed: ${hash.substring(0, 8)} from ${message.author.username}`);
      return stableContext;

    } finally {
      // 9. Release lock
      this.releaseLock(lockKey);
    }
  }

  /**
   * Generate unique hash for message deduplication
   */
  private generateHash(message: Message): string {
    const data = `${message.id}:${message.author.id}:${message.channelId}:${message.createdTimestamp}`;
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Mark message as processed
   */
  private markAsProcessed(hash: string): void {
    this.processedHashes.set(hash, Date.now());

    // Enforce cache size limit (LRU eviction)
    if (this.processedHashes.size > this.config.deduplication.cacheSize) {
      const oldestKey = this.processedHashes.keys().next().value as string;
      if (oldestKey) {
        this.processedHashes.delete(oldestKey);
      }
    }
  }

  /**
   * Check rate limits for user, channel, and guild
   */
  private checkRateLimits(message: Message): StableContext['rateLimitStatus'] {
    const now = Date.now();

    // Check user rate limit
    const userId = message.author.id;
    const userLimit = this.config.rateLimits.perUser;
    let userCount = this.getUserCount(userId, now, userLimit.windowMs);

    // Check channel rate limit
    const channelId = message.channelId;
    const channelLimit = this.config.rateLimits.perChannel;
    let channelCount = this.getChannelCount(channelId, now, channelLimit.windowMs);

    // Check guild rate limit
    const guildId = message.guildId || 'dm';
    const guildLimit = this.config.rateLimits.perGuild;
    let guildCount = this.getGuildCount(guildId!, now, guildLimit.windowMs);

    return {
      user: {
        current: userCount,
        max: userLimit.max,
        limited: userCount >= userLimit.max,
      },
      channel: {
        current: channelCount,
        max: channelLimit.max,
        limited: channelCount >= channelLimit.max,
      },
      guild: {
        current: guildCount,
        max: guildLimit.max,
        limited: guildCount >= guildLimit.max,
      },
    };
  }

  /**
   * Increment rate limit counters
   */
  private incrementRateLimits(message: Message): void {
    const now = Date.now();

    // User
    const userId = message.author.id;
    const userLimit = this.config.rateLimits.perUser;
    let userData = this.userCounts.get(userId);
    if (!userData || now > userData.resetAt) {
      userData = { count: 0, resetAt: now + userLimit.windowMs };
      this.userCounts.set(userId, userData);
    }
    userData.count++;

    // Channel
    const channelId = message.channelId;
    const channelLimit = this.config.rateLimits.perChannel;
    let channelData = this.channelCounts.get(channelId);
    if (!channelData || now > channelData.resetAt) {
      channelData = { count: 0, resetAt: now + channelLimit.windowMs };
      this.channelCounts.set(channelId, channelData);
    }
    channelData.count++;

    // Guild
    const guildId = message.guildId || 'dm';
    const guildLimit = this.config.rateLimits.perGuild;
    let guildData = this.guildCounts.get(guildId);
    if (!guildData || now > guildData.resetAt) {
      guildData = { count: 0, resetAt: now + guildLimit.windowMs };
      this.guildCounts.set(guildId, guildData);
    }
    guildData.count++;
  }

  /**
   * Get current user message count
   */
  private getUserCount(userId: string, now: number, windowMs: number): number {
    const userData = this.userCounts.get(userId);
    if (!userData || now > userData.resetAt) {
      return 0;
    }
    return userData.count;
  }

  /**
   * Get current channel message count
   */
  private getChannelCount(channelId: string, now: number, windowMs: number): number {
    const channelData = this.channelCounts.get(channelId);
    if (!channelData || now > channelData.resetAt) {
      return 0;
    }
    return channelData.count;
  }

  /**
   * Get current guild message count
   */
  private getGuildCount(guildId: string, now: number, windowMs: number): number {
    const guildData = this.guildCounts.get(guildId);
    if (!guildData || now > guildData.resetAt) {
      return 0;
    }
    return guildData.count;
  }

  /**
   * Acquire lock to prevent race conditions
   */
  private async acquireLock(key: string): Promise<void> {
    const existingLock = this.contextLocks.get(key);
    if (existingLock) {
      await existingLock;
    }

    let resolveLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });

    this.contextLocks.set(key, lockPromise);

    // Auto-release after 5 seconds to prevent deadlock
    setTimeout(() => {
      if (this.contextLocks.get(key) === lockPromise) {
        this.contextLocks.delete(key);
        resolveLock!();
      }
    }, 5000);
  }

  /**
   * Release lock
   */
  private releaseLock(key: string): void {
    this.contextLocks.delete(key);
  }

  /**
   * Start cleanup scheduler for old hashes
   */
  private startCleanupScheduler(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const ttl = this.config.deduplication.ttlMs;

      // Clean old processed hashes
      for (const [hash, timestamp] of this.processedHashes.entries()) {
        if (now - timestamp > ttl) {
          this.processedHashes.delete(hash);
        }
      }

      // Clean old rate limit counters
      for (const [userId, userData] of this.userCounts.entries()) {
        if (now > userData.resetAt) {
          this.userCounts.delete(userId);
        }
      }

      for (const [channelId, channelData] of this.channelCounts.entries()) {
        if (now > channelData.resetAt) {
          this.channelCounts.delete(channelId);
        }
      }

      for (const [guildId, guildData] of this.guildCounts.entries()) {
        if (now > guildData.resetAt) {
          this.guildCounts.delete(guildId);
        }
      }

      logger.debug(`Cleanup: ${this.processedHashes.size} hashes, ${this.userCounts.size} user counters`);
    }, 60000); // Run every minute
  }

  /**
   * Stop the gateway
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    logger.info('EventGateway stopped');
  }

  /**
   * Get statistics
   */
  getStats(): {
    processedHashes: number;
    activeUserLimits: number;
    activeChannelLimits: number;
    activeGuildLimits: number;
    activeLocks: number;
  } {
    return {
      processedHashes: this.processedHashes.size,
      activeUserLimits: this.userCounts.size,
      activeChannelLimits: this.channelCounts.size,
      activeGuildLimits: this.guildCounts.size,
      activeLocks: this.contextLocks.size,
    };
  }
}
