/**
 * BAN TOOL
 *
 * Permanently bans a user from the server.
 * Integrates with TrustScoreEngine and V3Integration for tracking.
 */

import { BecasTool, BecasContext, BecasToolResult, BecasMissingParam } from '../../types/BecasFlow.types';
import { PermissionFlagsBits } from 'discord.js';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('BanTool');

export const banTool: BecasTool = {
  name: 'ban',
  description: 'Ban a user from the server permanently',
  category: 'moderation',

  parameters: {
    userId: {
      type: 'userId',
      description: 'The ID of the user to ban',
      required: true,
    },
    reason: {
      type: 'string',
      description: 'Reason for the ban',
      required: false,
      default: 'No reason provided',
    },
    deleteMessageDays: {
      type: 'number',
      description: 'Number of days of messages to delete (0-7)',
      required: false,
      default: 1,
    },
  },

  detectMissing: (params: any, context: BecasContext): BecasMissingParam | null => {
    // Check if userId is missing
    if (!params.userId) {
      // Check if we can resolve from context
      if (context.lastUsers && context.lastUsers.length > 0) {
        // Auto-resolve if only one user
        if (context.lastUsers.length === 1) {
          params.userId = context.lastUsers[0];
          return null;
        }

        // Multiple users - ask which one
        return {
          param: 'userId',
          prompt: 'Which user would you like to ban?',
          type: 'select',
          options: context.lastUsers.map((id) => ({
            label: id,
            value: id,
          })),
        };
      }

      return {
        param: 'userId',
        prompt: 'Enter the user ID or @mention the user to ban',
        type: 'text',
      };
    }

    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      const { userId, reason, deleteMessageDays } = params;

      logger.info(`Attempting to ban user ${userId} in ${context.guild.name}`);

      // Permission check
      if (!context.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return {
          success: false,
          error: 'You do not have permission to ban members',
        };
      }

      // Get member to ban
      let memberToBan;
      try {
        memberToBan = await context.guild.members.fetch(userId);
      } catch (error) {
        // User might not be in server - can still ban by ID
        logger.warn(`User ${userId} not in server, banning by ID`);
      }

      // Check if target is bannable
      if (memberToBan) {
        if (!memberToBan.bannable) {
          return {
            success: false,
            error: 'Cannot ban this user (they may have higher permissions)',
          };
        }

        // Check role hierarchy
        if (context.member.roles.highest.position <= memberToBan.roles.highest.position) {
          return {
            success: false,
            error: 'Cannot ban this user (role hierarchy)',
          };
        }
      }

      // Execute ban
      await context.guild.members.ban(userId, {
        reason: `${reason} | By: ${context.member.user.tag}`,
        deleteMessageSeconds: Math.min(Math.max(deleteMessageDays || 1, 0), 7) * 24 * 60 * 60,
      });

      logger.info(`Successfully banned user ${userId}`);

      // Update trust score to 0 (permanent)
      if (context.services.trustEngine) {
        try {
          const trustScore = context.services.trustEngine.getTrustScore(userId, context.guild.id);
          context.services.trustEngine.updateTrustScore(
            userId,
            context.guild.id,
            {
              action: 'ban',
              impact: -trustScore.score, // Set to 0
              reason,
              moderator: context.member.user.tag,
            }
          );
        } catch (error) {
          logger.warn('Failed to update trust score:', error);
        }
      }

      // Record to V3 integration
      if (context.services.v3Integration) {
        try {
          await context.services.v3Integration.recordAction({
            type: 'ban',
            targetUserId: userId,
            targetUsername: memberToBan?.user.tag || userId,
            executedBy: context.member.id,
            executedByName: context.member.user.tag,
            reason,
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
          username: memberToBan?.user.tag || userId,
          reason,
          deleteMessageDays,
          executedBy: context.member.user.tag,
          executedAt: new Date().toISOString(),
        },
        metadata: {
          executionTime,
          affectedUsers: [userId],
          nextSuggestedTool: 'trust_report',
        },
      };
    } catch (error) {
      logger.error('Error executing ban:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  canChainTo: ['trust_report', 'moderation_history', 'delete_messages'],
  requiresConfirmation: true,
  confirmationMessage: (params) =>
    `Ban user <@${params.userId}>?\nReason: ${params.reason || 'No reason'}\nDelete messages: ${params.deleteMessageDays || 1} days`,

  preconditions: [
    {
      type: 'custom',
      field: 'member',
      customFn: (context) => context.member.permissions.has(PermissionFlagsBits.BanMembers),
      message: 'User must have BAN_MEMBERS permission',
    },
  ],
};
