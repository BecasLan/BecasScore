/**
 * SERVER REPOSITORY
 *
 * Handles server (guild) and channel database operations
 */

import { DatabaseService, getDatabaseService } from '../DatabaseService';
import { createLogger } from '../../services/Logger';

const logger = createLogger('ServerRepository');

export interface Server {
  id: string;
  name: string;
  icon_url?: string;
  owner_id: string;
  member_count: number;
  config: Record<string, any>;
  features: string[];
  joined_at: Date;
  created_at: Date;
  updated_at: Date;
  total_messages_processed: number;
  total_violations_detected: number;
  total_moderations_taken: number;
}

export interface Channel {
  id: string;
  server_id: string;
  name: string;
  type: string;
  topic?: string;
  primary_topics: string[];
  activity_level: 'low' | 'normal' | 'high' | 'very_high';
  avg_messages_per_day: number;
  is_monitored: boolean;
  slowmode_seconds: number;
  created_at: Date;
  updated_at: Date;
  last_message_at?: Date;
  total_messages: number;
  total_violations: number;
}

export class ServerRepository {
  private db: DatabaseService;

  constructor(db?: DatabaseService) {
    this.db = db || getDatabaseService();
  }

  /**
   * Create or update server
   */
  async upsertServer(serverData: {
    id: string;
    name: string;
    icon_url?: string;
    owner_id: string;
    member_count: number;
    config?: Record<string, any>;
    features?: string[];
  }): Promise<Server> {
    const data = {
      id: serverData.id,
      name: serverData.name,
      icon_url: serverData.icon_url,
      owner_id: serverData.owner_id,
      member_count: serverData.member_count,
      config: serverData.config || {},
      features: serverData.features || []
    };

    return this.db.upsert<Server>(
      'servers',
      data,
      ['id'],
      ['name', 'icon_url', 'owner_id', 'member_count', 'config', 'features']
    );
  }

  /**
   * Get server by ID
   */
  async getServerById(serverId: string): Promise<Server | null> {
    return this.db.cached<Server | null>(
      `server:${serverId}`,
      300, // 5 minutes
      () => this.db.queryOne<Server>(
        'SELECT * FROM servers WHERE id = $1',
        [serverId]
      )
    );
  }

  /**
   * Get all servers
   */
  async getAllServers(): Promise<Server[]> {
    return this.db.cached<Server[]>(
      'servers:all',
      600, // 10 minutes
      () => this.db.queryMany<Server>(
        'SELECT * FROM servers ORDER BY joined_at DESC'
      )
    );
  }

  /**
   * Update server config
   */
  async updateServerConfig(serverId: string, config: Record<string, any>): Promise<void> {
    await this.db.query(
      'UPDATE servers SET config = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(config), serverId]
    );

    await this.db.invalidateCache(`server:${serverId}`);
  }

  /**
   * Increment message counter
   */
  async incrementMessageCount(serverId: string): Promise<void> {
    await this.db.query(
      'UPDATE servers SET total_messages_processed = total_messages_processed + 1 WHERE id = $1',
      [serverId]
    );
  }

  /**
   * Increment violation counter
   */
  async incrementViolationCount(serverId: string): Promise<void> {
    await this.db.query(
      'UPDATE servers SET total_violations_detected = total_violations_detected + 1 WHERE id = $1',
      [serverId]
    );
  }

  /**
   * Increment moderation counter
   */
  async incrementModerationCount(serverId: string): Promise<void> {
    await this.db.query(
      'UPDATE servers SET total_moderations_taken = total_moderations_taken + 1 WHERE id = $1',
      [serverId]
    );
  }

  /**
   * Create or update channel
   */
  async upsertChannel(channelData: {
    id: string;
    server_id: string;
    name: string;
    type: string;
    topic?: string;
  }): Promise<Channel> {
    const data = {
      id: channelData.id,
      server_id: channelData.server_id,
      name: channelData.name,
      type: channelData.type,
      topic: channelData.topic
    };

    return this.db.upsert<Channel>(
      'channels',
      data,
      ['id'],
      ['name', 'type', 'topic']
    );
  }

  /**
   * Get channel by ID
   */
  async getChannelById(channelId: string): Promise<Channel | null> {
    return this.db.queryOne<Channel>(
      'SELECT * FROM channels WHERE id = $1',
      [channelId]
    );
  }

  /**
   * Get server channels
   */
  async getServerChannels(serverId: string): Promise<Channel[]> {
    return this.db.cached<Channel[]>(
      `server_channels:${serverId}`,
      300, // 5 minutes
      () => this.db.queryMany<Channel>(
        'SELECT * FROM channels WHERE server_id = $1 ORDER BY name',
        [serverId]
      )
    );
  }

  /**
   * Update channel activity
   */
  async updateChannelActivity(channelId: string): Promise<void> {
    await this.db.query(
      `UPDATE channels SET
        total_messages = total_messages + 1,
        last_message_at = NOW(),
        updated_at = NOW()
      WHERE id = $1`,
      [channelId]
    );
  }

  /**
   * Update channel topics
   */
  async updateChannelTopics(channelId: string, topics: string[]): Promise<void> {
    await this.db.query(
      'UPDATE channels SET primary_topics = $1, updated_at = NOW() WHERE id = $2',
      [topics, channelId]
    );
  }

  /**
   * Get most active channels
   */
  async getMostActiveChannels(serverId: string, limit: number = 10): Promise<Channel[]> {
    return this.db.queryMany<Channel>(
      `SELECT * FROM channels
       WHERE server_id = $1
       ORDER BY total_messages DESC, last_message_at DESC
       LIMIT $2`,
      [serverId, limit]
    );
  }

  /**
   * Get server statistics
   */
  async getServerStats(serverId: string): Promise<{
    totalMembers: number;
    totalMessages: number;
    totalViolations: number;
    violationRate: number;
    activeChannels: number;
  }> {
    const server = await this.getServerById(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    const channelCount = await this.db.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM channels WHERE server_id = $1',
      [serverId]
    );

    const violationRate = server.total_messages_processed > 0
      ? (server.total_violations_detected / server.total_messages_processed) * 100
      : 0;

    return {
      totalMembers: server.member_count,
      totalMessages: server.total_messages_processed,
      totalViolations: server.total_violations_detected,
      violationRate: Math.round(violationRate * 100) / 100,
      activeChannels: parseInt(channelCount?.count || '0')
    };
  }
}
