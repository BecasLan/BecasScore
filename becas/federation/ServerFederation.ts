import { Pool } from 'pg';
import logger from '../utils/logger';

/**
 * ServerFederation
 *
 * Coordinates multiple BECAS instances across different Discord servers.
 * Enables cross-server threat intelligence sharing, global ban lists,
 * and federated reputation tracking.
 *
 * Features:
 * - Cross-server threat sharing
 * - Global ban synchronization
 * - Federated reputation network
 * - Shared analytics aggregation
 * - Coordinated moderation actions
 */

export interface FederationServer {
  serverId: string;
  serverName: string;
  guildId: string;
  federationLevel: 'public' | 'trusted' | 'private';
  joinedAt: Date;
  isActive: boolean;
  sharedThreats: boolean;
  sharedBans: boolean;
  sharedReputation: boolean;
}

export interface SharedThreat {
  id: string;
  type: string;
  severity: string;
  confidence: number;
  description: string;
  originServerId: string;
  userId?: string;
  messageContent?: string;
  detectedAt: Date;
  sharedAt: Date;
  affectedServers: string[];
}

export interface GlobalBanEntry {
  userId: string;
  username: string;
  reason: string;
  bannedBy: string;
  originServerId: string;
  banType: 'scam' | 'raid' | 'spam' | 'toxicity' | 'manual';
  confidence: number;
  bannedAt: Date;
  expiresAt?: Date;
  evidence: any;
}

export interface ReputationEntry {
  userId: string;
  username: string;
  globalTrustScore: number;
  serverScores: Map<string, number>;
  totalMessages: number;
  totalViolations: number;
  totalBans: number;
  firstSeen: Date;
  lastUpdated: Date;
}

export class ServerFederation {
  constructor(private db: Pool, private currentServerId: string) {}

  /**
   * Register current server in federation
   */
  async registerServer(
    serverName: string,
    guildId: string,
    federationLevel: 'public' | 'trusted' | 'private' = 'public'
  ): Promise<void> {
    try {
      await this.db.query(
        `
        INSERT INTO federation_servers (server_id, server_name, guild_id, federation_level)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (server_id)
        DO UPDATE SET
          server_name = $2,
          guild_id = $3,
          federation_level = $4,
          is_active = true,
          updated_at = NOW()
        `,
        [this.currentServerId, serverName, guildId, federationLevel]
      );

      logger.info(`Server registered in federation: ${serverName} (${federationLevel})`);
    } catch (error) {
      logger.error('Error registering server in federation:', error);
      throw error;
    }
  }

  /**
   * Share threat with federation
   */
  async shareThreat(threat: {
    type: string;
    severity: string;
    confidence: number;
    description: string;
    userId?: string;
    messageContent?: string;
    metadata?: any;
  }): Promise<string> {
    try {
      // Only share high-confidence threats
      if (threat.confidence < 0.8) {
        logger.debug('Threat confidence too low to share:', threat.confidence);
        return '';
      }

      const result = await this.db.query(
        `
        INSERT INTO shared_threats (
          origin_server_id,
          type,
          severity,
          confidence,
          description,
          user_id,
          message_content,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
        `,
        [
          this.currentServerId,
          threat.type,
          threat.severity,
          threat.confidence,
          threat.description,
          threat.userId,
          threat.messageContent,
          JSON.stringify(threat.metadata || {})
        ]
      );

      const threatId = result.rows[0].id;

      // Notify other servers in federation
      await this.notifyFederationServers('threat_shared', {
        threatId,
        type: threat.type,
        severity: threat.severity,
        originServer: this.currentServerId
      });

      logger.info(`Shared threat with federation: ${threatId} (${threat.type})`);

      return threatId;
    } catch (error) {
      logger.error('Error sharing threat:', error);
      throw error;
    }
  }

  /**
   * Get recent shared threats
   */
  async getSharedThreats(
    hours: number = 24,
    minConfidence: number = 0.8
  ): Promise<SharedThreat[]> {
    try {
      const result = await this.db.query(
        `
        SELECT
          st.*,
          fs.server_name as origin_server_name,
          COUNT(DISTINCT sta.server_id) as affected_server_count
        FROM shared_threats st
        JOIN federation_servers fs ON st.origin_server_id = fs.server_id
        LEFT JOIN shared_threat_acknowledgments sta ON st.id = sta.threat_id
        WHERE st.shared_at >= NOW() - ($1 || ' hours')::INTERVAL
        AND st.confidence >= $2
        AND st.origin_server_id != $3
        GROUP BY st.id, fs.server_name
        ORDER BY st.shared_at DESC
        LIMIT 100
        `,
        [hours, minConfidence, this.currentServerId]
      );

      return result.rows.map(row => ({
        id: row.id,
        type: row.type,
        severity: row.severity,
        confidence: parseFloat(row.confidence),
        description: row.description,
        originServerId: row.origin_server_id,
        userId: row.user_id,
        messageContent: row.message_content,
        detectedAt: row.detected_at,
        sharedAt: row.shared_at,
        affectedServers: [] // Will be populated separately if needed
      }));
    } catch (error) {
      logger.error('Error getting shared threats:', error);
      return [];
    }
  }

  /**
   * Acknowledge threat (mark as seen/handled)
   */
  async acknowledgeThreat(
    threatId: string,
    action: 'investigated' | 'acted' | 'ignored'
  ): Promise<void> {
    try {
      await this.db.query(
        `
        INSERT INTO shared_threat_acknowledgments (threat_id, server_id, action)
        VALUES ($1, $2, $3)
        ON CONFLICT (threat_id, server_id)
        DO UPDATE SET action = $3, acknowledged_at = NOW()
        `,
        [threatId, this.currentServerId, action]
      );

      logger.debug(`Acknowledged threat ${threatId}: ${action}`);
    } catch (error) {
      logger.error('Error acknowledging threat:', error);
    }
  }

  /**
   * Add user to global ban list
   */
  async addGlobalBan(ban: {
    userId: string;
    username: string;
    reason: string;
    bannedBy: string;
    banType: 'scam' | 'raid' | 'spam' | 'toxicity' | 'manual';
    confidence: number;
    evidence?: any;
    expiresAt?: Date;
  }): Promise<void> {
    try {
      await this.db.query(
        `
        INSERT INTO global_ban_list (
          user_id,
          username,
          reason,
          banned_by,
          origin_server_id,
          ban_type,
          confidence,
          evidence,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (user_id, origin_server_id)
        DO UPDATE SET
          reason = $3,
          banned_by = $4,
          ban_type = $6,
          confidence = $7,
          evidence = $8,
          expires_at = $9,
          updated_at = NOW()
        `,
        [
          ban.userId,
          ban.username,
          ban.reason,
          ban.bannedBy,
          this.currentServerId,
          ban.banType,
          ban.confidence,
          JSON.stringify(ban.evidence || {}),
          ban.expiresAt
        ]
      );

      // Notify federation
      await this.notifyFederationServers('global_ban_added', {
        userId: ban.userId,
        username: ban.username,
        banType: ban.banType,
        originServer: this.currentServerId
      });

      logger.info(`Added user to global ban list: ${ban.username} (${ban.userId})`);
    } catch (error) {
      logger.error('Error adding global ban:', error);
      throw error;
    }
  }

  /**
   * Check if user is globally banned
   */
  async isGloballyBanned(userId: string): Promise<GlobalBanEntry | null> {
    try {
      const result = await this.db.query(
        `
        SELECT
          gbl.*,
          fs.server_name as origin_server_name
        FROM global_ban_list gbl
        JOIN federation_servers fs ON gbl.origin_server_id = fs.server_id
        WHERE gbl.user_id = $1
        AND gbl.is_active = true
        AND (gbl.expires_at IS NULL OR gbl.expires_at > NOW())
        ORDER BY gbl.banned_at DESC
        LIMIT 1
        `,
        [userId]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];

      return {
        userId: row.user_id,
        username: row.username,
        reason: row.reason,
        bannedBy: row.banned_by,
        originServerId: row.origin_server_id,
        banType: row.ban_type,
        confidence: parseFloat(row.confidence),
        bannedAt: row.banned_at,
        expiresAt: row.expires_at,
        evidence: row.evidence
      };
    } catch (error) {
      logger.error('Error checking global ban:', error);
      return null;
    }
  }

  /**
   * Get global ban list
   */
  async getGlobalBanList(
    filters: {
      banType?: string;
      minConfidence?: number;
      limit?: number;
    } = {}
  ): Promise<GlobalBanEntry[]> {
    try {
      const { banType, minConfidence = 0.8, limit = 100 } = filters;

      let query = `
        SELECT
          gbl.*,
          fs.server_name as origin_server_name
        FROM global_ban_list gbl
        JOIN federation_servers fs ON gbl.origin_server_id = fs.server_id
        WHERE gbl.is_active = true
        AND (gbl.expires_at IS NULL OR gbl.expires_at > NOW())
        AND gbl.confidence >= $1
      `;

      const params: any[] = [minConfidence];

      if (banType) {
        query += ` AND gbl.ban_type = $${params.length + 1}`;
        params.push(banType);
      }

      query += ` ORDER BY gbl.banned_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await this.db.query(query, params);

      return result.rows.map(row => ({
        userId: row.user_id,
        username: row.username,
        reason: row.reason,
        bannedBy: row.banned_by,
        originServerId: row.origin_server_id,
        banType: row.ban_type,
        confidence: parseFloat(row.confidence),
        bannedAt: row.banned_at,
        expiresAt: row.expires_at,
        evidence: row.evidence
      }));
    } catch (error) {
      logger.error('Error getting global ban list:', error);
      return [];
    }
  }

  /**
   * Update user reputation across federation
   */
  async updateGlobalReputation(
    userId: string,
    username: string,
    delta: {
      messages?: number;
      violations?: number;
      bans?: number;
      trustScoreChange?: number;
    }
  ): Promise<void> {
    try {
      await this.db.query(
        `
        INSERT INTO global_reputation (
          user_id,
          username,
          total_messages,
          total_violations,
          total_bans
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id)
        DO UPDATE SET
          username = $2,
          total_messages = global_reputation.total_messages + $3,
          total_violations = global_reputation.total_violations + $4,
          total_bans = global_reputation.total_bans + $5,
          last_updated = NOW()
        `,
        [
          userId,
          username,
          delta.messages || 0,
          delta.violations || 0,
          delta.bans || 0
        ]
      );

      // Also update server-specific reputation
      await this.db.query(
        `
        INSERT INTO server_reputation (user_id, server_id, trust_score_delta)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, server_id)
        DO UPDATE SET
          trust_score_delta = server_reputation.trust_score_delta + $3,
          updated_at = NOW()
        `,
        [userId, this.currentServerId, delta.trustScoreChange || 0]
      );

      logger.debug(`Updated global reputation for ${username}`);
    } catch (error) {
      logger.error('Error updating global reputation:', error);
    }
  }

  /**
   * Get user's global reputation
   */
  async getGlobalReputation(userId: string): Promise<ReputationEntry | null> {
    try {
      const result = await this.db.query(
        `
        SELECT
          gr.*,
          COALESCE(AVG(sr.trust_score_delta), 0) as avg_server_trust
        FROM global_reputation gr
        LEFT JOIN server_reputation sr ON gr.user_id = sr.user_id
        WHERE gr.user_id = $1
        GROUP BY gr.user_id, gr.username, gr.total_messages,
                 gr.total_violations, gr.total_bans, gr.first_seen, gr.last_updated
        `,
        [userId]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];

      // Calculate global trust score
      const globalTrustScore = this.calculateGlobalTrustScore(
        row.total_messages,
        row.total_violations,
        row.total_bans,
        parseFloat(row.avg_server_trust)
      );

      return {
        userId: row.user_id,
        username: row.username,
        globalTrustScore,
        serverScores: new Map(), // Can be populated separately if needed
        totalMessages: row.total_messages,
        totalViolations: row.total_violations,
        totalBans: row.total_bans,
        firstSeen: row.first_seen,
        lastUpdated: row.last_updated
      };
    } catch (error) {
      logger.error('Error getting global reputation:', error);
      return null;
    }
  }

  /**
   * Calculate global trust score
   */
  private calculateGlobalTrustScore(
    messages: number,
    violations: number,
    bans: number,
    avgServerTrust: number
  ): number {
    // Base score: 50
    let score = 50;

    // Positive factors
    score += Math.min(messages / 100, 30); // Up to +30 for activity

    // Negative factors
    score -= violations * 5; // -5 per violation
    score -= bans * 20; // -20 per ban

    // Server trust average
    score += avgServerTrust * 0.2; // Weight server scores

    // Clamp between 0-100
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get federation statistics
   */
  async getFederationStats(): Promise<{
    totalServers: number;
    activeServers: number;
    sharedThreats: number;
    globalBans: number;
    trackedUsers: number;
  }> {
    try {
      const result = await this.db.query(`
        SELECT
          (SELECT COUNT(*) FROM federation_servers) as total_servers,
          (SELECT COUNT(*) FROM federation_servers WHERE is_active = true) as active_servers,
          (SELECT COUNT(*) FROM shared_threats WHERE shared_at >= NOW() - INTERVAL '7 days') as shared_threats,
          (SELECT COUNT(*) FROM global_ban_list WHERE is_active = true) as global_bans,
          (SELECT COUNT(*) FROM global_reputation) as tracked_users
      `);

      const row = result.rows[0];

      return {
        totalServers: parseInt(row.total_servers),
        activeServers: parseInt(row.active_servers),
        sharedThreats: parseInt(row.shared_threats),
        globalBans: parseInt(row.global_bans),
        trackedUsers: parseInt(row.tracked_users)
      };
    } catch (error) {
      logger.error('Error getting federation stats:', error);
      return {
        totalServers: 0,
        activeServers: 0,
        sharedThreats: 0,
        globalBans: 0,
        trackedUsers: 0
      };
    }
  }

  /**
   * Notify other servers in federation
   */
  private async notifyFederationServers(
    eventType: string,
    data: any
  ): Promise<void> {
    try {
      // Insert notification event
      await this.db.query(
        `
        INSERT INTO federation_events (
          origin_server_id,
          event_type,
          event_data
        )
        VALUES ($1, $2, $3)
        `,
        [this.currentServerId, eventType, JSON.stringify(data)]
      );

      logger.debug(`Broadcast federation event: ${eventType}`);
    } catch (error) {
      logger.error('Error notifying federation:', error);
    }
  }

  /**
   * Get federation events for this server
   */
  async getFederationEvents(since?: Date): Promise<any[]> {
    try {
      const result = await this.db.query(
        `
        SELECT
          fe.*,
          fs.server_name as origin_server_name
        FROM federation_events fe
        JOIN federation_servers fs ON fe.origin_server_id = fs.server_id
        WHERE fe.origin_server_id != $1
        AND ($2::timestamp IS NULL OR fe.created_at > $2)
        ORDER BY fe.created_at DESC
        LIMIT 100
        `,
        [this.currentServerId, since]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting federation events:', error);
      return [];
    }
  }
}

export default ServerFederation;
