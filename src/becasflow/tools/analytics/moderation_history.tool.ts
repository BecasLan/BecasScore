/**
 * MODERATION HISTORY TOOL
 *
 * Displays comprehensive moderation history for a user or the entire server.
 * Shows all actions taken, patterns, and trends.
 */

import { BecasTool, BecasContext, BecasToolResult, BecasMissingParam } from '../../types/BecasFlow.types';
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { createLogger } from '../../../services/Logger';

const logger = createLogger('ModerationHistoryTool');

export const moderationHistoryTool: BecasTool = {
  name: 'moderation_history',
  description: 'View moderation history for a user or the entire server',
  category: 'analytics',

  parameters: {
    userId: {
      type: 'userId',
      description: 'User ID to check history for (optional - shows all if not specified)',
      required: false,
    },
    period: {
      type: 'string',
      description: 'Time period for history',
      required: false,
      default: 'month',
      enum: ['day', 'week', 'month', 'all'],
    },
    actionType: {
      type: 'string',
      description: 'Filter by action type',
      required: false,
      enum: ['ban', 'kick', 'timeout', 'warn', 'delete', 'all'],
    },
    limit: {
      type: 'number',
      description: 'Maximum number of entries to show',
      required: false,
      default: 10,
    },
  },

  detectMissing: (params: any, context: BecasContext): BecasMissingParam | null => {
    // userId is optional - if not provided, show server-wide history
    if (params.userId === undefined && context.lastUsers && context.lastUsers.length === 1) {
      params.userId = context.lastUsers[0];
    }

    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    try {
      const { userId, period, actionType, limit } = params;

      logger.info(`Fetching moderation history${userId ? ` for user ${userId}` : ' (server-wide)'}`);

      // Permission check
      if (!context.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return {
          success: false,
          error: 'You do not have permission to view moderation history',
        };
      }

      // Calculate time range
      const cutoffTime = this.getPeriodCutoff(period || 'month');

      // 🔥 Fetch from user_actions table via SicilRepository
      let actions: any[] = [];
      try {
        // Import SicilRepository
        const { SicilRepository } = await import('../../../database/repositories/SicilRepository');
        const sicilRepo = new SicilRepository();

        // Get user actions from database
        const userActions = await sicilRepo.getUserActions(
          context.guild.id,
          userId || '',
          limit || 100
        );

        // Filter by time period
        actions = userActions.filter(action => {
          const actionTime = new Date(action.timestamp).getTime();
          return actionTime >= cutoffTime;
        });

        // Filter by action type if specified
        if (actionType && actionType !== 'all') {
          actions = actions.filter(action =>
            action.moderation_action === actionType ||
            action.action_type === actionType
          );
        }

        // Filter ONLY moderation actions (exclude trust_score_change, etc)
        // Show ALL actions that triggered moderation, regardless of action type
        actions = actions.filter(action => action.triggered_moderation === true);
        logger.info(`🔍 After triggered_moderation filter: ${actions.length} actions`);

        // Transform to expected format
        actions = actions.map(action => ({
          timestamp: action.timestamp,
          type: action.moderation_action || action.action_type,
          data: {
            type: action.moderation_action || action.action_type,
            targetUserId: action.user_id,
            targetUsername: undefined, // Will be fetched separately
            executedByName: action.moderator_id ? 'Moderator' : 'Becas AI',
            reason: action.content || action.metadata?.reason || 'Automated moderation',
            content: action.content,
            scores: {
              toxicity: action.toxicity_score,
              scam: action.scam_score,
              spam: action.spam_score
            }
          }
        }));

        logger.info(`✅ Fetched ${actions.length} actions from user_actions table`);
      } catch (error) {
        logger.error('Failed to fetch from user_actions:', error);
      }

      // Get member info if userId specified
      let targetMember;
      if (userId) {
        try {
          targetMember = await context.guild.members.fetch(userId);
          logger.info(`🔍 Fetched Discord member for ${userId}: ${targetMember?.user.tag} (${targetMember?.user.username})`);
        } catch (error) {
          logger.warn(`User ${userId} not in server`);
        }
      }

      // Build embed
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle(
          userId
            ? `📜 Moderation History - ${targetMember?.displayName || targetMember?.user.tag || userId}`
            : `📜 Server Moderation History`
        )
        .setTimestamp();

      if (targetMember) {
        embed.setThumbnail(targetMember.user.displayAvatarURL());
      }

      // Summary statistics
      const actionCounts = {
        ban: 0,
        kick: 0,
        timeout: 0,
        warn: 0,
        delete: 0,
        other: 0,
      };

      actions.forEach((action) => {
        const type = action.data?.type || (action as any).type;
        if (type && actionCounts.hasOwnProperty(type)) {
          actionCounts[type as keyof typeof actionCounts]++;
        } else {
          actionCounts.other++;
        }
      });

      const summaryText = [
        `**Period:** ${this.getPeriodLabel(period || 'month')}`,
        `**Total Actions:** ${actions.length}`,
        `**Bans:** ${actionCounts.ban}`,
        `**Kicks:** ${actionCounts.kick}`,
        `**Timeouts:** ${actionCounts.timeout}`,
        `**Warnings:** ${actionCounts.warn}`,
        `**Deletions:** ${actionCounts.delete}`,
      ].join('\n');

      embed.addFields({
        name: '📊 Summary',
        value: summaryText,
      });

      // Recent actions
      if (actions.length > 0) {
        const recentActions = actions.slice(0, Math.min(10, limit || 10));
        const actionsText = recentActions
          .map((action) => {
            const timestamp = new Date(action.timestamp);
            const data = action.data || {};
            const actionType = data.type || (action as any).type || 'unknown';

            const actionEmoji = {
              ban: '🔨',
              kick: '👢',
              timeout: '⏰',
              warn: '⚠️',
              delete: '🗑️',
            }[actionType] || '📌';

            const targetText = data.targetUsername || data.targetUserId || 'Unknown';
            const moderatorText = data.executedByName || 'System';

            // Show message content if available
            const contentText = data.content ? `\n  📝 Message: "${data.content.substring(0, 150)}${data.content.length > 150 ? '...' : ''}"` : '';

            // Show scores if available
            const scoresText = data.scores && (data.scores.toxicity > 0 || data.scores.scam > 0 || data.scores.spam > 0)
              ? `\n  🎯 Scores: Toxicity ${data.scores.toxicity}, Scam ${data.scores.scam}, Spam ${data.scores.spam}`
              : '';

            const reasonText = data.reason && !data.content ? `\n  💬 Reason: ${data.reason.substring(0, 100)}` : '';

            return `${actionEmoji} **${actionType.toUpperCase()}** - ${targetText}\n  By: ${moderatorText} | ${timestamp.toLocaleString()}${contentText}${scoresText}${reasonText}`;
          })
          .join('\n\n');

        embed.addFields({
          name: `📋 Recent Actions (${recentActions.length})`,
          value: actionsText.substring(0, 1024) || 'No actions found',
        });
      } else {
        embed.addFields({
          name: '📋 Recent Actions',
          value: 'No moderation actions found for this period',
        });
      }

      // Pattern analysis (if enough data)
      if (actions.length >= 3 && userId) {
        const patterns = this.analyzePatterns(actions);
        if (patterns.length > 0) {
          embed.addFields({
            name: '🔍 Patterns Detected',
            value: patterns.join('\n'),
          });
        }
      }

      // Top moderators (if server-wide)
      if (!userId && actions.length > 0) {
        const moderatorCounts: Record<string, number> = {};
        actions.forEach((action) => {
          const mod = action.data?.executedByName || 'Unknown';
          moderatorCounts[mod] = (moderatorCounts[mod] || 0) + 1;
        });

        const topMods = Object.entries(moderatorCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([name, count]) => `${name}: ${count} actions`)
          .join('\n');

        if (topMods) {
          embed.addFields({
            name: '👮 Most Active Moderators',
            value: topMods,
          });
        }
      }

      // Send embed
      await context.channel.send({ embeds: [embed] });

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        data: {
          userId,
          period: period || 'month',
          actionType,
          totalActions: actions.length,
          actionCounts,
          actions: actions.map((a) => ({
            type: a.data?.type,
            timestamp: a.timestamp,
            reason: a.data?.reason,
            executedBy: a.data?.executedByName,
            targetUserId: a.data?.targetUserId, // ✅ Include target user for aggregation queries
          })),
        },
        metadata: {
          executionTime,
          affectedUsers: userId ? [userId] : undefined,
          nextSuggestedTool: userId ? 'check_trust' : undefined,
        },
      };
    } catch (error) {
      logger.error('Error fetching moderation history:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  canChainTo: ['check_trust', 'user_activity', 'trust_report'],
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
(moderationHistoryTool as any).getPeriodCutoff = (period: string): number => {
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

(moderationHistoryTool as any).getPeriodLabel = (period: string): string => {
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

(moderationHistoryTool as any).analyzePatterns = (actions: any[]): string[] => {
  const patterns: string[] = [];

  // Check for escalation pattern (warn -> timeout -> ban)
  const types = actions.map((a) => a.data?.type);
  if (types.includes('warn') && types.includes('timeout')) {
    patterns.push('⚠️ Escalation pattern detected (warnings followed by timeouts)');
  }

  if (types.includes('ban')) {
    patterns.push('🔴 User has been banned');
  }

  // Check for frequency
  const recentActions = actions.filter((a) => {
    const actionTime = new Date(a.timestamp).getTime();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return actionTime >= sevenDaysAgo;
  });

  if (recentActions.length >= 3) {
    patterns.push(`🔄 ${recentActions.length} actions in last 7 days - high frequency`);
  }

  // Check for repeated warnings
  const warningCount = types.filter((t) => t === 'warn').length;
  if (warningCount >= 3) {
    patterns.push(`⚠️ ${warningCount} warnings issued - consider escalation`);
  }

  return patterns;
};
