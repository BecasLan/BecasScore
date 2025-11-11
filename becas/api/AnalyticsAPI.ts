import express, { Request, Response, Router } from 'express';
import { Pool } from 'pg';
import { Client } from 'discord.js';
import { AnomalyDetector } from '../analytics/AnomalyDetector';
import { ConflictPredictor } from '../analytics/ConflictPredictor';
import { ServerHealthMonitor } from '../analytics/ServerHealthMonitor';
import { ReportGenerator } from '../analytics/ReportGenerator';
import { AlertSystem } from '../analytics/AlertSystem';
import { TopicAnalyzer } from '../analytics/TopicAnalyzer';
import logger from '../utils/logger';

/**
 * AnalyticsAPI
 *
 * REST API for analytics and prediction systems.
 * Provides endpoints for anomalies, conflicts, health, reports, alerts, and topics.
 *
 * Endpoints:
 * - GET /api/analytics/health/:serverId - Current server health
 * - GET /api/analytics/health/:serverId/history - Health history
 * - GET /api/analytics/anomalies/:serverId - Recent anomalies
 * - GET /api/analytics/conflicts/:serverId - Active conflict predictions
 * - GET /api/analytics/topics/:serverId - Trending topics
 * - GET /api/analytics/reports/:serverId - Recent reports
 * - POST /api/analytics/reports/:serverId/generate - Generate custom report
 * - GET /api/analytics/alerts/:serverId - Recent alerts
 * - GET /api/analytics/trends/:serverId - Trend data for charts
 * - GET /api/analytics/summary/:serverId - Complete analytics summary
 */

export class AnalyticsAPI {
  private router: Router;
  private anomalyDetector: AnomalyDetector;
  private conflictPredictor: ConflictPredictor;
  private healthMonitor: ServerHealthMonitor;
  private reportGenerator: ReportGenerator;
  private alertSystem: AlertSystem;
  private topicAnalyzer: TopicAnalyzer;

  constructor(
    private db: Pool,
    private discordClient: Client,
    private ollamaService: any
  ) {
    this.router = express.Router();

    // Initialize analytics systems
    this.anomalyDetector = new AnomalyDetector(db);
    this.conflictPredictor = new ConflictPredictor(db, discordClient);
    this.healthMonitor = new ServerHealthMonitor(db, discordClient);
    this.reportGenerator = new ReportGenerator(db, discordClient, ollamaService);
    this.alertSystem = new AlertSystem(db, discordClient);
    this.topicAnalyzer = new TopicAnalyzer(db);

    this.setupRoutes();
  }

  /**
   * Setup all API routes
   */
  private setupRoutes(): void {
    // Health endpoints
    this.router.get('/health/:serverId', this.getCurrentHealth.bind(this));
    this.router.get('/health/:serverId/history', this.getHealthHistory.bind(this));

    // Anomaly endpoints
    this.router.get('/anomalies/:serverId', this.getAnomalies.bind(this));
    this.router.post('/anomalies/:serverId/detect', this.detectAnomalies.bind(this));

    // Conflict endpoints
    this.router.get('/conflicts/:serverId', this.getConflicts.bind(this));
    this.router.post('/conflicts/:serverId/predict', this.predictConflicts.bind(this));
    this.router.get('/conflicts/:serverId/accuracy', this.getConflictAccuracy.bind(this));

    // Topic endpoints
    this.router.get('/topics/:serverId', this.getTopics.bind(this));
    this.router.get('/topics/:serverId/trending', this.getTrendingTopics.bind(this));
    this.router.post('/topics/:serverId/analyze', this.analyzeTopics.bind(this));

    // Report endpoints
    this.router.get('/reports/:serverId', this.getReports.bind(this));
    this.router.get('/reports/:serverId/:reportId', this.getReport.bind(this));
    this.router.post('/reports/:serverId/generate', this.generateReport.bind(this));

    // Alert endpoints
    this.router.get('/alerts/:serverId', this.getAlerts.bind(this));
    this.router.get('/alerts/:serverId/stats', this.getAlertStats.bind(this));
    this.router.post('/alerts/:alertId/acknowledge', this.acknowledgeAlert.bind(this));

    // Trend/visualization endpoints
    this.router.get('/trends/:serverId', this.getTrends.bind(this));
    this.router.get('/summary/:serverId', this.getSummary.bind(this));

    // Statistics endpoints
    this.router.get('/stats/:serverId', this.getStats.bind(this));
  }

  /**
   * GET /api/analytics/health/:serverId
   * Get current server health
   */
  private async getCurrentHealth(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;

      const health = await this.healthMonitor.getCurrentHealth(serverId);

      if (!health) {
        res.status(404).json({ error: 'No health data found' });
        return;
      }

      res.json({ health });

    } catch (error) {
      logger.error('Error getting current health:', error);
      res.status(500).json({ error: 'Failed to get health data' });
    }
  }

  /**
   * GET /api/analytics/health/:serverId/history
   * Get health history
   */
  private async getHealthHistory(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const hours = parseInt(req.query.hours as string) || 24;

      const history = await this.healthMonitor.getHealthHistory(serverId, hours);

      res.json({
        serverId,
        hours,
        dataPoints: history.length,
        history
      });

    } catch (error) {
      logger.error('Error getting health history:', error);
      res.status(500).json({ error: 'Failed to get health history' });
    }
  }

  /**
   * GET /api/analytics/anomalies/:serverId
   * Get recent anomalies
   */
  private async getAnomalies(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const hours = parseInt(req.query.hours as string) || 24;
      const minSeverity = req.query.minSeverity as 'low' | 'medium' | 'high' | 'critical' | undefined;

      const anomalies = await this.anomalyDetector.getRecentAnomalies(serverId, hours, minSeverity);

      res.json({
        serverId,
        hours,
        count: anomalies.length,
        anomalies
      });

    } catch (error) {
      logger.error('Error getting anomalies:', error);
      res.status(500).json({ error: 'Failed to get anomalies' });
    }
  }

  /**
   * POST /api/analytics/anomalies/:serverId/detect
   * Manually trigger anomaly detection
   */
  private async detectAnomalies(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;

      const anomalies = await this.anomalyDetector.detectServerAnomalies(serverId);

      res.json({
        success: true,
        detected: anomalies.length,
        anomalies
      });

    } catch (error) {
      logger.error('Error detecting anomalies:', error);
      res.status(500).json({ error: 'Failed to detect anomalies' });
    }
  }

  /**
   * GET /api/analytics/conflicts/:serverId
   * Get active conflict predictions
   */
  private async getConflicts(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const minRiskLevel = req.query.minRiskLevel as 'low' | 'medium' | 'high' | 'critical' | undefined || 'medium';

      const conflicts = await this.conflictPredictor.getActivePredictions(serverId, minRiskLevel);

      res.json({
        serverId,
        count: conflicts.length,
        conflicts
      });

    } catch (error) {
      logger.error('Error getting conflicts:', error);
      res.status(500).json({ error: 'Failed to get conflicts' });
    }
  }

  /**
   * POST /api/analytics/conflicts/:serverId/predict
   * Manually trigger conflict prediction
   */
  private async predictConflicts(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;

      const predictions = await this.conflictPredictor.predictServerConflicts(serverId);

      res.json({
        success: true,
        predicted: predictions.length,
        predictions
      });

    } catch (error) {
      logger.error('Error predicting conflicts:', error);
      res.status(500).json({ error: 'Failed to predict conflicts' });
    }
  }

  /**
   * GET /api/analytics/conflicts/:serverId/accuracy
   * Get prediction accuracy stats
   */
  private async getConflictAccuracy(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const days = parseInt(req.query.days as string) || 7;

      const accuracy = await this.conflictPredictor.getPredictionAccuracy(serverId, days);

      res.json({
        serverId,
        days,
        accuracy
      });

    } catch (error) {
      logger.error('Error getting conflict accuracy:', error);
      res.status(500).json({ error: 'Failed to get accuracy stats' });
    }
  }

  /**
   * GET /api/analytics/topics/:serverId
   * Get recent topics
   */
  private async getTopics(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;

      const topics = await this.topicAnalyzer.getTrendingTopics(serverId, limit);

      res.json({
        serverId,
        count: topics.length,
        topics
      });

    } catch (error) {
      logger.error('Error getting topics:', error);
      res.status(500).json({ error: 'Failed to get topics' });
    }
  }

  /**
   * GET /api/analytics/topics/:serverId/trending
   * Get trending summary for period
   */
  private async getTrendingTopics(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const days = parseInt(req.query.days as string) || 7;

      const periodEnd = new Date();
      const periodStart = new Date();
      periodStart.setDate(periodStart.getDate() - days);

      const summary = await this.topicAnalyzer.getTrendingSummary(serverId, periodStart, periodEnd);

      res.json(summary);

    } catch (error) {
      logger.error('Error getting trending topics:', error);
      res.status(500).json({ error: 'Failed to get trending topics' });
    }
  }

  /**
   * POST /api/analytics/topics/:serverId/analyze
   * Manually trigger topic analysis
   */
  private async analyzeTopics(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const hours = parseInt(req.body.hours) || 24;

      const topics = await this.topicAnalyzer.analyzeRecentTopics(serverId, hours);

      res.json({
        success: true,
        analyzed: topics.length,
        topics
      });

    } catch (error) {
      logger.error('Error analyzing topics:', error);
      res.status(500).json({ error: 'Failed to analyze topics' });
    }
  }

  /**
   * GET /api/analytics/reports/:serverId
   * Get recent reports
   */
  private async getReports(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;

      const reports = await this.reportGenerator.getRecentReports(serverId, limit);

      res.json({
        serverId,
        count: reports.length,
        reports
      });

    } catch (error) {
      logger.error('Error getting reports:', error);
      res.status(500).json({ error: 'Failed to get reports' });
    }
  }

  /**
   * GET /api/analytics/reports/:serverId/:reportId
   * Get specific report
   */
  private async getReport(req: Request, res: Response): Promise<void> {
    try {
      const { serverId, reportId } = req.params;

      // Query database for specific report
      const query = 'SELECT * FROM analytics_reports WHERE server_id = $1 AND id = $2';
      const result = await this.db.query(query, [serverId, reportId]);

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }

      const row = result.rows[0];
      res.json({
        id: row.id,
        title: row.title,
        summary: row.summary,
        insights: JSON.parse(row.insights || '[]'),
        recommendations: JSON.parse(row.recommendations || '[]'),
        generatedAt: row.generated_at
      });

    } catch (error) {
      logger.error('Error getting report:', error);
      res.status(500).json({ error: 'Failed to get report' });
    }
  }

  /**
   * POST /api/analytics/reports/:serverId/generate
   * Generate custom report
   */
  private async generateReport(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const { reportType, periodStart, periodEnd } = req.body;

      let report;

      if (reportType === 'weekly') {
        report = await this.reportGenerator.generateWeeklyReport(serverId);
      } else if (reportType === 'monthly') {
        report = await this.reportGenerator.generateMonthlyReport(serverId);
      } else if (periodStart && periodEnd) {
        report = await this.reportGenerator.generateCustomReport(
          serverId,
          new Date(periodStart),
          new Date(periodEnd)
        );
      } else {
        res.status(400).json({ error: 'Invalid report type or period' });
        return;
      }

      res.json({
        success: true,
        report
      });

    } catch (error) {
      logger.error('Error generating report:', error);
      res.status(500).json({ error: 'Failed to generate report' });
    }
  }

  /**
   * GET /api/analytics/alerts/:serverId
   * Get recent alerts
   */
  private async getAlerts(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const hours = parseInt(req.query.hours as string) || 24;
      const minSeverity = req.query.minSeverity as 'low' | 'medium' | 'high' | 'critical' | undefined;

      const alerts = await this.alertSystem.getRecentAlerts(serverId, hours, minSeverity);

      res.json({
        serverId,
        hours,
        count: alerts.length,
        alerts
      });

    } catch (error) {
      logger.error('Error getting alerts:', error);
      res.status(500).json({ error: 'Failed to get alerts' });
    }
  }

  /**
   * GET /api/analytics/alerts/:serverId/stats
   * Get alert statistics
   */
  private async getAlertStats(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const days = parseInt(req.query.days as string) || 7;

      const stats = await this.alertSystem.getAlertStats(serverId, days);

      res.json({
        serverId,
        days,
        stats
      });

    } catch (error) {
      logger.error('Error getting alert stats:', error);
      res.status(500).json({ error: 'Failed to get alert stats' });
    }
  }

  /**
   * POST /api/analytics/alerts/:alertId/acknowledge
   * Acknowledge an alert
   */
  private async acknowledgeAlert(req: Request, res: Response): Promise<void> {
    try {
      const { alertId } = req.params;
      const { moderatorId } = req.body;

      if (!moderatorId) {
        res.status(400).json({ error: 'moderatorId required' });
        return;
      }

      await this.alertSystem.acknowledgeAlert(parseInt(alertId), moderatorId);

      res.json({ success: true });

    } catch (error) {
      logger.error('Error acknowledging alert:', error);
      res.status(500).json({ error: 'Failed to acknowledge alert' });
    }
  }

  /**
   * GET /api/analytics/trends/:serverId
   * Get trend data for charts (time-series data)
   */
  private async getTrends(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const days = parseInt(req.query.days as string) || 7;

      const history = await this.healthMonitor.getHealthHistory(serverId, days * 24);

      // Format for charts
      const trends = {
        activity: history.map(h => ({
          timestamp: h.snapshotTime,
          value: h.messagesCount
        })),
        sentiment: history.map(h => ({
          timestamp: h.snapshotTime,
          value: h.avgSentiment
        })),
        toxicity: history.map(h => ({
          timestamp: h.snapshotTime,
          value: h.toxicityRate * 100
        })),
        healthScore: history.map(h => ({
          timestamp: h.snapshotTime,
          value: h.healthScore
        })),
        moderation: history.map(h => ({
          timestamp: h.snapshotTime,
          value: h.moderationActionsCount
        }))
      };

      res.json({
        serverId,
        days,
        trends
      });

    } catch (error) {
      logger.error('Error getting trends:', error);
      res.status(500).json({ error: 'Failed to get trends' });
    }
  }

  /**
   * GET /api/analytics/summary/:serverId
   * Get complete analytics summary
   */
  private async getSummary(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const days = parseInt(req.query.days as string) || 7;

      // Get summary from database function
      const summaryQuery = 'SELECT * FROM get_server_analytics_summary($1, $2)';
      const summaryResult = await this.db.query(summaryQuery, [serverId, days]);

      const summary = summaryResult.rows[0] || {};

      // Get additional data
      const currentHealth = await this.healthMonitor.getCurrentHealth(serverId);
      const recentAnomalies = await this.anomalyDetector.getRecentAnomalies(serverId, days * 24, 'medium');
      const activeConflicts = await this.conflictPredictor.getActivePredictions(serverId, 'medium');
      const trendingTopics = await this.topicAnalyzer.getTrendingTopics(serverId, 5);

      res.json({
        serverId,
        days,
        summary: {
          totalMessages: parseInt(summary.total_messages) || 0,
          totalActiveUsers: parseInt(summary.total_active_users) || 0,
          avgToxicityRate: parseFloat(summary.avg_toxicity_rate) || 0,
          avgSentiment: parseFloat(summary.avg_sentiment) || 0,
          totalModerationActions: parseInt(summary.total_moderation_actions) || 0,
          anomaliesCount: parseInt(summary.anomalies_count) || 0,
          conflictsPredicted: parseInt(summary.conflicts_predicted) || 0,
          avgHealthScore: parseInt(summary.avg_health_score) || 100,
          healthTrend: summary.health_trend || 'stable'
        },
        currentHealth,
        recentAnomalies: recentAnomalies.slice(0, 5),
        activeConflicts: activeConflicts.slice(0, 5),
        trendingTopics
      });

    } catch (error) {
      logger.error('Error getting summary:', error);
      res.status(500).json({ error: 'Failed to get summary' });
    }
  }

  /**
   * GET /api/analytics/stats/:serverId
   * Get comprehensive statistics
   */
  private async getStats(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const days = parseInt(req.query.days as string) || 7;

      const summary = await this.getSummaryData(serverId, days);

      res.json(summary);

    } catch (error) {
      logger.error('Error getting stats:', error);
      res.status(500).json({ error: 'Failed to get stats' });
    }
  }

  /**
   * Get summary data helper
   */
  private async getSummaryData(serverId: string, days: number): Promise<any> {
    const query = 'SELECT * FROM get_server_analytics_summary($1, $2)';
    const result = await this.db.query(query, [serverId, days]);
    return result.rows[0] || {};
  }

  /**
   * Get Express router
   */
  getRouter(): Router {
    return this.router;
  }

  /**
   * Get analytics systems (for external use)
   */
  getAnomalyDetector(): AnomalyDetector {
    return this.anomalyDetector;
  }

  getConflictPredictor(): ConflictPredictor {
    return this.conflictPredictor;
  }

  getHealthMonitor(): ServerHealthMonitor {
    return this.healthMonitor;
  }

  getReportGenerator(): ReportGenerator {
    return this.reportGenerator;
  }

  getAlertSystem(): AlertSystem {
    return this.alertSystem;
  }

  getTopicAnalyzer(): TopicAnalyzer {
    return this.topicAnalyzer;
  }
}

/**
 * Example usage:
 *
 * const analyticsAPI = new AnalyticsAPI(db, discordClient, ollamaService);
 *
 * // Add to Express app
 * app.use('/api/analytics', analyticsAPI.getRouter());
 *
 * // Access systems
 * const healthMonitor = analyticsAPI.getHealthMonitor();
 * healthMonitor.start();
 *
 * const reportGenerator = analyticsAPI.getReportGenerator();
 * reportGenerator.start();
 *
 * // API endpoints now available:
 * // GET /api/analytics/health/SERVER_ID
 * // GET /api/analytics/anomalies/SERVER_ID
 * // GET /api/analytics/conflicts/SERVER_ID
 * // GET /api/analytics/topics/SERVER_ID
 * // GET /api/analytics/summary/SERVER_ID
 * // etc.
 */
