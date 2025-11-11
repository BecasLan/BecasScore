// ScamDetector.ts - AI-POWERED scam and malicious content detection

import { OllamaService } from '../services/OllamaService';
import { metricsService } from '../services/MetricsService';

export interface ScamAnalysis {
  isScam: boolean;
  confidence: number; // 0-1
  scamType: 'phishing' | 'airdrop' | 'crypto' | 'fake_giveaway' | 'malicious_link' | 'pump_dump' | 'ponzi' | 'impersonation' | 'social_engineering' | 'piracy' | 'none';
  reasoning: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'none';
  indicators: string[];
  shouldBanPermanently: boolean;
}

export class ScamDetector {
  private ollama: OllamaService;

  constructor() {
    // 🔥 USE QWEN3:1.7B for scam detection - fast & intelligent context understanding
    this.ollama = new OllamaService('analysis'); // analysis config uses Qwen3:1.7b (2-4s response time)
    console.log('🔍 ScamDetector: Using Qwen3:1.7b for fast, accurate scam analysis');
  }

  /**
   * AI-FIRST comprehensive scam analysis
   */
  async analyze(text: string, authorHistory?: string, guildId?: string): Promise<ScamAnalysis> {
    console.log('🧠 Running AI-powered scam detection...');

    // AI does ALL the work - no cheap patterns
    const aiResult = await this.aiAnalysis(text, authorHistory);

    // STRICTER DETECTION: Lower thresholds to catch scammers faster
    // NO MERCY for scammers - they deserve ZERO second chances
    const isScam = aiResult.confidence >= 0.65;  // 65% confidence = flag as scam (lowered for social engineering)
    const shouldBanPermanently = aiResult.confidence >= 0.75 && (aiResult.severity === 'critical' || aiResult.severity === 'high');  // 75% + critical/high = PERMANENT BAN

    console.log(`   AI Confidence: ${(aiResult.confidence * 100).toFixed(1)}%`);
    console.log(`   Severity: ${aiResult.severity}`);
    console.log(`   Type: ${aiResult.scamType}`);
    console.log(`   Reasoning: ${aiResult.reasoning}`);

    // Record scam detection metrics
    if (isScam && guildId) {
      metricsService.recordScamDetection(
        guildId,
        aiResult.scamType,
        shouldBanPermanently ? 'banned' : 'warned'
      );
    }

    return {
      isScam,
      confidence: aiResult.confidence,
      scamType: aiResult.scamType,
      reasoning: aiResult.reasoning,
      severity: aiResult.severity,
      indicators: aiResult.indicators,
      shouldBanPermanently,
    };
  }

  /**
   * AI-powered contextual analysis - THE ONLY ANALYSIS
   */
  private async aiAnalysis(text: string, authorHistory?: string): Promise<{
    confidence: number;
    indicators: string[];
    reasoning: string;
    scamType: ScamAnalysis['scamType'];
    severity: ScamAnalysis['severity'];
  }> {
    try {
      // Extract URLs for AI to analyze
      const urlRegex = /(https?:\/\/[^\s]+)/gi;
      const urls = text.match(urlRegex) || [];

      // Filter out Discord mentions - they're NOT URLs
      const discordMentionRegex = /<@!?\d+>/g;
      const cleanText = text.replace(discordMentionRegex, '[Discord mention]');

      const prompt = `You are an advanced scam detection AI. Analyze this message with COMMON SENSE and intelligence:

MESSAGE: "${cleanText}"

${urls.length > 0 ? `URLs FOUND: ${urls.join(', ')}` : ''}

${authorHistory ? `USER CONTEXT: ${authorHistory}` : ''}

Your task: Determine if this is a REAL scam or just normal conversation.

CRITICAL RULES (FOLLOW STRICTLY):
1. Discord mentions like "@username" or <@123456789> are NOT scams - they're normal Discord features
2. Normal conversation is NOT a scam (99% of messages are NOT scams)
3. Questions to bots are NOT scams
4. Friendly chat is NOT a scam
5. ONLY flag OBVIOUS scams with clear malicious intent

REAL SCAMS have these signs (need MULTIPLE):
- Promises of free money/crypto with urgency ("claim now or lose forever!")
- Suspicious shortened links (bit.ly, tinyurl) to unknown sites
- Impersonating official accounts/staff with fake giveaways
- Asking for wallet seeds, passwords, or private keys
- "Double your crypto" or "guaranteed returns" schemes
- **DISCORD INVITE SPAM**: Unsolicited Discord server invites (discord.gg links) for "free help", "support", "exclusive access"
- **SOCIAL ENGINEERING TACTICS**: "Private server", "limited invites", "first come first serve", "exclusive access"
- **PIRACY/ILLEGAL CONTENT**: "Leaked paid courses", "cracked software", "free premium accounts"
- **MANIPULATION**: Creating artificial scarcity to pressure users into clicking suspicious links
- **GROOMING BEHAVIOR**: Building trust over time before revealing the scam link

NORMAL MESSAGES (NOT SCAMS):
- Regular conversation
- Mentioning other users
- Asking questions
- Sharing opinions
- Normal links to known sites

BE SKEPTICAL OF SCAM ACCUSATIONS. Default to safe (confidence < 0.5) unless CLEARLY malicious.

Respond with:
- confidence: 0-1 (0.75+ for social engineering scams, 0.9+ for crypto/phishing scams)
- scamType: "phishing" | "airdrop" | "crypto" | "fake_giveaway" | "malicious_link" | "pump_dump" | "ponzi" | "impersonation" | "social_engineering" | "piracy" | "none"
- severity: "critical" | "high" | "medium" | "low" | "none"
- indicators: Array of SPECIFIC red flags (not vague assumptions)
- reasoning: Explain clearly why this IS or ISN'T a scam

IMPORTANT: Social engineering scams (private servers, leaked content, limited invites) are HIGH severity even without direct links!`;

      const systemPrompt = `You are an expert scam detection AI with deep contextual understanding.
Use intelligence, not pattern matching.
High confidence ONLY for actual scams.
Legitimate bot interactions are NOT scams.`;

      const schema = `{
  "confidence": number,
  "scamType": string,
  "severity": string,
  "indicators": string[],
  "reasoning": string
}`;

      const result = await this.ollama.generateJSON<{
        confidence: number;
        scamType: ScamAnalysis['scamType'];
        severity: ScamAnalysis['severity'];
        indicators: string[];
        reasoning: string;
      }>(prompt, systemPrompt, schema);

      return {
        confidence: Math.min(result.confidence, 1),
        indicators: result.indicators || [],
        reasoning: result.reasoning,
        scamType: result.scamType || 'none',
        severity: result.severity || 'none',
      };
    } catch (error) {
      console.error('AI scam analysis failed:', error);

      // 🔥 FALLBACK: When AI fails, use aggressive pattern matching to catch scams!
      // We'd rather have false positives than let scammers through
      console.warn('⚠️  AI failed - falling back to pattern matching for scam detection');

      const textLower = text.toLowerCase();
      const urlRegex = /(https?:\/\/[^\s]+)/gi;
      const urlCount = (text.match(urlRegex) || []).length;

      // AGGRESSIVE scam patterns (high confidence)
      const aggressiveScamPatterns = [
        /free\s+(crypto|bitcoin|eth|nft|money)/i,
        /claim.*airdrop/i,
        /double.*crypto/i,
        /guaranteed.*profit/i,
        /click.*here.*claim/i,
        /(private|exclusive).*server/i,
        /leaked.*(course|content|premium)/i,
        /dm.*for.*(free|access)/i,
        /(seed|private\s*key|wallet)/i,
        /discord\.gg\/[a-zA-Z0-9]+/i, // Discord invite links
        /(join|come|check).*(discord\.gg|server)/i, // Discord server spam
        /(free|help|support).*(discord\.gg|server|join)/i, // Free help/support server spam
      ];

      // Check aggressive patterns
      for (const pattern of aggressiveScamPatterns) {
        if (pattern.test(text)) {
          return {
            confidence: 0.85, // High confidence from pattern match
            indicators: ['Pattern match: ' + pattern.source, `Contains ${urlCount} URLs`],
            reasoning: 'AI unavailable - FALLBACK pattern detected high-risk scam keywords',
            scamType: 'social_engineering',
            severity: 'high',
          };
        }
      }

      // Suspicious link spam (medium confidence)
      if (urlCount >= 2) {
        return {
          confidence: 0.70,
          indicators: [`Multiple suspicious URLs (${urlCount})`],
          reasoning: 'AI unavailable - FALLBACK detected multiple links (potential spam)',
          scamType: 'malicious_link',
          severity: 'medium',
        };
      }

      // If no patterns match, default to safe (but log it)
      console.warn('⚠️  AI failed AND no fallback patterns matched - defaulting to safe');
      return {
        confidence: 0,
        indicators: ['AI analysis failed', 'No fallback patterns matched'],
        reasoning: 'AI analysis unavailable - no suspicious patterns detected in fallback',
        scamType: 'none',
        severity: 'none',
      };
    }
  }
}
