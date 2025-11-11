/**
 * FEATURE REGISTRY - AI-Readable Documentation
 *
 * This registry tells the AI what BECAS can do.
 * When users issue commands, the AI consults this registry
 * to understand available features and how to use them.
 */

export interface Feature {
  name: string;
  category: 'moderation' | 'analytics' | 'trust' | 'scam' | 'conversation' | 'system';
  description: string;
  examples: string[];
  requiredPermissions?: string[];
  aliases?: string[];
}

export class FeatureRegistry {
  private static features: Feature[] = [
    // MODERATION FEATURES
    {
      name: 'delete_messages',
      category: 'moderation',
      description: 'Delete messages in bulk with smart filtering (toxicity, scams, FUD, spam, etc.)',
      examples: [
        'delete last 20 messages',
        'sil son 50 mesaj',
        'delete messages from @user',
        'delete toxic messages',
        'sil şu kullanıcının mesajlarını'
      ],
      requiredPermissions: ['MANAGE_MESSAGES'],
      aliases: ['sil', 'delete', 'remove', 'temizle', 'purge', 'clear']
    },
    {
      name: 'ban_user',
      category: 'moderation',
      description: 'Permanently ban a user from the server',
      examples: [
        'ban @user for spam',
        'yasakla @user',
        'ban that scammer',
        '@user ı yasakla'
      ],
      requiredPermissions: ['BAN_MEMBERS'],
      aliases: ['ban', 'yasakla', 'banla']
    },
    {
      name: 'timeout_user',
      category: 'moderation',
      description: 'Temporarily mute a user (timeout)',
      examples: [
        'timeout @user 10 minutes',
        'sustur @user 1 saat',
        'mute that guy for being toxic',
        'timeout @user for 30m'
      ],
      requiredPermissions: ['MODERATE_MEMBERS'],
      aliases: ['timeout', 'mute', 'sustur', 'sessiz']
    },
    {
      name: 'kick_user',
      category: 'moderation',
      description: 'Kick a user from the server (they can rejoin)',
      examples: [
        'kick @user',
        'at @user',
        'kick that troll'
      ],
      requiredPermissions: ['KICK_MEMBERS'],
      aliases: ['kick', 'at', 'kovmak']
    },
    {
      name: 'warn_user',
      category: 'moderation',
      description: 'Issue a warning to a user (recorded in trust score)',
      examples: [
        'warn @user stop being toxic',
        'uyar @user',
        'give warning to @user'
      ],
      requiredPermissions: ['MANAGE_MESSAGES'],
      aliases: ['warn', 'uyar', 'uyarı']
    },

    // ANALYTICS FEATURES
    {
      name: 'analyze_user',
      category: 'analytics',
      description: 'Analyze user behavior, toxicity patterns, and trust score',
      examples: [
        'analyze @user',
        '@user ı analiz et',
        'check user behavior',
        'show me @user stats'
      ],
      requiredPermissions: ['MANAGE_GUILD'],
      aliases: ['analyze', 'analiz', 'check', 'kontrol', 'stats', 'istatistik']
    },
    {
      name: 'trust_score',
      category: 'trust',
      description: 'Check trust score of a user (0-100)',
      examples: [
        'trust score @user',
        '@user güven skoru',
        'how trustworthy is @user',
        'skor @user'
      ],
      aliases: ['trust', 'güven', 'score', 'skor']
    },
    {
      name: 'server_analytics',
      category: 'analytics',
      description: 'View server-wide analytics (toxicity trends, active users, violations)',
      examples: [
        'show server analytics',
        'sunucu analizi',
        'server stats',
        'toxicity trends'
      ],
      requiredPermissions: ['MANAGE_GUILD'],
      aliases: ['analytics', 'analiz', 'stats', 'trends']
    },

    // SCAM DETECTION
    {
      name: 'scam_detection',
      category: 'scam',
      description: 'Automatic scam detection (crypto, phishing, fake giveaways). Scammers get instant PERMA BAN.',
      examples: [
        'check if this is a scam',
        'is @user a scammer',
        'analyze this link for scam'
      ],
      aliases: ['scam', 'dolandırıcı', 'phishing', 'fake']
    },

    // CONVERSATION
    {
      name: 'general_conversation',
      category: 'conversation',
      description: 'Have a normal conversation with BECAS (greetings, questions, help)',
      examples: [
        'hello becas',
        'merhaba',
        'what can you do',
        'help me',
        'explain how you work'
      ],
      aliases: ['hi', 'hello', 'merhaba', 'selam', 'help', 'yardım']
    },
    {
      name: 'typo_correction',
      category: 'system',
      description: 'Automatically fix typos in commands (Turkish + English)',
      examples: [
        'dolete last 5 messages → delete last 5 messages',
        'bannuser → ban user',
        'tiemout → timeout'
      ],
      aliases: []
    }
  ];

  /**
   * Get all features as AI-readable documentation
   */
  static getFeatureDocumentation(): string {
    let doc = '# BECAS FEATURES - What I Can Do\n\n';

    const categories = [...new Set(this.features.map(f => f.category))];

    for (const category of categories) {
      doc += `## ${category.toUpperCase()}\n\n`;

      const categoryFeatures = this.features.filter(f => f.category === category);

      for (const feature of categoryFeatures) {
        doc += `### ${feature.name}\n`;
        doc += `**Description:** ${feature.description}\n`;

        if (feature.requiredPermissions && feature.requiredPermissions.length > 0) {
          doc += `**Required Permissions:** ${feature.requiredPermissions.join(', ')}\n`;
        }

        if (feature.aliases && feature.aliases.length > 0) {
          doc += `**Aliases:** ${feature.aliases.join(', ')}\n`;
        }

        doc += `**Examples:**\n`;
        for (const example of feature.examples) {
          doc += `  - ${example}\n`;
        }
        doc += '\n';
      }
    }

    return doc;
  }

  /**
   * Find features matching a command
   */
  static findRelevantFeatures(command: string): Feature[] {
    const commandLower = command.toLowerCase();
    const relevant: Feature[] = [];

    for (const feature of this.features) {
      // Check if command mentions feature name
      if (commandLower.includes(feature.name.toLowerCase())) {
        relevant.push(feature);
        continue;
      }

      // Check aliases
      if (feature.aliases) {
        for (const alias of feature.aliases) {
          if (commandLower.includes(alias.toLowerCase())) {
            relevant.push(feature);
            break;
          }
        }
      }
    }

    return relevant;
  }

  /**
   * Get feature by name
   */
  static getFeature(name: string): Feature | undefined {
    return this.features.find(f => f.name === name || f.aliases?.includes(name));
  }

  /**
   * Get all features
   */
  static getAllFeatures(): Feature[] {
    return [...this.features];
  }

  /**
   * Get features by category
   */
  static getFeaturesByCategory(category: string): Feature[] {
    return this.features.filter(f => f.category === category);
  }
}
