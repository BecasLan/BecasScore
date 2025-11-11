/**
 * SAFE LEARNING ENGINE
 *
 * 4-layer validation system to prevent false learning:
 * 1. Feedback Loop - Track corrections from moderators
 * 2. Authority Hierarchy - Weight learning by user role
 * 3. Confidence Threshold - Only apply high-confidence patterns
 * 4. Context Awareness - Distinguish tests from real actions
 */

import { UnifiedMemoryStore, MemoryEntry } from '../persistence/UnifiedMemoryStore';
import { createLogger } from '../services/Logger';
import { GuildMember } from 'discord.js';

const logger = createLogger('SafeLearningEngine');

// ============================================
// TYPES
// ============================================

export interface ActionFeedback {
  actionId: string;
  wasCorrect: boolean;
  correctedBy: {
    userId: string;
    role: UserRole;
    username: string;
  };
  correction?: {
    shouldHaveBeen: string;  // What should the action have been?
    reason: string;           // Why was it wrong?
  };
  timestamp: number;
}

export type UserRole = 'owner' | 'admin' | 'moderator' | 'trusted_member' | 'member';

export interface LearnedPattern {
  id: string;
  pattern: string;          // Description of pattern (e.g., "timeout for 'fuck'")
  action: string;           // Action to take
  context: ActionContext;
  confidence: number;       // 0-1
  supportingActions: number;  // How many times confirmed correct
  contradictingActions: number;  // How many times marked wrong
  lastUsed: number;
  createdAt: number;
}

export interface ActionContext {
  userRole?: UserRole;
  channelType?: 'mod-chat' | 'general' | 'nsfw' | 'announcements';
  messageIntent?: 'test' | 'genuine' | 'joke';
  isPublic?: boolean;
}

// ============================================
// SAFE LEARNING ENGINE
// ============================================

export class SafeLearningEngine {
  private memory: UnifiedMemoryStore;

  // Authority weights for learning
  private readonly LEARNING_WEIGHTS: Record<UserRole, number> = {
    owner: 1.0,          // 100% trust
    admin: 0.9,          // 90% trust
    moderator: 0.7,      // 70% trust
    trusted_member: 0.3, // 30% trust
    member: 0.0,         // Don't learn from members
  };

  // Thresholds for pattern application
  private readonly CONFIDENCE_THRESHOLD = 0.75;  // 75%
  private readonly MIN_SUPPORTING_ACTIONS = 3;
  private readonly MAX_CONTRADICTING_ACTIONS = 2;

  constructor(memory: UnifiedMemoryStore) {
    this.memory = memory;
  }

  // ============================================
  // 1. FEEDBACK LOOP
  // ============================================

  /**
   * Record feedback on an action
   */
  async recordFeedback(feedback: ActionFeedback): Promise<void> {
    const weight = this.LEARNING_WEIGHTS[feedback.correctedBy.role];

    if (weight === 0) {
      logger.debug(`Ignoring feedback from ${feedback.correctedBy.role} (no learning weight)`);
      return;
    }

    // Store feedback in memory
    await this.memory.store({
      type: 'feedback',
      guildId: 'global',  // Feedback applies globally unless specified
      data: feedback,
      relations: {
        relatedTo: [feedback.actionId],
      },
    });

    // Update related pattern if exists
    const action = await this.memory.get(feedback.actionId);
    if (action && action.data.patternId) {
      await this.updatePattern(action.data.patternId, feedback.wasCorrect, weight);
    }

    logger.info(
      `Recorded ${feedback.wasCorrect ? 'positive' : 'negative'} feedback from ${feedback.correctedBy.role} ` +
      `(weight: ${weight})`
    );
  }

  // ============================================
  // 2. AUTHORITY HIERARCHY
  // ============================================

  /**
   * Get learning weight for a user
   */
  getUserRole(member: GuildMember): UserRole {
    if (member.guild.ownerId === member.id) return 'owner';
    if (member.permissions.has('Administrator')) return 'admin';
    if (
      member.permissions.has('ModerateMembers') ||
      member.permissions.has('KickMembers') ||
      member.permissions.has('BanMembers')
    ) {
      return 'moderator';
    }
    // Check for trusted role (configurable)
    if (member.roles.cache.some(r => r.name.toLowerCase().includes('trusted'))) {
      return 'trusted_member';
    }
    return 'member';
  }

  /**
   * Get learning weight for a role
   */
  getLearningWeight(role: UserRole): number {
    return this.LEARNING_WEIGHTS[role];
  }

  // ============================================
  // 3. CONFIDENCE THRESHOLD
  // ============================================

  /**
   * Update pattern confidence based on feedback
   */
  private async updatePattern(
    patternId: string,
    wasCorrect: boolean,
    weight: number
  ): Promise<void> {
    const patternMemory = await this.memory.get(patternId);
    if (!patternMemory || patternMemory.type !== 'pattern') return;

    const pattern: LearnedPattern = patternMemory.data;

    if (wasCorrect) {
      pattern.supportingActions += weight;
    } else {
      pattern.contradictingActions += weight;
    }

    // Recalculate confidence
    const total = pattern.supportingActions + pattern.contradictingActions;
    pattern.confidence = total > 0 ? pattern.supportingActions / total : 0;

    // Update in memory
    await this.memory.update(patternId, {
      data: pattern,
    });

    logger.debug(
      `Updated pattern ${pattern.pattern}: confidence=${pattern.confidence.toFixed(2)}, ` +
      `supporting=${pattern.supportingActions}, contradicting=${pattern.contradictingActions}`
    );
  }

  /**
   * Check if pattern should be applied
   */
  async shouldApplyPattern(patternId: string): Promise<boolean> {
    const patternMemory = await this.memory.get(patternId);
    if (!patternMemory || patternMemory.type !== 'pattern') return false;

    const pattern: LearnedPattern = patternMemory.data;

    const meetsThreshold =
      pattern.confidence >= this.CONFIDENCE_THRESHOLD &&
      pattern.supportingActions >= this.MIN_SUPPORTING_ACTIONS &&
      pattern.contradictingActions <= this.MAX_CONTRADICTING_ACTIONS;

    if (!meetsThreshold) {
      logger.debug(
        `Pattern ${pattern.pattern} does not meet threshold: ` +
        `confidence=${pattern.confidence.toFixed(2)} (need ${this.CONFIDENCE_THRESHOLD}), ` +
        `supporting=${pattern.supportingActions} (need ${this.MIN_SUPPORTING_ACTIONS}), ` +
        `contradicting=${pattern.contradictingActions} (max ${this.MAX_CONTRADICTING_ACTIONS})`
      );
    }

    return meetsThreshold;
  }

  /**
   * Get all applicable patterns for a context
   */
  async getApplicablePatterns(context: ActionContext): Promise<LearnedPattern[]> {
    const allPatterns = await this.memory.query({ type: 'pattern' });

    const applicable: LearnedPattern[] = [];

    for (const patternMemory of allPatterns) {
      const pattern: LearnedPattern = patternMemory.data;

      // Check if should apply
      if (!(await this.shouldApplyPattern(patternMemory.id))) continue;

      // Check context match
      if (this.contextMatches(pattern.context, context)) {
        applicable.push(pattern);
      }
    }

    // Sort by confidence (highest first)
    applicable.sort((a, b) => b.confidence - a.confidence);

    return applicable;
  }

  // ============================================
  // 4. CONTEXT AWARENESS
  // ============================================

  /**
   * Analyze context to determine if AI should learn from this action
   */
  async shouldLearnFromContext(context: ActionContext): Promise<boolean> {
    // Don't learn from tests
    if (context.messageIntent === 'test') {
      logger.debug('Not learning: message intent is test');
      return false;
    }

    // Don't learn from admin/mod actions in mod channels (likely testing)
    if (
      context.channelType === 'mod-chat' &&
      (context.userRole === 'admin' || context.userRole === 'moderator')
    ) {
      logger.debug('Not learning: mod/admin in mod-chat (likely test)');
      return false;
    }

    // Don't learn from owner actions (they might be testing)
    if (context.userRole === 'owner') {
      logger.debug('Not learning: action by owner (likely test)');
      return false;
    }

    return true;
  }

  /**
   * Check if two contexts match
   */
  private contextMatches(patternContext: ActionContext, currentContext: ActionContext): boolean {
    // If pattern has specific role requirement, check it
    if (patternContext.userRole && patternContext.userRole !== currentContext.userRole) {
      return false;
    }

    // If pattern has specific channel type, check it
    if (patternContext.channelType && patternContext.channelType !== currentContext.channelType) {
      return false;
    }

    // If pattern has specific intent, check it
    if (patternContext.messageIntent && patternContext.messageIntent !== currentContext.messageIntent) {
      return false;
    }

    return true;
  }

  // ============================================
  // PATTERN MANAGEMENT
  // ============================================

  /**
   * Create a new learned pattern
   */
  async createPattern(
    pattern: string,
    action: string,
    context: ActionContext,
    guildId: string
  ): Promise<string> {
    const newPattern: LearnedPattern = {
      id: this.generatePatternId(),
      pattern,
      action,
      context,
      confidence: 0.5,  // Start neutral
      supportingActions: 1,  // Initial action that created it
      contradictingActions: 0,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    };

    const memoryId = await this.memory.store({
      type: 'pattern',
      guildId,
      data: newPattern,
      relations: {
        relatedTo: [],
      },
    });

    logger.info(`Created new pattern: ${pattern} → ${action}`);
    return memoryId;
  }

  /**
   * Find patterns by description
   */
  async findPatterns(search: string, guildId?: string): Promise<LearnedPattern[]> {
    const query = guildId
      ? await this.memory.query({ type: 'pattern', guildId })
      : await this.memory.query({ type: 'pattern' });

    return query
      .map(m => m.data as LearnedPattern)
      .filter(p => p.pattern.toLowerCase().includes(search.toLowerCase()));
  }

  /**
   * Get statistics about learned patterns
   */
  async getStats(guildId?: string): Promise<{
    total: number;
    highConfidence: number;
    applicable: number;
    lowConfidence: number;
  }> {
    const query = guildId
      ? await this.memory.query({ type: 'pattern', guildId })
      : await this.memory.query({ type: 'pattern' });

    const patterns = query.map(m => m.data as LearnedPattern);

    return {
      total: patterns.length,
      highConfidence: patterns.filter(p => p.confidence >= this.CONFIDENCE_THRESHOLD).length,
      applicable: patterns.filter(p =>
        p.confidence >= this.CONFIDENCE_THRESHOLD &&
        p.supportingActions >= this.MIN_SUPPORTING_ACTIONS &&
        p.contradictingActions <= this.MAX_CONTRADICTING_ACTIONS
      ).length,
      lowConfidence: patterns.filter(p => p.confidence < 0.5).length,
    };
  }

  // ============================================
  // HELPERS
  // ============================================

  private generatePatternId(): string {
    return `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
