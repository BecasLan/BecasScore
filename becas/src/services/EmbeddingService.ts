/**
 * EMBEDDING SERVICE - Text to Vector Conversion
 *
 * Converts text to embeddings using Ollama's embedding models.
 * Uses local models (FREE) for cost efficiency.
 *
 * Recommended models:
 * - nomic-embed-text (fastest, good quality)
 * - mxbai-embed-large (best quality, slower)
 * - all-minilm (smallest, fast)
 */

import { OllamaService } from './OllamaService';
import Redis from 'ioredis';
import { getRedisClient } from '../database/config';
import { createLogger } from './Logger';
import crypto from 'crypto';

const logger = createLogger('EmbeddingService');

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  cached: boolean;
}

export class EmbeddingService {
  private redis: Redis | null = null;
  private readonly CACHE_TTL = 86400; // 24 hours
  private readonly EMBEDDING_MODEL = 'nomic-embed-text'; // Default model

  constructor(private ollama: OllamaService) {
    this.initializeRedis();
  }

  /**
   * Initialize Redis for caching
   */
  private async initializeRedis(): Promise<void> {
    try {
      this.redis = await getRedisClient();
      logger.info('Redis cache initialized for embeddings');
    } catch (error) {
      logger.warn('Redis not available - embeddings will not be cached', error);
      this.redis = null;
    }
  }

  /**
   * Generate embedding for text
   */
  async generateEmbedding(text: string, model?: string): Promise<EmbeddingResult> {
    const embeddingModel = model || this.EMBEDDING_MODEL;

    // Check cache first
    const cacheKey = this.getCacheKey(text, embeddingModel);
    const cached = await this.getFromCache(cacheKey);
    if (cached) {
      return {
        embedding: cached,
        model: embeddingModel,
        cached: true
      };
    }

    // Generate new embedding
    try {
      logger.debug(`Generating embedding for text (${text.length} chars)`);

      // Use OllamaConnectionPool directly for embeddings endpoint
      const response = await this.ollama.getConnectionPool().post<{ embedding: number[] }>('/api/embeddings', {
        model: embeddingModel,
        prompt: this.preprocessText(text)
      });

      const embedding = response.embedding;

      // Cache the result
      await this.saveToCache(cacheKey, embedding);

      return {
        embedding,
        model: embeddingModel,
        cached: false
      };

    } catch (error) {
      logger.error('Failed to generate embedding', error);
      throw new Error(`Embedding generation failed: ${error}`);
    }
  }

  /**
   * Generate embeddings for multiple texts (batch)
   */
  async generateBatch(
    texts: string[],
    model?: string
  ): Promise<EmbeddingResult[]> {
    logger.info(`Generating ${texts.length} embeddings in batch`);

    const results: EmbeddingResult[] = [];

    // Process in batches of 10 to avoid overwhelming the API
    const batchSize = 10;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(text => this.generateEmbedding(text, model))
      );

      results.push(...batchResults);

      logger.debug(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}`);
    }

    return results;
  }

  /**
   * Generate embedding for user behavior summary
   */
  async generateUserBehaviorEmbedding(
    userId: string,
    serverId: string,
    behaviorData: {
      messageCount: number;
      trustScore: number;
      violationCount: number;
      avgToxicity: number;
      avgSentiment: number;
      topEmotions: string[];
      activityPattern: string;
    }
  ): Promise<EmbeddingResult> {
    // Create a text summary of user behavior
    const summary = `User behavior: ${behaviorData.messageCount} messages, trust score ${behaviorData.trustScore}, ${behaviorData.violationCount} violations. Average toxicity ${behaviorData.avgToxicity.toFixed(2)}, sentiment ${behaviorData.avgSentiment.toFixed(2)}. Emotions: ${behaviorData.topEmotions.join(', ')}. Activity: ${behaviorData.activityPattern}.`;

    return await this.generateEmbedding(summary);
  }

  /**
   * Generate embedding for AI decision case
   */
  async generateDecisionCaseEmbedding(
    situation: {
      intent: string;
      context: string;
      userProfile?: string;
      messageContent?: string;
    }
  ): Promise<EmbeddingResult> {
    const caseText = `Command: ${situation.intent}. Context: ${situation.context}. ${situation.userProfile ? `User: ${situation.userProfile}.` : ''} ${situation.messageContent ? `Message: ${situation.messageContent}` : ''}`;

    return await this.generateEmbedding(caseText);
  }

  /**
   * Generate embedding for conversation summary
   */
  async generateConversationEmbedding(
    summary: {
      topic?: string;
      participants: number;
      messageCount: number;
      sentiment: string;
      keyPhrases: string[];
    }
  ): Promise<EmbeddingResult> {
    const text = `Conversation about ${summary.topic || 'general discussion'} with ${summary.participants} participants and ${summary.messageCount} messages. Overall sentiment: ${summary.sentiment}. Key phrases: ${summary.keyPhrases.join(', ')}.`;

    return await this.generateEmbedding(text);
  }

  /**
   * Preprocess text for better embeddings
   */
  private preprocessText(text: string): string {
    // Remove extra whitespace
    let processed = text.trim().replace(/\s+/g, ' ');

    // Truncate if too long (most models have 8192 token limit)
    const maxLength = 8000; // chars, not tokens, but safe approximation
    if (processed.length > maxLength) {
      processed = processed.substring(0, maxLength) + '...';
    }

    return processed;
  }

  /**
   * Get cache key for text + model combination
   */
  private getCacheKey(text: string, model: string): string {
    const hash = crypto.createHash('sha256').update(text + model).digest('hex');
    return `embedding:${model}:${hash}`;
  }

  /**
   * Get embedding from Redis cache
   */
  private async getFromCache(key: string): Promise<number[] | null> {
    if (!this.redis) return null;

    try {
      const cached = await this.redis.get(key);
      if (!cached) return null;

      return JSON.parse(cached);
    } catch (error) {
      logger.debug('Cache read failed', error);
      return null;
    }
  }

  /**
   * Save embedding to Redis cache
   */
  private async saveToCache(key: string, embedding: number[]): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.setex(key, this.CACHE_TTL, JSON.stringify(embedding));
      logger.debug('Embedding cached');
    } catch (error) {
      logger.debug('Cache write failed', error);
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same length');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Get embedding model being used
   */
  getModel(): string {
    return this.EMBEDDING_MODEL;
  }
}
