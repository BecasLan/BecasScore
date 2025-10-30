import { Message, GuildMember } from 'discord.js';
import { createLogger } from '../services/Logger';

const logger = createLogger('ReflexEngine');

/**
 * REFLEX ENGINE - Instant responses without LLM calls
 *
 * Inspired by Daniel Kahneman's "System 1" thinking:
 * - Fast, automatic, unconscious
 * - Pattern-based recognition
 * - <100ms response time
 * - No reasoning, just reflex
 *
 * Handles:
 * 1. Known scammers (O(1) hash lookup)
 * 2. Raid patterns (rate-based detection)
 * 3. Crisis keywords (regex matching)
 * 4. Extreme toxicity (fast local model)
 * 5. Spam patterns (heuristic-based)
 */

export interface ReflexResponse {
  type: 'INSTANT_BAN' | 'LOCKDOWN' | 'CRISIS_SUPPORT' | 'DELETE_AND_TIMEOUT' | 'SPAM_DELETE' | 'NONE';
  reason: string;
  confidence: number;
  executionTime: number; // in milliseconds
  action?: {
    delete?: boolean;
    timeout?: number; // milliseconds
    ban?: boolean;
    notify?: string; // message to send
    alertMods?: boolean;
  };
}

export interface ReflexConfig {
  enabledReflexes: {
    knownScammers: boolean;
    raidDetection: boolean;
    crisisKeywords: boolean;
    extremeToxicity: boolean;
    spamPatterns: boolean;
  };
  thresholds: {
    extremeToxicity: number; // 0-1
    raidMessagesPerSecond: number;
    spamRepetitionThreshold: number;
  };
}

export const DEFAULT_REFLEX_CONFIG: ReflexConfig = {
  enabledReflexes: {
    knownScammers: true,
    raidDetection: true,
    crisisKeywords: true,
    extremeToxicity: true,
    spamPatterns: true,
  },
  thresholds: {
    extremeToxicity: 0.95,
    raidMessagesPerSecond: 5,
    spamRepetitionThreshold: 3,
  },
};

export class ReflexEngine {
  private config: ReflexConfig;

  // Known bad actors (hash table for O(1) lookup)
  private knownScammers: Set<string> = new Set();
  private globalBanList: Set<string> = new Set();

  // Raid detection state
  private recentMessages: Map<string, { count: number; timestamps: number[] }> = new Map();

  // Spam detection state
  private recentContent: Map<string, string[]> = new Map(); // userId -> recent messages

  // Crisis keywords (compiled regex for speed)
  private crisisRegex: RegExp;

  // Extreme toxicity patterns (simple heuristics, no LLM)
  private toxicPatterns: RegExp[];

  constructor(config: Partial<ReflexConfig> = {}) {
    this.config = { ...DEFAULT_REFLEX_CONFIG, ...config };

    // Compile crisis keywords regex
    this.crisisRegex = this.compileCrisisKeywords();

    // Compile toxicity patterns
    this.toxicPatterns = this.compileToxicityPatterns();

    logger.info('ReflexEngine initialized with config:', this.config);
  }

  /**
   * Main reflex check - runs in <100ms
   */
  async checkReflexes(message: Message): Promise<ReflexResponse> {
    const startTime = performance.now();

    // 🛡️ SAFETY CHECK: Never ban moderators/admins accidentally!
    const member = message.member;
    if (member) {
      const isModerator = member.permissions.has('Administrator') ||
                         member.permissions.has('ManageMessages') ||
                         member.permissions.has('BanMembers') ||
                         member.permissions.has('KickMembers');

      if (isModerator) {
        logger.info(`🛡️  Skipping reflex for moderator: ${message.author.username}`);
        return {
          type: 'NONE',
          reason: 'Moderator immunity',
          confidence: 0,
          executionTime: performance.now() - startTime,
        };
      }
    }

    // Run all reflex checks in priority order (fastest first)

    // 1. Known scammer check (O(1) - fastest)
    if (this.config.enabledReflexes.knownScammers) {
      const scammerCheck = this.checkKnownScammer(message);
      if (scammerCheck.type !== 'NONE') {
        scammerCheck.executionTime = performance.now() - startTime;
        logger.warn(`Reflex triggered: ${scammerCheck.type} in ${scammerCheck.executionTime.toFixed(2)}ms`);
        return scammerCheck;
      }
    }

    // 2. Crisis keywords check (regex - fast)
    if (this.config.enabledReflexes.crisisKeywords) {
      const crisisCheck = this.checkCrisisKeywords(message);
      if (crisisCheck.type !== 'NONE') {
        crisisCheck.executionTime = performance.now() - startTime;
        logger.warn(`Reflex triggered: ${crisisCheck.type} in ${crisisCheck.executionTime.toFixed(2)}ms`);
        return crisisCheck;
      }
    }

    // 3. Raid detection check (rate-based - fast)
    if (this.config.enabledReflexes.raidDetection) {
      const raidCheck = this.checkRaidPattern(message);
      if (raidCheck.type !== 'NONE') {
        raidCheck.executionTime = performance.now() - startTime;
        logger.warn(`Reflex triggered: ${raidCheck.type} in ${raidCheck.executionTime.toFixed(2)}ms`);
        return raidCheck;
      }
    }

    // 4. Spam pattern check (heuristic-based)
    if (this.config.enabledReflexes.spamPatterns) {
      const spamCheck = this.checkSpamPattern(message);
      if (spamCheck.type !== 'NONE') {
        spamCheck.executionTime = performance.now() - startTime;
        logger.warn(`Reflex triggered: ${spamCheck.type} in ${spamCheck.executionTime.toFixed(2)}ms`);
        return spamCheck;
      }
    }

    // 5. Extreme toxicity check (pattern-based, no LLM)
    if (this.config.enabledReflexes.extremeToxicity) {
      const toxicityCheck = this.checkExtremeToxicity(message);
      if (toxicityCheck.type !== 'NONE') {
        toxicityCheck.executionTime = performance.now() - startTime;
        logger.warn(`Reflex triggered: ${toxicityCheck.type} in ${toxicityCheck.executionTime.toFixed(2)}ms`);
        return toxicityCheck;
      }
    }

    // No reflex triggered
    const executionTime = performance.now() - startTime;
    logger.debug(`No reflex triggered (${executionTime.toFixed(2)}ms)`);

    return {
      type: 'NONE',
      reason: 'No reflex conditions met',
      confidence: 0,
      executionTime,
    };
  }

  /**
   * Check if user is a known scammer (O(1) lookup)
   */
  private checkKnownScammer(message: Message): ReflexResponse {
    const userId = message.author.id;

    if (this.knownScammers.has(userId) || this.globalBanList.has(userId)) {
      return {
        type: 'INSTANT_BAN',
        reason: 'User is on global scammer database',
        confidence: 1.0,
        executionTime: 0,
        action: {
          delete: true,
          ban: true,
          alertMods: true,
        },
      };
    }

    return { type: 'NONE', reason: '', confidence: 0, executionTime: 0 };
  }

  /**
   * Check for crisis keywords (suicide, self-harm)
   */
  private checkCrisisKeywords(message: Message): ReflexResponse {
    const content = message.content.toLowerCase();

    if (this.crisisRegex.test(content)) {
      return {
        type: 'CRISIS_SUPPORT',
        reason: 'Self-harm or suicide keywords detected',
        confidence: 0.90,
        executionTime: 0,
        action: {
          notify: '🆘 I\'m concerned about what you said. Please reach out to someone:\n\n' +
                  '**National Suicide Prevention Lifeline (US)**: 988\n' +
                  '**Crisis Text Line**: Text HOME to 741741\n' +
                  '**International**: https://findahelpline.com\n\n' +
                  'You matter, and there are people who want to help.',
          alertMods: true,
        },
      };
    }

    return { type: 'NONE', reason: '', confidence: 0, executionTime: 0 };
  }

  /**
   * Check for raid patterns (multiple users joining and spamming)
   */
  private checkRaidPattern(message: Message): ReflexResponse {
    if (!message.guildId) return { type: 'NONE', reason: '', confidence: 0, executionTime: 0 };

    const guildId = message.guildId;
    const now = Date.now();

    // Track recent messages
    let guildData = this.recentMessages.get(guildId);
    if (!guildData) {
      guildData = { count: 0, timestamps: [] };
      this.recentMessages.set(guildId, guildData);
    }

    // Add current message
    guildData.timestamps.push(now);
    guildData.count++;

    // Remove messages older than 1 second
    guildData.timestamps = guildData.timestamps.filter(ts => now - ts < 1000);
    guildData.count = guildData.timestamps.length;

    // Check if rate exceeds threshold
    const messagesPerSecond = guildData.count;
    if (messagesPerSecond > this.config.thresholds.raidMessagesPerSecond) {
      return {
        type: 'LOCKDOWN',
        reason: `Raid detected: ${messagesPerSecond} messages/second`,
        confidence: 0.95,
        executionTime: 0,
        action: {
          alertMods: true,
          notify: '🚨 **RAID DETECTED** - Abnormal message rate. Moderators have been alerted.',
        },
      };
    }

    return { type: 'NONE', reason: '', confidence: 0, executionTime: 0 };
  }

  /**
   * Check for spam patterns (repetitive messages) AND SCAM LINKS
   */
  private checkSpamPattern(message: Message): ReflexResponse {
    const userId = message.author.id;
    const content = message.content.toLowerCase().trim();

    // 🔥 PRIORITY CHECK: SCAM LINKS (Discord Nitro scams, phishing, etc.)
    const scamPatterns = [
      /discord.*nitro.*free/i,
      /free.*nitro/i,
      /nitro.*gift/i,
      /(discord|steam).*-?(nitro|gift|free)\.(com|net|org|xyz|tk|ml|ga|cf|gq)/i,
      /dis+co+rd+.*\.(gift|link|promo)/i,
      /@everyone.*free/i,
      /@everyone.*nitro/i,
      /@everyone.*giveaway/i,
      /\b(bit\.ly|tinyurl|t\.co|goo\.gl|ow\.ly|short\.link)\/[a-zA-Z0-9]+/i, // Suspicious shortened URLs
    ];

    for (const pattern of scamPatterns) {
      if (pattern.test(content)) {
        logger.warn(`🚨 SCAM LINK DETECTED: "${content.substring(0, 100)}..." from user ${userId}`);
        return {
          type: 'INSTANT_BAN',
          reason: `Scam/phishing link detected: ${pattern.source.substring(0, 50)}`,
          confidence: 0.99,
          executionTime: 0,
          action: {
            delete: true,
            ban: true,
            alertMods: true,
            notify: '🚨 **SCAM DETECTED** - User has been banned for posting phishing/scam links.',
          },
        };
      }
    }

    // Get recent messages from this user
    let userMessages = this.recentContent.get(userId);
    if (!userMessages) {
      userMessages = [];
      this.recentContent.set(userId, userMessages);
    }

    // Add current message
    userMessages.push(content);

    // Keep only last 10 messages
    if (userMessages.length > 10) {
      userMessages.shift();
    }

    // Check for repetition
    const identicalCount = userMessages.filter(msg => msg === content).length;

    if (identicalCount >= this.config.thresholds.spamRepetitionThreshold) {
      return {
        type: 'SPAM_DELETE',
        reason: `Spam detected: ${identicalCount} identical messages`,
        confidence: 0.85,
        executionTime: 0,
        action: {
          delete: true,
          timeout: 300000, // 5 minutes
          notify: '⚠️ Spam detected. Please don\'t repeat the same message.',
        },
      };
    }

    return { type: 'NONE', reason: '', confidence: 0, executionTime: 0 };
  }

  /**
   * Check for extreme toxicity (pattern-based, no LLM)
   */
  private checkExtremeToxicity(message: Message): ReflexResponse {
    const content = message.content.toLowerCase();

    // Check against pre-compiled patterns
    for (const pattern of this.toxicPatterns) {
      if (pattern.test(content)) {
        return {
          type: 'DELETE_AND_TIMEOUT',
          reason: 'Extreme toxic language detected',
          confidence: 0.95,
          executionTime: 0,
          action: {
            delete: true,
            timeout: 600000, // 10 minutes
            notify: '⚠️ Your message was removed for extreme toxicity. You\'ve been timed out for 10 minutes.',
            alertMods: false,
          },
        };
      }
    }

    return { type: 'NONE', reason: '', confidence: 0, executionTime: 0 };
  }

  /**
   * Add user to known scammer list
   */
  addKnownScammer(userId: string): void {
    this.knownScammers.add(userId);
    logger.info(`Added ${userId} to known scammer list`);
  }

  /**
   * Remove user from known scammer list
   */
  removeKnownScammer(userId: string): void {
    this.knownScammers.delete(userId);
    logger.info(`Removed ${userId} from known scammer list`);
  }

  /**
   * Add user to global ban list
   */
  addToGlobalBanList(userId: string): void {
    this.globalBanList.add(userId);
    logger.info(`Added ${userId} to global ban list`);
  }

  /**
   * Compile crisis keywords into optimized regex
   */
  private compileCrisisKeywords(): RegExp {
    const keywords = [
      // Suicide
      'kill myself',
      'end my life',
      'want to die',
      'better off dead',
      'suicide',
      'suicidal',

      // Self-harm
      'cut myself',
      'hurt myself',
      'self harm',

      // Despair
      'no reason to live',
      'can\'t go on',
      'nobody cares',
    ];

    const pattern = keywords.map(k => k.replace(/\s+/g, '\\s+')).join('|');
    return new RegExp(`\\b(${pattern})\\b`, 'i');
  }

  /**
   * Compile toxicity patterns
   */
  private compileToxicityPatterns(): RegExp[] {
    return [
      // Extreme slurs (we don't tolerate this at all)
      /\b(n+i+g+g+e+r|n+i+g+g+a|f+a+g+g+o+t|r+e+t+a+r+d|c+u+n+t)\b/i,

      // Violent threats
      /\b(kill you|murder you|i hope you die|kys|kill yourself)\b/i,

      // Extreme hate speech
      /\b(gas the|lynch the|hang the).+?(jews|blacks|gays|muslims|women)/i,
    ];
  }

  /**
   * Get statistics
   */
  getStats(): {
    knownScammers: number;
    globalBanList: number;
    trackedGuilds: number;
    trackedUsers: number;
  } {
    return {
      knownScammers: this.knownScammers.size,
      globalBanList: this.globalBanList.size,
      trackedGuilds: this.recentMessages.size,
      trackedUsers: this.recentContent.size,
    };
  }

  /**
   * Cleanup old data
   */
  cleanup(): void {
    const now = Date.now();

    // Clean raid detection data older than 5 seconds
    for (const [guildId, data] of this.recentMessages.entries()) {
      data.timestamps = data.timestamps.filter(ts => now - ts < 5000);
      data.count = data.timestamps.length;

      if (data.count === 0) {
        this.recentMessages.delete(guildId);
      }
    }

    // Clean spam detection data (keep only if user active in last 5 minutes)
    // This is handled per-message, so no cleanup needed here

    logger.debug(`Reflex cleanup complete`);
  }
}
