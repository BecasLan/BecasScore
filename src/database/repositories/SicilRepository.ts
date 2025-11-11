/**
 * SICIL REPOSITORY
 *
 * Handles user sicil (criminal record) operations
 */

import { DatabaseService, getDatabaseService } from '../DatabaseService';
import { getSupabaseClient } from '../SupabaseClient';
import { createLogger } from '../../services/Logger';

const logger = createLogger('SicilRepository');

export interface UserAction {
  id: string;
  server_id: string;
  user_id: string;
  channel_id?: string;
  action_type: string;
  content?: string;
  content_after?: string;
  intent?: string;
  sentiment?: string;
  toxicity_score: number;
  scam_score: number;
  spam_score: number;
  was_provoked: boolean;
  emotional_state?: string;
  conversation_context?: string;
  triggered_moderation: boolean;
  moderation_action?: string;
  moderator_override: boolean;
  moderator_id?: string;
  timestamp: Date;
  metadata: Record<string, any>;
}

export interface UserSicilSummary {
  id: string;
  server_id: string;
  user_id: string;
  total_warnings: number;
  total_timeouts: number;
  total_kicks: number;
  total_bans: number;
  scam_violations: number;
  phishing_violations: number;
  toxicity_violations: number;
  spam_violations: number;
  harassment_violations: number;
  clean_streak_days: number;
  last_violation_at?: Date;
  rehabilitation_progress: number;
  risk_category: 'safe' | 'watch' | 'risky' | 'dangerous';
  risk_factors: string[];
  moderator_notes: Array<{
    timestamp: Date;
    moderator_id: string;
    note: string;
  }>;
  created_at: Date;
  updated_at: Date;
}

export class SicilRepository {
  private db: DatabaseService;

  constructor(db?: DatabaseService) {
    this.db = db || getDatabaseService();
  }

  /**
   * Log user action to sicil
   */
  async logAction(actionData: {
    server_id: string;
    user_id: string;
    channel_id?: string;
    action_type: string;
    content?: string;
    content_after?: string;
    intent?: string;
    sentiment?: string;
    toxicity_score?: number;
    scam_score?: number;
    spam_score?: number;
    was_provoked?: boolean;
    emotional_state?: string;
    triggered_moderation?: boolean;
    moderation_action?: string;
    moderator_id?: string;
    metadata?: Record<string, any>;
  }): Promise<UserAction> {
    const data = {
      server_id: actionData.server_id,
      user_id: actionData.user_id,
      channel_id: actionData.channel_id,
      action_type: actionData.action_type,
      content: actionData.content,
      content_after: actionData.content_after,
      intent: actionData.intent,
      sentiment: actionData.sentiment,
      toxicity_score: actionData.toxicity_score || 0,
      scam_score: actionData.scam_score || 0,
      spam_score: actionData.spam_score || 0,
      was_provoked: actionData.was_provoked || false,
      emotional_state: actionData.emotional_state,
      triggered_moderation: actionData.triggered_moderation || false,
      moderation_action: actionData.moderation_action,
      moderator_override: false,
      moderator_id: actionData.moderator_id,
      timestamp: new Date(),
      metadata: actionData.metadata || {}
    };

    return this.db.insert<UserAction>('user_actions', data);
  }

  /**
   * Get user actions (recent)
   */
  async getUserActions(
    serverId: string,
    userId: string,
    limit: number = 100
  ): Promise<UserAction[]> {
    return this.db.queryMany<UserAction>(
      `SELECT * FROM user_actions
       WHERE server_id = $1 AND user_id = $2
       ORDER BY timestamp DESC
       LIMIT $3`,
      [serverId, userId, limit]
    );
  }

  /**
   * Get or create sicil summary
   */
  async getSicilSummary(serverId: string, userId: string): Promise<UserSicilSummary> {
    let summary = await this.db.queryOne<UserSicilSummary>(
      'SELECT * FROM user_sicil_summary WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );

    if (!summary) {
      // 🔥 FIX: Ensure server exists before creating summary
      try {
        const serverExists = await this.db.queryOne(
          'SELECT id FROM servers WHERE id = $1',
          [serverId]
        );

        if (!serverExists) {
          logger.warn(`Server ${serverId} not found in database, skipping sicil summary creation`);
          // Return a default summary without saving to DB
          return {
            id: 'temp',
            server_id: serverId,
            user_id: userId,
            total_warnings: 0,
            total_timeouts: 0,
            total_kicks: 0,
            total_bans: 0,
            scam_violations: 0,
            phishing_violations: 0,
            toxicity_violations: 0,
            spam_violations: 0,
            harassment_violations: 0,
            clean_streak_days: 0,
            rehabilitation_progress: 0,
            risk_category: 'safe',
            risk_factors: [],
            moderator_notes: [],
            created_at: new Date(),
            updated_at: new Date()
          };
        }

        // Create new summary
        summary = await this.db.insert<UserSicilSummary>(
          'user_sicil_summary',
          {
            server_id: serverId,
            user_id: userId,
            moderator_notes: []
          }
        );
      } catch (error: any) {
        logger.error(`Failed to create sicil summary: ${error.message}`);
        // Return default summary on error
        return {
          id: 'temp',
          server_id: serverId,
          user_id: userId,
          total_warnings: 0,
          total_timeouts: 0,
          total_kicks: 0,
          total_bans: 0,
          scam_violations: 0,
          phishing_violations: 0,
          toxicity_violations: 0,
          spam_violations: 0,
          harassment_violations: 0,
          clean_streak_days: 0,
          rehabilitation_progress: 0,
          risk_category: 'safe',
          risk_factors: [],
          moderator_notes: [],
          created_at: new Date(),
          updated_at: new Date()
        };
      }
    }

    return summary;
  }

  /**
   * Increment violation counter
   */
  async incrementViolation(
    serverId: string,
    userId: string,
    violationType: 'warning' | 'timeout' | 'kick' | 'ban',
    category?: 'scam' | 'phishing' | 'toxicity' | 'spam' | 'harassment'
  ): Promise<void> {
    try {
      // Try PostgreSQL first
      await this.db.transaction(async (client) => {
        // Increment violation type counter
        const violationColumn = `total_${violationType}s`;
        await client.query(
          `UPDATE user_sicil_summary
           SET ${violationColumn} = ${violationColumn} + 1,
               last_violation_at = NOW(),
               clean_streak_days = 0,
               updated_at = NOW()
           WHERE server_id = $1 AND user_id = $2`,
          [serverId, userId]
        );

        // Increment category counter if provided
        if (category) {
          const categoryColumn = `${category}_violations`;
          await client.query(
            `UPDATE user_sicil_summary
             SET ${categoryColumn} = ${categoryColumn} + 1
             WHERE server_id = $1 AND user_id = $2`,
            [serverId, userId]
          );
        }

        // Update risk category
        await this.updateRiskCategory(serverId, userId, client);
      });

      // Invalidate cache
      await this.db.invalidateCache(`sicil:${serverId}:${userId}`);
    } catch (error: any) {
      // Fallback to Supabase REST API if PostgreSQL fails
      const isConnectionError =
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'EPIPE' ||
        error.message?.includes('timeout') ||
        error.message?.includes('connect') ||
        error.message?.includes('Connection');

      if (isConnectionError) {
        logger.warn(`PostgreSQL connection failed (${error.code || 'unknown'}), using Supabase REST API fallback`);
        await this.incrementViolationViaSupabase(serverId, userId, violationType, category);
      } else {
        throw error;
      }
    }
  }

  /**
   * Increment violation via Supabase REST API (fallback)
   */
  private async incrementViolationViaSupabase(
    serverId: string,
    userId: string,
    violationType: 'warning' | 'timeout' | 'kick' | 'ban',
    category?: 'scam' | 'phishing' | 'toxicity' | 'spam' | 'harassment'
  ): Promise<void> {
    try {
      const supabase = getSupabaseClient();

      // Ensure server exists (CRITICAL: foreign key requirement!)
      const { error: serverCheckError } = await supabase
        .from('servers')
        .select('id')
        .eq('id', serverId)
        .single();

      if (serverCheckError && serverCheckError.code === 'PGRST116') {
        // Server doesn't exist, create it
        logger.info(`Creating server record in Supabase: ${serverId}`);
        const { error: serverInsertError } = await supabase
          .from('servers')
          .insert({
            id: serverId,
            name: 'Discord Server',
            created_at: new Date().toISOString()
          });

        if (serverInsertError) {
          logger.error('Failed to create server record:', serverInsertError);
          // Don't throw - try to continue anyway
        }
      }

      // Get current sicil summary
      const { data: summary, error: fetchError } = await supabase
        .from('user_sicil_summary')
        .select('*')
        .eq('server_id', serverId)
        .eq('user_id', userId)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }

      // Calculate new values
      const violationColumn = `total_${violationType}s`;
      const updates: any = {
        [violationColumn]: (summary?.[violationColumn as keyof typeof summary] || 0) + 1,
        last_violation_at: new Date().toISOString(),
        clean_streak_days: 0,
        updated_at: new Date().toISOString(),
      };

      if (category) {
        const categoryColumn = `${category}_violations`;
        updates[categoryColumn] = (summary?.[categoryColumn as keyof typeof summary] || 0) + 1;
      }

      // Calculate risk category
      const totalViolations =
        (updates.total_warnings || summary?.total_warnings || 0) +
        (updates.total_timeouts || summary?.total_timeouts || 0) +
        (updates.total_kicks || summary?.total_kicks || 0) +
        (updates.total_bans || summary?.total_bans || 0);

      let riskCategory: string;
      if (totalViolations === 0 || updates.clean_streak_days >= 90) {
        riskCategory = 'safe';
      } else if (totalViolations <= 2 && updates.clean_streak_days >= 30) {
        riskCategory = 'watch';
      } else if (totalViolations <= 5) {
        riskCategory = 'risky';
      } else {
        riskCategory = 'dangerous';
      }

      updates.risk_category = riskCategory;

      // Update or Insert the record
      if (summary) {
        // Update existing record
        const { error: updateError } = await supabase
          .from('user_sicil_summary')
          .update(updates)
          .eq('server_id', serverId)
          .eq('user_id', userId);

        if (updateError) {
          throw updateError;
        }
      } else {
        // Insert new record
        const { error: insertError } = await supabase
          .from('user_sicil_summary')
          .insert({
            server_id: serverId,
            user_id: userId,
            total_warnings: 0,
            total_timeouts: 0,
            total_kicks: 0,
            total_bans: 0,
            scam_violations: 0,
            phishing_violations: 0,
            toxicity_violations: 0,
            spam_violations: 0,
            harassment_violations: 0,
            clean_streak_days: 0,
            rehabilitation_progress: 0,
            risk_factors: [],
            moderator_notes: [],
            ...updates
          });

        if (insertError) {
          throw insertError;
        }
      }

      logger.info(`✅ Violation incremented via Supabase REST API: ${violationType} for ${userId}`);
    } catch (error) {
      logger.error('Failed to increment violation via Supabase:', error);
      throw error;
    }
  }

  /**
   * Update clean streak
   */
  async updateCleanStreak(serverId: string, userId: string): Promise<void> {
    const summary = await this.getSicilSummary(serverId, userId);

    if (!summary.last_violation_at) return;

    const daysSinceViolation = Math.floor(
      (Date.now() - new Date(summary.last_violation_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceViolation > summary.clean_streak_days) {
      await this.db.query(
        `UPDATE user_sicil_summary
         SET clean_streak_days = $1, updated_at = NOW()
         WHERE server_id = $2 AND user_id = $3`,
        [daysSinceViolation, serverId, userId]
      );
    }
  }

  /**
   * Update rehabilitation progress
   */
  async updateRehabilitationProgress(
    serverId: string,
    userId: string,
    progress: number
  ): Promise<void> {
    await this.db.query(
      `UPDATE user_sicil_summary
       SET rehabilitation_progress = $1, updated_at = NOW()
       WHERE server_id = $2 AND user_id = $3`,
      [progress, serverId, userId]
    );
  }

  /**
   * Add moderator note
   */
  async addModeratorNote(
    serverId: string,
    userId: string,
    moderatorId: string,
    note: string
  ): Promise<void> {
    const newNote = {
      timestamp: new Date(),
      moderator_id: moderatorId,
      note: note
    };

    await this.db.query(
      `UPDATE user_sicil_summary
       SET moderator_notes = moderator_notes || $1::jsonb,
           updated_at = NOW()
       WHERE server_id = $2 AND user_id = $3`,
      [JSON.stringify(newNote), serverId, userId]
    );
  }

  /**
   * Get users by risk category
   */
  async getUsersByRiskCategory(
    serverId: string,
    riskCategory: string
  ): Promise<UserSicilSummary[]> {
    return this.db.queryMany<UserSicilSummary>(
      `SELECT * FROM user_sicil_summary
       WHERE server_id = $1 AND risk_category = $2
       ORDER BY
         (total_warnings + total_timeouts + total_kicks + total_bans) DESC,
         last_violation_at DESC`,
      [serverId, riskCategory]
    );
  }

  /**
   * Get high-risk users
   */
  async getHighRiskUsers(serverId: string, limit: number = 50): Promise<UserSicilSummary[]> {
    return this.db.cached<UserSicilSummary[]>(
      `high_risk_users:${serverId}:${limit}`,
      300, // 5 minutes
      () => this.db.queryMany<UserSicilSummary>(
        `SELECT * FROM user_sicil_summary
         WHERE server_id = $1
           AND risk_category IN ('risky', 'dangerous')
         ORDER BY
           (total_warnings + total_timeouts + total_kicks + total_bans) DESC
         LIMIT $2`,
        [serverId, limit]
      )
    );
  }

  /**
   * Get users with clean streaks
   */
  async getUsersWithCleanStreaks(
    serverId: string,
    minDays: number = 30
  ): Promise<UserSicilSummary[]> {
    return this.db.queryMany<UserSicilSummary>(
      `SELECT * FROM user_sicil_summary
       WHERE server_id = $1 AND clean_streak_days >= $2
       ORDER BY clean_streak_days DESC`,
      [serverId, minDays]
    );
  }

  /**
   * Get sicil statistics
   */
  async getSicilStats(serverId: string): Promise<{
    totalUsers: number;
    safeUsers: number;
    watchUsers: number;
    riskyUsers: number;
    dangerousUsers: number;
    totalViolations: number;
    avgCleanStreak: number;
  }> {
    const stats = await this.db.queryOne<any>(
      `SELECT
         COUNT(*) as total_users,
         COUNT(*) FILTER (WHERE risk_category = 'safe') as safe_users,
         COUNT(*) FILTER (WHERE risk_category = 'watch') as watch_users,
         COUNT(*) FILTER (WHERE risk_category = 'risky') as risky_users,
         COUNT(*) FILTER (WHERE risk_category = 'dangerous') as dangerous_users,
         SUM(total_warnings + total_timeouts + total_kicks + total_bans) as total_violations,
         AVG(clean_streak_days) as avg_clean_streak
       FROM user_sicil_summary
       WHERE server_id = $1`,
      [serverId]
    );

    return {
      totalUsers: parseInt(stats?.total_users || '0'),
      safeUsers: parseInt(stats?.safe_users || '0'),
      watchUsers: parseInt(stats?.watch_users || '0'),
      riskyUsers: parseInt(stats?.risky_users || '0'),
      dangerousUsers: parseInt(stats?.dangerous_users || '0'),
      totalViolations: parseInt(stats?.total_violations || '0'),
      avgCleanStreak: parseFloat(stats?.avg_clean_streak || '0')
    };
  }

  /**
   * Update risk category based on violations
   */
  private async updateRiskCategory(
    serverId: string,
    userId: string,
    client?: any
  ): Promise<void> {
    const queryFn = client ? client.query.bind(client) : this.db.query.bind(this.db);

    // Calculate total violations
    const summary = await this.db.queryOne<UserSicilSummary>(
      'SELECT * FROM user_sicil_summary WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );

    if (!summary) return;

    const totalViolations =
      summary.total_warnings +
      summary.total_timeouts +
      summary.total_kicks +
      summary.total_bans;

    let riskCategory: string;
    if (totalViolations === 0 || summary.clean_streak_days >= 90) {
      riskCategory = 'safe';
    } else if (totalViolations <= 2 && summary.clean_streak_days >= 30) {
      riskCategory = 'watch';
    } else if (totalViolations <= 5) {
      riskCategory = 'risky';
    } else {
      riskCategory = 'dangerous';
    }

    await queryFn(
      'UPDATE user_sicil_summary SET risk_category = $1 WHERE server_id = $2 AND user_id = $3',
      [riskCategory, serverId, userId]
    );
  }

  /**
   * Get recent toxic/problematic users
   * 🔥 NEW: For AI bulk actions - "ban last 3 toxic users"
   * Uses Supabase REST API for maximum reliability
   */
  async getRecentToxicUsers(
    serverId: string,
    limit: number = 10,
    minToxicityViolations: number = 1
  ): Promise<Array<{
    userId: string;
    toxicityViolations: number;
    scamViolations: number;
    totalViolations: number;
    lastViolationAt: Date | null;
    riskCategory: string;
  }>> {
    try {
      // Use Supabase REST API (more reliable than PostgreSQL connection pool)
      const supabase = getSupabaseClient();

      const { data, error } = await supabase
        .from('user_sicil_summary')
        .select(`
          user_id,
          toxicity_violations,
          scam_violations,
          total_warnings,
          total_timeouts,
          total_kicks,
          total_bans,
          last_violation_at,
          risk_category
        `)
        .eq('server_id', serverId)
        .gte('toxicity_violations', minToxicityViolations)
        .not('last_violation_at', 'is', null)
        .order('last_violation_at', { ascending: false })
        .order('toxicity_violations', { ascending: false })
        .limit(limit);

      if (error) {
        logger.error('Failed to fetch toxic users from Supabase:', error);
        return [];
      }

      if (!data || data.length === 0) {
        logger.info(`No toxic users found in server ${serverId}`);
        return [];
      }

      return data.map(row => ({
        userId: row.user_id,
        toxicityViolations: row.toxicity_violations || 0,
        scamViolations: row.scam_violations || 0,
        totalViolations: (row.total_warnings || 0) + (row.total_timeouts || 0) + (row.total_kicks || 0) + (row.total_bans || 0),
        lastViolationAt: row.last_violation_at ? new Date(row.last_violation_at) : null,
        riskCategory: row.risk_category || 'unknown'
      }));
    } catch (error) {
      logger.error('Exception in getRecentToxicUsers:', error);
      return [];
    }
  }
}
