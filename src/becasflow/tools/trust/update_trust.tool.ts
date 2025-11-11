/**
 * UPDATE TRUST TOOL
 *
 * Manually adjusts a user's trust score.
 * Should be used sparingly - most updates happen automatically.
 */

import { BecasTool, BecasContext, BecasToolResult, BecasMissingParam } from '../../types/BecasFlow.types';
import { PermissionFlagsBits } from 'discord.js';
import { createLogger } from '../../../services/Logger';
import { UserRepository } from '../../../database/repositories/UserRepository';
import { SicilRepository } from '../../../database/repositories/SicilRepository';

const logger = createLogger('UpdateTrustTool');
const userRepo = new UserRepository();
const sicilRepo = new SicilRepository();

export const updateTrustTool: BecasTool = {
  name: 'update_trust',
  description: 'Manually update a user\'s trust score',
  category: 'trust',

  parameters: {
    userId: {
      type: 'userId',
      description: 'The ID of the user',
      required: true,
    },
    change: {
      type: 'number',
      description: 'Score change (-100 to +100)',
      required: true,
    },
    reason: {
      type: 'string',
      description: 'Reason for the change',
      required: true,
    },
  },

  detectMissing: (params: any, context: BecasContext): BecasMissingParam | null => {
    if (!params.userId) {
      if (context.lastUsers && context.lastUsers.length === 1) {
        params.userId = context.lastUsers[0];
      } else if (context.lastUsers && context.lastUsers.length > 1) {
        return {
          param: 'userId',
          prompt: 'Which user would you like to update?',
          type: 'select',
          options: context.lastUsers.map((id) => ({
            label: id,
            value: id,
          })),
        };
      } else {
        return {
          param: 'userId',
          prompt: 'Enter the user ID or @mention the user',
          type: 'text',
        };
      }
    }

    if (params.change === undefined || params.change === null) {
      return {
        param: 'change',
        prompt: 'Select trust score change',
        type: 'select',
        options: [
          { label: '+10 (Minor positive)', value: 10, description: 'Small reward' },
          { label: '+5 (Positive)', value: 5, description: 'Good behavior' },
          { label: '+2 (Small positive)', value: 2, description: 'Minor correction' },
          { label: '-2 (Small negative)', value: -2, description: 'Minor violation' },
          { label: '-5 (Negative)', value: -5, description: 'Rule violation' },
          { label: '-10 (Major negative)', value: -10, description: 'Serious violation' },
          { label: '-20 (Severe)', value: -20, description: 'Very serious' },
        ],
      };
    }

    if (!params.reason) {
      return {
        param: 'reason',
        prompt: 'Enter reason for trust score change',
        type: 'text',
      };
    }

    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      const { userId, change, reason } = params;

      logger.info(`Updating trust score for user ${userId} by ${change}`);

      // Permission check - only admins can manually adjust
      if (!context.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return {
          success: false,
          error: 'Only administrators can manually update trust scores',
        };
      }

      // Validate change
      const changeNum = Number(change);
      if (isNaN(changeNum) || changeNum < -100 || changeNum > 100) {
        return {
          success: false,
          error: 'Change must be a number between -100 and +100',
        };
      }

      // Get user from DATABASE
      const dbUser = await userRepo.getUserById(userId);
      if (!dbUser) {
        return {
          success: false,
          error: 'User not found in database',
        };
      }

      // Get member info
      let member;
      try {
        member = await context.guild.members.fetch(userId);
      } catch (error) {
        logger.warn(`User ${userId} not in server, updating trust score anyway`);
      }

      // Get current score from DATABASE (default to 50 if null/undefined)
      const beforeScore = dbUser.global_trust_score ?? 50;

      // Calculate trust level from score
      const getTrustLevel = (score: number): string => {
        if (score >= 80) return 'Verified';
        if (score >= 60) return 'Trusted';
        if (score >= 40) return 'Neutral';
        if (score >= 20) return 'Suspicious';
        return 'Untrusted';
      };

      const beforeLevel = getTrustLevel(beforeScore);

      // Calculate new score (clamp between 0 and 100)
      const newScore = Math.max(0, Math.min(100, beforeScore + changeNum));
      const afterLevel = getTrustLevel(newScore);

      // Update score in DATABASE
      await userRepo.updateGlobalTrustScore(userId, newScore);

      logger.info(`Updated trust score for ${userId}: ${beforeScore} -> ${newScore}`);

      // Record to V3
      if (context.services.v3Integration) {
        try {
          await context.services.v3Integration.recordAction({
            type: 'warn', // Use warn type as closest match
            targetUserId: userId,
            targetUsername: member?.user.tag || userId,
            executedBy: context.member.id,
            executedByName: context.member.user.tag,
            reason: `Trust update: ${reason} (${changeNum >= 0 ? '+' : ''}${changeNum})`,
            guildId: context.guild.id,
            channelId: context.channel.id,
            messageId: context.message.id,
          });
        } catch (error) {
          logger.warn('Failed to record action to V3:', error);
        }
      }

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        data: {
          userId,
          username: member?.user.tag || dbUser.username,
          beforeScore: Math.round(beforeScore),
          afterScore: Math.round(newScore),
          change: changeNum,
          beforeLevel: beforeLevel,
          afterLevel: afterLevel,
          reason,
          updatedBy: context.member.user.tag,
        },
        metadata: {
          executionTime,
          affectedUsers: [userId],
          nextSuggestedTool: 'check_trust',
        },
      };
    } catch (error) {
      logger.error('Error updating trust:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  canChainTo: ['check_trust', 'trust_report'],
  requiresConfirmation: true,
  confirmationMessage: (params) =>
    `Update trust score for <@${params.userId}>?\nChange: ${params.change >= 0 ? '+' : ''}${params.change}\nReason: ${params.reason}`,

  preconditions: [
    {
      type: 'custom',
      field: 'member',
      customFn: (context) => context.member.permissions.has(PermissionFlagsBits.Administrator),
      message: 'User must have ADMINISTRATOR permission',
    },
  ],
};
