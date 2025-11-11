/**
 * GUILD POLICY ENGINE
 *
 * Allows guilds to define custom moderation rules and escalation policies.
 * Stored in UnifiedMemoryStore for persistence and easy modification.
 *
 * Example policies:
 * - "3 toxic messages in 10 minutes → 1 hour timeout"
 * - "2 spam messages in 5 minutes → warn, 5 spam → ban"
 * - "FUD detection in trading channel → auto-delete + warn"
 */

import { UnifiedMemoryStore } from '../persistence/UnifiedMemoryStore';
import { createLogger } from '../services/Logger';

const logger = createLogger('GuildPolicyEngine');

// ============================================
// TYPES
// ============================================

export interface PolicyCondition {
  category: 'toxicity' | 'FUD' | 'spam' | 'profanity' | 'scam' | 'nsfw' | 'custom';
  occurrences: number;      // How many times this must happen
  timeWindow: number;       // In what time window (milliseconds)
  channelTypes?: string[];  // Optional: only in specific channel types
  channelIds?: string[];    // Optional: only in specific channels
}

export interface PolicyAction {
  type: 'warn' | 'timeout' | 'kick' | 'ban' | 'delete';
  duration?: number;        // For timeout actions (milliseconds)
  reason: string;           // Reason shown to user
  notifyModerators?: boolean; // Send alert to moderators
}

export interface PolicyEscalation {
  afterOccurrences: number; // After how many violations to escalate
  action: PolicyAction;     // What action to take
}

export interface GuildPolicy {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  condition: PolicyCondition;
  initialAction: PolicyAction;
  escalations?: PolicyEscalation[];  // Optional escalation ladder
  createdBy: string;
  createdByName: string;
  createdAt: number;
  modifiedAt: number;
}

export interface PolicyViolation {
  userId: string;
  username: string;
  policyId: string;
  category: string;
  timestamp: number;
  messageId?: string;
  channelId: string;
}

// ============================================
// GUILD POLICY ENGINE
// ============================================

export class GuildPolicyEngine {
  constructor(private unifiedMemory: UnifiedMemoryStore) {}

  /**
   * Create a new guild policy
   */
  async createPolicy(guildId: string, policy: Omit<GuildPolicy, 'id' | 'createdAt' | 'modifiedAt'>): Promise<string> {
    const policyId = await this.unifiedMemory.store({
      type: 'guild_policy',
      guildId,
      data: {
        ...policy,
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      },
      metadata: {
        tags: [policy.condition.category, policy.enabled ? 'enabled' : 'disabled'],
      },
      relations: {
        relatedTo: [],
      },
    });

    logger.info(`Created policy "${policy.name}" for guild ${guildId} (${policyId})`);
    return policyId;
  }

  /**
   * Get all policies for a guild
   */
  async getPolicies(guildId: string, onlyEnabled: boolean = false): Promise<Array<{ id: string; data: GuildPolicy }>> {
    const policies = await this.unifiedMemory.query({
      type: 'guild_policy',
      guildId,
      limit: 100,
    });

    if (onlyEnabled) {
      return policies.filter(p => (p.data as GuildPolicy).enabled);
    }

    return policies as Array<{ id: string; data: GuildPolicy }>;
  }

  /**
   * Get a specific policy by ID
   */
  async getPolicy(policyId: string): Promise<{ id: string; data: GuildPolicy } | null> {
    const policy = await this.unifiedMemory.get(policyId);
    if (!policy) return null;

    return { id: policy.id, data: policy.data as GuildPolicy };
  }

  /**
   * Update an existing policy
   */
  async updatePolicy(
    policyId: string,
    updates: Partial<Omit<GuildPolicy, 'id' | 'createdAt' | 'createdBy' | 'createdByName'>>
  ): Promise<boolean> {
    try {
      const existing = await this.unifiedMemory.get(policyId);
      if (!existing) return false;

      await this.unifiedMemory.update(policyId, {
        data: {
          ...existing.data,
          ...updates,
          modifiedAt: Date.now(),
        },
        metadata: updates.condition || updates.enabled !== undefined
          ? {
              ...existing.metadata!,
              tags: updates.condition
                ? [updates.condition.category, (updates.enabled ?? (existing.data as GuildPolicy).enabled) ? 'enabled' : 'disabled']
                : [(existing.data as GuildPolicy).condition.category, (updates.enabled ?? (existing.data as GuildPolicy).enabled) ? 'enabled' : 'disabled'],
            }
          : undefined,
      });

      logger.info(`Updated policy ${policyId}`);
      return true;
    } catch (error) {
      logger.error('Failed to update policy:', error);
      return false;
    }
  }

  /**
   * Delete a policy
   */
  async deletePolicy(policyId: string): Promise<boolean> {
    // Note: UnifiedMemoryStore doesn't have a delete method, so we'll disable instead
    return await this.updatePolicy(policyId, { enabled: false });
  }

  /**
   * Record a policy violation
   */
  async recordViolation(guildId: string, violation: PolicyViolation): Promise<string> {
    const violationId = await this.unifiedMemory.store({
      type: 'policy_violation',
      guildId,
      data: violation,
      metadata: {
        tags: [violation.userId, violation.policyId, violation.category],
      },
      relations: {
        relatedTo: [violation.policyId],
      },
    });

    logger.info(`Recorded policy violation: ${violation.category} by ${violation.username} (${violationId})`);
    return violationId;
  }

  /**
   * Get recent violations for a user
   */
  async getUserViolations(
    guildId: string,
    userId: string,
    category?: string,
    since?: number
  ): Promise<Array<{ id: string; data: PolicyViolation }>> {
    const violations = await this.unifiedMemory.query({
      type: 'policy_violation',
      guildId,
      tags: [userId],
      since,
      limit: 100,
    });

    let filtered = violations as Array<{ id: string; data: PolicyViolation }>;

    // Filter by category if specified
    if (category) {
      filtered = filtered.filter(v => (v.data as PolicyViolation).category === category);
    }

    return filtered;
  }

  /**
   * Check if a user's behavior triggers any policies
   * Returns the action to take, or null if no policy is triggered
   */
  async checkPolicies(
    guildId: string,
    userId: string,
    username: string,
    category: string,
    channelId: string,
    messageId?: string
  ): Promise<{
    policy: GuildPolicy;
    action: PolicyAction;
    violationCount: number;
  } | null> {
    // Get all enabled policies for this category
    const allPolicies = await this.getPolicies(guildId, true);
    const relevantPolicies = allPolicies.filter(p => {
      const policy = p.data as GuildPolicy;
      if (policy.condition.category !== category) return false;

      // Check channel restrictions
      if (policy.condition.channelIds && !policy.condition.channelIds.includes(channelId)) {
        return false;
      }

      return true;
    });

    if (relevantPolicies.length === 0) return null;

    // For each policy, check if user has violated it
    for (const policyEntry of relevantPolicies) {
      const policy = policyEntry.data as GuildPolicy;
      const timeWindow = policy.condition.timeWindow;
      const requiredOccurrences = policy.condition.occurrences;

      // Get recent violations within time window
      const since = Date.now() - timeWindow;
      const recentViolations = await this.getUserViolations(guildId, userId, category, since);

      // Count violations for this specific policy
      const policyViolations = recentViolations.filter(
        v => (v.data as PolicyViolation).policyId === policyEntry.id
      );

      const violationCount = policyViolations.length + 1; // +1 for current violation

      // Check if threshold is met
      if (violationCount >= requiredOccurrences) {
        // Determine which action to take based on escalation ladder
        let action = policy.initialAction;

        if (policy.escalations) {
          for (const escalation of policy.escalations.sort((a, b) => b.afterOccurrences - a.afterOccurrences)) {
            if (violationCount >= escalation.afterOccurrences) {
              action = escalation.action;
              break;
            }
          }
        }

        // Record this violation
        await this.recordViolation(guildId, {
          userId,
          username,
          policyId: policyEntry.id,
          category,
          timestamp: Date.now(),
          messageId,
          channelId,
        });

        logger.info(
          `Policy "${policy.name}" triggered for ${username}: ${violationCount} violations → ${action.type}`
        );

        return {
          policy,
          action,
          violationCount,
        };
      }
    }

    return null;
  }

  /**
   * Create default policies for a new guild
   */
  async createDefaultPolicies(guildId: string, createdBy: string, createdByName: string): Promise<string[]> {
    const defaultPolicies: Array<Omit<GuildPolicy, 'id' | 'createdAt' | 'modifiedAt'>> = [
      {
        name: 'Anti-Toxicity',
        description: 'Automatically moderate toxic behavior with escalating consequences',
        enabled: true,
        condition: {
          category: 'toxicity',
          occurrences: 3,
          timeWindow: 10 * 60 * 1000, // 10 minutes
        },
        initialAction: {
          type: 'warn',
          reason: 'Repeated toxic behavior detected. Please be respectful.',
          notifyModerators: false,
        },
        escalations: [
          {
            afterOccurrences: 5,
            action: {
              type: 'timeout',
              duration: 1 * 60 * 60 * 1000, // 1 hour
              reason: 'Continued toxic behavior. Timeout for 1 hour.',
              notifyModerators: true,
            },
          },
          {
            afterOccurrences: 10,
            action: {
              type: 'ban',
              reason: 'Persistent toxic behavior. Banned from server.',
              notifyModerators: true,
            },
          },
        ],
        createdBy,
        createdByName,
      },
      {
        name: 'Anti-Spam',
        description: 'Prevent spam with immediate action',
        enabled: true,
        condition: {
          category: 'spam',
          occurrences: 2,
          timeWindow: 5 * 60 * 1000, // 5 minutes
        },
        initialAction: {
          type: 'delete',
          reason: 'Spam detected. Message deleted.',
          notifyModerators: false,
        },
        escalations: [
          {
            afterOccurrences: 5,
            action: {
              type: 'timeout',
              duration: 30 * 60 * 1000, // 30 minutes
              reason: 'Repeated spamming. Timeout for 30 minutes.',
              notifyModerators: true,
            },
          },
        ],
        createdBy,
        createdByName,
      },
      {
        name: 'Anti-Scam',
        description: 'Immediately ban scammers and notify moderators',
        enabled: true,
        condition: {
          category: 'scam',
          occurrences: 1,
          timeWindow: 24 * 60 * 60 * 1000, // 24 hours
        },
        initialAction: {
          type: 'ban',
          reason: 'Scam attempt detected. Immediate ban.',
          notifyModerators: true,
        },
        createdBy,
        createdByName,
      },
    ];

    const createdIds: string[] = [];
    for (const policy of defaultPolicies) {
      const id = await this.createPolicy(guildId, policy);
      createdIds.push(id);
    }

    logger.info(`Created ${createdIds.length} default policies for guild ${guildId}`);
    return createdIds;
  }

  /**
   * Get statistics
   */
  async getStats(guildId?: string) {
    const policiesQuery = guildId
      ? await this.unifiedMemory.query({ type: 'guild_policy', guildId, limit: 1000 })
      : await this.unifiedMemory.query({ type: 'guild_policy', limit: 1000 });

    const violationsQuery = guildId
      ? await this.unifiedMemory.query({ type: 'policy_violation', guildId, limit: 1000 })
      : await this.unifiedMemory.query({ type: 'policy_violation', limit: 1000 });

    const enabledPolicies = policiesQuery.filter(p => (p.data as GuildPolicy).enabled);

    return {
      totalPolicies: policiesQuery.length,
      enabledPolicies: enabledPolicies.length,
      totalViolations: violationsQuery.length,
    };
  }
}
