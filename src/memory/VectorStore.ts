/**
 * VECTOR STORE - Long-term semantic memory with ChromaDB
 *
 * Purpose: Store and retrieve semantic memories
 * - Conversation history embeddings
 * - Directive/policy embeddings
 * - User behavior patterns
 * - Outcome feedback (what worked, what didn't)
 *
 * Uses: ChromaDB for vector storage + semantic search
 */

import { ChromaClient, Collection } from 'chromadb';
import { createLogger } from '../services/Logger';
import { SemanticLayer } from '../ai/SemanticLayer';

const logger = createLogger('VectorStore');

export interface MemoryEntry {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    timestamp: number;
    guildId?: string;
    userId?: string;
    type: 'conversation' | 'directive' | 'outcome' | 'pattern';
    [key: string]: any;
  };
}

export interface SearchResult {
  id: string;
  text: string;
  distance: number; // Lower = more similar
  metadata: any;
}

export class VectorStore {
  private client: ChromaClient | null = null;
  private collection: Collection | null = null;
  private semanticLayer: SemanticLayer;
  private isInitialized = false;

  constructor() {
    this.semanticLayer = new SemanticLayer();
    logger.info('VectorStore created (not connected yet)');
  }

  /**
   * Initialize connection to ChromaDB
   */
  async initialize(collectionName = 'becas_memory'): Promise<void> {
    if (this.isInitialized) return;

    try {
      logger.info('Connecting to ChromaDB...');

      // Connect to ChromaDB (local instance)
      this.client = new ChromaClient({
        path: 'http://localhost:8000', // Default ChromaDB port
      });

      // Get or create collection
      try {
        this.collection = await this.client.getOrCreateCollection({
          name: collectionName,
          metadata: { description: 'Becas AI semantic memory store' },
        });
        logger.info(`Connected to collection: ${collectionName}`);
      } catch (error) {
        logger.warn('ChromaDB not available, running in memory-only mode');
        // Continue without ChromaDB - use in-memory fallback
      }

      // Initialize semantic layer
      await this.semanticLayer.initialize();

      this.isInitialized = true;
      logger.info('VectorStore initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize VectorStore', error);
      logger.warn('VectorStore will operate in degraded mode (no persistence)');
      // Don't throw - allow system to continue without vector store
    }
  }

  /**
   * Store a memory with automatic embedding
   */
  async store(entry: Omit<MemoryEntry, 'embedding'>): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Generate embedding
      const embedding = await this.semanticLayer.embed(entry.text);

      // Store in ChromaDB if available
      if (this.collection) {
        await this.collection.add({
          ids: [entry.id],
          embeddings: [embedding],
          metadatas: [entry.metadata],
          documents: [entry.text],
        });

        logger.debug(`Stored memory: ${entry.id} (${entry.metadata.type})`);
      }

    } catch (error) {
      logger.error('Failed to store memory', error);
      // Don't throw - memory system should degrade gracefully
    }
  }

  /**
   * Store multiple memories (batch)
   */
  async storeBatch(entries: Array<Omit<MemoryEntry, 'embedding'>>): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Generate all embeddings
      const texts = entries.map(e => e.text);
      const embeddings = await this.semanticLayer.embedBatch(texts);

      // Store in ChromaDB
      if (this.collection) {
        await this.collection.add({
          ids: entries.map(e => e.id),
          embeddings,
          metadatas: entries.map(e => e.metadata) as any,
          documents: texts,
        });

        logger.info(`Stored ${entries.length} memories in batch`);
      }

    } catch (error) {
      logger.error('Failed to store batch memories', error);
    }
  }

  /**
   * Search for similar memories
   */
  async search(
    query: string,
    options: {
      topK?: number;
      filter?: any;
      type?: 'conversation' | 'directive' | 'outcome' | 'pattern';
    } = {}
  ): Promise<SearchResult[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.collection) {
      logger.warn('ChromaDB not available, returning empty results');
      return [];
    }

    try {
      // Generate query embedding
      const queryEmbedding = await this.semanticLayer.embed(query);

      // Build filter
      const where = options.filter || (options.type ? { type: options.type } : undefined);

      // Search ChromaDB
      const results = await this.collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: options.topK || 5,
        where,
      });

      // Transform results
      const searchResults: SearchResult[] = [];
      if (results.ids[0] && results.documents[0] && results.distances[0]) {
        for (let i = 0; i < results.ids[0].length; i++) {
          searchResults.push({
            id: results.ids[0][i],
            text: results.documents[0][i] as string,
            distance: results.distances[0][i] || 0,
            metadata: results.metadatas?.[0]?.[i] || {},
          });
        }
      }

      logger.debug(`Found ${searchResults.length} similar memories for query: "${query.substring(0, 50)}..."`);

      return searchResults;

    } catch (error) {
      logger.error('Search failed', error);
      return [];
    }
  }

  /**
   * Get memory by ID
   */
  async get(id: string): Promise<SearchResult | null> {
    if (!this.collection) return null;

    try {
      const results = await this.collection.get({
        ids: [id],
      });

      if (results.ids.length === 0) return null;

      return {
        id: results.ids[0],
        text: results.documents?.[0] as string || '',
        distance: 0,
        metadata: results.metadatas?.[0] || {},
      };

    } catch (error) {
      logger.error('Failed to get memory', error);
      return null;
    }
  }

  /**
   * Delete memory
   */
  async delete(id: string): Promise<void> {
    if (!this.collection) return;

    try {
      await this.collection.delete({
        ids: [id],
      });
      logger.debug(`Deleted memory: ${id}`);
    } catch (error) {
      logger.error('Failed to delete memory', error);
    }
  }

  /**
   * Clear all memories (dangerous!)
   */
  async clear(): Promise<void> {
    if (!this.collection) return;

    try {
      // Delete collection and recreate
      await this.client?.deleteCollection({ name: this.collection.name });
      this.collection = await this.client?.createCollection({
        name: this.collection.name,
      }) || null;

      logger.warn('All memories cleared!');
    } catch (error) {
      logger.error('Failed to clear memories', error);
    }
  }

  /**
   * Get collection stats
   */
  async getStats() {
    if (!this.collection) {
      return {
        count: 0,
        isAvailable: false,
      };
    }

    try {
      const count = await this.collection.count();
      return {
        count,
        isAvailable: true,
        collectionName: this.collection.name,
      };
    } catch (error) {
      return {
        count: 0,
        isAvailable: false,
      };
    }
  }
}
