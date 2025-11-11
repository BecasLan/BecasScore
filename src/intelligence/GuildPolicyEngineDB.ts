/**
 * GUILD POLICY ENGINE (DATABASE VERSION)
 *
 * Enforces guild-specific policies that are LOCAL only.
 * These policies do NOT affect trust score or cross-guild status.
 *
 * Guild policies are admin-defined rules like:
 * - "No politics in #general"
 * - "No memes in #serious"
 * - "English only in #english-chat"
 *
 * CRITICAL DISTINCTION:
 * - Guild Policy Violation → LOCAL punishment (warn/timeout/ban in THIS guild)
 * - Becas Core Violation → GLOBAL punishment (trust score + cross-ban)
 *
 * Guild policies are NEVER sent to BecasCoreViolationEngine.
 */

import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';
import { getDatabaseService } from '../database/DatabaseService';
import { Guild, GuildMember, TextChannel } from 'discord.js';
import { UserAction } from './BecasCoreViolationEngine';

const logger = createLogger('GuildPolicyEngineDB');

export interface GuildPolicy {
  id: string;
  guildId: string;
  ruleText: string;
  aiInterpretation: string;
  category: string;
  actionType: 'warn' | 'timeout' | 'ban';
  actionParams: {
    duration?: number; // seconds
    reason?: string;
  };
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  learnedFrom: 'manual' | 'server_rules' | 'mod_patterns';
  sourceChannelId?: string;
  isActive: boolean;
}

export interface PolicyViolation {
  policy: GuildPolicy;
  confidence: number; // How confident AI is that this action violates the policy
  evidence?: string; // What part matched
  reasoning?: string;
}

export interface BecasContext {
  guild: Guild;
  member: GuildMember;
  channel: TextChannel;
}

export class GuildPolicyEngineDB {
  private ollama: OllamaService;
  private db: any;
  private policyCache: Map<string, GuildPolicy[]>; // guildId -> policies

  constructor() {
    this.ollama = new OllamaService('guildPolicyMatching');
    this.db = getDatabaseService();
    this.policyCache = new Map();
    logger.info('GuildPolicyEngineDB initialized');
  }

  /**
   * Check if user action violates ANY guild policies (LOCAL only)
   */
  async checkViolations(
    action: UserAction,
    context: BecasContext
  ): Promise<PolicyViolation[]> {
    if (!action.content) return [];

    try {
      // Load guild policies from cache/db
      const policies = await this.getGuildPolicies(context.guild.id);

      if (policies.length === 0) {
        return [];
      }

      const violations: PolicyViolation[] = [];

      // Check each policy
      for (const policy of policies) {
        // Skip if policy is channel-specific and doesn't match
        if (
          policy.sourceChannelId &&
          policy.sourceChannelId !== action.channelId
        ) {
          continue;
        }

        const matches = await this.matchesPolicy(action, policy, context);

        if (matches.isViolation && matches.confidence > 0.7) {
          violations.push({
            policy,
            confidence: matches.confidence,
            evidence: matches.evidence,
            reasoning: matches.reasoning,
          });

          logger.info(
            `Guild policy violation: "${policy.ruleText}" (confidence: ${matches.confidence})`
          );
        }
      }

      return violations;
    } catch (error: any) {
      logger.error('Policy check error:', error);
      return [];
    }
  }

  /**
   * Check if action matches a specific policy
   */
  private async matchesPolicy(
    action: UserAction,
    policy: GuildPolicy,
    context: BecasContext
  ): Promise<{
    isViolation: boolean;
    confidence: number;
    evidence?: string;
    reasoning?: string;
  }> {
    try {
      const systemPrompt = `You are a guild policy matcher for Discord moderation.

Task: Determine if user's message violates this guild-specific rule.

Guild Rule: "${policy.ruleText}"
AI Interpretation: "${policy.aiInterpretation}"

RESPONSE FORMAT (JSON only):
{
  "isViolation": true/false,
  "confidence": 0.0-1.0,
  "evidence": "<specific part that violates>",
  "reasoning": "<why it violates/doesn't violate>"
}

Important:
- This is a GUILD-SPECIFIC rule, not a global Becas rule
- Be strict but fair
- Only flag clear violations (confidence > 0.7)
- Consider context and intent`;

      const userPrompt = `User message: "${action.content}"
Channel: ${context.channel.name}
User: ${context.member.user.tag}

Does this violate the rule?`;

      const response = await this.ollama.generate(systemPrompt, userPrompt);

      // Parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { isViolation: false, confidence: 0 };
      }

      const result = JSON.parse(jsonMatch[0]);

      return {
        isViolation: result.isViolation === true,
        confidence: result.confidence || 0,
        evidence: result.evidence,
        reasoning: result.reasoning,
      };
    } catch (error: any) {
      logger.error('Policy matching error:', error);
      return { isViolation: false, confidence: 0 };
    }
  }

  /**
   * Enforce LOCAL actions for policy violations
   * CRITICAL: Does NOT affect trust score
   */
  async enforceLocalActions(
    violations: PolicyViolation[],
    context: BecasContext
  ): Promise<void> {
    for (const violation of violations) {
      try {
        // 1. Log enforcement
        await this.logEnforcement(violation, context);

        // 2. Execute LOCAL action (warn/timeout/ban)
        await this.executeLocalAction(violation, context);

        logger.info(
          `Local action executed: ${violation.policy.actionType} for policy "${violation.policy.ruleText}"`
        );
      } catch (error: any) {
        logger.error('Local action enforcement error:', error);
      }
    }
  }

  /**
   * Execute LOCAL action (warn/timeout/ban in THIS guild only)
   */
  private async executeLocalAction(
    violation: PolicyViolation,
    context: BecasContext
  ): Promise<void> {
    const { policy } = violation;
    const reason =
      policy.actionParams.reason || `Guild policy: ${policy.ruleText}`;

    try {
      switch (policy.actionType) {
        case 'warn':
          await context.channel.send(
            `⚠️ ${context.member}, warning: ${reason}`
          );
          logger.info(`User ${context.member.user.tag} warned (guild policy)`);
          break;

        case 'timeout':
          if (policy.actionParams.duration) {
            await context.member.timeout(
              policy.actionParams.duration * 1000,
              reason
            );
            logger.info(
              `User ${context.member.user.tag} timed out for ${policy.actionParams.duration}s (guild policy)`
            );
          }
          break;

        case 'ban':
          await context.guild.members.ban(context.member, { reason });
          logger.warn(
            `User ${context.member.user.tag} banned from ${context.guild.name} (guild policy)`
          );
          break;
      }
    } catch (error: any) {
      logger.error('Local action execution error:', error);
    }
  }

  /**
   * Log policy enforcement to database
   */
  private async logEnforcement(
    violation: PolicyViolation,
    context: BecasContext
  ): Promise<void> {
    try {
      await this.db.query(
        `
        INSERT INTO guild_policy_enforcement (
          guild_id, policy_id, user_id, message_content, channel_id,
          action_taken, confidence
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
        [
          context.guild.id,
          violation.policy.id,
          context.member.id,
          violation.evidence || '',
          context.channel.id,
          violation.policy.actionType,
          violation.confidence,
        ]
      );
    } catch (error: any) {
      logger.error('Enforcement logging error:', error);
    }
  }

  /**
   * Get guild policies from cache or database
   */
  async getGuildPolicies(guildId: string): Promise<GuildPolicy[]> {
    // Check cache first
    if (this.policyCache.has(guildId)) {
      return this.policyCache.get(guildId)!;
    }

    // Load from database
    try {
      const result = await this.db.query(
        `
        SELECT
          id, guild_id, rule_text, ai_interpretation, category,
          action_type, action_params, severity, confidence,
          learned_from, source_channel_id, is_active
        FROM guild_policies
        WHERE guild_id = $1 AND is_active = true
        ORDER BY severity DESC
      `,
        [guildId]
      );

      const policies: GuildPolicy[] = result.rows.map((row: any) => ({
        id: row.id,
        guildId: row.guild_id,
        ruleText: row.rule_text,
        aiInterpretation: row.ai_interpretation,
        category: row.category,
        actionType: row.action_type,
        actionParams: row.action_params,
        severity: row.severity,
        confidence: row.confidence,
        learnedFrom: row.learned_from,
        sourceChannelId: row.source_channel_id,
        isActive: row.is_active,
      }));

      // Cache for 5 minutes
      this.policyCache.set(guildId, policies);
      setTimeout(() => this.policyCache.delete(guildId), 5 * 60 * 1000);

      logger.info(`Loaded ${policies.length} policies for guild ${guildId}`);
      return policies;
    } catch (error: any) {
      logger.error('Policy loading error:', error);
      return [];
    }
  }

  /**
   * Clear policy cache for guild (call after adding/updating policies)
   */
  clearCache(guildId: string): void {
    this.policyCache.delete(guildId);
    logger.info(`Policy cache cleared for guild ${guildId}`);
  }

  /**
   * Add new guild policy manually
   */
  async addPolicy(policy: Omit<GuildPolicy, 'id'>): Promise<string | null> {
    try {
      const result = await this.db.query(
        `
        INSERT INTO guild_policies (
          guild_id, rule_text, ai_interpretation, category,
          action_type, action_params, severity, confidence,
          learned_from, source_channel_id, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `,
        [
          policy.guildId,
          policy.ruleText,
          policy.aiInterpretation,
          policy.category,
          policy.actionType,
          JSON.stringify(policy.actionParams),
          policy.severity,
          policy.confidence,
          policy.learnedFrom,
          policy.sourceChannelId || null,
          policy.isActive,
        ]
      );

      const policyId = result.rows[0].id;
      this.clearCache(policy.guildId);

      logger.info(`Policy added: "${policy.ruleText}" for guild ${policy.guildId}`);
      return policyId;
    } catch (error: any) {
      logger.error('Policy addition error:', error);
      return null;
    }
  }

  /**
   * Update existing policy
   */
  async updatePolicy(
    policyId: string,
    updates: Partial<GuildPolicy>
  ): Promise<boolean> {
    try {
      const fields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.ruleText !== undefined) {
        fields.push(`rule_text = $${paramIndex++}`);
        values.push(updates.ruleText);
      }
      if (updates.aiInterpretation !== undefined) {
        fields.push(`ai_interpretation = $${paramIndex++}`);
        values.push(updates.aiInterpretation);
      }
      if (updates.actionType !== undefined) {
        fields.push(`action_type = $${paramIndex++}`);
        values.push(updates.actionType);
      }
      if (updates.actionParams !== undefined) {
        fields.push(`action_params = $${paramIndex++}`);
        values.push(JSON.stringify(updates.actionParams));
      }
      if (updates.isActive !== undefined) {
        fields.push(`is_active = $${paramIndex++}`);
        values.push(updates.isActive);
      }

      if (fields.length === 0) return false;

      values.push(policyId);

      await this.db.query(
        `UPDATE guild_policies SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
        values
      );

      // Clear cache for this guild
      const guildResult = await this.db.query(
        'SELECT guild_id FROM guild_policies WHERE id = $1',
        [policyId]
      );
      if (guildResult.rows.length > 0) {
        this.clearCache(guildResult.rows[0].guild_id);
      }

      logger.info(`Policy updated: ${policyId}`);
      return true;
    } catch (error: any) {
      logger.error('Policy update error:', error);
      return false;
    }
  }

  /**
   * Delete policy (soft delete by setting is_active = false)
   */
  async deletePolicy(policyId: string): Promise<boolean> {
    return this.updatePolicy(policyId, { isActive: false });
  }
}
