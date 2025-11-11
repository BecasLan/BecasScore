/**
 * USER ACTIVITY TOOL
 *
 * Analyzes and displays user activity patterns including:
 * - Message frequency
 * - Active hours
 * - Channel preferences
 * - Engagement metrics
 */

import { BecasTool, BecasContext, BecasToolResult, BecasMissingParam } from '../../types/BecasFlow.types';
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('UserActivityTool');

export const userActivityTool: BecasTool = {
  name: 'user_activity',
  description: 'Analyze user activity patterns and engagement',
  category: 'analytics',

  parameters: {
    userId: {
      type: 'userId',
      description: 'The ID of the user to analyze',
      required: true,
    },
    period: {
      type: 'string',
      description: 'Time period for analysis',
      required: false,
      default: 'week',
      enum: ['day', 'week', 'month', 'all'],
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
          prompt: 'Which user would you like to analyze?',
          type: 'select',
          options: context.lastUsers.map((id) => ({
            label: id,
            value: id,
          })),
        };
      }

      return {
        param: 'userId',
        prompt: 'Enter the user ID or @mention the user to analyze',
        type: 'text',
      };
    }

    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      const { userId, period } = params;

      logger.info(`Analyzing activity for user ${userId}`);

      // Permission check
      if (!context.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return {
          success: false,
          error: 'You do not have permission to view user activity',
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

      // Calculate time range
      const cutoffTime = this.getPeriodCutoff(period || 'week');

      // Fetch recent messages from multiple channels
      const channels = context.guild.channels.cache.filter((c) => c.isTextBased());
      let totalMessages = 0;
      const channelActivity: Record<string, number> = {};
      const messageTimestamps: number[] = [];

      for (const [channelId, channel] of channels) {
        if (!channel.isTextBased()) continue;

        try {
          const messages = await (channel as any).messages.fetch({ limit: 100 });
          const userMessages = messages.filter(
            (m: any) => m.author.id === userId && m.createdTimestamp >= cutoffTime
          );

          if (userMessages.size > 0) {
            totalMessages += userMessages.size;
            channelActivity[channelId] = userMessages.size;

            userMessages.forEach((m: any) => {
              messageTimestamps.push(m.createdTimestamp);
            });
          }
        } catch (error) {
          // Skip channels we can't read
          continue;
        }
      }

      // Calculate activity metrics
      const periodDays = this.getPeriodDays(period || 'week');
      const messagesPerDay = totalMessages / periodDays;

      // Find most active channels
      const topChannels = Object.entries(channelActivity)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([channelId, count]) => ({
          channelId,
          messageCount: count,
        }));

      // Calculate activity hours (distribution across 24 hours)
      const hourlyActivity = new Array(24).fill(0);
      messageTimestamps.forEach((timestamp) => {
        const hour = new Date(timestamp).getHours();
        hourlyActivity[hour]++;
      });

      const mostActiveHour = hourlyActivity.indexOf(Math.max(...hourlyActivity));
      const leastActiveHour = hourlyActivity.indexOf(Math.min(...hourlyActivity.filter((h) => h > 0)));

      // Get trust score for comparison
      let trustScore = null;
      if (context.services.trustEngine) {
        try {
          const trust = context.services.trustEngine.getTrustScore(userId, context.guild.id);
          trustScore = {
            score: trust.score,
            level: trust.level,
          };
        } catch (error) {
          logger.warn('Failed to get trust score:', error);
        }
      }

      // Build embed
      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`📊 User Activity Analysis - ${member.user.tag}`)
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();

      // Activity summary
      embed.addFields({
        name: '📈 Activity Summary',
        value: [
          `**Period:** ${this.getPeriodLabel(period || 'week')}`,
          `**Total Messages:** ${totalMessages}`,
          `**Messages/Day:** ${messagesPerDay.toFixed(1)}`,
          `**Active Channels:** ${Object.keys(channelActivity).length}`,
        ].join('\n'),
      });

      // Most active channels
      if (topChannels.length > 0) {
        const channelText = topChannels
          .map((c) => `<#${c.channelId}>: ${c.messageCount} messages`)
          .join('\n');

        embed.addFields({
          name: '💬 Most Active Channels',
          value: channelText,
        });
      }

      // Activity patterns
      const activityPatternsText = [
        `**Most Active Hour:** ${mostActiveHour}:00 - ${mostActiveHour + 1}:00`,
        mostActiveHour >= 22 || mostActiveHour < 6
          ? '🌙 Night owl detected'
          : mostActiveHour >= 9 && mostActiveHour < 17
          ? '☀️ Daytime active'
          : '🌆 Evening active',
      ];

      if (leastActiveHour >= 0) {
        activityPatternsText.push(`**Least Active Hour:** ${leastActiveHour}:00 - ${leastActiveHour + 1}:00`);
      }

      embed.addFields({
        name: '⏰ Activity Patterns',
        value: activityPatternsText.join('\n'),
      });

      // Trust score correlation
      if (trustScore) {
        embed.addFields({
          name: '🎯 Trust Score',
          value: `**Score:** ${trustScore.score}/100\n**Level:** ${trustScore.level}`,
          inline: true,
        });
      }

      // Member info
      const joinedAt = member.joinedAt;
      const memberDays = joinedAt ? Math.floor((Date.now() - joinedAt.getTime()) / (1000 * 60 * 60 * 24)) : 0;

      embed.addFields({
        name: '👤 Member Info',
        value: [
          `**Joined:** ${joinedAt?.toLocaleDateString() || 'Unknown'} (${memberDays} days ago)`,
          `**Roles:** ${member.roles.cache.size - 1}`, // Exclude @everyone
          `**Status:** ${member.presence?.status || 'offline'}`,
        ].join('\n'),
        inline: true,
      });

      // Engagement level
      const engagementLevel = this.calculateEngagementLevel(messagesPerDay, periodDays);
      embed.addFields({
        name: '📊 Engagement Level',
        value: `${engagementLevel.emoji} **${engagementLevel.label}**\n${engagementLevel.description}`,
      });

      // Send embed
      await context.channel.send({ embeds: [embed] });

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        data: {
          userId,
          username: member.user.tag,
          totalMessages,
          messagesPerDay,
          activeChannels: Object.keys(channelActivity).length,
          topChannels,
          mostActiveHour,
          engagementLevel: engagementLevel.label,
          trustScore,
          memberDays,
        },
        metadata: {
          executionTime,
          affectedUsers: [userId],
          nextSuggestedTool: 'check_trust',
        },
      };
    } catch (error) {
      logger.error('Error analyzing user activity:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  canChainTo: ['check_trust', 'moderation_history'],
  requiresConfirmation: false,

  preconditions: [
    {
      type: 'custom',
      field: 'member',
      customFn: (context) => context.member.permissions.has(PermissionFlagsBits.ModerateMembers),
      message: 'User must have MODERATE_MEMBERS permission',
    },
  ],
};

// Helper functions
(userActivityTool as any).getPeriodCutoff = (period: string): number => {
  const now = Date.now();

  switch (period) {
    case 'day':
      return now - 24 * 60 * 60 * 1000;
    case 'week':
      return now - 7 * 24 * 60 * 60 * 1000;
    case 'month':
      return now - 30 * 24 * 60 * 60 * 1000;
    default:
      return 0;
  }
};

(userActivityTool as any).getPeriodDays = (period: string): number => {
  switch (period) {
    case 'day':
      return 1;
    case 'week':
      return 7;
    case 'month':
      return 30;
    default:
      return 30;
  }
};

(userActivityTool as any).getPeriodLabel = (period: string): string => {
  switch (period) {
    case 'day':
      return 'Last 24 Hours';
    case 'week':
      return 'Last 7 Days';
    case 'month':
      return 'Last 30 Days';
    default:
      return 'All Time';
  }
};

(userActivityTool as any).calculateEngagementLevel = (
  messagesPerDay: number,
  periodDays: number
): { emoji: string; label: string; description: string } => {
  if (messagesPerDay > 50) {
    return {
      emoji: '🔥',
      label: 'Very High',
      description: 'Extremely active member, high engagement',
    };
  } else if (messagesPerDay > 20) {
    return {
      emoji: '⚡',
      label: 'High',
      description: 'Very active member, regular contributor',
    };
  } else if (messagesPerDay > 5) {
    return {
      emoji: '✅',
      label: 'Moderate',
      description: 'Active member, occasional participation',
    };
  } else if (messagesPerDay > 1) {
    return {
      emoji: '📊',
      label: 'Low',
      description: 'Limited activity, infrequent participation',
    };
  } else {
    return {
      emoji: '💤',
      label: 'Very Low',
      description: 'Minimal activity, mostly inactive',
    };
  }
};
