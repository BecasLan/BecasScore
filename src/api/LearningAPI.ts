import express, { Request, Response, Router } from 'express';
import { FeedbackCollector } from '../services/FeedbackCollector';
import { LearningEngine } from '../services/LearningEngine';
import { ABTesting } from '../services/ABTesting';
import logger from '../utils/logger';

/**
 * LearningAPI
 *
 * REST API for accessing learning metrics, feedback data, adjustments, and A/B tests.
 * Provides comprehensive insights into BECAS learning and improvement over time.
 *
 * Endpoints:
 * - GET /api/learning/metrics/:serverId - Overall learning metrics
 * - GET /api/learning/feedback/:serverId - Recent feedback entries
 * - GET /api/learning/adjustments/:serverId - Learning adjustments history
 * - GET /api/learning/tests/:serverId - A/B tests list and results
 * - GET /api/learning/tests/:testId/details - Detailed test results
 * - POST /api/learning/analyze/:serverId - Trigger learning analysis
 * - GET /api/learning/performance/:serverId - Performance over time
 * - GET /api/learning/calibration/:serverId - Confidence calibration metrics
 */
export class LearningAPI {
  private router: Router;
  private feedbackCollector: FeedbackCollector;
  private learningEngine: LearningEngine;
  private abTesting: ABTesting;

  constructor(
    feedbackCollector: FeedbackCollector,
    learningEngine: LearningEngine,
    abTesting: ABTesting
  ) {
    this.router = express.Router();
    this.feedbackCollector = feedbackCollector;
    this.learningEngine = learningEngine;
    this.abTesting = abTesting;

    this.setupRoutes();
  }

  /**
   * Setup all API routes
   */
  private setupRoutes(): void {
    // Learning metrics
    this.router.get('/metrics/:serverId', this.getMetrics.bind(this));

    // Feedback data
    this.router.get('/feedback/:serverId', this.getFeedback.bind(this));

    // Learning adjustments
    this.router.get('/adjustments/:serverId', this.getAdjustments.bind(this));

    // A/B tests
    this.router.get('/tests/:serverId', this.getTests.bind(this));
    this.router.get('/tests/:testId/details', this.getTestDetails.bind(this));

    // Trigger learning
    this.router.post('/analyze/:serverId', this.triggerAnalysis.bind(this));

    // Performance over time
    this.router.get('/performance/:serverId', this.getPerformance.bind(this));

    // Confidence calibration
    this.router.get('/calibration/:serverId', this.getCalibration.bind(this));
  }

  /**
   * GET /api/learning/metrics/:serverId
   *
   * Returns overall learning metrics for a server:
   * - Override rate (% of BECAS decisions that moderators override)
   * - False positive rate (% of actions that were too harsh)
   * - False negative rate (% of actions that were too lenient)
   * - Accuracy (% of correct decisions)
   * - Confidence calibration (how well confidence scores match actual accuracy)
   * - Learning progress (improvements over time)
   */
  private async getMetrics(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const days = parseInt(req.query.days as string) || 30;

      // Get feedback data
      const feedback = await this.feedbackCollector.getRecentFeedback(serverId, days, 1000);

      if (feedback.length === 0) {
        res.json({
          serverId,
          period: `${days} days`,
          totalDecisions: 0,
          message: 'No feedback data available yet'
        });
        return;
      }

      // Calculate metrics
      const totalDecisions = feedback.length;
      const overrides = feedback.filter(f => f.feedbackType === 'override').length;
      const corrections = feedback.filter(f => f.feedbackType === 'correction').length;
      const confirmations = feedback.filter(f => f.feedbackType === 'confirmation').length;

      const tooHarsh = feedback.filter(f => f.feedbackCategory === 'too_harsh').length;
      const tooLenient = feedback.filter(f => f.feedbackCategory === 'too_lenient').length;
      const goodCalls = feedback.filter(f => f.feedbackCategory === 'good_call').length;
      const falsePositives = feedback.filter(f => f.feedbackCategory === 'false_positive').length;
      const missedThreats = feedback.filter(f => f.feedbackCategory === 'missed_threat').length;

      const overrideRate = (overrides / totalDecisions) * 100;
      const falsePositiveRate = (falsePositives / totalDecisions) * 100;
      const falseNegativeRate = (missedThreats / totalDecisions) * 100;
      const accuracy = ((goodCalls + confirmations) / totalDecisions) * 100;

      // Confidence calibration
      const highConfidenceCorrect = feedback.filter(f => f.becasSuggestion.confidence >= 0.8 && f.wasBecasCorrect).length;
      const highConfidenceTotal = feedback.filter(f => f.becasSuggestion.confidence >= 0.8).length;
      const highConfidenceAccuracy = highConfidenceTotal > 0 ? (highConfidenceCorrect / highConfidenceTotal) * 100 : 0;

      const lowConfidenceCorrect = feedback.filter(f => f.becasSuggestion.confidence < 0.5 && f.wasBecasCorrect).length;
      const lowConfidenceTotal = feedback.filter(f => f.becasSuggestion.confidence < 0.5).length;
      const lowConfidenceAccuracy = lowConfidenceTotal > 0 ? (lowConfidenceCorrect / lowConfidenceTotal) * 100 : 0;

      // Average confidence
      const avgConfidence = feedback.reduce((sum, f) => sum + f.becasSuggestion.confidence, 0) / totalDecisions;

      // Learning profile
      const profile = this.learningEngine.getServerProfile(serverId);

      // Trend (compare with previous period)
      const previousPeriod = await this.feedbackCollector.getRecentFeedback(serverId, days * 2, 1000);
      const previousFeedback = previousPeriod.slice(feedback.length);
      const previousOverrideRate = previousFeedback.length > 0
        ? (previousFeedback.filter(f => f.feedbackType === 'override').length / previousFeedback.length) * 100
        : null;

      const trend = previousOverrideRate !== null
        ? overrideRate - previousOverrideRate
        : null;

      res.json({
        serverId,
        period: `${days} days`,
        totalDecisions,
        overrideRate: parseFloat(overrideRate.toFixed(2)),
        falsePositiveRate: parseFloat(falsePositiveRate.toFixed(2)),
        falseNegativeRate: parseFloat(falseNegativeRate.toFixed(2)),
        accuracy: parseFloat(accuracy.toFixed(2)),
        avgConfidence: parseFloat(avgConfidence.toFixed(2)),
        breakdown: {
          overrides,
          corrections,
          confirmations,
          tooHarsh,
          tooLenient,
          goodCalls,
          falsePositives,
          missedThreats
        },
        confidenceCalibration: {
          highConfidence: {
            threshold: 0.8,
            total: highConfidenceTotal,
            correct: highConfidenceCorrect,
            accuracy: parseFloat(highConfidenceAccuracy.toFixed(2))
          },
          lowConfidence: {
            threshold: 0.5,
            total: lowConfidenceTotal,
            correct: lowConfidenceCorrect,
            accuracy: parseFloat(lowConfidenceAccuracy.toFixed(2))
          }
        },
        learningProfile: {
          severityMultipliers: profile.severityMultipliers,
          trustModifiers: profile.trustModifiers,
          contextWeights: profile.contextWeights,
          confidenceAdjustment: profile.confidenceAdjustment,
          learningDataPoints: profile.learningDataPoints
        },
        trend: trend !== null ? {
          overrideRateChange: parseFloat(trend.toFixed(2)),
          direction: trend < 0 ? 'improving' : trend > 0 ? 'declining' : 'stable'
        } : null
      });

    } catch (error) {
      logger.error('Error getting learning metrics:', error);
      res.status(500).json({ error: 'Failed to get learning metrics' });
    }
  }

  /**
   * GET /api/learning/feedback/:serverId
   *
   * Returns recent feedback entries with filtering options.
   */
  private async getFeedback(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const days = parseInt(req.query.days as string) || 7;
      const limit = parseInt(req.query.limit as string) || 100;
      const category = req.query.category as string;

      let feedback = await this.feedbackCollector.getRecentFeedback(serverId, days, limit);

      // Filter by category if specified
      if (category) {
        feedback = feedback.filter(f => f.feedbackCategory === category);
      }

      res.json({
        serverId,
        period: `${days} days`,
        total: feedback.length,
        feedback: feedback.map(f => ({
          id: f.id,
          timestamp: f.createdAt,
          moderatorId: f.moderatorId,
          targetUserId: f.targetUserId,
          becas: {
            action: f.becasSuggestion.action,
            confidence: f.becasSuggestion.confidence,
            threatScore: f.becasSuggestion.threatScore,
            reason: f.becasSuggestion.reason
          },
          moderator: {
            action: f.moderatorAction.action,
            reason: f.moderatorAction.reason
          },
          feedback: {
            type: f.feedbackType,
            category: f.feedbackCategory,
            severityDifference: f.severityDifference,
            wasCorrect: f.wasBecasCorrect
          },
          learningTags: f.learningTags
        }))
      });

    } catch (error) {
      logger.error('Error getting feedback:', error);
      res.status(500).json({ error: 'Failed to get feedback' });
    }
  }

  /**
   * GET /api/learning/adjustments/:serverId
   *
   * Returns learning adjustments made by the LearningEngine.
   */
  private async getAdjustments(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;

      const adjustments = await this.learningEngine.getAdjustments(serverId, limit);

      res.json({
        serverId,
        total: adjustments.length,
        adjustments: adjustments.map(adj => ({
          id: adj.id,
          timestamp: adj.createdAt,
          category: adj.category,
          parameter: adj.parameter,
          change: {
            oldValue: adj.oldValue,
            newValue: adj.newValue,
            delta: parseFloat((adj.newValue - adj.oldValue).toFixed(3))
          },
          reason: adj.reason,
          confidence: adj.confidence,
          basedOnSamples: adj.basedOnSamples,
          active: adj.active
        }))
      });

    } catch (error) {
      logger.error('Error getting adjustments:', error);
      res.status(500).json({ error: 'Failed to get adjustments' });
    }
  }

  /**
   * GET /api/learning/tests/:serverId
   *
   * Returns all A/B tests for a server.
   */
  private async getTests(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const status = req.query.status as string;

      const tests = await this.abTesting.getServerTests(serverId);

      // Filter by status if specified
      const filteredTests = status
        ? tests.filter(t => t.status === status)
        : tests;

      res.json({
        serverId,
        total: filteredTests.length,
        tests: filteredTests.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          status: t.status,
          startDate: t.startDate,
          endDate: t.endDate,
          variants: {
            A: {
              name: t.variantA.name,
              decisions: t.metrics.variantA.totalDecisions,
              overrideRate: t.metrics.variantA.overrideRate,
              accuracy: t.metrics.variantA.accuracy
            },
            B: {
              name: t.variantB.name,
              decisions: t.metrics.variantB.totalDecisions,
              overrideRate: t.metrics.variantB.overrideRate,
              accuracy: t.metrics.variantB.accuracy
            }
          },
          winner: t.winner,
          autoPromote: t.autoPromote,
          minSampleSize: t.minSampleSize
        }))
      });

    } catch (error) {
      logger.error('Error getting tests:', error);
      res.status(500).json({ error: 'Failed to get tests' });
    }
  }

  /**
   * GET /api/learning/tests/:testId/details
   *
   * Returns detailed results for a specific A/B test.
   */
  private async getTestDetails(req: Request, res: Response): Promise<void> {
    try {
      const { testId } = req.params;

      const results = await this.abTesting.getTestResults(testId);

      if (!results) {
        res.status(404).json({ error: 'Test not found' });
        return;
      }

      res.json(results);

    } catch (error) {
      logger.error('Error getting test details:', error);
      res.status(500).json({ error: 'Failed to get test details' });
    }
  }

  /**
   * POST /api/learning/analyze/:serverId
   *
   * Manually trigger learning analysis for a server.
   */
  private async triggerAnalysis(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const days = parseInt(req.body.days as string) || 7;

      logger.info(`Manual learning analysis triggered for server ${serverId} (${days} days)`);

      const result = await this.learningEngine.analyzeFeedbackAndLearn(serverId, days);

      res.json({
        serverId,
        period: `${days} days`,
        adjustmentsMade: result.adjustmentsMade,
        adjustments: result.adjustments.map(adj => ({
          category: adj.category,
          parameter: adj.parameter,
          oldValue: adj.oldValue,
          newValue: adj.newValue,
          reason: adj.reason,
          confidence: adj.confidence
        }))
      });

    } catch (error) {
      logger.error('Error triggering analysis:', error);
      res.status(500).json({ error: 'Failed to trigger analysis' });
    }
  }

  /**
   * GET /api/learning/performance/:serverId
   *
   * Returns performance metrics over time (weekly breakdown).
   */
  private async getPerformance(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const weeks = parseInt(req.query.weeks as string) || 8;

      const weeklyData: any[] = [];

      for (let week = 0; week < weeks; week++) {
        const startDay = week * 7;
        const endDay = (week + 1) * 7;

        const feedback = await this.feedbackCollector.getRecentFeedback(serverId, endDay, 1000);
        const weekFeedback = feedback.slice(0, Math.min(feedback.length, feedback.length - (await this.feedbackCollector.getRecentFeedback(serverId, startDay, 1000)).length));

        if (weekFeedback.length === 0) continue;

        const overrides = weekFeedback.filter(f => f.feedbackType === 'override').length;
        const overrideRate = (overrides / weekFeedback.length) * 100;
        const accuracy = (weekFeedback.filter(f => f.wasBecasCorrect).length / weekFeedback.length) * 100;
        const avgConfidence = weekFeedback.reduce((sum, f) => sum + f.becasSuggestion.confidence, 0) / weekFeedback.length;

        weeklyData.push({
          week: weeks - week,
          weekLabel: `Week ${weeks - week}`,
          startDate: new Date(Date.now() - endDay * 24 * 60 * 60 * 1000),
          endDate: new Date(Date.now() - startDay * 24 * 60 * 60 * 1000),
          totalDecisions: weekFeedback.length,
          overrideRate: parseFloat(overrideRate.toFixed(2)),
          accuracy: parseFloat(accuracy.toFixed(2)),
          avgConfidence: parseFloat(avgConfidence.toFixed(2))
        });
      }

      weeklyData.reverse();

      res.json({
        serverId,
        period: `${weeks} weeks`,
        weeklyData
      });

    } catch (error) {
      logger.error('Error getting performance:', error);
      res.status(500).json({ error: 'Failed to get performance data' });
    }
  }

  /**
   * GET /api/learning/calibration/:serverId
   *
   * Returns confidence calibration metrics (how well confidence scores match actual accuracy).
   */
  private async getCalibration(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const days = parseInt(req.query.days as string) || 30;

      const feedback = await this.feedbackCollector.getRecentFeedback(serverId, days, 1000);

      if (feedback.length === 0) {
        res.json({
          serverId,
          message: 'No feedback data available'
        });
        return;
      }

      // Group by confidence ranges
      const ranges = [
        { min: 0.0, max: 0.2, label: '0-20%' },
        { min: 0.2, max: 0.4, label: '20-40%' },
        { min: 0.4, max: 0.6, label: '40-60%' },
        { min: 0.6, max: 0.8, label: '60-80%' },
        { min: 0.8, max: 1.0, label: '80-100%' }
      ];

      const calibration = ranges.map(range => {
        const inRange = feedback.filter(f =>
          f.becasSuggestion.confidence >= range.min && f.becasSuggestion.confidence < range.max
        );

        const correct = inRange.filter(f => f.wasBecasCorrect).length;
        const accuracy = inRange.length > 0 ? (correct / inRange.length) * 100 : 0;
        const avgConfidence = inRange.length > 0
          ? inRange.reduce((sum, f) => sum + f.becasSuggestion.confidence, 0) / inRange.length
          : 0;

        const calibrationError = Math.abs((avgConfidence * 100) - accuracy);

        return {
          range: range.label,
          minConfidence: range.min,
          maxConfidence: range.max,
          avgConfidence: parseFloat((avgConfidence * 100).toFixed(2)),
          totalDecisions: inRange.length,
          correct,
          accuracy: parseFloat(accuracy.toFixed(2)),
          calibrationError: parseFloat(calibrationError.toFixed(2)),
          status: calibrationError < 10 ? 'well-calibrated' : calibrationError < 20 ? 'moderately-calibrated' : 'poorly-calibrated'
        };
      });

      // Overall calibration score
      const totalError = calibration.reduce((sum, c) => sum + (c.calibrationError * c.totalDecisions), 0);
      const totalDecisions = feedback.length;
      const overallCalibration = totalError / totalDecisions;

      res.json({
        serverId,
        period: `${days} days`,
        totalDecisions,
        overallCalibrationError: parseFloat(overallCalibration.toFixed(2)),
        overallStatus: overallCalibration < 10 ? 'well-calibrated' : overallCalibration < 20 ? 'moderately-calibrated' : 'poorly-calibrated',
        calibrationByRange: calibration,
        recommendations: this.generateCalibrationRecommendations(calibration)
      });

    } catch (error) {
      logger.error('Error getting calibration:', error);
      res.status(500).json({ error: 'Failed to get calibration data' });
    }
  }

  /**
   * Generate recommendations based on calibration data
   */
  private generateCalibrationRecommendations(calibration: any[]): string[] {
    const recommendations: string[] = [];

    // Check for overconfidence
    const highConfRange = calibration.find(c => c.minConfidence >= 0.8);
    if (highConfRange && highConfRange.calibrationError > 15) {
      recommendations.push(`Overconfident: High confidence decisions (${highConfRange.avgConfidence}%) are only ${highConfRange.accuracy}% accurate. Consider reducing confidence scores.`);
    }

    // Check for underconfidence
    const lowConfRange = calibration.find(c => c.maxConfidence <= 0.4);
    if (lowConfRange && lowConfRange.accuracy > lowConfRange.avgConfidence + 20) {
      recommendations.push(`Underconfident: Low confidence decisions are more accurate than expected. Consider increasing confidence scores.`);
    }

    // Check for insufficient data
    const insufficientData = calibration.filter(c => c.totalDecisions < 10);
    if (insufficientData.length > 0) {
      recommendations.push(`Insufficient data in ${insufficientData.length} confidence ranges. Need more decisions for reliable calibration.`);
    }

    // Check overall calibration
    const avgError = calibration.reduce((sum, c) => sum + c.calibrationError, 0) / calibration.length;
    if (avgError < 10) {
      recommendations.push('Well-calibrated overall. Confidence scores accurately reflect decision quality.');
    } else if (avgError > 20) {
      recommendations.push('Poorly calibrated. Consider reviewing confidence calculation logic.');
    }

    return recommendations;
  }

  /**
   * Get the Express router
   */
  getRouter(): Router {
    return this.router;
  }
}

/**
 * Example usage:
 *
 * const feedbackCollector = new FeedbackCollector(db);
 * const learningEngine = new LearningEngine(feedbackCollector, db);
 * const abTesting = new ABTesting(db);
 * const learningAPI = new LearningAPI(feedbackCollector, learningEngine, abTesting);
 *
 * app.use('/api/learning', learningAPI.getRouter());
 *
 * // Get metrics
 * GET /api/learning/metrics/123456789?days=30
 *
 * // Get feedback
 * GET /api/learning/feedback/123456789?days=7&category=too_harsh
 *
 * // Get adjustments
 * GET /api/learning/adjustments/123456789?limit=50
 *
 * // Get A/B tests
 * GET /api/learning/tests/123456789?status=running
 *
 * // Get test details
 * GET /api/learning/tests/test-abc-123/details
 *
 * // Trigger analysis
 * POST /api/learning/analyze/123456789
 * Body: { "days": 7 }
 *
 * // Get performance over time
 * GET /api/learning/performance/123456789?weeks=8
 *
 * // Get calibration
 * GET /api/learning/calibration/123456789?days=30
 */
