// WatchSystem.ts - Monitor users and trigger actions based on conditions
// Enables complex workflows like "watch all trust <50 users for 3 hours if they make FUD ban them"

import { Guild, Message, User } from 'discord.js';
import { TrustScoreEngine } from './TrustScoreEngine';
import { ActionExecutor } from './ActionExecutor';
import { createLogger } from '../services/Logger';
import { OllamaService } from '../services/OllamaService';
import { IntentAnalyzer } from './IntentAnalyzer'; // 🔥 NEW: Multi-layer intent analysis

const logger = createLogger('WatchSystem');

// ============================================
// CONDITION TYPES
// ============================================

export type ConditionType =
  | 'fud_detection'        // Detects FUD (Fear, Uncertainty, Doubt) about project
  | 'negative_sentiment'   // Detects negative sentiment
  | 'spam_detection'       // Detects spam behavior
  | 'toxicity'             // Detects toxic messages
  | 'trust_drop'           // Trust score dropped below threshold
  | 'violation_count'      // User reached X violations
  | 'custom_keyword'       // Custom keyword/phrase matching
  | 'sentiment_trend'      // 🔥 NEW: User's sentiment declining over time
  | 'message_velocity';    // 🔥 NEW: Rapid-fire messaging pattern

export interface WatchCondition {
  type: ConditionType;
  threshold?: number;      // For trust_drop, violation_count, toxicity
  keywords?: string[];     // For custom_keyword
  description: string;
}

// ============================================
// WATCH CONFIGURATION
// ============================================

export interface WatchConfig {
  id: string;
  guildId: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;

  // Who to watch
  userIds: string[];       // Specific user IDs
  filter?: {               // OR filter criteria (trust score, role, etc.)
    trustScoreMin?: number;
    trustScoreMax?: number;
    hasRole?: string;
    lacksRole?: string;
    joinedWithinDays?: number;
  };

  // What to watch for
  conditions: WatchCondition[];

  // What to do when triggered
  actions: ConditionalAction[];

  // Optional: Where to announce results
  announceChannel?: string;
  announceTemplate?: string;

  // Status
  active: boolean;
  triggerCount: number;

  // 🔥 NEW: Multi-stage escalation tracking
  escalation?: EscalationConfig;
  violationTracking?: Map<string, ViolationRecord>; // userId -> violations
}

// ============================================
// CONDITIONAL & MULTI-STAGE ACTIONS
// ============================================

export interface ConditionalAction {
  // Basic action
  action_id: string;
  parameters: Record<string, any>;

  // 🔥 NEW: Conditional logic
  condition?: ActionCondition;

  // 🔥 NEW: Alternative action if condition fails
  elseAction?: ConditionalAction;
}

export interface ActionCondition {
  type: 'trust_score' | 'violation_count' | 'user_age_days' | 'message_count' | 'always';
  operator?: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value?: number;
}

export interface EscalationConfig {
  enabled: boolean;
  stages: EscalationStage[];
  resetAfterHours?: number; // Reset violation count after X hours
}

export interface EscalationStage {
  violationCount: number;
  action_id: string;
  parameters: Record<string, any>;
  description: string;
}

export interface ViolationRecord {
  count: number;
  firstViolation: Date;
  lastViolation: Date;
  history: {
    timestamp: Date;
    conditionType: ConditionType;
    evidence: string;
  }[];
}

// ============================================
// TRIGGER EVENT
// ============================================

export interface TriggerEvent {
  watchId: string;
  userId: string;
  userName: string;
  conditionType: ConditionType;
  message: Message;
  evidence: string;         // What triggered it
  confidence: number;       // 0-1 confidence score
  timestamp: Date;
}

// ============================================
// WATCH SYSTEM
// ============================================

export class WatchSystem {
  private activeWatches: Map<string, WatchConfig> = new Map();
  private trustEngine: TrustScoreEngine;
  private actionExecutor: ActionExecutor;
  private ollama: OllamaService;
  private intentAnalyzer: IntentAnalyzer; // 🔥 NEW: Multi-layer intent analysis

  // 🔥 NEW: Track user behavior patterns
  private userSentimentHistory: Map<string, { sentiment: number; timestamp: Date }[]> = new Map();
  private userMessageTimestamps: Map<string, Date[]> = new Map();

  // Cleanup timer
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    trustEngine: TrustScoreEngine,
    actionExecutor: ActionExecutor,
    ollama: OllamaService
  ) {
    this.trustEngine = trustEngine;
    this.actionExecutor = actionExecutor;
    this.ollama = ollama;
    this.intentAnalyzer = new IntentAnalyzer(trustEngine); // 🔥 Initialize intent analyzer

    // Cleanup expired watches every minute
    this.cleanupInterval = setInterval(() => this.cleanupExpiredWatches(), 60000);

    logger.info('WatchSystem initialized with Multi-Layer Intent Analysis');
  }

  /**
   * Create a new watch
   */
  async createWatch(config: Omit<WatchConfig, 'id' | 'createdAt' | 'active' | 'triggerCount' | 'violationTracking'>): Promise<string> {
    const watchId = `watch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const watch: WatchConfig = {
      ...config,
      id: watchId,
      createdAt: new Date(),
      active: true,
      triggerCount: 0,
      violationTracking: new Map() // 🔥 NEW: Track violations per user
    };

    this.activeWatches.set(watchId, watch);

    logger.info(`Created watch ${watchId}: monitoring ${watch.userIds.length || 'filtered'} users for ${watch.conditions.length} conditions`);

    if (watch.escalation?.enabled) {
      logger.info(`  🔥 Escalation enabled with ${watch.escalation.stages.length} stages`);
    }

    return watchId;
  }

  /**
   * Check if a message triggers any active watches
   */
  async checkMessage(message: Message): Promise<TriggerEvent[]> {
    if (!message.guild || !message.author) return [];

    const triggers: TriggerEvent[] = [];
    const userId = message.author.id;
    const guildId = message.guild.id;

    // Check all active watches for this guild
    for (const watch of this.activeWatches.values()) {
      if (watch.guildId !== guildId || !watch.active) continue;

      // Check if this user is being watched
      const isWatched = this.isUserWatched(userId, watch, message.guild);
      if (!isWatched) continue;

      // Check each condition
      for (const condition of watch.conditions) {
        const result = await this.checkCondition(message, condition);

        if (result.triggered) {
          const event: TriggerEvent = {
            watchId: watch.id,
            userId,
            userName: message.author.tag,
            conditionType: condition.type,
            message,
            evidence: result.evidence,
            confidence: result.confidence,
            timestamp: new Date()
          };

          triggers.push(event);

          logger.warn(`🚨 Watch triggered: ${watch.id} - ${condition.type} by ${message.author.tag}`);

          // Execute actions
          await this.executeTriggerActions(watch, event);
        }
      }
    }

    return triggers;
  }

  /**
   * Check if a user is being watched
   */
  private async isUserWatched(userId: string, watch: WatchConfig, guild: Guild): Promise<boolean> {
    // Check explicit user list
    if (watch.userIds.includes(userId)) return true;

    // Check filter criteria
    if (watch.filter) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return false;

      // Trust score filter
      if (watch.filter.trustScoreMin !== undefined || watch.filter.trustScoreMax !== undefined) {
        const trustScore = this.trustEngine.getTrustScore(userId, guild.id);
        if (watch.filter.trustScoreMin && trustScore.score < watch.filter.trustScoreMin) return false;
        if (watch.filter.trustScoreMax && trustScore.score > watch.filter.trustScoreMax) return false;
      }

      // Role filters
      if (watch.filter.hasRole) {
        const hasRole = member.roles.cache.some(r => r.name.toLowerCase() === watch.filter!.hasRole!.toLowerCase());
        if (!hasRole) return false;
      }

      if (watch.filter.lacksRole) {
        const hasRole = member.roles.cache.some(r => r.name.toLowerCase() === watch.filter!.lacksRole!.toLowerCase());
        if (hasRole) return false;
      }

      // Join time filter
      if (watch.filter.joinedWithinDays) {
        const joinedMs = member.joinedTimestamp || 0;
        const daysAgo = (Date.now() - joinedMs) / (1000 * 60 * 60 * 24);
        if (daysAgo > watch.filter.joinedWithinDays) return false;
      }

      return true;
    }

    return false;
  }

  /**
   * Check a specific condition against a message
   */
  private async checkCondition(
    message: Message,
    condition: WatchCondition
  ): Promise<{ triggered: boolean; evidence: string; confidence: number }> {

    switch (condition.type) {
      case 'fud_detection':
        return await this.detectFUD(message);

      case 'negative_sentiment':
        return await this.detectNegativeSentiment(message);

      case 'spam_detection':
        return await this.detectSpam(message);

      case 'toxicity':
        return await this.detectToxicity(message, condition.threshold || 0.7);

      case 'trust_drop':
        return this.checkTrustDrop(message, condition.threshold || 50);

      case 'custom_keyword':
        return this.checkKeywords(message, condition.keywords || []);

      case 'sentiment_trend': // 🔥 NEW
        return await this.detectSentimentTrend(message, condition.threshold || -0.3);

      case 'message_velocity': // 🔥 NEW
        return this.detectMessageVelocity(message, condition.threshold || 5);

      default:
        return { triggered: false, evidence: '', confidence: 0 };
    }
  }

  /**
   * 🔥 UPGRADED: Detect FUD with Multi-Layer Intent Analysis
   * Now distinguishes between genuine FUD, criticism, frustration, and jokes
   */
  private async detectFUD(message: Message): Promise<{ triggered: boolean; evidence: string; confidence: number }> {
    try {
      // Use IntentAnalyzer for deep understanding
      const analysis = await this.intentAnalyzer.analyzeIntent(message);

      // Check if primary intent is FUD
      const isFUD = analysis.deep.primaryIntent === 'fud';

      // CRITICAL: Don't trigger on jokes, criticism, or frustration
      const falsePositives = ['joke', 'constructive_criticism', 'frustration', 'genuine_concern'];
      const isFalsePositive = falsePositives.includes(analysis.deep.primaryIntent);

      // Build detailed evidence
      let evidence = `${analysis.deep.primaryIntent}`;
      if (analysis.deep.secondaryIntent) {
        evidence += ` + ${analysis.deep.secondaryIntent}`;
      }
      evidence += ` | ${analysis.deep.emotionalState} | ${analysis.conversational.socialContext}`;
      evidence += ` | ${analysis.overallAssessment.explanation}`;

      logger.info(`FUD detection for ${message.author.tag}: Intent=${analysis.deep.primaryIntent}, Genuine=${analysis.overallAssessment.isGenuinelyHarmful}`);

      return {
        triggered: isFUD && !isFalsePositive && analysis.overallAssessment.isGenuinelyHarmful,
        evidence,
        confidence: analysis.deep.confidence
      };
    } catch (error) {
      logger.error('Enhanced FUD detection failed, falling back to simple detection:', error);

      // Fallback to simple keyword detection
      const content = message.content.toLowerCase();
      const fudKeywords = ['scam', 'rug pull', 'exit scam', 'ponzi', 'dead project'];
      const hasFudKeyword = fudKeywords.some(k => content.includes(k));

      return {
        triggered: hasFudKeyword,
        evidence: hasFudKeyword ? 'FUD keyword detected (fallback)' : '',
        confidence: hasFudKeyword ? 0.6 : 0
      };
    }
  }

  /**
   * Detect negative sentiment
   */
  private async detectNegativeSentiment(message: Message): Promise<{ triggered: boolean; evidence: string; confidence: number }> {
    const prompt = `Analyze sentiment of this message:

"${message.content}"

Return JSON:
{"sentiment": "positive" | "negative" | "neutral", "confidence": 0.0-1.0, "reason": "why"}`;

    try {
      const response = await this.ollama.generate(prompt, 'Analyze sentiment accurately.');
      const cleaned = response.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
      const result = JSON.parse(cleaned);

      return {
        triggered: result.sentiment === 'negative' && result.confidence > 0.6,
        evidence: result.reason,
        confidence: result.confidence
      };
    } catch (error) {
      return { triggered: false, evidence: '', confidence: 0 };
    }
  }

  /**
   * Detect spam behavior
   */
  private async detectSpam(message: Message): Promise<{ triggered: boolean; evidence: string; confidence: number }> {
    // Simple heuristics for now
    const content = message.content;

    // Excessive caps
    const capsRatio = (content.match(/[A-Z]/g) || []).length / content.length;
    if (capsRatio > 0.7 && content.length > 10) {
      return {
        triggered: true,
        evidence: 'Excessive capitalization (spam)',
        confidence: 0.8
      };
    }

    // Repeated characters
    if (/(.)\1{5,}/.test(content)) {
      return {
        triggered: true,
        evidence: 'Repeated characters (spam)',
        confidence: 0.9
      };
    }

    // Mass mentions
    if (message.mentions.users.size > 5) {
      return {
        triggered: true,
        evidence: `Mass mentions (${message.mentions.users.size} users)`,
        confidence: 0.95
      };
    }

    return { triggered: false, evidence: '', confidence: 0 };
  }

  /**
   * Detect toxicity
   */
  private async detectToxicity(message: Message, threshold: number): Promise<{ triggered: boolean; evidence: string; confidence: number }> {
    // Use existing trust engine toxicity detection
    // For now, simple keyword matching
    const toxicKeywords = ['fuck', 'shit', 'idiot', 'stupid', 'retard', 'kill yourself'];
    const content = message.content.toLowerCase();

    for (const keyword of toxicKeywords) {
      if (content.includes(keyword)) {
        return {
          triggered: true,
          evidence: `Toxic language detected: "${keyword}"`,
          confidence: 0.9
        };
      }
    }

    return { triggered: false, evidence: '', confidence: 0 };
  }

  /**
   * Check trust score drop
   */
  private checkTrustDrop(message: Message, threshold: number): { triggered: boolean; evidence: string; confidence: number } {
    const trustScore = this.trustEngine.getTrustScore(message.author.id, message.guild!.id);

    if (trustScore.score < threshold) {
      return {
        triggered: true,
        evidence: `Trust score ${trustScore.score} below threshold ${threshold}`,
        confidence: 1.0
      };
    }

    return { triggered: false, evidence: '', confidence: 0 };
  }

  /**
   * Check custom keywords
   */
  private checkKeywords(message: Message, keywords: string[]): { triggered: boolean; evidence: string; confidence: number } {
    const content = message.content.toLowerCase();

    for (const keyword of keywords) {
      if (content.includes(keyword.toLowerCase())) {
        return {
          triggered: true,
          evidence: `Keyword match: "${keyword}"`,
          confidence: 1.0
        };
      }
    }

    return { triggered: false, evidence: '', confidence: 0 };
  }

  /**
   * 🔥 NEW: Detect sentiment trend (user's sentiment declining over time)
   */
  private async detectSentimentTrend(message: Message, threshold: number): Promise<{ triggered: boolean; evidence: string; confidence: number }> {
    const userId = message.author.id;

    // Analyze current message sentiment
    const prompt = `Analyze sentiment of this message on a scale from -1 (very negative) to 1 (very positive):

"${message.content}"

Return JSON: {"sentiment": number between -1 and 1}`;

    try {
      const response = await this.ollama.generate(prompt, 'You are a sentiment analyzer.');
      const cleaned = response.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
      const result = JSON.parse(cleaned);
      const currentSentiment = result.sentiment || 0;

      // Track sentiment history
      if (!this.userSentimentHistory.has(userId)) {
        this.userSentimentHistory.set(userId, []);
      }

      const history = this.userSentimentHistory.get(userId)!;
      history.push({ sentiment: currentSentiment, timestamp: new Date() });

      // Keep only last 10 messages
      if (history.length > 10) {
        history.shift();
      }

      // Check trend (need at least 3 messages)
      if (history.length >= 3) {
        const recentAvg = history.slice(-3).reduce((sum, h) => sum + h.sentiment, 0) / 3;
        const olderAvg = history.slice(0, -3).reduce((sum, h) => sum + h.sentiment, 0) / (history.length - 3);
        const trend = recentAvg - olderAvg;

        if (trend < threshold) {
          return {
            triggered: true,
            evidence: `Sentiment declining: ${olderAvg.toFixed(2)} → ${recentAvg.toFixed(2)} (trend: ${trend.toFixed(2)})`,
            confidence: Math.min(Math.abs(trend), 1)
          };
        }
      }

      return { triggered: false, evidence: '', confidence: 0 };
    } catch (error) {
      logger.error('Sentiment trend detection failed:', error);
      return { triggered: false, evidence: '', confidence: 0 };
    }
  }

  /**
   * 🔥 NEW: Detect message velocity (rapid-fire messaging)
   */
  private detectMessageVelocity(message: Message, threshold: number): { triggered: boolean; evidence: string; confidence: number } {
    const userId = message.author.id;
    const now = new Date();

    // Track message timestamps
    if (!this.userMessageTimestamps.has(userId)) {
      this.userMessageTimestamps.set(userId, []);
    }

    const timestamps = this.userMessageTimestamps.get(userId)!;
    timestamps.push(now);

    // Keep only messages from last 60 seconds
    const cutoff = new Date(now.getTime() - 60000);
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    // Check velocity (messages per minute)
    const messagesPerMinute = timestamps.length;

    if (messagesPerMinute > threshold) {
      return {
        triggered: true,
        evidence: `Rapid messaging: ${messagesPerMinute} messages in last 60 seconds`,
        confidence: Math.min(messagesPerMinute / (threshold * 2), 1)
      };
    }

    return { triggered: false, evidence: '', confidence: 0 };
  }

  /**
   * Execute actions when a watch is triggered
   * 🔥 NEW: Supports conditional actions, escalation, and graduated responses
   */
  private async executeTriggerActions(watch: WatchConfig, event: TriggerEvent): Promise<void> {
    watch.triggerCount++;

    // 🔥 NEW: Track violation for escalation
    if (watch.escalation?.enabled) {
      await this.trackViolation(watch, event);
    }

    // 🔥 NEW: Check if we should use escalation instead of regular actions
    if (watch.escalation?.enabled) {
      const violation = watch.violationTracking?.get(event.userId);
      if (violation) {
        // Find appropriate escalation stage
        const stage = this.getEscalationStage(watch.escalation, violation.count);
        if (stage) {
          logger.info(`🔥 Escalation triggered for ${event.userName}: Stage ${violation.count} - ${stage.description}`);

          const escalationAction: ConditionalAction = {
            action_id: stage.action_id,
            parameters: stage.parameters
          };

          await this.executeConditionalAction(escalationAction, watch, event);

          // Announce escalation
          if (watch.announceChannel) {
            await this.announceEscalation(watch, event, stage, violation);
          }

          return; // Skip regular actions
        }
      }
    }

    // 🔥 NEW: Execute conditional actions (with if/else logic)
    for (const actionStep of watch.actions) {
      try {
        await this.executeConditionalAction(actionStep, watch, event);
      } catch (error) {
        logger.error(`Failed to execute action for watch ${watch.id}:`, error);
      }
    }
  }

  /**
   * 🔥 NEW: Execute a conditional action with if/else logic
   */
  private async executeConditionalAction(
    action: ConditionalAction,
    watch: WatchConfig,
    event: TriggerEvent
  ): Promise<void> {
    // Check if action has a condition
    if (action.condition) {
      const conditionMet = await this.evaluateActionCondition(action.condition, event, watch);

      if (!conditionMet) {
        // Condition not met - execute else action if present
        if (action.elseAction) {
          logger.info(`Condition not met, executing else action: ${action.elseAction.action_id}`);
          await this.executeConditionalAction(action.elseAction, watch, event);
        }
        return;
      }
    }

    // Execute the action
    const executionResult = await this.actionExecutor.execute({
      message: event.message,
      executor: event.message.member!,
      plan: {
        understood_intent: `Watch triggered: ${event.conditionType}`,
        actions: [{
          action_id: action.action_id,
          parameters: action.parameters
        }],
        requires_confirmation: false,
        response_to_moderator: ''
      }
    });

    logger.info(`Executed action ${action.action_id} for watch ${watch.id}: ${executionResult.success ? 'SUCCESS' : 'FAILED'}`);

    // Announce if configured
    if (watch.announceChannel && executionResult.success) {
      await this.announceAction(watch, event, event.message.guild!);
    }
  }

  /**
   * 🔥 NEW: Evaluate action condition
   */
  private async evaluateActionCondition(
    condition: ActionCondition,
    event: TriggerEvent,
    watch: WatchConfig
  ): Promise<boolean> {
    let actualValue: number = 0;

    switch (condition.type) {
      case 'trust_score':
        actualValue = this.trustEngine.getTrustScore(event.userId, event.message.guild!.id).score;
        break;

      case 'violation_count':
        actualValue = watch.violationTracking?.get(event.userId)?.count || 0;
        break;

      case 'user_age_days':
        const member = await event.message.guild!.members.fetch(event.userId);
        const joinedMs = member.joinedTimestamp || 0;
        actualValue = (Date.now() - joinedMs) / (1000 * 60 * 60 * 24);
        break;

      case 'message_count':
        // TODO: Implement message count tracking
        actualValue = 0;
        break;

      case 'always':
        return true;
    }

    // Evaluate operator
    const targetValue = condition.value || 0;
    switch (condition.operator) {
      case '>': return actualValue > targetValue;
      case '<': return actualValue < targetValue;
      case '>=': return actualValue >= targetValue;
      case '<=': return actualValue <= targetValue;
      case '==': return actualValue === targetValue;
      case '!=': return actualValue !== targetValue;
      default: return true;
    }
  }

  /**
   * 🔥 NEW: Track violation for escalation
   */
  private async trackViolation(watch: WatchConfig, event: TriggerEvent): Promise<void> {
    if (!watch.violationTracking) {
      watch.violationTracking = new Map();
    }

    const existing = watch.violationTracking.get(event.userId);

    if (existing) {
      // Check if we should reset (based on time)
      const hoursSinceFirst = (Date.now() - existing.firstViolation.getTime()) / (1000 * 60 * 60);
      if (watch.escalation?.resetAfterHours && hoursSinceFirst > watch.escalation.resetAfterHours) {
        // Reset violations
        watch.violationTracking.set(event.userId, {
          count: 1,
          firstViolation: new Date(),
          lastViolation: new Date(),
          history: [{
            timestamp: new Date(),
            conditionType: event.conditionType,
            evidence: event.evidence
          }]
        });
        logger.info(`Reset violations for ${event.userName} (${hoursSinceFirst.toFixed(1)}h since first)`);
      } else {
        // Increment violations
        existing.count++;
        existing.lastViolation = new Date();
        existing.history.push({
          timestamp: new Date(),
          conditionType: event.conditionType,
          evidence: event.evidence
        });
        logger.info(`Tracked violation #${existing.count} for ${event.userName}`);
      }
    } else {
      // First violation
      watch.violationTracking.set(event.userId, {
        count: 1,
        firstViolation: new Date(),
        lastViolation: new Date(),
        history: [{
          timestamp: new Date(),
          conditionType: event.conditionType,
          evidence: event.evidence
        }]
      });
      logger.info(`First violation tracked for ${event.userName}`);
    }
  }

  /**
   * 🔥 NEW: Get escalation stage based on violation count
   */
  private getEscalationStage(escalation: EscalationConfig, violationCount: number): EscalationStage | null {
    // Find the highest stage that matches
    let matchedStage: EscalationStage | null = null;

    for (const stage of escalation.stages) {
      if (violationCount >= stage.violationCount) {
        matchedStage = stage;
      }
    }

    return matchedStage;
  }

  /**
   * 🔥 NEW: Announce escalation action
   */
  private async announceEscalation(
    watch: WatchConfig,
    event: TriggerEvent,
    stage: EscalationStage,
    violation: ViolationRecord
  ): Promise<void> {
    try {
      const channel = event.message.guild!.channels.cache.get(watch.announceChannel!);
      if (!channel || !channel.isTextBased()) return;

      const template = `🚨 **Escalation Alert**
User: <@${event.userId}>
Violation Count: **${violation.count}**
Stage: **${stage.description}**
Action Taken: **${stage.action_id}**
Evidence: ${event.evidence}

Violation History:
${violation.history.slice(-3).map(h => `• ${h.conditionType} - ${h.timestamp.toLocaleTimeString()}`).join('\n')}`;

      await channel.send(template);
    } catch (error) {
      logger.error('Failed to announce escalation:', error);
    }
  }

  /**
   * Announce action to a channel
   */
  private async announceAction(watch: WatchConfig, event: TriggerEvent, guild: Guild): Promise<void> {
    try {
      const channel = guild.channels.cache.get(watch.announceChannel!);
      if (!channel || !channel.isTextBased()) return;

      const template = watch.announceTemplate ||
        `🚨 **Watch Alert**\nUser: <@${event.userId}>\nReason: ${event.conditionType}\nEvidence: ${event.evidence}\nAction: ${watch.actions.map(a => a.action_id).join(', ')}`;

      await channel.send(template);
    } catch (error) {
      logger.error('Failed to announce action:', error);
    }
  }

  /**
   * Get active watches for a guild
   */
  getActiveWatches(guildId: string): WatchConfig[] {
    return Array.from(this.activeWatches.values())
      .filter(w => w.guildId === guildId && w.active);
  }

  /**
   * Cancel a watch
   */
  cancelWatch(watchId: string): boolean {
    const watch = this.activeWatches.get(watchId);
    if (!watch) return false;

    watch.active = false;
    logger.info(`Cancelled watch ${watchId}`);
    return true;
  }

  /**
   * Cleanup expired watches
   */
  private cleanupExpiredWatches(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [watchId, watch] of this.activeWatches.entries()) {
      if (watch.expiresAt.getTime() < now) {
        this.activeWatches.delete(watchId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} expired watches`);
    }
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    clearInterval(this.cleanupInterval);
    logger.info('WatchSystem shutdown');
  }
}
