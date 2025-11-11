/**
 * TRUST REPORT TOOL
 *
 * Generates comprehensive trust score report for the server.
 * Shows distribution, top/bottom users, trends, and statistics.
 */

import { BecasTool, BecasContext, BecasToolResult } from '../../types/BecasFlow.types';
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('TrustReportTool');

export const trustReportTool: BecasTool = {
  name: 'trust_report',
  description: 'Generate comprehensive trust score report for the server',
  category: 'trust',

  parameters: {
    topCount: {
      type: 'number',
      description: 'Number of top/bottom users to show',
      required: false,
      default: 5,
    },
    includeInactive: {
      type: 'boolean',
      description: 'Include users no longer in server',
      required: false,
      default: false,
    },
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      const { topCount, includeInactive } = params;

      logger.info('Generating trust report');

      // Permission check
      if (!context.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return {
          success: false,
          error: 'You do not have permission to view trust reports',
        };
      }

      // Check if trust engine is available
      if (!context.services.trustEngine) {
        return {
          success: false,
          error: 'Trust engine not available',
        };
      }

      // Get all members
      const members = await context.guild.members.fetch();

      // Get trust scores for all members
      const trustScores = Array.from(members.values()).map((member) => ({
        member,
        trust: context.services.trustEngine.getTrustScore(member.id, context.guild.id),
      }));

      // Sort by score
      trustScores.sort((a, b) => b.trust.score - a.trust.score);

      // Calculate statistics
      const totalMembers = trustScores.length;
      const avgScore = trustScores.reduce((sum, t) => sum + t.trust.score, 0) / totalMembers;

      const levelCounts = {
        'Verified': 0,
        'Trusted': 0,
        'Neutral': 0,
        'Suspicious': 0,
        'Untrusted': 0,
      };

      trustScores.forEach((t) => {
        levelCounts[t.trust.level] = (levelCounts[t.trust.level] || 0) + 1;
      });

      // Build embed
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`📊 Trust Score Report - ${context.guild.name}`)
        .setTimestamp();

      // Overall statistics
      embed.addFields({
        name: '📈 Overall Statistics',
        value: [
          `Total Members: ${totalMembers}`,
          `Average Score: ${avgScore.toFixed(1)}/100`,
          `Median Score: ${this.calculateMedian(trustScores.map((t) => t.trust.score)).toFixed(1)}`,
        ].join('\n'),
      });

      // Level distribution
      const distributionText = Object.entries(levelCounts)
        .map(([level, count]) => {
          const percentage = ((count / totalMembers) * 100).toFixed(1);
          return `${level}: ${count} (${percentage}%)`;
        })
        .join('\n');

      embed.addFields({
        name: '🎯 Level Distribution',
        value: distributionText,
      });

      // Top users
      const topUsers = trustScores.slice(0, topCount || 5);
      const topText = topUsers
        .map((t, idx) => `${idx + 1}. ${t.member.user.tag}: ${t.trust.score}/100 (${t.trust.level})`)
        .join('\n');

      embed.addFields({
        name: `👑 Top ${topCount || 5} Trusted Users`,
        value: topText || 'No data',
      });

      // Bottom users (concerning)
      const bottomUsers = trustScores.slice(-Math.min(topCount || 5, trustScores.length)).reverse();
      const bottomText = bottomUsers
        .map((t, idx) => `${idx + 1}. ${t.member.user.tag}: ${t.trust.score}/100 (${t.trust.level})`)
        .join('\n');

      embed.addFields({
        name: `⚠️ Bottom ${topCount || 5} Users (Attention Needed)`,
        value: bottomText || 'No data',
      });

      // Trends (users with recent changes)
      const recentlyChanged = trustScores
        .filter((t) => {
          const lastUpdate = new Date(t.trust.lastUpdated);
          const daysSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
          return daysSinceUpdate <= 7; // Last 7 days
        })
        .slice(0, 5);

      if (recentlyChanged.length > 0) {
        const trendsText = recentlyChanged
          .map((t) => {
            const lastEvent = t.trust.history?.[t.trust.history.length - 1];
            const change = lastEvent?.change || 0;
            const changeText = change >= 0 ? `+${change}` : change;
            return `${t.member.user.tag}: ${changeText} (${lastEvent?.reason || 'Unknown'})`;
          })
          .join('\n');

        embed.addFields({
          name: '📊 Recent Changes (Last 7 Days)',
          value: trendsText,
        });
      }

      // Recommendations
      const recommendations = this.generateServerRecommendations(trustScores, levelCounts);
      if (recommendations.length > 0) {
        embed.addFields({
          name: '💡 Recommendations',
          value: recommendations.join('\n'),
        });
      }

      // Send embed
      await context.channel.send({ embeds: [embed] });

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        data: {
          totalMembers,
          averageScore: avgScore,
          levelDistribution: levelCounts,
          topUsers: topUsers.map((t) => ({
            userId: t.member.id,
            username: t.member.user.tag,
            score: t.trust.score,
            level: t.trust.level,
          })),
          bottomUsers: bottomUsers.map((t) => ({
            userId: t.member.id,
            username: t.member.user.tag,
            score: t.trust.score,
            level: t.trust.level,
          })),
          recommendations,
        },
        metadata: {
          executionTime,
        },
      };
    } catch (error) {
      logger.error('Error generating trust report:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  canChainTo: ['check_trust', 'update_trust'],
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

// Helper: Calculate median
(trustReportTool as any).calculateMedian = (numbers: number[]): number => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
};

// Helper: Generate server-wide recommendations
(trustReportTool as any).generateServerRecommendations = (
  trustScores: any[],
  levelCounts: any
): string[] => {
  const recommendations: string[] = [];
  const total = trustScores.length;

  // Check for high percentage of low-trust users
  const lowTrustCount = (levelCounts['Untrusted'] || 0) + (levelCounts['Suspicious'] || 0);
  const lowTrustPercentage = (lowTrustCount / total) * 100;

  if (lowTrustPercentage > 20) {
    recommendations.push(`⚠️ ${lowTrustPercentage.toFixed(1)}% of users have low trust - review moderation policies`);
  }

  // Check for users needing immediate attention
  const criticalUsers = trustScores.filter((t) => t.trust.score < 20);
  if (criticalUsers.length > 0) {
    recommendations.push(`🔴 ${criticalUsers.length} user(s) with critical low trust - immediate review recommended`);
  }

  // Check for highly trusted community
  const highTrustPercentage = ((levelCounts['Verified'] || 0) / total) * 100;
  if (highTrustPercentage > 50) {
    recommendations.push(`✅ ${highTrustPercentage.toFixed(1)}% verified users - healthy community`);
  }

  // Check for neutral majority
  const neutralPercentage = ((levelCounts['Neutral'] || 0) / total) * 100;
  if (neutralPercentage > 60) {
    recommendations.push(`📊 ${neutralPercentage.toFixed(1)}% neutral users - consider engagement activities`);
  }

  return recommendations;
};
