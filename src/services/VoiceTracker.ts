import { Client, VoiceState } from 'discord.js';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';

/**
 * VoiceTracker
 *
 * Tracks voice activity across Discord servers:
 * - Voice channel joins/leaves
 * - Session durations
 * - Co-participants tracking
 * - Voice patterns analysis
 * - Channel analytics
 *
 * Integrates with social graph for relationship building.
 */

export interface VoiceSession {
  sessionId: string;
  serverId: string;
  channelId: string;
  userId: string;
  joinedAt: Date;
  leftAt?: Date;
  sessionDuration?: number;
  wasMuted: boolean;
  wasDeafened: boolean;
  wasStreaming: boolean;
  wasVideo: boolean;
  disconnectReason?: string;
}

export interface VoicePattern {
  serverId: string;
  userId: string;
  totalSessions: number;
  totalVoiceTime: number;
  avgSessionDuration: number;
  longestSessionDuration: number;
  sessionsLast30d: number;
  voiceTimeLast30d: number;
  favoriteChannels: Array<{ channelId: string; sessionCount: number }>;
  frequentPartners: Array<{ userId: string; sessionsTogether: number; totalTime: number }>;
  typicalJoinHours: number[];
  muteRate: number;
  streamingRate: number;
  firstVoiceSession?: Date;
  lastVoiceSession?: Date;
}

export class VoiceTracker {
  private activeSessions: Map<string, VoiceSession> = new Map();

  constructor(
    private client: Client,
    private db: Pool
  ) {}

  /**
   * Initialize voice tracking
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Voice Tracker...');

      // Load active sessions from database (in case of restart)
      await this.loadActiveSessions();

      // Set up event listeners
      this.setupEventListeners();

      logger.info('✓ Voice Tracker initialized');
    } catch (error) {
      logger.error('Failed to initialize Voice Tracker:', error);
      throw error;
    }
  }

  /**
   * Load active sessions from database
   */
  private async loadActiveSessions(): Promise<void> {
    try {
      const query = `
        SELECT session_id, server_id, channel_id, user_id, joined_at,
               was_muted, was_deafened, was_streaming, was_video
        FROM voice_sessions
        WHERE left_at IS NULL
      `;

      const result = await this.db.query(query);

      for (const row of result.rows) {
        const key = `${row.server_id}-${row.user_id}`;
        this.activeSessions.set(key, {
          sessionId: row.session_id,
          serverId: row.server_id,
          channelId: row.channel_id,
          userId: row.user_id,
          joinedAt: new Date(row.joined_at),
          wasMuted: row.was_muted,
          wasDeafened: row.was_deafened,
          wasStreaming: row.was_streaming,
          wasVideo: row.was_video
        });
      }

      logger.info(`Loaded ${this.activeSessions.size} active voice sessions`);
    } catch (error) {
      logger.error('Error loading active sessions:', error);
    }
  }

  /**
   * Set up Discord voice event listeners
   */
  private setupEventListeners(): void {
    this.client.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
      try {
        await this.handleVoiceStateUpdate(oldState, newState);
      } catch (error) {
        logger.error('Error handling voice state update:', error);
      }
    });
  }

  /**
   * Handle voice state updates
   */
  private async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const userId = newState.id;
    const serverId = newState.guild.id;
    const key = `${serverId}-${userId}`;

    // User joined a voice channel
    if (!oldState.channel && newState.channel) {
      await this.handleVoiceJoin(newState);
    }

    // User left a voice channel
    else if (oldState.channel && !newState.channel) {
      await this.handleVoiceLeave(oldState, 'user_leave');
    }

    // User moved to a different channel
    else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
      await this.handleVoiceLeave(oldState, 'moved');
      await this.handleVoiceJoin(newState);
    }

    // User's voice state changed (mute, deafen, streaming, video)
    else if (oldState.channel && newState.channel) {
      await this.handleVoiceStateChange(newState);
    }
  }

  /**
   * Handle user joining voice channel
   */
  private async handleVoiceJoin(state: VoiceState): Promise<void> {
    if (!state.channel) return;

    const serverId = state.guild.id;
    const channelId = state.channel.id;
    const userId = state.id;
    const key = `${serverId}-${userId}`;

    const sessionId = uuidv4();
    const joinedAt = new Date();

    const session: VoiceSession = {
      sessionId,
      serverId,
      channelId,
      userId,
      joinedAt,
      wasMuted: state.mute || state.selfMute,
      wasDeafened: state.deaf || state.selfDeaf,
      wasStreaming: state.streaming || false,
      wasVideo: state.selfVideo || false
    };

    // Store in memory
    this.activeSessions.set(key, session);

    // Store in database
    try {
      const query = `
        INSERT INTO voice_sessions
        (session_id, server_id, channel_id, user_id, joined_at, was_muted, was_deafened, was_streaming, was_video)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;

      await this.db.query(query, [
        sessionId,
        serverId,
        channelId,
        userId,
        joinedAt,
        session.wasMuted,
        session.wasDeafened,
        session.wasStreaming,
        session.wasVideo
      ]);

      // Track co-participants
      await this.trackCoParticipants(sessionId, serverId, channelId, userId, state.channel);

      logger.debug(`Voice join: ${userId} joined ${channelId} in ${serverId}`);
    } catch (error) {
      logger.error('Error logging voice join:', error);
    }
  }

  /**
   * Handle user leaving voice channel
   */
  private async handleVoiceLeave(state: VoiceState, reason: string): Promise<void> {
    if (!state.channel) return;

    const serverId = state.guild.id;
    const userId = state.id;
    const key = `${serverId}-${userId}`;

    const session = this.activeSessions.get(key);
    if (!session) {
      logger.warn(`No active session found for ${userId} in ${serverId}`);
      return;
    }

    const leftAt = new Date();

    // Update in database
    try {
      const query = `
        UPDATE voice_sessions
        SET left_at = $1, disconnect_reason = $2
        WHERE session_id = $3
      `;

      await this.db.query(query, [leftAt, reason, session.sessionId]);

      // End co-participant tracking
      await this.endCoParticipantTracking(session.sessionId, leftAt);

      // Remove from active sessions
      this.activeSessions.delete(key);

      logger.debug(`Voice leave: ${userId} left ${state.channel.id} (${reason})`);
    } catch (error) {
      logger.error('Error logging voice leave:', error);
    }
  }

  /**
   * Handle voice state changes (mute, deafen, streaming, video)
   */
  private async handleVoiceStateChange(state: VoiceState): Promise<void> {
    if (!state.channel) return;

    const serverId = state.guild.id;
    const userId = state.id;
    const key = `${serverId}-${userId}`;

    const session = this.activeSessions.get(key);
    if (!session) return;

    // Update session state
    session.wasMuted = session.wasMuted || state.mute || state.selfMute;
    session.wasDeafened = session.wasDeafened || state.deaf || state.selfDeaf;
    session.wasStreaming = session.wasStreaming || state.streaming || false;
    session.wasVideo = session.wasVideo || state.selfVideo || false;

    // Update in memory
    this.activeSessions.set(key, session);

    // Update in database
    try {
      const query = `
        UPDATE voice_sessions
        SET was_muted = $1, was_deafened = $2, was_streaming = $3, was_video = $4
        WHERE session_id = $5
      `;

      await this.db.query(query, [
        session.wasMuted,
        session.wasDeafened,
        session.wasStreaming,
        session.wasVideo,
        session.sessionId
      ]);
    } catch (error) {
      logger.error('Error updating voice state:', error);
    }
  }

  /**
   * Track co-participants in voice channel
   */
  private async trackCoParticipants(
    sessionId: string,
    serverId: string,
    channelId: string,
    userId: string,
    channel: any
  ): Promise<void> {
    try {
      const overlapStart = new Date();

      // Get all members currently in the channel
      const participants = channel.members.filter((m: any) => m.id !== userId);

      for (const participant of participants.values()) {
        const query = `
          INSERT INTO voice_participants
          (session_id, user_id, participant_id, server_id, channel_id, overlap_start)
          VALUES ($1, $2, $3, $4, $5, $6)
        `;

        await this.db.query(query, [
          sessionId,
          userId,
          participant.id,
          serverId,
          channelId,
          overlapStart
        ]);
      }
    } catch (error) {
      logger.error('Error tracking co-participants:', error);
    }
  }

  /**
   * End co-participant tracking when user leaves
   */
  private async endCoParticipantTracking(sessionId: string, endTime: Date): Promise<void> {
    try {
      const query = `
        UPDATE voice_participants
        SET overlap_end = $1,
            overlap_duration = EXTRACT(EPOCH FROM ($1 - overlap_start))::INTEGER
        WHERE session_id = $2 AND overlap_end IS NULL
      `;

      await this.db.query(query, [endTime, sessionId]);
    } catch (error) {
      logger.error('Error ending co-participant tracking:', error);
    }
  }

  /**
   * Get voice pattern for a user
   */
  async getUserVoicePattern(serverId: string, userId: string): Promise<VoicePattern | null> {
    try {
      const query = `
        SELECT * FROM user_voice_patterns
        WHERE server_id = $1 AND user_id = $2
      `;

      const result = await this.db.query(query, [serverId, userId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        serverId: row.server_id,
        userId: row.user_id,
        totalSessions: row.total_sessions,
        totalVoiceTime: row.total_voice_time,
        avgSessionDuration: row.avg_session_duration,
        longestSessionDuration: row.longest_session_duration,
        sessionsLast30d: row.sessions_last_30d,
        voiceTimeLast30d: row.voice_time_last_30d,
        favoriteChannels: row.favorite_channels || [],
        frequentPartners: row.frequent_partners || [],
        typicalJoinHours: row.typical_join_hours || [],
        muteRate: parseFloat(row.mute_rate),
        streamingRate: parseFloat(row.streaming_rate),
        firstVoiceSession: row.first_voice_session ? new Date(row.first_voice_session) : undefined,
        lastVoiceSession: row.last_voice_session ? new Date(row.last_voice_session) : undefined
      };
    } catch (error) {
      logger.error('Error getting user voice pattern:', error);
      return null;
    }
  }

  /**
   * Get voice partners for a user
   */
  async getVoicePartners(serverId: string, userId: string, limit: number = 10): Promise<Array<{
    userId: string;
    sessionsTogether: number;
    totalTime: number;
  }>> {
    try {
      const query = `
        SELECT
          participant_id as user_id,
          COUNT(*) as sessions_together,
          SUM(overlap_duration) as total_time
        FROM voice_participants
        WHERE user_id = $1 AND server_id = $2
        GROUP BY participant_id
        ORDER BY sessions_together DESC, total_time DESC
        LIMIT $3
      `;

      const result = await this.db.query(query, [userId, serverId, limit]);

      return result.rows.map(row => ({
        userId: row.user_id,
        sessionsTogether: parseInt(row.sessions_together),
        totalTime: parseInt(row.total_time) || 0
      }));
    } catch (error) {
      logger.error('Error getting voice partners:', error);
      return [];
    }
  }

  /**
   * Get currently active voice users in server
   */
  async getActiveVoiceUsers(serverId: string): Promise<Array<{
    userId: string;
    channelId: string;
    joinedAt: Date;
    duration: number;
  }>> {
    try {
      const query = `
        SELECT
          user_id,
          channel_id,
          joined_at,
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - joined_at))::INTEGER as duration
        FROM voice_sessions
        WHERE server_id = $1 AND left_at IS NULL
        ORDER BY joined_at DESC
      `;

      const result = await this.db.query(query, [serverId]);

      return result.rows.map(row => ({
        userId: row.user_id,
        channelId: row.channel_id,
        joinedAt: new Date(row.joined_at),
        duration: parseInt(row.duration)
      }));
    } catch (error) {
      logger.error('Error getting active voice users:', error);
      return [];
    }
  }

  /**
   * Get channel analytics
   */
  async getChannelAnalytics(serverId: string, channelId: string): Promise<{
    totalSessions: number;
    uniqueUsers: number;
    totalVoiceTime: number;
    avgParticipants: number;
    peakParticipants: number;
    sessionsLast7d: number;
    sessionsLast30d: number;
    peakHours: Array<{ hour: number; sessionCount: number }>;
  } | null> {
    try {
      const query = `
        SELECT * FROM voice_channel_analytics
        WHERE server_id = $1 AND channel_id = $2
      `;

      const result = await this.db.query(query, [serverId, channelId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        totalSessions: row.total_sessions,
        uniqueUsers: row.unique_users_count,
        totalVoiceTime: row.total_voice_time,
        avgParticipants: parseFloat(row.avg_participants),
        peakParticipants: row.peak_participants,
        sessionsLast7d: row.sessions_last_7d,
        sessionsLast30d: row.sessions_last_30d,
        peakHours: row.peak_hours || []
      };
    } catch (error) {
      logger.error('Error getting channel analytics:', error);
      return null;
    }
  }

  /**
   * Get user's recent voice sessions
   */
  async getUserRecentSessions(
    serverId: string,
    userId: string,
    limit: number = 20
  ): Promise<VoiceSession[]> {
    try {
      const query = `
        SELECT * FROM voice_sessions
        WHERE server_id = $1 AND user_id = $2
        ORDER BY joined_at DESC
        LIMIT $3
      `;

      const result = await this.db.query(query, [serverId, userId, limit]);

      return result.rows.map(row => ({
        sessionId: row.session_id,
        serverId: row.server_id,
        channelId: row.channel_id,
        userId: row.user_id,
        joinedAt: new Date(row.joined_at),
        leftAt: row.left_at ? new Date(row.left_at) : undefined,
        sessionDuration: row.session_duration,
        wasMuted: row.was_muted,
        wasDeafened: row.was_deafened,
        wasStreaming: row.was_streaming,
        wasVideo: row.was_video,
        disconnectReason: row.disconnect_reason
      }));
    } catch (error) {
      logger.error('Error getting user recent sessions:', error);
      return [];
    }
  }

  /**
   * Update voice patterns analytics (run periodically)
   */
  async updateVoicePatternAnalytics(serverId: string, userId: string): Promise<void> {
    try {
      // Get user's sessions from last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Update sessions last 30d
      const sessionsQuery = `
        SELECT COUNT(*) as count, SUM(session_duration) as total_time
        FROM voice_sessions
        WHERE server_id = $1 AND user_id = $2 AND joined_at >= $3
      `;

      const sessionsResult = await this.db.query(sessionsQuery, [serverId, userId, thirtyDaysAgo]);
      const sessions30d = parseInt(sessionsResult.rows[0].count);
      const voiceTime30d = parseInt(sessionsResult.rows[0].total_time) || 0;

      // Get favorite channels
      const channelsQuery = `
        SELECT channel_id, COUNT(*) as session_count
        FROM voice_sessions
        WHERE server_id = $1 AND user_id = $2
        GROUP BY channel_id
        ORDER BY session_count DESC
        LIMIT 5
      `;

      const channelsResult = await this.db.query(channelsQuery, [serverId, userId]);
      const favoriteChannels = channelsResult.rows.map(row => ({
        channelId: row.channel_id,
        sessionCount: parseInt(row.session_count)
      }));

      // Get frequent partners
      const partners = await this.getVoicePartners(serverId, userId, 5);

      // Get typical join hours
      const hoursQuery = `
        SELECT EXTRACT(HOUR FROM joined_at) as hour, COUNT(*) as count
        FROM voice_sessions
        WHERE server_id = $1 AND user_id = $2
        GROUP BY hour
        HAVING COUNT(*) > 2
        ORDER BY count DESC
      `;

      const hoursResult = await this.db.query(hoursQuery, [serverId, userId]);
      const typicalJoinHours = hoursResult.rows.map(row => parseInt(row.hour));

      // Update user voice patterns
      const updateQuery = `
        UPDATE user_voice_patterns
        SET
          sessions_last_30d = $1,
          voice_time_last_30d = $2,
          favorite_channels = $3,
          frequent_partners = $4,
          typical_join_hours = $5,
          updated_at = CURRENT_TIMESTAMP
        WHERE server_id = $6 AND user_id = $7
      `;

      await this.db.query(updateQuery, [
        sessions30d,
        voiceTime30d,
        JSON.stringify(favoriteChannels),
        JSON.stringify(partners),
        JSON.stringify(typicalJoinHours),
        serverId,
        userId
      ]);

      logger.debug(`Updated voice patterns for user ${userId}`);
    } catch (error) {
      logger.error('Error updating voice pattern analytics:', error);
    }
  }
}

/**
 * Example usage:
 *
 * const voiceTracker = new VoiceTracker(discordClient, db);
 * await voiceTracker.initialize();
 *
 * // Get user's voice pattern
 * const pattern = await voiceTracker.getUserVoicePattern(serverId, userId);
 * console.log(`Total voice time: ${pattern.totalVoiceTime} seconds`);
 *
 * // Get voice partners
 * const partners = await voiceTracker.getVoicePartners(serverId, userId);
 * console.log('Frequent voice partners:', partners);
 *
 * // Get currently active users in voice
 * const activeUsers = await voiceTracker.getActiveVoiceUsers(serverId);
 * console.log(`${activeUsers.length} users currently in voice`);
 */
