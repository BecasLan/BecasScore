/**
 * DATABASE SERVICE
 *
 * Core database operations with connection pooling,
 * query building, transactions, and error handling
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { getPostgresPool, getRedisClient } from './config';
import { getSupabaseClient } from './SupabaseClient';
import { createLogger } from '../services/Logger';
import type Redis from 'ioredis';
import type { SupabaseClient } from '@supabase/supabase-js';

const logger = createLogger('DatabaseService');

export class DatabaseService {
  private pool: Pool | null = null;
  private redis: Redis | null = null;
  private supabase: SupabaseClient;
  private useSupabase: boolean = true; // ALWAYS use Supabase REST API

  constructor() {
    // ONLY use Supabase REST API - no direct PostgreSQL connection
    this.supabase = getSupabaseClient();
    logger.info('✅ Database service initialized with Supabase REST API');
  }

  /**
   * Initialize Redis connection (lazy)
   */
  private async getRedis(): Promise<Redis> {
    if (!this.redis) {
      this.redis = await getRedisClient();
    }
    return this.redis;
  }

  /**
   * Execute a query
   */
  async query<T extends QueryResultRow = any>(
    sql: string,
    params?: any[]
  ): Promise<QueryResult<T>> {
    const start = Date.now();

    try {
      const result = await this.pool.query<T>(sql, params);
      const duration = Date.now() - start;

      if (duration > 1000) {
        logger.warn(`Slow query (${duration}ms): ${sql.substring(0, 100)}...`);
      }

      return result;
    } catch (error: any) {
      logger.error('Query failed', { sql: sql.substring(0, 200), params, error });

      // If PostgreSQL fails with timeout and Supabase is available, switch to Supabase mode
      if (error.code === 'ETIMEDOUT' && this.supabase && !this.useSupabase) {
        logger.warn('⚠️ PostgreSQL timeout detected, switching to Supabase REST API mode');
        this.useSupabase = true;
      }

      throw error;
    }
  }

  /**
   * Execute a query and return single row
   */
  async queryOne<T extends QueryResultRow = any>(
    sql: string,
    params?: any[]
  ): Promise<T | null> {
    const result = await this.query<T>(sql, params);
    return result.rows[0] || null;
  }

  /**
   * Execute a query and return all rows
   */
  async queryMany<T extends QueryResultRow = any>(
    sql: string,
    params?: any[]
  ): Promise<T[]> {
    const result = await this.query<T>(sql, params);
    return result.rows;
  }

  /**
   * Insert a single record
   */
  async insert<T extends QueryResultRow = any>(
    table: string,
    data: Record<string, any>,
    returning: string = '*'
  ): Promise<T> {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const columns = keys.join(', ');

    const sql = `
      INSERT INTO ${table} (${columns})
      VALUES (${placeholders})
      RETURNING ${returning}
    `;

    const result = await this.queryOne<T>(sql, values);
    if (!result) {
      throw new Error(`Failed to insert into ${table}`);
    }

    return result;
  }

  /**
   * Insert multiple records (bulk insert)
   */
  async insertMany<T extends QueryResultRow = any>(
    table: string,
    records: Record<string, any>[],
    returning: string = '*'
  ): Promise<T[]> {
    if (records.length === 0) return [];

    const keys = Object.keys(records[0]);
    const columns = keys.join(', ');

    const values: any[] = [];
    const valuePlaceholders: string[] = [];

    records.forEach((record, recordIndex) => {
      const recordPlaceholders = keys.map((key, keyIndex) => {
        values.push(record[key]);
        return `$${recordIndex * keys.length + keyIndex + 1}`;
      });
      valuePlaceholders.push(`(${recordPlaceholders.join(', ')})`);
    });

    const sql = `
      INSERT INTO ${table} (${columns})
      VALUES ${valuePlaceholders.join(', ')}
      RETURNING ${returning}
    `;

    return this.queryMany<T>(sql, values);
  }

  /**
   * Update records
   */
  async update<T extends QueryResultRow = any>(
    table: string,
    data: Record<string, any>,
    where: Record<string, any>,
    returning: string = '*'
  ): Promise<T[]> {
    const setKeys = Object.keys(data);
    const setValues = Object.values(data);
    const whereKeys = Object.keys(where);
    const whereValues = Object.values(where);

    const setClause = setKeys.map((key, i) => `${key} = $${i + 1}`).join(', ');
    const whereClause = whereKeys
      .map((key, i) => `${key} = $${setKeys.length + i + 1}`)
      .join(' AND ');

    const sql = `
      UPDATE ${table}
      SET ${setClause}
      WHERE ${whereClause}
      RETURNING ${returning}
    `;

    return this.queryMany<T>(sql, [...setValues, ...whereValues]);
  }

  /**
   * Delete records
   */
  async delete(table: string, where: Record<string, any>): Promise<number> {
    const keys = Object.keys(where);
    const values = Object.values(where);
    const whereClause = keys.map((key, i) => `${key} = $${i + 1}`).join(' AND ');

    const sql = `DELETE FROM ${table} WHERE ${whereClause}`;
    const result = await this.query(sql, values);

    return result.rowCount || 0;
  }

  /**
   * Upsert (insert or update)
   */
  async upsert<T extends QueryResultRow = any>(
    table: string,
    data: Record<string, any>,
    conflictColumns: string[],
    updateColumns: string[],
    returning: string = '*'
  ): Promise<T> {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const columns = keys.join(', ');

    const updateSet = updateColumns
      .map(col => `${col} = EXCLUDED.${col}`)
      .join(', ');

    const sql = `
      INSERT INTO ${table} (${columns})
      VALUES (${placeholders})
      ON CONFLICT (${conflictColumns.join(', ')})
      DO UPDATE SET ${updateSet}
      RETURNING ${returning}
    `;

    const result = await this.queryOne<T>(sql, values);
    if (!result) {
      throw new Error(`Failed to upsert into ${table}`);
    }

    return result;
  }

  /**
   * Count records
   */
  async count(table: string, where?: Record<string, any>): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM ${table}`;
    let values: any[] = [];

    if (where && Object.keys(where).length > 0) {
      const keys = Object.keys(where);
      values = Object.values(where);
      const whereClause = keys.map((key, i) => `${key} = $${i + 1}`).join(' AND ');
      sql += ` WHERE ${whereClause}`;
    }

    const result = await this.queryOne<{ count: string }>(sql, values);
    return parseInt(result?.count || '0');
  }

  /**
   * Check if record exists
   */
  async exists(table: string, where: Record<string, any>): Promise<boolean> {
    const count = await this.count(table, where);
    return count > 0;
  }

  /**
   * Transaction support
   */
  async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Transaction failed, rolled back', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cache helper - Get from cache or database
   */
  async cached<T>(
    key: string,
    ttlSeconds: number,
    fetchFn: () => Promise<T>
  ): Promise<T> {
    const redis = await this.getRedis();

    try {
      // Try to get from cache
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached) as T;
      }
    } catch (error) {
      logger.warn('Redis get failed, falling back to database', error);
    }

    // Fetch from database
    const data = await fetchFn();

    // Store in cache
    try {
      await redis.setex(key, ttlSeconds, JSON.stringify(data));
    } catch (error) {
      logger.warn('Redis set failed', error);
    }

    return data;
  }

  /**
   * Invalidate cache
   */
  async invalidateCache(pattern: string): Promise<void> {
    const redis = await this.getRedis();

    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(keys);
        logger.debug(`Invalidated ${keys.length} cache keys matching ${pattern}`);
      }
    } catch (error) {
      logger.warn('Cache invalidation failed', error);
    }
  }

  /**
   * Paginate query results
   */
  async paginate<T extends QueryResultRow = any>(
    sql: string,
    params: any[],
    page: number = 1,
    pageSize: number = 50
  ): Promise<{
    data: T[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  }> {
    // Get total count
    const countSql = `SELECT COUNT(*) as count FROM (${sql}) as subquery`;
    const countResult = await this.queryOne<{ count: string }>(countSql, params);
    const total = parseInt(countResult?.count || '0');

    // Get paginated data
    const offset = (page - 1) * pageSize;
    const paginatedSql = `${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const data = await this.queryMany<T>(paginatedSql, [...params, pageSize, offset]);

    return {
      data,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    };
  }

  /**
   * Execute raw SQL (use with caution)
   */
  async raw<T extends QueryResultRow = any>(sql: string): Promise<QueryResult<T>> {
    logger.warn('Executing raw SQL - ensure this is intentional');
    return this.query<T>(sql);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ postgres: boolean; redis: boolean }> {
    const health = { postgres: false, redis: false };

    // Check PostgreSQL
    try {
      await this.query('SELECT 1');
      health.postgres = true;
    } catch (error) {
      logger.error('PostgreSQL health check failed', error);
    }

    // Check Redis
    try {
      const redis = await this.getRedis();
      await redis.ping();
      health.redis = true;
    } catch (error) {
      logger.error('Redis health check failed', error);
    }

    return health;
  }
}

// Singleton instance
let dbServiceInstance: DatabaseService | null = null;

export function getDatabaseService(): DatabaseService {
  if (!dbServiceInstance) {
    dbServiceInstance = new DatabaseService();
    logger.info('DatabaseService initialized');
  }
  return dbServiceInstance;
}
