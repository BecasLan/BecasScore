/**
 * DATABASE CONFIGURATION
 *
 * PostgreSQL + Redis configuration for BECAS data infrastructure
 */

import { Pool, PoolConfig } from 'pg';
import Redis from 'ioredis';
import { ENV } from '../config/environment';
import { createLogger } from '../services/Logger';

const logger = createLogger('Database');

// PostgreSQL Configuration
export const PG_CONFIG: PoolConfig = process.env.DATABASE_URL ? {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_HOST?.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  max: 50,  // Increased from 20
  min: 5,   // Keep some connections alive
  idleTimeoutMillis: 60000,  // 60 seconds
  connectionTimeoutMillis: 60000,  // 60 seconds - CRITICAL FIX
  statement_timeout: 60000,  // 60 seconds per query
  query_timeout: 60000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
} : {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'becas_db',
  user: process.env.DB_USER || 'becas',
  password: process.env.DB_PASSWORD || 'becas_secure_password_2025',
  max: 50,
  min: 5,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 60000,
  statement_timeout: 60000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
};

// Redis Configuration
export const REDIS_CONFIG = {
  port: parseInt(process.env.REDIS_PORT || '6379'),
  host: process.env.REDIS_HOST || 'localhost',
  retryStrategy: (times: number) => {
    if (times > 10) {
      logger.error('Redis connection failed after 10 retries');
      return null; // Stop retrying
    }
    return times * 100; // Exponential backoff
  }
};

// Database Connection Pools (Singleton)
let pgPool: Pool | null = null;
let redisClient: Redis | null = null;

/**
 * Get PostgreSQL connection pool
 */
export function getPostgresPool(): Pool {
  if (!pgPool) {
    pgPool = new Pool(PG_CONFIG);

    pgPool.on('error', (err) => {
      logger.error('Unexpected PostgreSQL pool error', err);
    });

    pgPool.on('connect', () => {
      logger.debug('New PostgreSQL client connected');
    });

    logger.info('PostgreSQL connection pool created');
  }

  return pgPool;
}

/**
 * Get Redis client
 */
export async function getRedisClient(): Promise<Redis> {
  if (!redisClient) {
    redisClient = new Redis(REDIS_CONFIG);

    redisClient.on('error', (err: Error) => {
      logger.error('Redis client error', err);
    });

    redisClient.on('connect', () => {
      logger.info('Redis client connected');
    });

    redisClient.on('reconnecting', () => {
      logger.warn('Redis client reconnecting...');
    });

    logger.info('Redis client initialized');
  }

  return redisClient;
}

/**
 * Test database connections
 */
export async function testConnections(): Promise<{ postgres: boolean; redis: boolean }> {
  const results = { postgres: false, redis: false };

  // Test PostgreSQL
  try {
    const pool = getPostgresPool();
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();

    logger.info(`PostgreSQL connection successful (${result.rows[0].now})`);
    results.postgres = true;
  } catch (error) {
    logger.error('PostgreSQL connection failed', error);
  }

  // Test Redis
  try {
    const redis = await getRedisClient();
    await redis.ping();

    logger.info('Redis connection successful');
    results.redis = true;
  } catch (error) {
    logger.error('Redis connection failed', error);
  }

  return results;
}

/**
 * Close all database connections gracefully
 */
export async function closeConnections(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    logger.info('PostgreSQL pool closed');
    pgPool = null;
  }

  if (redisClient) {
    redisClient.disconnect();
    logger.info('Redis client closed');
    redisClient = null;
  }
}

/**
 * Initialize database (create tables if they don't exist)
 */
export async function initializeDatabase(): Promise<void> {
  logger.info('Initializing database schema...');

  const pool = getPostgresPool();

  try {
    // Check if tables exist
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'servers'
      );
    `);

    if (!result.rows[0].exists) {
      logger.warn('Database tables do not exist. Please run migrations first.');
      logger.warn('Run: npm run db:migrate');
    } else {
      logger.info('✓ Database schema exists');
    }
  } catch (error) {
    logger.error('Failed to check database schema', error);
    throw error;
  }
}
