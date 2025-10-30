import { Pool } from 'pg';
import logger from '../utils/logger';

/**
 * SavedQueriesManager
 *
 * Allows moderators to save frequently used queries and reuse them with parameters.
 *
 * Features:
 * - Save queries with custom names
 * - Query templates with variables (e.g., {{timeframe}}, {{user_id}})
 * - Share queries between moderators
 * - Tag and categorize queries
 * - Version history
 */

export interface SavedQuery {
  id: string;
  serverId: string;
  createdBy: string;
  name: string;
  description?: string;
  question: string; // Natural language question template
  sql?: string; // Pre-generated SQL (optional)
  parameters: QueryParameter[];
  category?: string;
  tags: string[];
  isPublic: boolean; // Shared with all mods
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface QueryParameter {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'user_id';
  description?: string;
  defaultValue?: any;
  required: boolean;
}

export interface QueryTemplate {
  id: string;
  name: string;
  description: string;
  question: string;
  parameters: QueryParameter[];
  category: string;
}

export class SavedQueriesManager {
  private db: Pool;

  // Built-in query templates
  private readonly TEMPLATES: QueryTemplate[] = [
    {
      id: 'bans-today',
      name: 'Bans Today',
      description: 'Count bans issued today',
      question: 'How many bans were issued today?',
      parameters: [],
      category: 'moderation'
    },
    {
      id: 'user-violations',
      name: 'User Violations',
      description: 'Get all violations for a specific user',
      question: 'Show all violations for user {{user_id}}',
      parameters: [
        { name: 'user_id', type: 'user_id', description: 'Discord User ID', required: true }
      ],
      category: 'user'
    },
    {
      id: 'toxic-users',
      name: 'Toxic Users',
      description: 'Find users with toxicity violations',
      question: 'Show users with more than {{min_count}} toxicity violations',
      parameters: [
        { name: 'min_count', type: 'number', description: 'Minimum violation count', defaultValue: 3, required: false }
      ],
      category: 'analysis'
    },
    {
      id: 'low-trust-users',
      name: 'Low Trust Users',
      description: 'Find users with low trust scores',
      question: 'Show users with trust score below {{threshold}}',
      parameters: [
        { name: 'threshold', type: 'number', description: 'Trust score threshold', defaultValue: 20, required: false }
      ],
      category: 'analysis'
    },
    {
      id: 'recent-actions',
      name: 'Recent Moderation Actions',
      description: 'Show recent moderation actions',
      question: 'Show moderation actions in the last {{days}} days',
      parameters: [
        { name: 'days', type: 'number', description: 'Number of days', defaultValue: 7, required: false }
      ],
      category: 'moderation'
    },
    {
      id: 'user-messages',
      name: 'User Message Search',
      description: 'Search messages from a user',
      question: 'Show messages from {{user_id}} containing "{{keyword}}"',
      parameters: [
        { name: 'user_id', type: 'user_id', description: 'Discord User ID', required: true },
        { name: 'keyword', type: 'string', description: 'Search keyword', required: true }
      ],
      category: 'search'
    }
  ];

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Initialize database tables
   */
  async initialize(): Promise<void> {
    await this.createTables();
    logger.info('SavedQueriesManager initialized');
  }

  /**
   * Create saved queries table
   */
  private async createTables(): Promise<void> {
    const createSavedQueriesTable = `
      CREATE TABLE IF NOT EXISTS saved_queries (
        id VARCHAR(255) PRIMARY KEY,
        server_id VARCHAR(255) NOT NULL,
        created_by VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        question TEXT NOT NULL,
        sql TEXT,
        parameters JSONB,
        category VARCHAR(100),
        tags JSONB,
        is_public BOOLEAN DEFAULT false,
        usage_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_server_queries (server_id, is_public)
      );
    `;

    await this.db.query(createSavedQueriesTable);
    logger.info('Saved queries table created');
  }

  /**
   * Save a new query
   */
  async saveQuery(
    serverId: string,
    userId: string,
    name: string,
    question: string,
    options?: {
      description?: string;
      sql?: string;
      parameters?: QueryParameter[];
      category?: string;
      tags?: string[];
      isPublic?: boolean;
    }
  ): Promise<SavedQuery> {
    const id = `query-${serverId}-${Date.now()}`;

    const query = `
      INSERT INTO saved_queries
      (id, server_id, created_by, name, description, question, sql, parameters, category, tags, is_public, usage_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

    const result = await this.db.query(query, [
      id,
      serverId,
      userId,
      name,
      options?.description || null,
      question,
      options?.sql || null,
      JSON.stringify(options?.parameters || []),
      options?.category || 'custom',
      JSON.stringify(options?.tags || []),
      options?.isPublic || false,
      0
    ]);

    logger.info(`Saved query "${name}" (${id}) for server ${serverId}`);

    return this.rowToSavedQuery(result.rows[0]);
  }

  /**
   * Get saved query by ID
   */
  async getQuery(queryId: string, serverId: string): Promise<SavedQuery | null> {
    const query = `
      SELECT * FROM saved_queries
      WHERE id = $1 AND server_id = $2
    `;

    const result = await this.db.query(query, [queryId, serverId]);

    if (result.rows.length === 0) return null;

    return this.rowToSavedQuery(result.rows[0]);
  }

  /**
   * Get all saved queries for a server
   */
  async getServerQueries(serverId: string, userId?: string): Promise<SavedQuery[]> {
    let query;
    let params;

    if (userId) {
      // Get user's own queries + public queries
      query = `
        SELECT * FROM saved_queries
        WHERE server_id = $1 AND (created_by = $2 OR is_public = true)
        ORDER BY usage_count DESC, created_at DESC
      `;
      params = [serverId, userId];
    } else {
      // Get all public queries
      query = `
        SELECT * FROM saved_queries
        WHERE server_id = $1 AND is_public = true
        ORDER BY usage_count DESC, created_at DESC
      `;
      params = [serverId];
    }

    const result = await this.db.query(query, params);

    return result.rows.map(row => this.rowToSavedQuery(row));
  }

  /**
   * Get queries by category
   */
  async getQueriesByCategory(serverId: string, category: string): Promise<SavedQuery[]> {
    const query = `
      SELECT * FROM saved_queries
      WHERE server_id = $1 AND category = $2 AND is_public = true
      ORDER BY usage_count DESC
    `;

    const result = await this.db.query(query, [serverId, category]);

    return result.rows.map(row => this.rowToSavedQuery(row));
  }

  /**
   * Search saved queries
   */
  async searchQueries(serverId: string, searchTerm: string): Promise<SavedQuery[]> {
    const query = `
      SELECT * FROM saved_queries
      WHERE server_id = $1 AND is_public = true
      AND (name ILIKE $2 OR description ILIKE $2 OR question ILIKE $2)
      ORDER BY usage_count DESC
      LIMIT 20
    `;

    const result = await this.db.query(query, [serverId, `%${searchTerm}%`]);

    return result.rows.map(row => this.rowToSavedQuery(row));
  }

  /**
   * Update saved query
   */
  async updateQuery(
    queryId: string,
    serverId: string,
    updates: {
      name?: string;
      description?: string;
      question?: string;
      sql?: string;
      parameters?: QueryParameter[];
      category?: string;
      tags?: string[];
      isPublic?: boolean;
    }
  ): Promise<SavedQuery> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.question !== undefined) {
      fields.push(`question = $${paramIndex++}`);
      values.push(updates.question);
    }
    if (updates.sql !== undefined) {
      fields.push(`sql = $${paramIndex++}`);
      values.push(updates.sql);
    }
    if (updates.parameters !== undefined) {
      fields.push(`parameters = $${paramIndex++}`);
      values.push(JSON.stringify(updates.parameters));
    }
    if (updates.category !== undefined) {
      fields.push(`category = $${paramIndex++}`);
      values.push(updates.category);
    }
    if (updates.tags !== undefined) {
      fields.push(`tags = $${paramIndex++}`);
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.isPublic !== undefined) {
      fields.push(`is_public = $${paramIndex++}`);
      values.push(updates.isPublic);
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(queryId, serverId);

    const query = `
      UPDATE saved_queries
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex} AND server_id = $${paramIndex + 1}
      RETURNING *
    `;

    const result = await this.db.query(query, values);

    logger.info(`Updated saved query ${queryId}`);

    return this.rowToSavedQuery(result.rows[0]);
  }

  /**
   * Delete saved query
   */
  async deleteQuery(queryId: string, serverId: string): Promise<boolean> {
    const query = `
      DELETE FROM saved_queries
      WHERE id = $1 AND server_id = $2
    `;

    const result = await this.db.query(query, [queryId, serverId]);

    logger.info(`Deleted saved query ${queryId}`);

    return (result.rowCount || 0) > 0;
  }

  /**
   * Increment usage count
   */
  async incrementUsage(queryId: string): Promise<void> {
    const query = `
      UPDATE saved_queries
      SET usage_count = usage_count + 1
      WHERE id = $1
    `;

    await this.db.query(query, [queryId]);
  }

  /**
   * Instantiate query template with parameters
   */
  instantiateTemplate(template: string, parameters: Record<string, any>): string {
    let instantiated = template;

    for (const [key, value] of Object.entries(parameters)) {
      const placeholder = `{{${key}}}`;
      instantiated = instantiated.replace(new RegExp(placeholder, 'g'), String(value));
    }

    return instantiated;
  }

  /**
   * Get built-in templates
   */
  getTemplates(category?: string): QueryTemplate[] {
    if (category) {
      return this.TEMPLATES.filter(t => t.category === category);
    }
    return this.TEMPLATES;
  }

  /**
   * Get template by ID
   */
  getTemplate(templateId: string): QueryTemplate | null {
    return this.TEMPLATES.find(t => t.id === templateId) || null;
  }

  /**
   * Create saved query from template
   */
  async createFromTemplate(
    templateId: string,
    serverId: string,
    userId: string,
    parameters: Record<string, any>
  ): Promise<{ query: SavedQuery; question: string }> {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Instantiate question
    const question = this.instantiateTemplate(template.question, parameters);

    // Save query
    const savedQuery = await this.saveQuery(serverId, userId, template.name, question, {
      description: template.description,
      parameters: template.parameters,
      category: template.category,
      isPublic: false
    });

    return { query: savedQuery, question };
  }

  /**
   * Convert database row to SavedQuery
   */
  private rowToSavedQuery(row: any): SavedQuery {
    return {
      id: row.id,
      serverId: row.server_id,
      createdBy: row.created_by,
      name: row.name,
      description: row.description,
      question: row.question,
      sql: row.sql,
      parameters: JSON.parse(row.parameters || '[]'),
      category: row.category,
      tags: JSON.parse(row.tags || '[]'),
      isPublic: row.is_public,
      usageCount: row.usage_count,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}

/**
 * Example usage:
 *
 * const savedQueries = new SavedQueriesManager(db);
 * await savedQueries.initialize();
 *
 * // Save a query
 * const saved = await savedQueries.saveQuery(
 *   serverId,
 *   userId,
 *   'Daily Bans',
 *   'How many bans were issued today?',
 *   { category: 'moderation', isPublic: true }
 * );
 *
 * // Get saved queries
 * const queries = await savedQueries.getServerQueries(serverId, userId);
 *
 * // Use a template
 * const templates = savedQueries.getTemplates('moderation');
 * const { query, question } = await savedQueries.createFromTemplate(
 *   'user-violations',
 *   serverId,
 *   userId,
 *   { user_id: '123456789' }
 * );
 *
 * // Execute saved query
 * const parsedQuery = await queryParser.parseQuery(question, context);
 * const result = await queryExecutor.executeQuery(parsedQuery, serverId, userId, question);
 *
 * // Increment usage
 * await savedQueries.incrementUsage(saved.id);
 */
