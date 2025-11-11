/**
 * BECAS CORE VIOLATION ENGINE
 *
 * Detects GLOBAL violations that affect trust score across ALL guilds.
 * These are universal rules that Becas enforces regardless of guild policies.
 *
 * Core Violations:
 * - Profanity / Offensive language
 * - Hate speech / Discrimination
 * - Harassment / Bullying
 * - Spam / Flooding
 * - Scam / Phishing attempts
 * - Explicit content (NSFW)
 * - Doxxing (personal info sharing)
 * - Raiding / Brigading
 * - Impersonation
 *
 * CRITICAL: Guild policies do NOT trigger this engine.
 * ONLY universal violations that Becas core defines.
 */

import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';
import { getDatabaseService } from '../database/DatabaseService';
import { Guild, GuildMember, TextChannel } from 'discord.js';
import { TrustScoreEngineDB } from '../systems/TrustScoreEngineDB';

const logger = createLogger('BecasCoreViolationEngine');

export interface UserAction {
  type: 'message' | 'reaction' | 'join' | 'leave';
  content?: string;
  userId: string;
  channelId?: string;
  timestamp: Date;
}

export interface CoreViolation {
  type: CoreViolationType;
  detected: boolean;
  confidence: number; // 0-1
  severity: 'low' | 'medium' | 'high' | 'critical';
  evidence?: string; // What part of content triggered it
  reasoning?: string;

  // Punishment
  trustPenalty: number; // How much to decrease trust score
  actionType: 'none' | 'timeout' | 'ban' | 'cross_ban';
  timeoutDuration?: number; // seconds
}

export type CoreViolationType =
  | 'profanity'
  | 'hate_speech'
  | 'harassment'
  | 'spam'
  | 'scam'
  | 'explicit_content'
  | 'doxxing'
  | 'raiding'
  | 'impersonation';

export interface BecasContext {
  guild: Guild;
  member: GuildMember;
  channel: TextChannel;
}

export class BecasCoreViolationEngine {
  private ollama: OllamaService;
  private db: any;
  private trustEngine: TrustScoreEngineDB;

  // Violation types and their base penalties
  private readonly violationPenalties: Record<
    CoreViolationType,
    { low: number; medium: number; high: number; critical: number }
  > = {
    profanity: { low: 5, medium: 10, high: 20, critical: 30 },
    hate_speech: { low: 15, medium: 30, high: 50, critical: 80 },
    harassment: { low: 10, medium: 25, high: 40, critical: 60 },
    spam: { low: 3, medium: 7, high: 15, critical: 25 },
    scam: { low: 20, medium: 40, high: 60, critical: 90 },
    explicit_content: { low: 15, medium: 30, high: 50, critical: 70 },
    doxxing: { low: 40, medium: 60, high: 80, critical: 100 },
    raiding: { low: 30, medium: 50, high: 70, critical: 90 },
    impersonation: { low: 10, medium: 20, high: 35, critical: 50 },
  };

  constructor() {
    this.ollama = new OllamaService('coreViolationDetection');
    this.db = getDatabaseService();
    this.trustEngine = new TrustScoreEngineDB();
    logger.info('BecasCoreViolationEngine initialized');
  }

  /**
   * Check if user action violates ANY Becas core rules
   * 🔥 PERFORMANCE FIX: Single unified AI call instead of 9 separate calls
   */
  async checkCoreViolations(
    action: UserAction,
    context: BecasContext
  ): Promise<CoreViolation[]> {
    if (!action.content) return [];

    try {
      // 🔥 NEW APPROACH: Single AI call to check ALL violations at once
      logger.info('🛡️ Running unified violation detection (1 AI call)...');
      const startTime = Date.now();

      const systemPrompt = `You are a content moderation AI. Analyze the message for ALL these violation types:

1. profanity - Offensive language, swear words, vulgar terms
2. hate_speech - Discrimination, slurs, bigotry
3. harassment - Bullying, threats, personal attacks
4. spam - Repetitive content, flooding, mass mentions
5. scam - Phishing, fraud, malicious links
6. explicit_content - NSFW, sexual content
7. doxxing - Sharing personal info (addresses, phone numbers, etc.)
8. raiding - Coordinated attacks, brigading
9. impersonation - Pretending to be someone else

Return ONLY valid JSON (no other text) with this structure:
{
  "violations": [
    {"type": "violation_name", "confidence": 0.0-1.0, "severity": "low|medium|high|critical", "evidence": "quoted text", "reasoning": "why detected"}
  ]
}

IMPORTANT:
- confidence must be 0.0-1.0 (e.g., 0.8, not 80)
- Only include violations with confidence >= 0.7
- severity levels: low (minor), medium (moderate), high (serious), critical (severe)
- If NO violations detected, return: {"violations": []}`;

      const userPrompt = `Message: "${action.content}"

Analyze for ALL violation types and return JSON.`;

      const response = await this.ollama.generateJSON<{ violations: any[] }>(
        userPrompt,
        systemPrompt
      );

      const duration = Date.now() - startTime;
      logger.info(`✅ Unified violation check completed in ${duration}ms (1 AI call vs 9)`);

      // Parse violations from unified response
      const violations: CoreViolation[] = [];

      if (!response.violations || response.violations.length === 0) {
        logger.info('✅ No violations detected');
        return [];
      }

      for (const v of response.violations) {
        if (!v.type || v.confidence < 0.7) continue;

        const violationType = v.type as CoreViolationType;
        const severity = v.severity || 'medium';
        const penalty = this.violationPenalties[violationType]?.[severity] || 10;

        // Determine action based on severity
        let actionType: CoreViolation['actionType'] = 'none';
        let timeoutDuration: number | undefined;

        if (severity === 'critical') {
          actionType = 'ban';
        } else if (severity === 'high') {
          actionType = 'timeout';
          timeoutDuration = 3600; // 1 hour
        } else if (severity === 'medium') {
          actionType = 'timeout';
          timeoutDuration = 600; // 10 minutes
        }

        violations.push({
          type: violationType,
          detected: true,
          confidence: v.confidence,
          severity,
          evidence: v.evidence,
          reasoning: v.reasoning,
          trustPenalty: penalty,
          actionType,
          timeoutDuration,
        });

        logger.warn(
          `Core violation detected: ${violationType} (confidence: ${v.confidence}, severity: ${severity})`
        );
      }

      return violations;
    } catch (error: any) {
      logger.error('Core violation check error:', error);
      // Fail-safe: Return empty array instead of crashing
      return [];
    }
  }

  /**
   * Detect specific violation type using AI
   */
  private async detectViolation(
    action: UserAction,
    violationType: CoreViolationType
  ): Promise<CoreViolation> {
    try {
      const systemPrompt = this.getViolationPrompt(violationType);
      const userPrompt = `Content: "${action.content}"\n\nAnalyze for ${violationType}.`;

      const response = await this.ollama.generate(systemPrompt, userPrompt);

      // Parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.createEmptyViolation(violationType);
      }

      const result = JSON.parse(jsonMatch[0]);

      // If not detected, return empty
      if (!result.detected || result.confidence < 0.7) {
        return this.createEmptyViolation(violationType);
      }

      // Calculate penalty
      const severity = result.severity || 'medium';
      const trustPenalty = this.violationPenalties[violationType][severity];

      return {
        type: violationType,
        detected: true,
        confidence: result.confidence,
        severity,
        evidence: result.evidence,
        reasoning: result.reasoning,
        trustPenalty,
        actionType: this.determineActionType(severity),
        timeoutDuration: this.getTimeoutDuration(severity),
      };
    } catch (error: any) {
      logger.error(`Violation detection error (${violationType}):`, error);
      return this.createEmptyViolation(violationType);
    }
  }

  /**
   * Get AI prompt for specific violation type
   */
  private getViolationPrompt(violationType: CoreViolationType): string {
    const prompts: Record<CoreViolationType, string> = {
      profanity: `You are a profanity detector. Detect offensive language, curse words, vulgar terms.

RESPONSE FORMAT (JSON only):
{
  "detected": true/false,
  "confidence": 0.0-1.0,
  "severity": "low" | "medium" | "high" | "critical",
  "evidence": "<specific word/phrase>",
  "reasoning": "<why it's profanity>"
}

Examples:
- "fuck you" → detected: true, severity: high
- "damn" → detected: true, severity: low
- "hello" → detected: false`,

      hate_speech: `You are a hate speech detector. Detect discrimination, slurs, racism, homophobia, transphobia, etc.

RESPONSE FORMAT (JSON only):
{
  "detected": true/false,
  "confidence": 0.0-1.0,
  "severity": "low" | "medium" | "high" | "critical",
  "evidence": "<specific content>",
  "reasoning": "<why it's hate speech>"
}

CRITICAL: This is GLOBAL enforcement. Only flag clear hate speech.`,

      harassment: `You are a harassment detector. Detect bullying, threats, targeted attacks.

RESPONSE FORMAT (JSON only):
{
  "detected": true/false,
  "confidence": 0.0-1.0,
  "severity": "low" | "medium" | "high" | "critical",
  "evidence": "<specific content>",
  "reasoning": "<why it's harassment>"
}`,

      spam: `You are a spam detector. Detect repetitive messages, flooding, excessive caps/emojis.

RESPONSE FORMAT (JSON only):
{
  "detected": true/false,
  "confidence": 0.0-1.0,
  "severity": "low" | "medium" | "high" | "critical",
  "evidence": "<spam pattern>",
  "reasoning": "<why it's spam>"
}`,

      scam: `You are a scam detector. Detect phishing, fake links, money requests, "free nitro", etc.

RESPONSE FORMAT (JSON only):
{
  "detected": true/false,
  "confidence": 0.0-1.0,
  "severity": "low" | "medium" | "high" | "critical",
  "evidence": "<scam indicator>",
  "reasoning": "<why it's a scam>"
}`,

      explicit_content: `You are an NSFW content detector. Detect sexual content, pornography references.

RESPONSE FORMAT (JSON only):
{
  "detected": true/false,
  "confidence": 0.0-1.0,
  "severity": "low" | "medium" | "high" | "critical",
  "evidence": "<explicit content>",
  "reasoning": "<why it's explicit>"
}`,

      doxxing: `You are a doxxing detector. Detect personal info sharing: addresses, phone numbers, IPs, etc.

RESPONSE FORMAT (JSON only):
{
  "detected": true/false,
  "confidence": 0.0-1.0,
  "severity": "low" | "medium" | "high" | "critical",
  "evidence": "<personal info shared>",
  "reasoning": "<why it's doxxing>"
}`,

      raiding: `You are a raid detector. Detect raid organization, brigading calls, mass join coordination.

RESPONSE FORMAT (JSON only):
{
  "detected": true/false,
  "confidence": 0.0-1.0,
  "severity": "low" | "medium" | "high" | "critical",
  "evidence": "<raid call>",
  "reasoning": "<why it's raiding>"
}`,

      impersonation: `You are an impersonation detector. Detect pretending to be staff/admins/bots.

RESPONSE FORMAT (JSON only):
{
  "detected": true/false,
  "confidence": 0.0-1.0,
  "severity": "low" | "medium" | "high" | "critical",
  "evidence": "<impersonation claim>",
  "reasoning": "<why it's impersonation>"
}`,
    };

    return prompts[violationType];
  }

  /**
   * Apply GLOBAL punishment for core violation
   */
  async applyGlobalPunishment(
    violation: CoreViolation,
    action: UserAction,
    context: BecasContext
  ): Promise<void> {
    try {
      // 1. Log violation to database
      await this.logViolation(violation, action, context);

      // 2. Decrease trust score (GLOBAL - affects all guilds)
      await this.trustEngine.decreaseScoreForCoreViolation(
        action.userId,
        context.guild.id,
        violation.trustPenalty,
        violation.type,
        violation.reasoning || 'Core violation detected'
      );
      logger.info(
        `Trust penalty applied: -${violation.trustPenalty} for ${violation.type}`
      );

      // 3. Execute punishment action
      await this.executePunishment(violation, context);
    } catch (error: any) {
      logger.error('Global punishment error:', error);
    }
  }

  /**
   * Log violation to database
   */
  private async logViolation(
    violation: CoreViolation,
    action: UserAction,
    context: BecasContext
  ): Promise<void> {
    try {
      await this.db.query(
        `
        INSERT INTO becas_core_violations (
          user_id, guild_id, violation_type, content, channel_id,
          severity, confidence, trust_penalty, action_taken, action_params
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
        [
          action.userId,
          context.guild.id,
          violation.type,
          action.content || '',
          action.channelId || null,
          violation.severity,
          violation.confidence,
          violation.trustPenalty,
          violation.actionType,
          JSON.stringify({
            duration: violation.timeoutDuration,
            reason: `Becas: ${violation.type} - ${violation.reasoning}`,
          }),
        ]
      );

      logger.info(`Violation logged: ${violation.type} by ${action.userId}`);
    } catch (error: any) {
      logger.error('Violation logging error:', error);
    }
  }

  /**
   * Execute punishment (timeout/ban/cross-ban)
   */
  private async executePunishment(
    violation: CoreViolation,
    context: BecasContext
  ): Promise<void> {
    try {
      const reason = `Becas: ${violation.type} violation (${violation.severity})`;

      switch (violation.actionType) {
        case 'timeout':
          if (violation.timeoutDuration) {
            await context.member.timeout(
              violation.timeoutDuration * 1000,
              reason
            );
            logger.info(
              `User ${context.member.user.tag} timed out for ${violation.timeoutDuration}s`
            );
          }
          break;

        case 'ban':
          await context.guild.members.ban(context.member, { reason });
          logger.warn(`User ${context.member.user.tag} banned from ${context.guild.name}`);
          break;

        case 'cross_ban':
          // Cross-ban will be handled by TrustScoreEngineDB when checking global score
          logger.warn(
            `User ${context.member.user.tag} eligible for cross-ban (${violation.type})`
          );
          break;

        case 'none':
          // No immediate action, just trust score decrease
          break;
      }
    } catch (error: any) {
      logger.error('Punishment execution error:', error);
    }
  }

  /**
   * Determine action type based on severity
   */
  private determineActionType(
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): CoreViolation['actionType'] {
    switch (severity) {
      case 'critical':
        return 'cross_ban';
      case 'high':
        return 'ban';
      case 'medium':
        return 'timeout';
      case 'low':
        return 'none';
    }
  }

  /**
   * Get timeout duration based on severity
   */
  private getTimeoutDuration(
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): number {
    switch (severity) {
      case 'critical':
        return 0; // Ban instead
      case 'high':
        return 0; // Ban instead
      case 'medium':
        return 86400; // 24 hours
      case 'low':
        return 3600; // 1 hour
    }
  }

  /**
   * Get all violation types
   */
  private getAllViolationTypes(): CoreViolationType[] {
    return [
      'profanity',
      'hate_speech',
      'harassment',
      'spam',
      'scam',
      'explicit_content',
      'doxxing',
      'raiding',
      'impersonation',
    ];
  }

  /**
   * Create empty violation (not detected)
   */
  private createEmptyViolation(type: CoreViolationType): CoreViolation {
    return {
      type,
      detected: false,
      confidence: 0,
      severity: 'low',
      trustPenalty: 0,
      actionType: 'none',
    };
  }
}
