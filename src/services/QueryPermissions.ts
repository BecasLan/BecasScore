import { Pool } from 'pg';
import { GuildMember, PermissionFlagsBits } from 'discord.js';
import logger from '../utils/logger';

/**
 * QueryPermissions
 *
 * Manages permissions and rate limiting for query system.
 *
 * Features:
 * - Role-based access control
 * - Rate limiting (max queries per minute)
 * - Query complexity scoring
 * - Audit logging
 * - Sensitive data restrictions
 */

export interface PermissionCheck {
  allowed: boolean;
  reason?: string;
  remainingQueries?: number;
  resetAt?: Date;
}

export interface RateLimitEntry {
  userId: string;
  serverId: string;
  queryCount: number;
  windowStart: Date;
}

export class QueryPermissions {
  private db: Pool;

  // Rate limit: 10 queries per minute per user
  private readonly RATE_LIMIT = 10;
  private readonly RATE_WINDOW = 60 * 1000; // 1 minute

  // In-memory rate limit tracking
  private rateLimits: Map<string, RateLimitEntry> = new Map();

  // Allowed roles (can be configured per server)
  private readonly DEFAULT_ALLOWED_ROLES = [
    'Moderator',
    'Admin',
    'Owner'
  ];

  // Sensitive tables (require admin permission)
  private readonly SENSITIVE_TABLES = [
    'moderator_feedback',
    'learning_adjustments',
    'query_logs'
  ];

  constructor(db: Pool) {
    this.db = db;
    this.startRateLimitCleanup();
  }

  /**
   * Initialize database tables
   */
  async initialize(): Promise<void> {
    await this.createTables();
    logger.info('QueryPermissions initialized');
  }

  /**
   * Create permission tables
   */
  private async createTables(): Promise<void> {
    const createQueryPermissionsTable = `
      CREATE TABLE IF NOT EXISTS query_permissions (
        server_id VARCHAR(255) PRIMARY KEY,
        allowed_roles JSONB DEFAULT '[]',
        rate_limit INTEGER DEFAULT 10,
        rate_window INTEGER DEFAULT 60,
        allow_sensitive_data BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await this.db.query(createQueryPermissionsTable);
    logger.info('Query permissions table created');
  }

  /**
   * Check if user can execute queries
   */
  async checkPermission(
    serverId: string,
    member: GuildMember,
    sql?: string
  ): Promise<PermissionCheck> {
    // 1. Check if user is moderator/admin
    const hasModRole = this.hasModeratorRole(member);
    if (!hasModRole) {
      return {
        allowed: false,
        reason: 'You must be a moderator to use queries'
      };
    }

    // 2. Check rate limit
    const rateLimitCheck = this.checkRateLimit(serverId, member.id);
    if (!rateLimitCheck.allowed) {
      return rateLimitCheck;
    }

    // 3. Check sensitive data access
    if (sql) {
      const sensitiveCheck = await this.checkSensitiveAccess(serverId, member, sql);
      if (!sensitiveCheck.allowed) {
        return sensitiveCheck;
      }
    }

    return {
      allowed: true,
      remainingQueries: rateLimitCheck.remainingQueries,
      resetAt: rateLimitCheck.resetAt
    };
  }

  /**
   * Check if user has moderator role
   */
  private hasModeratorRole(member: GuildMember): boolean {
    // Check Discord permissions
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return true;
    }

    if (member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return true;
    }

    // Check role names
    const roles = member.roles.cache.map(r => r.name);
    return this.DEFAULT_ALLOWED_ROLES.some(allowedRole =>
      roles.some(role => role.toLowerCase().includes(allowedRole.toLowerCase()))
    );
  }

  /**
   * Check rate limit
   */
  private checkRateLimit(serverId: string, userId: string): PermissionCheck {
    const key = `${serverId}:${userId}`;
    const now = Date.now();

    let entry = this.rateLimits.get(key);

    // Create new entry if doesn't exist or window expired
    if (!entry || now - entry.windowStart.getTime() > this.RATE_WINDOW) {
      entry = {
        userId,
        serverId,
        queryCount: 0,
        windowStart: new Date(now)
      };
      this.rateLimits.set(key, entry);
    }

    // Check if over limit
    if (entry.queryCount >= this.RATE_LIMIT) {
      const resetAt = new Date(entry.windowStart.getTime() + this.RATE_WINDOW);
      return {
        allowed: false,
        reason: `Rate limit exceeded. You can make ${this.RATE_LIMIT} queries per minute.`,
        remainingQueries: 0,
        resetAt
      };
    }

    // Increment count
    entry.queryCount++;

    return {
      allowed: true,
      remainingQueries: this.RATE_LIMIT - entry.queryCount,
      resetAt: new Date(entry.windowStart.getTime() + this.RATE_WINDOW)
    };
  }

  /**
   * Check access to sensitive data
   */
  private async checkSensitiveAccess(
    serverId: string,
    member: GuildMember,
    sql: string
  ): Promise<PermissionCheck> {
    // Check if query accesses sensitive tables
    const upperSql = sql.toUpperCase();
    const usesSensitiveTable = this.SENSITIVE_TABLES.some(table =>
      upperSql.includes(table.toUpperCase())
    );

    if (!usesSensitiveTable) {
      return { allowed: true };
    }

    // Require admin permission for sensitive tables
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return {
        allowed: false,
        reason: 'Admin permission required to access this data'
      };
    }

    // Check server settings
    const settings = await this.getServerSettings(serverId);
    if (!settings.allow_sensitive_data) {
      return {
        allowed: false,
        reason: 'Sensitive data access is disabled on this server'
      };
    }

    return { allowed: true };
  }

  /**
   * Get server permission settings
   */
  private async getServerSettings(serverId: string): Promise<any> {
    const query = 'SELECT * FROM query_permissions WHERE server_id = $1';
    const result = await this.db.query(query, [serverId]);

    if (result.rows.length === 0) {
      // Return defaults
      return {
        allowed_roles: this.DEFAULT_ALLOWED_ROLES,
        rate_limit: this.RATE_LIMIT,
        rate_window: this.RATE_WINDOW / 1000,
        allow_sensitive_data: false
      };
    }

    return result.rows[0];
  }

  /**
   * Update server permission settings
   */
  async updateServerSettings(
    serverId: string,
    settings: {
      allowedRoles?: string[];
      rateLimit?: number;
      rateWindow?: number;
      allowSensitiveData?: boolean;
    }
  ): Promise<void> {
    const query = `
      INSERT INTO query_permissions (server_id, allowed_roles, rate_limit, rate_window, allow_sensitive_data, updated_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (server_id) DO UPDATE SET
        allowed_roles = COALESCE($2, query_permissions.allowed_roles),
        rate_limit = COALESCE($3, query_permissions.rate_limit),
        rate_window = COALESCE($4, query_permissions.rate_window),
        allow_sensitive_data = COALESCE($5, query_permissions.allow_sensitive_data),
        updated_at = CURRENT_TIMESTAMP
    `;

    await this.db.query(query, [
      serverId,
      settings.allowedRoles ? JSON.stringify(settings.allowedRoles) : null,
      settings.rateLimit || null,
      settings.rateWindow || null,
      settings.allowSensitiveData !== undefined ? settings.allowSensitiveData : null
    ]);

    logger.info(`Updated query permissions for server ${serverId}`);
  }

  /**
   * Reset rate limit for a user
   */
  resetRateLimit(serverId: string, userId: string): void {
    const key = `${serverId}:${userId}`;
    this.rateLimits.delete(key);
    logger.info(`Reset rate limit for user ${userId} on server ${serverId}`);
  }

  /**
   * Get rate limit stats for a user
   */
  getRateLimitStats(serverId: string, userId: string): {
    queryCount: number;
    limit: number;
    remaining: number;
    resetAt: Date | null;
  } {
    const key = `${serverId}:${userId}`;
    const entry = this.rateLimits.get(key);

    if (!entry) {
      return {
        queryCount: 0,
        limit: this.RATE_LIMIT,
        remaining: this.RATE_LIMIT,
        resetAt: null
      };
    }

    return {
      queryCount: entry.queryCount,
      limit: this.RATE_LIMIT,
      remaining: Math.max(0, this.RATE_LIMIT - entry.queryCount),
      resetAt: new Date(entry.windowStart.getTime() + this.RATE_WINDOW)
    };
  }

  /**
   * Start rate limit cleanup job
   */
  private startRateLimitCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      let removed = 0;

      for (const [key, entry] of this.rateLimits.entries()) {
        if (now - entry.windowStart.getTime() > this.RATE_WINDOW * 2) {
          this.rateLimits.delete(key);
          removed++;
        }
      }

      if (removed > 0) {
        logger.debug(`Rate limit cleanup: removed ${removed} expired entries`);
      }
    }, 60000); // Clean every minute
  }

  /**
   * Calculate query complexity score
   */
  calculateComplexity(sql: string): number {
    let score = 0;

    const upperSql = sql.toUpperCase();

    // Base score
    score += 1;

    // Joins
    const joinCount = (upperSql.match(/JOIN/g) || []).length;
    score += joinCount * 2;

    // Subqueries
    const subqueryCount = (upperSql.match(/\(SELECT/g) || []).length;
    score += subqueryCount * 3;

    // Aggregations
    const aggCount = (upperSql.match(/(COUNT|SUM|AVG|MIN|MAX|GROUP BY)/g) || []).length;
    score += aggCount;

    // ORDER BY
    if (upperSql.includes('ORDER BY')) score += 1;

    // LIKE (can be slow)
    const likeCount = (upperSql.match(/LIKE/g) || []).length;
    score += likeCount;

    return score;
  }

  /**
   * Check if query is too complex
   */
  checkComplexity(sql: string): { allowed: boolean; score: number; reason?: string } {
    const score = this.calculateComplexity(sql);
    const maxComplexity = 15;

    if (score > maxComplexity) {
      return {
        allowed: false,
        score,
        reason: `Query too complex (score: ${score}/${maxComplexity}). Simplify your query or contact an admin.`
      };
    }

    return { allowed: true, score };
  }
}

/**
 * Example usage:
 *
 * const permissions = new QueryPermissions(db);
 * await permissions.initialize();
 *
 * // Check permission before executing query
 * const check = await permissions.checkPermission(serverId, member, sql);
 *
 * if (!check.allowed) {
 *   await message.reply(check.reason);
 *   return;
 * }
 *
 * // Show remaining queries
 * await message.reply(`Query executed. ${check.remainingQueries} queries remaining.`);
 *
 * // Check complexity
 * const complexity = permissions.checkComplexity(sql);
 * if (!complexity.allowed) {
 *   await message.reply(complexity.reason);
 *   return;
 * }
 *
 * // Get rate limit stats
 * const stats = permissions.getRateLimitStats(serverId, userId);
 * console.log('Rate limit:', stats);
 *
 * // Update server settings
 * await permissions.updateServerSettings(serverId, {
 *   rateLimit: 20,
 *   allowSensitiveData: true
 * });
 */
