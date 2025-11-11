import { Guild, GuildMember, Client } from 'discord.js';
import { createLogger } from '../services/Logger';

const logger = createLogger('ServerStateManager');

/**
 * SERVER STATE MANAGER
 *
 * Tracks active moderation states so AI can answer questions like:
 * - "who's in timeout?"
 * - "show me all banned users"
 * - "who did I timeout last?"
 *
 * This makes AI truly aware of server state, not just processing commands blindly.
 */

export interface TimeoutInfo {
  userId: string;
  username: string;
  reason: string;
  appliedAt: Date;
  expiresAt: Date;
  appliedBy: string;
  duration: number; // milliseconds
}

export interface BanInfo {
  userId: string;
  username: string;
  reason: string;
  bannedAt: Date;
  bannedBy: string;
}

export interface ModerationAction {
  type: 'timeout' | 'ban' | 'kick' | 'warn';
  userId: string;
  username: string;
  reason: string;
  timestamp: Date;
  appliedBy: string;
  duration?: number;
}

export class ServerStateManager {
  private client: Client;

  // Active timeouts per guild
  private activeTimeouts: Map<string, TimeoutInfo[]> = new Map(); // guildId -> TimeoutInfo[]

  // Ban list per guild
  private activeBans: Map<string, BanInfo[]> = new Map(); // guildId -> BanInfo[]

  // Recent moderation history (last 100 actions per guild)
  private moderationHistory: Map<string, ModerationAction[]> = new Map(); // guildId -> actions[]

  constructor(client: Client) {
    this.client = client;
    logger.info('ServerStateManager initialized');
  }

  /**
   * Record a timeout action
   */
  recordTimeout(
    guildId: string,
    userId: string,
    username: string,
    reason: string,
    duration: number,
    appliedBy: string
  ): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + duration);

    const timeoutInfo: TimeoutInfo = {
      userId,
      username,
      reason,
      appliedAt: now,
      expiresAt,
      appliedBy,
      duration,
    };

    // Add to active timeouts
    if (!this.activeTimeouts.has(guildId)) {
      this.activeTimeouts.set(guildId, []);
    }
    this.activeTimeouts.get(guildId)!.push(timeoutInfo);

    // Add to moderation history
    this.addToHistory(guildId, {
      type: 'timeout',
      userId,
      username,
      reason,
      timestamp: now,
      appliedBy,
      duration,
    });

    // Auto-remove from active timeouts after duration
    setTimeout(() => {
      this.removeTimeout(guildId, userId);
    }, duration);

    logger.info(`Recorded timeout: ${username} in guild ${guildId} for ${duration}ms`);
  }

  /**
   * Remove a timeout (untimeout)
   */
  removeTimeout(guildId: string, userId: string): void {
    const timeouts = this.activeTimeouts.get(guildId);
    if (timeouts) {
      const filtered = timeouts.filter(t => t.userId !== userId);
      this.activeTimeouts.set(guildId, filtered);
      logger.info(`Removed timeout for user ${userId} in guild ${guildId}`);
    }
  }

  /**
   * Record a ban action
   */
  recordBan(
    guildId: string,
    userId: string,
    username: string,
    reason: string,
    bannedBy: string
  ): void {
    const now = new Date();

    const banInfo: BanInfo = {
      userId,
      username,
      reason,
      bannedAt: now,
      bannedBy,
    };

    // Add to active bans
    if (!this.activeBans.has(guildId)) {
      this.activeBans.set(guildId, []);
    }
    this.activeBans.get(guildId)!.push(banInfo);

    // Add to moderation history
    this.addToHistory(guildId, {
      type: 'ban',
      userId,
      username,
      reason,
      timestamp: now,
      appliedBy: bannedBy,
    });

    logger.info(`Recorded ban: ${username} in guild ${guildId}`);
  }

  /**
   * Remove a ban (unban)
   */
  removeBan(guildId: string, userId: string): void {
    const bans = this.activeBans.get(guildId);
    if (bans) {
      const filtered = bans.filter(b => b.userId !== userId);
      this.activeBans.set(guildId, filtered);
      logger.info(`Removed ban for user ${userId} in guild ${guildId}`);
    }
  }

  /**
   * Record a kick action
   */
  recordKick(
    guildId: string,
    userId: string,
    username: string,
    reason: string,
    kickedBy: string
  ): void {
    this.addToHistory(guildId, {
      type: 'kick',
      userId,
      username,
      reason,
      timestamp: new Date(),
      appliedBy: kickedBy,
    });

    logger.info(`Recorded kick: ${username} in guild ${guildId}`);
  }

  /**
   * Get all active timeouts for a guild
   */
  getActiveTimeouts(guildId: string): TimeoutInfo[] {
    return this.activeTimeouts.get(guildId) || [];
  }

  /**
   * Get all active bans for a guild
   */
  getActiveBans(guildId: string): BanInfo[] {
    return this.activeBans.get(guildId) || [];
  }

  /**
   * Get moderation history for a guild
   */
  getModerationHistory(guildId: string, limit: number = 20): ModerationAction[] {
    const history = this.moderationHistory.get(guildId) || [];
    return history.slice(-limit); // Return last N actions
  }

  /**
   * Get last action by a specific moderator
   */
  getLastActionBy(guildId: string, moderatorId: string): ModerationAction | null {
    const history = this.moderationHistory.get(guildId) || [];
    const actions = history.filter(a => a.appliedBy === moderatorId);
    return actions.length > 0 ? actions[actions.length - 1] : null;
  }

  /**
   * Check if user is currently timed out
   */
  isUserTimedOut(guildId: string, userId: string): boolean {
    const timeouts = this.activeTimeouts.get(guildId) || [];
    return timeouts.some(t => t.userId === userId && t.expiresAt > new Date());
  }

  /**
   * Check if user is banned
   */
  isUserBanned(guildId: string, userId: string): boolean {
    const bans = this.activeBans.get(guildId) || [];
    return bans.some(b => b.userId === userId);
  }

  /**
   * Get server state summary for AI context
   */
  getServerStateSummary(guildId: string): string {
    const timeouts = this.getActiveTimeouts(guildId);
    const bans = this.getActiveBans(guildId);
    const recentActions = this.getModerationHistory(guildId, 5);

    let summary = '';

    if (timeouts.length > 0) {
      summary += `\n**Active Timeouts (${timeouts.length}):**\n`;
      timeouts.forEach(t => {
        const remaining = t.expiresAt.getTime() - Date.now();
        const minutesRemaining = Math.ceil(remaining / 60000);
        summary += `- ${t.username}: ${t.reason} (${minutesRemaining} min remaining)\n`;
      });
    }

    if (bans.length > 0) {
      summary += `\n**Active Bans (${bans.length}):**\n`;
      bans.forEach(b => {
        summary += `- ${b.username}: ${b.reason}\n`;
      });
    }

    if (recentActions.length > 0) {
      summary += `\n**Recent Moderation Actions:**\n`;
      recentActions.forEach(a => {
        const timeAgo = this.getTimeAgo(a.timestamp);
        summary += `- ${a.type} ${a.username}: ${a.reason} (${timeAgo})\n`;
      });
    }

    return summary.trim() || 'No active moderation actions';
  }

  /**
   * Sync with Discord - refresh timeout/ban state from API
   */
  async syncWithDiscord(guild: Guild): Promise<void> {
    try {
      // Fetch actual Discord bans
      const discordBans = await guild.bans.fetch();

      const banList: BanInfo[] = [];
      discordBans.forEach(ban => {
        banList.push({
          userId: ban.user.id,
          username: ban.user.username,
          reason: ban.reason || 'No reason provided',
          bannedAt: new Date(), // Discord doesn't provide exact ban time
          bannedBy: 'Unknown', // Discord doesn't provide banner info
        });
      });

      this.activeBans.set(guild.id, banList);

      // Fetch actual Discord timeouts from members
      const members = await guild.members.fetch();
      const timeoutList: TimeoutInfo[] = [];

      members.forEach(member => {
        if (member.communicationDisabledUntil && member.communicationDisabledUntil > new Date()) {
          const expiresAt = member.communicationDisabledUntil;
          const duration = expiresAt.getTime() - Date.now();

          timeoutList.push({
            userId: member.id,
            username: member.user.username,
            reason: 'Unknown', // Discord doesn't store timeout reason in API
            appliedAt: new Date(Date.now() - duration), // Estimate
            expiresAt,
            appliedBy: 'Unknown',
            duration,
          });
        }
      });

      this.activeTimeouts.set(guild.id, timeoutList);

      logger.info(`Synced server state for ${guild.name}: ${banList.length} bans, ${timeoutList.length} timeouts`);
    } catch (error) {
      logger.error(`Failed to sync server state for ${guild.name}`, error);
    }
  }

  /**
   * Add action to moderation history
   */
  private addToHistory(guildId: string, action: ModerationAction): void {
    if (!this.moderationHistory.has(guildId)) {
      this.moderationHistory.set(guildId, []);
    }

    const history = this.moderationHistory.get(guildId)!;
    history.push(action);

    // Keep only last 100 actions
    if (history.length > 100) {
      history.shift();
    }
  }

  /**
   * Get human-readable time ago
   */
  private getTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  /**
   * Clear all state (for testing/debugging)
   */
  clearAllState(): void {
    this.activeTimeouts.clear();
    this.activeBans.clear();
    this.moderationHistory.clear();
    logger.info('All server state cleared');
  }
}
