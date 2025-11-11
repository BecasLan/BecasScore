/**
 * MESSAGE REPOSITORY
 *
 * Handles message storage and conversation tracking
 */

import { DatabaseService, getDatabaseService } from '../DatabaseService';
import { createLogger } from '../../services/Logger';

const logger = createLogger('MessageRepository');

export interface Message {
  id: string;
  server_id: string;
  channel_id: string;
  user_id: string;
  content: string;
  content_length: number;
  type: string;
  is_edited: boolean;
  is_deleted: boolean;
  deleted_at?: Date;
  reply_to_message_id?: string;
  thread_id?: string;
  conversation_thread_id?: string;
  mentioned_user_ids: string[];
  mentioned_role_ids: string[];
  mentioned_everyone: boolean;
  has_attachments: boolean;
  attachment_count: number;
  attachment_types: string[];
  has_links: boolean;
  link_count: number;
  extracted_links: string[];
  intent?: string;
  sentiment?: string;
  emotions: string[];
  toxicity_score: number;
  scam_score: number;
  spam_score: number;
  harassment_score: number;
  ai_summary?: string;
  detected_topics: string[];
  language_detected: string;
  created_at: Date;
  edited_at?: Date;
  analyzed_at?: Date;
}

export interface ConversationThread {
  id: string;
  server_id: string;
  channel_id: string;
  initiator_user_id: string;
  participant_user_ids: string[];
  participant_count: number;
  topic?: string;
  detected_topics: string[];
  sentiment_flow: Array<{
    timestamp: Date;
    sentiment: string;
    user_id: string;
  }>;
  conflict_detected: boolean;
  conflict_severity?: string;
  conflict_participants: string[];
  ended_in_violation: boolean;
  violation_type?: string;
  moderator_intervened: boolean;
  moderator_id?: string;
  total_messages: number;
  avg_toxicity: number;
  peak_toxicity: number;
  duration_seconds: number;
  started_at: Date;
  ended_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export class MessageRepository {
  private db: DatabaseService;

  constructor(db?: DatabaseService) {
    this.db = db || getDatabaseService();
  }

  /**
   * Store message
   */
  async storeMessage(messageData: {
    id: string;
    server_id: string;
    channel_id: string;
    user_id: string;
    content: string;
    type?: string;
    reply_to_message_id?: string;
    mentioned_user_ids?: string[];
    mentioned_role_ids?: string[];
    mentioned_everyone?: boolean;
    has_attachments?: boolean;
    attachment_count?: number;
    attachment_types?: string[];
    has_links?: boolean;
    extracted_links?: string[];
    created_at?: Date;
  }): Promise<Message> {
    const data = {
      id: messageData.id,
      server_id: messageData.server_id,
      channel_id: messageData.channel_id,
      user_id: messageData.user_id,
      content: messageData.content,
      content_length: messageData.content.length,
      type: messageData.type || 'default',
      reply_to_message_id: messageData.reply_to_message_id,
      mentioned_user_ids: messageData.mentioned_user_ids || [],
      mentioned_role_ids: messageData.mentioned_role_ids || [],
      mentioned_everyone: messageData.mentioned_everyone || false,
      has_attachments: messageData.has_attachments || false,
      attachment_count: messageData.attachment_count || 0,
      attachment_types: messageData.attachment_types || [],
      has_links: messageData.has_links || false,
      link_count: messageData.extracted_links?.length || 0,
      extracted_links: messageData.extracted_links || [],
      created_at: messageData.created_at || new Date()
    };

    return this.db.insert<Message>('messages', data);
  }

  /**
   * Update message AI analysis
   */
  async updateMessageAnalysis(
    messageId: string,
    analysis: {
      intent?: string;
      sentiment?: string;
      emotions?: string[];
      toxicity_score?: number;
      scam_score?: number;
      spam_score?: number;
      harassment_score?: number;
      detected_topics?: string[];
      language_detected?: string;
      ai_summary?: string;
    }
  ): Promise<void> {
    await this.db.query(
      `UPDATE messages SET
        intent = COALESCE($1, intent),
        sentiment = COALESCE($2, sentiment),
        emotions = COALESCE($3, emotions),
        toxicity_score = COALESCE($4, toxicity_score),
        scam_score = COALESCE($5, scam_score),
        spam_score = COALESCE($6, spam_score),
        harassment_score = COALESCE($7, harassment_score),
        detected_topics = COALESCE($8, detected_topics),
        language_detected = COALESCE($9, language_detected),
        ai_summary = COALESCE($10, ai_summary),
        analyzed_at = NOW()
      WHERE id = $11`,
      [
        analysis.intent,
        analysis.sentiment,
        analysis.emotions,
        analysis.toxicity_score,
        analysis.scam_score,
        analysis.spam_score,
        analysis.harassment_score,
        analysis.detected_topics,
        analysis.language_detected,
        analysis.ai_summary,
        messageId
      ]
    );
  }

  /**
   * Mark message as edited
   */
  async markMessageEdited(messageId: string, newContent: string): Promise<void> {
    await this.db.query(
      `UPDATE messages SET
        content = $1,
        content_length = $2,
        is_edited = true,
        edited_at = NOW()
      WHERE id = $3`,
      [newContent, newContent.length, messageId]
    );
  }

  /**
   * Mark message as deleted
   */
  async markMessageDeleted(messageId: string): Promise<void> {
    await this.db.query(
      'UPDATE messages SET is_deleted = true, deleted_at = NOW() WHERE id = $1',
      [messageId]
    );
  }

  /**
   * Get message by ID
   */
  async getMessageById(messageId: string): Promise<Message | null> {
    return this.db.queryOne<Message>(
      'SELECT * FROM messages WHERE id = $1',
      [messageId]
    );
  }

  /**
   * Get channel messages
   */
  async getChannelMessages(
    channelId: string,
    limit: number = 100,
    before?: Date
  ): Promise<Message[]> {
    let sql = 'SELECT * FROM messages WHERE channel_id = $1';
    const params: any[] = [channelId];

    if (before) {
      sql += ' AND created_at < $2';
      params.push(before);
    }

    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    return this.db.queryMany<Message>(sql, params);
  }

  /**
   * Get user messages in server
   */
  async getUserMessages(
    serverId: string,
    userId: string,
    limit: number = 100
  ): Promise<Message[]> {
    return this.db.queryMany<Message>(
      `SELECT * FROM messages
       WHERE server_id = $1 AND user_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [serverId, userId, limit]
    );
  }

  /**
   * Search messages (full-text search)
   */
  async searchMessages(
    serverId: string,
    query: string,
    limit: number = 50
  ): Promise<Message[]> {
    return this.db.queryMany<Message>(
      `SELECT * FROM messages
       WHERE server_id = $1
         AND content_tsv @@ plainto_tsquery('english', $2)
       ORDER BY ts_rank(content_tsv, plainto_tsquery('english', $2)) DESC,
                created_at DESC
       LIMIT $3`,
      [serverId, query, limit]
    );
  }

  /**
   * Get toxic messages
   */
  async getToxicMessages(
    serverId: string,
    minToxicity: number = 70,
    limit: number = 100
  ): Promise<Message[]> {
    return this.db.queryMany<Message>(
      `SELECT * FROM messages
       WHERE server_id = $1 AND toxicity_score >= $2
       ORDER BY toxicity_score DESC, created_at DESC
       LIMIT $3`,
      [serverId, minToxicity, limit]
    );
  }

  /**
   * Create conversation thread
   */
  async createConversationThread(threadData: {
    server_id: string;
    channel_id: string;
    initiator_user_id: string;
    participant_user_ids?: string[];
  }): Promise<ConversationThread> {
    const data = {
      server_id: threadData.server_id,
      channel_id: threadData.channel_id,
      initiator_user_id: threadData.initiator_user_id,
      participant_user_ids: threadData.participant_user_ids || [threadData.initiator_user_id],
      participant_count: (threadData.participant_user_ids || []).length,
      started_at: new Date()
    };

    return this.db.insert<ConversationThread>('conversation_threads', data);
  }

  /**
   * Update conversation thread
   */
  async updateConversationThread(
    threadId: string,
    updates: {
      topic?: string;
      detected_topics?: string[];
      participant_user_ids?: string[];
      conflict_detected?: boolean;
      conflict_severity?: string;
      moderator_intervened?: boolean;
      moderator_id?: string;
      ended_in_violation?: boolean;
      violation_type?: string;
    }
  ): Promise<void> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        updateFields.push(`${key} = $${paramIndex++}`);
        values.push(value);
      }
    });

    if (updateFields.length === 0) return;

    values.push(threadId);

    await this.db.query(
      `UPDATE conversation_threads
       SET ${updateFields.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}`,
      values
    );
  }

  /**
   * End conversation thread
   */
  async endConversationThread(
    threadId: string,
    totalMessages: number,
    avgToxicity: number,
    peakToxicity: number
  ): Promise<void> {
    const thread = await this.db.queryOne<ConversationThread>(
      'SELECT * FROM conversation_threads WHERE id = $1',
      [threadId]
    );

    if (!thread) return;

    const durationSeconds = Math.floor(
      (Date.now() - new Date(thread.started_at).getTime()) / 1000
    );

    await this.db.query(
      `UPDATE conversation_threads
       SET ended_at = NOW(),
           total_messages = $1,
           avg_toxicity = $2,
           peak_toxicity = $3,
           duration_seconds = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [totalMessages, avgToxicity, peakToxicity, durationSeconds, threadId]
    );
  }

  /**
   * Get active conversations
   */
  async getActiveConversations(serverId: string): Promise<ConversationThread[]> {
    return this.db.queryMany<ConversationThread>(
      `SELECT * FROM conversation_threads
       WHERE server_id = $1 AND ended_at IS NULL
       ORDER BY started_at DESC`,
      [serverId]
    );
  }

  /**
   * Get toxic conversations
   */
  async getToxicConversations(
    serverId: string,
    minToxicity: number = 50
  ): Promise<ConversationThread[]> {
    return this.db.queryMany<ConversationThread>(
      `SELECT * FROM conversation_threads
       WHERE server_id = $1
         AND (conflict_detected = true OR avg_toxicity >= $2)
       ORDER BY avg_toxicity DESC, started_at DESC
       LIMIT 50`,
      [serverId, minToxicity]
    );
  }

  /**
   * Get message statistics
   */
  async getMessageStats(serverId: string, days: number = 7): Promise<{
    totalMessages: number;
    avgToxicity: number;
    toxicMessages: number;
    scamMessages: number;
    deletedMessages: number;
    editedMessages: number;
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const stats = await this.db.queryOne<any>(
      `SELECT
         COUNT(*) as total_messages,
         AVG(toxicity_score) as avg_toxicity,
         COUNT(*) FILTER (WHERE toxicity_score >= 70) as toxic_messages,
         COUNT(*) FILTER (WHERE scam_score >= 70) as scam_messages,
         COUNT(*) FILTER (WHERE is_deleted = true) as deleted_messages,
         COUNT(*) FILTER (WHERE is_edited = true) as edited_messages
       FROM messages
       WHERE server_id = $1 AND created_at >= $2`,
      [serverId, since]
    );

    return {
      totalMessages: parseInt(stats?.total_messages || '0'),
      avgToxicity: parseFloat(stats?.avg_toxicity || '0'),
      toxicMessages: parseInt(stats?.toxic_messages || '0'),
      scamMessages: parseInt(stats?.scam_messages || '0'),
      deletedMessages: parseInt(stats?.deleted_messages || '0'),
      editedMessages: parseInt(stats?.edited_messages || '0')
    };
  }
}
