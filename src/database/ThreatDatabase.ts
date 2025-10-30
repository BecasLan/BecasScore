/**
 * THREAT DATABASE - Centralized Threat Intelligence Storage
 *
 * PostgreSQL-backed database for storing:
 * - Known scammer accounts
 * - Malicious links/domains
 * - Phishing campaigns
 * - Threat patterns
 * - Historical threat data
 *
 * Used by all threat detection layers for quick lookups.
 */

import { Pool } from 'pg';
import { createLogger } from '../services/Logger';

const logger = createLogger('ThreatDatabase');

export interface ThreatEntry {
  id: string;
  type: 'user' | 'link' | 'domain' | 'pattern' | 'campaign';
  value: string; // User ID, URL, domain, etc.

  // Threat classification
  category: 'scam' | 'phishing' | 'spam' | 'toxic' | 'malware' | 'raid';
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number; // 0-1

  // Evidence
  description: string;
  indicators: string[]; // JSON array of indicators
  sources: string[]; // Where was this detected

  // Status
  status: 'active' | 'expired' | 'false_positive';
  verified: boolean; // Manually verified

  // Metadata
  firstSeen: Date;
  lastSeen: Date;
  detectionCount: number;
  affectedServers: string[]; // Server IDs

  // Actions taken
  actions: Array<{
    serverId: string;
    action: string; // ban, timeout, warn, etc.
    timestamp: Date;
  }>;

  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export class ThreatDatabase {
  private pool: Pool;
  private cache: Map<string, ThreatEntry> = new Map(); // value → entry (for fast lookups)

  constructor(pool: Pool) {
    this.pool = pool;
    logger.info('ThreatDatabase initialized');
    this.createTables();
    this.loadCache();
  }

  /**
   * Create database tables
   */
  private async createTables(): Promise<void> {
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS threat_database (
          id VARCHAR(255) PRIMARY KEY,
          type VARCHAR(50) NOT NULL,
          value TEXT NOT NULL,
          category VARCHAR(50) NOT NULL,
          severity VARCHAR(20) NOT NULL,
          confidence DECIMAL(3, 2) NOT NULL,
          description TEXT,
          indicators JSONB,
          sources JSONB,
          status VARCHAR(20) DEFAULT 'active',
          verified BOOLEAN DEFAULT FALSE,
          first_seen TIMESTAMP NOT NULL,
          last_seen TIMESTAMP NOT NULL,
          detection_count INTEGER DEFAULT 1,
          affected_servers JSONB,
          actions JSONB,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          expires_at TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_threat_type ON threat_database(type);
        CREATE INDEX IF NOT EXISTS idx_threat_value ON threat_database(value);
        CREATE INDEX IF NOT EXISTS idx_threat_category ON threat_database(category);
        CREATE INDEX IF NOT EXISTS idx_threat_status ON threat_database(status);
        CREATE INDEX IF NOT EXISTS idx_threat_expires ON threat_database(expires_at);
      `);

      logger.info('Threat database tables created/verified');
    } catch (error) {
      logger.error('Failed to create threat database tables', error);
    }
  }

  /**
   * Load cache from database
   */
  private async loadCache(): Promise<void> {
    try {
      const result = await this.pool.query(`
        SELECT * FROM threat_database
        WHERE status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW())
        LIMIT 10000
      `);

      for (const row of result.rows) {
        const entry = this.rowToEntry(row);
        this.cache.set(entry.value, entry);
      }

      logger.info(`Loaded ${this.cache.size} active threats into cache`);
    } catch (error) {
      logger.error('Failed to load threat cache', error);
    }
  }

  /**
   * Add or update threat entry
   */
  async addThreat(entry: Omit<ThreatEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<ThreatEntry> {
    try {
      // Check if entry already exists
      const existing = await this.getThreat(entry.type, entry.value);

      if (existing) {
        // Update existing entry
        existing.lastSeen = new Date();
        existing.detectionCount++;
        existing.confidence = Math.min(1.0, existing.confidence + 0.05);
        existing.updatedAt = new Date();

        // Merge sources and affected servers
        existing.sources = [...new Set([...existing.sources, ...entry.sources])];
        existing.affectedServers = [...new Set([...existing.affectedServers, ...entry.affectedServers])];

        await this.updateThreat(existing);
        return existing;
      }

      // Create new entry
      const newEntry: ThreatEntry = {
        ...entry,
        id: this.generateId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.pool.query(`
        INSERT INTO threat_database (
          id, type, value, category, severity, confidence,
          description, indicators, sources, status, verified,
          first_seen, last_seen, detection_count, affected_servers, actions, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `, [
        newEntry.id,
        newEntry.type,
        newEntry.value,
        newEntry.category,
        newEntry.severity,
        newEntry.confidence,
        newEntry.description,
        JSON.stringify(newEntry.indicators),
        JSON.stringify(newEntry.sources),
        newEntry.status,
        newEntry.verified,
        newEntry.firstSeen,
        newEntry.lastSeen,
        newEntry.detectionCount,
        JSON.stringify(newEntry.affectedServers),
        JSON.stringify(newEntry.actions || []),
        newEntry.expiresAt,
      ]);

      // Add to cache
      this.cache.set(newEntry.value, newEntry);

      logger.info(`Added threat: ${newEntry.type}/${newEntry.category} - ${newEntry.value}`);
      return newEntry;

    } catch (error) {
      logger.error('Failed to add threat', error);
      throw error;
    }
  }

  /**
   * Get threat by type and value
   */
  async getThreat(type: string, value: string): Promise<ThreatEntry | null> {
    // Check cache first
    const cached = this.cache.get(value);
    if (cached && cached.type === type) {
      return cached;
    }

    // Query database
    try {
      const result = await this.pool.query(`
        SELECT * FROM threat_database
        WHERE type = $1 AND value = $2
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW())
        LIMIT 1
      `, [type, value]);

      if (result.rows.length === 0) return null;

      const entry = this.rowToEntry(result.rows[0]);
      this.cache.set(entry.value, entry);
      return entry;

    } catch (error) {
      logger.error('Failed to get threat', error);
      return null;
    }
  }

  /**
   * Check if user is known threat
   */
  async isUserThreat(userId: string): Promise<boolean> {
    const threat = await this.getThreat('user', userId);
    return threat !== null;
  }

  /**
   * Check if link is known threat
   */
  async isLinkThreat(url: string): Promise<boolean> {
    // Check exact URL
    const exactMatch = await this.getThreat('link', url);
    if (exactMatch) return true;

    // Check domain
    try {
      const domain = new URL(url).hostname;
      const domainMatch = await this.getThreat('domain', domain);
      return domainMatch !== null;
    } catch {
      return false;
    }
  }

  /**
   * Search threats by category
   */
  async searchThreats(filters: {
    type?: string;
    category?: string;
    severity?: string;
    minConfidence?: number;
    status?: string;
    limit?: number;
  }): Promise<ThreatEntry[]> {
    try {
      let query = 'SELECT * FROM threat_database WHERE 1=1';
      const params: any[] = [];
      let paramCount = 1;

      if (filters.type) {
        query += ` AND type = $${paramCount++}`;
        params.push(filters.type);
      }

      if (filters.category) {
        query += ` AND category = $${paramCount++}`;
        params.push(filters.category);
      }

      if (filters.severity) {
        query += ` AND severity = $${paramCount++}`;
        params.push(filters.severity);
      }

      if (filters.minConfidence) {
        query += ` AND confidence >= $${paramCount++}`;
        params.push(filters.minConfidence);
      }

      if (filters.status) {
        query += ` AND status = $${paramCount++}`;
        params.push(filters.status);
      }

      query += ` ORDER BY last_seen DESC LIMIT ${filters.limit || 100}`;

      const result = await this.pool.query(query, params);
      return result.rows.map(row => this.rowToEntry(row));

    } catch (error) {
      logger.error('Failed to search threats', error);
      return [];
    }
  }

  /**
   * Update threat entry
   */
  async updateThreat(entry: ThreatEntry): Promise<void> {
    try {
      await this.pool.query(`
        UPDATE threat_database SET
          category = $2,
          severity = $3,
          confidence = $4,
          description = $5,
          indicators = $6,
          sources = $7,
          status = $8,
          verified = $9,
          last_seen = $10,
          detection_count = $11,
          affected_servers = $12,
          actions = $13,
          updated_at = NOW(),
          expires_at = $14
        WHERE id = $1
      `, [
        entry.id,
        entry.category,
        entry.severity,
        entry.confidence,
        entry.description,
        JSON.stringify(entry.indicators),
        JSON.stringify(entry.sources),
        entry.status,
        entry.verified,
        entry.lastSeen,
        entry.detectionCount,
        JSON.stringify(entry.affectedServers),
        JSON.stringify(entry.actions),
        entry.expiresAt,
      ]);

      // Update cache
      this.cache.set(entry.value, entry);

      logger.debug(`Updated threat ${entry.id}`);
    } catch (error) {
      logger.error('Failed to update threat', error);
    }
  }

  /**
   * Mark threat as false positive
   */
  async markFalsePositive(id: string): Promise<void> {
    try {
      await this.pool.query(`
        UPDATE threat_database SET
          status = 'false_positive',
          updated_at = NOW()
        WHERE id = $1
      `, [id]);

      // Remove from cache
      const entry = Array.from(this.cache.values()).find(e => e.id === id);
      if (entry) {
        this.cache.delete(entry.value);
      }

      logger.info(`Marked threat ${id} as false positive`);
    } catch (error) {
      logger.error('Failed to mark false positive', error);
    }
  }

  /**
   * Verify threat
   */
  async verifyThreat(id: string): Promise<void> {
    try {
      await this.pool.query(`
        UPDATE threat_database SET
          verified = TRUE,
          confidence = LEAST(1.0, confidence + 0.2),
          updated_at = NOW()
        WHERE id = $1
      `, [id]);

      logger.info(`Verified threat ${id}`);
    } catch (error) {
      logger.error('Failed to verify threat', error);
    }
  }

  /**
   * Record action taken against threat
   */
  async recordAction(
    id: string,
    serverId: string,
    action: string
  ): Promise<void> {
    try {
      const entry = await this.pool.query(`
        SELECT actions FROM threat_database WHERE id = $1
      `, [id]);

      if (entry.rows.length === 0) return;

      const actions = entry.rows[0].actions || [];
      actions.push({
        serverId,
        action,
        timestamp: new Date(),
      });

      await this.pool.query(`
        UPDATE threat_database SET
          actions = $2,
          updated_at = NOW()
        WHERE id = $1
      `, [id, JSON.stringify(actions)]);

    } catch (error) {
      logger.error('Failed to record action', error);
    }
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    total: number;
    active: number;
    byType: Record<string, number>;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
    verified: number;
    falsePositives: number;
  }> {
    try {
      const result = await this.pool.query(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN verified = TRUE THEN 1 ELSE 0 END) as verified,
          SUM(CASE WHEN status = 'false_positive' THEN 1 ELSE 0 END) as false_positives,
          json_object_agg(type, type_count) as by_type,
          json_object_agg(category, category_count) as by_category,
          json_object_agg(severity, severity_count) as by_severity
        FROM (
          SELECT
            type,
            category,
            severity,
            COUNT(*) OVER (PARTITION BY type) as type_count,
            COUNT(*) OVER (PARTITION BY category) as category_count,
            COUNT(*) OVER (PARTITION BY severity) as severity_count
          FROM threat_database
          WHERE status = 'active'
        ) subquery
        GROUP BY type, category, severity
        LIMIT 1
      `);

      const row = result.rows[0] || {};

      return {
        total: parseInt(row.total) || 0,
        active: parseInt(row.active) || 0,
        byType: row.by_type || {},
        byCategory: row.by_category || {},
        bySeverity: row.by_severity || {},
        verified: parseInt(row.verified) || 0,
        falsePositives: parseInt(row.false_positives) || 0,
      };
    } catch (error) {
      logger.error('Failed to get stats', error);
      return {
        total: 0,
        active: 0,
        byType: {},
        byCategory: {},
        bySeverity: {},
        verified: 0,
        falsePositives: 0,
      };
    }
  }

  /**
   * Clean up expired threats
   */
  async cleanup(): Promise<number> {
    try {
      const result = await this.pool.query(`
        UPDATE threat_database SET status = 'expired'
        WHERE expires_at < NOW() AND status = 'active'
      `);

      // Reload cache
      await this.loadCache();

      logger.info(`Expired ${result.rowCount} threats`);
      return result.rowCount || 0;
    } catch (error) {
      logger.error('Failed to cleanup threats', error);
      return 0;
    }
  }

  /**
   * Convert database row to ThreatEntry
   */
  private rowToEntry(row: any): ThreatEntry {
    return {
      id: row.id,
      type: row.type,
      value: row.value,
      category: row.category,
      severity: row.severity,
      confidence: parseFloat(row.confidence),
      description: row.description,
      indicators: row.indicators || [],
      sources: row.sources || [],
      status: row.status,
      verified: row.verified,
      firstSeen: new Date(row.first_seen),
      lastSeen: new Date(row.last_seen),
      detectionCount: row.detection_count,
      affectedServers: row.affected_servers || [],
      actions: row.actions || [],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `threat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
