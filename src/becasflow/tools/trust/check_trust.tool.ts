/**
 * CHECK TRUST TOOL
 *
 * Retrieves and displays trust score information for a user.
 * Shows current score, level, history, and recommendations.
 */

import { BecasTool, BecasContext, BecasToolResult, BecasMissingParam } from '../../types/BecasFlow.types';
import { EmbedBuilder } from 'discord.js';
import { createLogger } from '../../../services/Logger';
import { UserRepository } from '../../../database/repositories/UserRepository';
import { SicilRepository } from '../../../database/repositories/SicilRepository';

const logger = createLogger('CheckTrustTool');
const userRepo = new UserRepository();
const sicilRepo = new SicilRepository();

export const checkTrustTool: BecasTool = {
  name: 'check_trust',
  description: 'Check trust score and history for a user',
  category: 'trust',

  parameters: {
    userId: {
      type: 'userId',
      description: 'The ID of the user to check',
      required: true,
    },
    detailed: {
      type: 'boolean',
      description: 'Show detailed history',
      required: false,
      default: false,
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
          prompt: 'Which user would you like to check?',
          type: 'select',
          options: context.lastUsers.map((id) => ({
            label: id,
            value: id,
          })),
        };
      }

      return {
        param: 'userId',
        prompt: 'Enter the user ID or @mention the user to check',
        type: 'text',
      };
    }

    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      const { userId, detailed } = params;

      logger.info(`Checking trust score for user ${userId}`);

      // Get user from DATABASE
      const dbUser = await userRepo.getUserById(userId);
      if (!dbUser) {
        return {
          success: false,
          error: 'User not found in database',
        };
      }

      // Get member info from Discord
      let member;
      try {
        member = await context.guild.members.fetch(userId);
      } catch (error) {
        logger.warn(`User ${userId} not in server, checking trust score anyway`);
      }

      // Get trust score from DATABASE (default to 50 if null/undefined)
      const trustScore = dbUser.global_trust_score ?? 50;

      // Calculate trust level from score
      const getTrustLevel = (score: number): string => {
        if (score >= 80) return 'Verified';
        if (score >= 60) return 'Trusted';
        if (score >= 40) return 'Neutral';
        if (score >= 20) return 'Suspicious';
        return 'Untrusted';
      };

      const level = getTrustLevel(trustScore);

      // Calculate trust level color
      const levelColors = {
        'Verified': 0x00ff00,      // Green
        'Trusted': 0x00cc00,        // Light green
        'Neutral': 0xffff00,        // Yellow
        'Suspicious': 0xff9900,     // Orange
        'Untrusted': 0xff0000,      // Red
      };

      const color = levelColors[level] || 0x808080;

      // Get violations from DATABASE (user_actions table)
      const userActions = await sicilRepo.getUserActions(context.guild.id, userId, 50);
      const violations = userActions.filter(action => action.triggered_moderation);

      // Build progress bar for score (0-100)
      const barLength = 10;
      const filledBars = Math.round((trustScore / 100) * barLength);
      const emptyBars = barLength - filledBars;
      const progressBar = '█'.repeat(filledBars) + '░'.repeat(emptyBars);
      const scoreDisplay = `${progressBar} ${Math.round(trustScore)}/100`;

      // Build embed
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`🔍 Trust Score: ${member?.displayName || member?.user.tag || dbUser.username}`)
        .setThumbnail(member?.user.displayAvatarURL() || dbUser.avatar_url || null)
        .addFields(
          { name: 'Score', value: scoreDisplay, inline: false },
          { name: 'Level', value: level, inline: true },
          { name: 'Last Updated', value: new Date(dbUser.updated_at).toLocaleString(), inline: true }
        );

      // Add account age
      if (member) {
        const accountAge = Date.now() - member.user.createdTimestamp;
        const accountDays = Math.floor(accountAge / (1000 * 60 * 60 * 24));
        embed.addFields({ name: 'Account Age', value: `${accountDays} days`, inline: true });

        const joinAge = Date.now() - (member.joinedTimestamp || 0);
        const joinDays = Math.floor(joinAge / (1000 * 60 * 60 * 24));
        embed.addFields({ name: 'Member Since', value: `${joinDays} days ago`, inline: true });
      }

      // Add recent violation history from DATABASE
      if (violations.length > 0) {
        const recentViolations = violations.slice(-5).reverse();
        const historyText = recentViolations
          .map((action, index) => {
            const date = new Date(action.timestamp).toLocaleDateString();
            const actionType = action.moderation_action || action.action_type || 'Warning';
            const emoji = ({ 'timeout': '⏰', 'ban': '🔨', 'kick': '👢', 'warn': '⚠️', 'delete': '🗑️' } as any)[actionType.toLowerCase()] || '⚠️';
            const content = action.content ? `"${action.content.substring(0, 100)}${action.content.length > 100 ? '...' : ''}"` : 'N/A';
            return `${emoji} **${actionType.toUpperCase()}** - ${date}\n   ${content}`;
          })
          .join('\n\n');

        embed.addFields({ name: '📋 Recent Violations (Last 5)', value: historyText.substring(0, 1024) || 'No violations' });
      }

      // Add detailed history if requested
      if (detailed && violations.length > 0) {
        const fullHistory = violations
          .slice(-10)
          .reverse()
          .map((action) => {
            const timestamp = new Date(action.timestamp).toLocaleString();
            const reason = action.intent || 'Unknown';
            const scores = `Scam: ${action.scam_score}, Toxic: ${action.toxicity_score}, Spam: ${action.spam_score}`;
            return `${timestamp}\n${reason}\n${scores}`;
          })
          .join('\n\n');

        embed.addFields({ name: 'Full History (Last 10)', value: fullHistory.substring(0, 1024) });
      }

      // Add recommendations
      const recommendations = this.generateRecommendations({ score: trustScore, level, history: violations });
      if (recommendations.length > 0) {
        embed.addFields({ name: '💡 Recommendations', value: recommendations.join('\n') });
      }

      // Send embed
      await context.channel.send({ embeds: [embed] });

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        data: {
          userId,
          username: member?.user.tag || dbUser.username,
          score: Math.round(trustScore),
          level: level,
          history: violations,
          recommendations,
        },
        metadata: {
          executionTime,
          affectedUsers: [userId],
          nextSuggestedTool: this.suggestNextTool({ score: trustScore, level }),
        },
      };
    } catch (error) {
      logger.error('Error checking trust:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  canChainTo: ['update_trust', 'trust_report', 'warn', 'timeout', 'ban'],
  requiresConfirmation: false,
};

// Helper: Generate recommendations based on trust score
(checkTrustTool as any).generateRecommendations = (trustScore: any): string[] => {
  const recommendations: string[] = [];

  if (trustScore.score < 30) {
    recommendations.push('⚠️ Low trust score - consider timeout or ban');
    recommendations.push('📊 Review moderation history');
  } else if (trustScore.score < 50) {
    recommendations.push('⚠️ Suspicious activity - monitor closely');
    recommendations.push('📝 Consider issuing a warning');
  } else if (trustScore.score >= 80) {
    recommendations.push('✅ Trusted member - no action needed');
  }

  if (trustScore.history && trustScore.history.length >= 3) {
    const recentNegative = trustScore.history
      .slice(-5)
      .filter((e: any) => e.change < 0).length;

    if (recentNegative >= 3) {
      recommendations.push('🔴 Multiple recent violations - escalate action');
    }
  }

  return recommendations;
};

// Helper: Suggest next tool based on trust score
(checkTrustTool as any).suggestNextTool = (trustScore: any): string | undefined => {
  if (trustScore.score < 20) return 'ban';
  if (trustScore.score < 40) return 'timeout';
  if (trustScore.score < 60) return 'warn';
  return 'trust_report';
};
