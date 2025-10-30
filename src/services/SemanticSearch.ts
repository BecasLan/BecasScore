/**
 * SEMANTIC SEARCH - High-Level Search Interface
 *
 * Provides semantic search features:
 * - Message search ("What did users say about X?")
 * - Similar user detection (find users like known scammer)
 * - Case-based reasoning (find similar past decisions)
 * - RAG context retrieval (get relevant server knowledge)
 */

import { ChromaDBService, VectorSearchResult } from '../database/ChromaDB';
import { EmbeddingService } from './EmbeddingService';
import { createLogger } from './Logger';

const logger = createLogger('SemanticSearch');

export interface MessageSearchResult {
  messageId: string;
  content: string;
  userId: string;
  timestamp: number;
  similarity: number; // 0-1, higher is more similar
  metadata: {
    toxicity?: number;
    sentiment?: string;
  };
}

export interface SimilarUserResult {
  userId: string;
  serverId: string;
  behaviorSummary: string;
  similarity: number;
  trustScore: number;
  riskCategory: string;
}

export interface SimilarCaseResult {
  caseId: string;
  situation: string;
  decision: string;
  outcome: 'success' | 'failure' | 'overridden';
  similarity: number;
  confidence: number;
}

export class SemanticSearch {
  constructor(
    private chromaDB: ChromaDBService,
    private embeddingService: EmbeddingService
  ) {}

  /**
   * Search messages semantically
   */
  async searchMessages(
    query: string,
    serverId?: string,
    limit = 10
  ): Promise<MessageSearchResult[]> {
    logger.info(`Searching messages for: "${query}"`);

    // Generate embedding for query
    const queryEmbedding = await this.embeddingService.generateEmbedding(query);

    // Search ChromaDB
    const results = await this.chromaDB.searchMessages(
      queryEmbedding.embedding,
      serverId,
      limit
    );

    // Format results
    return results.map(r => ({
      messageId: r.id,
      content: r.document,
      userId: r.metadata.userId,
      timestamp: r.metadata.timestamp,
      similarity: this.distanceToSimilarity(r.distance),
      metadata: {
        toxicity: r.metadata.toxicity,
        sentiment: r.metadata.sentiment
      }
    }));
  }

  /**
   * Find similar users (for scammer detection, alt accounts)
   */
  async findSimilarUsers(
    targetUserId: string,
    serverId: string,
    limit = 5
  ): Promise<SimilarUserResult[]> {
    logger.info(`Finding users similar to ${targetUserId}`);

    // Get target user's behavior embedding (would need to be stored first)
    // For now, we'll query based on existing data

    const results = await this.chromaDB.findSimilarUsers(
      [], // This would be the target user's embedding
      serverId,
      limit
    );

    return results.map(r => ({
      userId: r.metadata.userId,
      serverId: r.metadata.serverId,
      behaviorSummary: r.document,
      similarity: this.distanceToSimilarity(r.distance),
      trustScore: r.metadata.trustScore,
      riskCategory: r.metadata.riskCategory
    }));
  }

  /**
   * Find similar past decisions (case-based reasoning)
   */
  async findSimilarCases(
    currentSituation: string,
    intent?: string,
    limit = 5
  ): Promise<SimilarCaseResult[]> {
    logger.info(`Finding similar past cases for: "${currentSituation}"`);

    // Generate embedding for current situation
    const situationEmbedding = await this.embeddingService.generateEmbedding(currentSituation);

    // Search learning cases
    const results = await this.chromaDB.findSimilarCases(
      situationEmbedding.embedding,
      intent,
      limit
    );

    return results.map(r => ({
      caseId: r.id,
      situation: r.document,
      decision: r.metadata.decision,
      outcome: r.metadata.outcome,
      similarity: this.distanceToSimilarity(r.distance),
      confidence: r.metadata.confidence
    }));
  }

  /**
   * Search server knowledge (RAG - Retrieval Augmented Generation)
   */
  async searchKnowledge(
    query: string,
    serverId: string,
    limit = 3
  ): Promise<{ id: string; content: string; type: string; similarity: number }[]> {
    logger.info(`Searching server knowledge for: "${query}"`);

    // Generate embedding for query
    const queryEmbedding = await this.embeddingService.generateEmbedding(query);

    // Search knowledge base
    const results = await this.chromaDB.searchKnowledge(
      queryEmbedding.embedding,
      serverId,
      limit
    );

    return results.map(r => ({
      id: r.id,
      content: r.document,
      type: r.metadata.type,
      similarity: this.distanceToSimilarity(r.distance)
    }));
  }

  /**
   * Find similar conversations
   */
  async findSimilarConversations(
    description: string,
    serverId?: string,
    limit = 5
  ): Promise<any[]> {
    logger.info(`Finding similar conversations for: "${description}"`);

    // Generate embedding for description
    const queryEmbedding = await this.embeddingService.generateEmbedding(description);

    // Search conversations
    const results = await this.chromaDB.findSimilarConversations(
      queryEmbedding.embedding,
      serverId,
      limit
    );

    return results.map(r => ({
      conversationId: r.id,
      summary: r.document,
      topic: r.metadata.topic,
      participantCount: r.metadata.participantCount,
      sentiment: r.metadata.sentiment,
      hadConflict: r.metadata.hadConflict,
      similarity: this.distanceToSimilarity(r.distance),
      timestamp: r.metadata.timestamp
    }));
  }

  /**
   * Detect alt accounts (find users with very similar behavior)
   */
  async detectAltAccounts(
    suspectUserId: string,
    serverId: string,
    similarityThreshold = 0.90
  ): Promise<SimilarUserResult[]> {
    logger.info(`Checking for alt accounts of ${suspectUserId}`);

    const similarUsers = await this.findSimilarUsers(suspectUserId, serverId, 10);

    // Filter by high similarity threshold
    return similarUsers.filter(u =>
      u.similarity >= similarityThreshold &&
      u.userId !== suspectUserId // Exclude self
    );
  }

  /**
   * Get contextual knowledge for AI decision (RAG)
   */
  async getContextForDecision(
    situation: string,
    serverId: string
  ): Promise<{
    relevantKnowledge: string[];
    similarCases: SimilarCaseResult[];
  }> {
    logger.info('Retrieving context for AI decision');

    // Get relevant server knowledge
    const knowledge = await this.searchKnowledge(situation, serverId, 3);
    const relevantKnowledge = knowledge.map(k => k.content);

    // Get similar past cases
    const similarCases = await this.findSimilarCases(situation, undefined, 3);

    return {
      relevantKnowledge,
      similarCases
    };
  }

  /**
   * Convert distance (lower = better) to similarity (higher = better)
   */
  private distanceToSimilarity(distance: number): number {
    // Cosine distance is 0-2, convert to similarity 0-1
    // distance = 0 → similarity = 1 (identical)
    // distance = 2 → similarity = 0 (opposite)
    return Math.max(0, 1 - (distance / 2));
  }

  /**
   * Check if semantic search is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      return await this.chromaDB.testConnection();
    } catch (error) {
      logger.error('Semantic search unavailable', error);
      return false;
    }
  }

  /**
   * Get statistics
   */
  async getStatistics(): Promise<{
    messagesIndexed: number;
    usersIndexed: number;
    casesIndexed: number;
    knowledgeItems: number;
    conversationsIndexed: number;
  }> {
    return {
      messagesIndexed: await this.chromaDB.getCollectionCount('messages'),
      usersIndexed: await this.chromaDB.getCollectionCount('userBehaviors'),
      casesIndexed: await this.chromaDB.getCollectionCount('learningCases'),
      knowledgeItems: await this.chromaDB.getCollectionCount('serverKnowledge'),
      conversationsIndexed: await this.chromaDB.getCollectionCount('conversations')
    };
  }
}
