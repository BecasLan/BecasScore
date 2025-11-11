/**
 * TIMEOUT TOOL
 *
 * Temporarily times out a user (mute them for a duration).
 * Duration can be specified or selected from common options.
 */

import { BecasTool, BecasContext, BecasToolResult, BecasMissingParam } from '../../types/BecasFlow.types';
import { PermissionFlagsBits } from 'discord.js';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('TimeoutTool');

export const timeoutTool: BecasTool = {
  name: 'timeout',
  description: 'Timeout (mute) a user for a specified duration',
  category: 'moderation',

  parameters: {
    userId: {
      type: 'userId',
      description: 'The ID of the user to timeout',
      required: true,
    },
    duration: {
      type: 'number',
      description: 'Duration in milliseconds (max 28 days)',
      required: true,
    },
    reason: {
      type: 'string',
      description: 'Reason for the timeout',
      required: false,
      default: 'No reason provided',
    },
  },

  detectMissing: (params: any, context: BecasContext): BecasMissingParam | null => {
    // Check userId
    if (!params.userId) {
      if (context.lastUsers && context.lastUsers.length === 1) {
        params.userId = context.lastUsers[0];
      } else if (context.lastUsers && context.lastUsers.length > 1) {
        return {
          param: 'userId',
          prompt: 'Which user would you like to timeout?',
          type: 'select',
          options: context.lastUsers.map((id) => ({
            label: id,
            value: id,
          })),
        };
      } else {
        return {
          param: 'userId',
          prompt: 'Enter the user ID or @mention the user to timeout',
          type: 'text',
        };
      }
    }

    // Check duration
    if (!params.duration) {
      return {
        param: 'duration',
        prompt: 'Select timeout duration',
        type: 'select',
        options: [
          { label: '5 minutes', value: 5 * 60 * 1000 },
          { label: '10 minutes', value: 10 * 60 * 1000 },
          { label: '30 minutes', value: 30 * 60 * 1000 },
          { label: '1 hour', value: 60 * 60 * 1000 },
          { label: '6 hours', value: 6 * 60 * 60 * 1000 },
          { label: '12 hours', value: 12 * 60 * 60 * 1000 },
          { label: '1 day', value: 24 * 60 * 60 * 1000 },
          { label: '3 days', value: 3 * 24 * 60 * 60 * 1000 },
          { label: '1 week', value: 7 * 24 * 60 * 60 * 1000 },
        ],
      };
    }

    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      const { userId, duration, reason } = params;

      logger.info(`Attempting to timeout user ${userId} for ${duration}ms`);

      // Permission check
      if (!context.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return {
          success: false,
          error: 'You do not have permission to timeout members',
        };
      }

      // Validate duration (max 28 days)
      const maxDuration = 28 * 24 * 60 * 60 * 1000;
      if (duration > maxDuration) {
        return {
          success: false,
          error: `Duration cannot exceed 28 days (${maxDuration}ms)`,
        };
      }

      if (duration < 1000) {
        return {
          success: false,
          error: 'Duration must be at least 1 second',
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

      // Check if target is moderatable
      if (!member.moderatable) {
        return {
          success: false,
          error: 'Cannot timeout this user (they may have higher permissions)',
        };
      }

      // Check role hierarchy
      if (context.member.roles.highest.position <= member.roles.highest.position) {
        return {
          success: false,
          error: 'Cannot timeout this user (role hierarchy)',
        };
      }

      // Execute timeout
      await member.timeout(duration, `${reason} | By: ${context.member.user.tag}`);

      logger.info(`Successfully timed out user ${userId}`);

      // Update trust score
      if (context.services.trustEngine) {
        try {
          const impact = Math.min(duration / (24 * 60 * 60 * 1000) * -5, -1); // -1 to -5 based on duration
          context.services.trustEngine.updateTrustScore(
            userId,
            context.guild.id,
            {
              action: 'timeout',
              impact,
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
            type: 'timeout',
            targetUserId: userId,
            targetUsername: member.user.tag,
            executedBy: context.member.id,
            executedByName: context.member.user.tag,
            reason,
            duration,
            guildId: context.guild.id,
            channelId: context.channel.id,
            messageId: context.message.id,
          });
        } catch (error) {
          logger.warn('Failed to record action to V3:', error);
        }
      }

      const executionTime = Date.now() - startTime;

      // Format duration for display
      const durationText = this.formatDuration(duration);

      return {
        success: true,
        data: {
          userId,
          username: member.user.tag,
          duration,
          durationText,
          reason,
          executedBy: context.member.user.tag,
          executedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + duration).toISOString(),
        },
        metadata: {
          executionTime,
          affectedUsers: [userId],
          nextSuggestedTool: 'check_trust',
        },
      };
    } catch (error) {
      logger.error('Error executing timeout:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  canChainTo: ['check_trust', 'warn', 'delete_messages'],
  requiresConfirmation: true,
  confirmationMessage: (params) =>
    `Timeout user <@${params.userId}>?\nDuration: ${(timeoutTool as any).formatDuration(params.duration)}\nReason: ${params.reason || 'No reason'}`,

  preconditions: [
    {
      type: 'custom',
      field: 'member',
      customFn: (context) => context.member.permissions.has(PermissionFlagsBits.ModerateMembers),
      message: 'User must have MODERATE_MEMBERS permission',
    },
  ],
};

// Helper function to format duration
(timeoutTool as any).formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days !== 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
};
