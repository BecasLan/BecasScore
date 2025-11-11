/**
 * SEMANTIC LAYER - Intent embedding and semantic matching
 *
 * Purpose: Understand MESSAGE INTENT, not just keywords
 * - "delete all messages" ≈ "remove everything" ≈ "clean chat"
 * - Language-agnostic (works in any language)
 * - Fast semantic similarity (cosine distance)
 *
 * Uses: E5-base-v2 or MiniLM-L6-v2 for embeddings
 */

import { pipeline } from '@xenova/transformers';
import { createLogger } from '../services/Logger';

const logger = createLogger('SemanticLayer');

// MODULE-LEVEL SINGLETON: Shared embedder AND intents across ALL instances
// This ensures the model is loaded ONCE and intents are registered ONCE
let sharedEmbedder: any | null = null;
let sharedEmbedderPromise: Promise<any> | null = null;
let sharedIntents: Map<string, SemanticEmbedding> | null = null;
let sharedIntentsPromise: Promise<void> | null = null;

/**
 * Load the shared embedding model (called only ONCE globally)
 */
async function loadSharedEmbeddingModel(): Promise<any> {
  // Return existing promise if already loading
  if (sharedEmbedderPromise) {
    logger.debug('Embedder already loading, waiting for existing promise...');
    return sharedEmbedderPromise;
  }

  // Return cached embedder if already loaded
  if (sharedEmbedder) {
    logger.debug('Embedder already loaded, reusing cached instance');
    return sharedEmbedder;
  }

  // Create promise and start loading
  logger.info('🧠 Loading shared embedding model (Xenova/all-MiniLM-L6-v2)... [SINGLETON]');

  sharedEmbedderPromise = pipeline(
    'feature-extraction',
    'Xenova/all-MiniLM-L6-v2' // 384 dimensions, very fast
  );

  try {
    sharedEmbedder = await sharedEmbedderPromise;
    logger.info('✓ Shared embedding model loaded successfully (cached for reuse)');
    return sharedEmbedder;
  } catch (error) {
    // Clear promise on error so retries can occur
    sharedEmbedderPromise = null;
    logger.error('Failed to load shared embedding model', error);
    throw error;
  }
}

export interface SemanticEmbedding {
  vector: number[]; // 384 or 768 dimensions
  text: string;
  metadata?: any;
}

export interface IntentMatch {
  intent: string;
  similarity: number; // 0-1
  confidence: number; // adjusted similarity
  metadata?: any;
}

export class SemanticLayer {
  private embedder: any | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  // Reference to shared intents (not instance-specific!)
  private get knownIntents(): Map<string, SemanticEmbedding> {
    if (!sharedIntents) {
      sharedIntents = new Map();
    }
    return sharedIntents;
  }

  constructor() {
    logger.debug('SemanticLayer instance created');
  }

  /**
   * Initialize embedding model (uses module-level singleton)
   * NOTE: Does NOT load intents automatically - call loadKnownIntents() explicitly if needed
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Prevent multiple initialization for this instance
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        // Load shared embedder (module-level singleton)
        this.embedder = await loadSharedEmbeddingModel();
        this.isInitialized = true;

        logger.debug('SemanticLayer initialized (embedder ready, intents not loaded)');

      } catch (error) {
        logger.error('Failed to initialize semantic layer', error);
        throw error;
      }
    })();

    return this.initPromise;
  }

  /**
   * Load pre-defined intents (ONCE globally, safe to call from multiple instances)
   * This is separate from initialize() so only DirectiveMatcher loads intents
   */
  async ensureIntentsLoaded(): Promise<void> {
    // Wait for initialization first
    await this.initialize();

    // Load intents ONCE globally (using promise to avoid race conditions)
    if (!sharedIntentsPromise) {
      // CRITICAL: Assign promise IMMEDIATELY before any await to prevent race condition
      // Multiple instances calling this simultaneously will all see the same promise
      logger.info('🔒 Loading pre-defined intents for the first time... [LOCKED]');

      // Create and assign promise in ONE atomic operation
      sharedIntentsPromise = (async () => {
        try {
          await this.loadKnownIntents();
          logger.info('✅ Shared intents loaded and locked');
        } catch (error) {
          // Reset on error so retries can occur
          sharedIntentsPromise = null;
          logger.error('Failed to load shared intents', error);
          throw error;
        }
      })();
    }

    // Everyone (including first instance) waits for the same promise
    await sharedIntentsPromise;
    logger.debug('✓ Intent loading complete (reused shared intents)');
  }

  /**
   * Generate embedding for text
   */
  async embed(text: string): Promise<number[]> {
    await this.initialize();

    if (!this.embedder) {
      throw new Error('Embedder not initialized');
    }

    try {
      // Generate embedding
      const output = await this.embedder(text, {
        pooling: 'mean',
        normalize: true,
      });

      // Extract vector from tensor
      const embedding = Array.from(output.data as Float32Array);

      return embedding;

    } catch (error) {
      logger.error('Embedding generation failed', error);
      throw error;
    }
  }

  /**
   * Find most similar intent from known intents
   */
  async findIntent(query: string, threshold = 0.7): Promise<IntentMatch | null> {
    const queryEmbedding = await this.embed(query);

    let bestMatch: IntentMatch | null = null;
    let highestSimilarity = 0;

    for (const [intentName, intentData] of this.knownIntents.entries()) {
      const similarity = this.cosineSimilarity(queryEmbedding, intentData.vector);

      if (similarity > highestSimilarity && similarity >= threshold) {
        highestSimilarity = similarity;
        bestMatch = {
          intent: intentName,
          similarity,
          confidence: this.adjustConfidence(similarity),
          metadata: intentData.metadata,
        };
      }
    }

    if (bestMatch) {
      logger.debug(`Intent matched: "${bestMatch.intent}" (${(bestMatch.similarity * 100).toFixed(1)}%)`);
    }

    return bestMatch;
  }

  /**
   * Batch embed multiple texts (optimized)
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.initialize();

    const embeddings = await Promise.all(
      texts.map(text => this.embed(text))
    );

    return embeddings;
  }

  /**
   * Add new intent to knowledge base
   */
  async registerIntent(
    intentName: string,
    exampleTexts: string[],
    metadata?: any
  ): Promise<void> {
    // Skip if intent already exists
    if (this.knownIntents.has(intentName)) {
      logger.debug(`Intent "${intentName}" already exists, skipping registration`);
      return;
    }

    logger.info(`Registering intent: ${intentName} (${exampleTexts.length} examples)`);

    // Generate embeddings for all examples
    const embeddings = await this.embedBatch(exampleTexts);

    // Average embeddings to create intent representation
    const avgEmbedding = this.averageEmbeddings(embeddings);

    this.knownIntents.set(intentName, {
      vector: avgEmbedding,
      text: exampleTexts.join(' | '),
      metadata,
    });

    logger.info(`Intent registered: ${intentName}`);
  }

  /**
   * Cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vector dimensions must match');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Average multiple embeddings
   */
  private averageEmbeddings(embeddings: number[][]): number[] {
    if (embeddings.length === 0) {
      throw new Error('Cannot average empty embeddings');
    }

    const dim = embeddings[0].length;
    const avg = new Array(dim).fill(0);

    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) {
        avg[i] += emb[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      avg[i] /= embeddings.length;
    }

    return avg;
  }

  /**
   * Adjust confidence based on similarity (non-linear)
   */
  private adjustConfidence(similarity: number): number {
    // Apply sigmoid-like transformation for better confidence scores
    // similarity 0.7 → confidence ~0.6
    // similarity 0.9 → confidence ~0.9
    return 1 / (1 + Math.exp(-10 * (similarity - 0.75)));
  }

  /**
   * Load pre-defined intents (examples)
   */
  private async loadKnownIntents(): Promise<void> {
    logger.info('Loading pre-defined intents...');

    // MODERATION INTENTS
    await this.registerIntent('ban_user', [
      'ban this user',
      'remove user permanently',
      'kick out forever',
      'banla şunu', // Turkish
      '永久封禁', // Chinese
    ], { category: 'moderation', severity: 'high' });

    await this.registerIntent('delete_messages', [
      'delete all messages',
      'remove everything',
      'clean chat',
      'clear messages',
      'mesajları sil', // Turkish
    ], { category: 'moderation', severity: 'medium' });

    await this.registerIntent('warn_user', [
      'warn this user',
      'give warning',
      'uyar şunu', // Turkish
      '警告用户', // Chinese
    ], { category: 'moderation', severity: 'low' });

    await this.registerIntent('kick_user', [
      'kick this user',
      'kick @user',
      'remove them temporarily',
      'at dışarı', // Turkish
      '踢出用户', // Chinese
    ], { category: 'moderation', severity: 'high' });

    await this.registerIntent('timeout_user', [
      'timeout this user',
      'mute @user',
      'silence them',
      'put them in timeout',
      'sustur şunu', // Turkish
      '禁言用户', // Chinese
    ], { category: 'moderation', severity: 'medium' });

    // QUERY INTENTS
    await this.registerIntent('get_stats', [
      'show statistics',
      'what are the numbers',
      'server stats',
      'istatistikleri göster', // Turkish
    ], { category: 'query' });

    await this.registerIntent('find_user', [
      'find user',
      'search for member',
      'who is',
      'kullanıcı bul', // Turkish
    ], { category: 'query' });

    // GOVERNANCE INTENTS
    await this.registerIntent('create_rule', [
      'create new rule',
      'add policy',
      'set rule',
      'kural ekle', // Turkish
    ], { category: 'governance' });

    logger.info(`✅ Loaded ${this.knownIntents.size} pre-defined intents (ban, delete, warn, kick, timeout, stats, find, create)`);
  }

  /**
   * Get all registered intents
   */
  getRegisteredIntents(): string[] {
    return Array.from(this.knownIntents.keys());
  }

  /**
   * Clear all intents (for testing)
   */
  clearIntents(): void {
    this.knownIntents.clear();
    logger.info('All intents cleared');
  }
}
