import { BDLBehavior } from '../services/BehaviorParser';

/**
 * BehaviorTemplates
 *
 * Pre-built behavior templates for common use cases.
 * Moderators can use these as starting points or copy them directly.
 */

export interface BehaviorTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  requiredPlaceholders: string[];
  templateBDL: Omit<BDLBehavior, 'id' | 'enabled'>;
}

export class BehaviorTemplates {
  private static templates: BehaviorTemplate[] = [
    // ==================== ONBOARDING ====================
    {
      id: 'welcome-dm',
      name: 'Welcome DM',
      description: 'Send a friendly welcome message to new members',
      category: 'onboarding',
      tags: ['welcome', 'dm', 'beginner'],
      difficulty: 'beginner',
      requiredPlaceholders: [],
      templateBDL: {
        name: 'Welcome DM',
        description: 'Send welcome message to new members',
        // @ts-ignore - enabled field is added at runtime
        enabled: true,
        trigger: {
          type: 'event',
          event: 'guildMemberAdd'
        },
        actions: [
          {
            type: 'sendDM',
            target: '${triggeredUserId}',
            message: 'Welcome to the server! We\'re glad to have you here. Please read the rules and introduce yourself!'
          }
        ],
        safety: {
          maxExecutionsPerHour: 100
        }
      }
    },

    {
      id: 'welcome-channel-message',
      name: 'Welcome Channel Message',
      description: 'Post a welcome message in a channel when someone joins',
      category: 'onboarding',
      tags: ['welcome', 'channel', 'beginner'],
      difficulty: 'beginner',
      requiredPlaceholders: ['WELCOME_CHANNEL_ID'],
      templateBDL: {
        name: 'Welcome Channel Message',
        description: 'Post welcome message in channel',
        // @ts-ignore - enabled field is added at runtime
        enabled: true,
        trigger: {
          type: 'event',
          event: 'guildMemberAdd'
        },
        actions: [
          {
            type: 'sendMessage',
            channelId: 'WELCOME_CHANNEL_ID',
            message: 'Welcome ${user.username} to the server! 🎉',
            embed: {
              title: 'New Member!',
              description: '${user.username} just joined!',
              color: '#00FF00'
            }
          }
        ],
        safety: {
          maxExecutionsPerHour: 100
        }
      }
    },

    // ==================== SECURITY ====================
    {
      id: 'bot-verification-math',
      name: 'Math Question Verification',
      description: 'Ask new users a math question to verify they are human',
      category: 'security',
      tags: ['verification', 'bot', 'security', 'intermediate'],
      difficulty: 'intermediate',
      requiredPlaceholders: ['VERIFIED_ROLE_ID'],
      templateBDL: {
        name: 'Math Question Verification',
        description: 'Verify new users with math question',
        // @ts-ignore - enabled field is added at runtime
        enabled: true,
        trigger: {
          type: 'event',
          event: 'guildMemberAdd'
        },
        actions: [
          {
            type: 'askQuestion',
            target: '${triggeredUserId}',
            question: 'Welcome! To verify you\'re human, please solve: 7 + 5 = ?',
            expectedAnswer: '12',
            timeout: '60s',
            onCorrect: {
              type: 'addRole',
              roleId: 'VERIFIED_ROLE_ID'
            },
            onIncorrect: {
              type: 'kick',
              reason: 'Failed verification'
            },
            onTimeout: {
              type: 'kick',
              reason: 'Verification timeout'
            }
          }
        ],
        safety: {
          maxExecutionsPerHour: 50
        }
      }
    },

    {
      id: 'new-user-link-monitor',
      name: 'New User Link Monitor',
      description: 'Track new users\' first messages and detect spam links',
      category: 'security',
      tags: ['spam', 'links', 'monitoring', 'advanced'],
      difficulty: 'advanced',
      requiredPlaceholders: [],
      templateBDL: {
        name: 'New User Link Monitor',
        description: 'Monitor new users for spam links',
        // @ts-ignore - enabled field is added at runtime
        enabled: true,
        trigger: {
          type: 'event',
          event: 'guildMemberAdd'
        },
        tracking: {
          enabled: true,
          targetType: 'user',
          targetId: '${triggeredUserId}',
          duration: '24h',
          collect: {
            messages: 10,
            customData: {
              linkCount: '${count(messages.links)}',
              avgLength: '${avg(messages.length)}'
            }
          },
          stopConditions: ['messageCount >= 10']
        },
        analysis: {
          type: 'threshold',
          metrics: {
            linkCount: { max: 3 }
          }
        },
        actions: [
          {
            type: 'sendDM',
            target: '${triggeredUserId}',
            message: 'Please introduce yourself before sharing links!',
            condition: 'linkCount > 2'
          },
          {
            type: 'timeout',
            target: '${triggeredUserId}',
            duration: '1h',
            reason: 'Too many links from new user',
            condition: 'linkCount > 5'
          }
        ],
        safety: {
          maxExecutionsPerHour: 100
        }
      }
    },

    // ==================== REWARDS ====================
    {
      id: 'auto-role-activity',
      name: 'Active Member Auto-Role',
      description: 'Automatically give role after user reaches message threshold',
      category: 'rewards',
      tags: ['role', 'activity', 'rewards', 'beginner'],
      difficulty: 'beginner',
      requiredPlaceholders: ['ACTIVE_ROLE_ID', 'MESSAGE_THRESHOLD'],
      templateBDL: {
        name: 'Active Member Auto-Role',
        description: 'Give role to active users',
        // @ts-ignore - enabled field is added at runtime
        enabled: true,
        trigger: {
          type: 'event',
          event: 'messageCreate'
        },
        analysis: {
          type: 'threshold',
          metrics: {
            userTotalMessages: { min: 50 }
          }
        },
        actions: [
          {
            type: 'addRole',
            target: '${triggeredUserId}',
            roleId: 'ACTIVE_ROLE_ID',
            condition: 'userTotalMessages >= MESSAGE_THRESHOLD'
          },
          {
            type: 'sendMessage',
            channelId: '${triggeredChannelId}',
            message: 'Congratulations ${user.username}! You\'ve earned the Active Member role! 🎉',
            condition: 'userTotalMessages >= MESSAGE_THRESHOLD'
          }
        ],
        safety: {
          maxExecutionsPerUser: 1
        }
      }
    },

    // ==================== MODERATION ====================
    {
      id: 'caps-spam-warning',
      name: 'Caps Lock Spam Warning',
      description: 'Warn users who type in excessive caps',
      category: 'moderation',
      tags: ['spam', 'caps', 'warning', 'intermediate'],
      difficulty: 'intermediate',
      requiredPlaceholders: [],
      templateBDL: {
        name: 'Caps Lock Spam Warning',
        description: 'Warn users for excessive caps',
        // @ts-ignore - enabled field is added at runtime
        enabled: true,
        trigger: {
          type: 'event',
          event: 'messageCreate',
          filters: {
            contentMatches: '[A-Z]{20,}'
          }
        },
        actions: [
          {
            type: 'sendMessage',
            channelId: '${triggeredChannelId}',
            message: '${user.username}, please don\'t use excessive caps lock.'
          },
          {
            type: 'log',
            level: 'info',
            message: 'Warned user for caps spam: ${user.username}'
          }
        ],
        safety: {
          maxExecutionsPerUser: 3,
          maxExecutionsPerHour: 20
        }
      }
    },

    {
      id: 'link-spam-detector',
      name: 'Link Spam Detector',
      description: 'Detect and timeout users posting too many links',
      category: 'moderation',
      tags: ['spam', 'links', 'timeout', 'intermediate'],
      difficulty: 'intermediate',
      requiredPlaceholders: [],
      templateBDL: {
        name: 'Link Spam Detector',
        description: 'Prevent link spam',
        // @ts-ignore - enabled field is added at runtime
        enabled: true,
        trigger: {
          type: 'pattern',
          pattern: '3 links in 10 seconds',
          scope: 'user'
        },
        actions: [
          {
            type: 'timeout',
            target: '${triggeredUserId}',
            duration: '5m',
            reason: 'Link spam detected'
          },
          {
            type: 'log',
            level: 'warn',
            message: 'Timed out ${user.username} for link spam'
          }
        ],
        safety: {
          maxExecutionsPerUser: 1,
          maxExecutionsPerHour: 10
        }
      }
    },

    // ==================== REPORTS ====================
    {
      id: 'daily-summary',
      name: 'Daily Activity Summary',
      description: 'Send daily server activity report to mod channel',
      category: 'reports',
      tags: ['report', 'daily', 'statistics', 'advanced'],
      difficulty: 'advanced',
      requiredPlaceholders: ['MOD_CHANNEL_ID'],
      templateBDL: {
        name: 'Daily Activity Summary',
        description: 'Daily server statistics',
        // @ts-ignore - enabled field is added at runtime
        enabled: true,
        trigger: {
          type: 'schedule',
          cron: '0 9 * * *',
          timezone: 'UTC'
        },
        tracking: {
          enabled: true,
          targetType: 'server',
          targetId: '${serverId}',
          duration: '24h',
          collect: {
            messages: 10000,
            customData: {
              newUsers: '${count(joins)}',
              totalMessages: '${count(messages)}',
              topChannel: '${mostActive(channels)}'
            }
          }
        },
        actions: [
          {
            type: 'sendMessage',
            channelId: 'MOD_CHANNEL_ID',
            embed: {
              title: '📊 Daily Server Report',
              description: 'Activity summary for the last 24 hours',
              color: '#0099FF',
              fields: [
                { name: 'New Members', value: '${tracking.newUsers}' },
                { name: 'Total Messages', value: '${tracking.totalMessages}' },
                { name: 'Most Active Channel', value: '${tracking.topChannel}' }
              ],
              footer: 'Generated by BECAS'
            }
          }
        ],
        safety: {
          maxExecutionsPerHour: 1
        }
      }
    },

    // ==================== ENGAGEMENT ====================
    {
      id: 'reaction-role',
      name: 'Reaction Role Assignment',
      description: 'Give roles when users react to a message',
      category: 'engagement',
      tags: ['reaction', 'role', 'interactive', 'intermediate'],
      difficulty: 'intermediate',
      requiredPlaceholders: ['MESSAGE_ID', 'REACTION_EMOJI', 'ROLE_ID'],
      templateBDL: {
        name: 'Reaction Role',
        description: 'Give role on reaction',
        // @ts-ignore - enabled field is added at runtime
        enabled: true,
        trigger: {
          type: 'event',
          event: 'messageReactionAdd',
          filters: {
            messageId: 'MESSAGE_ID'
          }
        },
        actions: [
          {
            type: 'addRole',
            target: '${triggeredUserId}',
            roleId: 'ROLE_ID'
          }
        ],
        safety: {
          maxExecutionsPerUser: 1
        }
      }
    }
  ];

  /**
   * Get all templates
   */
  static getAll(): BehaviorTemplate[] {
    return this.templates;
  }

  /**
   * Get templates by category
   */
  static getByCategory(category: string): BehaviorTemplate[] {
    return this.templates.filter(t => t.category === category);
  }

  /**
   * Get template by ID
   */
  static getById(id: string): BehaviorTemplate | undefined {
    return this.templates.find(t => t.id === id);
  }

  /**
   * Get templates by difficulty
   */
  static getByDifficulty(difficulty: 'beginner' | 'intermediate' | 'advanced'): BehaviorTemplate[] {
    return this.templates.filter(t => t.difficulty === difficulty);
  }

  /**
   * Search templates by tag
   */
  static searchByTag(tag: string): BehaviorTemplate[] {
    return this.templates.filter(t => t.tags.includes(tag));
  }

  /**
   * Get all categories
   */
  static getCategories(): string[] {
    return [...new Set(this.templates.map(t => t.category))];
  }

  /**
   * Get all tags
   */
  static getAllTags(): string[] {
    const allTags = this.templates.flatMap(t => t.tags);
    return [...new Set(allTags)];
  }

  /**
   * Instantiate template with placeholders
   */
  static instantiate(templateId: string, placeholders: Record<string, string>): BDLBehavior {
    const template = this.getById(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Clone template BDL
    let bdlString = JSON.stringify(template.templateBDL);

    // Replace placeholders
    for (const [key, value] of Object.entries(placeholders)) {
      bdlString = bdlString.replace(new RegExp(key, 'g'), value);
    }

    const bdl = JSON.parse(bdlString) as BDLBehavior;
    bdl.enabled = true;

    return bdl;
  }
}

/**
 * Example usage:
 *
 * // Get all templates
 * const templates = BehaviorTemplates.getAll();
 *
 * // Get templates by category
 * const securityTemplates = BehaviorTemplates.getByCategory('security');
 *
 * // Get beginner templates
 * const beginnerTemplates = BehaviorTemplates.getByDifficulty('beginner');
 *
 * // Instantiate template
 * const bdl = BehaviorTemplates.instantiate('welcome-dm', {});
 *
 * // Instantiate with placeholders
 * const verificationBDL = BehaviorTemplates.instantiate('bot-verification-math', {
 *   VERIFIED_ROLE_ID: '123456789'
 * });
 */
