import axios from 'axios';
import logger from '../utils/logger';

/**
 * QueryParser
 *
 * Converts natural language questions into safe SQL queries.
 * Moderators can ask questions in Turkish or English without SQL knowledge.
 *
 * Examples:
 * - "Bugün kaç ban yedi?" → SELECT COUNT(*) FROM moderation_actions WHERE action = 'ban' AND created_at >= CURRENT_DATE
 * - "Show toxic users" → SELECT user_id, COUNT(*) FROM sicil WHERE reason LIKE '%toxic%' GROUP BY user_id
 * - "X kullanıcısı ne zaman Y dedi?" → SELECT created_at, content FROM messages WHERE user_id = 'X' AND content LIKE '%Y%'
 *
 * Safety Features:
 * - Read-only queries (no INSERT/UPDATE/DELETE/DROP)
 * - SQL injection prevention
 * - Result limit (max 1000 rows)
 * - Query timeout (10 seconds)
 * - Sanitized table/column names
 */

export interface ParsedQuery {
  sql: string;
  intent: string;
  confidence: number;
  parameters: Record<string, any>;
  explanation: string;
  estimatedRows?: number;
  tables: string[];
  safe: boolean;
  warnings?: string[];
}

export interface QueryContext {
  serverId: string;
  userId: string;
  userRole: string;
  language: 'tr' | 'en';
}

export class QueryParser {
  private ollamaUrl: string;
  private model: string;

  // Allowed tables for queries
  private readonly ALLOWED_TABLES = [
    'users',
    'servers',
    'messages',
    'sicil',
    'trust_scores',
    'moderation_actions',
    'rules',
    'user_character_profiles',
    'conversation_threads',
    'emotional_context',
    'threats',
    'cross_server_alerts',
    'moderator_feedback',
    'learning_adjustments',
    'server_learning_profiles'
  ];

  // Forbidden SQL keywords (write operations)
  private readonly FORBIDDEN_KEYWORDS = [
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER',
    'TRUNCATE', 'REPLACE', 'MERGE', 'GRANT', 'REVOKE',
    'EXECUTE', 'EXEC', 'CALL', 'PROCEDURE'
  ];

  constructor(ollamaUrl: string = 'http://localhost:11434', model: string = 'qwen2.5:14b') {
    this.ollamaUrl = ollamaUrl;
    this.model = model;
  }

  /**
   * Parse natural language question into SQL query
   */
  async parseQuery(question: string, context: QueryContext): Promise<ParsedQuery> {
    logger.info(`Parsing query: "${question}" (server: ${context.serverId}, user: ${context.userId})`);

    try {
      // Generate SQL using LLM
      const prompt = this.buildPrompt(question, context);
      const response = await this.callOllama(prompt);

      // Extract SQL and metadata from response
      const parsed = this.extractQueryFromResponse(response);

      // Safety checks
      const safetyCheck = this.validateSafety(parsed.sql);
      if (!safetyCheck.safe) {
        return {
          sql: '',
          intent: 'unsafe',
          confidence: 0,
          parameters: {},
          explanation: 'Query failed safety checks',
          tables: [],
          safe: false,
          warnings: safetyCheck.warnings
        };
      }

      // Add server context to query (filter by server_id)
      const contextualizedSql = this.addServerContext(parsed.sql, context.serverId);

      // Add LIMIT if not present
      const finalSql = this.ensureLimit(contextualizedSql);

      logger.info(`Generated SQL: ${finalSql}`);

      return {
        ...parsed,
        sql: finalSql,
        safe: true
      };

    } catch (error) {
      logger.error('Error parsing query:', error);
      throw new Error(`Failed to parse query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build prompt for LLM
   */
  private buildPrompt(question: string, context: QueryContext): string {
    const schemaInfo = this.getSchemaInfo();

    return `You are a SQL query generator for a Discord moderation bot database.

**User Question:** "${question}"
**Language:** ${context.language === 'tr' ? 'Turkish' : 'English'}
**Server ID:** ${context.serverId}

**Available Tables and Columns:**
${schemaInfo}

**Task:**
Generate a safe, read-only SQL query that answers the user's question.

**Rules:**
1. ONLY use SELECT statements (no INSERT, UPDATE, DELETE, DROP, etc.)
2. ONLY query from the tables listed above
3. Always filter by server_id = '${context.serverId}' when the table has a server_id column
4. Use proper JOIN syntax when querying multiple tables
5. Add ORDER BY and LIMIT when appropriate
6. Use CURRENT_DATE, CURRENT_TIMESTAMP for time-based queries
7. Handle NULL values properly
8. Return results that directly answer the question

**Response Format:**
Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
  "sql": "SELECT ... FROM ... WHERE ...",
  "intent": "describe the intent (e.g., 'count bans today', 'find toxic users')",
  "confidence": 0.95,
  "parameters": {"param1": "value1"},
  "explanation": "Plain English explanation of what the query does",
  "estimatedRows": 50,
  "tables": ["table1", "table2"]
}

**Examples:**

Question: "Bugün kaç ban yedi?"
Response:
{
  "sql": "SELECT COUNT(*) as ban_count FROM moderation_actions WHERE server_id = '${context.serverId}' AND action = 'ban' AND created_at >= CURRENT_DATE",
  "intent": "count bans today",
  "confidence": 0.98,
  "parameters": {"timeframe": "today", "action": "ban"},
  "explanation": "Counts how many ban actions were taken today on this server",
  "estimatedRows": 1,
  "tables": ["moderation_actions"]
}

Question: "Show me users with trust score below 20"
Response:
{
  "sql": "SELECT user_id, trust_score, last_updated FROM trust_scores WHERE server_id = '${context.serverId}' AND trust_score < 20 ORDER BY trust_score ASC LIMIT 50",
  "intent": "find low trust users",
  "confidence": 0.96,
  "parameters": {"trust_threshold": 20},
  "explanation": "Returns users with trust scores below 20, sorted by lowest first",
  "estimatedRows": 15,
  "tables": ["trust_scores"]
}

Now generate the SQL query for the user's question.`;
  }

  /**
   * Get schema information for prompt
   */
  private getSchemaInfo(): string {
    return `
1. **users** (user_id, username, discriminator, created_at, last_seen)
   - Discord user information

2. **servers** (server_id, server_name, created_at, owner_id)
   - Discord server information

3. **messages** (id, server_id, channel_id, user_id, content, created_at, edited_at, deleted)
   - All messages sent in the server

4. **sicil** (id, server_id, user_id, action, reason, duration, moderator_id, created_at)
   - Violation records (bans, timeouts, warnings)

5. **trust_scores** (server_id, user_id, trust_score, violations_count, clean_streak_days, last_updated)
   - User trust scores (0-100)

6. **moderation_actions** (id, server_id, user_id, action, reason, moderator_id, created_at)
   - All moderation actions taken

7. **user_character_profiles** (server_id, user_id, traits, last_updated)
   - Personality and behavioral traits (JSON)

8. **moderator_feedback** (id, server_id, moderator_id, target_user_id, becas_action, moderator_action, was_becas_correct, created_at)
   - Moderator overrides and feedback

9. **learning_adjustments** (id, server_id, category, parameter, old_value, new_value, reason, created_at)
   - Learning system adjustments

10. **threats** (id, server_id, user_id, threat_type, severity, content, created_at, resolved)
    - Detected threats

Common columns:
- server_id: Filter by this server
- user_id: Discord user ID
- created_at: Timestamp
- updated_at: Last update timestamp
`;
  }

  /**
   * Call Ollama API
   */
  private async callOllama(prompt: string): Promise<string> {
    const response = await axios.post(
      `${this.ollamaUrl}/api/generate`,
      {
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature: 0.1, // Low temperature for deterministic SQL
          num_predict: 1000
        }
      },
      { timeout: 30000 }
    );

    return response.data.response;
  }

  /**
   * Extract query from LLM response
   */
  private extractQueryFromResponse(response: string): Omit<ParsedQuery, 'safe'> {
    try {
      // Try to find JSON in the response
      let jsonStr = response.trim();

      // Remove markdown code blocks if present
      jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '');

      // Find JSON object
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        sql: parsed.sql || '',
        intent: parsed.intent || 'unknown',
        confidence: parsed.confidence || 0.5,
        parameters: parsed.parameters || {},
        explanation: parsed.explanation || '',
        estimatedRows: parsed.estimatedRows,
        tables: parsed.tables || []
      };

    } catch (error) {
      logger.error('Failed to parse LLM response:', error);
      logger.error('Raw response:', response);
      throw new Error('Failed to extract SQL from LLM response');
    }
  }

  /**
   * Validate query safety
   */
  private validateSafety(sql: string): { safe: boolean; warnings: string[] } {
    const warnings: string[] = [];
    const upperSql = sql.toUpperCase();

    // Check for forbidden keywords
    for (const keyword of this.FORBIDDEN_KEYWORDS) {
      if (upperSql.includes(keyword)) {
        warnings.push(`Forbidden keyword detected: ${keyword}`);
      }
    }

    // Check for SQL injection patterns
    if (upperSql.includes('--') || upperSql.includes(';--') || upperSql.includes('/*')) {
      warnings.push('Potential SQL injection detected');
    }

    // Check for multiple statements
    if (sql.split(';').length > 2) {
      warnings.push('Multiple SQL statements detected');
    }

    // Check that it's a SELECT statement
    if (!upperSql.trim().startsWith('SELECT')) {
      warnings.push('Query must be a SELECT statement');
    }

    // Check for allowed tables only
    const usedTables = this.extractTablesFromSql(sql);
    for (const table of usedTables) {
      if (!this.ALLOWED_TABLES.includes(table.toLowerCase())) {
        warnings.push(`Table not allowed: ${table}`);
      }
    }

    return {
      safe: warnings.length === 0,
      warnings
    };
  }

  /**
   * Extract table names from SQL
   */
  private extractTablesFromSql(sql: string): string[] {
    const tables: string[] = [];

    // Match FROM clause
    const fromMatch = sql.match(/FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi);
    if (fromMatch) {
      fromMatch.forEach(match => {
        const table = match.replace(/FROM\s+/i, '').trim();
        tables.push(table);
      });
    }

    // Match JOIN clause
    const joinMatch = sql.match(/JOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi);
    if (joinMatch) {
      joinMatch.forEach(match => {
        const table = match.replace(/JOIN\s+/i, '').trim();
        tables.push(table);
      });
    }

    return tables;
  }

  /**
   * Add server context to query (ensure server_id filter)
   */
  private addServerContext(sql: string, serverId: string): string {
    // If query already has server_id filter, return as-is
    if (sql.toLowerCase().includes(`server_id = '${serverId}'`)) {
      return sql;
    }

    // Otherwise, try to add it intelligently
    // This is a simple implementation - in production, use SQL parser
    if (sql.toLowerCase().includes('where')) {
      // Add to existing WHERE clause
      return sql.replace(/WHERE/i, `WHERE server_id = '${serverId}' AND`);
    } else if (sql.toLowerCase().includes('from')) {
      // Add WHERE clause after FROM
      const parts = sql.split(/\s+ORDER\s+BY/i);
      if (parts.length > 1) {
        return `${parts[0]} WHERE server_id = '${serverId}' ORDER BY ${parts[1]}`;
      } else {
        const limitParts = sql.split(/\s+LIMIT/i);
        if (limitParts.length > 1) {
          return `${limitParts[0]} WHERE server_id = '${serverId}' LIMIT ${limitParts[1]}`;
        } else {
          return `${sql} WHERE server_id = '${serverId}'`;
        }
      }
    }

    return sql;
  }

  /**
   * Ensure query has LIMIT clause
   */
  private ensureLimit(sql: string, maxLimit: number = 1000): string {
    if (sql.toLowerCase().includes('limit')) {
      // Check if limit is too high
      const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
      if (limitMatch) {
        const limit = parseInt(limitMatch[1]);
        if (limit > maxLimit) {
          return sql.replace(/LIMIT\s+\d+/i, `LIMIT ${maxLimit}`);
        }
      }
      return sql;
    }

    // Add LIMIT
    return `${sql} LIMIT ${maxLimit}`;
  }

  /**
   * Quick validation (before calling LLM)
   */
  validateQuestion(question: string): { valid: boolean; error?: string } {
    if (!question || question.trim().length === 0) {
      return { valid: false, error: 'Question cannot be empty' };
    }

    if (question.length > 500) {
      return { valid: false, error: 'Question too long (max 500 characters)' };
    }

    // Check for obvious SQL injection attempts
    const dangerous = ['DROP TABLE', 'DELETE FROM', 'UPDATE SET', 'INSERT INTO'];
    const upperQ = question.toUpperCase();
    for (const pattern of dangerous) {
      if (upperQ.includes(pattern)) {
        return { valid: false, error: 'Invalid question pattern detected' };
      }
    }

    return { valid: true };
  }
}

/**
 * Example usage:
 *
 * const parser = new QueryParser('http://localhost:11434', 'qwen2.5:14b');
 *
 * const context: QueryContext = {
 *   serverId: '123456789',
 *   userId: '987654321',
 *   userRole: 'moderator',
 *   language: 'tr'
 * };
 *
 * // Parse natural language question
 * const result = await parser.parseQuery('Bugün kaç ban yedi?', context);
 *
 * console.log('SQL:', result.sql);
 * console.log('Explanation:', result.explanation);
 * console.log('Safe:', result.safe);
 *
 * if (result.safe) {
 *   // Execute query with QueryExecutor
 * } else {
 *   console.log('Warnings:', result.warnings);
 * }
 */
