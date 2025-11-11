/**
 * SERVER STATS TOOL
 *
 * Displays comprehensive server statistics including:
 * - Member counts and growth
 * - Channel activity
 * - Message volume
 * - Role distribution
 */

import { BecasTool, BecasContext, BecasToolResult } from '../../types/BecasFlow.types';
import { EmbedBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('ServerStatsTool');

export const serverStatsTool: BecasTool = {
  name: 'server_stats',
  description: 'Display comprehensive server statistics',
  category: 'analytics',

  parameters: {
    period: {
      type: 'string',
      description: 'Time period for statistics',
      required: false,
      default: 'all',
      enum: ['day', 'week', 'month', 'all'],
    },
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      const { period } = params;

      logger.info(`Generating server stats for period: ${period}`);

      // Permission check
      if (!context.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return {
          success: false,
          error: 'You do not have permission to view server statistics',
        };
      }

      // Fetch all members and channels
      const members = await context.guild.members.fetch();
      const channels = await context.guild.channels.fetch();

      // Calculate member statistics
      const totalMembers = members.size;
      const botCount = members.filter((m) => m.user.bot).size;
      const humanCount = totalMembers - botCount;
      const onlineCount = members.filter((m) => m.presence?.status === 'online').size;

      // Calculate channel statistics
      const textChannels = channels.filter((c) => c?.type === ChannelType.GuildText).size;
      const voiceChannels = channels.filter((c) => c?.type === ChannelType.GuildVoice).size;
      const categories = channels.filter((c) => c?.type === ChannelType.GuildCategory).size;

      // Get role statistics
      const roles = context.guild.roles.cache;
      const roleCount = roles.size;

      // Calculate role distribution (top 5 roles by member count)
      const roleDistribution = Array.from(roles.values())
        .filter((r) => r.id !== context.guild.id) // Exclude @everyone
        .map((role) => ({
          name: role.name,
          memberCount: role.members.size,
          color: role.hexColor,
        }))
        .sort((a, b) => b.memberCount - a.memberCount)
        .slice(0, 5);

      // Server creation and age
      const createdAt = context.guild.createdAt;
      const serverAge = Date.now() - createdAt.getTime();
      const serverAgeDays = Math.floor(serverAge / (1000 * 60 * 60 * 24));

      // Boost statistics
      const boostLevel = context.guild.premiumTier;
      const boostCount = context.guild.premiumSubscriptionCount || 0;

      // Build embed
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📊 Server Statistics - ${context.guild.name}`)
        .setThumbnail(context.guild.iconURL() || null)
        .setTimestamp();

      // General info
      embed.addFields({
        name: '📋 General Information',
        value: [
          `**Owner:** <@${context.guild.ownerId}>`,
          `**Created:** ${createdAt.toLocaleDateString()} (${serverAgeDays} days ago)`,
          `**Server ID:** ${context.guild.id}`,
          `**Region:** Auto`,
        ].join('\n'),
      });

      // Member statistics
      embed.addFields({
        name: '👥 Members',
        value: [
          `**Total:** ${totalMembers}`,
          `**Humans:** ${humanCount}`,
          `**Bots:** ${botCount}`,
          `**Online:** ${onlineCount}`,
        ].join('\n'),
        inline: true,
      });

      // Channel statistics
      embed.addFields({
        name: '💬 Channels',
        value: [
          `**Text:** ${textChannels}`,
          `**Voice:** ${voiceChannels}`,
          `**Categories:** ${categories}`,
          `**Total:** ${channels.size}`,
        ].join('\n'),
        inline: true,
      });

      // Boost statistics
      embed.addFields({
        name: '✨ Boosts',
        value: [
          `**Level:** ${boostLevel}`,
          `**Boosts:** ${boostCount}`,
          `**Progress:** ${this.getBoostProgress(boostLevel, boostCount)}`,
        ].join('\n'),
        inline: true,
      });

      // Role statistics
      if (roleDistribution.length > 0) {
        const roleText = roleDistribution
          .map((r) => `${r.name}: ${r.memberCount} members`)
          .join('\n');

        embed.addFields({
          name: `🎭 Top Roles (${roleCount} total)`,
          value: roleText,
        });
      }

      // Activity statistics (if V3 integration available)
      if (context.services.v3Integration && context.services.unifiedMemory) {
        try {
          const cutoffTime = this.getPeriodCutoff(period || 'all');

          const recentActions = await context.services.unifiedMemory.query({
            type: 'action',
            guildId: context.guild.id,
            limit: 1000,
          });

          const periodActions = recentActions.filter((action: any) => {
            const actionTime = new Date(action.timestamp).getTime();
            return actionTime >= cutoffTime;
          });

          const actionTypes = {
            ban: 0,
            kick: 0,
            timeout: 0,
            warn: 0,
            delete: 0,
          };

          periodActions.forEach((action: any) => {
            const type = action.data?.type;
            if (type && actionTypes.hasOwnProperty(type)) {
              actionTypes[type as keyof typeof actionTypes]++;
            }
          });

          const activityText = [
            `**Bans:** ${actionTypes.ban}`,
            `**Kicks:** ${actionTypes.kick}`,
            `**Timeouts:** ${actionTypes.timeout}`,
            `**Warnings:** ${actionTypes.warn}`,
            `**Messages Deleted:** ${actionTypes.delete}`,
          ].join('\n');

          embed.addFields({
            name: `📈 Moderation Activity (${this.getPeriodLabel(period || 'all')})`,
            value: activityText,
          });
        } catch (error) {
          logger.warn('Failed to fetch activity statistics:', error);
        }
      }

      // Server features
      const features = context.guild.features;
      if (features.length > 0) {
        const featureText = features
          .slice(0, 10)
          .map((f) => this.formatFeature(f))
          .join(', ');

        embed.addFields({
          name: '🌟 Server Features',
          value: featureText,
        });
      }

      // Send embed
      await context.channel.send({ embeds: [embed] });

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        data: {
          totalMembers,
          humanCount,
          botCount,
          onlineCount,
          channels: {
            text: textChannels,
            voice: voiceChannels,
            categories,
            total: channels.size,
          },
          roles: roleCount,
          boostLevel,
          boostCount,
          serverAgeDays,
        },
        metadata: {
          executionTime,
        },
      };
    } catch (error) {
      logger.error('Error generating server stats:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  canChainTo: ['user_activity', 'moderation_history'],
  requiresConfirmation: false,

  preconditions: [
    {
      type: 'custom',
      field: 'member',
      customFn: (context) => context.member.permissions.has(PermissionFlagsBits.ManageGuild),
      message: 'User must have MANAGE_GUILD permission',
    },
  ],
};

// Helper: Get boost progress text
(serverStatsTool as any).getBoostProgress = (level: number, count: number): string => {
  const thresholds = [0, 2, 7, 14];
  const nextLevel = level + 1;

  if (nextLevel >= thresholds.length) {
    return 'Max level reached';
  }

  const needed = thresholds[nextLevel];
  const remaining = needed - count;

  if (remaining <= 0) {
    return 'Ready to level up!';
  }

  return `${remaining} boosts to level ${nextLevel}`;
};

// Helper: Get period cutoff timestamp
(serverStatsTool as any).getPeriodCutoff = (period: string): number => {
  const now = Date.now();

  switch (period) {
    case 'day':
      return now - 24 * 60 * 60 * 1000;
    case 'week':
      return now - 7 * 24 * 60 * 60 * 1000;
    case 'month':
      return now - 30 * 24 * 60 * 60 * 1000;
    default:
      return 0; // All time
  }
};

// Helper: Get period label
(serverStatsTool as any).getPeriodLabel = (period: string): string => {
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

// Helper: Format feature names
(serverStatsTool as any).formatFeature = (feature: string): string => {
  return feature
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
};
