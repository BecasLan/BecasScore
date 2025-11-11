/**
 * RAG PLUGIN (Retrieval-Augmented Generation)
 *
 * Enhances AI decision-making by retrieving relevant context from vector store.
 * Provides historical context to improve moderation accuracy.
 *
 * Architecture:
 * ViolationDetectedEvent → RAGPlugin → Retrieve Similar Cases → Enhance Context → Publish Enhanced Decision
 *
 * Use Cases:
 * - Context-aware moderation (check if similar messages were flagged before)
 * - Pattern recognition (detect coordinated raids/spam)
 * - Smarter responses (remember past conversations)
 * - Reduced false positives (compare to known good/bad examples)
 */

import { Plugin, BecasKernel } from '../kernel/BecasKernel';
import {
  ViolationDetectedEvent,
  MessageReceivedEvent,
  GenericDomainEvent,
} from '../domain/events/DomainEvent';
import { VectorStorePlugin } from './VectorStorePlugin';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

const logger = createLogger('RAGPlugin');

export interface RAGContext {
  query: string;
  retrievedExamples: Array<{
    content: string;
    similarity: number;
    wasViolation: boolean;
    violationType?: string;
  }>;
  enhancedDecision?: {
    confidence: number; // Increased/decreased based on context
    reasoning: string; // Enhanced reasoning with context
    precedents: number; // Number of similar cases found
  };
}

/**
 * RAGPlugin - Retrieval-Augmented Generation for smarter moderation
 */
export class RAGPlugin implements Plugin {
  name = 'rag';
  version = '1.0.0';
  description = 'Context-aware AI decision enhancement using vector retrieval';
  dependencies = ['vector_store']; // Requires VectorStorePlugin

  private kernel!: BecasKernel;
  private vectorStore!: VectorStorePlugin;
  private ollamaService!: OllamaService;

  // Configuration
  private readonly TOP_K_EXAMPLES = 5; // Number of similar examples to retrieve
  private readonly MIN_SIMILARITY = 0.75; // Only use highly similar examples

  /**
   * Initialize plugin
   */
  async initialize(kernel: BecasKernel): Promise<void> {
    this.kernel = kernel;

    logger.info('🧠 Initializing RAG Plugin...');

    // Get dependencies from kernel
    this.vectorStore = kernel.getPlugin<VectorStorePlugin>('vector_store')!;
    if (!this.vectorStore) {
      throw new Error('VectorStorePlugin not found - required for RAG');
    }

    this.ollamaService = kernel.getService<OllamaService>('ollama')!;
    if (!this.ollamaService) {
      throw new Error('OllamaService not found - required for RAG');
    }

    // Subscribe to violation events
    const eventBus = kernel.getEventBus();
    eventBus.on<ViolationDetectedEvent['payload']>(
      'violation.detected',
      this.enhanceViolationDecision.bind(this)
    );

    // Subscribe to message events for proactive context retrieval
    eventBus.on<MessageReceivedEvent['payload']>(
      'message.received',
      this.checkMessageContext.bind(this)
    );

    logger.info('✅ RAG Plugin initialized');
    logger.info('   → Subscribed to: violation.detected, message.received');
    logger.info(`   → Retrieval config: topK=${this.TOP_K_EXAMPLES}, minSim=${this.MIN_SIMILARITY}`);
  }

  /**
   * Enhance violation decision with historical context
   */
  private async enhanceViolationDecision(event: ViolationDetectedEvent): Promise<void> {
    try {
      const { violationType, severity, confidence, reasoning } = event.payload;
      const messageId = event.metadata.correlationId || event.metadata.eventId;
      const guildId = event.metadata.guildId;

      if (!guildId) return;

      logger.info(`🔍 Retrieving context for ${violationType} violation in guild ${guildId}`);

      // Get the original message vector
      const messageVector = this.vectorStore.getVector(messageId);
      if (!messageVector) {
        logger.debug('Message vector not found - skipping RAG enhancement');
        return;
      }

      // Retrieve similar violations from history
      const similarViolations = await this.vectorStore.findSimilarViolations(
        messageId,
        guildId,
        this.TOP_K_EXAMPLES
      );

      if (similarViolations.length === 0) {
        logger.debug('No similar violations found');
        return;
      }

      // Filter by similarity threshold
      const relevantExamples = similarViolations.filter(
        r => r.similarity >= this.MIN_SIMILARITY
      );

      if (relevantExamples.length === 0) {
        logger.debug(`No examples above similarity threshold (${this.MIN_SIMILARITY})`);
        return;
      }

      // Build RAG context
      const ragContext: RAGContext = {
        query: messageVector.metadata.content,
        retrievedExamples: relevantExamples.map(r => ({
          content: r.entry.metadata.content,
          similarity: r.similarity,
          wasViolation: r.entry.metadata.wasViolation || false,
          violationType: r.entry.metadata.violationType,
        })),
      };

      // Enhance decision using AI
      const enhancedDecision = await this.enhanceWithAI(
        messageVector.metadata.content,
        violationType,
        severity,
        confidence,
        reasoning,
        ragContext.retrievedExamples
      );

      ragContext.enhancedDecision = enhancedDecision;

      // Publish enhanced decision event
      await this.kernel.publishEvent(
        new GenericDomainEvent('rag.context_enhanced', {
          messageId,
          guildId,
          originalConfidence: confidence,
          enhancedConfidence: enhancedDecision.confidence,
          precedents: enhancedDecision.precedents,
          enhancedReasoning: enhancedDecision.reasoning,
          retrievedExamples: ragContext.retrievedExamples.length,
        })
      );

      logger.info(
        `✅ RAG enhanced decision: ${confidence.toFixed(2)} → ${enhancedDecision.confidence.toFixed(2)} (${enhancedDecision.precedents} precedents)`
      );
    } catch (error: any) {
      logger.error('Failed to enhance violation decision with RAG:', error);
    }
  }

  /**
   * Check message context proactively (before violation detection)
   */
  private async checkMessageContext(event: MessageReceivedEvent): Promise<void> {
    try {
      const { messageId, content, guildId, authorId } = event.payload;

      // Skip very short messages
      if (!content || content.length < 10) return;

      // Quick semantic search for similar messages
      const similarMessages = await this.vectorStore.semanticSearch(content, {
        guildId,
        topK: 3,
        minSimilarity: 0.85, // High threshold for proactive checks
        onlyViolations: true, // Only check against known violations
      });

      if (similarMessages.length > 0) {
        const avgSimilarity =
          similarMessages.reduce((sum, r) => sum + r.similarity, 0) /
          similarMessages.length;

        logger.info(
          `⚠️ Proactive RAG: Message similar to ${similarMessages.length} past violations (avg similarity: ${avgSimilarity.toFixed(2)})`
        );

        // Publish alert event
        await this.kernel.publishEvent(
          new GenericDomainEvent('rag.suspicious_similarity', {
            messageId,
            guildId,
            authorId,
            similarViolations: similarMessages.length,
            avgSimilarity,
            examples: similarMessages.map(r => ({
              violationType: r.entry.metadata.violationType,
              similarity: r.similarity,
            })),
          })
        );
      }
    } catch (error: any) {
      logger.error('Failed to check message context:', error);
    }
  }

  /**
   * Use AI to enhance decision with retrieved context
   */
  private async enhanceWithAI(
    currentMessage: string,
    violationType: string,
    severity: string,
    originalConfidence: number,
    originalReasoning: string,
    examples: RAGContext['retrievedExamples']
  ): Promise<RAGContext['enhancedDecision']> {
    try {
      // Build context-aware prompt
      const examplesText = examples
        .map(
          (ex, i) =>
            `Example ${i + 1} (similarity: ${ex.similarity.toFixed(2)}):
- Content: "${ex.content}"
- Was violation: ${ex.wasViolation ? 'YES' : 'NO'}
- Type: ${ex.violationType || 'N/A'}`
        )
        .join('\n\n');

      const prompt = `You are analyzing a potential content violation. Review the current message and similar past cases to make an enhanced decision.

**Current Message:**
"${currentMessage}"

**Initial Analysis:**
- Type: ${violationType}
- Severity: ${severity}
- Confidence: ${originalConfidence.toFixed(2)}
- Reasoning: ${originalReasoning}

**Similar Past Cases (${examples.length}):**
${examplesText}

Based on these precedents, provide:
1. Enhanced confidence (0-1): Should we increase or decrease confidence based on patterns?
2. Enhanced reasoning: How do past cases inform this decision?

Respond in JSON format:
{
  "enhancedConfidence": <number 0-1>,
  "reasoning": "<string>",
  "pattern": "<string describing any patterns observed>"
}`;

      const response = await this.ollamaService.generate(prompt, undefined, {
        temperature: 0.3, // Low temperature for consistency
      });

      // Parse AI response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('Failed to parse AI response - using original confidence');
        return {
          confidence: originalConfidence,
          reasoning: originalReasoning,
          precedents: examples.length,
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        confidence: Math.max(0, Math.min(1, parsed.enhancedConfidence || originalConfidence)),
        reasoning: `${originalReasoning}\n\nContext-aware analysis (${examples.length} precedents): ${parsed.reasoning}`,
        precedents: examples.length,
      };
    } catch (error: any) {
      logger.error('Failed to enhance decision with AI:', error);
      return {
        confidence: originalConfidence,
        reasoning: originalReasoning,
        precedents: examples.length,
      };
    }
  }

  /**
   * Public API: Get context for a message
   */
  async getMessageContext(
    messageId: string,
    guildId: string
  ): Promise<RAGContext | null> {
    const vector = this.vectorStore.getVector(messageId);
    if (!vector) return null;

    const similarMessages = await this.vectorStore.semanticSearch(
      vector.metadata.content,
      {
        guildId,
        topK: this.TOP_K_EXAMPLES,
        minSimilarity: this.MIN_SIMILARITY,
      }
    );

    return {
      query: vector.metadata.content,
      retrievedExamples: similarMessages.map(r => ({
        content: r.entry.metadata.content,
        similarity: r.similarity,
        wasViolation: r.entry.metadata.wasViolation || false,
        violationType: r.entry.metadata.violationType,
      })),
    };
  }

  /**
   * Shutdown plugin
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down RAG Plugin...');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.vectorStore !== undefined && this.ollamaService !== undefined;
  }
}
