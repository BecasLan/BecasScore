import { Pool } from 'pg';
import { FeedbackCollector, FeedbackEntry } from './FeedbackCollector';
import logger from '../utils/logger';

/**
 * ConfidenceCalibrator
 *
 * Ensures that BECAS confidence scores accurately reflect decision quality.
 * If BECAS says 90% confident, it should be correct ~90% of the time.
 *
 * Problem: AI models can be overconfident or underconfident
 * Solution: Track actual accuracy vs predicted confidence, adjust calibration
 *
 * Example:
 * - BECAS says 85% confident → Actually correct 92% of the time → Underconfident
 * - BECAS says 60% confident → Actually correct 40% of the time → Overconfident
 *
 * This service:
 * 1. Analyzes historical feedback to measure calibration
 * 2. Detects overconfidence/underconfidence patterns
 * 3. Generates calibration adjustments
 * 4. Applies adjustments to future confidence scores
 * 5. Monitors calibration quality over time
 */

export interface CalibrationBucket {
  range: string;
  minConfidence: number;
  maxConfidence: number;
  avgConfidence: number;
  totalDecisions: number;
  correct: number;
  accuracy: number;
  calibrationError: number; // |avgConfidence - accuracy|
  status: 'well-calibrated' | 'moderately-calibrated' | 'poorly-calibrated' | 'overconfident' | 'underconfident';
}

export interface CalibrationProfile {
  serverId: string;
  overallError: number;
  overallStatus: string;
  buckets: CalibrationBucket[];
  adjustments: CalibrationAdjustment[];
  lastCalibrated: Date;
  dataPoints: number;
}

export interface CalibrationAdjustment {
  id: string;
  serverId: string;
  confidenceRange: string;
  minConfidence: number;
  maxConfidence: number;
  adjustmentFactor: number; // Multiply raw confidence by this
  reason: string;
  basedOnSamples: number;
  createdAt: Date;
  active: boolean;
}

export class ConfidenceCalibrator {
  private db: Pool;
  private feedbackCollector: FeedbackCollector;
  private calibrationProfiles: Map<string, CalibrationProfile> = new Map();

  // Calibration ranges (5 buckets)
  private readonly RANGES = [
    { min: 0.0, max: 0.2, label: '0-20%' },
    { min: 0.2, max: 0.4, label: '20-40%' },
    { min: 0.4, max: 0.6, label: '40-60%' },
    { min: 0.6, max: 0.8, label: '60-80%' },
    { min: 0.8, max: 1.0, label: '80-100%' }
  ];

  // Thresholds
  private readonly MIN_SAMPLES_PER_BUCKET = 20; // Need 20+ samples to adjust
  private readonly CALIBRATION_ERROR_THRESHOLD = 15; // >15% error = poorly calibrated
  private readonly ADJUSTMENT_STEP = 0.05; // Adjust by 5% increments
  private readonly MAX_ADJUSTMENT = 0.3; // Max 30% adjustment

  constructor(db: Pool, feedbackCollector: FeedbackCollector) {
    this.db = db;
    this.feedbackCollector = feedbackCollector;
  }

  /**
   * Initialize database tables
   */
  async initialize(): Promise<void> {
    await this.createTables();
    logger.info('ConfidenceCalibrator initialized');
  }

  /**
   * Create calibration tables
   */
  private async createTables(): Promise<void> {
    const createCalibrationTable = `
      CREATE TABLE IF NOT EXISTS confidence_calibration (
        id VARCHAR(255) PRIMARY KEY,
        server_id VARCHAR(255) NOT NULL,
        confidence_range VARCHAR(20) NOT NULL,
        min_confidence DECIMAL(3, 2) NOT NULL,
        max_confidence DECIMAL(3, 2) NOT NULL,
        adjustment_factor DECIMAL(4, 3) NOT NULL,
        reason TEXT,
        based_on_samples INTEGER,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_server_calibration (server_id, active)
      );
    `;

    await this.db.query(createCalibrationTable);
    logger.info('Calibration tables created');
  }

  /**
   * Analyze calibration for a server
   */
  async analyzeCalibration(serverId: string, days: number = 30): Promise<CalibrationProfile> {
    const feedback = await this.feedbackCollector.getRecentFeedback(serverId, days, 1000);

    if (feedback.length < 50) {
      logger.warn(`Insufficient data for calibration analysis: ${feedback.length} samples`);
      return {
        serverId,
        overallError: 0,
        overallStatus: 'insufficient-data',
        buckets: [],
        adjustments: [],
        lastCalibrated: new Date(),
        dataPoints: feedback.length
      };
    }

    // Analyze each confidence range
    const buckets: CalibrationBucket[] = this.RANGES.map(range => {
      const inRange = feedback.filter(f =>
        f.becasSuggestion.confidence >= range.min && f.becasSuggestion.confidence < range.max
      );

      if (inRange.length === 0) {
        return {
          range: range.label,
          minConfidence: range.min,
          maxConfidence: range.max,
          avgConfidence: 0,
          totalDecisions: 0,
          correct: 0,
          accuracy: 0,
          calibrationError: 0,
          status: 'insufficient-data' as any
        };
      }

      const correct = inRange.filter(f => f.wasBecasCorrect).length;
      const accuracy = (correct / inRange.length) * 100;
      const avgConfidence = inRange.reduce((sum, f) => sum + f.becasSuggestion.confidence, 0) / inRange.length;
      const calibrationError = Math.abs((avgConfidence * 100) - accuracy);

      // Determine status
      let status: CalibrationBucket['status'];
      if (calibrationError < 10) {
        status = 'well-calibrated';
      } else if (calibrationError < this.CALIBRATION_ERROR_THRESHOLD) {
        status = 'moderately-calibrated';
      } else {
        // Overconfident or underconfident?
        if ((avgConfidence * 100) > accuracy) {
          status = 'overconfident'; // Says high confidence but low accuracy
        } else {
          status = 'underconfident'; // Says low confidence but high accuracy
        }
      }

      return {
        range: range.label,
        minConfidence: range.min,
        maxConfidence: range.max,
        avgConfidence: parseFloat((avgConfidence * 100).toFixed(2)),
        totalDecisions: inRange.length,
        correct,
        accuracy: parseFloat(accuracy.toFixed(2)),
        calibrationError: parseFloat(calibrationError.toFixed(2)),
        status
      };
    });

    // Calculate overall calibration error (weighted by sample size)
    const totalDecisions = buckets.reduce((sum, b) => sum + b.totalDecisions, 0);
    const weightedError = buckets.reduce((sum, b) => sum + (b.calibrationError * b.totalDecisions), 0);
    const overallError = totalDecisions > 0 ? weightedError / totalDecisions : 0;

    const overallStatus =
      overallError < 10 ? 'well-calibrated' :
      overallError < this.CALIBRATION_ERROR_THRESHOLD ? 'moderately-calibrated' :
      'poorly-calibrated';

    // Get existing adjustments
    const adjustments = await this.getActiveAdjustments(serverId);

    const profile: CalibrationProfile = {
      serverId,
      overallError: parseFloat(overallError.toFixed(2)),
      overallStatus,
      buckets,
      adjustments,
      lastCalibrated: new Date(),
      dataPoints: feedback.length
    };

    this.calibrationProfiles.set(serverId, profile);

    logger.info(`Calibration analysis for server ${serverId}:`, {
      overallError: profile.overallError,
      status: profile.overallStatus,
      dataPoints: profile.dataPoints
    });

    return profile;
  }

  /**
   * Generate calibration adjustments based on analysis
   */
  async generateAdjustments(serverId: string, days: number = 30): Promise<CalibrationAdjustment[]> {
    const profile = await this.analyzeCalibration(serverId, days);

    if (profile.dataPoints < 50) {
      logger.warn('Insufficient data for generating adjustments');
      return [];
    }

    const adjustments: CalibrationAdjustment[] = [];

    for (const bucket of profile.buckets) {
      // Need minimum samples
      if (bucket.totalDecisions < this.MIN_SAMPLES_PER_BUCKET) {
        continue;
      }

      // Need significant calibration error
      if (bucket.calibrationError < this.CALIBRATION_ERROR_THRESHOLD) {
        continue;
      }

      // Calculate adjustment factor
      let adjustmentFactor = 1.0;
      let reason = '';

      if (bucket.status === 'overconfident') {
        // Reduce confidence (multiply by <1.0)
        const errorRatio = bucket.accuracy / bucket.avgConfidence;
        adjustmentFactor = Math.max(1.0 - this.MAX_ADJUSTMENT, errorRatio);
        reason = `Overconfident: Claims ${bucket.avgConfidence}% confidence but only ${bucket.accuracy}% accurate`;
      } else if (bucket.status === 'underconfident') {
        // Increase confidence (multiply by >1.0)
        const errorRatio = bucket.accuracy / bucket.avgConfidence;
        adjustmentFactor = Math.min(1.0 + this.MAX_ADJUSTMENT, errorRatio);
        reason = `Underconfident: Claims ${bucket.avgConfidence}% confidence but ${bucket.accuracy}% accurate`;
      }

      // Round to 2 decimals
      adjustmentFactor = parseFloat(adjustmentFactor.toFixed(2));

      // Only create if adjustment is meaningful (>5% change)
      if (Math.abs(adjustmentFactor - 1.0) >= this.ADJUSTMENT_STEP) {
        const adjustment: CalibrationAdjustment = {
          id: `cal-${serverId}-${bucket.range}-${Date.now()}`,
          serverId,
          confidenceRange: bucket.range,
          minConfidence: bucket.minConfidence,
          maxConfidence: bucket.maxConfidence,
          adjustmentFactor,
          reason,
          basedOnSamples: bucket.totalDecisions,
          createdAt: new Date(),
          active: true
        };

        adjustments.push(adjustment);
      }
    }

    // Save adjustments to database
    for (const adj of adjustments) {
      await this.saveAdjustment(adj);
    }

    logger.info(`Generated ${adjustments.length} calibration adjustments for server ${serverId}`);

    return adjustments;
  }

  /**
   * Save calibration adjustment to database
   */
  private async saveAdjustment(adjustment: CalibrationAdjustment): Promise<void> {
    const query = `
      INSERT INTO confidence_calibration
      (id, server_id, confidence_range, min_confidence, max_confidence,
       adjustment_factor, reason, based_on_samples, active, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        adjustment_factor = EXCLUDED.adjustment_factor,
        reason = EXCLUDED.reason,
        based_on_samples = EXCLUDED.based_on_samples,
        active = EXCLUDED.active
    `;

    await this.db.query(query, [
      adjustment.id,
      adjustment.serverId,
      adjustment.confidenceRange,
      adjustment.minConfidence,
      adjustment.maxConfidence,
      adjustment.adjustmentFactor,
      adjustment.reason,
      adjustment.basedOnSamples,
      adjustment.active,
      adjustment.createdAt
    ]);
  }

  /**
   * Get active calibration adjustments for a server
   */
  async getActiveAdjustments(serverId: string): Promise<CalibrationAdjustment[]> {
    const query = `
      SELECT * FROM confidence_calibration
      WHERE server_id = $1 AND active = true
      ORDER BY created_at DESC
    `;

    const result = await this.db.query(query, [serverId]);

    return result.rows.map(row => ({
      id: row.id,
      serverId: row.server_id,
      confidenceRange: row.confidence_range,
      minConfidence: parseFloat(row.min_confidence),
      maxConfidence: parseFloat(row.max_confidence),
      adjustmentFactor: parseFloat(row.adjustment_factor),
      reason: row.reason,
      basedOnSamples: row.based_on_samples,
      createdAt: new Date(row.created_at),
      active: row.active
    }));
  }

  /**
   * Apply calibration adjustment to a confidence score
   *
   * This is called AFTER BECAS makes a decision to adjust the confidence score.
   */
  applyCalibration(serverId: string, rawConfidence: number): number {
    // Get server adjustments from cache
    const profile = this.calibrationProfiles.get(serverId);
    if (!profile || profile.adjustments.length === 0) {
      return rawConfidence; // No adjustments
    }

    // Find the adjustment for this confidence range
    const adjustment = profile.adjustments.find(adj =>
      rawConfidence >= adj.minConfidence && rawConfidence < adj.maxConfidence
    );

    if (!adjustment) {
      return rawConfidence; // No adjustment for this range
    }

    // Apply adjustment factor
    const calibratedConfidence = rawConfidence * adjustment.adjustmentFactor;

    // Clamp to [0, 1]
    const finalConfidence = Math.max(0, Math.min(1, calibratedConfidence));

    logger.debug(`Confidence calibration: ${rawConfidence.toFixed(2)} → ${finalConfidence.toFixed(2)} (factor: ${adjustment.adjustmentFactor})`);

    return finalConfidence;
  }

  /**
   * Load calibration profiles for all servers into memory
   */
  async loadAllProfiles(): Promise<void> {
    const query = `
      SELECT DISTINCT server_id FROM confidence_calibration WHERE active = true
    `;

    const result = await this.db.query(query);
    const serverIds = result.rows.map(row => row.server_id);

    for (const serverId of serverIds) {
      try {
        await this.analyzeCalibration(serverId, 30);
      } catch (error) {
        logger.error(`Failed to load calibration profile for server ${serverId}:`, error);
      }
    }

    logger.info(`Loaded ${this.calibrationProfiles.size} calibration profiles`);
  }

  /**
   * Deactivate old adjustments and generate new ones
   */
  async recalibrate(serverId: string, days: number = 30): Promise<{
    deactivated: number;
    generated: number;
    adjustments: CalibrationAdjustment[];
  }> {
    // Deactivate old adjustments
    const deactivateQuery = `
      UPDATE confidence_calibration
      SET active = false
      WHERE server_id = $1 AND active = true
    `;

    const deactivateResult = await this.db.query(deactivateQuery, [serverId]);
    const deactivated = deactivateResult.rowCount || 0;

    // Generate new adjustments
    const adjustments = await this.generateAdjustments(serverId, days);

    logger.info(`Recalibrated server ${serverId}: deactivated ${deactivated}, generated ${adjustments.length}`);

    return {
      deactivated,
      generated: adjustments.length,
      adjustments
    };
  }

  /**
   * Get calibration report for a server
   */
  async getCalibrationReport(serverId: string, days: number = 30): Promise<{
    profile: CalibrationProfile;
    recommendations: string[];
  }> {
    const profile = await this.analyzeCalibration(serverId, days);

    const recommendations: string[] = [];

    // Overall recommendations
    if (profile.overallStatus === 'well-calibrated') {
      recommendations.push('✅ Confidence scores are well-calibrated. No adjustments needed.');
    } else if (profile.overallStatus === 'poorly-calibrated') {
      recommendations.push('⚠️ Confidence scores are poorly calibrated. Consider recalibration.');
    }

    // Bucket-specific recommendations
    for (const bucket of profile.buckets) {
      if (bucket.totalDecisions < this.MIN_SAMPLES_PER_BUCKET) {
        continue;
      }

      if (bucket.status === 'overconfident') {
        recommendations.push(
          `📉 ${bucket.range} range is overconfident (${bucket.avgConfidence}% confidence → ${bucket.accuracy}% accuracy). Reduce confidence scores.`
        );
      } else if (bucket.status === 'underconfident') {
        recommendations.push(
          `📈 ${bucket.range} range is underconfident (${bucket.avgConfidence}% confidence → ${bucket.accuracy}% accuracy). Increase confidence scores.`
        );
      }
    }

    // Data sufficiency
    if (profile.dataPoints < 100) {
      recommendations.push(`ℹ️ Limited data (${profile.dataPoints} samples). Need 100+ for reliable calibration.`);
    }

    return { profile, recommendations };
  }

  /**
   * Background task: Periodic recalibration
   */
  async startPeriodicRecalibration(intervalDays: number = 7): Promise<void> {
    const interval = intervalDays * 24 * 60 * 60 * 1000;

    setInterval(async () => {
      logger.info('Starting periodic recalibration...');

      // Get all servers with calibration data
      const query = `SELECT DISTINCT server_id FROM confidence_calibration`;
      const result = await this.db.query(query);
      const serverIds = result.rows.map(row => row.server_id);

      for (const serverId of serverIds) {
        try {
          const result = await this.recalibrate(serverId, 30);
          logger.info(`Recalibrated server ${serverId}:`, result);
        } catch (error) {
          logger.error(`Failed to recalibrate server ${serverId}:`, error);
        }
      }

      logger.info('Periodic recalibration complete');
    }, interval);

    logger.info(`Periodic recalibration started (every ${intervalDays} days)`);
  }
}

/**
 * Example usage:
 *
 * const calibrator = new ConfidenceCalibrator(db, feedbackCollector);
 * await calibrator.initialize();
 *
 * // Analyze calibration
 * const profile = await calibrator.analyzeCalibration('server-123', 30);
 * console.log('Overall error:', profile.overallError);
 * console.log('Status:', profile.overallStatus);
 *
 * // Generate adjustments
 * const adjustments = await calibrator.generateAdjustments('server-123', 30);
 * console.log('Generated adjustments:', adjustments.length);
 *
 * // Apply calibration to a confidence score
 * const rawConfidence = 0.85;
 * const calibrated = calibrator.applyCalibration('server-123', rawConfidence);
 * console.log('Calibrated:', calibrated);
 *
 * // Recalibrate (deactivate old, generate new)
 * const result = await calibrator.recalibrate('server-123', 30);
 * console.log('Recalibration result:', result);
 *
 * // Get calibration report
 * const report = await calibrator.getCalibrationReport('server-123', 30);
 * console.log('Report:', report);
 *
 * // Start periodic recalibration (every 7 days)
 * await calibrator.startPeriodicRecalibration(7);
 *
 * // Integration with ThreatAggregator:
 * // In ThreatAggregator.aggregateThreats():
 * const rawConfidence = this.calculateConfidence(layers);
 * const calibratedConfidence = this.calibrator.applyCalibration(serverId, rawConfidence);
 * return { ...result, confidence: calibratedConfidence };
 */
