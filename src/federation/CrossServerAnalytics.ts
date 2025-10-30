import { Pool } from 'pg';
import logger from '../utils/logger';

/**
 * CrossServerAnalytics
 *
 * Aggregates analytics across multiple servers in the federation.
 * Provides insights into network-wide trends, threats, and user behavior.
 *
 * Features:
 * - Network-wide threat trends
 * - Cross-server user behavior patterns
 * - Global toxicity metrics
 * - Federation health monitoring
 * - Comparative server analytics
 */

export interface NetworkTrend {
  metric: string;
  currentValue: number;
  previousValue: number;
  changePercent: number;
  trend: 'up' | 'down' | 'stable';
}

export interface ServerComparison {
  serverId: string;
  serverName: string;
  totalMessages: number;
  totalUsers: number;
  avgToxicity: number;
  threatCount: number;
  moderationActions: number;
  healthScore: number;
}

export interface ThreatPattern {
  type: string;
  frequency: number;
  servers: string[];
  avgConfidence: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export class CrossServerAnalytics {
  constructor(private db: Pool) {}

  /**
   * Get network-wide statistics
   */
  async getNetworkStats(): Promise<{
    totalServers: number;
    totalUsers: number;
    totalMessages: number;
    avgToxicity: number;
    threatsLast24h: number;
    globalBans: number;
  }> {
    try {
      const result = await this.db.query(`
        SELECT
          (SELECT COUNT(DISTINCT server_id) FROM federation_servers WHERE is_active = true) as total_servers,
          (SELECT COUNT(DISTINCT user_id) FROM global_reputation) as total_users,
          (SELECT SUM(total_messages) FROM global_reputation) as total_messages,
          (SELECT AVG(toxicity_score) FROM messages WHERE created_at >= NOW() - INTERVAL '24 hours') as avg_toxicity,
          (SELECT COUNT(*) FROM shared_threats WHERE shared_at >= NOW() - INTERVAL '24 hours') as threats_24h,
          (SELECT COUNT(*) FROM global_ban_list WHERE is_active = true) as global_bans
      `);

      const row = result.rows[0];

      return {
        totalServers: parseInt(row.total_servers) || 0,
        totalUsers: parseInt(row.total_users) || 0,
        totalMessages: parseInt(row.total_messages) || 0,
        avgToxicity: parseFloat(row.avg_toxicity) || 0,
        threatsLast24h: parseInt(row.threats_24h) || 0,
        globalBans: parseInt(row.global_bans) || 0
      };
    } catch (error) {
      logger.error('Error getting network stats:', error);
      throw error;
    }
  }

  /**
   * Get network trends
   */
  async getNetworkTrends(hours: number = 24): Promise<NetworkTrend[]> {
    try {
      const result = await this.db.query(
        `
        WITH current_period AS (
          SELECT
            COUNT(DISTINCT m.user_id) as active_users,
            COUNT(m.id) as total_messages,
            AVG(m.toxicity_score) as avg_toxicity,
            COUNT(DISTINCT CASE WHEN m.toxicity_score > 0.7 THEN m.id END) as toxic_messages
          FROM messages m
          WHERE m.created_at >= NOW() - ($1 || ' hours')::INTERVAL
        ),
        previous_period AS (
          SELECT
            COUNT(DISTINCT m.user_id) as active_users,
            COUNT(m.id) as total_messages,
            AVG(m.toxicity_score) as avg_toxicity,
            COUNT(DISTINCT CASE WHEN m.toxicity_score > 0.7 THEN m.id END) as toxic_messages
          FROM messages m
          WHERE m.created_at >= NOW() - ($1 * 2 || ' hours')::INTERVAL
          AND m.created_at < NOW() - ($1 || ' hours')::INTERVAL
        )
        SELECT
          'active_users' as metric,
          cp.active_users as current_value,
          pp.active_users as previous_value
        FROM current_period cp, previous_period pp
        UNION ALL
        SELECT
          'total_messages' as metric,
          cp.total_messages as current_value,
          pp.total_messages as previous_value
        FROM current_period cp, previous_period pp
        UNION ALL
        SELECT
          'avg_toxicity' as metric,
          cp.avg_toxicity as current_value,
          pp.avg_toxicity as previous_value
        FROM current_period cp, previous_period pp
        UNION ALL
        SELECT
          'toxic_messages' as metric,
          cp.toxic_messages as current_value,
          pp.toxic_messages as previous_value
        FROM current_period cp, previous_period pp
        `,
        [hours]
      );

      return result.rows.map(row => {
        const currentValue = parseFloat(row.current_value) || 0;
        const previousValue = parseFloat(row.previous_value) || 0;
        const changePercent = previousValue > 0
          ? ((currentValue - previousValue) / previousValue) * 100
          : 0;

        let trend: 'up' | 'down' | 'stable' = 'stable';
        if (Math.abs(changePercent) > 5) {
          trend = changePercent > 0 ? 'up' : 'down';
        }

        return {
          metric: row.metric,
          currentValue,
          previousValue,
          changePercent,
          trend
        };
      });
    } catch (error) {
      logger.error('Error getting network trends:', error);
      return [];
    }
  }

  /**
   * Compare servers in federation
   */
  async compareServers(timeRange: string = '7d'): Promise<ServerComparison[]> {
    try {
      const result = await this.db.query(
        `
        SELECT
          fs.server_id,
          fs.server_name,
          COUNT(DISTINCT m.user_id) as total_users,
          COUNT(m.id) as total_messages,
          AVG(m.toxicity_score) as avg_toxicity,
          COUNT(DISTINCT st.id) as threat_count,
          COUNT(DISTINCT ma.id) as moderation_actions
        FROM federation_servers fs
        LEFT JOIN messages m ON m.server_id = fs.server_id
          AND m.created_at >= NOW() - ($1 || '')::INTERVAL
        LEFT JOIN shared_threats st ON st.origin_server_id = fs.server_id
          AND st.shared_at >= NOW() - ($1 || '')::INTERVAL
        LEFT JOIN moderation_actions ma ON ma.server_id = fs.server_id
          AND ma.created_at >= NOW() - ($1 || '')::INTERVAL
        WHERE fs.is_active = true
        GROUP BY fs.server_id, fs.server_name
        ORDER BY total_messages DESC
        `,
        [timeRange]
      );

      return result.rows.map(row => {
        const healthScore = this.calculateServerHealth(
          parseInt(row.total_messages),
          parseFloat(row.avg_toxicity),
          parseInt(row.threat_count),
          parseInt(row.moderation_actions)
        );

        return {
          serverId: row.server_id,
          serverName: row.server_name,
          totalMessages: parseInt(row.total_messages) || 0,
          totalUsers: parseInt(row.total_users) || 0,
          avgToxicity: parseFloat(row.avg_toxicity) || 0,
          threatCount: parseInt(row.threat_count) || 0,
          moderationActions: parseInt(row.moderation_actions) || 0,
          healthScore
        };
      });
    } catch (error) {
      logger.error('Error comparing servers:', error);
      return [];
    }
  }

  /**
   * Calculate server health score
   */
  private calculateServerHealth(
    messages: number,
    toxicity: number,
    threats: number,
    actions: number
  ): number {
    let score = 100;

    // High toxicity reduces health
    score -= toxicity * 30;

    // High threat count reduces health
    const threatRate = messages > 0 ? threats / messages : 0;
    score -= threatRate * 100;

    // Too many moderation actions indicate problems
    const actionRate = messages > 0 ? actions / messages : 0;
    score -= actionRate * 50;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get threat patterns across network
   */
  async getThreatPatterns(days: number = 7): Promise<ThreatPattern[]> {
    try {
      const result = await this.db.query(
        `
        WITH threat_stats AS (
          SELECT
            type,
            COUNT(*) as frequency,
            ARRAY_AGG(DISTINCT origin_server_id) as servers,
            AVG(confidence) as avg_confidence,
            DATE_TRUNC('day', shared_at) as day
          FROM shared_threats
          WHERE shared_at >= NOW() - ($1 || ' days')::INTERVAL
          GROUP BY type, DATE_TRUNC('day', shared_at)
        ),
        trend_calculation AS (
          SELECT
            type,
            SUM(frequency) as total_frequency,
            ARRAY_AGG(DISTINCT unnest(servers)) as all_servers,
            AVG(avg_confidence) as overall_avg_confidence,
            CASE
              WHEN COUNT(*) < 2 THEN 'stable'
              WHEN (LAST_VALUE(frequency) OVER (PARTITION BY type ORDER BY day) >
                    FIRST_VALUE(frequency) OVER (PARTITION BY type ORDER BY day) * 1.2)
                THEN 'increasing'
              WHEN (LAST_VALUE(frequency) OVER (PARTITION BY type ORDER BY day) <
                    FIRST_VALUE(frequency) OVER (PARTITION BY type ORDER BY day) * 0.8)
                THEN 'decreasing'
              ELSE 'stable'
            END as trend
          FROM threat_stats
          GROUP BY type
        )
        SELECT DISTINCT ON (type)
          type,
          total_frequency as frequency,
          all_servers as servers,
          overall_avg_confidence as avg_confidence,
          trend
        FROM trend_calculation
        ORDER BY type, total_frequency DESC
        `,
        [days]
      );

      return result.rows.map(row => ({
        type: row.type,
        frequency: parseInt(row.frequency),
        servers: row.servers || [],
        avgConfidence: parseFloat(row.avg_confidence),
        trend: row.trend
      }));
    } catch (error) {
      logger.error('Error getting threat patterns:', error);
      return [];
    }
  }

  /**
   * Get top users across federation
   */
  async getTopUsers(
    metric: 'messages' | 'violations' | 'trust',
    limit: number = 100
  ): Promise<any[]> {
    try {
      let orderBy = 'total_messages DESC';

      if (metric === 'violations') {
        orderBy = 'total_violations DESC';
      } else if (metric === 'trust') {
        orderBy = 'total_violations ASC, total_bans ASC, total_messages DESC';
      }

      const result = await this.db.query(
        `
        SELECT
          user_id,
          username,
          total_messages,
          total_violations,
          total_bans,
          first_seen,
          last_updated
        FROM global_reputation
        ORDER BY ${orderBy}
        LIMIT $1
        `,
        [limit]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting top users:', error);
      return [];
    }
  }

  /**
   * Get cross-server activity heatmap
   */
  async getActivityHeatmap(days: number = 7): Promise<any> {
    try {
      const result = await this.db.query(
        `
        SELECT
          EXTRACT(DOW FROM created_at) as day_of_week,
          EXTRACT(HOUR FROM created_at) as hour,
          COUNT(*) as message_count
        FROM messages
        WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
        GROUP BY day_of_week, hour
        ORDER BY day_of_week, hour
        `,
        [days]
      );

      // Build 7x24 matrix
      const heatmap: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));

      for (const row of result.rows) {
        const day = parseInt(row.day_of_week);
        const hour = parseInt(row.hour);
        const count = parseInt(row.message_count);

        heatmap[day][hour] = count;
      }

      return {
        heatmap,
        max: Math.max(...heatmap.flat())
      };
    } catch (error) {
      logger.error('Error getting activity heatmap:', error);
      return { heatmap: [], max: 0 };
    }
  }

  /**
   * Get global toxicity distribution
   */
  async getToxicityDistribution(): Promise<{
    low: number;
    medium: number;
    high: number;
    critical: number;
  }> {
    try {
      const result = await this.db.query(`
        SELECT
          COUNT(CASE WHEN toxicity_score < 0.3 THEN 1 END) as low,
          COUNT(CASE WHEN toxicity_score >= 0.3 AND toxicity_score < 0.6 THEN 1 END) as medium,
          COUNT(CASE WHEN toxicity_score >= 0.6 AND toxicity_score < 0.8 THEN 1 END) as high,
          COUNT(CASE WHEN toxicity_score >= 0.8 THEN 1 END) as critical
        FROM messages
        WHERE created_at >= NOW() - INTERVAL '24 hours'
      `);

      const row = result.rows[0];

      return {
        low: parseInt(row.low) || 0,
        medium: parseInt(row.medium) || 0,
        high: parseInt(row.high) || 0,
        critical: parseInt(row.critical) || 0
      };
    } catch (error) {
      logger.error('Error getting toxicity distribution:', error);
      return { low: 0, medium: 0, high: 0, critical: 0 };
    }
  }

  /**
   * Get federation health report
   */
  async getHealthReport(): Promise<{
    overallHealth: number;
    issues: string[];
    recommendations: string[];
  }> {
    try {
      const stats = await this.getNetworkStats();
      const trends = await this.getNetworkTrends(24);

      let overallHealth = 100;
      const issues: string[] = [];
      const recommendations: string[] = [];

      // Check average toxicity
      if (stats.avgToxicity > 0.5) {
        overallHealth -= 20;
        issues.push('High network-wide toxicity detected');
        recommendations.push('Review moderation policies across servers');
      }

      // Check threat trends
      const threatTrend = trends.find(t => t.metric === 'toxic_messages');
      if (threatTrend && threatTrend.trend === 'up' && threatTrend.changePercent > 20) {
        overallHealth -= 15;
        issues.push('Increasing toxic message trend');
        recommendations.push('Enable stricter auto-moderation');
      }

      // Check active servers
      if (stats.totalServers > 0 && stats.totalUsers / stats.totalServers < 10) {
        overallHealth -= 10;
        issues.push('Low user engagement across servers');
        recommendations.push('Review server onboarding and engagement strategies');
      }

      // Check global bans
      if (stats.globalBans > stats.totalUsers * 0.05) {
        overallHealth -= 10;
        issues.push('High global ban rate (>5%)');
        recommendations.push('Investigate potential false positives in ban system');
      }

      return {
        overallHealth: Math.max(0, overallHealth),
        issues,
        recommendations
      };
    } catch (error) {
      logger.error('Error getting health report:', error);
      return {
        overallHealth: 0,
        issues: ['Failed to generate health report'],
        recommendations: []
      };
    }
  }
}

export default CrossServerAnalytics;
