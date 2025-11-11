/**
 * WARN TOOL
 *
 * Issues a warning to a user and records it in the system.
 * Warnings are tracked and can trigger automated actions.
 */

import { BecasTool, BecasContext, BecasToolResult, BecasMissingParam } from '../../types/BecasFlow.types';
import { PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('WarnTool');

export const warnTool: BecasTool = {
  name: 'warn',
  description: 'Issue a warning to a user and record it',
  category: 'moderation',

  parameters: {
    userId: {
      type: 'userId',
      description: 'The ID of the user to warn',
      required: true,
    },
    reason: {
      type: 'string',
      description: 'Reason for the warning',
      required: true,
    },
    severity: {
      type: 'string',
      description: 'Severity of the warning',
      required: false,
      default: 'medium',
      enum: ['low', 'medium', 'high'],
    },
    dmUser: {
      type: 'boolean',
      description: 'Send DM to user about warning',
      required: false,
      default: true,
    },
  },

  detectMissing: (params: any, context: BecasContext): BecasMissingParam | null => {
    if (!params.userId) {
      if (context.lastUsers && context.lastUsers.length === 1) {
        params.userId = context.lastUsers[0];
      } else if (context.lastUsers && context.lastUsers.length > 1) {
        return {
          param: 'userId',
          prompt: 'Which user would you like to warn?',
          type: 'select',
          options: context.lastUsers.map((id) => ({
            label: id,
            value: id,
          })),
        };
      } else {
        return {
          param: 'userId',
          prompt: 'Enter the user ID or @mention the user to warn',
          type: 'text',
        };
      }
    }

    if (!params.reason) {
      return {
        param: 'reason',
        prompt: 'Enter the reason for this warning',
        type: 'text',
      };
    }

    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      const { userId, reason, severity, dmUser } = params;

      logger.info(`Issuing warning to user ${userId}`);

      // Permission check (moderators can warn)
      if (!context.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return {
          success: false,
          error: 'You do not have permission to warn members',
        };
      }

      // Get member
      let member;
      try {
        member = await context.guild.members.fetch(userId);
      } catch (error) {
        logger.warn(`User ${userId} not in server, recording warning anyway`);
      }

      // Create warning record
      const warningData = {
        userId,
        username: member?.user.tag || userId,
        guildId: context.guild.id,
        reason,
        severity: severity || 'medium',
        issuedBy: context.member.id,
        issuedByName: context.member.user.tag,
        timestamp: new Date().toISOString(),
        channelId: context.channel.id,
        messageId: context.message.id,
      };

      // Record to V3
      if (context.services.v3Integration) {
        try {
          await context.services.v3Integration.recordAction({
            type: 'warn',
            targetUserId: userId,
            targetUsername: member?.user.tag || userId,
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

      // Update trust score
      const trustImpact = severity === 'high' ? -2 : severity === 'medium' ? -1 : -0.5;
      if (context.services.trustEngine) {
        try {
          context.services.trustEngine.updateTrustScore(
            userId,
            context.guild.id,
            {
              action: 'warn',
              impact: trustImpact,
              reason,
              moderator: context.member.user.tag,
            }
          );
        } catch (error) {
          logger.warn('Failed to update trust score:', error);
        }
      }

      // Send DM to user if requested
      let dmSent = false;
      if (dmUser && member) {
        try {
          const embed = new EmbedBuilder()
            .setColor(severity === 'high' ? 0xff0000 : severity === 'medium' ? 0xff9900 : 0xffff00)
            .setTitle(`⚠️ Warning from ${context.guild.name}`)
            .setDescription(`You have received a ${severity} severity warning.`)
            .addFields(
              { name: 'Reason', value: reason },
              { name: 'Issued by', value: context.member.user.tag },
              { name: 'Date', value: new Date().toLocaleString() }
            )
            .setFooter({ text: 'Please review and follow server rules' })
            .setTimestamp();

          await member.send({ embeds: [embed] });
          dmSent = true;
          logger.info(`Sent warning DM to user ${userId}`);
        } catch (error) {
          logger.warn(`Failed to send DM to user ${userId}:`, error);
        }
      }

      const executionTime = Date.now() - startTime;

      // Get total warning count for this user
      let totalWarnings = 1;
      if (context.services.unifiedMemory) {
        try {
          const userWarnings = await context.services.unifiedMemory.query({
            type: 'action',
            guildId: context.guild.id,
            filters: [
              { field: 'data.type', operator: 'equals', value: 'warn' },
              { field: 'data.targetUserId', operator: 'equals', value: userId },
            ],
          });
          totalWarnings = userWarnings.length;
        } catch (error) {
          logger.warn('Failed to query warning history:', error);
        }
      }

      return {
        success: true,
        data: {
          ...warningData,
          dmSent,
          totalWarnings,
        },
        metadata: {
          executionTime,
          affectedUsers: [userId],
          nextSuggestedTool: totalWarnings >= 3 ? 'timeout' : 'check_trust',
          loopBack: totalWarnings >= 3, // Suggest escalation if 3+ warnings
        },
      };
    } catch (error) {
      logger.error('Error executing warn:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  canChainTo: ['check_trust', 'timeout', 'moderation_history'],
  canLoopBack: true, // Can suggest escalation
  requiresConfirmation: false, // Warnings don't need confirmation

  preconditions: [
    {
      type: 'custom',
      field: 'member',
      customFn: (context) => context.member.permissions.has(PermissionFlagsBits.ModerateMembers),
      message: 'User must have MODERATE_MEMBERS permission',
    },
  ],
};
