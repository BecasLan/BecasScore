/**
 * SAFETY GUARD - Prevent Dangerous/Abusive Commands
 *
 * Safety checks before executing commands:
 * - Prevent bulk actions on mods/admins
 * - Rate limiting
 * - Permission checks
 * - Moderator hierarchy
 * - Dangerous action warnings
 */

import { GuildMember, PermissionFlagsBits, Guild } from 'discord.js';
import { createLogger } from './Logger';

const logger = createLogger('SafetyGuard');

export interface SafetyCheckResult {
  safe: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
  warningMessage?: string;
}

export class SafetyGuard {
  // Rate limiting: track commands per moderator
  private commandCounts: Map<string, { count: number; resetAt: number }> = new Map();
  private readonly MAX_COMMANDS_PER_MINUTE = 10;
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute

  /**
   * Check if command execution is safe
   */
  async checkSafety(
    executor: GuildMember,
    intent: string,
    parameters: { [key: string]: any },
    guild: Guild
  ): Promise<SafetyCheckResult> {
    // 1. Rate limiting check
    const rateLimitCheck = this.checkRateLimit(executor.id);
    if (!rateLimitCheck.safe) {
      return rateLimitCheck;
    }

    // 2. Permission check
    const permissionCheck = this.checkPermissions(executor, intent);
    if (!permissionCheck.safe) {
      return permissionCheck;
    }

    // 3. Target safety check (if targeting a user)
    if (parameters.target) {
      const targetCheck = await this.checkTargetSafety(
        executor,
        parameters.target,
        intent,
        guild
      );
      if (!targetCheck.safe) {
        return targetCheck;
      }
    }

    // 4. Bulk action safety
    if (parameters.bulk && Array.isArray(parameters.userIds)) {
      const bulkCheck = await this.checkBulkActionSafety(
        executor,
        parameters.userIds,
        intent,
        guild
      );
      if (!bulkCheck.safe) {
        return bulkCheck;
      }
    }

    // 5. Destructive action check
    const destructiveCheck = this.checkDestructiveAction(intent, parameters);
    if (destructiveCheck.requiresConfirmation) {
      return destructiveCheck;
    }

    // All checks passed
    return { safe: true };
  }

  /**
   * Check rate limiting (max 10 commands per minute)
   */
  private checkRateLimit(moderatorId: string): SafetyCheckResult {
    const now = Date.now();
    const record = this.commandCounts.get(moderatorId);

    if (!record || now > record.resetAt) {
      // Create new record or reset
      this.commandCounts.set(moderatorId, {
        count: 1,
        resetAt: now + this.RATE_LIMIT_WINDOW
      });
      return { safe: true };
    }

    // Increment count
    record.count++;

    if (record.count > this.MAX_COMMANDS_PER_MINUTE) {
      const secondsLeft = Math.ceil((record.resetAt - now) / 1000);
      return {
        safe: false,
        reason: `Rate limit exceeded. Please wait ${secondsLeft} seconds.`
      };
    }

    return { safe: true };
  }

  /**
   * Check if executor has required permissions
   */
  private checkPermissions(executor: GuildMember, intent: string): SafetyCheckResult {
    const requiredPermissions = this.getRequiredPermissions(intent);

    for (const permission of requiredPermissions) {
      if (!executor.permissions.has(permission)) {
        return {
          safe: false,
          reason: `You don't have permission to ${intent}. Required: ${permission}`
        };
      }
    }

    return { safe: true };
  }

  /**
   * Check if target user is safe to moderate (hierarchy check)
   */
  private async checkTargetSafety(
    executor: GuildMember,
    targetId: string,
    intent: string,
    guild: Guild
  ): Promise<SafetyCheckResult> {
    try {
      const target = await guild.members.fetch(targetId);

      // 1. Can't target server owner
      if (target.id === guild.ownerId) {
        return {
          safe: false,
          reason: 'Cannot target server owner.'
        };
      }

      // 2. Check role hierarchy
      if (target.roles.highest.position >= executor.roles.highest.position) {
        return {
          safe: false,
          reason: 'Cannot target users with equal or higher roles.'
        };
      }

      // 3. Warn if targeting moderator/admin
      if (target.permissions.has(PermissionFlagsBits.ModerateMembers) ||
          target.permissions.has(PermissionFlagsBits.Administrator)) {
        return {
          safe: true,
          requiresConfirmation: true,
          warningMessage: `⚠️ WARNING: Targeting a moderator/admin (${target.user.username}). Are you sure?`
        };
      }

      return { safe: true };

    } catch (error) {
      logger.error('Failed to fetch target member', error);
      return {
        safe: false,
        reason: 'Could not verify target user.'
      };
    }
  }

  /**
   * Check bulk action safety
   */
  private async checkBulkActionSafety(
    executor: GuildMember,
    userIds: string[],
    intent: string,
    guild: Guild
  ): Promise<SafetyCheckResult> {
    // 1. Check count limit
    if (userIds.length > 50) {
      return {
        safe: false,
        reason: 'Bulk action limit exceeded. Maximum 50 users at once.'
      };
    }

    // 2. Check if any targets are protected (owner, higher roles, etc.)
    const protectedUsers: string[] = [];

    for (const userId of userIds) {
      try {
        const target = await guild.members.fetch(userId);

        // Check if owner
        if (target.id === guild.ownerId) {
          protectedUsers.push(target.user.username + ' (Owner)');
          continue;
        }

        // Check hierarchy
        if (target.roles.highest.position >= executor.roles.highest.position) {
          protectedUsers.push(target.user.username + ' (Higher role)');
        }
      } catch (error) {
        // User not found, skip
      }
    }

    if (protectedUsers.length > 0) {
      return {
        safe: false,
        reason: `Cannot target protected users: ${protectedUsers.join(', ')}`
      };
    }

    // 3. Require confirmation for bulk actions
    if (userIds.length > 5) {
      return {
        safe: true,
        requiresConfirmation: true,
        warningMessage: `⚠️ BULK ACTION: This will affect ${userIds.length} users. Confirm?`
      };
    }

    return { safe: true };
  }

  /**
   * Check if action is destructive and requires confirmation
   */
  private checkDestructiveAction(
    intent: string,
    parameters: { [key: string]: any }
  ): SafetyCheckResult {
    // Ban always requires confirmation
    if (intent === 'ban') {
      return {
        safe: true,
        requiresConfirmation: true,
        warningMessage: '🚨 BAN: This is permanent. Confirm?'
      };
    }

    // Kick requires confirmation
    if (intent === 'kick') {
      return {
        safe: true,
        requiresConfirmation: true,
        warningMessage: '⚠️ KICK: User will be removed. Confirm?'
      };
    }

    // Long timeouts (> 24h) require confirmation
    if (intent === 'timeout' && parameters.duration) {
      const durationMs = this.parseDuration(parameters.duration);
      if (durationMs && durationMs > 86400000) { // 24 hours
        return {
          safe: true,
          requiresConfirmation: true,
          warningMessage: `⚠️ LONG TIMEOUT: ${this.formatDuration(durationMs)}. Confirm?`
        };
      }
    }

    // Bulk delete (>10 messages)
    if (intent === 'delete' && parameters.count > 10) {
      return {
        safe: true,
        requiresConfirmation: true,
        warningMessage: `⚠️ BULK DELETE: ${parameters.count} messages. Confirm?`
      };
    }

    return { safe: true };
  }

  /**
   * Get required permissions for an intent
   */
  private getRequiredPermissions(intent: string): bigint[] {
    switch (intent) {
      case 'ban':
        return [PermissionFlagsBits.BanMembers];

      case 'kick':
        return [PermissionFlagsBits.KickMembers];

      case 'timeout':
      case 'warn':
        return [PermissionFlagsBits.ModerateMembers];

      case 'delete':
        return [PermissionFlagsBits.ManageMessages];

      case 'slowmode':
      case 'lock':
      case 'unlock':
        return [PermissionFlagsBits.ManageChannels];

      case 'role_add':
      case 'role_remove':
        return [PermissionFlagsBits.ManageRoles];

      default:
        return [];
    }
  }

  /**
   * Parse duration string to milliseconds
   */
  private parseDuration(duration: string): number | null {
    if (duration.endsWith('ms')) {
      return parseInt(duration);
    }

    const match = duration.match(/(\d+)([smhd])/);
    if (!match) return null;

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60000;
      case 'h': return value * 3600000;
      case 'd': return value * 86400000;
      default: return null;
    }
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  /**
   * Record command execution (for audit trail)
   */
  logExecution(
    moderatorId: string,
    intent: string,
    parameters: { [key: string]: any },
    success: boolean
  ): void {
    logger.info('Command executed', {
      moderatorId,
      intent,
      parameters,
      success,
      timestamp: new Date().toISOString()
    });
  }
}
