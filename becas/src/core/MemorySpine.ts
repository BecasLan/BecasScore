import { createLogger } from '../services/Logger';
import { StorageService } from '../services/StorageService';

const logger = createLogger('MemorySpine');

/**
 * MEMORY SPINE - Human-Inspired Memory Architecture
 *
 * Inspired by human memory systems:
 * 1. Working Memory - Short-term, immediate context (seconds to minutes)
 * 2. Episodic Memory - Events and experiences (hours to days)
 * 3. Semantic Memory - Concepts, patterns, facts (permanent)
 *
 * This allows Becas to:
 * - Remember conversations (working)
 * - Recall past encounters (episodic)
 * - Learn patterns and concepts (semantic)
 */

// ==========================================
// INTERFACES
// ==========================================

export interface WorkingMemoryEntry {
  id: string;
  content: string;
  timestamp: number;
  authorId: string;
  authorName: string;
  guildId: string;
  channelId: string;
  importance: number; // 0-1, determines retention
  ttl: number; // Time to live in ms
}

export interface EpisodicMemoryEntry {
  id: string;
  type: 'interaction' | 'conflict' | 'moderation' | 'achievement' | 'conversation';
  timestamp: number;
  guildId: string;
  participants: string[]; // User IDs
  summary: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  importance: number; // 0-1
  details: {
    content?: string;
    action?: string;
    outcome?: string;
    impact?: number;
  };
  ttl: number; // Time to live in ms
}

export interface SemanticMemoryEntry {
  id: string;
  type: 'pattern' | 'concept' | 'rule' | 'relationship' | 'knowledge';
  guildId: string;
  content: string;
  confidence: number; // 0-1
  evidence: string[]; // Supporting observations
  learnedAt: number;
  reinforcements: number; // How many times this was confirmed
  permanent: boolean;
}

export interface MemoryQuery {
  type?: 'working' | 'episodic' | 'semantic';
  guildId?: string;
  userId?: string;
  timeRange?: { start: number; end: number };
  importance?: { min: number; max: number };
  limit?: number;
}

export interface MemoryRecallResult {
  working: WorkingMemoryEntry[];
  episodic: EpisodicMemoryEntry[];
  semantic: SemanticMemoryEntry[];
  totalRecalled: number;
  recallTime: number;
}

// ==========================================
// WORKING MEMORY
// ==========================================

export class WorkingMemory {
  private entries: Map<string, WorkingMemoryEntry[]> = new Map(); // Keyed by conversationId
  private maxEntriesPerConversation = 50; // Limit to prevent overflow
  private defaultTTL = 300000; // 5 minutes

  /**
   * Add entry to working memory
   */
  add(conversationId: string, entry: Omit<WorkingMemoryEntry, 'id' | 'ttl'>): void {
    if (!this.entries.has(conversationId)) {
      this.entries.set(conversationId, []);
    }

    const fullEntry: WorkingMemoryEntry = {
      ...entry,
      id: `wm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ttl: this.defaultTTL,
    };

    const conversationEntries = this.entries.get(conversationId)!;
    conversationEntries.push(fullEntry);

    // Enforce limit (keep most important + most recent)
    if (conversationEntries.length > this.maxEntriesPerConversation) {
      // Sort by importance * recency
      conversationEntries.sort((a, b) => {
        const scoreA = a.importance * (1 - (Date.now() - a.timestamp) / this.defaultTTL);
        const scoreB = b.importance * (1 - (Date.now() - b.timestamp) / this.defaultTTL);
        return scoreB - scoreA;
      });

      // Keep top entries
      this.entries.set(conversationId, conversationEntries.slice(0, this.maxEntriesPerConversation));
    }

    logger.debug(`Working memory: Added to ${conversationId} (${conversationEntries.length} total)`);
  }

  /**
   * Recall recent context
   */
  recall(conversationId: string, limit: number = 20): WorkingMemoryEntry[] {
    const entries = this.entries.get(conversationId) || [];
    const now = Date.now();

    // Filter expired entries
    const valid = entries.filter(e => now - e.timestamp < e.ttl);

    // Update map
    if (valid.length !== entries.length) {
      this.entries.set(conversationId, valid);
    }

    // Return most recent
    return valid.slice(-limit);
  }

  /**
   * Clear old entries
   */
  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [conversationId, entries] of this.entries.entries()) {
      const valid = entries.filter(e => now - e.timestamp < e.ttl);
      cleaned += entries.length - valid.length;

      if (valid.length === 0) {
        this.entries.delete(conversationId);
      } else {
        this.entries.set(conversationId, valid);
      }
    }

    if (cleaned > 0) {
      logger.debug(`Working memory cleanup: Removed ${cleaned} expired entries`);
    }
  }

  /**
   * Get stats
   */
  getStats(): { conversations: number; totalEntries: number } {
    let totalEntries = 0;
    for (const entries of this.entries.values()) {
      totalEntries += entries.length;
    }

    return {
      conversations: this.entries.size,
      totalEntries,
    };
  }
}

// ==========================================
// EPISODIC MEMORY
// ==========================================

export class EpisodicMemory {
  private entries: Map<string, EpisodicMemoryEntry[]> = new Map(); // Keyed by guildId
  private maxEntriesPerGuild = 500; // Limit to prevent overflow
  private defaultTTL = 2592000000; // 30 days

  /**
   * Store episode
   */
  store(entry: Omit<EpisodicMemoryEntry, 'id' | 'ttl'>): void {
    const guildId = entry.guildId;

    if (!this.entries.has(guildId)) {
      this.entries.set(guildId, []);
    }

    const fullEntry: EpisodicMemoryEntry = {
      ...entry,
      id: `em_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ttl: this.defaultTTL * entry.importance, // Higher importance = longer retention
    };

    const guildEntries = this.entries.get(guildId)!;
    guildEntries.push(fullEntry);

    // Enforce limit (keep most important)
    if (guildEntries.length > this.maxEntriesPerGuild) {
      guildEntries.sort((a, b) => b.importance - a.importance);
      this.entries.set(guildId, guildEntries.slice(0, this.maxEntriesPerGuild));
    }

    logger.debug(`Episodic memory: Stored ${entry.type} for guild ${guildId}`);
  }

  /**
   * Recall episodes
   */
  recall(query: {
    guildId: string;
    type?: EpisodicMemoryEntry['type'];
    participants?: string[];
    limit?: number;
  }): EpisodicMemoryEntry[] {
    const entries = this.entries.get(query.guildId) || [];
    const now = Date.now();

    // Filter by validity and criteria
    let results = entries.filter(e => {
      // Check expiration
      if (now - e.timestamp > e.ttl) return false;

      // Check type
      if (query.type && e.type !== query.type) return false;

      // Check participants
      if (query.participants) {
        const hasParticipant = query.participants.some(p => e.participants.includes(p));
        if (!hasParticipant) return false;
      }

      return true;
    });

    // Sort by recency * importance
    results.sort((a, b) => {
      const scoreA = (1 - (now - a.timestamp) / this.defaultTTL) * a.importance;
      const scoreB = (1 - (now - b.timestamp) / this.defaultTTL) * b.importance;
      return scoreB - scoreA;
    });

    // Limit results
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Cleanup old episodes
   */
  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [guildId, entries] of this.entries.entries()) {
      const valid = entries.filter(e => now - e.timestamp < e.ttl);
      cleaned += entries.length - valid.length;

      if (valid.length === 0) {
        this.entries.delete(guildId);
      } else {
        this.entries.set(guildId, valid);
      }
    }

    if (cleaned > 0) {
      logger.info(`Episodic memory cleanup: Removed ${cleaned} expired episodes`);
    }
  }

  /**
   * Get stats
   */
  getStats(): { guilds: number; totalEpisodes: number } {
    let totalEpisodes = 0;
    for (const entries of this.entries.values()) {
      totalEpisodes += entries.length;
    }

    return {
      guilds: this.entries.size,
      totalEpisodes,
    };
  }
}

// ==========================================
// SEMANTIC MEMORY
// ==========================================

export class SemanticMemory {
  private entries: Map<string, SemanticMemoryEntry[]> = new Map(); // Keyed by guildId
  private storage: StorageService;

  constructor(storage: StorageService) {
    this.storage = storage;
    // Load from storage asynchronously (non-blocking)
    this.loadFromStorage().catch(err => {
      logger.error('Initial load failed:', err);
    });
  }

  /**
   * Learn new concept/pattern
   */
  async learn(entry: Omit<SemanticMemoryEntry, 'id' | 'reinforcements'>): Promise<void> {
    const guildId = entry.guildId;

    if (!this.entries.has(guildId)) {
      this.entries.set(guildId, []);
    }

    // Check if similar concept already exists
    const existing = this.findSimilar(entry.type, entry.content, guildId);

    if (existing) {
      // Reinforce existing concept
      existing.reinforcements++;
      existing.confidence = Math.min(1.0, existing.confidence + 0.1);
      existing.evidence.push(...entry.evidence);

      logger.debug(`Semantic memory: Reinforced "${entry.content}" (confidence: ${(existing.confidence * 100).toFixed(0)}%)`);
    } else {
      // Create new concept
      const fullEntry: SemanticMemoryEntry = {
        ...entry,
        id: `sm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        reinforcements: 1,
      };

      this.entries.get(guildId)!.push(fullEntry);
      logger.info(`Semantic memory: Learned new ${entry.type}: "${entry.content}"`);
    }

    await this.saveToStorage();
  }

  /**
   * Recall knowledge
   */
  recall(query: {
    guildId: string;
    type?: SemanticMemoryEntry['type'];
    minConfidence?: number;
  }): SemanticMemoryEntry[] {
    const entries = this.entries.get(query.guildId) || [];

    let results = entries.filter(e => {
      // Check type
      if (query.type && e.type !== query.type) return false;

      // Check confidence
      if (query.minConfidence && e.confidence < query.minConfidence) return false;

      return true;
    });

    // Sort by confidence * reinforcements
    results.sort((a, b) => {
      const scoreA = a.confidence * Math.log(a.reinforcements + 1);
      const scoreB = b.confidence * Math.log(b.reinforcements + 1);
      return scoreB - scoreA;
    });

    return results;
  }

  /**
   * Find similar concept
   */
  private findSimilar(type: string, content: string, guildId: string): SemanticMemoryEntry | null {
    const entries = this.entries.get(guildId) || [];

    // Simple similarity check (could be improved with embeddings)
    for (const entry of entries) {
      if (entry.type === type) {
        const similarity = this.calculateSimilarity(entry.content, content);
        if (similarity > 0.7) {
          return entry;
        }
      }
    }

    return null;
  }

  /**
   * Calculate string similarity (Jaccard index)
   */
  private calculateSimilarity(a: string, b: string): number {
    const setA = new Set(a.toLowerCase().split(/\s+/));
    const setB = new Set(b.toLowerCase().split(/\s+/));

    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    return intersection.size / union.size;
  }

  /**
   * Persist to storage
   */
  private async saveToStorage(): Promise<void> {
    try {
      const data: any = {};
      for (const [guildId, entries] of this.entries.entries()) {
        data[guildId] = entries;
      }
      await this.storage.write('memories', 'semantic_memory.json', data);
    } catch (error) {
      logger.error('Failed to save semantic memory:', error);
    }
  }

  /**
   * Load from storage
   */
  private async loadFromStorage(): Promise<void> {
    try {
      const data = await this.storage.read<any>('memories', 'semantic_memory.json');
      if (data) {
        for (const [guildId, entries] of Object.entries(data)) {
          this.entries.set(guildId, entries as SemanticMemoryEntry[]);
        }
        logger.info(`Loaded semantic memory: ${this.entries.size} guilds`);
      }
    } catch (error) {
      logger.error('Failed to load semantic memory:', error);
    }
  }

  /**
   * Get stats
   */
  getStats(): { guilds: number; totalConcepts: number } {
    let totalConcepts = 0;
    for (const entries of this.entries.values()) {
      totalConcepts += entries.length;
    }

    return {
      guilds: this.entries.size,
      totalConcepts,
    };
  }
}

// ==========================================
// MEMORY SPINE
// ==========================================

export class MemorySpine {
  private workingMemory: WorkingMemory;
  private episodicMemory: EpisodicMemory;
  private semanticMemory: SemanticMemory;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(storage: StorageService) {
    this.workingMemory = new WorkingMemory();
    this.episodicMemory = new EpisodicMemory();
    this.semanticMemory = new SemanticMemory(storage);

    // Start cleanup scheduler
    this.startCleanupScheduler();

    logger.info('MemorySpine initialized (Working → Episodic → Semantic)');
  }

  /**
   * Store new memory across appropriate systems
   */
  store(memory: {
    conversationId: string;
    guildId: string;
    userId: string;
    userName: string;
    content: string;
    importance: number;
    type?: 'message' | 'action' | 'event';
  }): void {
    // Always store in working memory
    this.workingMemory.add(memory.conversationId, {
      content: memory.content,
      timestamp: Date.now(),
      authorId: memory.userId,
      authorName: memory.userName,
      guildId: memory.guildId,
      channelId: memory.conversationId.split(':')[1] || 'unknown',
      importance: memory.importance,
    });

    // Store significant events in episodic memory
    if (memory.importance > 0.6) {
      this.episodicMemory.store({
        type: memory.type === 'action' ? 'moderation' : 'conversation',
        timestamp: Date.now(),
        guildId: memory.guildId,
        participants: [memory.userId],
        summary: memory.content.slice(0, 200),
        sentiment: 'neutral',
        importance: memory.importance,
        details: {
          content: memory.content,
        },
      });
    }
  }

  /**
   * Recall memories based on query
   */
  recall(query: MemoryQuery): MemoryRecallResult {
    const startTime = performance.now();
    const result: MemoryRecallResult = {
      working: [],
      episodic: [],
      semantic: [],
      totalRecalled: 0,
      recallTime: 0,
    };

    // Recall from working memory
    if (!query.type || query.type === 'working') {
      const conversationId = query.guildId ? `${query.guildId}:*` : '*';
      // Would need to implement wildcard search
      // For now, skip if no exact conversation ID
    }

    // Recall from episodic memory
    if (!query.type || query.type === 'episodic') {
      if (query.guildId) {
        result.episodic = this.episodicMemory.recall({
          guildId: query.guildId,
          participants: query.userId ? [query.userId] : undefined,
          limit: query.limit,
        });
      }
    }

    // Recall from semantic memory
    if (!query.type || query.type === 'semantic') {
      if (query.guildId) {
        result.semantic = this.semanticMemory.recall({
          guildId: query.guildId,
        });
      }
    }

    result.totalRecalled = result.working.length + result.episodic.length + result.semantic.length;
    result.recallTime = performance.now() - startTime;

    logger.debug(`Memory recall: ${result.totalRecalled} entries in ${result.recallTime.toFixed(2)}ms`);

    return result;
  }

  /**
   * Learn pattern/concept
   */
  async learnPattern(guildId: string, pattern: {
    type: SemanticMemoryEntry['type'];
    content: string;
    confidence: number;
    evidence: string[];
    permanent?: boolean;
  }): Promise<void> {
    await this.semanticMemory.learn({
      guildId,
      type: pattern.type,
      content: pattern.content,
      confidence: pattern.confidence,
      evidence: pattern.evidence,
      learnedAt: Date.now(),
      permanent: pattern.permanent || false,
    });
  }

  /**
   * Get comprehensive stats
   */
  getStats(): {
    working: { conversations: number; totalEntries: number };
    episodic: { guilds: number; totalEpisodes: number };
    semantic: { guilds: number; totalConcepts: number };
  } {
    return {
      working: this.workingMemory.getStats(),
      episodic: this.episodicMemory.getStats(),
      semantic: this.semanticMemory.getStats(),
    };
  }

  /**
   * Start cleanup scheduler
   */
  private startCleanupScheduler(): void {
    this.cleanupInterval = setInterval(() => {
      this.workingMemory.cleanup();
      this.episodicMemory.cleanup();
    }, 300000); // Every 5 minutes
  }

  /**
   * Stop memory spine
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    logger.info('MemorySpine stopped');
  }
}
