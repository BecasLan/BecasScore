import Redis from 'ioredis';
import { createLogger } from './Logger';
import crypto from 'crypto';

const logger = createLogger('OllamaCacheService');

/**
 * REDIS CACHING LAYER FOR OLLAMA AI CALLS
 *
 * Caches AI responses to reduce duplicate API calls and improve performance.
 *
 * Key Features:
 * - Automatic cache key generation from (prompt + system prompt + temperature)
 * - 1 hour TTL for cached responses
 * - Cache hit/miss metrics logging
 * - Graceful fallback when Redis is unavailable
 *
 * Expected Performance Impact:
 * - 60-80% cache hit rate for repeated queries
 * - Response time: 2-3s → 50-200ms for cached responses
 * - Significant reduction in Ollama API load
 */

export interface CacheConfig {
  host?: string;
  port?: number;
  password?: string;
  ttl?: number; // Time-to-live in seconds (default: 3600 = 1 hour)
  enabled?: boolean;
}

export class OllamaCacheService {
  private redis: Redis | null = null;
  private ttl: number;
  private enabled: boolean;
  private hitCount = 0;
  private missCount = 0;
  private errorCount = 0;

  constructor(config?: CacheConfig) {
    this.ttl = config?.ttl || 3600; // Default 1 hour
    this.enabled = config?.enabled !== false; // Default enabled

    if (!this.enabled) {
      logger.info('💤 Cache disabled via config');
      return;
    }

    try {
      this.redis = new Redis({
        host: config?.host || process.env.REDIS_HOST || 'localhost',
        port: config?.port || parseInt(process.env.REDIS_PORT || '6379'),
        password: config?.password || process.env.REDIS_PASSWORD,
        retryStrategy: (times) => {
          // Retry connection with exponential backoff (max 3 seconds)
          const delay = Math.min(times * 50, 3000);
          return delay;
        },
        maxRetriesPerRequest: 3,
        lazyConnect: true, // Don't connect immediately
      });

      // Connect and handle errors
      this.redis.connect().then(() => {
        logger.info('✅ Redis cache connected successfully');
      }).catch((error) => {
        logger.warn('⚠️ Redis connection failed - cache disabled', error.message);
        this.redis = null;
      });

      // Handle Redis errors
      this.redis.on('error', (error) => {
        this.errorCount++;
        logger.warn('Redis error (cache will be bypassed):', error.message);
      });

      this.redis.on('reconnecting', () => {
        logger.info('🔄 Reconnecting to Redis...');
      });

    } catch (error: any) {
      logger.warn('⚠️ Failed to initialize Redis cache:', error.message);
      this.redis = null;
    }
  }

  /**
   * Generate cache key from request parameters
   * Uses SHA-256 hash to ensure consistent key length
   */
  private generateCacheKey(
    prompt: string,
    systemPrompt: string = '',
    temperature: number = 0.7,
    model: string = 'default'
  ): string {
    // Create unique string from all parameters that affect the response
    const keyString = `${model}:${systemPrompt}:${prompt}:${temperature}`;

    // Hash to ensure consistent key length and avoid special characters
    const hash = crypto.createHash('sha256').update(keyString).digest('hex');

    return `ollama:${hash}`;
  }

  /**
   * Get cached response if available
   * Returns null if cache miss or error
   */
  async get(
    prompt: string,
    systemPrompt?: string,
    temperature?: number,
    model?: string
  ): Promise<string | null> {
    if (!this.redis || !this.enabled) {
      return null;
    }

    try {
      const key = this.generateCacheKey(prompt, systemPrompt, temperature, model);
      const cached = await this.redis.get(key);

      if (cached) {
        this.hitCount++;
        const hitRate = (this.hitCount / (this.hitCount + this.missCount) * 100).toFixed(1);
        logger.info(`🎯 Cache HIT (${hitRate}% hit rate) - ${cached.length} chars`);
        return cached;
      }

      this.missCount++;
      return null;

    } catch (error: any) {
      this.errorCount++;
      logger.warn('Cache get error (bypassing):', error.message);
      return null;
    }
  }

  /**
   * Store response in cache
   */
  async set(
    prompt: string,
    response: string,
    systemPrompt?: string,
    temperature?: number,
    model?: string
  ): Promise<void> {
    if (!this.redis || !this.enabled) {
      return;
    }

    try {
      const key = this.generateCacheKey(prompt, systemPrompt, temperature, model);

      // Store with TTL (default 1 hour)
      await this.redis.setex(key, this.ttl, response);

      logger.info(`💾 Cached response (TTL: ${this.ttl}s) - ${response.length} chars`);

    } catch (error: any) {
      this.errorCount++;
      logger.warn('Cache set error (continuing without cache):', error.message);
    }
  }

  /**
   * Clear specific cache entry
   */
  async clear(
    prompt: string,
    systemPrompt?: string,
    temperature?: number,
    model?: string
  ): Promise<void> {
    if (!this.redis || !this.enabled) {
      return;
    }

    try {
      const key = this.generateCacheKey(prompt, systemPrompt, temperature, model);
      await this.redis.del(key);
      logger.info('🗑️ Cache entry cleared');
    } catch (error: any) {
      logger.warn('Cache clear error:', error.message);
    }
  }

  /**
   * Clear all Ollama cache entries
   */
  async clearAll(): Promise<void> {
    if (!this.redis || !this.enabled) {
      return;
    }

    try {
      // Find all keys matching pattern
      const keys = await this.redis.keys('ollama:*');

      if (keys.length > 0) {
        await this.redis.del(...keys);
        logger.info(`🗑️ Cleared ${keys.length} cache entries`);
      } else {
        logger.info('🗑️ No cache entries to clear');
      }
    } catch (error: any) {
      logger.warn('Cache clearAll error:', error.message);
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.hitCount + this.missCount;
    const hitRate = total > 0 ? (this.hitCount / total * 100).toFixed(1) : '0.0';

    return {
      enabled: this.enabled && this.redis !== null,
      connected: this.redis !== null,
      hitCount: this.hitCount,
      missCount: this.missCount,
      errorCount: this.errorCount,
      hitRate: parseFloat(hitRate),
      totalRequests: total,
      ttl: this.ttl,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hitCount = 0;
    this.missCount = 0;
    this.errorCount = 0;
    logger.info('📊 Cache stats reset');
  }

  /**
   * Manually disable cache (for testing)
   */
  disable(): void {
    this.enabled = false;
    logger.info('💤 Cache manually disabled');
  }

  /**
   * Manually enable cache (for testing)
   */
  enable(): void {
    this.enabled = true;
    logger.info('✅ Cache manually enabled');
  }

  /**
   * Close Redis connection
   */
  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      logger.info('👋 Redis cache disconnected');
    }
  }

  /**
   * Check if cache is available
   */
  isAvailable(): boolean {
    return this.enabled && this.redis !== null;
  }
}

// Singleton instance
let cacheInstance: OllamaCacheService | null = null;

/**
 * Get or create cache instance
 */
export function getOllamaCache(config?: CacheConfig): OllamaCacheService {
  if (!cacheInstance) {
    cacheInstance = new OllamaCacheService(config);
  }
  return cacheInstance;
}

/**
 * Reset cache instance (for testing)
 */
export function resetOllamaCache(): void {
  if (cacheInstance) {
    cacheInstance.disconnect();
    cacheInstance = null;
  }
}
