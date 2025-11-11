/**
 * V3 ARCHITECTURE INTEGRATION
 *
 * Wires V3 systems (UnifiedMemory, SafeLearning, Context) with existing V2 systems.
 * This is the bridge that makes everything work together.
 */

import { UnifiedMemoryStore } from '../persistence/UnifiedMemoryStore';
import { SafeLearningEngine, UserRole } from '../intelligence/SafeLearningEngine';
import { ContextEngine, ActionSummary } from '../intelligence/ContextEngine';
import { TrustScoreEngineDB } from '../systems/TrustScoreEngineDB';
import { GuildPolicyEngine } from '../intelligence/GuildPolicyEngine';
import { AISuggestion } from '../systems/SuggestionChannelManager';
import { Message, GuildMember } from 'discord.js';
import { createLogger } from '../services/Logger';

const logger = createLogger('V3Integration');

// ============================================
// TYPES
// ============================================

export interface ModerationAction {
  type: 'ban' | 'timeout' | 'kick' | 'warn' | 'delete' | 'untimeout' | 'unban';
  targetUserId: string;
  targetUsername: string;
  executedBy: string;
  executedByName: string;
  reason?: string;
  duration?: number;
  guildId: string;
  channelId: string;
  messageId?: string;
}

// ============================================
// V3 INTEGRATION LAYER
// ============================================

export class V3Integration {
  public policyEngine: GuildPolicyEngine;

  constructor(
    private unifiedMemory: UnifiedMemoryStore,
    private learningEngine: SafeLearningEngine,
    private contextEngine: ContextEngine,
    private trustEngine: TrustScoreEngineDB
  ) {
    this.policyEngine = new GuildPolicyEngine(unifiedMemory);
  }

  /**
   * Record an action to unified memory
   * This is called every time the bot takes a moderation action
   */
  async recordAction(action: ModerationAction): Promise<string> {
    const actionId = await this.unifiedMemory.store({
      type: 'action',
      guildId: action.guildId,
      data: action,
      relations: {
        relatedTo: [],
      },
    });

    logger.info(`Recorded action: ${action.type} on ${action.targetUsername} (${actionId})`);
    return actionId;
  }

  /**
   * Record a conversation message to unified memory
   * Selective - only stores important messages (commands, flagged content, etc)
   */
  async recordMessage(message: Message, wasFlagged: boolean = false): Promise<void> {
    if (!message.guild) return;

    // Only store if flagged or from moderator/bot
    const member = message.member;
    if (!wasFlagged && member && !this.isModerator(member)) return;

    await this.unifiedMemory.store({
      type: 'conversation',
      guildId: message.guild.id,
      data: {
        authorId: message.author.id,
        authorName: message.author.tag,
        content: message.content.substring(0, 500), // Truncate long messages
        channelId: message.channel.id,
      },
      metadata: {
        tags: wasFlagged ? ['flagged'] : [],
      },
      relations: {
        relatedTo: [],
      },
    });
  }

  /**
   * Update user profile with trust score
   * Called after TrustScoreEngine updates a user's score
   */
  async updateUserProfile(
    userId: string,
    username: string,
    guildId: string,
    trustScore: number,
    roles: string[]
  ): Promise<void> {
    // Try to find existing profile
    const existing = await this.unifiedMemory.query({
      type: 'user_profile',
      guildId,
      tags: [userId],
      limit: 1,
    });

    const profileData = {
      userId,
      username,
      roles,
      trustScore,
      sentiment: this.getSentiment(trustScore),
      recentActions: [],
    };

    if (existing.length > 0) {
      // Update existing
      await this.unifiedMemory.update(existing[0].id, {
        data: profileData,
      });
    } else {
      // Create new
      await this.unifiedMemory.store({
        type: 'user_profile',
        guildId,
        data: profileData,
        metadata: {
          tags: [userId],
        },
        relations: {
          relatedTo: [],
        },
      });
    }
  }

  /**
   * Handle moderator modify: "no, ban them instead", "change it to timeout 1h"
   */
  async handleModifyCommand(
    message: Message,
    moderator: GuildMember,
    newActionType: 'ban' | 'timeout' | 'kick' | 'warn',
    duration?: number
  ): Promise<{ success: boolean; actionId?: string; error?: string }> {
    // First get the last action
    const undoResult = await this.handleUndoCommand(message, moderator);
    if (!undoResult.success || !undoResult.actionId) {
      return undoResult;
    }

    // Now record the new action
    const actionMemory = await this.unifiedMemory.get(undoResult.actionId);
    if (!actionMemory) {
      return { success: false, error: 'Original action not found' };
    }

    const oldAction = actionMemory.data as ModerationAction;

    // Record new action with corrected type
    const newActionId = await this.recordAction({
      type: newActionType,
      targetUserId: oldAction.targetUserId,
      targetUsername: oldAction.targetUsername,
      executedBy: moderator.id,
      executedByName: moderator.user.tag,
      reason: `Modified from ${oldAction.type}: ${oldAction.reason}`,
      duration,
      guildId: message.guild!.id,
      channelId: message.channel.id,
      messageId: message.id
    });

    logger.info(`Modified action ${undoResult.actionId} -> ${newActionId}: ${oldAction.type} -> ${newActionType}`);

    return { success: true, actionId: newActionId };
  }

  /**
   * Handle moderator correction: "undo that", "take it back"
   */
  async handleUndoCommand(
    message: Message,
    moderator: GuildMember
  ): Promise<{ success: boolean; actionId?: string; error?: string }> {
    if (!message.guild) {
      return { success: false, error: 'Not in a guild' };
    }

    // Get context
    const context = await this.contextEngine.getContext(message.guild.id);

    // Resolve "that action"
    const actionId = await this.contextEngine.resolveActionReference(
      'that action',
      context
    );

    if (!actionId) {
      return { success: false, error: 'Could not find recent action to undo' };
    }

    // Get the action
    const actionMemory = await this.unifiedMemory.get(actionId);
    if (!actionMemory) {
      return { success: false, error: 'Action not found in memory' };
    }

    const action = actionMemory.data as ModerationAction;

    // Check if can be undone
    const actionSummary = context.recentActions.find(a => a.id === actionId);
    if (actionSummary && !actionSummary.canBeUndone) {
      return { success: false, error: 'Action is too old to undo (>5 minutes)' };
    }

    // Record negative feedback
    const userRole = this.getUserRole(moderator);
    await this.learningEngine.recordFeedback({
      actionId,
      wasCorrect: false,
      correctedBy: {
        userId: moderator.id,
        role: userRole,
        username: moderator.user.tag,
      },
      correction: {
        shouldHaveBeen: 'no action',
        reason: 'Moderator requested undo',
      },
      timestamp: Date.now(),
    });

    logger.info(`Recorded negative feedback for action ${actionId} from ${moderator.user.tag}`);

    // 🔥 ACTUALLY UNDO THE ACTION - Reverse the moderation action
    try {
      if (action.type === 'ban') {
        // Unban the user
        await message.guild.members.unban(action.targetUserId, `Undo by ${moderator.user.tag}`);
        logger.info(`✅ Unbanned user ${action.targetUserId} (undo action ${actionId})`);
      } else if (action.type === 'timeout') {
        // Remove timeout
        const member = await message.guild.members.fetch(action.targetUserId).catch(() => null);
        if (member) {
          await member.timeout(null, `Undo by ${moderator.user.tag}`);
          logger.info(`✅ Removed timeout from user ${action.targetUserId} (undo action ${actionId})`);
        }
      } else if (action.type === 'kick') {
        // Can't undo kick (user is already gone)
        logger.warn(`⚠️ Cannot undo kick action ${actionId} - user already left`);
      }
      // Note: warn and delete actions don't need reversal
    } catch (error) {
      logger.error(`❌ Failed to undo action ${actionId}:`, error);
      return { success: false, error: `Failed to reverse action: ${error}` };
    }

    return { success: true, actionId };
  }

  /**
   * Get applicable learned patterns for a situation
   * Called before AI makes a decision
   */
  async getApplicablePatterns(guildId: string, userRole: UserRole, channelType?: string) {
    return await this.learningEngine.getApplicablePatterns({
      userRole,
      channelType: channelType as any,
      messageIntent: 'genuine',
      isPublic: true,
    });
  }

  /**
   * Get learning statistics
   */
  async getLearningStats(guildId?: string) {
    const stats = await this.learningEngine.getStats(guildId);
    const memoryStats = this.unifiedMemory.getStats();

    return {
      learning: stats,
      memory: memoryStats,
    };
  }

  /**
   * Store an AI suggestion in unified memory
   * Called after SuggestionChannelManager posts a suggestion
   */
  async storeSuggestion(
    guildId: string,
    suggestion: AISuggestion,
    messageId: string
  ): Promise<string> {
    const suggestionId = await this.unifiedMemory.store({
      type: 'suggestion',
      guildId,
      data: {
        ...suggestion,
        messageId, // Link to Discord message
        implemented: false,
        implementedAt: null,
        implementedBy: null,
      },
      metadata: {
        tags: [suggestion.type, suggestion.severity],
      },
      relations: {
        relatedTo: [],
      },
    });

    logger.info(
      `Stored suggestion: ${suggestion.title} (${suggestionId}) in guild ${guildId}`
    );
    return suggestionId;
  }

  /**
   * Get recent suggestions for a guild
   */
  async getRecentSuggestions(
    guildId: string,
    limit: number = 10
  ): Promise<Array<{ id: string; data: any }>> {
    return await this.unifiedMemory.query({
      type: 'suggestion',
      guildId,
      limit,
    });
  }

  /**
   * Get a specific suggestion by number (1-indexed for user-friendly reference)
   */
  async getSuggestionByNumber(
    guildId: string,
    suggestionNumber: number
  ): Promise<{ id: string; data: any } | null> {
    const suggestions = await this.unifiedMemory.query({
      type: 'suggestion',
      guildId,
      limit: 100, // Get all recent suggestions
    });

    // Suggestions are ordered newest first, we want to reference them in that order
    if (suggestionNumber < 1 || suggestionNumber > suggestions.length) {
      return null;
    }

    return suggestions[suggestionNumber - 1];
  }

  /**
   * Mark a suggestion as implemented
   */
  async markSuggestionImplemented(
    suggestionId: string,
    implementedBy: string,
    implementedByName: string
  ): Promise<boolean> {
    try {
      const suggestion = await this.unifiedMemory.get(suggestionId);
      if (!suggestion) {
        return false;
      }

      await this.unifiedMemory.update(suggestionId, {
        data: {
          ...suggestion.data,
          implemented: true,
          implementedAt: Date.now(),
          implementedBy,
          implementedByName,
        },
      });

      logger.info(
        `Marked suggestion ${suggestionId} as implemented by ${implementedByName}`
      );
      return true;
    } catch (error) {
      logger.error('Failed to mark suggestion as implemented:', error);
      return false;
    }
  }

  // ============================================
  // HELPERS
  // ============================================

  private getUserRole(member: GuildMember): UserRole {
    return this.learningEngine.getUserRole(member);
  }

  private isModerator(member: GuildMember): boolean {
    return (
      member.permissions.has('ModerateMembers') ||
      member.permissions.has('KickMembers') ||
      member.permissions.has('BanMembers') ||
      member.permissions.has('Administrator')
    );
  }

  private getSentiment(trustScore: number): 'positive' | 'neutral' | 'negative' {
    if (trustScore >= 0.7) return 'positive';
    if (trustScore >= 0.4) return 'neutral';
    return 'negative';
  }
}
