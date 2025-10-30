/**
 * CONTENT LAYER - Deep Scam, Phishing & Manipulation Analysis
 *
 * Sophisticated content analysis using advanced AI reasoning.
 * Uses Qwen3:8b for deep pattern analysis and threat assessment.
 *
 * Purpose:
 * - Deep scam detection (crypto, phishing, social engineering)
 * - Manipulation technique identification
 * - Cross-reference with known threat patterns
 * - Query threat database for similar scams
 *
 * Used when:
 * - Semantic Layer detects suspicious intent
 * - High manipulation risk
 * - Links or external content present
 */

import { Message } from 'discord.js';
import { OllamaService } from '../../services/OllamaService';
import { UserCharacterProfile } from '../../services/ProfileBuilder';
import { SemanticResult } from './SemanticLayer';
import { createLogger } from '../../services/Logger';

const logger = createLogger('ContentLayer');

export interface ContentResult {
  // Scam Analysis
  scam: {
    isScam: boolean;
    scamType: string; // phishing, crypto, impersonation, etc.
    confidence: number;
    indicators: string[]; // What made it suspicious
    reasoning: string; // AI's reasoning
  };

  // Phishing Detection
  phishing: {
    isPhishing: boolean;
    targetType: string; // credentials, payment, personal_info
    urgency: 'none' | 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
  };

  // Link Analysis
  links: {
    hasLinks: boolean;
    linkCount: number;
    suspiciousLinks: string[];
    linkReputation: 'safe' | 'unknown' | 'suspicious' | 'malicious';
  };

  // Threat Similarity
  similarity: {
    matchedPatterns: Array<{
      patternId: string;
      similarity: number;
      description: string;
    }>;
    crossServerMatches: number; // Similar threats in other servers
  };

  processingTime: number;
}

export class ContentLayer {
  private ollama: OllamaService;

  // Known scam keywords (for quick detection)
  private scamKeywords = [
    'free nitro', 'free discord', 'free robux', 'free vbucks',
    'crypto giveaway', 'bitcoin giveaway', 'eth giveaway',
    'click here to verify', 'account suspended', 'urgent action required',
    'double your money', 'investment opportunity', 'guaranteed profit',
    'dm for free', 'check dm', 'message me for',
  ];

  // Phishing indicators
  private phishingIndicators = [
    'verify your account', 'confirm your identity', 'update payment',
    'suspended account', 'unusual activity', 'security alert',
    'click to unlock', 'enter password', 'provide credit card',
  ];

  constructor() {
    this.ollama = new OllamaService('analysis'); // Qwen3:8b
    logger.info('ContentLayer initialized with deep threat analysis');
  }

  /**
   * Perform deep content analysis
   */
  async analyze(
    message: Message,
    semanticResult: SemanticResult,
    profile?: UserCharacterProfile
  ): Promise<ContentResult> {
    const startTime = Date.now();

    try {
      // Extract links
      const links = this.extractLinks(message.content);

      // Parallel deep analysis
      const [scamAnalysis, phishingAnalysis, linkAnalysis] = await Promise.all([
        this.deepScamAnalysis(message, semanticResult, profile),
        this.phishingDetection(message, links),
        this.analyzeLinkReputation(links),
      ]);

      // Query threat database for similar patterns
      const similarity = await this.findSimilarThreats(message, scamAnalysis);

      return {
        scam: scamAnalysis,
        phishing: phishingAnalysis,
        links: {
          hasLinks: links.length > 0,
          linkCount: links.length,
          suspiciousLinks: links.filter(link => this.isSuspiciousLink(link)),
          linkReputation: linkAnalysis,
        },
        similarity,
        processingTime: Date.now() - startTime,
      };

    } catch (error) {
      logger.error('Content analysis failed', error);

      // Fallback result
      return {
        scam: {
          isScam: false,
          scamType: 'none',
          confidence: 0,
          indicators: [],
          reasoning: 'Analysis failed',
        },
        phishing: {
          isPhishing: false,
          targetType: 'none',
          urgency: 'none',
          confidence: 0,
        },
        links: {
          hasLinks: false,
          linkCount: 0,
          suspiciousLinks: [],
          linkReputation: 'unknown',
        },
        similarity: {
          matchedPatterns: [],
          crossServerMatches: 0,
        },
        processingTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Deep scam analysis using AI reasoning
   */
  private async deepScamAnalysis(
    message: Message,
    semanticResult: SemanticResult,
    profile?: UserCharacterProfile
  ): Promise<ContentResult['scam']> {
    // Quick keyword check first
    const contentLower = message.content.toLowerCase();
    const matchedKeywords = this.scamKeywords.filter(keyword =>
      contentLower.includes(keyword)
    );

    const prompt = `You are an expert at detecting scams, phishing, and social engineering in Discord messages.

Analyze this message for scam indicators:

Message: "${message.content}"

Context:
- Intent detected: ${semanticResult.intent.type}
- Manipulation detected: ${semanticResult.manipulation.isManipulative}
- Manipulation techniques: ${semanticResult.manipulation.techniques.join(', ')}
- Matched scam keywords: ${matchedKeywords.join(', ')}
${profile ? `- User's deception risk: ${profile.riskIndicators.deception.toFixed(2)}` : ''}

Common scam types:
1. Phishing: Fake links to steal credentials
2. Crypto scams: Fake giveaways, investment schemes
3. Impersonation: Pretending to be Discord staff, server mods
4. Social engineering: Manipulating users to do something harmful
5. Free items: Fake free Nitro, games, currency

Analyze and respond ONLY with JSON:
{
  "isScam": true/false,
  "scamType": "phishing|crypto|impersonation|social_engineering|free_items|none",
  "confidence": 0.0-1.0,
  "indicators": ["indicator1", "indicator2", ...],
  "reasoning": "Brief explanation of why this is/isn't a scam"
}`;

    try {
      const result = await this.ollama.generate(prompt, undefined, {
        temperature: 0.1, // Low temp for consistent detection
        maxTokens: 300,
      });

      const parsed = JSON.parse(result);

      // Boost confidence if keywords matched
      let confidence = parsed.confidence || 0;
      if (matchedKeywords.length > 0) {
        confidence = Math.min(1.0, confidence + (matchedKeywords.length * 0.1));
      }

      return {
        isScam: parsed.isScam || false,
        scamType: parsed.scamType || 'none',
        confidence,
        indicators: parsed.indicators || [],
        reasoning: parsed.reasoning || 'No clear scam indicators',
      };
    } catch (error) {
      logger.error('Deep scam analysis failed', error);
      return {
        isScam: false,
        scamType: 'none',
        confidence: 0,
        indicators: [],
        reasoning: 'Analysis failed',
      };
    }
  }

  /**
   * Phishing detection
   */
  private async phishingDetection(
    message: Message,
    links: string[]
  ): Promise<ContentResult['phishing']> {
    const contentLower = message.content.toLowerCase();
    const matchedIndicators = this.phishingIndicators.filter(indicator =>
      contentLower.includes(indicator)
    );

    // Check urgency words
    const urgencyWords = ['urgent', 'immediately', 'now', 'asap', 'hurry', 'expires', 'limited time'];
    const hasUrgency = urgencyWords.some(word => contentLower.includes(word));

    const prompt = `Analyze this message for phishing attempts.

Message: "${message.content}"
Links present: ${links.length > 0 ? 'Yes' : 'No'}
Matched phishing indicators: ${matchedIndicators.join(', ')}

Phishing targets:
- credentials: Username, password, login info
- payment: Credit card, PayPal, banking info
- personal_info: SSN, address, phone, email

Respond ONLY with JSON:
{
  "isPhishing": true/false,
  "targetType": "credentials|payment|personal_info|none",
  "urgency": "none|low|medium|high|critical",
  "confidence": 0.0-1.0
}`;

    try {
      const result = await this.ollama.generate(prompt, undefined, {
        temperature: 0.1,
        maxTokens: 100,
      });

      const parsed = JSON.parse(result);

      // Override urgency if urgency words detected
      let urgency = parsed.urgency || 'none';
      if (hasUrgency && urgency === 'none') {
        urgency = 'medium';
      }

      return {
        isPhishing: parsed.isPhishing || false,
        targetType: parsed.targetType || 'none',
        urgency: urgency as ContentResult['phishing']['urgency'],
        confidence: parsed.confidence || 0,
      };
    } catch (error) {
      logger.error('Phishing detection failed', error);
      return {
        isPhishing: false,
        targetType: 'none',
        urgency: 'none',
        confidence: 0,
      };
    }
  }

  /**
   * Analyze link reputation (simplified - would use real URL reputation API)
   */
  private async analyzeLinkReputation(links: string[]): Promise<ContentResult['links']['linkReputation']> {
    if (links.length === 0) return 'safe';

    // Check for suspicious patterns in URLs
    const suspiciousCount = links.filter(link => this.isSuspiciousLink(link)).length;

    if (suspiciousCount > 0) {
      return 'suspicious';
    }

    // TODO: Integrate with URL reputation service (VirusTotal, URLScan, etc.)
    return 'unknown';
  }

  /**
   * Find similar threat patterns (simplified - would query ChromaDB)
   */
  private async findSimilarThreats(
    message: Message,
    scamAnalysis: ContentResult['scam']
  ): Promise<ContentResult['similarity']> {
    // TODO: Query ChromaDB for similar scam patterns
    // TODO: Query cross_server_alerts table for global threats

    // Placeholder
    return {
      matchedPatterns: [],
      crossServerMatches: 0,
    };
  }

  /**
   * Extract URLs from message
   */
  private extractLinks(content: string): string[] {
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    return content.match(urlRegex) || [];
  }

  /**
   * Check if link looks suspicious
   */
  private isSuspiciousLink(link: string): boolean {
    const linkLower = link.toLowerCase();

    // Suspicious TLDs
    const suspiciousTlds = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top'];
    if (suspiciousTlds.some(tld => linkLower.includes(tld))) {
      return true;
    }

    // IP address URLs
    if (/https?:\/\/\d+\.\d+\.\d+\.\d+/.test(link)) {
      return true;
    }

    // Shortened URLs
    const shorteners = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl'];
    if (shorteners.some(shortener => linkLower.includes(shortener))) {
      return true;
    }

    // Discord impersonation
    if (linkLower.includes('discord') && !linkLower.includes('discord.com') && !linkLower.includes('discord.gg')) {
      return true;
    }

    return false;
  }

  /**
   * Add custom scam pattern (for learning)
   */
  addScamKeyword(keyword: string): void {
    this.scamKeywords.push(keyword.toLowerCase());
    logger.info(`Added custom scam keyword: ${keyword}`);
  }

  /**
   * Add phishing indicator
   */
  addPhishingIndicator(indicator: string): void {
    this.phishingIndicators.push(indicator.toLowerCase());
    logger.info(`Added custom phishing indicator: ${indicator}`);
  }
}
