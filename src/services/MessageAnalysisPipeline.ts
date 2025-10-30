/**
 * MESSAGE ANALYSIS PIPELINE - Unified message threat analysis with Character Profiles
 *
 * Orchestrates all analysis components in the correct order:
 * 1. Basic message analysis (toxicity, sentiment, manipulation)
 * 2. Scam detection
 * 3. User profile retrieval/building
 * 4. Trust score calculation (with profile influence)
 * 5. Severity calculation (with profile modifiers)
 * 6. Final action determination
 *
 * This is the SINGLE ENTRY POINT for all message threat analysis.
 */

import { Message } from 'discord.js';
import { AnalyzedMessage, MessageContext } from '../types/Message.types';
import { TrustScore } from '../types/Trust.types';
import { DialogueProcessor } from '../core/DialogueProcessor';
import { ScamDetector, ScamAnalysis } from '../analyzers/ScamDetector';
import { ProfileBuilder, UserCharacterProfile } from './ProfileBuilder';
import { TrustScoreCalculator } from './TrustScoreCalculator';
import { SeverityCalculator, SeverityResult, SeverityInput } from './SeverityCalculator';
import { UserRepository } from '../database/repositories/UserRepository';
import { MessageRepository } from '../database/repositories/MessageRepository';
import { SicilRepository } from '../database/repositories/SicilRepository';
import { createLogger } from './Logger';

const logger = createLogger('MessageAnalysisPipeline');

export interface ThreatAnalysisResult {
  // Original message data
  message: Message;
  messageContext: MessageContext;
  analyzedMessage: AnalyzedMessage;

  // User profile & trust
  profile: UserCharacterProfile | null;
  trustScore: TrustScore;

  // Scam analysis
  scamAnalysis: ScamAnalysis | null;

  // Final severity & action
  severityResult: SeverityResult;

  // Metadata
  processingTime: number;
  confidence: number;
}

export class MessageAnalysisPipeline {
  constructor(
    private dialogue: DialogueProcessor,
    private scamDetector: ScamDetector,
    private profileBuilder: ProfileBuilder,
    private trustCalculator: TrustScoreCalculator,
    private severityCalculator: SeverityCalculator,
    private userRepo: UserRepository,
    private messageRepo: MessageRepository,
    private sicilRepo: SicilRepository
  ) {}

  /**
   * MASTER FUNCTION: Analyze message and determine moderation action
   */
  async analyzeMessage(
    message: Message,
    existingTrustScore?: TrustScore
  ): Promise<ThreatAnalysisResult> {
    const startTime = Date.now();
    logger.info(`🔍 Starting message analysis for user ${message.author.id}`);

    try {
      // ==========================================
      // STEP 1: Basic Message Analysis
      // ==========================================
      logger.debug('Step 1: Basic message analysis (toxicity, sentiment, intent)');
      const messageContext: MessageContext = {
        id: message.id,
        content: message.content,
        authorId: message.author.id,
        authorName: message.author.username,
        guildId: message.guildId!,
        channelId: message.channelId,
        timestamp: message.createdAt,
        mentions: message.mentions.users.map(u => u.id),
        attachments: message.attachments.map(a => a.url),
      };

      const analyzedMessage = await this.dialogue.analyzeMessage(messageContext);

      // ==========================================
      // STEP 2: Scam Detection
      // ==========================================
      logger.debug('Step 2: Scam detection');
      const scamAnalysis = await this.scamDetector.analyze(message.content, undefined, message.guildId!);

      // ==========================================
      // STEP 3: User Profile Retrieval/Building
      // ==========================================
      logger.debug('Step 3: User profile retrieval/building');
      let profile = await this.getOrBuildProfile(
        message.author.id,
        message.guildId!
      );

      // ==========================================
      // STEP 4: Trust Score Calculation
      // ==========================================
      logger.debug('Step 4: Trust score calculation');
      const trustScore = existingTrustScore || await this.calculateTrustScore(
        message.author.id,
        message.guildId!,
        profile
      );

      // ==========================================
      // STEP 5: Severity Calculation
      // ==========================================
      logger.debug('Step 5: Severity calculation with profile modifiers');

      // Get recent violations from sicil
      const sicilSummary = await this.sicilRepo.getSicilSummary(
        message.guildId!,
        message.author.id
      );

      // Check if message was provoked (simple heuristic: replying to toxic message)
      let isProvoked = false;
      if (message.reference?.messageId) {
        try {
          const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
          // If replying to a message with high toxicity, consider it provoked
          // (Would need to analyze replied message properly in real implementation)
          isProvoked = false; // Simplified for now
        } catch {
          // Couldn't fetch replied message
        }
      }

      // Calculate recent violations (7 days) - Since we don't have a last7Days field,
      // we'll estimate based on clean_streak_days: if clean streak < 7, use total violations as estimate
      const recentViolations = sicilSummary.clean_streak_days < 7
        ? (sicilSummary.total_warnings + sicilSummary.total_timeouts + sicilSummary.total_kicks + sicilSummary.total_bans)
        : 0;

      const severityInput: SeverityInput = {
        message: analyzedMessage,
        trustScore,
        scamAnalysis: scamAnalysis?.isScam ? scamAnalysis : undefined,
        isProvoked,
        recentViolations,
        profile: profile || undefined,
      };

      const severityResult = this.severityCalculator.calculateSeverity(severityInput);

      // ==========================================
      // STEP 6: Build Final Result
      // ==========================================
      const processingTime = Date.now() - startTime;

      // Calculate overall confidence (weighted average)
      let confidence = 0.5;
      if (scamAnalysis?.isScam) {
        confidence = scamAnalysis.confidence;
      } else {
        // Weight: 30% severity confidence, 40% profile confidence, 30% base
        const severityConf = severityResult.confidence;
        const profileConf = profile?.confidence || 0.5;
        confidence = (severityConf * 0.3) + (profileConf * 0.4) + 0.3;
      }

      logger.info(`✅ Analysis complete in ${processingTime}ms - Action: ${severityResult.action} (severity: ${severityResult.severity})`);

      return {
        message,
        messageContext,
        analyzedMessage,
        profile,
        trustScore,
        scamAnalysis,
        severityResult,
        processingTime,
        confidence,
      };

    } catch (error) {
      logger.error('Failed to analyze message', error);

      // Return safe default (no action)
      const processingTime = Date.now() - startTime;
      return {
        message,
        messageContext: {
          id: message.id,
          content: message.content,
          authorId: message.author.id,
          authorName: message.author.username,
          guildId: message.guildId!,
          channelId: message.channelId,
          timestamp: message.createdAt,
          mentions: [],
          attachments: [],
        },
        analyzedMessage: {} as AnalyzedMessage, // Fallback
        profile: null,
        trustScore: existingTrustScore || this.getDefaultTrustScore(message.author.id),
        scamAnalysis: null,
        severityResult: {
          action: 'none',
          confidence: 0,
          reason: 'Analysis failed - error occurred',
          severity: 0,
          modifiers: {
            trustScoreModifier: 0,
            historyModifier: 0,
            redemptionModifier: 0,
            contextModifier: 0,
            total: 0,
          },
        },
        processingTime,
        confidence: 0,
      };
    }
  }

  /**
   * Get or build user profile
   */
  private async getOrBuildProfile(
    userId: string,
    serverId: string
  ): Promise<UserCharacterProfile | null> {
    try {
      // Try to get existing profile from database
      // TODO: Implement profile retrieval from database
      // For now, build fresh profile
      return await this.profileBuilder.buildProfile(userId, serverId, 10);
    } catch (error) {
      logger.warn(`Failed to get/build profile for user ${userId}`, error);
      return null;
    }
  }

  /**
   * Calculate trust score with profile influence
   */
  private async calculateTrustScore(
    userId: string,
    serverId: string,
    profile: UserCharacterProfile | null
  ): Promise<TrustScore> {
    try {
      // Get sicil summary
      const sicilSummary = await this.sicilRepo.getSicilSummary(serverId, userId);

      // Calculate violations
      const violations = {
        warnings: sicilSummary.total_warnings,
        timeouts: sicilSummary.total_timeouts,
        kicks: sicilSummary.total_kicks,
        bans: sicilSummary.total_bans,
      };

      // Calculate clean streak (days since last violation)
      const lastViolation = sicilSummary.last_violation_at;
      const cleanStreak = lastViolation
        ? Math.floor((Date.now() - lastViolation.getTime()) / (1000 * 60 * 60 * 24))
        : 999; // No violations

      // Get helpful actions count (simplified - would need actual tracking)
      const helpfulActions = 0; // TODO: Track helpful actions

      // Calculate trust score with profile
      const factors = this.trustCalculator.calculateTrustScore(
        violations,
        cleanStreak,
        helpfulActions,
        profile || undefined
      );

      // Build TrustScore object
      const trustScore: TrustScore = {
        userId,
        userName: '', // TODO: Get from user data
        guildId: serverId,
        score: factors.finalScore,
        level: this.trustCalculator.getTrustLevel(factors.finalScore),
        history: [], // Simplified
        lastUpdated: new Date(),
        joinedAt: new Date(), // TODO: Get actual join date
      };

      logger.debug(`Trust score for ${userId}: ${factors.finalScore} (${trustScore.level})`);
      logger.debug(`  Factors: ${this.trustCalculator.explainScore(factors)}`);

      return trustScore;

    } catch (error) {
      logger.error(`Failed to calculate trust score for ${userId}`, error);
      return this.getDefaultTrustScore(userId);
    }
  }

  /**
   * Get default trust score (fallback)
   */
  private getDefaultTrustScore(userId: string): TrustScore {
    return {
      userId,
      userName: '',
      guildId: '',
      score: 50,
      level: 'neutral',
      history: [],
      lastUpdated: new Date(),
      joinedAt: new Date(),
    };
  }

  /**
   * Update user profile after message (incremental update)
   */
  async updateProfileAfterMessage(
    userId: string,
    serverId: string,
    analyzedMessage: AnalyzedMessage
  ): Promise<void> {
    // TODO: Implement incremental profile updates
    // For now, profiles are built on-demand
    logger.debug(`Profile update triggered for ${userId} (not implemented yet)`);
  }

  /**
   * Force rebuild user profile (e.g., after significant event)
   */
  async rebuildProfile(userId: string, serverId: string): Promise<UserCharacterProfile | null> {
    logger.info(`Force rebuilding profile for user ${userId}`);
    return await this.profileBuilder.buildProfile(userId, serverId, 10);
  }
}
