/**
 * POLICY LEARNING ENGINE
 *
 * Learns from moderation patterns and suggests new guild policies.
 * Watches moderation actions (bans, timeouts, warns) and detects patterns.
 *
 * Features:
 * - Monitors moderation actions in real-time
 * - Detects patterns after 3+ similar actions
 * - Suggests new policies via policy_learning_candidates table
 * - Sends Discord messages to admins for approval
 * - Creates guild policies when approved by admins
 *
 * CRITICAL: This creates GUILD policies (LOCAL enforcement only).
 * These do NOT affect trust score or cross-guild status.
 */

import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';
import { getDatabaseService } from '../database/DatabaseService';
import { Client, Guild, TextChannel, EmbedBuilder, User } from 'discord.js';

const logger = createLogger('PolicyLearningEngine');

export interface ModerationAction {
  guildId: string;
  userId: string;
  moderatorId: string;
  actionType: 'ban' | 'timeout' | 'warn' | 'kick';
  reason: string;
  content?: string; // What the user said/did
  channelId?: string;
  timestamp: Date;
}

export interface DetectedPattern {
  guildId: string;
  patternType: 'repeated_moderation' | 'similar_content';
  patternDescription: string;
  exampleActions: ModerationAction[];
  occurrenceCount: number;
  suggestedRule: string;
  suggestedAction: 'warn' | 'timeout' | 'ban';
  suggestedSeverity: 'low' | 'medium' | 'high';
  confidence: number;
}

export class PolicyLearningEngine {
  private ollamaLearning: OllamaService;
  private ollamaSynthesis: OllamaService;
  private db: ReturnType<typeof getDatabaseService>;
  private client: Client | null = null;
  private recentActions: Map<string, ModerationAction[]>; // guildId -> actions

  // Minimum actions needed to detect a pattern
  private readonly PATTERN_THRESHOLD = 3;

  // Time window for pattern detection (7 days)
  private readonly PATTERN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

  constructor() {
    this.ollamaLearning = new OllamaService('policyLearning');
    this.ollamaSynthesis = new OllamaService('policySynthesis');
    this.db = getDatabaseService();
    this.recentActions = new Map();
    logger.info('PolicyLearningEngine initialized');
  }

  /**
   * Initialize with Discord client
   */
  initialize(client: Client): void {
    this.client = client;
    logger.info('PolicyLearningEngine attached to Discord client');

    // Load recent actions from database (last 7 days)
    this.loadRecentActions();
  }

  /**
   * Load recent moderation actions from database
   */
  private async loadRecentActions(): Promise<void> {
    try {
      const sevenDaysAgo = new Date(Date.now() - this.PATTERN_WINDOW_MS);

      // Load from guild_policy_enforcement table (local guild actions)
      const actions = await this.db.queryMany<any>(
        `
        SELECT
          gpe.guild_id,
          gpe.user_id,
          gpe.action_taken as action_type,
          gp.rule_text as reason,
          gpe.message_content as content,
          gpe.channel_id,
          gpe.timestamp
        FROM guild_policy_enforcement gpe
        LEFT JOIN guild_policies gp ON gpe.policy_id = gp.id
        WHERE gpe.timestamp > $1
        ORDER BY gpe.timestamp DESC
        LIMIT 1000
      `,
        [sevenDaysAgo]
      );

      // Group by guild
      for (const action of actions) {
        const guildId = action.guild_id;
        if (!this.recentActions.has(guildId)) {
          this.recentActions.set(guildId, []);
        }

        this.recentActions.get(guildId)!.push({
          guildId: action.guild_id,
          userId: action.user_id,
          moderatorId: 'system', // Guild policy enforcement doesn't track moderator
          actionType: action.action_type,
          reason: action.reason || 'Policy violation',
          content: action.content,
          channelId: action.channel_id,
          timestamp: new Date(action.timestamp),
        });
      }

      logger.info(`Loaded ${actions.length} recent moderation actions for pattern learning`);
    } catch (error: any) {
      // Check if it's a connection error
      if (error.message?.includes('ENOTFOUND') || error.message?.includes('ETIMEDOUT') || error.message?.includes('getaddrinfo')) {
        logger.warn('⚠️ Database connection failed - continuing in offline mode. Policy learning will resume when connection is restored.');
      } else {
        logger.warn('Failed to load recent actions (table may not exist):', error.message);
      }
      // Continue anyway - will learn from new actions when connection is restored
    }
  }

  /**
   * Record a moderation action and check for patterns
   */
  async recordModerationAction(action: ModerationAction): Promise<void> {
    try {
      // Add to in-memory cache
      if (!this.recentActions.has(action.guildId)) {
        this.recentActions.set(action.guildId, []);
      }
      this.recentActions.get(action.guildId)!.push(action);

      // Clean old actions (outside 7-day window)
      this.cleanOldActions(action.guildId);

      logger.info(
        `Recorded moderation action: ${action.actionType} on user ${action.userId} ` +
        `in guild ${action.guildId} (reason: ${action.reason})`
      );

      // Check for patterns
      const guildActions = this.recentActions.get(action.guildId) || [];
      if (guildActions.length >= this.PATTERN_THRESHOLD) {
        await this.checkForPatterns(action.guildId, guildActions);
      }

    } catch (error: any) {
      logger.error('Failed to record moderation action:', error);
    }
  }

  /**
   * Clean actions older than 7 days
   */
  private cleanOldActions(guildId: string): void {
    const actions = this.recentActions.get(guildId);
    if (!actions) return;

    const cutoff = Date.now() - this.PATTERN_WINDOW_MS;
    const filtered = actions.filter(a => a.timestamp.getTime() > cutoff);

    this.recentActions.set(guildId, filtered);
  }

  /**
   * Check for moderation patterns
   */
  private async checkForPatterns(
    guildId: string,
    actions: ModerationAction[]
  ): Promise<void> {
    try {
      // Use AI to detect patterns
      const patterns = await this.detectPatterns(guildId, actions);

      for (const pattern of patterns) {
        // Check if we already have a similar candidate
        const existingCandidate = await this.findSimilarCandidate(guildId, pattern);

        if (existingCandidate) {
          // Update occurrence count
          await this.updateCandidateOccurrence(existingCandidate.id, pattern);
        } else {
          // Create new candidate and notify admins
          await this.createPolicyCandidate(pattern);
          await this.notifyAdmins(pattern);
        }
      }

    } catch (error: any) {
      logger.error('Failed to check for patterns:', error);
    }
  }

  /**
   * Detect patterns using AI
   */
  private async detectPatterns(
    guildId: string,
    actions: ModerationAction[]
  ): Promise<DetectedPattern[]> {
    try {
      // Group actions by similarity
      const actionSummaries = actions.slice(-20).map(a => ({
        actionType: a.actionType,
        reason: a.reason,
        content: a.content?.substring(0, 100),
        timestamp: a.timestamp.toISOString(),
      }));

      const systemPrompt = `You are a moderation pattern detector. Analyze moderation actions and identify patterns that could become server rules.

Look for:
1. Repeated moderation for similar reasons (3+ times)
2. Similar content violations
3. Behavior patterns that warrant a policy

For each pattern found, provide:
- patternType: "repeated_moderation" or "similar_content"
- patternDescription: Brief description of the pattern
- suggestedRule: A clear rule that would prevent this
- suggestedAction: "warn", "timeout", or "ban"
- suggestedSeverity: "low", "medium", or "high"
- confidence: 0.0-1.0 (how confident you are this is a real pattern)

RESPONSE FORMAT (JSON array):
[
  {
    "patternType": "repeated_moderation",
    "patternDescription": "Multiple users posting crypto/NFT advertisements",
    "suggestedRule": "No cryptocurrency or NFT promotion",
    "suggestedAction": "timeout",
    "suggestedSeverity": "medium",
    "confidence": 0.85
  }
]

Only suggest patterns with 3+ occurrences. Return empty array [] if no patterns found.`;

      const userPrompt = `Analyze these recent moderation actions for patterns:\n\n${JSON.stringify(actionSummaries, null, 2)}`;

      const response = await this.ollamaLearning.generate(userPrompt, systemPrompt, {
        temperature: 0.4,
        maxTokens: 500,
        format: 'json',
      });

      // Parse JSON response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }

      const rawPatterns = JSON.parse(jsonMatch[0]) as any[];

      // Filter by confidence and threshold
      const validPatterns = rawPatterns
        .filter(p => p.confidence >= 0.7)
        .map(p => ({
          guildId,
          patternType: p.patternType,
          patternDescription: p.patternDescription,
          exampleActions: actions.slice(-5), // Last 5 actions as examples
          occurrenceCount: this.countPatternOccurrences(p, actions),
          suggestedRule: p.suggestedRule,
          suggestedAction: p.suggestedAction,
          suggestedSeverity: p.suggestedSeverity,
          confidence: p.confidence,
        }))
        .filter(p => p.occurrenceCount >= this.PATTERN_THRESHOLD);

      logger.info(`Detected ${validPatterns.length} valid patterns for guild ${guildId}`);
      return validPatterns;

    } catch (error: any) {
      logger.error('Failed to detect patterns:', error);
      return [];
    }
  }

  /**
   * Count how many actions match this pattern
   */
  private countPatternOccurrences(pattern: any, actions: ModerationAction[]): number {
    // Simple heuristic: count actions with similar reasons
    const keywords = pattern.suggestedRule.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);

    return actions.filter(a => {
      const reasonLower = (a.reason || '').toLowerCase();
      const contentLower = (a.content || '').toLowerCase();
      return keywords.some((kw: string) => reasonLower.includes(kw) || contentLower.includes(kw));
    }).length;
  }

  /**
   * Find similar existing candidate
   */
  private async findSimilarCandidate(
    guildId: string,
    pattern: DetectedPattern
  ): Promise<{ id: string } | null> {
    try {
      // Try similarity search first
      const result = await this.db.queryOne<{ id: string }>(
        `
        SELECT id FROM policy_learning_candidates
        WHERE guild_id = $1
          AND status = 'pending'
          AND similarity(suggested_rule, $2) > 0.7
        ORDER BY similarity(suggested_rule, $2) DESC
        LIMIT 1
      `,
        [guildId, pattern.suggestedRule]
      );

      return result;
    } catch (error: any) {
      // Fallback to exact match
      try {
        const result = await this.db.queryOne<{ id: string }>(
          `
          SELECT id FROM policy_learning_candidates
          WHERE guild_id = $1
            AND status = 'pending'
            AND suggested_rule = $2
          LIMIT 1
        `,
          [guildId, pattern.suggestedRule]
        );
        return result;
      } catch (fallbackError: any) {
        return null;
      }
    }
  }

  /**
   * Update candidate occurrence count
   */
  private async updateCandidateOccurrence(candidateId: string, pattern: DetectedPattern): Promise<void> {
    try {
      await this.db.query(
        `
        UPDATE policy_learning_candidates
        SET occurrence_count = occurrence_count + 1,
            last_occurrence = NOW(),
            example_actions = $2
        WHERE id = $1
      `,
        [candidateId, JSON.stringify(pattern.exampleActions.slice(0, 5))]
      );

      logger.info(`Updated candidate ${candidateId} occurrence count`);
    } catch (error: any) {
      logger.error('Failed to update candidate:', error);
    }
  }

  /**
   * Create new policy candidate
   */
  private async createPolicyCandidate(pattern: DetectedPattern): Promise<void> {
    try {
      await this.db.insert('policy_learning_candidates', {
        guild_id: pattern.guildId,
        pattern_type: pattern.patternType,
        pattern_description: pattern.patternDescription,
        example_actions: JSON.stringify(pattern.exampleActions.slice(0, 5)),
        occurrence_count: pattern.occurrenceCount,
        suggested_rule: pattern.suggestedRule,
        suggested_action: pattern.suggestedAction,
        suggested_severity: pattern.suggestedSeverity,
        status: 'pending',
      });

      logger.info(`Created policy candidate: ${pattern.suggestedRule}`);
    } catch (error: any) {
      logger.error('Failed to create policy candidate:', error);
    }
  }

  /**
   * Notify admins about new policy suggestion
   */
  private async notifyAdmins(pattern: DetectedPattern): Promise<void> {
    try {
      if (!this.client) return;

      const guild = this.client.guilds.cache.get(pattern.guildId);
      if (!guild) return;

      // Find a suitable notification channel (general, admin-chat, mod-chat, etc.)
      const channels = await guild.channels.fetch();
      const notificationChannel = Array.from(channels.values()).find(ch => {
        if (ch?.type !== 0) return false; // Must be text channel
        const name = ch.name.toLowerCase();
        return name.includes('admin') || name.includes('mod') || name === 'general';
      }) as TextChannel | undefined;

      if (!notificationChannel) {
        logger.warn(`No notification channel found for guild ${pattern.guildId}`);
        return;
      }

      // Create embed
      const embed = new EmbedBuilder()
        .setTitle('🤖 New Policy Suggestion (Becas AI Learning)')
        .setDescription(
          `Becas has detected a moderation pattern and suggests creating a new server rule.`
        )
        .setColor(0x5865F2) // Discord blurple
        .addFields(
          {
            name: '📊 Pattern Detected',
            value: pattern.patternDescription,
            inline: false,
          },
          {
            name: '📋 Suggested Rule',
            value: pattern.suggestedRule,
            inline: false,
          },
          {
            name: '⚠️ Suggested Action',
            value: `${pattern.suggestedAction} (${pattern.suggestedSeverity} severity)`,
            inline: true,
          },
          {
            name: '📈 Occurrences',
            value: `${pattern.occurrenceCount} similar cases`,
            inline: true,
          },
          {
            name: '🎯 Confidence',
            value: `${(pattern.confidence * 100).toFixed(0)}%`,
            inline: true,
          }
        )
        .setFooter({ text: 'React with ✅ to approve, ❌ to reject' })
        .setTimestamp();

      const message = await notificationChannel.send({ embeds: [embed] });

      // Add reactions
      await message.react('✅');
      await message.react('❌');

      logger.info(`Sent policy suggestion notification to guild ${pattern.guildId}`);

    } catch (error: any) {
      logger.error('Failed to notify admins:', error);
    }
  }

  /**
   * Approve a policy candidate (called when admin reacts with ✅)
   */
  async approveCandidate(candidateId: string, adminId: string): Promise<void> {
    try {
      // Get candidate
      const candidate = await this.db.queryOne<any>(
        'SELECT * FROM policy_learning_candidates WHERE id = $1',
        [candidateId]
      );

      if (!candidate || candidate.status !== 'pending') {
        logger.warn(`Cannot approve candidate ${candidateId}: not found or not pending`);
        return;
      }

      // Create guild policy
      await this.db.insert('guild_policies', {
        guild_id: candidate.guild_id,
        rule_text: candidate.suggested_rule,
        ai_interpretation: candidate.pattern_description,
        category: 'behavior', // Default category
        action_type: candidate.suggested_action,
        action_params: JSON.stringify({
          duration: candidate.suggested_action === 'timeout' ? 3600 : undefined,
          reason: candidate.suggested_rule,
        }),
        severity: candidate.suggested_severity,
        confidence: 0.8, // Approved by admin
        learned_from: 'mod_patterns',
        created_by: adminId,
        is_active: true,
      });

      // Update candidate status
      await this.db.update(
        'policy_learning_candidates',
        {
          status: 'approved',
          reviewed_by: adminId,
          reviewed_at: new Date().toISOString(),
        },
        { id: candidateId }
      );

      logger.info(`Policy candidate ${candidateId} approved and created`);

    } catch (error: any) {
      logger.error('Failed to approve candidate:', error);
    }
  }

  /**
   * Reject a policy candidate (called when admin reacts with ❌)
   */
  async rejectCandidate(candidateId: string, adminId: string): Promise<void> {
    try {
      await this.db.update(
        'policy_learning_candidates',
        {
          status: 'rejected',
          reviewed_by: adminId,
          reviewed_at: new Date().toISOString(),
        },
        { id: candidateId }
      );

      logger.info(`Policy candidate ${candidateId} rejected`);
    } catch (error: any) {
      logger.error('Failed to reject candidate:', error);
    }
  }

  /**
   * Get pending policy candidates for a guild
   */
  async getPendingCandidates(guildId: string): Promise<any[]> {
    try {
      return await this.db.queryMany(
        `
        SELECT * FROM policy_learning_candidates
        WHERE guild_id = $1 AND status = 'pending'
        ORDER BY occurrence_count DESC, first_detected DESC
        LIMIT 10
      `,
        [guildId]
      );
    } catch (error: any) {
      logger.error('Failed to get pending candidates:', error);
      return [];
    }
  }
}
