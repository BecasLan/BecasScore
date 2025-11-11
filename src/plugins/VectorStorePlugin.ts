/**
 * VECTOR STORE PLUGIN
 *
 * Stores message embeddings for semantic search and retrieval.
 * Enables context-aware moderation and intelligent memory retrieval.
 *
 * Architecture:
 * MessageReceivedEvent → VectorStorePlugin → Generate Embedding → Store in Vector DB
 *
 * Use Cases:
 * - Find similar past violations
 * - Retrieve relevant context for moderation decisions
 * - Pattern detection across messages
 * - Semantic memory for conversations
 */

import { Plugin, BecasKernel } from '../kernel/BecasKernel';
import { MessageReceivedEvent } from '../domain/events/DomainEvent';
import { EmbeddingService } from '../services/EmbeddingService';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

const logger = createLogger('VectorStorePlugin');

export interface VectorEntry {
  id: string; // Message ID
  embedding: number[];
  metadata: {
    content: string;
    authorId: string;
    guildId: string;
    channelId: string;
    timestamp: Date;
    // Optional enrichment
    wasViolation?: boolean;
    violationType?: string;
    trustScoreAtTime?: number;
  };
}

export interface SearchResult {
  entry: VectorEntry;
  similarity: number; // 0-1 (1 = most similar)
  rank: number;
}

/**
 * VectorStorePlugin - In-memory vector store with semantic search
 *
 * Future: Can be extended to use external vector databases:
 * - Pinecone
 * - Weaviate
 * - Qdrant
 * - Chroma
 */
export class VectorStorePlugin implements Plugin {
  name = 'vector_store';
  version = '1.0.0';
  description = 'Semantic message storage and retrieval';
  dependencies = []; // No dependencies

  private kernel!: BecasKernel;
  private embeddingService!: EmbeddingService;

  // In-memory vector store (for now)
  private vectors: Map<string, VectorEntry> = new Map();

  // Per-guild indexes for efficient retrieval
  private guildIndex: Map<string, Set<string>> = new Map(); // guildId -> messageIds
  private violationIndex: Set<string> = new Set(); // messageIds that were violations

  // Configuration
  private readonly MAX_VECTORS_PER_GUILD = 10000; // Limit per guild to avoid memory issues
  private readonly SIMILARITY_THRESHOLD = 0.7; // Minimum similarity for search results

  /**
   * Initialize plugin
   */
  async initialize(kernel: BecasKernel): Promise<void> {
    this.kernel = kernel;

    logger.info('🔍 Initializing Vector Store Plugin...');

    // Get OllamaService from kernel
    const ollamaService = kernel.getService<OllamaService>('ollama');
    if (!ollamaService) {
      throw new Error('OllamaService not found - required for embeddings');
    }

    // Initialize EmbeddingService
    this.embeddingService = new EmbeddingService(ollamaService);

    // Subscribe to message events
    const eventBus = kernel.getEventBus();
    eventBus.on<MessageReceivedEvent['payload']>(
      'message.received',
      this.handleMessage.bind(this)
    );

    // Subscribe to violation events to mark vectors
    eventBus.on('violation.detected', this.markViolation.bind(this));

    logger.info('✅ Vector Store Plugin initialized');
    logger.info(`   → Subscribed to: message.received, violation.detected`);
    logger.info(`   → Embedding model: ${this.embeddingService.getModel()}`);
  }

  /**
   * Handle message event - generate and store embedding
   */
  private async handleMessage(event: MessageReceivedEvent): Promise<void> {
    try {
      const { messageId, content, authorId, guildId, channelId, timestamp } = event.payload;

      // Skip empty messages or very short messages
      if (!content || content.trim().length < 3) {
        return;
      }

      // Check if guild has too many vectors
      const guildVectors = this.guildIndex.get(guildId);
      if (guildVectors && guildVectors.size >= this.MAX_VECTORS_PER_GUILD) {
        logger.debug(`Guild ${guildId} at max capacity (${this.MAX_VECTORS_PER_GUILD} vectors)`);
        return; // Could implement LRU eviction here
      }

      // Generate embedding
      logger.debug(`Generating embedding for message ${messageId}`);
      const embeddingResult = await this.embeddingService.generateEmbedding(content);

      // Store vector
      const vectorEntry: VectorEntry = {
        id: messageId,
        embedding: embeddingResult.embedding,
        metadata: {
          content,
          authorId,
          guildId,
          channelId,
          timestamp: timestamp || new Date(),
        },
      };

      this.vectors.set(messageId, vectorEntry);

      // Update guild index
      if (!this.guildIndex.has(guildId)) {
        this.guildIndex.set(guildId, new Set());
      }
      this.guildIndex.get(guildId)!.add(messageId);

      logger.debug(`✅ Stored vector for message ${messageId} (${guildId})`);
    } catch (error: any) {
      logger.error('Failed to handle message for vector store:', error);
    }
  }

  /**
   * Mark a message as a violation for filtering
   */
  private async markViolation(event: any): Promise<void> {
    try {
      const messageId = event.payload?.messageId;
      const violationType = event.payload?.violationType;

      if (!messageId) return;

      // Mark in violation index
      this.violationIndex.add(messageId);

      // Update vector metadata if exists
      const vector = this.vectors.get(messageId);
      if (vector) {
        vector.metadata.wasViolation = true;
        vector.metadata.violationType = violationType;
      }

      logger.debug(`Marked message ${messageId} as violation (${violationType})`);
    } catch (error: any) {
      logger.error('Failed to mark violation:', error);
    }
  }

  /**
   * Semantic search - find similar messages
   */
  async semanticSearch(
    query: string,
    options: {
      guildId?: string;
      topK?: number;
      minSimilarity?: number;
      onlyViolations?: boolean;
    } = {}
  ): Promise<SearchResult[]> {
    try {
      const topK = options.topK || 5;
      const minSimilarity = options.minSimilarity || this.SIMILARITY_THRESHOLD;

      // Generate query embedding
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);

      // Get candidate vectors (filter by guild if specified)
      let candidates: VectorEntry[] = [];
      if (options.guildId) {
        const guildVectorIds = this.guildIndex.get(options.guildId);
        if (guildVectorIds) {
          candidates = Array.from(guildVectorIds)
            .map(id => this.vectors.get(id))
            .filter((v): v is VectorEntry => v !== undefined);
        }
      } else {
        candidates = Array.from(this.vectors.values());
      }

      // Filter violations if requested
      if (options.onlyViolations) {
        candidates = candidates.filter(v => this.violationIndex.has(v.id));
      }

      // Calculate similarities
      const results: SearchResult[] = candidates
        .map((entry, index) => ({
          entry,
          similarity: this.embeddingService.cosineSimilarity(
            queryEmbedding.embedding,
            entry.embedding
          ),
          rank: index,
        }))
        .filter(r => r.similarity >= minSimilarity)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK)
        .map((r, index) => ({ ...r, rank: index + 1 }));

      logger.info(
        `Semantic search: "${query.substring(0, 50)}..." → ${results.length} results (topK=${topK})`
      );

      return results;
    } catch (error: any) {
      logger.error('Semantic search failed:', error);
      return [];
    }
  }

  /**
   * Find similar violations to a message
   */
  async findSimilarViolations(
    messageId: string,
    guildId: string,
    topK: number = 5
  ): Promise<SearchResult[]> {
    const vector = this.vectors.get(messageId);
    if (!vector) {
      logger.warn(`Vector not found for message ${messageId}`);
      return [];
    }

    // Search for similar violations in the same guild
    return this.semanticSearch(vector.metadata.content, {
      guildId,
      topK,
      onlyViolations: true,
    });
  }

  /**
   * Get vector by message ID
   */
  getVector(messageId: string): VectorEntry | undefined {
    return this.vectors.get(messageId);
  }

  /**
   * Get all vectors for a guild
   */
  getGuildVectors(guildId: string): VectorEntry[] {
    const vectorIds = this.guildIndex.get(guildId);
    if (!vectorIds) return [];

    return Array.from(vectorIds)
      .map(id => this.vectors.get(id))
      .filter((v): v is VectorEntry => v !== undefined);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalVectors: number;
    totalGuilds: number;
    totalViolations: number;
    vectorsPerGuild: Record<string, number>;
  } {
    const vectorsPerGuild: Record<string, number> = {};
    for (const [guildId, vectorIds] of this.guildIndex) {
      vectorsPerGuild[guildId] = vectorIds.size;
    }

    return {
      totalVectors: this.vectors.size,
      totalGuilds: this.guildIndex.size,
      totalViolations: this.violationIndex.size,
      vectorsPerGuild,
    };
  }

  /**
   * Clear all vectors for a guild
   */
  clearGuild(guildId: string): void {
    const vectorIds = this.guildIndex.get(guildId);
    if (!vectorIds) return;

    for (const id of vectorIds) {
      this.vectors.delete(id);
      this.violationIndex.delete(id);
    }

    this.guildIndex.delete(guildId);
    logger.info(`Cleared ${vectorIds.size} vectors for guild ${guildId}`);
  }

  /**
   * Shutdown plugin
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Vector Store Plugin...');

    const stats = this.getStats();
    logger.info(`   → ${stats.totalVectors} vectors stored`);
    logger.info(`   → ${stats.totalGuilds} guilds indexed`);
    logger.info(`   → ${stats.totalViolations} violations marked`);

    // TODO: Persist vectors to database before shutdown
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return true; // Always healthy (in-memory)
  }
}
