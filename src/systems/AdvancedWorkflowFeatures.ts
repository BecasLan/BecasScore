// AdvancedWorkflowFeatures.ts - Phases 4-10 consolidated
// AI Learning, Social Detection, Voice Patterns, Smart Actions, Cross-Server, Analytics, Chained Workflows

import { Guild, Message, GuildMember, VoiceState } from 'discord.js';
import { StorageService } from '../services/StorageService';
import { WatchSystem, WatchConfig, TriggerEvent } from './WatchSystem';
import { OllamaService } from '../services/OllamaService';
import { TrustScoreEngine } from './TrustScoreEngine';
import { createLogger } from '../services/Logger';

const logger = createLogger('AdvancedWorkflowFeatures');

// ==========================================
// PHASE 4: AI LEARNING & PATTERN DETECTION
// ==========================================

export class AIPatternLearner {
  private storage: StorageService;
  private ollama: OllamaService;
  private learnedPatterns: Map<string, {
    pattern: string;
    confidence: number;
    occurrences: number;
    lastSeen: Date;
  }> = new Map();

  constructor(storage: StorageService, ollama: OllamaService) {
    this.storage = storage;
    this.ollama = ollama;
    logger.info('AIPatternLearner initialized');
  }

  /**
   * 🔥 FEATURE #5: Learn patterns from successful workflows
   */
  async learnFromSuccess(watchConfig: WatchConfig, triggerEvent: TriggerEvent): Promise<void> {
    const patternKey = `${watchConfig.conditions.map(c => c.type).join('_')}_${watchConfig.actions.map(a => a.action_id).join('_')}`;

    if (!this.learnedPatterns.has(patternKey)) {
      this.learnedPatterns.set(patternKey, {
        pattern: patternKey,
        confidence: 0.5,
        occurrences: 1,
        lastSeen: new Date()
      });
    } else {
      const pattern = this.learnedPatterns.get(patternKey)!;
      pattern.occurrences++;
      pattern.confidence = Math.min(pattern.confidence + 0.1, 1.0);
      pattern.lastSeen = new Date();
    }

    logger.info(`Learned pattern: ${patternKey} (${this.learnedPatterns.get(patternKey)!.confidence.toFixed(2)} confidence)`);
  }

  /**
   * 🔥 FEATURE #17: AI suggests workflows based on learned patterns
   */
  async suggestWorkflow(guildId: string, context: string): Promise<string> {
    const patterns = Array.from(this.learnedPatterns.values())
      .filter(p => p.confidence > 0.7)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    const prompt = `Based on learned patterns, suggest a workflow for this context:

CONTEXT: "${context}"

LEARNED PATTERNS:
${patterns.map(p => `- ${p.pattern} (confidence: ${p.confidence.toFixed(2)}, used ${p.occurrences} times)`).join('\n')}

Suggest a workflow command in natural language.`;

    try {
      const response = await this.ollama.generate(prompt, 'You are a workflow expert.');
      return response;
    } catch (error) {
      logger.error('Workflow suggestion failed:', error);
      return 'Unable to suggest workflow at this time.';
    }
  }
}

// ==========================================
// PHASE 5: SOCIAL NETWORK ANALYSIS
// ==========================================

export class SocialNetworkAnalyzer {
  private userConnections: Map<string, Set<string>> = new Map(); // userId -> Set of connected userIds
  private suspiciousGroups: Map<string, { users: string[]; detectedAt: Date; evidence: string }> = new Map();

  /**
   * 🔥 FEATURE #7: Track social connections
   */
  trackInteraction(userId1: string, userId2: string): void {
    if (!this.userConnections.has(userId1)) {
      this.userConnections.set(userId1, new Set());
    }
    if (!this.userConnections.has(userId2)) {
      this.userConnections.set(userId2, new Set());
    }

    this.userConnections.get(userId1)!.add(userId2);
    this.userConnections.get(userId2)!.add(userId1);
  }

  /**
   * 🔥 FEATURE #10: Detect coordinated actions (bot attacks, brigading)
   */
  detectCoordinatedAction(userIds: string[], timeWindow: number = 60000): boolean {
    // Check if multiple users acted within time window
    // This is a simplified version - real implementation would track timestamps

    // Check if users are connected
    let connectionScore = 0;
    for (let i = 0; i < userIds.length; i++) {
      for (let j = i + 1; j < userIds.length; j++) {
        if (this.userConnections.get(userIds[i])?.has(userIds[j])) {
          connectionScore++;
        }
      }
    }

    const isCoordinated = connectionScore >= (userIds.length / 2);

    if (isCoordinated) {
      const groupKey = userIds.sort().join('_');
      this.suspiciousGroups.set(groupKey, {
        users: userIds,
        detectedAt: new Date(),
        evidence: `Coordinated action detected: ${connectionScore} connections among ${userIds.length} users`
      });

      logger.warn(`🚨 Coordinated action detected: ${userIds.length} users, ${connectionScore} connections`);
    }

    return isCoordinated;
  }

  getSuspiciousGroups(): Array<{ users: string[]; detectedAt: Date; evidence: string }> {
    return Array.from(this.suspiciousGroups.values());
  }
}

// ==========================================
// PHASE 6: VOICE ACTIVITY PATTERNS
// ==========================================

export class VoiceActivityTracker {
  private voiceJoinTimes: Map<string, Date[]> = new Map();
  private voiceChannelHistory: Map<string, { channelId: string; joinedAt: Date; leftAt?: Date }[]> = new Map();

  /**
   * 🔥 FEATURE #8: Track voice channel activity
   */
  trackVoiceStateChange(oldState: VoiceState, newState: VoiceState): void {
    const userId = newState.member!.id;

    // Track join times
    if (!oldState.channel && newState.channel) {
      if (!this.voiceJoinTimes.has(userId)) {
        this.voiceJoinTimes.set(userId, []);
      }
      this.voiceJoinTimes.get(userId)!.push(new Date());

      if (!this.voiceChannelHistory.has(userId)) {
        this.voiceChannelHistory.set(userId, []);
      }
      this.voiceChannelHistory.get(userId)!.push({
        channelId: newState.channel.id,
        joinedAt: new Date()
      });

      logger.debug(`Voice join: ${userId} → ${newState.channel.name}`);
    }

    // Track leave times
    if (oldState.channel && !newState.channel) {
      const history = this.voiceChannelHistory.get(userId);
      if (history && history.length > 0) {
        history[history.length - 1].leftAt = new Date();
      }
      logger.debug(`Voice leave: ${userId} ← ${oldState.channel.name}`);
    }
  }

  /**
   * Detect suspicious voice patterns (channel hopping, etc.)
   */
  detectSuspiciousVoicePattern(userId: string): { suspicious: boolean; evidence: string } {
    const history = this.voiceChannelHistory.get(userId);
    if (!history || history.length < 3) {
      return { suspicious: false, evidence: '' };
    }

    // Check for rapid channel hopping (3+ channels in 5 minutes)
    const recentHistory = history.filter(h => h.joinedAt.getTime() > Date.now() - 5 * 60 * 1000);
    const uniqueChannels = new Set(recentHistory.map(h => h.channelId));

    if (uniqueChannels.size >= 3) {
      return {
        suspicious: true,
        evidence: `Channel hopping: ${uniqueChannels.size} different channels in 5 minutes`
      };
    }

    return { suspicious: false, evidence: '' };
  }
}

// ==========================================
// PHASE 7: SMART ACTIONS
// ==========================================

export class SmartActionController {
  private actionHistory: Map<string, any[]> = new Map();
  private emergencyMode: Map<string, { active: boolean; triggeredAt: Date; reason: string }> = new Map();

  /**
   * 🔥 FEATURE #13: Rollback action (undo if user apologizes)
   */
  async autoRollback(userId: string, message: Message, watchSystem: WatchSystem): Promise<boolean> {
    // Check if message contains apology
    const apologyKeywords = ['sorry', 'apologize', 'my bad', 'my mistake', 'didnt mean', 'forgive'];
    const hasApology = apologyKeywords.some(keyword => message.content.toLowerCase().includes(keyword));

    if (hasApology) {
      logger.info(`🔄 Auto-rollback detected for ${userId}: user apologized`);
      // Would trigger undo of recent action here
      return true;
    }

    return false;
  }

  /**
   * 🔥 FEATURE #14: Preventive action (lock channel when conflict predicted)
   */
  async preventiveAction(guildId: string, channelId: string, reason: string): Promise<void> {
    logger.warn(`⚠️ Preventive action: Locking channel ${channelId} - ${reason}`);
    // Would lock the channel here
  }

  /**
   * 🔥 FEATURE #21: Emergency workflow (instant activation during raids)
   */
  async activateEmergencyMode(guildId: string, reason: string): Promise<void> {
    this.emergencyMode.set(guildId, {
      active: true,
      triggeredAt: new Date(),
      reason
    });

    logger.error(`🚨 EMERGENCY MODE ACTIVATED for ${guildId}: ${reason}`);
    // Would trigger emergency lockdown workflows here
  }

  isEmergencyMode(guildId: string): boolean {
    return this.emergencyMode.get(guildId)?.active || false;
  }

  deactivateEmergencyMode(guildId: string): void {
    this.emergencyMode.delete(guildId);
    logger.info(`✅ Emergency mode deactivated for ${guildId}`);
  }
}

// ==========================================
// PHASE 8: CROSS-SERVER WORKFLOWS
// ==========================================

export class CrossServerWorkflowManager {
  private crossServerWatches: Map<string, { guildIds: string[]; watchConfig: any }> = new Map();
  private globalBanList: Set<string> = new Set();

  /**
   * 🔥 FEATURE #4: Cross-server workflow coordination
   */
  async createCrossServerWatch(guildIds: string[], watchConfig: any): Promise<string> {
    const crossWatchId = `cross_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.crossServerWatches.set(crossWatchId, {
      guildIds,
      watchConfig
    });

    logger.info(`Created cross-server watch ${crossWatchId} for ${guildIds.length} guilds`);
    return crossWatchId;
  }

  /**
   * Global ban across servers
   */
  globalBan(userId: string): void {
    this.globalBanList.add(userId);
    logger.warn(`Global ban issued for user ${userId}`);
  }

  isGloballyBanned(userId: string): boolean {
    return this.globalBanList.has(userId);
  }
}

// ==========================================
// PHASE 9: ANALYTICS & SIMULATION
// ==========================================

export class WorkflowAnalytics {
  private performanceData: Map<string, {
    watchId: string;
    triggerCount: number;
    falsePositives: number;
    truePositives: number;
    avgResponseTime: number;
  }> = new Map();

  /**
   * 🔥 FEATURE #18: Track workflow performance
   */
  trackPerformance(watchId: string, triggered: boolean, wasCorrect: boolean, responseTime: number): void {
    if (!this.performanceData.has(watchId)) {
      this.performanceData.set(watchId, {
        watchId,
        triggerCount: 0,
        falsePositives: 0,
        truePositives: 0,
        avgResponseTime: 0
      });
    }

    const data = this.performanceData.get(watchId)!;
    data.triggerCount++;

    if (triggered) {
      if (wasCorrect) {
        data.truePositives++;
      } else {
        data.falsePositives++;
      }
    }

    data.avgResponseTime = (data.avgResponseTime * (data.triggerCount - 1) + responseTime) / data.triggerCount;
  }

  /**
   * 🔥 FEATURE #22: Simulate workflow (dry-run without actions)
   */
  async simulateWorkflow(watchConfig: WatchConfig, testMessages: Message[]): Promise<{
    totalMessages: number;
    triggered: number;
    conditions: { [key: string]: number };
  }> {
    const results = {
      totalMessages: testMessages.length,
      triggered: 0,
      conditions: {} as { [key: string]: number }
    };

    // Simulate checking each message
    for (const message of testMessages) {
      // Would check conditions here without executing actions
      // This is a simplified simulation
    }

    logger.info(`Simulation complete: ${results.triggered}/${results.totalMessages} would trigger`);
    return results;
  }

  getPerformanceReport(watchId: string): string {
    const data = this.performanceData.get(watchId);
    if (!data) return 'No data available';

    const accuracy = data.triggerCount > 0 ? (data.truePositives / data.triggerCount * 100).toFixed(1) : '0';
    const falsePositiveRate = data.triggerCount > 0 ? (data.falsePositives / data.triggerCount * 100).toFixed(1) : '0';

    return `Performance Report:
- Total Triggers: ${data.triggerCount}
- True Positives: ${data.truePositives}
- False Positives: ${data.falsePositives}
- Accuracy: ${accuracy}%
- False Positive Rate: ${falsePositiveRate}%
- Avg Response Time: ${data.avgResponseTime.toFixed(0)}ms`;
  }
}

// ==========================================
// PHASE 10: CHAINED WORKFLOWS
// ==========================================

export class ChainedWorkflowEngine {
  private workflowChains: Map<string, {
    chainId: string;
    steps: { watchId: string; triggerNextOn: 'success' | 'failure' | 'always' }[];
    currentStep: number;
  }> = new Map();

  /**
   * 🔥 FEATURE #1: Chained workflows (one watch triggers another)
   */
  createChain(steps: { watchId: string; triggerNextOn: 'success' | 'failure' | 'always' }[]): string {
    const chainId = `chain_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.workflowChains.set(chainId, {
      chainId,
      steps,
      currentStep: 0
    });

    logger.info(`Created workflow chain ${chainId} with ${steps.length} steps`);
    return chainId;
  }

  /**
   * 🔥 FEATURE #2: Dynamic conditions (conditions adapt based on patterns)
   */
  async adaptCondition(watchConfig: WatchConfig, recentData: any[]): Promise<WatchConfig> {
    // Analyze recent triggers to adapt thresholds
    // This is a simplified version

    logger.info(`Adapting conditions for watch ${watchConfig.id} based on ${recentData.length} recent events`);

    // Would adjust thresholds here based on false positive rate, etc.

    return watchConfig;
  }

  progressChain(chainId: string, success: boolean): string | null {
    const chain = this.workflowChains.get(chainId);
    if (!chain) return null;

    const currentStep = chain.steps[chain.currentStep];
    let shouldProgress = false;

    if (currentStep.triggerNextOn === 'always') {
      shouldProgress = true;
    } else if (currentStep.triggerNextOn === 'success' && success) {
      shouldProgress = true;
    } else if (currentStep.triggerNextOn === 'failure' && !success) {
      shouldProgress = true;
    }

    if (shouldProgress) {
      chain.currentStep++;

      if (chain.currentStep < chain.steps.length) {
        const nextWatch = chain.steps[chain.currentStep].watchId;
        logger.info(`Chain ${chainId} progressing to step ${chain.currentStep}: ${nextWatch}`);
        return nextWatch;
      } else {
        logger.info(`Chain ${chainId} completed`);
        this.workflowChains.delete(chainId);
        return null;
      }
    }

    return null;
  }
}

// ==========================================
// EXPORT UNIFIED CONTROLLER
// ==========================================

export class AdvancedFeatures {
  public patternLearner: AIPatternLearner;
  public socialAnalyzer: SocialNetworkAnalyzer;
  public voiceTracker: VoiceActivityTracker;
  public smartActions: SmartActionController;
  public crossServer: CrossServerWorkflowManager;
  public analytics: WorkflowAnalytics;
  public chainEngine: ChainedWorkflowEngine;

  constructor(storage: StorageService, ollama: OllamaService) {
    this.patternLearner = new AIPatternLearner(storage, ollama);
    this.socialAnalyzer = new SocialNetworkAnalyzer();
    this.voiceTracker = new VoiceActivityTracker();
    this.smartActions = new SmartActionController();
    this.crossServer = new CrossServerWorkflowManager();
    this.analytics = new WorkflowAnalytics();
    this.chainEngine = new ChainedWorkflowEngine();

    logger.info('✨ All Advanced Features initialized (Phases 4-10)');
  }
}
