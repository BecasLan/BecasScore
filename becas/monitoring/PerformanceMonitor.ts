import { Pool } from 'pg';
import { performance } from 'perf_hooks';
import logger from '../utils/logger';

/**
 * PerformanceMonitor
 *
 * Real-time performance monitoring and alerting system.
 * Tracks latencies, throughput, and resource usage.
 *
 * Features:
 * - Component-level latency tracking
 * - Automatic degradation detection
 * - Performance alerts
 * - Metrics aggregation
 * - Historical trend analysis
 */

export interface PerformanceMetric {
  name: string;
  type: 'latency' | 'throughput' | 'error_rate' | 'memory' | 'cpu';
  value: number;
  serverId?: string;
  component?: string;
  metadata?: Record<string, any>;
}

export interface PerformanceAlert {
  component: string;
  metric: string;
  currentValue: number;
  baselineValue: number;
  degradationPct: number;
  severity: 'warning' | 'critical';
  timestamp: Date;
}

export class PerformanceMonitor {
  private activeMeasurements: Map<string, number> = new Map();
  private metricBuffer: PerformanceMetric[] = [];
  private flushInterval?: NodeJS.Timeout;

  private readonly BUFFER_SIZE = 100;
  private readonly FLUSH_INTERVAL_MS = 10000; // 10 seconds
  private readonly DEGRADATION_THRESHOLD = 0.5; // 50%
  private readonly CRITICAL_THRESHOLD = 1.0; // 100%

  constructor(private db: Pool) {}

  /**
   * Start monitoring
   */
  start(): void {
    this.flushInterval = setInterval(() => {
      this.flushMetrics();
    }, this.FLUSH_INTERVAL_MS);

    logger.info('✓ Performance Monitor started');
  }

  /**
   * Start measuring operation
   */
  startMeasure(measurementId: string): void {
    this.activeMeasurements.set(measurementId, performance.now());
  }

  /**
   * End measurement and record
   */
  endMeasure(
    measurementId: string,
    metricName: string,
    component?: string,
    serverId?: string,
    metadata?: Record<string, any>
  ): number {
    const start = this.activeMeasurements.get(measurementId);

    if (!start) {
      logger.warn(`No active measurement found for ID: ${measurementId}`);
      return 0;
    }

    const latency = performance.now() - start;
    this.activeMeasurements.delete(measurementId);

    // Record metric
    this.recordMetric({
      name: metricName,
      type: 'latency',
      value: latency,
      component,
      serverId,
      metadata
    });

    return latency;
  }

  /**
   * Record performance metric
   */
  recordMetric(metric: PerformanceMetric): void {
    this.metricBuffer.push(metric);

    // Flush if buffer is full
    if (this.metricBuffer.length >= this.BUFFER_SIZE) {
      this.flushMetrics();
    }
  }

  /**
   * Flush metrics to database
   */
  private async flushMetrics(): Promise<void> {
    if (this.metricBuffer.length === 0) return;

    const metrics = [...this.metricBuffer];
    this.metricBuffer = [];

    try {
      const query = `
        INSERT INTO performance_metrics
        (metric_name, metric_type, metric_value, server_id, component, metadata)
        VALUES ($1, $2, $3, $4, $5, $6)
      `;

      for (const metric of metrics) {
        await this.db.query(query, [
          metric.name,
          metric.type,
          metric.value,
          metric.serverId,
          metric.component,
          JSON.stringify(metric.metadata || {})
        ]);
      }

      logger.debug(`Flushed ${metrics.length} performance metrics`);
    } catch (error) {
      logger.error('Error flushing performance metrics:', error);
    }
  }

  /**
   * Get average latency for component
   */
  async getAverageLatency(
    component: string,
    hours: number = 1
  ): Promise<number> {
    try {
      const query = `
        SELECT AVG(metric_value) as avg_latency
        FROM performance_metrics
        WHERE component = $1
        AND metric_type = 'latency'
        AND recorded_at >= NOW() - ($2 || ' hours')::INTERVAL
      `;

      const result = await this.db.query(query, [component, hours]);

      if (result.rows.length === 0) {
        return 0;
      }

      return parseFloat(result.rows[0].avg_latency) || 0;
    } catch (error) {
      logger.error('Error getting average latency:', error);
      return 0;
    }
  }

  /**
   * Get performance degradation alerts
   */
  async getDegradationAlerts(hours: number = 1): Promise<PerformanceAlert[]> {
    try {
      const query = `
        SELECT * FROM get_performance_alerts($1)
      `;

      const result = await this.db.query(query, [hours]);

      return result.rows.map(row => ({
        component: row.component,
        metric: row.metric_name,
        currentValue: parseFloat(row.current_avg),
        baselineValue: parseFloat(row.baseline_avg),
        degradationPct: parseFloat(row.degradation_pct),
        severity: parseFloat(row.degradation_pct) >= this.CRITICAL_THRESHOLD * 100
          ? 'critical'
          : 'warning',
        timestamp: new Date()
      }));
    } catch (error) {
      logger.error('Error getting degradation alerts:', error);
      return [];
    }
  }

  /**
   * Check for performance degradation and send alerts
   */
  async checkDegradation(): Promise<void> {
    const alerts = await this.getDegradationAlerts(1);

    if (alerts.length === 0) return;

    logger.warn(`⚠️  Performance degradation detected in ${alerts.length} components`);

    for (const alert of alerts) {
      const emoji = alert.severity === 'critical' ? '🔴' : '⚠️';
      logger.warn(
        `${emoji} ${alert.component} - ${alert.metric}: ` +
        `${alert.currentValue.toFixed(2)}ms (baseline: ${alert.baselineValue.toFixed(2)}ms, ` +
        `+${alert.degradationPct.toFixed(1)}%)`
      );

      // TODO: Send alert via Discord/Email/Slack
    }
  }

  /**
   * Get component statistics
   */
  async getComponentStats(
    component: string,
    hours: number = 24
  ): Promise<{
    avgLatency: number;
    minLatency: number;
    maxLatency: number;
    p50: number;
    p95: number;
    p99: number;
    count: number;
  }> {
    try {
      const query = `
        SELECT
          AVG(metric_value) as avg_latency,
          MIN(metric_value) as min_latency,
          MAX(metric_value) as max_latency,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY metric_value) as p50,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY metric_value) as p95,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY metric_value) as p99,
          COUNT(*) as count
        FROM performance_metrics
        WHERE component = $1
        AND metric_type = 'latency'
        AND recorded_at >= NOW() - ($2 || ' hours')::INTERVAL
      `;

      const result = await this.db.query(query, [component, hours]);

      if (result.rows.length === 0) {
        return {
          avgLatency: 0,
          minLatency: 0,
          maxLatency: 0,
          p50: 0,
          p95: 0,
          p99: 0,
          count: 0
        };
      }

      const row = result.rows[0];

      return {
        avgLatency: parseFloat(row.avg_latency) || 0,
        minLatency: parseFloat(row.min_latency) || 0,
        maxLatency: parseFloat(row.max_latency) || 0,
        p50: parseFloat(row.p50) || 0,
        p95: parseFloat(row.p95) || 0,
        p99: parseFloat(row.p99) || 0,
        count: parseInt(row.count) || 0
      };
    } catch (error) {
      logger.error('Error getting component stats:', error);
      return {
        avgLatency: 0,
        minLatency: 0,
        maxLatency: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        count: 0
      };
    }
  }

  /**
   * Get all component statistics
   */
  async getAllComponentStats(hours: number = 24): Promise<Record<string, any>> {
    try {
      const query = `
        SELECT DISTINCT component
        FROM performance_metrics
        WHERE component IS NOT NULL
        AND recorded_at >= NOW() - ($1 || ' hours')::INTERVAL
      `;

      const result = await this.db.query(query, [hours]);

      const stats: Record<string, any> = {};

      for (const row of result.rows) {
        const component = row.component;
        stats[component] = await this.getComponentStats(component, hours);
      }

      return stats;
    } catch (error) {
      logger.error('Error getting all component stats:', error);
      return {};
    }
  }

  /**
   * Get system memory usage
   */
  getMemoryUsage(): {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  } {
    const mem = process.memoryUsage();

    return {
      rss: Math.round(mem.rss / 1024 / 1024), // MB
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      external: Math.round(mem.external / 1024 / 1024)
    };
  }

  /**
   * Record memory usage
   */
  recordMemoryUsage(serverId?: string): void {
    const mem = this.getMemoryUsage();

    this.recordMetric({
      name: 'memory_usage',
      type: 'memory',
      value: mem.heapUsed,
      serverId,
      component: 'system',
      metadata: mem
    });
  }

  /**
   * Automatic performance monitoring
   */
  startAutoMonitoring(intervalSeconds: number = 60): void {
    setInterval(() => {
      // Record memory usage
      this.recordMemoryUsage();

      // Check for degradation
      this.checkDegradation();
    }, intervalSeconds * 1000);

    logger.info(`Started auto-monitoring (interval: ${intervalSeconds}s)`);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    // Flush remaining metrics
    this.flushMetrics();

    logger.info('Performance Monitor stopped');
  }
}

/**
 * Usage example:
 *
 * const monitor = new PerformanceMonitor(db);
 * monitor.start();
 * monitor.startAutoMonitoring(60); // Every 60 seconds
 *
 * // Measure operation
 * const id = 'msg_analyze_123';
 * monitor.startMeasure(id);
 * await analyzeMessage(message);
 * const latency = monitor.endMeasure(id, 'message_analysis', 'analysis', serverId);
 * console.log(`Analysis took ${latency.toFixed(2)}ms`);
 *
 * // Get stats
 * const stats = await monitor.getComponentStats('analysis', 24);
 * console.log(`P95 latency: ${stats.p95.toFixed(2)}ms`);
 *
 * // Check degradation
 * const alerts = await monitor.getDegradationAlerts(1);
 * if (alerts.length > 0) {
 *   console.log('Performance degradation detected!');
 * }
 */

export default PerformanceMonitor;
