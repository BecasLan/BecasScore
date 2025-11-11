/**
 * COMMAND DICTIONARY - Natural Language to Discord Action Mapping
 *
 * This defines all available Discord moderation commands with:
 * - Intent keywords (Turkish + English)
 * - Required and optional parameters
 * - Context resolution strategies
 * - Confirmation requirements
 */

export interface CommandParameter {
  name: string;
  type: 'user' | 'duration' | 'number' | 'channel' | 'role' | 'text';
  required: boolean;
  description: string;
}

export interface ContextClue {
  strategy: 'check_last_mention' | 'check_last_argument_participants' | 'check_replied_message_author' |
            'parse_time_expression' | 'parse_number' | 'check_current_channel' | 'extract_from_message';
  priority: number; // Higher = try first
  confidence_threshold?: number; // Min confidence to use this result
}

export interface ConfirmationRule {
  when: string; // Condition expression (e.g., "target_is_mod || target_count > 1")
  message: string; // Template for confirmation message (use {param} for substitution)
  warningLevel: 'info' | 'warning' | 'danger'; // UI emphasis
}

export interface CommandDefinition {
  intent: string; // Unique command identifier
  category: 'moderation' | 'channel_management' | 'role_management' | 'message_management' | 'utility';
  description: string;

  keywords: {
    tr: string[]; // Turkish keywords
    en: string[]; // English keywords
  };

  parameters: CommandParameter[];

  contextClues: {
    [parameterName: string]: ContextClue[];
  };

  confirmationRequired?: ConfirmationRule;

  permissions: string[]; // Discord permissions required

  examples: {
    tr: string[];
    en: string[];
  };
}

/**
 * COMMAND DICTIONARY - All available commands
 */
export const COMMAND_DICTIONARY: CommandDefinition[] = [
  // ========================================
  // MODERATION COMMANDS
  // ========================================

  {
    intent: 'timeout',
    category: 'moderation',
    description: 'Temporarily mute a user (timeout)',

    keywords: {
      tr: ['sustur', 'timeout', 'timeoutla', 'kapat ağzını', 'sus', 'sessiz et', 'sessize al'],
      en: ['timeout', 'mute', 'silence', 'quiet', 'shut up']
    },

    parameters: [
      { name: 'target', type: 'user', required: true, description: 'User to timeout' },
      { name: 'duration', type: 'duration', required: true, description: 'How long (e.g., 10m, 1h, 24h)' },
      { name: 'reason', type: 'text', required: false, description: 'Reason for timeout' }
    ],

    contextClues: {
      target: [
        { strategy: 'check_replied_message_author', priority: 10, confidence_threshold: 0.95 },
        { strategy: 'check_last_mention', priority: 8, confidence_threshold: 0.90 },
        { strategy: 'check_last_argument_participants', priority: 6, confidence_threshold: 0.75 }
      ],
      duration: [
        { strategy: 'parse_time_expression', priority: 10 } // "10 dakika", "1 saat", "24h"
      ]
    },

    confirmationRequired: {
      when: 'target_is_mod || duration > 86400000', // 24 hours
      message: '⚠️ {target} kullanıcısına {duration} timeout mu?',
      warningLevel: 'warning'
    },

    permissions: ['ModerateMembers'],

    examples: {
      tr: [
        'Şu adamı 10 dakikalığına sustur',
        'Timeout 1 saat',
        'Bu toxic herifi kapat artık'
      ],
      en: [
        'Timeout that guy for 10 minutes',
        'Mute him for 1 hour',
        'Silence this user'
      ]
    }
  },

  {
    intent: 'ban',
    category: 'moderation',
    description: 'Permanently ban a user from the server',

    keywords: {
      tr: ['ban', 'yasakla', 'banla', 'at', 'kovulsun', 'def et'],
      en: ['ban', 'banish', 'remove permanently', 'kick out forever']
    },

    parameters: [
      { name: 'target', type: 'user', required: true, description: 'User to ban' },
      { name: 'reason', type: 'text', required: false, description: 'Reason for ban' },
      { name: 'delete_days', type: 'number', required: false, description: 'Days of message history to delete (0-7)' }
    ],

    contextClues: {
      target: [
        { strategy: 'check_replied_message_author', priority: 10, confidence_threshold: 0.95 },
        { strategy: 'check_last_mention', priority: 8, confidence_threshold: 0.90 },
        { strategy: 'check_last_argument_participants', priority: 6, confidence_threshold: 0.75 }
      ]
    },

    confirmationRequired: {
      when: 'true', // Always confirm bans
      message: '🚨 DİKKAT: {target} kullanıcısını kalıcı olarak banla?',
      warningLevel: 'danger'
    },

    permissions: ['BanMembers'],

    examples: {
      tr: [
        'Bu scammer\'ı banla',
        'Şu kişiyi at sunucudan',
        'Ban et bunu'
      ],
      en: [
        'Ban this scammer',
        'Remove this user permanently',
        'Ban him'
      ]
    }
  },

  {
    intent: 'kick',
    category: 'moderation',
    description: 'Kick a user from the server (can rejoin)',

    keywords: {
      tr: ['kick', 'at', 'kov', 'çıkar', 'dışarı at'],
      en: ['kick', 'remove', 'throw out', 'eject']
    },

    parameters: [
      { name: 'target', type: 'user', required: true, description: 'User to kick' },
      { name: 'reason', type: 'text', required: false, description: 'Reason for kick' }
    ],

    contextClues: {
      target: [
        { strategy: 'check_replied_message_author', priority: 10, confidence_threshold: 0.95 },
        { strategy: 'check_last_mention', priority: 8, confidence_threshold: 0.90 }
      ]
    },

    confirmationRequired: {
      when: 'target_is_mod',
      message: '⚠️ {target} kullanıcısını kickle?',
      warningLevel: 'warning'
    },

    permissions: ['KickMembers'],

    examples: {
      tr: [
        'Kickle şunu',
        'At dışarı',
        'Kov bu troll\'ü'
      ],
      en: [
        'Kick this troll',
        'Remove him from server',
        'Kick this user'
      ]
    }
  },

  {
    intent: 'warn',
    category: 'moderation',
    description: 'Issue a warning to a user',

    keywords: {
      tr: ['warn', 'uyar', 'uyarı ver', 'ihtar et'],
      en: ['warn', 'warning', 'caution', 'alert']
    },

    parameters: [
      { name: 'target', type: 'user', required: true, description: 'User to warn' },
      { name: 'reason', type: 'text', required: true, description: 'Warning reason' }
    ],

    contextClues: {
      target: [
        { strategy: 'check_replied_message_author', priority: 10, confidence_threshold: 0.95 },
        { strategy: 'check_last_mention', priority: 8, confidence_threshold: 0.90 }
      ]
    },

    permissions: ['ModerateMembers'],

    examples: {
      tr: [
        'Uyar şu kişiyi toxiclik için',
        'Warn ver bu adama',
        'Uyarı yap spam için'
      ],
      en: [
        'Warn this user for toxicity',
        'Give warning for spam',
        'Warn him'
      ]
    }
  },

  // ========================================
  // CHANNEL MANAGEMENT
  // ========================================

  {
    intent: 'slowmode',
    category: 'channel_management',
    description: 'Enable slowmode in a channel',

    keywords: {
      tr: ['slowmode', 'yavaşlat', 'ağır mod', 'yavaş mod aç'],
      en: ['slowmode', 'slow mode', 'rate limit']
    },

    parameters: [
      { name: 'duration', type: 'duration', required: true, description: 'Slowmode interval (e.g., 5s, 30s, 1m)' },
      { name: 'channel', type: 'channel', required: false, description: 'Channel to apply slowmode (default: current)' }
    ],

    contextClues: {
      channel: [
        { strategy: 'check_current_channel', priority: 10, confidence_threshold: 1.0 }
      ],
      duration: [
        { strategy: 'parse_time_expression', priority: 10 }
      ]
    },

    permissions: ['ManageChannels'],

    examples: {
      tr: [
        'Slowmode 30 saniye',
        'Yavaş mod aç 1 dakika',
        'Burayı yavaşlat 10 saniye'
      ],
      en: [
        'Slowmode 30 seconds',
        'Enable slow mode 1 minute',
        'Set slowmode to 10s'
      ]
    }
  },

  {
    intent: 'lock',
    category: 'channel_management',
    description: 'Lock a channel (prevent non-mods from sending messages)',

    keywords: {
      tr: ['lock', 'kilitle', 'kapat', 'kilitli'],
      en: ['lock', 'close', 'freeze']
    },

    parameters: [
      { name: 'channel', type: 'channel', required: false, description: 'Channel to lock (default: current)' },
      { name: 'reason', type: 'text', required: false, description: 'Reason for lock' }
    ],

    contextClues: {
      channel: [
        { strategy: 'check_current_channel', priority: 10, confidence_threshold: 1.0 }
      ]
    },

    confirmationRequired: {
      when: 'true',
      message: '🔒 {channel} kanalını kilitle?',
      warningLevel: 'warning'
    },

    permissions: ['ManageChannels'],

    examples: {
      tr: [
        'Kanalı kilitle',
        'Lock şu channel',
        'Burayı kapat'
      ],
      en: [
        'Lock this channel',
        'Close the channel',
        'Freeze this chat'
      ]
    }
  },

  {
    intent: 'unlock',
    category: 'channel_management',
    description: 'Unlock a previously locked channel',

    keywords: {
      tr: ['unlock', 'kilidi aç', 'aç', 'açık'],
      en: ['unlock', 'open', 'unfreeze']
    },

    parameters: [
      { name: 'channel', type: 'channel', required: false, description: 'Channel to unlock (default: current)' }
    ],

    contextClues: {
      channel: [
        { strategy: 'check_current_channel', priority: 10, confidence_threshold: 1.0 }
      ]
    },

    permissions: ['ManageChannels'],

    examples: {
      tr: [
        'Kanalı aç',
        'Unlock yap',
        'Kilidi kaldır'
      ],
      en: [
        'Unlock this channel',
        'Open the channel',
        'Remove lock'
      ]
    }
  },

  // ========================================
  // MESSAGE MANAGEMENT
  // ========================================

  {
    intent: 'delete',
    category: 'message_management',
    description: 'Delete messages from a channel',

    keywords: {
      tr: ['delete', 'sil', 'temizle', 'kaldır', 'yok et'],
      en: ['delete', 'remove', 'clear', 'purge', 'clean']
    },

    parameters: [
      { name: 'count', type: 'number', required: true, description: 'Number of messages to delete' },
      { name: 'user', type: 'user', required: false, description: 'Only delete messages from this user' },
      { name: 'channel', type: 'channel', required: false, description: 'Channel to delete from (default: current)' }
    ],

    contextClues: {
      count: [
        { strategy: 'parse_number', priority: 10 }
      ],
      user: [
        { strategy: 'check_last_mention', priority: 8 }
      ],
      channel: [
        { strategy: 'check_current_channel', priority: 10, confidence_threshold: 1.0 }
      ]
    },

    confirmationRequired: {
      when: 'count > 10',
      message: '⚠️ {count} mesaj silmek üzeresin. Emin misin?',
      warningLevel: 'warning'
    },

    permissions: ['ManageMessages'],

    examples: {
      tr: [
        'Son 5 mesajı sil',
        'Şu adamın mesajlarını temizle',
        'Delete 20 mesaj'
      ],
      en: [
        'Delete last 5 messages',
        'Clear this user\'s messages',
        'Remove 20 messages'
      ]
    }
  },

  // ========================================
  // ROLE MANAGEMENT
  // ========================================

  {
    intent: 'role_add',
    category: 'role_management',
    description: 'Add a role to a user',

    keywords: {
      tr: ['rol ver', 'role add', 'ekle rol', 'role ekle'],
      en: ['add role', 'give role', 'assign role', 'grant role']
    },

    parameters: [
      { name: 'target', type: 'user', required: true, description: 'User to give role to' },
      { name: 'role', type: 'role', required: true, description: 'Role to add' }
    ],

    contextClues: {
      target: [
        { strategy: 'check_replied_message_author', priority: 10 },
        { strategy: 'check_last_mention', priority: 8 }
      ]
    },

    permissions: ['ManageRoles'],

    examples: {
      tr: [
        'Şuna moderator rolü ver',
        'Role ekle bu adama',
        'VIP yap şu kişiyi'
      ],
      en: [
        'Give moderator role to this user',
        'Add role to him',
        'Grant VIP role'
      ]
    }
  },

  {
    intent: 'role_remove',
    category: 'role_management',
    description: 'Remove a role from a user',

    keywords: {
      tr: ['rol al', 'role remove', 'çıkar rol', 'kaldır rol'],
      en: ['remove role', 'take role', 'revoke role', 'strip role']
    },

    parameters: [
      { name: 'target', type: 'user', required: true, description: 'User to remove role from' },
      { name: 'role', type: 'role', required: true, description: 'Role to remove' }
    ],

    contextClues: {
      target: [
        { strategy: 'check_replied_message_author', priority: 10 },
        { strategy: 'check_last_mention', priority: 8 }
      ]
    },

    permissions: ['ManageRoles'],

    examples: {
      tr: [
        'Şundan moderator rolünü al',
        'Rol kaldır bu adamdan',
        'VIP çıkar şu kişiden'
      ],
      en: [
        'Remove moderator role from this user',
        'Take away his role',
        'Revoke VIP role'
      ]
    }
  }
];

/**
 * Get command definition by intent
 */
export function getCommandByIntent(intent: string): CommandDefinition | undefined {
  return COMMAND_DICTIONARY.find(cmd => cmd.intent === intent);
}

/**
 * Search commands by keyword (Turkish or English)
 */
export function findCommandByKeyword(keyword: string): CommandDefinition[] {
  const normalizedKeyword = keyword.toLowerCase().trim();

  return COMMAND_DICTIONARY.filter(cmd =>
    cmd.keywords.tr.some(k => k.includes(normalizedKeyword)) ||
    cmd.keywords.en.some(k => k.includes(normalizedKeyword))
  );
}

/**
 * Get all commands in a category
 */
export function getCommandsByCategory(category: CommandDefinition['category']): CommandDefinition[] {
  return COMMAND_DICTIONARY.filter(cmd => cmd.category === category);
}
