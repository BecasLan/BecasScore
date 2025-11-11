import logger from './logger';

/**
 * MemoryManager
 *
 * Prevents memory leaks and optimizes memory usage.
 *
 * Features:
 * - Active tracking limits (prevent unbounded growth)
 * - Automatic cleanup of stale entries
 * - Memory leak detection
 * - Stream-based processing for large datasets
 * - Pagination helpers
 * - Memory usage monitoring
 */

export class MemoryManager {
  private trackedCollections: Map<string, WeakMap<any, any>> = new Map();
  private cleanupIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Create limited-size map with automatic eviction
   */
  createLimitedMap<K, V>(
    name: string,
    maxSize: number,
    ttlMs?: number
  ): LimitedMap<K, V> {
    return new LimitedMap<K, V>(name, maxSize, ttlMs);
  }

  /**
   * Create limited-size set
   */
  createLimitedSet<T>(name: string, maxSize: number): LimitedSet<T> {
    return new LimitedSet<T>(name, maxSize);
  }

  /**
   * Paginate large query
   */
  async *paginateQuery<T>(
    queryFn: (offset: number, limit: number) => Promise<T[]>,
    pageSize: number = 100
  ): AsyncGenerator<T[]> {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const results = await queryFn(offset, pageSize);

      if (results.length === 0) {
        hasMore = false;
      } else {
        yield results;
        offset += results.length;

        // If results < pageSize, we've reached the end
        if (results.length < pageSize) {
          hasMore = false;
        }
      }
    }
  }

  /**
   * Stream processor for large datasets
   */
  async processInChunks<T>(
    items: T[],
    chunkSize: number,
    processor: (chunk: T[]) => Promise<void>
  ): Promise<void> {
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      await processor(chunk);

      // Allow garbage collection between chunks
      if (global.gc) {
        global.gc();
      }
    }
  }

  /**
   * Monitor memory usage
   */
  getMemoryStats(): {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    heapPercent: number;
    external: number;
  } {
    const mem = process.memoryUsage();

    return {
      rss: Math.round(mem.rss / 1024 / 1024), // MB
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
      external: Math.round(mem.external / 1024 / 1024)
    };
  }

  /**
   * Check for memory leaks
   */
  checkMemoryLeak(thresholdMB: number = 1000): boolean {
    const stats = this.getMemoryStats();

    if (stats.heapUsed > thresholdMB) {
      logger.warn(`⚠️  High memory usage detected: ${stats.heapUsed}MB (threshold: ${thresholdMB}MB)`);
      logger.warn(`   Heap: ${stats.heapPercent}% used (${stats.heapUsed}MB / ${stats.heapTotal}MB)`);
      logger.warn(`   RSS: ${stats.rss}MB`);
      return true;
    }

    return false;
  }

  /**
   * Force garbage collection (if --expose-gc flag is set)
   */
  forceGC(): void {
    if (global.gc) {
      const before = this.getMemoryStats();
      global.gc();
      const after = this.getMemoryStats();
      const freed = before.heapUsed - after.heapUsed;

      logger.debug(`Forced GC: freed ${freed}MB`);
    } else {
      logger.warn('Garbage collection not exposed. Run with --expose-gc flag.');
    }
  }

  /**
   * Start automatic memory monitoring
   */
  startMonitoring(intervalSeconds: number = 60, thresholdMB: number = 1000): void {
    setInterval(() => {
      const stats = this.getMemoryStats();

      logger.debug(
        `Memory: ${stats.heapUsed}MB / ${stats.heapTotal}MB (${stats.heapPercent}%) | RSS: ${stats.rss}MB`
      );

      this.checkMemoryLeak(thresholdMB);

      // Auto-GC if heap usage > 80%
      if (stats.heapPercent > 80 && global.gc) {
        logger.warn('High heap usage, forcing GC...');
        this.forceGC();
      }
    }, intervalSeconds * 1000);

    logger.info(`Started memory monitoring (interval: ${intervalSeconds}s, threshold: ${thresholdMB}MB)`);
  }
}

/**
 * LimitedMap - Map with max size and LRU eviction
 */
export class LimitedMap<K, V> {
  private map: Map<K, { value: V; timestamp: number }> = new Map();

  constructor(
    private name: string,
    private maxSize: number,
    private ttlMs?: number
  ) {}

  set(key: K, value: V): void {
    // Remove oldest if at capacity
    if (this.map.size >= this.maxSize && !this.map.has(key)) {
      const oldestKey = this.getOldestKey();
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }

    this.map.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);

    if (!entry) return undefined;

    // Check TTL
    if (this.ttlMs && Date.now() - entry.timestamp > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }

    // Update timestamp (LRU)
    entry.timestamp = Date.now();

    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  private getOldestKey(): K | undefined {
    let oldestKey: K | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.map.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): number {
    if (!this.ttlMs) return 0;

    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.map.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.map.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug(`Cleaned up ${removed} expired entries from ${this.name}`);
    }

    return removed;
  }
}

/**
 * LimitedSet - Set with max size and FIFO eviction
 */
export class LimitedSet<T> {
  private set: Set<T> = new Set();
  private queue: T[] = [];

  constructor(
    private name: string,
    private maxSize: number
  ) {}

  add(value: T): void {
    if (this.set.has(value)) return;

    // Remove oldest if at capacity
    if (this.set.size >= this.maxSize) {
      const oldest = this.queue.shift();
      if (oldest !== undefined) {
        this.set.delete(oldest);
      }
    }

    this.set.add(value);
    this.queue.push(value);
  }

  has(value: T): boolean {
    return this.set.has(value);
  }

  delete(value: T): boolean {
    const deleted = this.set.delete(value);

    if (deleted) {
      const index = this.queue.indexOf(value);
      if (index !== -1) {
        this.queue.splice(index, 1);
      }
    }

    return deleted;
  }

  clear(): void {
    this.set.clear();
    this.queue = [];
  }

  get size(): number {
    return this.set.size;
  }

  values(): IterableIterator<T> {
    return this.set.values();
  }
}

/**
 * Usage examples:
 *
 * const memManager = new MemoryManager();
 *
 * // Limited map with LRU eviction
 * const cache = memManager.createLimitedMap<string, any>('user-cache', 1000, 60000);
 * cache.set('user1', { name: 'John' });
 * const user = cache.get('user1');
 *
 * // Paginate large query
 * for await (const page of memManager.paginateQuery(
 *   (offset, limit) => db.query('SELECT * FROM messages LIMIT $1 OFFSET $2', [limit, offset]),
 *   100
 * )) {
 *   // Process page
 *   console.log(`Processing ${page.length} messages`);
 * }
 *
 * // Process in chunks
 * await memManager.processInChunks(messages, 100, async (chunk) => {
 *   // Process chunk
 *   await processMessages(chunk);
 * });
 *
 * // Monitor memory
 * memManager.startMonitoring(60, 1000); // Every 60s, threshold 1000MB
 *
 * // Check memory usage
 * const stats = memManager.getMemoryStats();
 * console.log(`Heap: ${stats.heapUsed}MB / ${stats.heapTotal}MB (${stats.heapPercent}%)`);
 */

export default new MemoryManager();
