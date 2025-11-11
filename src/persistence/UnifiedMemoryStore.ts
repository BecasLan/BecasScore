/**
 * UNIFIED MEMORY STORE
 *
 * Tüm sistemlerin kullandığı merkezi hafıza sistemi.
 * - Persistent storage (disk'e yazılır)
 * - Fast in-memory cache
 * - Structured query support
 * - Version control for rollback
 */

import { StorageService } from '../services/StorageService';
import { createLogger } from '../services/Logger';

const logger = createLogger('UnifiedMemoryStore');

// ============================================
// CORE MEMORY TYPES
// ============================================

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  guildId: string;
  data: any;
  metadata: {
    createdAt: number;
    updatedAt: number;
    version: number;
    tags: string[];
  };
  relations: {
    relatedTo: string[];  // IDs of related memories
    causedBy?: string;     // ID of memory that caused this
  };
}

export type MemoryType =
  | 'action'           // Actions taken (ban, timeout, etc)
  | 'feedback'         // Corrections, confirmations
  | 'pattern'          // Learned patterns
  | 'user_profile'     // Deep user profiles
  | 'server_knowledge' // Server structure, rules, culture
  | 'conversation'     // Chat history (selective)
  | 'event'            // System events
  | 'decision'         // AI decisions with reasoning
  | 'suggestion'       // AI suggestions posted to #ai-insights
  | 'guild_policy'     // Guild-specific moderation policies
  | 'policy_violation' // Policy violation records
  ;

export interface QueryOptions {
  type?: MemoryType | MemoryType[];
  guildId?: string;
  userId?: string;
  since?: number;       // Timestamp
  until?: number;       // Timestamp
  tags?: string[];
  relatedTo?: string;   // Find memories related to this ID
  limit?: number;
  offset?: number;
}

// ============================================
// UNIFIED MEMORY STORE
// ============================================

export class UnifiedMemoryStore {
  private storage: StorageService;
  private cache: Map<string, MemoryEntry> = new Map();
  private indexes: {
    byType: Map<MemoryType, Set<string>>;
    byGuild: Map<string, Set<string>>;
    byTag: Map<string, Set<string>>;
    byRelation: Map<string, Set<string>>;
  };

  constructor(storage: StorageService) {
    this.storage = storage;
    this.indexes = {
      byType: new Map(),
      byGuild: new Map(),
      byTag: new Map(),
      byRelation: new Map(),
    };
  }

  /**
   * Initialize and load from disk
   */
  async initialize(): Promise<void> {
    logger.info('Initializing UnifiedMemoryStore...');

    // Load from storage
    const stored = await this.storage.load('unified_memory') || [];

    for (const entry of stored as MemoryEntry[]) {
      this.cache.set(entry.id, entry);
      this.updateIndexes(entry);
    }

    logger.info(`✓ Loaded ${(stored as MemoryEntry[]).length} memories from storage`);
  }

  /**
   * Store a new memory
   */
  async store(memory: Omit<MemoryEntry, 'id' | 'metadata'> & { metadata?: Partial<MemoryEntry['metadata']> }): Promise<string> {
    const id = this.generateId();
    const entry: MemoryEntry = {
      type: memory.type,
      guildId: memory.guildId,
      data: memory.data,
      relations: memory.relations,
      id,
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
        tags: memory.metadata?.tags || [],
      },
    };

    // Cache it
    this.cache.set(id, entry);
    this.updateIndexes(entry);

    // Persist to disk (async, non-blocking)
    this.persist().catch(err => logger.error('Failed to persist memory', err));

    logger.debug(`Stored memory: ${entry.type} (${id})`);
    return id;
  }

  /**
   * Update existing memory
   */
  async update(id: string, updates: Partial<MemoryEntry>): Promise<boolean> {
    const existing = this.cache.get(id);
    if (!existing) {
      logger.warn(`Attempted to update non-existent memory: ${id}`);
      return false;
    }

    const updated: MemoryEntry = {
      ...existing,
      ...updates,
      id: existing.id,  // Prevent ID change
      metadata: {
        ...existing.metadata,
        ...updates.metadata,
        updatedAt: Date.now(),
        version: existing.metadata.version + 1,
      },
    };

    this.cache.set(id, updated);
    this.updateIndexes(updated);

    this.persist().catch(err => logger.error('Failed to persist memory', err));

    logger.debug(`Updated memory: ${id} (v${updated.metadata.version})`);
    return true;
  }

  /**
   * Query memories with filters
   */
  async query(options: QueryOptions): Promise<MemoryEntry[]> {
    let results = new Set<string>();

    // Start with type filter if provided
    if (options.type) {
      const types = Array.isArray(options.type) ? options.type : [options.type];
      for (const type of types) {
        const typeIds = this.indexes.byType.get(type);
        if (typeIds) {
          if (results.size === 0) {
            results = new Set(typeIds);
          } else {
            results = new Set([...results].filter(id => typeIds.has(id)));
          }
        }
      }
    } else {
      // No type filter, start with all
      results = new Set(this.cache.keys());
    }

    // Apply guild filter
    if (options.guildId) {
      const guildIds = this.indexes.byGuild.get(options.guildId);
      if (guildIds) {
        results = new Set([...results].filter(id => guildIds.has(id)));
      } else {
        return []; // No matches
      }
    }

    // Apply tag filter
    if (options.tags && options.tags.length > 0) {
      for (const tag of options.tags) {
        const tagIds = this.indexes.byTag.get(tag);
        if (tagIds) {
          results = new Set([...results].filter(id => tagIds.has(id)));
        } else {
          return []; // No matches
        }
      }
    }

    // Apply relation filter
    if (options.relatedTo) {
      const relatedIds = this.indexes.byRelation.get(options.relatedTo);
      if (relatedIds) {
        results = new Set([...results].filter(id => relatedIds.has(id)));
      } else {
        return [];
      }
    }

    // Convert to entries
    let entries = Array.from(results)
      .map(id => this.cache.get(id))
      .filter((e): e is MemoryEntry => e !== undefined);

    // Apply time filters
    if (options.since) {
      entries = entries.filter(e => e.metadata.createdAt >= options.since!);
    }
    if (options.until) {
      entries = entries.filter(e => e.metadata.createdAt <= options.until!);
    }

    // Sort by creation time (newest first)
    entries.sort((a, b) => b.metadata.createdAt - a.metadata.createdAt);

    // Apply pagination
    if (options.offset) {
      entries = entries.slice(options.offset);
    }
    if (options.limit) {
      entries = entries.slice(0, options.limit);
    }

    logger.debug(`Query returned ${entries.length} results`);
    return entries;
  }

  /**
   * Get memory by ID
   */
  async get(id: string): Promise<MemoryEntry | null> {
    return this.cache.get(id) || null;
  }

  /**
   * Delete memory (soft delete - marks as deleted)
   */
  async delete(id: string): Promise<boolean> {
    const entry = this.cache.get(id);
    if (!entry) return false;

    // Soft delete: add deleted tag
    await this.update(id, {
      metadata: {
        ...entry.metadata,
        tags: [...entry.metadata.tags, '_deleted'],
      },
    });

    logger.debug(`Soft-deleted memory: ${id}`);
    return true;
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    total: number;
    byType: Record<MemoryType, number>;
    byGuild: Record<string, number>;
  } {
    const stats = {
      total: this.cache.size,
      byType: {} as Record<MemoryType, number>,
      byGuild: {} as Record<string, number>,
    };

    for (const [type, ids] of this.indexes.byType) {
      stats.byType[type] = ids.size;
    }

    for (const [guildId, ids] of this.indexes.byGuild) {
      stats.byGuild[guildId] = ids.size;
    }

    return stats;
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private updateIndexes(entry: MemoryEntry): void {
    // Index by type
    if (!this.indexes.byType.has(entry.type)) {
      this.indexes.byType.set(entry.type, new Set());
    }
    this.indexes.byType.get(entry.type)!.add(entry.id);

    // Index by guild
    if (!this.indexes.byGuild.has(entry.guildId)) {
      this.indexes.byGuild.set(entry.guildId, new Set());
    }
    this.indexes.byGuild.get(entry.guildId)!.add(entry.id);

    // Index by tags
    for (const tag of entry.metadata.tags) {
      if (!this.indexes.byTag.has(tag)) {
        this.indexes.byTag.set(tag, new Set());
      }
      this.indexes.byTag.get(tag)!.add(entry.id);
    }

    // Index by relations
    for (const relatedId of entry.relations.relatedTo) {
      if (!this.indexes.byRelation.has(relatedId)) {
        this.indexes.byRelation.set(relatedId, new Set());
      }
      this.indexes.byRelation.get(relatedId)!.add(entry.id);
    }
  }

  private async persist(): Promise<void> {
    const entries = Array.from(this.cache.values());
    await this.storage.save('unified_memory', entries);
  }
}
