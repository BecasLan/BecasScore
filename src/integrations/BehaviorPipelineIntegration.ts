import { Client, Message } from 'discord.js';
import { Pool } from 'pg';
import { BehaviorIntegration } from './BehaviorIntegration';
import { MessageAnalysisPipeline, ThreatAnalysisResult } from '../services/MessageAnalysisPipeline';
import logger from '../utils/logger';

/**
 * BehaviorPipelineIntegration
 *
 * Connects the Dynamic Behavior Engine with the Message Analysis Pipeline.
 * Allows behaviors to react to message analysis results and trigger actions
 * based on detected threats, sentiment, and other analyzed data.
 *
 * Integration points:
 * 1. Message analysis results trigger behavior events
 * 2. Behaviors can use analysis data in conditions
 * 3. Tracking system can monitor analysis metrics
 * 4. Actions can reference threat scores and analysis results
 */

export class BehaviorPipelineIntegration {
  private behaviorIntegration: BehaviorIntegration;
  private pipeline: MessageAnalysisPipeline;
  private initialized = false;

  constructor(
    behaviorIntegration: BehaviorIntegration,
    pipeline: MessageAnalysisPipeline
  ) {
    this.behaviorIntegration = behaviorIntegration;
    this.pipeline = pipeline;
  }

  /**
   * Initialize pipeline integration
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('BehaviorPipelineIntegration already initialized');
      return;
    }

    logger.info('Initializing Behavior Pipeline Integration...');

    // Wire up message analysis results to behavior engine
    this.setupMessageAnalysisHooks();

    this.initialized = true;
    logger.info('✅ Behavior Pipeline Integration initialized');
  }

  /**
   * Setup hooks to trigger behaviors based on message analysis
   */
  private setupMessageAnalysisHooks(): void {
    logger.info('Setting up message analysis hooks for behavior engine...');

    // Hook into the pipeline's analysis completion
    // This would be called after every message analysis
    // For now, we'll add a public method that the pipeline can call

    logger.info('✓ Message analysis hooks configured');
  }

  /**
   * Handle message analysis completion
   * This is called by the message pipeline after analyzing a message
   */
  async handleAnalysisResult(result: ThreatAnalysisResult): Promise<void> {
    if (!this.initialized) {
      logger.warn('BehaviorPipelineIntegration not initialized');
      return;
    }

    try {
      const engine = this.behaviorIntegration.getEngine();

      // Build enhanced event data with analysis results
      const eventData = {
        message: result.message,
        author: result.message.author,
        channel: result.message.channel,
        guild: result.message.guild,

        // Analysis results available to behavior conditions
        analysis: {
          // Message analysis
          toxicity: result.analyzedMessage.toxicity,
          sentiment: result.analyzedMessage.sentiment,
          intent: result.analyzedMessage.intent,
          manipulation: result.analyzedMessage.manipulation,

          // Scam detection
          isScam: result.scamAnalysis?.isScam || false,
          scamType: result.scamAnalysis?.scamType,
          scamConfidence: result.scamAnalysis?.confidence || 0,
          scamIndicators: result.scamAnalysis?.indicators || [],

          // Trust & severity
          trustScore: result.trustScore.score,
          trustLevel: result.trustScore.level,
          severity: result.severityResult.severity,
          recommendedAction: result.severityResult.action,

          // Profile data
          profile: result.profile ? {
            aggression: result.profile.personality.aggression,
            empathy: result.profile.personality.empathy,
            deception: result.profile.riskIndicators.deception,
            manipulation: result.profile.riskIndicators.manipulation,
            predatoryBehavior: result.profile.riskIndicators.predatoryBehavior,
            confidence: result.profile.confidence,
          } : null,

          // Overall
          confidence: result.confidence,
        },
      };

      // Trigger messageCreate event with enhanced data
      await engine.handleEvent('messageCreate', eventData);

      // If high severity, trigger additional event
      if (result.severityResult.severity >= 70) {
        await engine.handleEvent('highSeverityMessage', eventData);
      }

      // If scam detected, trigger scam event
      if (result.scamAnalysis?.isScam) {
        await engine.handleEvent('scamDetected', {
          ...eventData,
          scamType: result.scamAnalysis.scamType,
          confidence: result.scamAnalysis.confidence,
        });
      }

      // If low trust user, trigger monitoring event
      if (result.trustScore.level === 'dangerous' || result.trustScore.level === 'cautious') {
        await engine.handleEvent('lowTrustUserActivity', eventData);
      }

    } catch (error) {
      logger.error('Error handling analysis result in behavior engine:', error);
    }
  }

  /**
   * Create custom behavior for threat response
   * Example helper method for common use case
   */
  async createThreatResponseBehavior(
    serverId: string,
    userId: string,
    config: {
      severityThreshold: number;
      action: 'warn' | 'timeout' | 'kick';
      duration?: string;
    }
  ): Promise<void> {
    const parser = this.behaviorIntegration.getParser();

    const description = `When a message has severity score above ${config.severityThreshold}, ${config.action} the user${config.duration ? ` for ${config.duration}` : ''}`;

    try {
      const bdl = await parser.parse(description, serverId);

      // Save behavior to database
      const db = (this.behaviorIntegration as any).db;
      const id = `behavior-${serverId}-${Date.now()}`;
      bdl.id = id;

      await db.query(
        `INSERT INTO dynamic_behaviors
        (id, server_id, created_by, name, description, enabled, trigger, tracking, analysis, actions, safety)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          serverId,
          userId,
          bdl.name,
          bdl.description,
          true,
          JSON.stringify(bdl.trigger),
          bdl.tracking ? JSON.stringify(bdl.tracking) : null,
          bdl.analysis ? JSON.stringify(bdl.analysis) : null,
          JSON.stringify(bdl.actions),
          JSON.stringify(bdl.safety),
        ]
      );

      await this.behaviorIntegration.getEngine().reload();

      logger.info(`Created threat response behavior: ${bdl.name}`);

    } catch (error) {
      logger.error('Failed to create threat response behavior:', error);
      throw error;
    }
  }

  /**
   * Get analysis data for behavior execution context
   * This allows behaviors to access rich analysis data in their conditions
   */
  getAnalysisContextEnhancement(result: ThreatAnalysisResult): Record<string, any> {
    return {
      // Threat scores
      severity: result.severityResult.severity,
      toxicity: result.analyzedMessage.toxicity,
      manipulation: result.analyzedMessage.manipulation,

      // Trust
      trustScore: result.trustScore.score,
      trustLevel: result.trustScore.level,

      // Scam
      isScam: result.scamAnalysis?.isScam || false,
      scamConfidence: result.scamAnalysis?.confidence || 0,

      // Profile risk indicators
      deception: result.profile?.riskIndicators.deception || 0,
      predatoryBehavior: result.profile?.riskIndicators.predatoryBehavior || 0,
      aggression: result.profile?.personality.aggression || 0,

      // Metadata
      confidence: result.confidence,
      processingTime: result.processingTime,
    };
  }

  /**
   * Health check
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Example usage:
 *
 * // In main initialization after both systems are ready
 * const pipelineIntegration = new BehaviorPipelineIntegration(
 *   behaviorIntegration,
 *   messageAnalysisPipeline
 * );
 * await pipelineIntegration.initialize();
 *
 * // In message handler, after analysis
 * const analysisResult = await messageAnalysisPipeline.analyzeMessage(message);
 * await pipelineIntegration.handleAnalysisResult(analysisResult);
 *
 * // Now behaviors can trigger based on analysis:
 * // - "When severity > 70 and trustLevel is 'dangerous', timeout user for 1 hour"
 * // - "When isScam is true and scamConfidence > 0.8, ban user immediately"
 * // - "When toxicity > 0.7 and isRedeemed is false, issue warning"
 * // - "When userArchetype is 'provocateur' and manipulationScore > 0.6, alert moderators"
 */
