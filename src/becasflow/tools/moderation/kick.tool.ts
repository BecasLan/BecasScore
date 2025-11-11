/**
 * KICK TOOL
 *
 * Kicks a user from the server (they can rejoin).
 */

import { BecasTool, BecasContext, BecasToolResult, BecasMissingParam } from '../../types/BecasFlow.types';
import { PermissionFlagsBits } from 'discord.js';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('KickTool');

export const kickTool: BecasTool = {
  name: 'kick',
  description: 'Kick a user from the server (they can rejoin)',
  category: 'moderation',

  parameters: {
    userId: {
      type: 'userId',
      description: 'The ID of the user to kick',
      required: true,
    },
    reason: {
      type: 'string',
      description: 'Reason for the kick',
      required: false,
      default: 'No reason provided',
    },
  },

  detectMissing: (params: any, context: BecasContext): BecasMissingParam | null => {
    if (!params.userId) {
      if (context.lastUsers && context.lastUsers.length === 1) {
        params.userId = context.lastUsers[0];
        return null;
      } else if (context.lastUsers && context.lastUsers.length > 1) {
        return {
          param: 'userId',
          prompt: 'Which user would you like to kick?',
          type: 'select',
          options: context.lastUsers.map((id) => ({
            label: id,
            value: id,
          })),
        };
      }

      return {
        param: 'userId',
        prompt: 'Enter the user ID or @mention the user to kick',
        type: 'text',
      };
    }

    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      const { userId, reason } = params;

      logger.info(`Attempting to kick user ${userId}`);

      // Permission check
      if (!context.member.permissions.has(PermissionFlagsBits.KickMembers)) {
        return {
          success: false,
          error: 'You do not have permission to kick members',
        };
      }

      // Get member
      let member;
      try {
        member = await context.guild.members.fetch(userId);
      } catch (error) {
        return {
          success: false,
          error: 'User not found in this server',
        };
      }

      // Check if target is kickable
      if (!member.kickable) {
        return {
          success: false,
          error: 'Cannot kick this user (they may have higher permissions)',
        };
      }

      // Check role hierarchy
      if (context.member.roles.highest.position <= member.roles.highest.position) {
        return {
          success: false,
          error: 'Cannot kick this user (role hierarchy)',
        };
      }

      // Execute kick
      await member.kick(`${reason} | By: ${context.member.user.tag}`);

      logger.info(`Successfully kicked user ${userId}`);

      // Update trust score
      if (context.services.trustEngine) {
        try {
          context.services.trustEngine.updateTrustScore(
            userId,
            context.guild.id,
            {
              action: 'kick',
              impact: -3,
              reason,
              moderator: context.member.user.tag,
            }
          );
        } catch (error) {
          logger.warn('Failed to update trust score:', error);
        }
      }

      // Record to V3
      if (context.services.v3Integration) {
        try {
          await context.services.v3Integration.recordAction({
            type: 'kick',
            targetUserId: userId,
            targetUsername: member.user.tag,
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
          username: member.user.tag,
          reason,
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
      logger.error('Error executing kick:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  canChainTo: ['trust_report', 'moderation_history'],
  requiresConfirmation: true,
  confirmationMessage: (params) =>
    `Kick user <@${params.userId}>?\nReason: ${params.reason || 'No reason'}`,

  preconditions: [
    {
      type: 'custom',
      field: 'member',
      customFn: (context) => context.member.permissions.has(PermissionFlagsBits.KickMembers),
      message: 'User must have KICK_MEMBERS permission',
    },
  ],
};
