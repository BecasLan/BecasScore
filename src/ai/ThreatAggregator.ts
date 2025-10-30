/**
 * THREAT AGGREGATOR - Multi-Layer Threat Intelligence Fusion
 *
 * Combines results from all analysis layers to make final threat assessment:
 * - Reflex Layer (fast pattern matching)
 * - Semantic Layer (intent, sentiment, emotion)
 * - Content Layer (deep scam/phishing analysis)
 * - Context Layer (conversation context, provocation)
 *
 * Produces unified threat score and recommended action.
 */

import { Message } from 'discord.js';
import { ReflexLayer, ReflexResult } from './layers/ReflexLayer';
import { SemanticLayer, SemanticResult } from './layers/SemanticLayer';
import { ContentLayer, ContentResult } from './layers/ContentLayer';
import { ContextLayer, ContextResult } from './layers/ContextLayer';
import { UserCharacterProfile } from '../services/ProfileBuilder';
import { TrustScore } from '../types/Trust.types';
import { MessageRepository } from '../database/repositories/MessageRepository';
import { createLogger } from '../services/Logger';

const logger = createLogger('ThreatAggregator');

export interface AggregatedThreatResult {
  // Unified Assessment
  threatLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  threatScore: number; // 0-100
  confidence: number; // 0-1

  // Recommended Action
  recommendedAction: 'none' | 'warn' | 'delete' | 'timeout' | 'kick' | 'ban';
  actionReason: string;

  // Layer Results
  layers: {
    reflex: ReflexResult;
    semantic?: SemanticResult;
    content?: ContentResult;
    context?: ContextResult;
  };

  // Threat Breakdown
  threats: Array<{
    type: string; // scam, toxic, spam, manipulation, etc.
    severity: number; // 0-10
    source: string; // Which layer detected it
    confidence: number;
  }>;

  // Modifiers
  modifiers: {
    trustScore: number; // Impact of trust score
    profileRisk: number; // Impact of profile risk indicators
    provocation: number; // Leniency for provoked responses
    context: number; // Impact of conversation context
    total: number;
  };

  processingTime: number;
  layerTimings: {
    reflex: number;
    semantic?: number;
    content?: number;
    context?: number;
  };
}

export class ThreatAggregator {
  private reflexLayer: ReflexLayer;
  private semanticLayer: SemanticLayer;
  private contentLayer: ContentLayer;
  private contextLayer: ContextLayer;

  constructor(messageRepo: MessageRepository) {
    this.reflexLayer = new ReflexLayer();
    this.semanticLayer = new SemanticLayer();
    this.contentLayer = new ContentLayer();
    this.contextLayer = new ContextLayer(messageRepo);

    logger.info('ThreatAggregator initialized with all 4 layers');
  }

  /**
   * Analyze message through all layers and aggregate results
   */
  async analyze(
    message: Message,
    profile?: UserCharacterProfile,
    trustScore?: TrustScore
  ): Promise<AggregatedThreatResult> {
    const startTime = Date.now();
    const layerTimings: AggregatedThreatResult['layerTimings'] = { reflex: 0 };

    try {
      // ==========================================
      // LAYER 1: REFLEX (always runs, ultra-fast)
      // ==========================================
      logger.debug('Running Reflex Layer...');
      const reflexStart = Date.now();
      const reflexResult = await this.reflexLayer.analyze(message, trustScore);
      layerTimings.reflex = Date.now() - reflexStart;

      logger.debug(`Reflex result: ${reflexResult.classification} (${reflexResult.processingTime}ms)`);

      // Early exit for trusted users or clean messages
      if (reflexResult.classification === 'CLEAN' && reflexResult.confidence >= 0.8) {
        logger.info('Clean message, skipping deeper analysis');
        return this.buildResult(
          'none',
          0,
          reflexResult.confidence,
          'none',
          'No threats detected',
          { reflex: reflexResult },
          [],
          { trustScore: 0, profileRisk: 0, provocation: 0, context: 0, total: 0 },
          Date.now() - startTime,
          layerTimings
        );
      }

      // Immediate action for high-confidence threats
      if (this.reflexLayer.needsImmediateAction(reflexResult)) {
        logger.info('Immediate action needed, skipping deeper analysis');
        const threats = [{
          type: reflexResult.classification.toLowerCase(),
          severity: reflexResult.confidence * 10,
          source: 'reflex',
          confidence: reflexResult.confidence,
        }];

        return this.buildResult(
          'critical',
          reflexResult.confidence * 100,
          reflexResult.confidence,
          reflexResult.classification === 'SCAM' ? 'ban' : 'timeout',
          reflexResult.reason,
          { reflex: reflexResult },
          threats,
          { trustScore: 0, profileRisk: 0, provocation: 0, context: 0, total: 0 },
          Date.now() - startTime,
          layerTimings
        );
      }

      // ==========================================
      // LAYER 2: SEMANTIC (for suspicious messages)
      // ==========================================
      let semanticResult: SemanticResult | undefined;
      if (['SUSPICIOUS', 'SPAM', 'TOXIC'].includes(reflexResult.classification)) {
        logger.debug('Running Semantic Layer...');
        const semanticStart = Date.now();
        semanticResult = await this.semanticLayer.analyze(message, profile, trustScore);
        layerTimings.semantic = Date.now() - semanticStart;
        logger.debug(`Semantic analysis complete (${layerTimings.semantic}ms)`);
      }

      // ==========================================
      // LAYER 3: CONTENT (for manipulation/scams)
      // ==========================================
      let contentResult: ContentResult | undefined;
      if (semanticResult?.manipulation.isManipulative || reflexResult.classification === 'SCAM') {
        logger.debug('Running Content Layer...');
        const contentStart = Date.now();
        contentResult = await this.contentLayer.analyze(message, semanticResult!, profile);
        layerTimings.content = Date.now() - contentStart;
        logger.debug(`Content analysis complete (${layerTimings.content}ms)`);
      }

      // ==========================================
      // LAYER 4: CONTEXT (always run for fairness)
      // ==========================================
      logger.debug('Running Context Layer...');
      const contextStart = Date.now();
      const contextResult = await this.contextLayer.analyze(message);
      layerTimings.context = Date.now() - contextStart;
      logger.debug(`Context analysis complete (${layerTimings.context}ms)`);

      // ==========================================
      // AGGREGATION: Combine all layer results
      // ==========================================
      return this.aggregateResults(
        reflexResult,
        semanticResult,
        contentResult,
        contextResult,
        profile,
        trustScore,
        Date.now() - startTime,
        layerTimings
      );

    } catch (error) {
      logger.error('Threat aggregation failed', error);

      // Safe fallback
      return this.buildResult(
        'none',
        0,
        0,
        'none',
        'Analysis failed',
        { reflex: {} as ReflexResult },
        [],
        { trustScore: 0, profileRisk: 0, provocation: 0, context: 0, total: 0 },
        Date.now() - startTime,
        layerTimings
      );
    }
  }

  /**
   * Aggregate results from all layers
   */
  private aggregateResults(
    reflex: ReflexResult,
    semantic: SemanticResult | undefined,
    content: ContentResult | undefined,
    context: ContextResult,
    profile: UserCharacterProfile | undefined,
    trustScore: TrustScore | undefined,
    processingTime: number,
    layerTimings: AggregatedThreatResult['layerTimings']
  ): AggregatedThreatResult {
    // Collect all threats
    const threats: AggregatedThreatResult['threats'] = [];

    // Reflex threats
    if (reflex.classification !== 'CLEAN') {
      threats.push({
        type: reflex.classification.toLowerCase(),
        severity: reflex.confidence * 8, // 0-8 scale
        source: 'reflex',
        confidence: reflex.confidence,
      });
    }

    // Semantic threats
    if (semantic?.manipulation.isManipulative) {
      threats.push({
        type: 'manipulation',
        severity: semantic.manipulation.confidence * 7,
        source: 'semantic',
        confidence: semantic.manipulation.confidence,
      });
    }

    // Content threats
    if (content?.scam.isScam) {
      threats.push({
        type: `scam_${content.scam.scamType}`,
        severity: content.scam.confidence * 10, // Scams are critical
        source: 'content',
        confidence: content.scam.confidence,
      });
    }

    if (content?.phishing.isPhishing) {
      threats.push({
        type: 'phishing',
        severity: content.phishing.confidence * 9,
        source: 'content',
        confidence: content.phishing.confidence,
      });
    }

    // Calculate base threat score (0-100)
    let threatScore = 0;
    if (threats.length > 0) {
      threatScore = threats.reduce((sum, t) => sum + (t.severity * t.confidence), 0) / threats.length * 10;
    }

    // Calculate modifiers
    const modifiers = this.calculateModifiers(
      profile,
      trustScore,
      context
    );

    // Apply modifiers
    threatScore = Math.max(0, Math.min(100, threatScore + modifiers.total));

    // Determine threat level
    const threatLevel = this.determineThreatLevel(threatScore);

    // Determine action
    const { action, reason } = this.determineAction(threatLevel, threatScore, threats, modifiers);

    // Calculate overall confidence
    const confidence = threats.length > 0
      ? threats.reduce((sum, t) => sum + t.confidence, 0) / threats.length
      : 0.5;

    return this.buildResult(
      threatLevel,
      threatScore,
      confidence,
      action,
      reason,
      { reflex, semantic, content, context },
      threats,
      modifiers,
      processingTime,
      layerTimings
    );
  }

  /**
   * Calculate modifiers based on profile, trust, and context
   */
  private calculateModifiers(
    profile: UserCharacterProfile | undefined,
    trustScore: TrustScore | undefined,
    context: ContextResult
  ): AggregatedThreatResult['modifiers'] {
    let trustModifier = 0;
    let profileRisk = 0;
    let provocationModifier = 0;
    let contextModifier = 0;

    // Trust score modifier
    if (trustScore) {
      if (trustScore.score >= 80) trustModifier = -10;
      else if (trustScore.score >= 60) trustModifier = -5;
      else if (trustScore.score <= 20) trustModifier = +15;
      else if (trustScore.score <= 40) trustModifier = +10;
    }

    // Profile risk modifier
    if (profile) {
      profileRisk += profile.riskIndicators.deception * 15;
      profileRisk += profile.riskIndicators.manipulation * 12;
      profileRisk += profile.riskIndicators.predatoryBehavior * 20;
      profileRisk += profile.riskIndicators.impulsivity * 8;
    }

    // Provocation modifier (leniency)
    if (context.provocation.wasProvoked) {
      provocationModifier = -context.provocation.provocationSeverity * 15;
    }

    // Context modifier (escalation)
    if (context.conversation.isEscalating) {
      contextModifier = +5;
    }
    if (context.conversation.mood === 'hostile') {
      contextModifier += 5;
    }

    const total = trustModifier + profileRisk + provocationModifier + contextModifier;

    return {
      trustScore: trustModifier,
      profileRisk,
      provocation: provocationModifier,
      context: contextModifier,
      total,
    };
  }

  /**
   * Determine threat level from score
   */
  private determineThreatLevel(score: number): AggregatedThreatResult['threatLevel'] {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 40) return 'medium';
    if (score >= 20) return 'low';
    return 'none';
  }

  /**
   * Determine recommended action
   */
  private determineAction(
    threatLevel: AggregatedThreatResult['threatLevel'],
    threatScore: number,
    threats: AggregatedThreatResult['threats'],
    modifiers: AggregatedThreatResult['modifiers']
  ): { action: AggregatedThreatResult['recommendedAction']; reason: string } {
    // Check for scams (always ban)
    const hasScam = threats.some(t => t.type.startsWith('scam_') && t.confidence >= 0.75);
    if (hasScam) {
      return { action: 'ban', reason: 'High-confidence scam detected' };
    }

    // Check for phishing
    const hasPhishing = threats.some(t => t.type === 'phishing' && t.confidence >= 0.7);
    if (hasPhishing) {
      return { action: 'ban', reason: 'Phishing attempt detected' };
    }

    // Based on threat level
    switch (threatLevel) {
      case 'critical':
        return { action: 'timeout', reason: `Critical threat (score: ${threatScore.toFixed(0)})` };

      case 'high':
        return { action: 'timeout', reason: `High threat (score: ${threatScore.toFixed(0)})` };

      case 'medium':
        return { action: 'warn', reason: `Medium threat (score: ${threatScore.toFixed(0)})` };

      case 'low':
        return { action: 'delete', reason: `Low threat (score: ${threatScore.toFixed(0)})` };

      default:
        return { action: 'none', reason: 'No significant threats detected' };
    }
  }

  /**
   * Build final result object
   */
  private buildResult(
    threatLevel: AggregatedThreatResult['threatLevel'],
    threatScore: number,
    confidence: number,
    action: AggregatedThreatResult['recommendedAction'],
    reason: string,
    layers: AggregatedThreatResult['layers'],
    threats: AggregatedThreatResult['threats'],
    modifiers: AggregatedThreatResult['modifiers'],
    processingTime: number,
    layerTimings: AggregatedThreatResult['layerTimings']
  ): AggregatedThreatResult {
    return {
      threatLevel,
      threatScore: Math.round(threatScore * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
      recommendedAction: action,
      actionReason: reason,
      layers,
      threats,
      modifiers,
      processingTime,
      layerTimings,
    };
  }
}
