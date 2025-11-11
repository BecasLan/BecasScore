// BulkActionSystem.ts - Handle mass moderation actions
// Supports: "timeout all users with trust <50", "ban all spammers", etc.

import { Guild, GuildMember, Collection } from 'discord.js';
import { TrustScoreEngineDB } from './TrustScoreEngineDB';
import { createLogger } from '../services/Logger';

const logger = createLogger('BulkActionSystem');

export interface BulkActionCriteria {
  trustScoreMin?: number;
  trustScoreMax?: number;
  hasRole?: string;
  lacksRole?: string;
  joinedWithinDays?: number;
  hasViolations?: boolean;
  minViolations?: number;
}

export interface BulkActionResult {
  success: boolean;
  affected: number;
  failed: number;
  errors: Array<{ userId: string; error: string }>;
  details: string;
}

export class BulkActionSystem {
  private trustEngine: TrustScoreEngineDB;

  constructor(trustEngine: TrustScoreEngineDB) {
    this.trustEngine = trustEngine;
  }

  /**
   * Filter members by criteria
   */
  async filterMembers(
    guild: Guild,
    criteria: BulkActionCriteria,
    excludeIds: string[] = []
  ): Promise<GuildMember[]> {
    // Fetch all members
    await guild.members.fetch();
    const allMembers = Array.from(guild.members.cache.values());

    const filtered: GuildMember[] = [];

    for (const member of allMembers) {
      // Skip bots
      if (member.user.bot) continue;

      // Skip excluded IDs
      if (excludeIds.includes(member.id)) continue;

      // Check trust score
      if (criteria.trustScoreMin !== undefined || criteria.trustScoreMax !== undefined) {
        const trust = await this.trustEngine.getTrustScore(member.id, guild.id);

        if (criteria.trustScoreMin !== undefined && trust.score < criteria.trustScoreMin) {
          continue;
        }

        if (criteria.trustScoreMax !== undefined && trust.score > criteria.trustScoreMax) {
          continue;
        }
      }

      // Check role requirement
      if (criteria.hasRole) {
        const hasRole = member.roles.cache.some(role =>
          role.name.toLowerCase().includes(criteria.hasRole!.toLowerCase())
        );
        if (!hasRole) continue;
      }

      // Check role exclusion
      if (criteria.lacksRole) {
        const hasRole = member.roles.cache.some(role =>
          role.name.toLowerCase().includes(criteria.lacksRole!.toLowerCase())
        );
        if (hasRole) continue;
      }

      // Check join date
      if (criteria.joinedWithinDays !== undefined) {
        const joinDate = member.joinedAt;
        if (!joinDate) continue;

        const daysSinceJoin = (Date.now() - joinDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceJoin > criteria.joinedWithinDays) {
          continue;
        }
      }

      // Check violations
      if (criteria.hasViolations !== undefined || criteria.minViolations !== undefined) {
        const trust = await this.trustEngine.getTrustScore(member.id, guild.id);
        const violations = trust.history.filter(h => h.delta < 0).length;

        if (criteria.hasViolations && violations === 0) {
          continue;
        }

        if (criteria.minViolations !== undefined && violations < criteria.minViolations) {
          continue;
        }
      }

      filtered.push(member);
    }

    return filtered;
  }

  /**
   * Timeout multiple users
   */
  async bulkTimeout(
    guild: Guild,
    criteria: BulkActionCriteria,
    durationMinutes: number,
    reason: string,
    moderatorId: string
  ): Promise<BulkActionResult> {
    logger.info(`🔨 Bulk timeout requested: criteria=${JSON.stringify(criteria)}, duration=${durationMinutes}min`);

    // Get members matching criteria
    const members = await this.filterMembers(guild, criteria, [moderatorId, guild.ownerId]);

    if (members.length === 0) {
      return {
        success: false,
        affected: 0,
        failed: 0,
        errors: [],
        details: 'No members match the criteria',
      };
    }

    logger.info(`   Found ${members.length} members matching criteria`);

    // Apply timeout to each
    const errors: Array<{ userId: string; error: string }> = [];
    let affected = 0;

    const durationMs = durationMinutes * 60 * 1000;

    for (const member of members) {
      try {
        if (member.moderatable) {
          await member.timeout(durationMs, reason);
          affected++;
          logger.info(`   ✓ Timed out ${member.user.tag}`);

          // Update trust score
          await this.trustEngine.modifyTrust(
            member.id,
            guild.id,
            -15,
            `Bulk moderation action - Bulk timeout: ${reason}`
          );
        } else {
          errors.push({
            userId: member.id,
            error: 'User not moderatable (higher role or permissions)',
          });
        }
      } catch (error: any) {
        errors.push({
          userId: member.id,
          error: error.message || 'Unknown error',
        });
        logger.error(`   ✗ Failed to timeout ${member.user.tag}:`, error);
      }
    }

    const result = {
      success: affected > 0,
      affected,
      failed: errors.length,
      errors,
      details: `Timed out ${affected}/${members.length} members for ${durationMinutes} minutes`,
    };

    logger.info(`✅ Bulk timeout complete: ${affected} affected, ${errors.length} failed`);

    return result;
  }

  /**
   * Kick multiple users
   */
  async bulkKick(
    guild: Guild,
    criteria: BulkActionCriteria,
    reason: string,
    moderatorId: string
  ): Promise<BulkActionResult> {
    logger.info(`👢 Bulk kick requested: criteria=${JSON.stringify(criteria)}`);

    const members = await this.filterMembers(guild, criteria, [moderatorId, guild.ownerId]);

    if (members.length === 0) {
      return {
        success: false,
        affected: 0,
        failed: 0,
        errors: [],
        details: 'No members match the criteria',
      };
    }

    const errors: Array<{ userId: string; error: string }> = [];
    let affected = 0;

    for (const member of members) {
      try {
        if (member.kickable) {
          await member.kick(reason);
          affected++;
          logger.info(`   ✓ Kicked ${member.user.tag}`);

          // Update trust score
          await this.trustEngine.modifyTrust(
            member.id,
            guild.id,
            -30,
            `Bulk moderation action - Bulk kick: ${reason}`
          );
        } else {
          errors.push({
            userId: member.id,
            error: 'User not kickable',
          });
        }
      } catch (error: any) {
        errors.push({
          userId: member.id,
          error: error.message || 'Unknown error',
        });
      }
    }

    return {
      success: affected > 0,
      affected,
      failed: errors.length,
      errors,
      details: `Kicked ${affected}/${members.length} members`,
    };
  }

  /**
   * Ban multiple users
   */
  async bulkBan(
    guild: Guild,
    criteria: BulkActionCriteria,
    reason: string,
    moderatorId: string
  ): Promise<BulkActionResult> {
    logger.info(`🚫 Bulk ban requested: criteria=${JSON.stringify(criteria)}`);

    const members = await this.filterMembers(guild, criteria, [moderatorId, guild.ownerId]);

    if (members.length === 0) {
      return {
        success: false,
        affected: 0,
        failed: 0,
        errors: [],
        details: 'No members match the criteria',
      };
    }

    const errors: Array<{ userId: string; error: string }> = [];
    let affected = 0;

    for (const member of members) {
      try {
        if (member.bannable) {
          await member.ban({ reason });
          affected++;
          logger.info(`   ✓ Banned ${member.user.tag}`);

          // Update trust score
          await this.trustEngine.modifyTrust(
            member.id,
            guild.id,
            -50,
            `Bulk moderation action - Bulk ban: ${reason}`
          );
        } else {
          errors.push({
            userId: member.id,
            error: 'User not bannable',
          });
        }
      } catch (error: any) {
        errors.push({
          userId: member.id,
          error: error.message || 'Unknown error',
        });
      }
    }

    return {
      success: affected > 0,
      affected,
      failed: errors.length,
      errors,
      details: `Banned ${affected}/${members.length} members`,
    };
  }

  /**
   * Preview what a bulk action would affect
   */
  async preview(
    guild: Guild,
    criteria: BulkActionCriteria,
    moderatorId: string
  ): Promise<{
    count: number;
    members: Array<{ id: string; tag: string; trustScore: number; violations: number }>;
  }> {
    const members = await this.filterMembers(guild, criteria, [moderatorId, guild.ownerId]);

    const details = await Promise.all(members.map(async (member) => {
      const trust = await this.trustEngine.getTrustScore(member.id, guild.id);
      const violations = trust.history.filter(h => h.delta < 0).length;

      return {
        id: member.id,
        tag: member.user.tag,
        trustScore: trust.score,
        violations,
      };
    }));

    return {
      count: members.length,
      members: details,
    };
  }
}
