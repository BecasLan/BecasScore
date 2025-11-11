/**
 * LEARNING ENGINE - Adjust Decision Weights Based on Feedback
 *
 * Analyzes moderator feedback patterns and adjusts BECAS decision-making:
 * - "Too harsh" patterns → Reduce severity weights
 * - "Good catch" patterns → Increase confidence
 * - "False positive" patterns → Adjust thresholds
 * - "Context missed" patterns → Improve context awareness
 *
 * Learning is gradual, reversible, and server-specific.
 */

import { Pool } from 'pg';
import { FeedbackCollector, FeedbackEntry } from './FeedbackCollector';
import { createLogger } from './Logger';

const logger = createLogger('LearningEngine');

export interface LearningAdjustment {
  id: string;
  serverId: string;
  category: string; // 'severity_weights', 'confidence_thresholds', 'context_weights'
  parameter: string; // Specific parameter adjusted
  oldValue: number;
  newValue: number;
  reason: string;
  confidence: number; // How confident in this adjustment
  basedOnSamples: number; // How many feedback entries led to this
  createdAt: Date;
  active: boolean;
}

export interface ServerLearningProfile {
  serverId: string;

  // Severity Adjustments
  severityMultipliers: {
    toxicity: number;      // 0.5-1.5 (default: 1.0)
    manipulation: number;  // 0.5-1.5 (default: 1.0)
    scam: number;          // 0.5-1.5 (default: 1.0)
    spam: number;          // 0.5-1.5 (default: 1.0)
  };

  // Trust Score Adjustments
  trustModifiers: {
    highTrustLeniency: number;   // 0.5-2.0 (default: 1.0)
    lowTrustStrictness: number;  // 0.5-2.0 (default: 1.0)
  };

  // Context Awareness
  contextWeights: {
    provocationWeight: number;     // 0.5-2.0 (default: 1.0)
    escalationSensitivity: number; // 0.5-2.0 (default: 1.0)
  };

  // Confidence Calibration
  confidenceAdjustment: number; // -0.2 to +0.2 (default: 0)

  lastUpdated: Date;
  learningDataPoints: number;
}

export class LearningEngine {
  private serverProfiles: Map<string, ServerLearningProfile> = new Map();

  constructor(
    private pool: Pool,
    private feedbackCollector: FeedbackCollector
  ) {
    logger.info('LearningEngine initialized');
    this.createTables();
    this.loadServerProfiles();
  }

  /**
   * Create learning tables
   */
  private async createTables(): Promise<void> {
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS learning_adjustments (
          id VARCHAR(255) PRIMARY KEY,
          server_id VARCHAR(255) NOT NULL,
          category VARCHAR(100) NOT NULL,
          parameter VARCHAR(100) NOT NULL,
          old_value DECIMAL(5, 3) NOT NULL,
          new_value DECIMAL(5, 3) NOT NULL,
          reason TEXT,
          confidence DECIMAL(3, 2),
          based_on_samples INTEGER,
          created_at TIMESTAMP DEFAULT NOW(),
          active BOOLEAN DEFAULT TRUE
        );

        CREATE TABLE IF NOT EXISTS server_learning_profiles (
          server_id VARCHAR(255) PRIMARY KEY,
          severity_multipliers JSONB,
          trust_modifiers JSONB,
          context_weights JSONB,
          confidence_adjustment DECIMAL(3, 2),
          last_updated TIMESTAMP DEFAULT NOW(),
          learning_data_points INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_adjustments_server ON learning_adjustments(server_id);
        CREATE INDEX IF NOT EXISTS idx_adjustments_active ON learning_adjustments(active);
      `);

      logger.info('Learning tables created/verified');
    } catch (error) {
      logger.error('Failed to create learning tables', error);
    }
  }

  /**
   * Load server learning profiles from database
   */
  private async loadServerProfiles(): Promise<void> {
    try {
      const result = await this.pool.query(`
        SELECT * FROM server_learning_profiles
      `);

      for (const row of result.rows) {
        const profile: ServerLearningProfile = {
          serverId: row.server_id,
          severityMultipliers: row.severity_multipliers || this.getDefaultMultipliers(),
          trustModifiers: row.trust_modifiers || this.getDefaultTrustModifiers(),
          contextWeights: row.context_weights || this.getDefaultContextWeights(),
          confidenceAdjustment: parseFloat(row.confidence_adjustment) || 0,
          lastUpdated: new Date(row.last_updated),
          learningDataPoints: row.learning_data_points || 0,
        };

        this.serverProfiles.set(profile.serverId, profile);
      }

      logger.info(`Loaded ${this.serverProfiles.size} server learning profiles`);
    } catch (error) {
      logger.error('Failed to load server profiles', error);
    }
  }

  /**
   * Analyze recent feedback and apply learning
   */
  async analyzeFeedbackAndLearn(serverId: string, days: number = 7): Promise<{
    adjustmentsMade: number;
    adjustments: LearningAdjustment[];
  }> {
    logger.info(`Analyzing feedback for server ${serverId} (last ${days} days)`);

    // Get recent feedback
    const feedback = await this.feedbackCollector.getRecentFeedback(serverId, days, 200);

    if (feedback.length < 10) {
      logger.warn(`Not enough feedback data (${feedback.length} entries) - need at least 10`);
      return { adjustmentsMade: 0, adjustments: [] };
    }

    const adjustments: LearningAdjustment[] = [];

    // 1. Analyze "too harsh" pattern
    const tooHarshCount = feedback.filter(f => f.feedbackCategory === 'too_harsh').length;
    if (tooHarshCount / feedback.length > 0.3) { // 30%+ too harsh
      const adj = await this.adjustSeverityWeights(serverId, 'reduce', tooHarshCount, feedback.length);
      if (adj) adjustments.push(adj);
    }

    // 2. Analyze "too lenient" pattern
    const tooLenientCount = feedback.filter(f => f.feedbackCategory === 'too_lenient').length;
    if (tooLenientCount / feedback.length > 0.3) { // 30%+ too lenient
      const adj = await this.adjustSeverityWeights(serverId, 'increase', tooLenientCount, feedback.length);
      if (adj) adjustments.push(adj);
    }

    // 3. Analyze trust score overrides
    const trustedUserOverrides = feedback.filter(f =>
      f.learningTags.includes('trusted_user') && f.wasBecasCorrect === false
    );
    if (trustedUserOverrides.length / feedback.length > 0.2) {
      const adj = await this.adjustTrustLeniency(serverId, 'increase', trustedUserOverrides.length);
      if (adj) adjustments.push(adj);
    }

    // 4. Analyze provocation context misses
    const provocationMisses = feedback.filter(f =>
      f.learningTags.includes('provocation_context') && f.wasBecasCorrect === false
    );
    if (provocationMisses.length > 5) {
      const adj = await this.adjustProvocationWeight(serverId, 'increase', provocationMisses.length);
      if (adj) adjustments.push(adj);
    }

    // 5. Analyze confidence calibration
    const highConfidenceWrong = feedback.filter(f =>
      f.becasSuggestion.confidence > 0.8 && f.wasBecasCorrect === false
    );
    if (highConfidenceWrong.length / feedback.length > 0.15) { // 15%+ overconfident
      const adj = await this.adjustConfidenceCalibration(serverId, 'reduce', highConfidenceWrong.length);
      if (adj) adjustments.push(adj);
    }

    // Update server profile
    await this.updateServerProfile(serverId, feedback.length);

    logger.info(`Learning complete: ${adjustments.length} adjustments made`);

    return {
      adjustmentsMade: adjustments.length,
      adjustments,
    };
  }

  /**
   * Get server learning profile (with defaults)
   */
  getServerProfile(serverId: string): ServerLearningProfile {
    let profile = this.serverProfiles.get(serverId);

    if (!profile) {
      profile = {
        serverId,
        severityMultipliers: this.getDefaultMultipliers(),
        trustModifiers: this.getDefaultTrustModifiers(),
        contextWeights: this.getDefaultContextWeights(),
        confidenceAdjustment: 0,
        lastUpdated: new Date(),
        learningDataPoints: 0,
      };
      this.serverProfiles.set(serverId, profile);
    }

    return profile;
  }

  /**
   * Adjust severity weights
   */
  private async adjustSeverityWeights(
    serverId: string,
    direction: 'increase' | 'reduce',
    count: number,
    total: number
  ): Promise<LearningAdjustment | null> {
    const profile = this.getServerProfile(serverId);
    const adjustmentAmount = direction === 'reduce' ? -0.1 : +0.1;

    // Adjust all severity multipliers slightly
    const oldValue = profile.severityMultipliers.toxicity;
    const newValue = Math.max(0.5, Math.min(1.5, oldValue + adjustmentAmount));

    profile.severityMultipliers.toxicity = newValue;
    profile.severityMultipliers.manipulation = newValue;
    profile.severityMultipliers.scam = newValue;
    profile.severityMultipliers.spam = newValue;

    const adjustment: LearningAdjustment = {
      id: this.generateId(),
      serverId,
      category: 'severity_weights',
      parameter: 'all_multipliers',
      oldValue,
      newValue,
      reason: `${direction === 'reduce' ? 'Too harsh' : 'Too lenient'} pattern detected (${count}/${total} cases)`,
      confidence: Math.min(0.95, (count / total) * 2),
      basedOnSamples: count,
      createdAt: new Date(),
      active: true,
    };

    await this.storeAdjustment(adjustment);
    await this.saveServerProfile(profile);

    logger.info(`Adjusted severity weights: ${oldValue.toFixed(2)} → ${newValue.toFixed(2)}`);

    return adjustment;
  }

  /**
   * Adjust trust-based leniency
   */
  private async adjustTrustLeniency(
    serverId: string,
    direction: 'increase' | 'decrease',
    count: number
  ): Promise<LearningAdjustment | null> {
    const profile = this.getServerProfile(serverId);
    const adjustmentAmount = direction === 'increase' ? +0.15 : -0.15;

    const oldValue = profile.trustModifiers.highTrustLeniency;
    const newValue = Math.max(0.5, Math.min(2.0, oldValue + adjustmentAmount));

    profile.trustModifiers.highTrustLeniency = newValue;

    const adjustment: LearningAdjustment = {
      id: this.generateId(),
      serverId,
      category: 'trust_modifiers',
      parameter: 'high_trust_leniency',
      oldValue,
      newValue,
      reason: `Trusted users being treated too ${direction === 'increase' ? 'harshly' : 'leniently'} (${count} cases)`,
      confidence: Math.min(0.9, count * 0.1),
      basedOnSamples: count,
      createdAt: new Date(),
      active: true,
    };

    await this.storeAdjustment(adjustment);
    await this.saveServerProfile(profile);

    logger.info(`Adjusted trust leniency: ${oldValue.toFixed(2)} → ${newValue.toFixed(2)}`);

    return adjustment;
  }

  /**
   * Adjust provocation weight
   */
  private async adjustProvocationWeight(
    serverId: string,
    direction: 'increase' | 'decrease',
    count: number
  ): Promise<LearningAdjustment | null> {
    const profile = this.getServerProfile(serverId);
    const adjustmentAmount = direction === 'increase' ? +0.2 : -0.2;

    const oldValue = profile.contextWeights.provocationWeight;
    const newValue = Math.max(0.5, Math.min(2.0, oldValue + adjustmentAmount));

    profile.contextWeights.provocationWeight = newValue;

    const adjustment: LearningAdjustment = {
      id: this.generateId(),
      serverId,
      category: 'context_weights',
      parameter: 'provocation_weight',
      oldValue,
      newValue,
      reason: `Provocation context being ${direction === 'increase' ? 'under' : 'over'}-weighted (${count} cases)`,
      confidence: Math.min(0.85, count * 0.08),
      basedOnSamples: count,
      createdAt: new Date(),
      active: true,
    };

    await this.storeAdjustment(adjustment);
    await this.saveServerProfile(profile);

    logger.info(`Adjusted provocation weight: ${oldValue.toFixed(2)} → ${newValue.toFixed(2)}`);

    return adjustment;
  }

  /**
   * Adjust confidence calibration
   */
  private async adjustConfidenceCalibration(
    serverId: string,
    direction: 'reduce' | 'increase',
    count: number
  ): Promise<LearningAdjustment | null> {
    const profile = this.getServerProfile(serverId);
    const adjustmentAmount = direction === 'reduce' ? -0.05 : +0.05;

    const oldValue = profile.confidenceAdjustment;
    const newValue = Math.max(-0.2, Math.min(0.2, oldValue + adjustmentAmount));

    profile.confidenceAdjustment = newValue;

    const adjustment: LearningAdjustment = {
      id: this.generateId(),
      serverId,
      category: 'confidence_calibration',
      parameter: 'adjustment',
      oldValue,
      newValue,
      reason: `Confidence ${direction === 'reduce' ? 'overestimation' : 'underestimation'} detected (${count} cases)`,
      confidence: Math.min(0.9, count * 0.05),
      basedOnSamples: count,
      createdAt: new Date(),
      active: true,
    };

    await this.storeAdjustment(adjustment);
    await this.saveServerProfile(profile);

    logger.info(`Adjusted confidence calibration: ${oldValue.toFixed(3)} → ${newValue.toFixed(3)}`);

    return adjustment;
  }

  /**
   * Store adjustment in database
   */
  private async storeAdjustment(adjustment: LearningAdjustment): Promise<void> {
    try {
      await this.pool.query(`
        INSERT INTO learning_adjustments (
          id, server_id, category, parameter, old_value, new_value,
          reason, confidence, based_on_samples, active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        adjustment.id,
        adjustment.serverId,
        adjustment.category,
        adjustment.parameter,
        adjustment.oldValue,
        adjustment.newValue,
        adjustment.reason,
        adjustment.confidence,
        adjustment.basedOnSamples,
        adjustment.active,
      ]);
    } catch (error) {
      logger.error('Failed to store adjustment', error);
    }
  }

  /**
   * Save server profile to database
   */
  private async saveServerProfile(profile: ServerLearningProfile): Promise<void> {
    try {
      await this.pool.query(`
        INSERT INTO server_learning_profiles (
          server_id, severity_multipliers, trust_modifiers, context_weights,
          confidence_adjustment, learning_data_points
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (server_id) DO UPDATE SET
          severity_multipliers = $2,
          trust_modifiers = $3,
          context_weights = $4,
          confidence_adjustment = $5,
          learning_data_points = $6,
          last_updated = NOW()
      `, [
        profile.serverId,
        JSON.stringify(profile.severityMultipliers),
        JSON.stringify(profile.trustModifiers),
        JSON.stringify(profile.contextWeights),
        profile.confidenceAdjustment,
        profile.learningDataPoints,
      ]);
    } catch (error) {
      logger.error('Failed to save server profile', error);
    }
  }

  /**
   * Update server profile data points count
   */
  private async updateServerProfile(serverId: string, newDataPoints: number): Promise<void> {
    const profile = this.getServerProfile(serverId);
    profile.learningDataPoints += newDataPoints;
    profile.lastUpdated = new Date();
    await this.saveServerProfile(profile);
  }

  /**
   * Get default multipliers
   */
  private getDefaultMultipliers(): ServerLearningProfile['severityMultipliers'] {
    return {
      toxicity: 1.0,
      manipulation: 1.0,
      scam: 1.0,
      spam: 1.0,
    };
  }

  /**
   * Get default trust modifiers
   */
  private getDefaultTrustModifiers(): ServerLearningProfile['trustModifiers'] {
    return {
      highTrustLeniency: 1.0,
      lowTrustStrictness: 1.0,
    };
  }

  /**
   * Get default context weights
   */
  private getDefaultContextWeights(): ServerLearningProfile['contextWeights'] {
    return {
      provocationWeight: 1.0,
      escalationSensitivity: 1.0,
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `adjustment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get all adjustments for a server
   */
  async getAdjustments(serverId: string, limit: number = 50): Promise<LearningAdjustment[]> {
    try {
      const result = await this.pool.query(`
        SELECT * FROM learning_adjustments
        WHERE server_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `, [serverId, limit]);

      return result.rows.map(row => ({
        id: row.id,
        serverId: row.server_id,
        category: row.category,
        parameter: row.parameter,
        oldValue: parseFloat(row.old_value),
        newValue: parseFloat(row.new_value),
        reason: row.reason,
        confidence: parseFloat(row.confidence),
        basedOnSamples: row.based_on_samples,
        createdAt: new Date(row.created_at),
        active: row.active,
      }));
    } catch (error) {
      logger.error('Failed to get adjustments', error);
      return [];
    }
  }
}
