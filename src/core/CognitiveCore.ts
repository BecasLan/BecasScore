import { Message } from 'discord.js';
import { createLogger } from '../services/Logger';
import { AnalyzedMessage, MessageContext } from '../types/Message.types';
import { StableContext } from './EventGateway';
import { V3Integration } from '../integration/V3Integration';
import { UserRole } from '../intelligence/SafeLearningEngine';
import { SeverityCalculator, SeverityResult } from '../services/SeverityCalculator';
import { ScamAnalysis } from '../analyzers/ScamDetector';
import { OllamaService } from '../services/OllamaService';

const logger = createLogger('CognitiveCore');

/**
 * COGNITIVE CORE - System 2 Thinking
 *
 * Inspired by Kahneman's "Thinking, Fast and Slow"
 * This is the slow, deliberate, reasoning-based processing layer.
 *
 * Architecture:
 * 1. Perception Engine - Process and understand input
 * 2. Reasoning Engine - Analyze and make decisions
 * 3. Decision Engine - Determine final actions
 */

// ==========================================
// INTERFACES
// ==========================================

export interface PerceptionResult {
  message: Message;
  context: MessageContext;
  analyzed: AnalyzedMessage;
  conversationContext: string[];
  userProfile: {
    trustScore: any;
    history: any[];
    patterns: string[];
  };
  communityState: {
    mood: string;
    recentConflicts: number;
    activeUsers: number;
  };
  processingTime: number;
}

export interface ReasoningResult {
  shouldRespond: boolean;
  responseType: 'none' | 'acknowledge' | 'moderate' | 'engage' | 'support';
  confidence: number;
  reasoning: string;
  detectedThreats: {
    type: string;
    severity: number;
    confidence: number;
    evidence: string;
  }[];
  suggestedActions: {
    type: string;
    priority: number;
    reason: string;
  }[];
  emotionalResponse: {
    type: 'calm' | 'concerned' | 'firm' | 'supportive' | 'playful';
    intensity: number;
  };
  // 🔥 V3 LEARNING CONTEXT
  learnedPatterns?: Array<{
    pattern: string;
    action: string;
    confidence: number;
  }>;
  actionHistory?: {
    totalActions: number;
    recentPunishments: number;
    lastAction?: string;
  };
  processingTime: number;
}

export interface DecisionResult {
  action: 'none' | 'respond' | 'moderate' | 'escalate' | 'support';
  moderationAction?: {
    type: 'warn' | 'timeout' | 'kick' | 'ban';
    duration?: number;
    reason: string;
  };
  responseContent?: string;
  shouldNotifyMods: boolean;
  shouldUpdateTrust: boolean;
  trustDelta?: number;
  metadata: {
    perceptionTime: number;
    reasoningTime: number;
    decisionTime: number;
    totalTime: number;
    confidence: number;
  };
}

// ==========================================
// PERCEPTION ENGINE
// ==========================================

export class PerceptionEngine {
  /**
   * Process incoming message and build comprehensive understanding
   */
  async perceive(
    message: Message,
    stableContext: StableContext,
    dependencies: {
      dialogue: any;
      memory: any;
      trustEngine: any;
      userMonitor?: any;
    }
  ): Promise<PerceptionResult> {
    const startTime = performance.now();

    // 1. Build message context
    const context: MessageContext = {
      id: message.id,
      content: message.content,
      authorId: message.author.id,
      authorName: message.author.username,
      guildId: message.guild!.id,
      channelId: message.channelId,
      timestamp: message.createdAt,
      mentions: message.mentions.users.map(u => u.id),
      attachments: message.attachments.map(a => a.url),
    };

    // 2. Quick sentiment analysis (rule-based, no Ollama)
    const analyzed: AnalyzedMessage = {
      ...context,
      toxicity: 0, // Will be analyzed by ReasoningEngine
      manipulation: 0,
      sentiment: {
        positive: 0.33,
        negative: 0.33,
        neutral: 0.34,
        dominant: 'neutral',
        emotions: []
      },
      hierarchy: 'member',
      intent: {
        type: 'statement',
        confidence: 0.5
      }
    };

    // 3. Retrieve conversation context
    const conversationId = `${message.guildId}:${message.channelId}`;
    const recentContext = dependencies.memory.getShortTermContext(conversationId, 20);
    const conversationContext = recentContext.split('\n');

    // 4. Get user profile and trust
    const trustScore = dependencies.trustEngine.getTrustScore(message.author.id, message.guild!.id);
    const history = trustScore.history.slice(-10); // Last 10 events

    // 5. Detect behavioral patterns
    const patterns: string[] = [];

    if (analyzed.toxicity > 0.6) patterns.push('toxic_tendency');
    if (analyzed.manipulation > 0.7) patterns.push('manipulative');
    if (trustScore.score < 30) patterns.push('untrusted');
    if (trustScore.level === 'dangerous') patterns.push('high_risk');

    // 6. Assess community state
    const communityState = {
      mood: 'neutral', // Would be calculated from recent messages
      recentConflicts: 0, // Would be tracked
      activeUsers: message.guild!.memberCount || 0,
    };

    const processingTime = performance.now() - startTime;

    logger.debug(`Perception complete: ${processingTime.toFixed(2)}ms`);

    return {
      message,
      context,
      analyzed,
      conversationContext,
      userProfile: {
        trustScore,
        history,
        patterns,
      },
      communityState,
      processingTime,
    };
  }
}

// ==========================================
// REASONING ENGINE
// ==========================================

export class ReasoningEngine {
  private cognitiveAI: OllamaService;

  constructor() {
    // 🧠 USE QWEN3:8B FOR AI REASONING
    this.cognitiveAI = new OllamaService('cognitive');
    logger.info('🧠 ReasoningEngine: Using Qwen3:8b for cognitive reasoning');
  }

  /**
   * Analyze perception and reason about appropriate response
   */
  async reason(
    perception: PerceptionResult,
    dependencies: {
      dialogue: any;
      personality: any;
      scamDetector?: any;
      conflictPredictor?: any;
      v3Integration?: V3Integration; // 🔥 V3 LEARNING INTEGRATION
      v3Context?: any; // 🔥 V3 CONTEXT - Recent actions/messages
    }
  ): Promise<ReasoningResult> {
    const startTime = performance.now();
    const { analyzed, userProfile, conversationContext, message } = perception;

    // 🔥 V3 INTEGRATION - Fetch learned patterns and action history
    let learnedPatterns: ReasoningResult['learnedPatterns'] = [];
    let actionHistory: ReasoningResult['actionHistory'] = undefined;

    if (dependencies.v3Integration && message.guild) {
      try {
        // Get user role for pattern matching
        const member = message.member;
        const userRole: UserRole = member?.permissions.has('Administrator')
          ? 'admin'
          : member?.permissions.has('ModerateMembers')
          ? 'moderator'
          : 'member';

        // Fetch applicable learned patterns
        const channelType = message.channel.type?.toString(); // Convert ChannelType enum to string
        const patterns = await dependencies.v3Integration.getApplicablePatterns(
          message.guild.id,
          userRole,
          channelType
        );

        learnedPatterns = patterns.map(p => ({
          pattern: p.pattern,
          action: p.action,
          confidence: p.confidence,
        }));

        logger.info(`🧠 V3 LEARNING: Found ${learnedPatterns.length} applicable patterns`);
        if (learnedPatterns.length > 0) {
          learnedPatterns.forEach(p => {
            logger.info(`   - ${p.pattern} → ${p.action} (${(p.confidence * 100).toFixed(0)}% confidence)`);
          });
        }

        // Fetch action history for this user (from ContextEngine via V3Integration)
        // For now, use trust history as proxy
        const recentPunishments = userProfile.history.filter(
          (h: any) => h.action === 'timeout' || h.action === 'ban'
        );

        actionHistory = {
          totalActions: userProfile.history.length,
          recentPunishments: recentPunishments.length,
          lastAction: recentPunishments.length > 0 ? recentPunishments[recentPunishments.length - 1].action : undefined,
        };

        if (actionHistory.recentPunishments > 0) {
          logger.info(`📜 V3 HISTORY: User has ${actionHistory.recentPunishments} recent punishments`);
        }
      } catch (error) {
        logger.error('Failed to fetch V3 learning context', error);
      }
    }

    // 🧠 AI REASONING - Let Qwen3:8b analyze the situation
    logger.info('🧠 Starting AI reasoning with Qwen3:8b...');
    const aiReasoning = await this.performAIReasoning(
      analyzed,
      userProfile,
      conversationContext,
      learnedPatterns,
      actionHistory
    );
    logger.info(`✅ AI Reasoning complete: ${aiReasoning.decision}`);

    // 1. Detect threats (AI-enhanced)
    const detectedThreats: ReasoningResult['detectedThreats'] = aiReasoning.threats;
    logger.info(`🔍 AI detected ${detectedThreats.length} threats`);

    // 2. Determine if should respond (AI-enhanced)
    const wasMentioned = perception.message.mentions.has(perception.message.client.user!.id);
    const startsWithBecas = analyzed.content.toLowerCase().startsWith('becas');
    const isAddressingBecas = wasMentioned || startsWithBecas;

    const shouldRespond = isAddressingBecas || aiReasoning.decision === 'respond';

    // 3. Use AI decision for response type (map "respond" to "engage")
    let responseType: ReasoningResult['responseType'] =
      aiReasoning.decision === 'respond' ? 'engage' : aiReasoning.decision;
    let confidence = aiReasoning.confidence;

    logger.info(`🧠 AI Decision: ${responseType} (${(confidence * 100).toFixed(0)}% confidence)`);

    // 4. Use AI suggested actions
    const suggestedActions: ReasoningResult['suggestedActions'] = aiReasoning.suggestedActions;
    logger.info(`💡 AI suggested ${suggestedActions.length} actions`);
    suggestedActions.forEach(a => {
      logger.info(`   - ${a.type} (priority ${a.priority}): ${a.reason}`);
    });

    // 5. Determine emotional response
    let emotionalResponse: ReasoningResult['emotionalResponse'] = {
      type: 'calm',
      intensity: 0.5,
    };

    if (detectedThreats.length > 0) {
      emotionalResponse = { type: 'firm', intensity: 0.8 };
    } else if (analyzed.sentiment.dominant === 'negative') {
      emotionalResponse = { type: 'supportive', intensity: 0.6 };
    } else if (analyzed.sentiment.dominant === 'positive') {
      emotionalResponse = { type: 'playful', intensity: 0.7 };
    }

    // 6. Use AI reasoning + add context
    const reasoning = `🧠 AI: ${aiReasoning.reasoning}\n` + this.buildReasoning(
      responseType,
      detectedThreats,
      suggestedActions,
      analyzed,
      learnedPatterns, // Add learned patterns as context
      userProfile.trustScore,
      actionHistory,
      dependencies.v3Context // 🔥 V3 CONTEXT - Recent actions/messages
    );

    const processingTime = performance.now() - startTime;

    logger.debug(`Reasoning complete: ${processingTime.toFixed(2)}ms`);
    logger.debug(`  Response type: ${responseType}`);
    logger.debug(`  Threats: ${detectedThreats.length}`);
    logger.debug(`  Actions: ${suggestedActions.length}`);

    return {
      shouldRespond,
      responseType,
      confidence,
      reasoning,
      detectedThreats,
      suggestedActions,
      emotionalResponse,
      learnedPatterns, // 🔥 V3 LEARNING
      actionHistory,   // 🔥 V3 HISTORY
      processingTime,
    };
  }

  /**
   * 🧠 AI REASONING - Qwen3:8b analyzes the situation and suggests actions
   */
  private async performAIReasoning(
    analyzed: AnalyzedMessage,
    userProfile: PerceptionResult['userProfile'],
    conversationContext: string[],
    learnedPatterns: Array<{ pattern: string; action: string; confidence: number }>,
    actionHistory?: { totalActions: number; recentPunishments: number; lastAction?: string }
  ): Promise<{
    decision: 'moderate' | 'respond' | 'support' | 'none';
    threats: Array<{ type: string; severity: number; confidence: number; evidence: string }>;
    suggestedActions: Array<{ type: string; priority: number; reason: string }>;
    reasoning: string;
    confidence: number;
  }> {
    try {
      const prompt = `You are BECAS, an AI moderator analyzing a Discord message. Perform COMPLETE analysis in ONE SHOT:
1. SCAM/PHISHING detection (URLs, suspicious patterns, fraud attempts)
2. TOXICITY analysis (hate speech, harassment, insults)
3. POLICY violations (spam, manipulation, harmful content)
4. TRUST evaluation (user history, repeat offender patterns)

**MESSAGE:**
"${analyzed.content}"

**CONTEXT:**
- User: ${analyzed.authorName}
- Trust Score: ${userProfile.trustScore.score}/100 (${userProfile.trustScore.level})
- Sentiment: ${analyzed.sentiment.dominant}
- Recent Punishments: ${actionHistory?.recentPunishments || 0}
${learnedPatterns.length > 0 ? `- Learned Patterns: ${learnedPatterns.map(p => p.pattern).join(', ')}` : ''}

**RECENT CONVERSATION:**
${conversationContext.slice(-5).join('\n')}

**ANALYZE FOR:**
1. **SCAM/PHISHING**: Check for suspicious URLs, fake giveaways, phishing attempts, social engineering
2. **TOXICITY**: Hate speech, harassment, insults, threats, discriminatory language
3. **MANIPULATION**: Psychological manipulation, gaslighting, false information
4. **CONTEXT**: Is this friendly banter or genuine harm? Cultural nuance?
5. **PROPORTIONALITY**: What action fits this violation?

Respond with JSON:
{
  "decision": "moderate" | "respond" | "support" | "none",
  "threats": [
    {
      "type": "toxicity" | "scam" | "phishing" | "harassment" | "spam" | "manipulation",
      "severity": 1-10,
      "confidence": 0.0-1.0,
      "evidence": "brief explanation"
    }
  ],
  "suggestedActions": [
    {
      "type": "timeout" | "ban" | "warn" | "delete",
      "priority": 1-10,
      "reason": "brief justification"
    }
  ],
  "reasoning": "Your complete analysis covering scam/toxicity/policy (2-3 sentences)",
  "confidence": 0.0-1.0
}`;

      const systemPrompt = `You are an expert AI moderator with deep understanding of:
- Context and nuance (friendly joke vs toxic attack)
- Trust and redemption (users can improve)
- Proportionality (punishment must fit the crime)
- Cultural differences (slang, humor, language)

Be fair, contextual, and balanced. Don't over-react to edge cases.`;

      const schema = `{
  "decision": string,
  "threats": array,
  "suggestedActions": array,
  "reasoning": string,
  "confidence": number
}`;

      const result = await this.cognitiveAI.generateJSON<{
        decision: 'moderate' | 'respond' | 'support' | 'none';
        threats: Array<{ type: string; severity: number; confidence: number; evidence: string }>;
        suggestedActions: Array<{ type: string; priority: number; reason: string }>;
        reasoning: string;
        confidence: number;
      }>(prompt, systemPrompt, schema);

      logger.info(`🧠 AI REASONING OUTPUT:`);
      logger.info(`   Decision: ${result.decision}`);
      logger.info(`   Confidence: ${(result.confidence * 100).toFixed(0)}%`);
      logger.info(`   Threats: ${result.threats.length}`);
      logger.info(`   Reasoning: ${result.reasoning}`);

      return result;
    } catch (error) {
      logger.error('AI reasoning failed, falling back to rule-based:', error);

      // FALLBACK: Rule-based reasoning
      const threats: any[] = [];
      if (analyzed.toxicity > 0.7) {
        threats.push({
          type: 'toxicity',
          severity: Math.floor(analyzed.toxicity * 10),
          confidence: analyzed.toxicity,
          evidence: `Toxicity: ${(analyzed.toxicity * 100).toFixed(0)}%`,
        });
      }

      if (analyzed.manipulation > 0.7) {
        threats.push({
          type: 'scam',
          severity: Math.floor(analyzed.manipulation * 10),
          confidence: analyzed.manipulation,
          evidence: `High manipulation detected`,
        });
      }

      if (userProfile.trustScore.score < 30) {
        threats.push({
          type: 'low_trust',
          severity: 7,
          confidence: 0.9,
          evidence: `Trust score: ${userProfile.trustScore.score}/100`,
        });
      }

      const suggestedActions: any[] = [];
      if (threats.length > 0) {
        suggestedActions.push({
          type: 'timeout',
          priority: 8,
          reason: 'Multiple threats detected (fallback rule)',
        });
      }

      return {
        decision: threats.length > 0 ? 'moderate' : 'none',
        threats,
        suggestedActions,
        reasoning: 'AI reasoning unavailable - used fallback rules',
        confidence: 0.5,
      };
    }
  }

  private buildReasoning(
    responseType: string,
    threats: any[],
    actions: any[],
    analyzed: AnalyzedMessage,
    learnedPatterns?: Array<{ pattern: string; action: string; confidence: number }>,
    trustScore?: any,
    actionHistory?: { totalActions: number; recentPunishments: number; lastAction?: string },
    v3Context?: any  // 🔥 V3 CONTEXT - Recent actions/messages
  ): string {
    const parts: string[] = [];

    // 🔥 V3 CONTEXT - Add recent actions context
    if (v3Context && v3Context.recentActions && v3Context.recentActions.length > 0) {
      parts.push(`🕐 Recent Actions (last hour): ${v3Context.recentActions.length} actions taken`);
      v3Context.recentActions.slice(0, 3).forEach((action: any) => {
        const timeAgo = Math.floor((Date.now() - action.timestamp) / 60000); // minutes ago
        parts.push(`  • ${action.type} on ${action.targetUsername} (${timeAgo}m ago)`);
      });
    }

    // 🔥 V3 CONTEXT - Add as INFO, not as automatic action
    if (learnedPatterns && learnedPatterns.length > 0) {
      parts.push(`📚 Learned patterns available (${learnedPatterns.length})`);
      learnedPatterns.forEach(p => {
        parts.push(`  • ${p.pattern} (${(p.confidence * 100).toFixed(0)}% confidence)`);
      });
    }

    if (trustScore) {
      parts.push(`🔒 Trust: ${trustScore.score}/100 (${trustScore.level})`);
    }

    if (actionHistory && actionHistory.recentPunishments > 0) {
      parts.push(`📜 History: ${actionHistory.recentPunishments} recent punishments`);
    }

    if (threats.length > 0) {
      parts.push(`Detected ${threats.length} threat(s): ${threats.map(t => t.type).join(', ')}`);
    }

    if (actions.length > 0) {
      parts.push(`Suggested ${actions.length} action(s): ${actions.map(a => a.type).join(', ')}`);
    }

    parts.push(`Response type: ${responseType}`);
    parts.push(`Sentiment: ${analyzed.sentiment.dominant}`);
    parts.push(`Toxicity: ${(analyzed.toxicity * 100).toFixed(0)}%`);

    return parts.join('. ');
  }
}

// ==========================================
// DECISION ENGINE
// ==========================================

export class DecisionEngine {
  private severityCalculator: SeverityCalculator;

  constructor() {
    this.severityCalculator = new SeverityCalculator();
  }

  /**
   * Make final decision based on reasoning
   */
  async decide(
    perception: PerceptionResult,
    reasoning: ReasoningResult,
    dependencies: {
      personality: any;
      dialogue: any;
      memory: any;
      scamAnalysis?: ScamAnalysis; // 🔥 NEW: Scam analysis for severity calculation
    }
  ): Promise<DecisionResult> {
    const startTime = performance.now();

    // 1. Determine primary action
    let action: DecisionResult['action'] = 'none';
    let moderationAction: DecisionResult['moderationAction'] = undefined;
    let responseContent: string | undefined = undefined;
    let shouldNotifyMods = false;
    let shouldUpdateTrust = true;
    let trustDelta: number | undefined = undefined;

    // 2. Handle moderation cases with NEW SEVERITY CALCULATOR
    if (reasoning.responseType === 'moderate') {
      action = 'moderate';

      // 🔥 USE SEVERITY CALCULATOR - Trust score + context + history
      const recentViolations = perception.userProfile.history.filter(
        (h: any) => h.delta < 0 &&
        (Date.now() - new Date(h.timestamp).getTime()) < 7 * 24 * 60 * 60 * 1000 // Last 7 days
      ).length;

      const severityResult = this.severityCalculator.calculateSeverity({
        message: perception.analyzed,
        trustScore: perception.userProfile.trustScore,
        scamAnalysis: dependencies.scamAnalysis,
        isProvoked: false, // TODO: Implement provocation detection
        recentViolations,
      });

      logger.info(`🎯 SEVERITY CALCULATOR RESULT:`);
      logger.info(`   Action: ${severityResult.action}`);
      logger.info(`   Severity: ${severityResult.severity}/10`);
      logger.info(`   Confidence: ${(severityResult.confidence * 100).toFixed(0)}%`);
      logger.info(`   Trust Modifier: ${severityResult.modifiers.trustScoreModifier >= 0 ? '+' : ''}${severityResult.modifiers.trustScoreModifier}`);
      logger.info(`   History Modifier: ${severityResult.modifiers.historyModifier >= 0 ? '+' : ''}${severityResult.modifiers.historyModifier}`);
      logger.info(`   Redemption Modifier: ${severityResult.modifiers.redemptionModifier >= 0 ? '+' : ''}${severityResult.modifiers.redemptionModifier}`);
      logger.info(`   Total Modifiers: ${severityResult.modifiers.total >= 0 ? '+' : ''}${severityResult.modifiers.total}`);
      logger.info(`   Reason: ${severityResult.reason}`);

      // Apply severity calculator decision
      if (severityResult.action !== 'none') {
        moderationAction = {
          type: severityResult.action as 'warn' | 'timeout' | 'kick' | 'ban',
          duration: severityResult.duration,
          reason: severityResult.reason,
        };

        // Calculate trust delta based on action severity
        if (severityResult.action === 'ban') {
          trustDelta = -50;
          shouldNotifyMods = true;
        } else if (severityResult.action === 'kick') {
          trustDelta = -30;
          shouldNotifyMods = true;
        } else if (severityResult.action === 'timeout') {
          trustDelta = -20;
        } else if (severityResult.action === 'warn') {
          trustDelta = -10;
        } else if (severityResult.action === 'delete') {
          trustDelta = -5;
        }
      }
    }

    // 3. Handle response cases
    if (reasoning.shouldRespond && reasoning.responseType !== 'moderate') {
      action = 'respond';

      // Generate response content
      const emotionalState = dependencies.personality.getEmotionalState();
      const userSummary = dependencies.memory.getUserSummary(
        perception.context.authorId,
        perception.context.guildId
      );

      const response = await dependencies.dialogue.generateResponse(
        perception.analyzed,
        perception.userProfile.trustScore,
        {
          recentMessages: perception.conversationContext,
          communityMood: perception.communityState.mood,
          userSummary,
        }
      );

      responseContent = response.content;

      // Check if response includes action
      if (response.action) {
        action = 'moderate';
        moderationAction = {
          type: response.action.type,
          duration: response.action.duration,
          reason: response.reasoning || 'AI decision',
        };
      }
    }

    // 4. Handle support cases
    if (reasoning.responseType === 'support') {
      action = 'support';
      shouldNotifyMods = true;
    }

    // 5. Calculate total processing time
    const decisionTime = performance.now() - startTime;
    const totalTime = perception.processingTime + reasoning.processingTime + decisionTime;

    logger.info(`Decision made: ${action} (${totalTime.toFixed(2)}ms total)`);
    if (moderationAction) {
      logger.info(`  🚨 DECISION ENGINE: Moderation action SET`);
      logger.info(`     Type: ${moderationAction.type}`);
      logger.info(`     Reason: ${moderationAction.reason}`);
      logger.info(`     Duration: ${moderationAction.duration || 'N/A'}`);
    } else {
      logger.info(`  ℹ️  DECISION ENGINE: No moderation action set`);
    }

    return {
      action,
      moderationAction,
      responseContent,
      shouldNotifyMods,
      shouldUpdateTrust,
      trustDelta,
      metadata: {
        perceptionTime: perception.processingTime,
        reasoningTime: reasoning.processingTime,
        decisionTime,
        totalTime,
        confidence: reasoning.confidence,
      },
    };
  }

  /**
   * Calculate timeout duration with ESCALATION based on repeat offenses
   *
   * Logic:
   * 1. User does something bad → Gets timeout (10min)
   * 2. User serves timeout (pays the price)
   * 3. User does SAME bad thing again → AI remembers → ESCALATES (1 hour)
   * 4. User still doesn't learn → ESCALATES MORE (1 day)
   * 5. Persistent offender → Permanent ban
   *
   * This teaches users to learn from mistakes, not just "pay and repeat"
   */
  private calculateTimeoutDuration(
    toxicity: number,
    userHistory?: Array<{ action: string; reason: string; timestamp: Date }>
  ): number {
    // Base duration based on toxicity level
    let baseDuration: number;
    if (toxicity >= 0.95) baseDuration = 3600000; // 60 minutes
    else if (toxicity >= 0.9) baseDuration = 1800000;  // 30 minutes
    else if (toxicity >= 0.85) baseDuration = 1200000; // 20 minutes
    else if (toxicity >= 0.8) baseDuration = 600000;   // 10 minutes
    else baseDuration = 300000; // 5 minutes default

    // Check if user has been punished before for similar offense
    if (userHistory && userHistory.length > 0) {
      // Count how many times user was punished in the last 7 days
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentPunishments = userHistory.filter(
        h => new Date(h.timestamp) > oneWeekAgo &&
             (h.action === 'timeout' || h.action === 'ban')
      );

      const offenseCount = recentPunishments.length;

      // ESCALATION LADDER
      if (offenseCount === 0) {
        // First offense - use base duration
        return baseDuration;
      } else if (offenseCount === 1) {
        // Second offense - 4x escalation
        return baseDuration * 4;
      } else if (offenseCount === 2) {
        // Third offense - 24x escalation (turns 10min → 4 hours)
        return baseDuration * 24;
      } else if (offenseCount >= 3) {
        // Fourth+ offense - 144x escalation (turns 10min → 1 day)
        return baseDuration * 144;
      }
    }

    return baseDuration;
  }
}

// ==========================================
// COGNITIVE CORE
// ==========================================

export class CognitiveCore {
  private perceptionEngine: PerceptionEngine;
  private reasoningEngine: ReasoningEngine;
  private decisionEngine: DecisionEngine;

  constructor() {
    this.perceptionEngine = new PerceptionEngine();
    this.reasoningEngine = new ReasoningEngine();
    this.decisionEngine = new DecisionEngine();
    logger.info('CognitiveCore initialized (Perception → Reasoning → Decision)');
  }

  /**
   * Full cognitive processing pipeline
   */
  async process(
    message: Message,
    stableContext: StableContext,
    dependencies: {
      dialogue: any;
      memory: any;
      trustEngine: any;
      personality: any;
      scamDetector?: any;
      conflictPredictor?: any;
      userMonitor?: any;
      scamAnalysis?: ScamAnalysis; // 🔥 NEW: Pre-analyzed scam detection result
      v3Integration?: V3Integration; // 🔥 V3 LEARNING INTEGRATION
      v3Context?: any; // 🔥 V3 CONTEXT - Recent actions/messages
    }
  ): Promise<DecisionResult> {
    const startTime = performance.now();

    // Phase 1: Perception
    logger.debug('Phase 1: Perception...');
    const perception = await this.perceptionEngine.perceive(
      message,
      stableContext,
      {
        dialogue: dependencies.dialogue,
        memory: dependencies.memory,
        trustEngine: dependencies.trustEngine,
        userMonitor: dependencies.userMonitor,
      }
    );

    // Phase 2: Reasoning
    logger.debug('Phase 2: Reasoning...');
    const reasoning = await this.reasoningEngine.reason(
      perception,
      {
        dialogue: dependencies.dialogue,
        personality: dependencies.personality,
        scamDetector: dependencies.scamDetector,
        conflictPredictor: dependencies.conflictPredictor,
        v3Integration: dependencies.v3Integration, // 🔥 V3 LEARNING INTEGRATION
        v3Context: dependencies.v3Context, // 🔥 V3 CONTEXT - Recent actions/messages
      }
    );

    // Phase 3: Decision
    logger.debug('Phase 3: Decision...');
    const decision = await this.decisionEngine.decide(
      perception,
      reasoning,
      {
        personality: dependencies.personality,
        dialogue: dependencies.dialogue,
        memory: dependencies.memory,
        scamAnalysis: dependencies.scamAnalysis, // 🔥 Pass scam analysis to decision engine

      }
    );

    const totalTime = performance.now() - startTime;
    logger.info(`✓ Cognitive processing complete: ${totalTime.toFixed(2)}ms`);
    logger.info(`  Perception: ${perception.processingTime.toFixed(2)}ms`);
    logger.info(`  Reasoning: ${reasoning.processingTime.toFixed(2)}ms`);
    logger.info(`  Decision: ${decision.metadata.decisionTime.toFixed(2)}ms`);

    return decision;
  }

  /**
   * Get performance stats
   */
  getStats(): {
    averagePerceptionTime: number;
    averageReasoningTime: number;
    averageDecisionTime: number;
    averageTotalTime: number;
  } {
    // Would track these in production
    return {
      averagePerceptionTime: 0,
      averageReasoningTime: 0,
      averageDecisionTime: 0,
      averageTotalTime: 0,
    };
  }
}
