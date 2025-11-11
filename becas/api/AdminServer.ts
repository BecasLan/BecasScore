import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { createLogger } from '../services/Logger';
import { GuildConfigManager } from '../config/GuildConfig';
import { OllamaConnectionPool } from '../services/OllamaConnectionPool';
import { metricsService } from '../services/MetricsService';
import { PortManager } from '../utils/PortManager';
import { Server } from 'http';

const logger = createLogger('AdminServer');

export interface AdminServerDependencies {
  configManager: GuildConfigManager;
  ollamaPool: OllamaConnectionPool;
  getMetrics: () => any;
  getTrustScores?: () => any;
  getRules?: () => any;
  analyticsManager?: any; // AnalyticsManager instance
}

export class AdminServer {
  private app: Express;
  private port: number;
  private dependencies: AdminServerDependencies;
  private httpServer?: Server;

  constructor(port: number, dependencies: AdminServerDependencies) {
    this.app = express();
    this.port = port;
    this.dependencies = dependencies;

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());

    // Request logging
    this.app.use((req, res, next) => {
      logger.http(`${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', this.handleHealthCheck.bind(this));

    // Metrics
    this.app.get('/metrics', this.handleMetrics.bind(this));
    this.app.get('/metrics/ollama', this.handleOllamaMetrics.bind(this));

    // Guild configuration
    this.app.get('/config/guilds', this.handleGetAllConfigs.bind(this));
    this.app.get('/config/guild/:guildId', this.handleGetConfig.bind(this));
    this.app.put('/config/guild/:guildId', this.handleUpdateConfig.bind(this));
    this.app.post('/config/guild/:guildId/reset', this.handleResetConfig.bind(this));
    this.app.post('/config/guild/:guildId/feature/:feature', this.handleToggleFeature.bind(this));

    // Trust scores (if available)
    this.app.get('/trust', this.handleGetTrustScores.bind(this));

    // Rules (if available)
    this.app.get('/rules', this.handleGetRules.bind(this));

    // Circuit breaker control
    this.app.post('/circuit/open', this.handleOpenCircuit.bind(this));
    this.app.post('/circuit/close', this.handleCloseCircuit.bind(this));

    // Analytics endpoints (if available)
    this.app.get('/analytics/dashboard/:guildId', this.handleGetDashboard.bind(this));
    this.app.get('/analytics/relationships/:guildId', this.handleGetRelationships.bind(this));
    this.app.get('/analytics/events/:guildId', this.handleGetEvents.bind(this));
    this.app.get('/analytics/timeline/:guildId', this.handleGetTimeline.bind(this));

    // Static dashboard
    this.app.use(express.static('public'));
  }

  /**
   * Health check endpoint
   */
  private async handleHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      const ollamaHealthy = await this.dependencies.ollamaPool.healthCheck();

      res.json({
        status: ollamaHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        services: {
          ollama: ollamaHealthy ? 'up' : 'down',
          discord: 'up', // Assume up if we're responding
          database: 'up', // JSON storage always "up"
        },
      });
    } catch (error) {
      logger.error('Health check failed', error);
      res.status(503).json({
        status: 'unhealthy',
        error: 'Health check failed',
      });
    }
  }

  /**
   * Get overall metrics (Prometheus format)
   */
  private async handleMetrics(req: Request, res: Response): Promise<void> {
    try {
      // Return Prometheus metrics format
      const metrics = await metricsService.getMetrics();
      res.set('Content-Type', metricsService.getRegistry().contentType);
      res.send(metrics);
    } catch (error) {
      logger.error('Failed to get metrics', error);
      res.status(500).json({ error: 'Failed to retrieve metrics' });
    }
  }

  /**
   * Get Ollama connection pool metrics
   */
  private handleOllamaMetrics(req: Request, res: Response): void {
    try {
      const metrics = this.dependencies.ollamaPool.getMetrics();
      res.json({
        timestamp: new Date().toISOString(),
        ollama: metrics,
      });
    } catch (error) {
      logger.error('Failed to get Ollama metrics', error);
      res.status(500).json({ error: 'Failed to retrieve Ollama metrics' });
    }
  }

  /**
   * Get all guild configurations
   */
  private handleGetAllConfigs(req: Request, res: Response): void {
    try {
      const configs = this.dependencies.configManager.getAllConfigs();
      res.json({ configs });
    } catch (error) {
      logger.error('Failed to get configs', error);
      res.status(500).json({ error: 'Failed to retrieve configurations' });
    }
  }

  /**
   * Get specific guild configuration
   */
  private handleGetConfig(req: Request, res: Response): void {
    try {
      const { guildId } = req.params;
      const config = this.dependencies.configManager.getConfig(guildId);
      res.json({ config });
    } catch (error) {
      logger.error('Failed to get config', error);
      res.status(500).json({ error: 'Failed to retrieve configuration' });
    }
  }

  /**
   * Update guild configuration
   */
  private handleUpdateConfig(req: Request, res: Response): void {
    try {
      const { guildId } = req.params;
      const updates = req.body;

      const config = this.dependencies.configManager.updateConfig(guildId, updates);
      res.json({ success: true, config });

      logger.info(`Configuration updated for guild ${guildId}`, { updates });
    } catch (error) {
      logger.error('Failed to update config', error);
      res.status(500).json({ error: 'Failed to update configuration' });
    }
  }

  /**
   * Reset guild to default configuration
   */
  private handleResetConfig(req: Request, res: Response): void {
    try {
      const { guildId } = req.params;
      const config = this.dependencies.configManager.resetToDefault(guildId);
      res.json({ success: true, config });

      logger.info(`Configuration reset to defaults for guild ${guildId}`);
    } catch (error) {
      logger.error('Failed to reset config', error);
      res.status(500).json({ error: 'Failed to reset configuration' });
    }
  }

  /**
   * Toggle feature for guild
   */
  private handleToggleFeature(req: Request, res: Response): void {
    try {
      const { guildId, feature } = req.params;
      const { enabled } = req.body;

      this.dependencies.configManager.toggleFeature(guildId, feature as any, enabled);
      const config = this.dependencies.configManager.getConfig(guildId);

      res.json({ success: true, config });

      logger.info(`Feature ${feature} ${enabled ? 'enabled' : 'disabled'} for guild ${guildId}`);
    } catch (error) {
      logger.error('Failed to toggle feature', error);
      res.status(500).json({ error: 'Failed to toggle feature' });
    }
  }

  /**
   * Get trust scores
   */
  private handleGetTrustScores(req: Request, res: Response): void {
    try {
      if (!this.dependencies.getTrustScores) {
        res.status(404).json({ error: 'Trust scores not available' });
        return;
      }

      const scores = this.dependencies.getTrustScores();
      res.json({ scores });
    } catch (error) {
      logger.error('Failed to get trust scores', error);
      res.status(500).json({ error: 'Failed to retrieve trust scores' });
    }
  }

  /**
   * Get rules
   */
  private handleGetRules(req: Request, res: Response): void {
    try {
      if (!this.dependencies.getRules) {
        res.status(404).json({ error: 'Rules not available' });
        return;
      }

      const rules = this.dependencies.getRules();
      res.json({ rules });
    } catch (error) {
      logger.error('Failed to get rules', error);
      res.status(500).json({ error: 'Failed to retrieve rules' });
    }
  }

  /**
   * Open circuit breaker
   */
  private handleOpenCircuit(req: Request, res: Response): void {
    try {
      this.dependencies.ollamaPool.openCircuit();
      res.json({ success: true, message: 'Circuit breaker opened' });

      logger.warn('Circuit breaker manually opened via API');
    } catch (error) {
      logger.error('Failed to open circuit', error);
      res.status(500).json({ error: 'Failed to open circuit breaker' });
    }
  }

  /**
   * Close circuit breaker
   */
  private handleCloseCircuit(req: Request, res: Response): void {
    try {
      this.dependencies.ollamaPool.closeCircuit();
      res.json({ success: true, message: 'Circuit breaker closed' });

      logger.info('Circuit breaker manually closed via API');
    } catch (error) {
      logger.error('Failed to close circuit', error);
      res.status(500).json({ error: 'Failed to close circuit breaker' });
    }
  }

  /**
   * Get full dashboard data for a guild
   */
  private async handleGetDashboard(req: Request, res: Response): Promise<void> {
    try {
      if (!this.dependencies.analyticsManager) {
        res.status(404).json({ error: 'Analytics not available' });
        return;
      }

      const { guildId } = req.params;
      const data = await this.dependencies.analyticsManager.getDashboardData(guildId);

      res.json({
        success: true,
        guildId,
        timestamp: Date.now(),
        data,
      });
    } catch (error) {
      logger.error('Failed to get dashboard data', error);
      res.status(500).json({ error: 'Failed to retrieve dashboard data' });
    }
  }

  /**
   * Get relationship graph data for a guild
   */
  private handleGetRelationships(req: Request, res: Response): void {
    try {
      if (!this.dependencies.analyticsManager) {
        res.status(404).json({ error: 'Analytics not available' });
        return;
      }

      const { guildId } = req.params;
      const graphData = this.dependencies.analyticsManager.getRelationshipGraphData(guildId);

      res.json({
        success: true,
        guildId,
        timestamp: Date.now(),
        graphData,
      });
    } catch (error) {
      logger.error('Failed to get relationships', error);
      res.status(500).json({ error: 'Failed to retrieve relationships' });
    }
  }

  /**
   * Get events for a guild
   */
  private async handleGetEvents(req: Request, res: Response): Promise<void> {
    try {
      if (!this.dependencies.analyticsManager) {
        res.status(404).json({ error: 'Analytics not available' });
        return;
      }

      const { guildId } = req.params;
      const { type, limit, startTime, endTime } = req.query;

      const events = await this.dependencies.analyticsManager.events.getEvents(guildId, {
        type: type as any,
        limit: limit ? parseInt(limit as string) : 100,
        startTime: startTime ? parseInt(startTime as string) : undefined,
        endTime: endTime ? parseInt(endTime as string) : undefined,
      });

      res.json({
        success: true,
        guildId,
        timestamp: Date.now(),
        count: events.length,
        events,
      });
    } catch (error) {
      logger.error('Failed to get events', error);
      res.status(500).json({ error: 'Failed to retrieve events' });
    }
  }

  /**
   * Get timeline data for a guild
   */
  private async handleGetTimeline(req: Request, res: Response): Promise<void> {
    try {
      if (!this.dependencies.analyticsManager) {
        res.status(404).json({ error: 'Analytics not available' });
        return;
      }

      const { guildId } = req.params;
      const { hours } = req.query;

      const timeline = await this.dependencies.analyticsManager.events.getTimeline(
        guildId,
        hours ? parseInt(hours as string) : 24
      );

      res.json({
        success: true,
        guildId,
        timestamp: Date.now(),
        timeline,
      });
    } catch (error) {
      logger.error('Failed to get timeline', error);
      res.status(500).json({ error: 'Failed to retrieve timeline' });
    }
  }

  /**
   * Start server with port conflict resolution
   */
  async start(): Promise<number> {
    const actualPort = await PortManager.startServerSafely(
      'AdminServer',
      this.port,
      (port) => {
        return new Promise<void>((resolve) => {
          this.httpServer = this.app.listen(port, () => {
            this.port = port; // Update port in case it changed
            logger.info(`Admin server started on port ${port}`);
            logger.info(`Health check: http://localhost:${port}/health`);
            logger.info(`Metrics: http://localhost:${port}/metrics`);
            logger.info(`Dashboard: http://localhost:${port}/`);
            resolve();
          });
        });
      }
    );

    // Setup graceful shutdown
    if (this.httpServer) {
      PortManager.setupGracefulShutdown('AdminServer', this.httpServer);
    }

    return actualPort;
  }

  /**
   * Stop server gracefully
   */
  async stop(): Promise<void> {
    if (this.httpServer) {
      return new Promise((resolve, reject) => {
        this.httpServer!.close((err) => {
          if (err) {
            logger.error('Error stopping AdminServer', err);
            reject(err);
          } else {
            logger.info('AdminServer stopped gracefully');
            resolve();
          }
        });
      });
    }
  }
}
