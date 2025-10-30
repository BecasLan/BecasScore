/**
 * USER REPOSITORY
 *
 * Handles all user-related database operations
 */

import { DatabaseService, getDatabaseService } from '../DatabaseService';
import { createLogger } from '../../services/Logger';

const logger = createLogger('UserRepository');

export interface User {
  id: string;
  username: string;
  discriminator?: string;
  global_name?: string;
  avatar_url?: string;
  is_bot: boolean;
  is_system: boolean;
  global_risk_score: number;
  global_trust_score: number;
  banned_server_count: number;
  is_known_scammer: boolean;
  is_known_spammer: boolean;
  first_seen_at: Date;
  last_seen_at: Date;
  updated_at: Date;
}

export interface ServerMember {
  id: string;
  server_id: string;
  user_id: string;
  trust_score: number;
  risk_category: 'safe' | 'watch' | 'risky' | 'dangerous';
  roles: string[];
  is_moderator: boolean;
  is_admin: boolean;
  joined_at: Date;
  left_at?: Date;
  total_messages: number;
  last_message_at?: Date;
  total_warnings: number;
  total_timeouts: number;
  total_kicks: number;
  total_bans: number;
}

export class UserRepository {
  private db: DatabaseService;

  constructor(db?: DatabaseService) {
    this.db = db || getDatabaseService();
  }

  /**
   * Create or update user
   */
  async upsertUser(userData: {
    id: string;
    username: string;
    discriminator?: string;
    global_name?: string;
    avatar_url?: string;
    is_bot?: boolean;
    is_system?: boolean;
  }): Promise<User> {
    const data = {
      id: userData.id,
      username: userData.username,
      discriminator: userData.discriminator,
      global_name: userData.global_name,
      avatar_url: userData.avatar_url,
      is_bot: userData.is_bot || false,
      is_system: userData.is_system || false,
      last_seen_at: new Date()
    };

    return this.db.upsert<User>(
      'users',
      data,
      ['id'],
      ['username', 'discriminator', 'global_name', 'avatar_url', 'last_seen_at']
    );
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    return this.db.queryOne<User>(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username: string): Promise<User | null> {
    return this.db.queryOne<User>(
      'SELECT * FROM users WHERE username ILIKE $1',
      [username]
    );
  }

  /**
   * Update global risk score
   */
  async updateGlobalRiskScore(userId: string, riskScore: number): Promise<void> {
    await this.db.query(
      'UPDATE users SET global_risk_score = $1, updated_at = NOW() WHERE id = $2',
      [riskScore, userId]
    );
  }

  /**
   * Update global trust score
   */
  async updateGlobalTrustScore(userId: string, trustScore: number): Promise<void> {
    await this.db.query(
      'UPDATE users SET global_trust_score = $1, updated_at = NOW() WHERE id = $2',
      [trustScore, userId]
    );
  }

  /**
   * Mark user as known scammer
   */
  async markAsScammer(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE users SET
        is_known_scammer = true,
        global_risk_score = 100,
        global_trust_score = 0,
        updated_at = NOW()
      WHERE id = $1`,
      [userId]
    );
  }

  /**
   * Get high-risk users
   */
  async getHighRiskUsers(limit: number = 100): Promise<User[]> {
    return this.db.cached<User[]>(
      `high_risk_users:${limit}`,
      300, // 5 minutes
      () => this.db.queryMany<User>(
        `SELECT * FROM users
         WHERE global_risk_score >= 70 OR is_known_scammer = true
         ORDER BY global_risk_score DESC, banned_server_count DESC
         LIMIT $1`,
        [limit]
      )
    );
  }

  /**
   * Get or create server member
   */
  async upsertServerMember(data: {
    server_id: string;
    user_id: string;
    roles?: string[];
    is_moderator?: boolean;
    is_admin?: boolean;
  }): Promise<ServerMember> {
    const memberData = {
      server_id: data.server_id,
      user_id: data.user_id,
      roles: data.roles || [],
      is_moderator: data.is_moderator || false,
      is_admin: data.is_admin || false
    };

    return this.db.upsert<ServerMember>(
      'server_members',
      memberData,
      ['server_id', 'user_id'],
      ['roles', 'is_moderator', 'is_admin']
    );
  }

  /**
   * Get server member
   */
  async getServerMember(serverId: string, userId: string): Promise<ServerMember | null> {
    return this.db.queryOne<ServerMember>(
      'SELECT * FROM server_members WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );
  }

  /**
   * Update member trust score
   */
  async updateMemberTrustScore(
    serverId: string,
    userId: string,
    trustScore: number
  ): Promise<void> {
    const riskCategory = this.getRiskCategory(trustScore);

    await this.db.query(
      `UPDATE server_members
       SET trust_score = $1, risk_category = $2
       WHERE server_id = $3 AND user_id = $4`,
      [trustScore, riskCategory, serverId, userId]
    );

    // Invalidate cache
    await this.db.invalidateCache(`server_member:${serverId}:${userId}`);
  }

  /**
   * Increment violation counters
   */
  async incrementViolation(
    serverId: string,
    userId: string,
    type: 'warnings' | 'timeouts' | 'kicks' | 'bans'
  ): Promise<void> {
    const column = `total_${type}`;

    await this.db.query(
      `UPDATE server_members
       SET ${column} = ${column} + 1
       WHERE server_id = $1 AND user_id = $2`,
      [serverId, userId]
    );
  }

  /**
   * Get members by risk category
   */
  async getMembersByRiskCategory(
    serverId: string,
    riskCategory: string
  ): Promise<ServerMember[]> {
    return this.db.queryMany<ServerMember>(
      `SELECT * FROM server_members
       WHERE server_id = $1 AND risk_category = $2 AND left_at IS NULL
       ORDER BY trust_score ASC`,
      [serverId, riskCategory]
    );
  }

  /**
   * Get active moderators
   */
  async getModerators(serverId: string): Promise<ServerMember[]> {
    return this.db.cached<ServerMember[]>(
      `moderators:${serverId}`,
      600, // 10 minutes
      () => this.db.queryMany<ServerMember>(
        `SELECT * FROM server_members
         WHERE server_id = $1 AND (is_moderator = true OR is_admin = true) AND left_at IS NULL`,
        [serverId]
      )
    );
  }

  /**
   * Mark member as left
   */
  async markMemberLeft(serverId: string, userId: string): Promise<void> {
    await this.db.query(
      'UPDATE server_members SET left_at = NOW() WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );
  }

  /**
   * Get server member count
   */
  async getServerMemberCount(serverId: string): Promise<number> {
    const result = await this.db.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM server_members WHERE server_id = $1 AND left_at IS NULL',
      [serverId]
    );
    return parseInt(result?.count || '0');
  }

  /**
   * Helper: Determine risk category from trust score
   */
  private getRiskCategory(trustScore: number): string {
    if (trustScore >= 70) return 'safe';
    if (trustScore >= 40) return 'watch';
    if (trustScore >= 20) return 'risky';
    return 'dangerous';
  }
}
