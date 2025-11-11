/**
 * REFLEX LAYER - Ultra-fast message filtering with TinyLlama 1B
 *
 * Purpose: Quick first-pass analysis (10-50ms)
 * - Toxicity detection
 * - Tone analysis
 * - Risk scoring
 * - Spam/bot detection
 *
 * Only potential issues pass to upper layers → saves 90% processing time
 */

import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';
import { metricsService } from '../services/MetricsService';

const logger = createLogger('ReflexLayer');

export interface ReflexAnalysis {
  tone: 'neutral' | 'positive' | 'negative' | 'aggressive' | 'sarcastic';
  toxicity: number; // 0-1
  riskScore: number; // 0-1
  isSpam: boolean;
  isBot: boolean;
  needsDeepAnalysis: boolean; // pass to semantic layer?
  processingTimeMs: number;
}

export class ReflexLayer {
  private tinyLlama: OllamaService;
  private responseCache: Map<string, ReflexAnalysis> = new Map();
  private readonly CACHE_SIZE = 1000;

  constructor() {
    // TinyLlama for ultra-fast inference
    this.tinyLlama = new OllamaService('reflex'); // Will need to add this config
    logger.info('ReflexLayer initialized with TinyLlama 1B');
  }

  /**
   * Quick filter - decide if message needs deeper analysis
   */
  async quickFilter(message: string, authorId: string): Promise<ReflexAnalysis> {
    const startTime = Date.now();

    // Check cache first (same message in last 1000)
    const cacheKey = `${message.substring(0, 100)}_${authorId}`;
    if (this.responseCache.has(cacheKey)) {
      const cached = this.responseCache.get(cacheKey)!;
      logger.debug(`Cache hit for message: ${message.substring(0, 30)}...`);
      return cached;
    }

    try {
      // Ultra-simple prompt for TinyLlama (it's not smart, but FAST)
      const prompt = `Analyze this message quickly:
"${message}"

Respond with ONLY this JSON format:
{
  "tone": "neutral/positive/negative/aggressive/sarcastic",
  "toxicity": 0.0-1.0,
  "risk": 0.0-1.0,
  "spam": true/false,
  "bot": true/false
}`;

      const systemPrompt = `You are a fast message classifier. Respond ONLY with valid JSON. No explanation.`;

      const result = await this.tinyLlama.generateJSON<{
        tone: string;
        toxicity: number;
        risk: number;
        spam: boolean;
        bot: boolean;
      }>(prompt, systemPrompt);

      const processingTime = Date.now() - startTime;

      // Determine if needs deep analysis
      const needsDeepAnalysis =
        result.toxicity > 0.3 ||
        result.risk > 0.4 ||
        result.spam ||
        result.tone === 'aggressive' ||
        result.tone === 'sarcastic';

      const analysis: ReflexAnalysis = {
        tone: result.tone as any,
        toxicity: Math.min(result.toxicity, 1),
        riskScore: Math.min(result.risk, 1),
        isSpam: result.spam,
        isBot: result.bot,
        needsDeepAnalysis,
        processingTimeMs: processingTime,
      };

      // Cache the result
      this.cacheResponse(cacheKey, analysis);

      // Log performance
      logger.debug(`Reflex analysis: ${processingTime}ms, needsDeep=${needsDeepAnalysis}`);

      // Record metrics
      metricsService.recordAIRequest('tinyllama', 'reflex', processingTime, true);

      return analysis;

    } catch (error) {
      logger.error('Reflex analysis failed, defaulting to deep analysis', error);

      const processingTime = Date.now() - startTime;
      metricsService.recordAIRequest('tinyllama', 'reflex', processingTime, false);

      // On error, pass everything to deep analysis (safe fallback)
      return {
        tone: 'neutral',
        toxicity: 0.5,
        riskScore: 0.5,
        isSpam: false,
        isBot: false,
        needsDeepAnalysis: true, // Safe default
        processingTimeMs: processingTime,
      };
    }
  }

  /**
   * Batch process multiple messages (for optimization)
   */
  async quickFilterBatch(messages: Array<{ content: string; authorId: string }>): Promise<ReflexAnalysis[]> {
    // Process in parallel
    const results = await Promise.all(
      messages.map(msg => this.quickFilter(msg.content, msg.authorId))
    );
    return results;
  }

  /**
   * Cache management - LRU style
   */
  private cacheResponse(key: string, analysis: ReflexAnalysis): void {
    if (this.responseCache.size >= this.CACHE_SIZE) {
      // Remove oldest entry
      const firstKey = this.responseCache.keys().next().value;
      if (firstKey) {
        this.responseCache.delete(firstKey);
      }
    }
    this.responseCache.set(key, analysis);
  }

  /**
   * Clear cache (for testing/maintenance)
   */
  clearCache(): void {
    this.responseCache.clear();
    logger.info('Reflex cache cleared');
  }

  /**
   * Get cache stats
   */
  getCacheStats() {
    return {
      size: this.responseCache.size,
      maxSize: this.CACHE_SIZE,
      hitRate: 0, // TODO: track hit rate
    };
  }
}
