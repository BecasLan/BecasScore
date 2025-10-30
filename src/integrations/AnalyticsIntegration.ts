import { Client } from 'discord.js';
import { Pool } from 'pg';
import * as cron from 'node-cron';
import { AnalyticsAPI } from '../api/AnalyticsAPI';
import { AnomalyDetector } from '../analytics/AnomalyDetector';
import { ConflictPredictor } from '../analytics/ConflictPredictor';
import { ServerHealthMonitor } from '../analytics/ServerHealthMonitor';
import { ReportGenerator } from '../analytics/ReportGenerator';
import { AlertSystem } from '../analytics/AlertSystem';
import { TopicAnalyzer } from '../analytics/TopicAnalyzer';
import logger from '../utils/logger';

/**
 * AnalyticsIntegration
 *
 * Central integration point for all Phase 6 analytics systems.
 * Manages initialization, scheduling, and coordination of:
 * - Anomaly Detection
 * - Conflict Prediction
 * - Server Health Monitoring
 * - AI Report Generation
 * - Alert System
 * - Topic Trend Analysis
 */

export class AnalyticsIntegration {
  private analyticsAPI: AnalyticsAPI;
  private anomalyDetector: AnomalyDetector;
  private conflictPredictor: ConflictPredictor;
  private healthMonitor: ServerHealthMonitor;
  private reportGenerator: ReportGenerator;
  private alertSystem: AlertSystem;
  private topicAnalyzer: TopicAnalyzer;

  private anomalyCron?: cron.ScheduledTask;
  private conflictCron?: cron.ScheduledTask;
  private topicCron?: cron.ScheduledTask;

  private initialized = false;

  constructor(
    private discordClient: Client,
    private db: Pool,
    private ollamaService: any
  ) {
    // Initialize Analytics API (which creates all subsystems)
    this.analyticsAPI = new AnalyticsAPI(db, discordClient, ollamaService);

    // Get references to subsystems
    this.anomalyDetector = this.analyticsAPI.getAnomalyDetector();
    this.conflictPredictor = this.analyticsAPI.getConflictPredictor();
    this.healthMonitor = this.analyticsAPI.getHealthMonitor();
    this.reportGenerator = this.analyticsAPI.getReportGenerator();
    this.alertSystem = this.analyticsAPI.getAlertSystem();
    this.topicAnalyzer = this.analyticsAPI.getTopicAnalyzer();
  }

  /**
   * Initialize all analytics systems
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('AnalyticsIntegration already initialized');
      return;
    }

    try {
      logger.info('Initializing Advanced Analytics & Prediction Systems...');

      // 1. Initialize Alert System
      await this.alertSystem.initialize();
      logger.info('✓ Alert System initialized');

      // 2. Start Health Monitoring (hourly snapshots)
      this.healthMonitor.start();
      logger.info('✓ Server Health Monitor started');

      // 3. Start Report Generation (weekly + monthly)
      this.reportGenerator.start();
      logger.info('✓ Report Generator started');

      // 4. Schedule Anomaly Detection (hourly)
      this.scheduleAnomalyDetection();
      logger.info('✓ Anomaly Detection scheduled');

      // 5. Schedule Conflict Prediction (hourly)
      this.scheduleConflictPrediction();
      logger.info('✓ Conflict Prediction scheduled');

      // 6. Schedule Topic Analysis (every 2 hours)
      this.scheduleTopicAnalysis();
      logger.info('✓ Topic Analysis scheduled');

      this.initialized = true;

      logger.info('✅ Advanced Analytics & Prediction Systems fully initialized!');
      logger.info('📊 PHASE 6 COMPLETE!');

    } catch (error) {
      logger.error('Failed to initialize Analytics Integration:', error);
      throw error;
    }
  }

  /**
   * Schedule hourly anomaly detection
   */
  private scheduleAnomalyDetection(): void {
    // Run every hour at minute 15
    this.anomalyCron = cron.schedule('15 * * * *', async () => {
      logger.info('Running scheduled anomaly detection...');

      const serverIds = this.discordClient.guilds.cache.map(guild => guild.id);

      for (const serverId of serverIds) {
        try {
          const anomalies = await this.anomalyDetector.detectServerAnomalies(serverId);

          // Send alerts for critical/high severity anomalies
          for (const anomaly of anomalies) {
            if (anomaly.severity === 'critical' || anomaly.severity === 'high') {
              await this.alertSystem.sendAnomalyAlert(serverId, anomaly);
            }
          }

        } catch (error) {
          logger.error(`Error detecting anomalies for server ${serverId}:`, error);
        }
      }

      logger.info('✓ Scheduled anomaly detection complete');
    });
  }

  /**
   * Schedule hourly conflict prediction
   */
  private scheduleConflictPrediction(): void {
    // Run every hour at minute 30
    this.conflictCron = cron.schedule('30 * * * *', async () => {
      logger.info('Running scheduled conflict prediction...');

      const serverIds = this.discordClient.guilds.cache.map(guild => guild.id);

      for (const serverId of serverIds) {
        try {
          const predictions = await this.conflictPredictor.predictServerConflicts(serverId);

          // Send alerts for high-risk conflicts
          for (const prediction of predictions) {
            if (prediction.riskLevel === 'critical' || prediction.riskLevel === 'high') {
              await this.alertSystem.sendConflictAlert(serverId, prediction);
            }
          }

        } catch (error) {
          logger.error(`Error predicting conflicts for server ${serverId}:`, error);
        }
      }

      logger.info('✓ Scheduled conflict prediction complete');
    });
  }

  /**
   * Schedule topic analysis (every 2 hours)
   */
  private scheduleTopicAnalysis(): void {
    // Run every 2 hours at minute 45
    this.topicCron = cron.schedule('45 */2 * * *', async () => {
      logger.info('Running scheduled topic analysis...');

      const serverIds = this.discordClient.guilds.cache.map(guild => guild.id);

      for (const serverId of serverIds) {
        try {
          await this.topicAnalyzer.analyzeRecentTopics(serverId, 2);
        } catch (error) {
          logger.error(`Error analyzing topics for server ${serverId}:`, error);
        }
      }

      logger.info('✓ Scheduled topic analysis complete');
    });
  }

  /**
   * Handle message analysis results (integration with Phase 3)
   */
  async handleMessageAnalysis(
    serverId: string,
    userId: string,
    message: any
  ): Promise<void> {
    if (!this.initialized) return;

    try {
      // Detect user anomalies on message
      const userAnomalies = await this.anomalyDetector.detectUserAnomalies(userId, serverId);

      // Send alerts for critical anomalies
      for (const anomaly of userAnomalies) {
        if (anomaly.severity === 'critical') {
          await this.alertSystem.sendAnomalyAlert(serverId, anomaly);
        }
      }

    } catch (error) {
      logger.error('Error handling message analysis in analytics:', error);
    }
  }

  /**
   * Handle health degradation
   */
  async handleHealthDegradation(serverId: string): Promise<void> {
    if (!this.initialized) return;

    try {
      const health = await this.healthMonitor.getCurrentHealth(serverId);

      if (health && health.healthStatus !== 'healthy') {
        await this.alertSystem.sendHealthAlert(serverId, health);
      }

    } catch (error) {
      logger.error('Error handling health degradation:', error);
    }
  }

  /**
   * Get API router for Express
   */
  getAPIRouter() {
    if (!this.initialized) {
      throw new Error('AnalyticsIntegration not initialized');
    }

    return this.analyticsAPI.getRouter();
  }

  /**
   * Get individual systems
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

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: string;
    initialized: boolean;
    systems: {
      healthMonitoring: boolean;
      reportGeneration: boolean;
      anomalyDetection: boolean;
      conflictPrediction: boolean;
      topicAnalysis: boolean;
    };
  }> {
    return {
      status: this.initialized ? 'healthy' : 'not_initialized',
      initialized: this.initialized,
      systems: {
        healthMonitoring: !!this.anomalyCron,
        reportGeneration: this.reportGenerator !== undefined,
        anomalyDetection: !!this.anomalyCron,
        conflictPrediction: !!this.conflictCron,
        topicAnalysis: !!this.topicCron
      }
    };
  }

  /**
   * Shutdown all systems gracefully
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Analytics Integration...');

    // Stop cron jobs
    if (this.anomalyCron) this.anomalyCron.stop();
    if (this.conflictCron) this.conflictCron.stop();
    if (this.topicCron) this.topicCron.stop();

    // Stop health monitor
    this.healthMonitor.stop();

    // Stop report generator
    this.reportGenerator.stop();

    this.initialized = false;

    logger.info('Analytics Integration shut down');
  }
}

/**
 * Example usage in main BECAS initialization:
 *
 * import { AnalyticsIntegration } from './integrations/AnalyticsIntegration';
 *
 * // In main initialization
 * const analyticsIntegration = new AnalyticsIntegration(
 *   discordClient,
 *   db,
 *   ollamaService
 * );
 *
 * await analyticsIntegration.initialize();
 *
 * // Add API routes
 * app.use('/api/analytics', analyticsIntegration.getAPIRouter());
 *
 * // Health check
 * const health = await analyticsIntegration.healthCheck();
 * console.log('Analytics status:', health);
 *
 * // Integration with message pipeline
 * messageHandler.on('analyzed', async (result) => {
 *   await analyticsIntegration.handleMessageAnalysis(
 *     result.serverId,
 *     result.userId,
 *     result.message
 *   );
 * });
 *
 * // Analytics now runs automatically:
 * // - Hourly health snapshots
 * // - Hourly anomaly detection
 * // - Hourly conflict prediction
 * // - Every 2h topic analysis
 * // - Weekly/monthly reports
 * // - Real-time alerts
 */
