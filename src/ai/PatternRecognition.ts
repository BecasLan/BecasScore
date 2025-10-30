/**
 * PATTERN RECOGNITION - ChromaDB-Powered Threat Pattern Matching
 *
 * Uses vector embeddings to detect similar threat patterns:
 * - Similar scam messages across time
 * - Similar user behavior patterns
 * - Emerging threat trends
 * - Alt account detection
 *
 * How it works:
 * 1. Convert threats to embeddings (nomic-embed-text)
 * 2. Store in ChromaDB threat_patterns collection
 * 3. Query for similar patterns when analyzing new messages
 * 4. Learn from confirmed threats
 */

import { Message } from 'discord.js';
import { ChromaDBService } from '../database/ChromaDB';
import { EmbeddingService } from '../services/EmbeddingService';
import { ContentResult } from './layers/ContentLayer';
import { UserCharacterProfile } from '../services/ProfileBuilder';
import { createLogger } from '../services/Logger';

const logger = createLogger('PatternRecognition');

export interface ThreatPattern {
  id: string;
  type: 'scam' | 'phishing' | 'spam' | 'toxic' | 'manipulation';
  content: string; // Anonymized threat content
  embedding: number[]; // Vector representation

  // Pattern metadata
  confidence: number;
  detectionCount: number; // How many times seen
  firstSeen: Date;
  lastSeen: Date;

  // Context
  characteristics: string[]; // What makes it a threat
  userPatterns?: {
    avgMessageLength: number;
    capsUsageRate: number;
    linkRate: number;
  };

  // Learning
  confirmedThreat: boolean; // Manually verified
  falsePositive: boolean; // Marked as false positive
}

export interface SimilarPattern {
  pattern: ThreatPattern;
  similarity: number; // 0-1 (cosine similarity)
  matchedCharacteristics: string[];
}

export class PatternRecognition {
  private chroma: ChromaDBService;
  private embeddingService: EmbeddingService;
  private patterns: Map<string, ThreatPattern> = new Map();

  constructor(chroma: ChromaDBService, embeddingService: EmbeddingService) {
    this.chroma = chroma;
    this.embeddingService = embeddingService;
    logger.info('PatternRecognition initialized with ChromaDB');
  }

  /**
   * Store a new threat pattern
   */
  async storePattern(
    message: Message,
    threatType: ThreatPattern['type'],
    confidence: number,
    characteristics: string[],
    profile?: UserCharacterProfile
  ): Promise<ThreatPattern> {
    try {
      // Anonymize message content (remove user mentions, IDs)
      const anonymizedContent = this.anonymizeContent(message.content);

      // Generate embedding
      const embedding = await this.embeddingService.generateEmbedding(anonymizedContent);

      // Check if similar pattern already exists
      const similar = await this.findSimilarPatterns(embedding.embedding, threatType, 0.95);

      if (similar.length > 0) {
        // Update existing pattern
        const existingPattern = similar[0].pattern;
        existingPattern.detectionCount++;
        existingPattern.lastSeen = new Date();
        existingPattern.confidence = Math.min(1.0, existingPattern.confidence + 0.05);

        logger.info(`Updated existing pattern ${existingPattern.id} (count: ${existingPattern.detectionCount})`);
        return existingPattern;
      }

      // Create new pattern
      const pattern: ThreatPattern = {
        id: this.generatePatternId(),
        type: threatType,
        content: anonymizedContent,
        embedding: embedding.embedding,
        confidence,
        detectionCount: 1,
        firstSeen: new Date(),
        lastSeen: new Date(),
        characteristics,
        userPatterns: profile ? {
          avgMessageLength: profile.behavior.avgMessageLength,
          capsUsageRate: profile.behavior.capsUsageRate,
          linkRate: profile.behavior.linkSharingRate,
        } : undefined,
        confirmedThreat: false,
        falsePositive: false,
      };

      // Store in memory
      this.patterns.set(pattern.id, pattern);

      // Store in ChromaDB
      await this.chroma.addDocument('threat_patterns', {
        id: pattern.id,
        embedding: pattern.embedding,
        metadata: {
          type: pattern.type,
          confidence: pattern.confidence,
          detectionCount: pattern.detectionCount,
          firstSeen: pattern.firstSeen.toISOString(),
          characteristics: JSON.stringify(pattern.characteristics),
        },
        document: pattern.content,
      });

      logger.info(`Stored new threat pattern: ${pattern.id} (type: ${threatType})`);
      return pattern;

    } catch (error) {
      logger.error('Failed to store pattern', error);
      throw error;
    }
  }

  /**
   * Find similar threat patterns
   */
  async findSimilarPatterns(
    embedding: number[],
    threatType?: ThreatPattern['type'],
    minSimilarity = 0.8
  ): Promise<SimilarPattern[]> {
    try {
      // Query ChromaDB for similar embeddings
      const results = await this.chroma.queryCollection('threat_patterns', {
        queryEmbeddings: [embedding],
        nResults: 10,
        where: threatType ? { type: threatType } : undefined,
      });

      if (!results || results.length === 0) {
        return [];
      }

      // Convert to SimilarPattern objects
      const similarPatterns: SimilarPattern[] = [];

      for (let i = 0; i < results[0].ids.length; i++) {
        const patternId = results[0].ids[i];
        const similarity = 1 - (results[0].distances?.[i] || 0); // Convert distance to similarity

        if (similarity < minSimilarity) continue;

        const pattern = this.patterns.get(patternId);
        if (!pattern) continue;

        // Find matched characteristics (simplified)
        const matchedCharacteristics = pattern.characteristics.slice(0, 3);

        similarPatterns.push({
          pattern,
          similarity,
          matchedCharacteristics,
        });
      }

      return similarPatterns.sort((a, b) => b.similarity - a.similarity);

    } catch (error) {
      logger.error('Failed to find similar patterns', error);
      return [];
    }
  }

  /**
   * Analyze message for known threat patterns
   */
  async analyzeMessage(message: Message): Promise<{
    hasKnownPattern: boolean;
    matchedPatterns: SimilarPattern[];
    riskScore: number; // 0-100
    recommendation: 'allow' | 'flag' | 'block';
  }> {
    try {
      // Generate embedding for message
      const embedding = await this.embeddingService.generateEmbedding(message.content);

      // Find similar patterns
      const similar = await this.findSimilarPatterns(embedding.embedding, undefined, 0.75);

      // Filter out false positives
      const validPatterns = similar.filter(s => !s.pattern.falsePositive);

      if (validPatterns.length === 0) {
        return {
          hasKnownPattern: false,
          matchedPatterns: [],
          riskScore: 0,
          recommendation: 'allow',
        };
      }

      // Calculate risk score based on matches
      let riskScore = 0;
      for (const match of validPatterns) {
        const patternRisk = match.pattern.confidence * 100 * match.similarity;

        // Boost for confirmed threats
        const boost = match.pattern.confirmedThreat ? 1.3 : 1.0;

        // Boost for frequently detected patterns
        const frequencyBoost = Math.min(1.5, 1 + (match.pattern.detectionCount * 0.05));

        riskScore += patternRisk * boost * frequencyBoost;
      }

      riskScore = Math.min(100, riskScore);

      // Determine recommendation
      let recommendation: 'allow' | 'flag' | 'block';
      if (riskScore >= 80) {
        recommendation = 'block';
      } else if (riskScore >= 50) {
        recommendation = 'flag';
      } else {
        recommendation = 'allow';
      }

      logger.info(`Pattern analysis: ${validPatterns.length} matches, risk: ${riskScore.toFixed(0)}, recommendation: ${recommendation}`);

      return {
        hasKnownPattern: true,
        matchedPatterns: validPatterns,
        riskScore,
        recommendation,
      };

    } catch (error) {
      logger.error('Failed to analyze message patterns', error);
      return {
        hasKnownPattern: false,
        matchedPatterns: [],
        riskScore: 0,
        recommendation: 'allow',
      };
    }
  }

  /**
   * Detect emerging threat trends
   */
  async detectTrends(days = 7): Promise<Array<{
    type: ThreatPattern['type'];
    growthRate: number; // % increase
    recentCount: number;
    topPatterns: ThreatPattern[];
  }>> {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Group patterns by type
    const byType = new Map<ThreatPattern['type'], ThreatPattern[]>();

    for (const pattern of this.patterns.values()) {
      if (pattern.lastSeen < cutoffDate) continue;

      if (!byType.has(pattern.type)) {
        byType.set(pattern.type, []);
      }
      byType.get(pattern.type)!.push(pattern);
    }

    // Calculate trends
    const trends: Array<any> = [];

    for (const [type, patterns] of byType) {
      const recentCount = patterns.reduce((sum, p) => sum + p.detectionCount, 0);

      // Sort by detection count
      const topPatterns = patterns
        .sort((a, b) => b.detectionCount - a.detectionCount)
        .slice(0, 5);

      // Calculate growth rate (simplified)
      const growthRate = recentCount > 10 ? ((recentCount - 10) / 10) * 100 : 0;

      trends.push({
        type,
        growthRate,
        recentCount,
        topPatterns,
      });
    }

    return trends.sort((a, b) => b.growthRate - a.growthRate);
  }

  /**
   * Mark pattern as confirmed threat or false positive
   */
  async updatePatternStatus(
    patternId: string,
    status: 'confirmed' | 'false_positive'
  ): Promise<void> {
    const pattern = this.patterns.get(patternId);
    if (!pattern) {
      throw new Error(`Pattern ${patternId} not found`);
    }

    if (status === 'confirmed') {
      pattern.confirmedThreat = true;
      pattern.confidence = Math.min(1.0, pattern.confidence + 0.2);
      logger.info(`Pattern ${patternId} confirmed as threat (confidence boosted to ${pattern.confidence})`);
    } else {
      pattern.falsePositive = true;
      logger.info(`Pattern ${patternId} marked as false positive`);
    }

    // TODO: Update in ChromaDB
  }

  /**
   * Get pattern statistics
   */
  getStats(): {
    totalPatterns: number;
    byType: Record<ThreatPattern['type'], number>;
    confirmedThreats: number;
    falsePositives: number;
    avgConfidence: number;
  } {
    const patterns = Array.from(this.patterns.values());

    const byType: Record<string, number> = {};
    patterns.forEach(p => {
      byType[p.type] = (byType[p.type] || 0) + 1;
    });

    const confirmedThreats = patterns.filter(p => p.confirmedThreat).length;
    const falsePositives = patterns.filter(p => p.falsePositive).length;
    const avgConfidence = patterns.length > 0
      ? patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length
      : 0;

    return {
      totalPatterns: patterns.length,
      byType: byType as any,
      confirmedThreats,
      falsePositives,
      avgConfidence,
    };
  }

  /**
   * Anonymize content (remove PII, user mentions)
   */
  private anonymizeContent(content: string): string {
    return content
      .replace(/<@!?\d+>/g, '[USER]') // User mentions
      .replace(/<#\d+>/g, '[CHANNEL]') // Channel mentions
      .replace(/<@&\d+>/g, '[ROLE]') // Role mentions
      .replace(/\d{17,19}/g, '[ID]') // Discord IDs
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP]'); // IP addresses
  }

  /**
   * Generate pattern ID
   */
  private generatePatternId(): string {
    return `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get all patterns (for admin)
   */
  getAllPatterns(): ThreatPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Delete pattern
   */
  async deletePattern(patternId: string): Promise<void> {
    this.patterns.delete(patternId);
    // TODO: Delete from ChromaDB
    logger.info(`Deleted pattern ${patternId}`);
  }
}
