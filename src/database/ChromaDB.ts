/**
 * CHROMADB SERVICE - Vector Database for Semantic Memory
 *
 * Creates and manages 5 collections:
 * 1. messages - Message embeddings for semantic search
 * 2. user_behaviors - User pattern similarity detection
 * 3. learning_cases - Past decisions for case-based reasoning
 * 4. server_knowledge - Server-specific knowledge base (RAG)
 * 5. conversations - Conversation thread summaries
 */

import { ChromaClient, Collection, IncludeEnum } from 'chromadb';
import { createLogger } from '../services/Logger';
import { ENV } from '../config/environment';

const logger = createLogger('ChromaDB');

export interface VectorSearchResult {
  id: string;
  document: string;
  metadata: Record<string, any>;
  distance: number; // Lower = more similar
}

export class ChromaDBService {
  private client: ChromaClient;
  private collections: {
    messages?: Collection;
    userBehaviors?: Collection;
    learningCases?: Collection;
    serverKnowledge?: Collection;
    conversations?: Collection;
  } = {};

  constructor() {
    // Initialize ChromaDB client
    this.client = new ChromaClient({
      path: ENV.CHROMA_URL || 'http://localhost:8000',
      auth: {
        provider: 'token',
        credentials: ENV.CHROMA_TOKEN || 'becas_chroma_token_2025',
        providerOptions: 'X-Chroma-Token'
      }
    });
  }

  /**
   * Initialize all collections
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing ChromaDB collections...');

      // 1. Messages collection
      this.collections.messages = await this.client.getOrCreateCollection({
        name: 'messages',
        metadata: {
          description: 'Message embeddings for semantic search',
          'hnsw:space': 'cosine' // Cosine similarity for text
        }
      });

      // 2. User behaviors collection
      this.collections.userBehaviors = await this.client.getOrCreateCollection({
        name: 'user_behaviors',
        metadata: {
          description: 'User behavior patterns for similarity detection',
          'hnsw:space': 'cosine'
        }
      });

      // 3. Learning cases collection
      this.collections.learningCases = await this.client.getOrCreateCollection({
        name: 'learning_cases',
        metadata: {
          description: 'Past AI decisions for case-based reasoning',
          'hnsw:space': 'cosine'
        }
      });

      // 4. Server knowledge collection
      this.collections.serverKnowledge = await this.client.getOrCreateCollection({
        name: 'server_knowledge',
        metadata: {
          description: 'Server-specific knowledge base (RAG)',
          'hnsw:space': 'cosine'
        }
      });

      // 5. Conversations collection
      this.collections.conversations = await this.client.getOrCreateCollection({
        name: 'conversations',
        metadata: {
          description: 'Conversation thread summaries',
          'hnsw:space': 'cosine'
        }
      });

      logger.info('✅ All 5 ChromaDB collections initialized');
    } catch (error) {
      logger.error('Failed to initialize ChromaDB', error);
      throw error;
    }
  }

  /**
   * Add message embedding
   */
  async addMessage(
    messageId: string,
    content: string,
    embedding: number[],
    metadata: {
      userId: string;
      serverId: string;
      channelId: string;
      timestamp: number;
      toxicity?: number;
      sentiment?: string;
    }
  ): Promise<void> {
    if (!this.collections.messages) {
      throw new Error('Messages collection not initialized');
    }

    await this.collections.messages.add({
      ids: [messageId],
      embeddings: [embedding],
      documents: [content],
      metadatas: [metadata]
    });

    logger.debug(`Added message ${messageId} to vector database`);
  }

  /**
   * Search messages semantically
   */
  async searchMessages(
    queryEmbedding: number[],
    serverId?: string,
    limit = 10
  ): Promise<VectorSearchResult[]> {
    if (!this.collections.messages) {
      throw new Error('Messages collection not initialized');
    }

    const where = serverId ? { serverId } : undefined;

    const results = await this.collections.messages.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
      where,
      include: [IncludeEnum.documents, IncludeEnum.metadatas, IncludeEnum.distances]
    });

    return this.formatResults(results);
  }

  /**
   * Add user behavior embedding
   */
  async addUserBehavior(
    userId: string,
    serverId: string,
    behaviorSummary: string,
    embedding: number[],
    metadata: {
      trustScore: number;
      violationCount: number;
      messageCount: number;
      lastActive: number;
      riskCategory: string;
    }
  ): Promise<void> {
    if (!this.collections.userBehaviors) {
      throw new Error('User behaviors collection not initialized');
    }

    const id = `${serverId}:${userId}`;

    await this.collections.userBehaviors.upsert({
      ids: [id],
      embeddings: [embedding],
      documents: [behaviorSummary],
      metadatas: [{ userId, serverId, ...metadata }]
    });

    logger.debug(`Updated user behavior for ${userId} in vector database`);
  }

  /**
   * Find similar users (for scammer detection, alt accounts, etc.)
   */
  async findSimilarUsers(
    userEmbedding: number[],
    serverId?: string,
    limit = 5
  ): Promise<VectorSearchResult[]> {
    if (!this.collections.userBehaviors) {
      throw new Error('User behaviors collection not initialized');
    }

    const where = serverId ? { serverId } : undefined;

    const results = await this.collections.userBehaviors.query({
      queryEmbeddings: [userEmbedding],
      nResults: limit,
      where,
      include: [IncludeEnum.documents, IncludeEnum.metadatas, IncludeEnum.distances]
    });

    return this.formatResults(results);
  }

  /**
   * Add learning case (AI decision with outcome)
   */
  async addLearningCase(
    caseId: string,
    situation: string,
    embedding: number[],
    metadata: {
      intent: string;
      decision: string;
      outcome: 'success' | 'failure' | 'overridden';
      confidence: number;
      serverId: string;
      timestamp: number;
    }
  ): Promise<void> {
    if (!this.collections.learningCases) {
      throw new Error('Learning cases collection not initialized');
    }

    await this.collections.learningCases.add({
      ids: [caseId],
      embeddings: [embedding],
      documents: [situation],
      metadatas: [metadata]
    });

    logger.debug(`Added learning case ${caseId} to vector database`);
  }

  /**
   * Find similar past cases (case-based reasoning)
   */
  async findSimilarCases(
    situationEmbedding: number[],
    intent?: string,
    limit = 5
  ): Promise<VectorSearchResult[]> {
    if (!this.collections.learningCases) {
      throw new Error('Learning cases collection not initialized');
    }

    const where = intent ? { intent } : undefined;

    const results = await this.collections.learningCases.query({
      queryEmbeddings: [situationEmbedding],
      nResults: limit,
      where,
      include: [IncludeEnum.documents, IncludeEnum.metadatas, IncludeEnum.distances]
    });

    return this.formatResults(results);
  }

  /**
   * Add server knowledge (rules, FAQs, etc.)
   */
  async addServerKnowledge(
    knowledgeId: string,
    content: string,
    embedding: number[],
    metadata: {
      serverId: string;
      type: 'rule' | 'faq' | 'guideline' | 'policy';
      category?: string;
      createdAt: number;
    }
  ): Promise<void> {
    if (!this.collections.serverKnowledge) {
      throw new Error('Server knowledge collection not initialized');
    }

    await this.collections.serverKnowledge.add({
      ids: [knowledgeId],
      embeddings: [embedding],
      documents: [content],
      metadatas: [metadata]
    });

    logger.debug(`Added server knowledge ${knowledgeId} to vector database`);
  }

  /**
   * Search server knowledge (RAG - Retrieval Augmented Generation)
   */
  async searchKnowledge(
    queryEmbedding: number[],
    serverId: string,
    limit = 3
  ): Promise<VectorSearchResult[]> {
    if (!this.collections.serverKnowledge) {
      throw new Error('Server knowledge collection not initialized');
    }

    const results = await this.collections.serverKnowledge.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
      where: { serverId },
      include: [IncludeEnum.documents, IncludeEnum.metadatas, IncludeEnum.distances]
    });

    return this.formatResults(results);
  }

  /**
   * Add conversation summary
   */
  async addConversation(
    conversationId: string,
    summary: string,
    embedding: number[],
    metadata: {
      serverId: string;
      channelId: string;
      participantCount: number;
      messageCount: number;
      topic?: string;
      sentiment?: string;
      hadConflict: boolean;
      timestamp: number;
    }
  ): Promise<void> {
    if (!this.collections.conversations) {
      throw new Error('Conversations collection not initialized');
    }

    await this.collections.conversations.add({
      ids: [conversationId],
      embeddings: [embedding],
      documents: [summary],
      metadatas: [metadata]
    });

    logger.debug(`Added conversation ${conversationId} to vector database`);
  }

  /**
   * Find similar conversations
   */
  async findSimilarConversations(
    queryEmbedding: number[],
    serverId?: string,
    limit = 5
  ): Promise<VectorSearchResult[]> {
    if (!this.collections.conversations) {
      throw new Error('Conversations collection not initialized');
    }

    const where = serverId ? { serverId } : undefined;

    const results = await this.collections.conversations.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
      where,
      include: [IncludeEnum.documents, IncludeEnum.metadatas, IncludeEnum.distances]
    });

    return this.formatResults(results);
  }

  /**
   * Format ChromaDB query results
   */
  private formatResults(results: any): VectorSearchResult[] {
    if (!results.ids || !results.ids[0]) return [];

    const formatted: VectorSearchResult[] = [];

    for (let i = 0; i < results.ids[0].length; i++) {
      formatted.push({
        id: results.ids[0][i],
        document: results.documents?.[0]?.[i] || '',
        metadata: results.metadatas?.[0]?.[i] || {},
        distance: results.distances?.[0]?.[i] || 1.0
      });
    }

    return formatted;
  }

  /**
   * Get collection count
   */
  async getCollectionCount(collectionName: keyof typeof this.collections): Promise<number> {
    const collection = this.collections[collectionName];
    if (!collection) return 0;

    const count = await collection.count();
    return count;
  }

  /**
   * Test connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.client.heartbeat();
      return true;
    } catch (error) {
      logger.error('ChromaDB connection failed', error);
      return false;
    }
  }

  /**
   * Reset collection (DANGER - only for development)
   */
  async resetCollection(collectionName: keyof typeof this.collections): Promise<void> {
    try {
      await this.client.deleteCollection({ name: collectionName });
      logger.warn(`Collection ${collectionName} deleted`);

      // Reinitialize
      await this.initialize();
    } catch (error) {
      logger.error(`Failed to reset collection ${collectionName}`, error);
    }
  }

  /**
   * Generic method to add document to any collection (for PatternRecognition compatibility)
   */
  async addDocument(
    collectionName: string,
    document: {
      id: string;
      embedding: number[];
      metadata: Record<string, any>;
      document: string;
    }
  ): Promise<void> {
    try {
      const collection = await this.client.getOrCreateCollection({
        name: collectionName,
        metadata: { 'hnsw:space': 'cosine' }
      });

      await collection.add({
        ids: [document.id],
        embeddings: [document.embedding],
        documents: [document.document],
        metadatas: [document.metadata]
      });

      logger.debug(`Added document ${document.id} to ${collectionName}`);
    } catch (error) {
      logger.error(`Failed to add document to ${collectionName}`, error);
      throw error;
    }
  }

  /**
   * Generic method to query any collection (for PatternRecognition compatibility)
   */
  async queryCollection(
    collectionName: string,
    params: {
      queryEmbeddings: number[][];
      nResults: number;
      where?: Record<string, any>;
    }
  ): Promise<any> {
    try {
      const collection = await this.client.getOrCreateCollection({
        name: collectionName,
        metadata: { 'hnsw:space': 'cosine' }
      });

      const results = await collection.query({
        queryEmbeddings: params.queryEmbeddings,
        nResults: params.nResults,
        where: params.where,
        include: [IncludeEnum.documents, IncludeEnum.metadatas, IncludeEnum.distances]
      });

      return results;
    } catch (error) {
      logger.error(`Failed to query ${collectionName}`, error);
      throw error;
    }
  }
}
