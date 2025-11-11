import { Pool } from 'pg';
import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import * as cron from 'node-cron';
import logger from '../utils/logger';

/**
 * ReportGenerator
 *
 * Generates AI-powered analytics reports (weekly, monthly, custom).
 * Uses server health data, anomalies, conflicts, and trends to create
 * comprehensive summaries with insights and recommendations.
 *
 * Report Types:
 * 1. Weekly Summary - Every Monday at 9 AM
 * 2. Monthly Summary - First day of month at 9 AM
 * 3. Custom Reports - On-demand for specific periods
 * 4. Incident Reports - After major events
 */

export interface ReportData {
  serverId: string;
  reportType: 'weekly' | 'monthly' | 'custom' | 'incident';
  periodStart: Date;
  periodEnd: Date;

  // Summary stats
  totalMessages: number;
  totalActiveUsers: number;
  avgHealthScore: number;
  healthTrend: 'improving' | 'stable' | 'declining';

  // Anomalies
  anomaliesCount: number;
  criticalAnomalies: number;
  topAnomalyTypes: Array<{ type: string; count: number }>;

  // Conflicts
  conflictsCount: number;
  conflictsAvoided: number;
  topConflictUsers: Array<{ userId: string; conflictCount: number }>;

  // Moderation
  totalModerationActions: number;
  warningsCount: number;
  timeoutsCount: number;
  kicksCount: number;
  bansCount: number;

  // Engagement
  avgMessagesPerDay: number;
  peakActivityHour: number;
  avgToxicityRate: number;
  avgSentiment: number;

  // Trends
  topTopics: string[];
  risingTopics: string[];
  decliningTopics: string[];
}

export interface GeneratedReport {
  id?: number;
  data: ReportData;
  title: string;
  summary: string;
  insights: string[];
  recommendations: string[];
  generatedAt: Date;
  generationTimeMs: number;
}

export class ReportGenerator {
  private weeklyCron?: cron.ScheduledTask;
  private monthlyCron?: cron.ScheduledTask;
  private running = false;

  constructor(
    private db: Pool,
    private discordClient: Client,
    private ollamaService: any // Ollama service for AI analysis
  ) {}

  /**
   * Start scheduled report generation
   */
  start(): void {
    if (this.running) {
      logger.warn('ReportGenerator already running');
      return;
    }

    // Weekly reports - Every Monday at 9 AM
    this.weeklyCron = cron.schedule('0 9 * * 1', async () => {
      logger.info('Generating weekly reports...');
      await this.generateAllWeeklyReports();
    });

    // Monthly reports - First day of month at 9 AM
    this.monthlyCron = cron.schedule('0 9 1 * *', async () => {
      logger.info('Generating monthly reports...');
      await this.generateAllMonthlyReports();
    });

    this.running = true;
    logger.info('✓ ReportGenerator started (weekly + monthly)');
  }

  /**
   * Stop scheduled report generation
   */
  stop(): void {
    if (this.weeklyCron) this.weeklyCron.stop();
    if (this.monthlyCron) this.monthlyCron.stop();
    this.running = false;
    logger.info('ReportGenerator stopped');
  }

  /**
   * Generate weekly reports for all servers
   */
  async generateAllWeeklyReports(): Promise<void> {
    const serverIds = this.discordClient.guilds.cache.map(guild => guild.id);

    for (const serverId of serverIds) {
      try {
        const report = await this.generateWeeklyReport(serverId);
        await this.sendReportToServer(serverId, report);
      } catch (error) {
        logger.error(`Error generating weekly report for ${serverId}:`, error);
      }
    }
  }

  /**
   * Generate monthly reports for all servers
   */
  async generateAllMonthlyReports(): Promise<void> {
    const serverIds = this.discordClient.guilds.cache.map(guild => guild.id);

    for (const serverId of serverIds) {
      try {
        const report = await this.generateMonthlyReport(serverId);
        await this.sendReportToServer(serverId, report);
      } catch (error) {
        logger.error(`Error generating monthly report for ${serverId}:`, error);
      }
    }
  }

  /**
   * Generate weekly report for a server
   */
  async generateWeeklyReport(serverId: string): Promise<GeneratedReport> {
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - 7);

    return await this.generateReport(serverId, 'weekly', periodStart, periodEnd);
  }

  /**
   * Generate monthly report for a server
   */
  async generateMonthlyReport(serverId: string): Promise<GeneratedReport> {
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setMonth(periodStart.getMonth() - 1);

    return await this.generateReport(serverId, 'monthly', periodStart, periodEnd);
  }

  /**
   * Generate custom report for specific period
   */
  async generateCustomReport(
    serverId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<GeneratedReport> {
    return await this.generateReport(serverId, 'custom', periodStart, periodEnd);
  }

  /**
   * Generate report (core logic)
   */
  private async generateReport(
    serverId: string,
    reportType: 'weekly' | 'monthly' | 'custom' | 'incident',
    periodStart: Date,
    periodEnd: Date
  ): Promise<GeneratedReport> {
    const startTime = Date.now();

    try {
      logger.info(`Generating ${reportType} report for ${serverId}...`);

      // 1. Collect report data
      const data = await this.collectReportData(serverId, reportType, periodStart, periodEnd);

      // 2. Generate AI insights and recommendations
      const { insights, recommendations } = await this.generateAIAnalysis(data);

      // 3. Generate title and summary
      const title = this.generateTitle(data);
      const summary = this.generateSummary(data);

      const report: GeneratedReport = {
        data,
        title,
        summary,
        insights,
        recommendations,
        generatedAt: new Date(),
        generationTimeMs: Date.now() - startTime
      };

      // 4. Store report in database
      await this.storeReport(report);

      logger.info(`✓ Report generated in ${report.generationTimeMs}ms`);
      return report;

    } catch (error) {
      logger.error('Error generating report:', error);
      throw error;
    }
  }

  /**
   * Collect all data for report
   */
  private async collectReportData(
    serverId: string,
    reportType: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<ReportData> {
    const days = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));

    // Use the database function to get analytics summary
    const summaryQuery = `
      SELECT * FROM get_server_analytics_summary($1, $2)
    `;

    const summaryResult = await this.db.query(summaryQuery, [serverId, days]);
    const summary = summaryResult.rows[0] || {};

    // Get anomaly breakdown
    const anomaliesQuery = `
      SELECT
        type,
        COUNT(*) as count,
        SUM(CASE WHEN severity = 'critical' OR severity = 'high' THEN 1 ELSE 0 END) as critical_count
      FROM anomaly_detections
      WHERE server_id = $1
      AND detected_at >= $2
      AND detected_at <= $3
      GROUP BY type
      ORDER BY count DESC
      LIMIT 5
    `;

    const anomaliesResult = await this.db.query(anomaliesQuery, [serverId, periodStart, periodEnd]);

    // Get conflict data
    const conflictsQuery = `
      SELECT
        COUNT(*) as total_conflicts,
        SUM(CASE WHEN occurred = false THEN 1 ELSE 0 END) as avoided_count
      FROM conflict_predictions
      WHERE server_id = $1
      AND predicted_at >= $2
      AND predicted_at <= $3
      AND occurred IS NOT NULL
    `;

    const conflictsResult = await this.db.query(conflictsQuery, [serverId, periodStart, periodEnd]);
    const conflicts = conflictsResult.rows[0] || {};

    // Get top conflict users
    const topConflictUsersQuery = `
      SELECT
        user_a as user_id,
        COUNT(*) as conflict_count
      FROM conflict_predictions
      WHERE server_id = $1
      AND predicted_at >= $2
      AND predicted_at <= $3
      GROUP BY user_a
      ORDER BY conflict_count DESC
      LIMIT 3
    `;

    const topUsersResult = await this.db.query(topConflictUsersQuery, [serverId, periodStart, periodEnd]);

    // Get peak activity hour
    const peakHourQuery = `
      SELECT
        EXTRACT(HOUR FROM snapshot_time) as hour,
        AVG(messages_count) as avg_messages
      FROM server_health_snapshots
      WHERE server_id = $1
      AND snapshot_time >= $2
      AND snapshot_time <= $3
      GROUP BY EXTRACT(HOUR FROM snapshot_time)
      ORDER BY avg_messages DESC
      LIMIT 1
    `;

    const peakHourResult = await this.db.query(peakHourQuery, [serverId, periodStart, periodEnd]);
    const peakHour = peakHourResult.rows[0] ? parseInt(peakHourResult.rows[0].hour) : 12;

    // Get top topics
    const topicsQuery = `
      SELECT
        topic,
        SUM(mention_count) as total_mentions,
        trend_status
      FROM topic_trends
      WHERE server_id = $1
      AND last_mentioned_at >= $2
      AND last_mentioned_at <= $3
      GROUP BY topic, trend_status
      ORDER BY total_mentions DESC
      LIMIT 10
    `;

    const topicsResult = await this.db.query(topicsQuery, [serverId, periodStart, periodEnd]);
    const allTopics = topicsResult.rows;

    return {
      serverId,
      reportType: reportType as 'custom' | 'weekly' | 'monthly' | 'incident',
      periodStart,
      periodEnd,

      totalMessages: parseInt(summary.total_messages) || 0,
      totalActiveUsers: parseInt(summary.total_active_users) || 0,
      avgHealthScore: parseInt(summary.avg_health_score) || 100,
      healthTrend: summary.health_trend || 'stable',

      anomaliesCount: parseInt(summary.anomalies_count) || 0,
      criticalAnomalies: anomaliesResult.rows.reduce((sum, row) => sum + parseInt(row.critical_count), 0),
      topAnomalyTypes: anomaliesResult.rows.map(row => ({
        type: row.type,
        count: parseInt(row.count)
      })),

      conflictsCount: parseInt(conflicts.total_conflicts) || 0,
      conflictsAvoided: parseInt(conflicts.avoided_count) || 0,
      topConflictUsers: topUsersResult.rows.map(row => ({
        userId: row.user_id,
        conflictCount: parseInt(row.conflict_count)
      })),

      totalModerationActions: parseInt(summary.total_moderation_actions) || 0,
      warningsCount: 0, // Would need breakdown
      timeoutsCount: 0,
      kicksCount: 0,
      bansCount: 0,

      avgMessagesPerDay: (parseInt(summary.total_messages) || 0) / days,
      peakActivityHour: peakHour,
      avgToxicityRate: parseFloat(summary.avg_toxicity_rate) || 0,
      avgSentiment: parseFloat(summary.avg_sentiment) || 0,

      topTopics: allTopics.slice(0, 5).map(t => t.topic),
      risingTopics: allTopics.filter(t => t.trend_status === 'rising').slice(0, 3).map(t => t.topic),
      decliningTopics: allTopics.filter(t => t.trend_status === 'declining').slice(0, 3).map(t => t.topic)
    };
  }

  /**
   * Generate AI insights and recommendations
   */
  private async generateAIAnalysis(data: ReportData): Promise<{
    insights: string[];
    recommendations: string[];
  }> {
    try {
      // Build context for AI analysis
      const context = `
Server Analytics Report
Period: ${data.periodStart.toLocaleDateString()} to ${data.periodEnd.toLocaleDateString()}

Key Metrics:
- Total Messages: ${data.totalMessages}
- Active Users: ${data.totalActiveUsers}
- Health Score: ${data.avgHealthScore}/100 (${data.healthTrend})
- Toxicity Rate: ${(data.avgToxicityRate * 100).toFixed(2)}%
- Sentiment: ${data.avgSentiment.toFixed(2)} (-1 to 1)

Issues:
- Anomalies Detected: ${data.anomaliesCount} (${data.criticalAnomalies} critical)
- Conflicts: ${data.conflictsCount} (${data.conflictsAvoided} avoided)
- Moderation Actions: ${data.totalModerationActions}

Top Anomaly Types: ${data.topAnomalyTypes.map(a => `${a.type} (${a.count})`).join(', ')}
Trending Topics: ${data.topTopics.join(', ')}

Analyze this data and provide:
1. 3-5 key insights about server health and trends
2. 3-5 actionable recommendations for moderators

Format:
INSIGHTS:
- [insight 1]
- [insight 2]
...

RECOMMENDATIONS:
- [recommendation 1]
- [recommendation 2]
...
`;

      const response = await this.ollamaService.generate({
        model: 'qwen2.5:14b',
        prompt: context,
        stream: false
      });

      // Parse AI response
      const text = response.response || '';
      const insightsMatch = text.match(/INSIGHTS:([\s\S]*?)(?=RECOMMENDATIONS:|$)/);
      const recommendationsMatch = text.match(/RECOMMENDATIONS:([\s\S]*?)$/);

      const insights = insightsMatch
        ? insightsMatch[1]
            .split('\n')
            .filter(line => line.trim().startsWith('-'))
            .map(line => line.trim().replace(/^-\s*/, ''))
            .filter(line => line.length > 0)
        : this.generateFallbackInsights(data);

      const recommendations = recommendationsMatch
        ? recommendationsMatch[1]
            .split('\n')
            .filter(line => line.trim().startsWith('-'))
            .map(line => line.trim().replace(/^-\s*/, ''))
            .filter(line => line.length > 0)
        : this.generateFallbackRecommendations(data);

      return { insights, recommendations };

    } catch (error) {
      logger.error('Error generating AI analysis:', error);
      return {
        insights: this.generateFallbackInsights(data),
        recommendations: this.generateFallbackRecommendations(data)
      };
    }
  }

  /**
   * Generate fallback insights if AI fails
   */
  private generateFallbackInsights(data: ReportData): string[] {
    const insights: string[] = [];

    if (data.healthTrend === 'improving') {
      insights.push(`Server health is improving (${data.avgHealthScore}/100), indicating positive trends in community behavior.`);
    } else if (data.healthTrend === 'declining') {
      insights.push(`Server health is declining (${data.avgHealthScore}/100), requiring attention to moderation strategies.`);
    }

    if (data.avgToxicityRate > 0.15) {
      insights.push(`Toxicity rate is elevated at ${(data.avgToxicityRate * 100).toFixed(1)}%, above the healthy threshold of 15%.`);
    } else {
      insights.push(`Toxicity rate is healthy at ${(data.avgToxicityRate * 100).toFixed(1)}%, indicating good community culture.`);
    }

    if (data.anomaliesCount > 10) {
      insights.push(`${data.anomaliesCount} anomalies detected this period, with ${data.criticalAnomalies} being critical. Top type: ${data.topAnomalyTypes[0]?.type || 'none'}.`);
    }

    if (data.conflictsAvoided > 0) {
      insights.push(`Successfully avoided ${data.conflictsAvoided} of ${data.conflictsCount} predicted conflicts through proactive intervention.`);
    }

    if (data.avgMessagesPerDay > 100) {
      insights.push(`High engagement with ${data.avgMessagesPerDay.toFixed(0)} messages per day across ${data.totalActiveUsers} active users.`);
    }

    return insights.slice(0, 5);
  }

  /**
   * Generate fallback recommendations if AI fails
   */
  private generateFallbackRecommendations(data: ReportData): string[] {
    const recommendations: string[] = [];

    if (data.avgToxicityRate > 0.2) {
      recommendations.push('Increase moderation presence during peak hours to address elevated toxicity.');
    }

    if (data.anomaliesCount > 20) {
      recommendations.push('Review anomaly detection thresholds and investigate recurring patterns.');
    }

    if (data.conflictsCount > 5) {
      recommendations.push('Consider implementing conflict de-escalation protocols for high-risk user pairs.');
    }

    if (data.healthTrend === 'declining') {
      recommendations.push('Schedule team meeting to review moderation strategies and community engagement.');
    }

    if (data.topConflictUsers.length > 0) {
      recommendations.push(`Monitor or counsel users involved in multiple conflicts: ${data.topConflictUsers.length} users identified.`);
    }

    return recommendations.slice(0, 5);
  }

  /**
   * Generate report title
   */
  private generateTitle(data: ReportData): string {
    const dateRange = `${data.periodStart.toLocaleDateString()} - ${data.periodEnd.toLocaleDateString()}`;

    switch (data.reportType) {
      case 'weekly':
        return `📊 Weekly Server Report (${dateRange})`;
      case 'monthly':
        return `📊 Monthly Server Report (${dateRange})`;
      case 'incident':
        return `⚠️ Incident Report (${dateRange})`;
      default:
        return `📊 Server Analytics Report (${dateRange})`;
    }
  }

  /**
   * Generate report summary
   */
  private generateSummary(data: ReportData): string {
    let summary = `**Overall Health: ${data.avgHealthScore}/100** (${data.healthTrend})\n\n`;
    summary += `📈 **Activity:** ${data.totalMessages} messages from ${data.totalActiveUsers} users (${data.avgMessagesPerDay.toFixed(0)}/day)\n`;
    summary += `😊 **Sentiment:** ${data.avgSentiment >= 0 ? 'Positive' : 'Negative'} (${data.avgSentiment.toFixed(2)})\n`;
    summary += `🛡️ **Toxicity:** ${(data.avgToxicityRate * 100).toFixed(1)}%\n`;
    summary += `⚖️ **Moderation:** ${data.totalModerationActions} actions taken\n`;

    if (data.anomaliesCount > 0) {
      summary += `⚠️ **Anomalies:** ${data.anomaliesCount} detected (${data.criticalAnomalies} critical)\n`;
    }

    if (data.conflictsCount > 0) {
      summary += `🤝 **Conflicts:** ${data.conflictsCount} predicted, ${data.conflictsAvoided} avoided\n`;
    }

    return summary;
  }

  /**
   * Store report in database
   */
  private async storeReport(report: GeneratedReport): Promise<number> {
    const query = `
      INSERT INTO analytics_reports
      (server_id, report_type, report_period_start, report_period_end,
       title, summary, key_metrics, insights, recommendations,
       health_trend, anomalies_count, conflicts_count, top_topics,
       generated_at, generation_time_ms)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id
    `;

    const result = await this.db.query(query, [
      report.data.serverId,
      report.data.reportType,
      report.data.periodStart,
      report.data.periodEnd,
      report.title,
      report.summary,
      JSON.stringify({
        totalMessages: report.data.totalMessages,
        totalActiveUsers: report.data.totalActiveUsers,
        avgHealthScore: report.data.avgHealthScore,
        avgToxicityRate: report.data.avgToxicityRate,
        avgSentiment: report.data.avgSentiment
      }),
      JSON.stringify(report.insights),
      JSON.stringify(report.recommendations),
      report.data.healthTrend,
      report.data.anomaliesCount,
      report.data.conflictsCount,
      report.data.topTopics,
      report.generatedAt,
      report.generationTimeMs
    ]);

    return result.rows[0].id;
  }

  /**
   * Send report to server's mod channel
   */
  private async sendReportToServer(serverId: string, report: GeneratedReport): Promise<void> {
    try {
      // Find mod/admin channel
      const guild = this.discordClient.guilds.cache.get(serverId);
      if (!guild) return;

      // Look for a channel named "mod-logs", "admin", or first text channel
      const modChannel = guild.channels.cache.find(
        ch => ch.isTextBased() && (ch.name.includes('mod') || ch.name.includes('admin'))
      ) as TextChannel | undefined;

      if (!modChannel) {
        logger.warn(`No mod channel found for server ${serverId}`);
        return;
      }

      // Create Discord embed
      const embed = new EmbedBuilder()
        .setTitle(report.title)
        .setDescription(report.summary)
        .setColor(this.getHealthColor(report.data.avgHealthScore))
        .setTimestamp(report.generatedAt);

      // Add insights
      if (report.insights.length > 0) {
        embed.addFields({
          name: '💡 Key Insights',
          value: report.insights.map((insight, i) => `${i + 1}. ${insight}`).join('\n').slice(0, 1024)
        });
      }

      // Add recommendations
      if (report.recommendations.length > 0) {
        embed.addFields({
          name: '📋 Recommendations',
          value: report.recommendations.map((rec, i) => `${i + 1}. ${rec}`).join('\n').slice(0, 1024)
        });
      }

      // Add top topics if available
      if (report.data.topTopics.length > 0) {
        embed.addFields({
          name: '🔥 Trending Topics',
          value: report.data.topTopics.join(', ')
        });
      }

      embed.setFooter({ text: `Generated in ${report.generationTimeMs}ms` });

      await modChannel.send({ embeds: [embed] });
      logger.info(`Report sent to ${guild.name}`);

      // Update database
      await this.db.query(
        'UPDATE analytics_reports SET sent_to_channel = $1, sent_at = CURRENT_TIMESTAMP WHERE id = $2',
        [modChannel.id, report.id]
      );

    } catch (error) {
      logger.error('Error sending report to server:', error);
    }
  }

  /**
   * Get color based on health score
   */
  private getHealthColor(healthScore: number): number {
    if (healthScore >= 80) return 0x00FF00; // Green
    if (healthScore >= 60) return 0xFFFF00; // Yellow
    if (healthScore >= 40) return 0xFF9900; // Orange
    return 0xFF0000; // Red
  }

  /**
   * Get recent reports
   */
  async getRecentReports(serverId: string, limit: number = 10): Promise<GeneratedReport[]> {
    const query = `
      SELECT * FROM analytics_reports
      WHERE server_id = $1
      ORDER BY generated_at DESC
      LIMIT $2
    `;

    const result = await this.db.query(query, [serverId, limit]);

    return result.rows.map(row => ({
      id: row.id,
      data: {
        serverId: row.server_id,
        reportType: row.report_type,
        periodStart: new Date(row.report_period_start),
        periodEnd: new Date(row.report_period_end),
        ...JSON.parse(row.key_metrics || '{}'),
        healthTrend: row.health_trend,
        anomaliesCount: row.anomalies_count,
        conflictsCount: row.conflicts_count,
        topTopics: row.top_topics || [],
        topAnomalyTypes: [],
        conflictsAvoided: 0,
        topConflictUsers: [],
        totalModerationActions: 0,
        warningsCount: 0,
        timeoutsCount: 0,
        kicksCount: 0,
        bansCount: 0,
        avgMessagesPerDay: 0,
        peakActivityHour: 12,
        risingTopics: [],
        decliningTopics: []
      },
      title: row.title,
      summary: row.summary,
      insights: JSON.parse(row.insights || '[]'),
      recommendations: JSON.parse(row.recommendations || '[]'),
      generatedAt: new Date(row.generated_at),
      generationTimeMs: row.generation_time_ms
    }));
  }
}

/**
 * Example usage:
 *
 * const generator = new ReportGenerator(db, discordClient, ollamaService);
 *
 * // Start scheduled reports
 * generator.start();
 *
 * // Generate weekly report manually
 * const report = await generator.generateWeeklyReport(serverId);
 * console.log(report.title);
 * console.log(report.insights);
 *
 * // Generate custom report
 * const customReport = await generator.generateCustomReport(
 *   serverId,
 *   new Date('2025-01-01'),
 *   new Date('2025-01-31')
 * );
 *
 * // Get recent reports
 * const reports = await generator.getRecentReports(serverId, 5);
 */
