import { Client, Guild, GuildMember, TextChannel } from 'discord.js';
import { ModerationAction } from '../types/Response.types';
import { AnalyticsManager } from '../analytics/AnalyticsManager';
import type { BecasDatabaseIntegration } from '../database/BecasDatabaseIntegration';

export class ModerationHandler {
  private client: Client;
  private actionLog: Map<string, ModerationAction[]> = new Map();
  private analytics?: AnalyticsManager;
  private dbIntegration?: BecasDatabaseIntegration;

  constructor(client: Client, analytics?: AnalyticsManager) {
    this.client = client;
    this.analytics = analytics;
  }

  /**
   * Set analytics manager (for late initialization)
   */
  setAnalytics(analytics: AnalyticsManager): void {
    this.analytics = analytics;
  }

  /**
   * Set database integration (for late initialization)
   */
  setDatabaseIntegration(dbIntegration: BecasDatabaseIntegration): void {
    this.dbIntegration = dbIntegration;
  }

  /**
   * Execute a moderation action
   */
  async executeAction(
    action: ModerationAction | { type: string; duration?: number; severity?: number },
    targetUserId: string,
    guild: Guild,
    reason: string
  ): Promise<boolean> {
    try {
      const member = await guild.members.fetch(targetUserId);
      if (!member) {
        console.error(`Could not find member ${targetUserId}`);
        return false;
      }

      // Check if bot has permission
      const botMember = guild.members.me;
      if (!botMember) return false;

      let success = false;

      switch (action.type) {
        case 'warn':
          success = await this.warnUser(member, reason);
          break;

        case 'timeout':
          success = await this.timeoutUser(member, action.duration || 600000, reason);
          break;

        case 'ban':
          success = await this.banUser(member, reason);
          break;

        case 'role_change':
          // Implement role changes if needed
          success = true;
          break;

        default:
          console.warn(`Unknown action type: ${action.type}`);
      }

      if (success) {
        this.logAction(targetUserId, {
          type: action.type as any,
          target: targetUserId,
          reason,
          reversible: true,
        });

        // 🔥 CRITICAL: Record AI-generated moderation action to database
        if (this.dbIntegration && (action.type === 'warn' || action.type === 'timeout' || action.type === 'kick' || action.type === 'ban')) {
          try {
            await this.dbIntegration.processModerationAction(
              guild.id,
              targetUserId,
              action.type as 'warn' | 'timeout' | 'kick' | 'ban',
              reason,
              this.client.user!.id // Bot is the moderator (AI decision)
            );
            console.log(`💾 AI moderation action recorded to database: ${action.type} for ${targetUserId}`);
          } catch (error) {
            console.error('Failed to record AI moderation action to database:', error);
            // Don't throw - action was successful, just logging failed
          }
        }
      }

      return success;
    } catch (error) {
      console.error('Error executing moderation action:', error);
      return false;
    }
  }

  /**
   * Warn a user (DM)
   */
  private async warnUser(member: GuildMember, reason: string): Promise<boolean> {
    try {
      await member.send(`⚠️ **Warning from Becas**\n\n${reason}\n\nPlease adjust your behavior. I'm here to help maintain a healthy community.`);
      console.log(`Warned ${member.user.tag}: ${reason}`);

      // Track analytics
      if (this.analytics) {
        await this.analytics.trackEvent({
          guildId: member.guild.id,
          type: 'warn',
          actorId: this.client.user?.id, // Bot as actor
          targetId: member.id,
          reason,
          severity: 0.3,
          sentiment: 'negative',
        });
      }

      return true;
    } catch (error) {
      console.error(`Could not DM ${member.user.tag}:`, error);
      // Even if DM fails, log the warning
      return true;
    }
  }

  /**
   * Timeout a user
   */
  private async timeoutUser(member: GuildMember, duration: number, reason: string): Promise<boolean> {
    try {
      // Check permissions
      if (!member.moderatable) {
        console.error(`Cannot timeout ${member.user.tag}: insufficient permissions`);
        return false;
      }

      await member.timeout(duration, reason);

      // Try to notify user
      try {
        await member.send(`⏸️ **Timeout Applied**\n\nDuration: ${this.formatDuration(duration)}\nReason: ${reason}\n\nUse this time to reflect. You'll be able to participate again soon.`);
      } catch {
        // DM failed, but timeout was successful
      }

      console.log(`Timed out ${member.user.tag} for ${this.formatDuration(duration)}: ${reason}`);

      // Track analytics
      if (this.analytics) {
        await this.analytics.trackEvent({
          guildId: member.guild.id,
          type: 'timeout',
          actorId: this.client.user?.id,
          targetId: member.id,
          reason,
          severity: 0.5,
          sentiment: 'negative',
          metadata: { duration },
        });
      }

      return true;
    } catch (error) {
      console.error(`Could not timeout ${member.user.tag}:`, error);
      return false;
    }
  }

  /**
   * Ban a user
   */
  private async banUser(member: GuildMember, reason: string): Promise<boolean> {
    try {
      // Check permissions
      if (!member.bannable) {
        console.error(`Cannot ban ${member.user.tag}: insufficient permissions`);
        return false;
      }

      // Try to notify user before ban
      try {
        await member.send(`🚫 **Ban Notice**\n\nYou have been removed from ${member.guild.name}.\n\nReason: ${reason}\n\nIf you believe this was a mistake, please contact the server administrators.`);
      } catch {
        // DM failed, proceed with ban anyway
      }

      await member.ban({ reason, deleteMessageSeconds: 86400 }); // Delete last day of messages
      console.log(`Banned ${member.user.tag}: ${reason}`);

      // Track analytics
      if (this.analytics) {
        await this.analytics.trackEvent({
          guildId: member.guild.id,
          type: 'ban',
          actorId: this.client.user?.id,
          targetId: member.id,
          reason,
          severity: 1.0, // Most severe
          sentiment: 'negative',
        });
      }

      return true;
    } catch (error) {
      console.error(`Could not ban ${member.user.tag}:`, error);
      return false;
    }
  }

  /**
   * Unban a user
   */
  async unbanUser(userId: string, guild: Guild, reason: string): Promise<boolean> {
    try {
      await guild.members.unban(userId, reason);
      console.log(`Unbanned ${userId}: ${reason}`);
      return true;
    } catch (error) {
      console.error(`Could not unban ${userId}:`, error);
      return false;
    }
  }

  /**
   * Remove timeout from user
   */
  async removeTimeout(member: GuildMember): Promise<boolean> {
    try {
      await member.timeout(null);
      console.log(`Removed timeout from ${member.user.tag}`);
      return true;
    } catch (error) {
      console.error(`Could not remove timeout from ${member.user.tag}:`, error);
      return false;
    }
  }

  /**
   * Log action
   */
  private logAction(userId: string, action: ModerationAction): void {
    if (!this.actionLog.has(userId)) {
      this.actionLog.set(userId, []);
    }
    this.actionLog.get(userId)!.push(action);

    // Keep only last 50 actions per user
    const actions = this.actionLog.get(userId)!;
    if (actions.length > 50) {
      this.actionLog.set(userId, actions.slice(-50));
    }
  }

  /**
   * Get action history for user
   */
  getActionHistory(userId: string): ModerationAction[] {
    return this.actionLog.get(userId) || [];
  }

  /**
   * Format duration for human reading
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    return `${seconds} second${seconds > 1 ? 's' : ''}`;
  }

  /**
   * Check if user has recent actions
   */
  hasRecentActions(userId: string, withinMs: number = 3600000): boolean {
    const actions = this.getActionHistory(userId);
    if (actions.length === 0) return false;

    // This would need timestamp tracking in ModerationAction type
    // For now, simplified check
    return actions.length > 0;
  }
}