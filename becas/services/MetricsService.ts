import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { createLogger } from './Logger';

const logger = createLogger('MetricsService');

/**
 * PROMETHEUS METRICS SERVICE
 *
 * Tracks everything for:
 * 1. Real-time monitoring (Grafana dashboards)
 * 2. Future Discord Dashboard (server owner portal)
 * 3. Alerting and anomaly detection
 *
 * This is the foundation for TRUE observability.
 */

export class MetricsService {
  private static instance: MetricsService;
  private registry: Registry;

  // AI Performance Metrics
  public aiRequestDuration: Histogram<string>;
  public aiRequestTotal: Counter<string>;
  public aiCircuitBreakerState: Gauge<string>;
  public aiFallbackUsage: Counter<string>;

  // Moderation Metrics
  public moderationActionsTotal: Counter<string>;
  public scamDetectionTotal: Counter<string>;
  public toxicityDetectionTotal: Counter<string>;
  public autoModActionsTotal: Counter<string>;

  // User Sentiment Metrics (for your dashboard!)
  public userSentimentGauge: Gauge<string>;
  public messagesSentTotal: Counter<string>;
  public activeUsersGauge: Gauge<string>;

  // Server Health Metrics
  public discordEventsTotal: Counter<string>;
  public errorTotal: Counter<string>;
  public uptimeGauge: Gauge<string>;

  private constructor() {
    this.registry = new Registry();

    // Collect default metrics (CPU, memory, etc.)
    collectDefaultMetrics({ register: this.registry });

    // ========== AI Performance Metrics ==========
    this.aiRequestDuration = new Histogram({
      name: 'becas_ai_request_duration_seconds',
      help: 'AI request duration in seconds',
      labelNames: ['model', 'system', 'success'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30], // Response time buckets
      registers: [this.registry],
    });

    this.aiRequestTotal = new Counter({
      name: 'becas_ai_requests_total',
      help: 'Total AI requests',
      labelNames: ['model', 'system', 'result'],
      registers: [this.registry],
    });

    this.aiCircuitBreakerState = new Gauge({
      name: 'becas_ai_circuit_breaker_state',
      help: 'Circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)',
      labelNames: ['service'],
      registers: [this.registry],
    });

    this.aiFallbackUsage = new Counter({
      name: 'becas_ai_fallback_usage_total',
      help: 'Number of times fallback was used',
      labelNames: ['service', 'reason'],
      registers: [this.registry],
    });

    // ========== Moderation Metrics ==========
    this.moderationActionsTotal = new Counter({
      name: 'becas_moderation_actions_total',
      help: 'Total moderation actions taken',
      labelNames: ['guild_id', 'action_type', 'triggered_by'],
      registers: [this.registry],
    });

    this.scamDetectionTotal = new Counter({
      name: 'becas_scam_detection_total',
      help: 'Total scam detections',
      labelNames: ['guild_id', 'scam_type', 'action_taken'],
      registers: [this.registry],
    });

    this.toxicityDetectionTotal = new Counter({
      name: 'becas_toxicity_detection_total',
      help: 'Total toxicity detections',
      labelNames: ['guild_id', 'severity', 'action_taken'],
      registers: [this.registry],
    });

    this.autoModActionsTotal = new Counter({
      name: 'becas_auto_mod_actions_total',
      help: 'Total autonomous moderation actions',
      labelNames: ['guild_id', 'reason', 'action'],
      registers: [this.registry],
    });

    // ========== User Sentiment Metrics (for Dashboard!) ==========
    this.userSentimentGauge = new Gauge({
      name: 'becas_user_sentiment',
      help: 'Average user sentiment score (-1 to 1)',
      labelNames: ['guild_id', 'sentiment_type'],
      registers: [this.registry],
    });

    this.messagesSentTotal = new Counter({
      name: 'becas_messages_sent_total',
      help: 'Total messages sent in server',
      labelNames: ['guild_id', 'channel_type'],
      registers: [this.registry],
    });

    this.activeUsersGauge = new Gauge({
      name: 'becas_active_users',
      help: 'Number of active users in last hour',
      labelNames: ['guild_id'],
      registers: [this.registry],
    });

    // ========== Server Health Metrics ==========
    this.discordEventsTotal = new Counter({
      name: 'becas_discord_events_total',
      help: 'Total Discord events received',
      labelNames: ['event_type'],
      registers: [this.registry],
    });

    this.errorTotal = new Counter({
      name: 'becas_errors_total',
      help: 'Total errors encountered',
      labelNames: ['error_type', 'severity'],
      registers: [this.registry],
    });

    this.uptimeGauge = new Gauge({
      name: 'becas_uptime_seconds',
      help: 'Bot uptime in seconds',
      registers: [this.registry],
    });

    // Update uptime every minute
    const startTime = Date.now();
    setInterval(() => {
      this.uptimeGauge.set((Date.now() - startTime) / 1000);
    }, 60000);

    logger.info('Metrics service initialized with Prometheus registry');
  }

  /**
   * Get singleton instance
   */
  static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return await this.registry.metrics();
  }

  /**
   * Get metrics as JSON (for dashboard API)
   */
  async getMetricsJSON(): Promise<any> {
    const metrics = await this.registry.getMetricsAsJSON();
    return metrics;
  }

  /**
   * Record AI request
   */
  recordAIRequest(model: string, system: string, durationMs: number, success: boolean): void {
    this.aiRequestDuration.observe(
      { model, system, success: success.toString() },
      durationMs / 1000
    );

    this.aiRequestTotal.inc({
      model,
      system,
      result: success ? 'success' : 'failure',
    });
  }

  /**
   * Update circuit breaker state
   */
  updateCircuitBreakerState(service: string, state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'): void {
    const stateValue = state === 'CLOSED' ? 0 : state === 'OPEN' ? 1 : 2;
    this.aiCircuitBreakerState.set({ service }, stateValue);
  }

  /**
   * Record fallback usage
   */
  recordFallback(service: string, reason: string): void {
    this.aiFallbackUsage.inc({ service, reason });
  }

  /**
   * Record moderation action
   */
  recordModerationAction(
    guildId: string,
    actionType: 'timeout' | 'ban' | 'kick' | 'warn' | 'delete',
    triggeredBy: 'auto' | 'manual' | 'ai_prediction'
  ): void {
    this.moderationActionsTotal.inc({ guild_id: guildId, action_type: actionType, triggered_by: triggeredBy });
  }

  /**
   * Record scam detection
   */
  recordScamDetection(
    guildId: string,
    scamType: string,
    actionTaken: 'banned' | 'warned' | 'deleted' | 'none'
  ): void {
    this.scamDetectionTotal.inc({ guild_id: guildId, scam_type: scamType, action_taken: actionTaken });
  }

  /**
   * Record toxicity detection
   */
  recordToxicityDetection(
    guildId: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    actionTaken: string
  ): void {
    this.toxicityDetectionTotal.inc({ guild_id: guildId, severity, action_taken: actionTaken });
  }

  /**
   * Update user sentiment (for your dashboard!)
   */
  updateUserSentiment(
    guildId: string,
    sentimentType: 'positive' | 'negative' | 'neutral',
    score: number
  ): void {
    this.userSentimentGauge.set({ guild_id: guildId, sentiment_type: sentimentType }, score);
  }

  /**
   * Record message sent
   */
  recordMessageSent(guildId: string, channelType: 'text' | 'voice' | 'dm'): void {
    this.messagesSentTotal.inc({ guild_id: guildId, channel_type: channelType });
  }

  /**
   * Update active users count
   */
  updateActiveUsers(guildId: string, count: number): void {
    this.activeUsersGauge.set({ guild_id: guildId }, count);
  }

  /**
   * Record Discord event
   */
  recordDiscordEvent(eventType: string): void {
    this.discordEventsTotal.inc({ event_type: eventType });
  }

  /**
   * Record error
   */
  recordError(errorType: string, severity: 'low' | 'medium' | 'high' | 'critical'): void {
    this.errorTotal.inc({ error_type: errorType, severity });
  }

  /**
   * Get registry (for admin server integration)
   */
  getRegistry(): Registry {
    return this.registry;
  }
}

// Export singleton instance
export const metricsService = MetricsService.getInstance();
