/**
 * THREAT REPOSITORY
 *
 * Handles threat detection and cross-server intelligence
 */

import { DatabaseService, getDatabaseService } from '../DatabaseService';
import { createLogger } from '../../services/Logger';

const logger = createLogger('ThreatRepository');

export interface Threat {
  id: string;
  server_id: string;
  user_id: string;
  channel_id?: string;
  message_id?: string;
  threat_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  evidence_content?: string;
  evidence_metadata: Record<string, any>;
  detection_method: string;
  indicators: string[];
  matched_patterns: string[];
  action_taken?: string;
  action_timestamp?: Date;
  action_successful?: boolean;
  was_correct?: boolean;
  moderator_feedback?: string;
  moderator_id?: string;
  feedback_timestamp?: Date;
  is_global_threat: boolean;
  reported_to_global: boolean;
  detected_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CrossServerAlert {
  id: string;
  user_id: string;
  reported_by_server_id: string;
  global_risk_score: number;
  banned_server_count: number;
  total_violations_across_servers: number;
  is_server_hopping: boolean;
  avg_time_before_violation_hours?: number;
  violation_pattern?: string;
  known_scam_phrases: string[];
  associated_account_ids: string[];
  known_alt_accounts: string[];
  alert_level: 'low' | 'medium' | 'high' | 'critical';
  recommended_action: string;
  evidence_summary?: string;
  reporting_servers: string[];
  first_reported_at: Date;
  last_updated_at: Date;
  created_at: Date;
}

export class ThreatRepository {
  private db: DatabaseService;

  constructor(db?: DatabaseService) {
    this.db = db || getDatabaseService();
  }

  /**
   * Create threat record
   */
  async createThreat(threatData: {
    server_id: string;
    user_id: string;
    channel_id?: string;
    message_id?: string;
    threat_type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    evidence_content?: string;
    evidence_metadata?: Record<string, any>;
    detection_method: string;
    indicators?: string[];
    matched_patterns?: string[];
  }): Promise<Threat> {
    const data = {
      server_id: threatData.server_id,
      user_id: threatData.user_id,
      channel_id: threatData.channel_id,
      message_id: threatData.message_id,
      threat_type: threatData.threat_type,
      severity: threatData.severity,
      confidence: threatData.confidence,
      evidence_content: threatData.evidence_content,
      evidence_metadata: threatData.evidence_metadata || {},
      detection_method: threatData.detection_method,
      indicators: threatData.indicators || [],
      matched_patterns: threatData.matched_patterns || [],
      is_global_threat: threatData.severity === 'critical' && threatData.confidence >= 90,
      reported_to_global: false,
      detected_at: new Date()
    };

    return this.db.insert<Threat>('threats', data);
  }

  /**
   * Update threat action
   */
  async updateThreatAction(
    threatId: string,
    action: string,
    successful: boolean
  ): Promise<void> {
    await this.db.query(
      `UPDATE threats
       SET action_taken = $1, action_successful = $2, action_timestamp = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [action, successful, threatId]
    );
  }

  /**
   * Add moderator feedback
   */
  async addModeratorFeedback(
    threatId: string,
    moderatorId: string,
    wasCorrect: boolean,
    feedback?: string
  ): Promise<void> {
    await this.db.query(
      `UPDATE threats
       SET was_correct = $1, moderator_id = $2, moderator_feedback = $3,
           feedback_timestamp = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [wasCorrect, moderatorId, feedback, threatId]
    );
  }

  /**
   * Get pending threats (no action taken yet)
   */
  async getPendingThreats(serverId: string, minConfidence: number = 70): Promise<Threat[]> {
    return this.db.queryMany<Threat>(
      `SELECT * FROM threats
       WHERE server_id = $1
         AND action_taken IS NULL
         AND confidence >= $2
       ORDER BY
         CASE severity
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
         END,
         detected_at DESC`,
      [serverId, minConfidence]
    );
  }

  /**
   * Get user threat history
   */
  async getUserThreats(
    serverId: string,
    userId: string,
    limit: number = 50
  ): Promise<Threat[]> {
    return this.db.queryMany<Threat>(
      `SELECT * FROM threats
       WHERE server_id = $1 AND user_id = $2
       ORDER BY detected_at DESC
       LIMIT $3`,
      [serverId, userId, limit]
    );
  }

  /**
   * Get false positive rate
   */
  async getFalsePositiveRate(
    threatType?: string,
    detectionMethod?: string
  ): Promise<number> {
    let whereClause = 'WHERE was_correct IS NOT NULL';
    const params: any[] = [];
    let paramIndex = 1;

    if (threatType) {
      whereClause += ` AND threat_type = $${paramIndex++}`;
      params.push(threatType);
    }

    if (detectionMethod) {
      whereClause += ` AND detection_method = $${paramIndex++}`;
      params.push(detectionMethod);
    }

    const result = await this.db.queryOne<{
      total: string;
      false_positives: string;
    }>(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE was_correct = false) as false_positives
       FROM threats
       ${whereClause}`,
      params
    );

    if (!result || parseInt(result.total) === 0) return 0;

    return (parseInt(result.false_positives) / parseInt(result.total)) * 100;
  }

  /**
   * Report global threat
   */
  async reportGlobalThreat(
    userId: string,
    serverId: string,
    threatType: string,
    evidence: string
  ): Promise<CrossServerAlert> {
    // Check if alert already exists
    let alert = await this.db.queryOne<CrossServerAlert>(
      'SELECT * FROM cross_server_alerts WHERE user_id = $1',
      [userId]
    );

    if (alert) {
      // Update existing alert
      await this.db.query(
        `UPDATE cross_server_alerts
         SET banned_server_count = banned_server_count + 1,
             total_violations_across_servers = total_violations_across_servers + 1,
             reporting_servers = array_append(reporting_servers, $1),
             last_updated_at = NOW()
         WHERE user_id = $2`,
        [serverId, userId]
      );

      return this.db.queryOne<CrossServerAlert>(
        'SELECT * FROM cross_server_alerts WHERE user_id = $1',
        [userId]
      ) as Promise<CrossServerAlert>;
    } else {
      // Create new alert
      return this.db.insert<CrossServerAlert>('cross_server_alerts', {
        user_id: userId,
        reported_by_server_id: serverId,
        alert_level: 'medium',
        violation_pattern: threatType,
        evidence_summary: evidence,
        reporting_servers: [serverId],
        recommended_action: 'watch'
      });
    }
  }

  /**
   * Get cross-server alerts for user
   */
  async getCrossServerAlert(userId: string): Promise<CrossServerAlert | null> {
    return this.db.cached<CrossServerAlert | null>(
      `cross_server_alert:${userId}`,
      600, // 10 minutes
      () => this.db.queryOne<CrossServerAlert>(
        'SELECT * FROM cross_server_alerts WHERE user_id = $1',
        [userId]
      )
    );
  }

  /**
   * Get global high-risk users
   */
  async getGlobalHighRiskUsers(limit: number = 100): Promise<CrossServerAlert[]> {
    return this.db.cached<CrossServerAlert[]>(
      `global_high_risk:${limit}`,
      300, // 5 minutes
      () => this.db.queryMany<CrossServerAlert>(
        `SELECT * FROM cross_server_alerts
         WHERE alert_level IN ('high', 'critical')
         ORDER BY global_risk_score DESC, banned_server_count DESC
         LIMIT $1`,
        [limit]
      )
    );
  }

  /**
   * Mark user as server hopper
   */
  async markAsServerHopper(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE cross_server_alerts
       SET is_server_hopping = true,
           alert_level = 'high',
           recommended_action = 'auto_ban'
       WHERE user_id = $1`,
      [userId]
    );

    await this.db.invalidateCache(`cross_server_alert:${userId}`);
  }

  /**
   * Get threat statistics
   */
  async getThreatStats(serverId: string, days: number = 7): Promise<{
    totalThreats: number;
    criticalThreats: number;
    highThreats: number;
    pendingThreats: number;
    falsePositives: number;
    topThreatTypes: Array<{ type: string; count: number }>;
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const stats = await this.db.queryOne<any>(
      `SELECT
         COUNT(*) as total_threats,
         COUNT(*) FILTER (WHERE severity = 'critical') as critical_threats,
         COUNT(*) FILTER (WHERE severity = 'high') as high_threats,
         COUNT(*) FILTER (WHERE action_taken IS NULL) as pending_threats,
         COUNT(*) FILTER (WHERE was_correct = false) as false_positives
       FROM threats
       WHERE server_id = $1 AND detected_at >= $2`,
      [serverId, since]
    );

    const topTypes = await this.db.queryMany<{ type: string; count: string }>(
      `SELECT threat_type as type, COUNT(*) as count
       FROM threats
       WHERE server_id = $1 AND detected_at >= $2
       GROUP BY threat_type
       ORDER BY count DESC
       LIMIT 5`,
      [serverId, since]
    );

    return {
      totalThreats: parseInt(stats?.total_threats || '0'),
      criticalThreats: parseInt(stats?.critical_threats || '0'),
      highThreats: parseInt(stats?.high_threats || '0'),
      pendingThreats: parseInt(stats?.pending_threats || '0'),
      falsePositives: parseInt(stats?.false_positives || '0'),
      topThreatTypes: topTypes.map(t => ({ type: t.type, count: parseInt(t.count) }))
    };
  }
}
