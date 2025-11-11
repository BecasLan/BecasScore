/**
 * INTENT REGISTRY
 *
 * Centralized registry of all intents with descriptions for AI-based matching.
 * This replaces hard-coded keyword matching with semantic understanding.
 *
 * Architecture: Intent Tree
 * - Root intents (MODERATION_QUERY, CHAT, ADMIN_ACTION, etc.)
 * - Sub-intents (CHAT.HELP, CHAT.GREETING, ADMIN_ACTION.CREATE_CHANNEL, etc.)
 */

export interface IntentDefinition {
  name: string;
  description: string;
  examples: string[];
  handler: string;
  parentIntent?: string;
  subIntents?: IntentDefinition[];
}

/**
 * Complete Intent Registry
 * AI uses these descriptions to match user messages to intents
 */
export const INTENT_REGISTRY: IntentDefinition[] = [
  // ============================================
  // ROOT INTENT: MODERATION_QUERY
  // ============================================
  {
    name: 'MODERATION_QUERY',
    description: 'User wants to execute a moderation action: ban, timeout, kick, warn, delete messages, or unmute/unban users. This includes filtering by categories (toxic, spam, scam, FUD, profanity, NSFW) and time ranges (last X messages/hours).',
    examples: [
      'ban toxic users in last 20 messages',
      'timeout spammers for 1 hour',
      'kick anyone posting scam links',
      'warn users with profanity',
      'delete FUD messages from last hour',
      'unban @user',
      'untimeout @user',
    ],
    handler: 'IntelligentQueryEngine',
  },

  // ============================================
  // ROOT INTENT: ANALYTICS
  // ============================================
  {
    name: 'ANALYTICS',
    description: 'User wants to see server statistics, analytics, reports, trends, or analysis. This includes general server health, activity metrics, moderation stats, and patterns.',
    examples: [
      'show me server analytics',
      'what are the stats',
      'give me a report',
      'show server health',
      'what are the trends',
    ],
    handler: 'ServerAnalytics',
  },

  // ============================================
  // ROOT INTENT: TRUST_SCORE
  // ============================================
  {
    name: 'TRUST_SCORE',
    description: 'User wants to check the trust score or reputation of a specific user. Trust scores are cross-server ratings (0-100) that indicate how trustworthy a user is based on their behavior across all servers.',
    examples: [
      'what is the trust score of @user',
      'check @user trust score',
      'what is their reputation',
      'is @user trusted',
    ],
    handler: 'TrustScoreEngine',
  },

  // ============================================
  // ROOT INTENT: POLICY_MANAGEMENT
  // ============================================
  {
    name: 'POLICY_MANAGEMENT',
    description: 'User wants to create, view, edit, or delete moderation policies. Policies are automated rules like "if user posts 3 toxic messages in 5 minutes, timeout for 1 hour".',
    examples: [
      'show me all policies',
      'list active policies',
      'create a new policy',
      'add a rule for spam',
      'delete policy #3',
    ],
    handler: 'GuildPolicyEngine',
  },

  // ============================================
  // ROOT INTENT: USER_PROFILE
  // ============================================
  {
    name: 'USER_PROFILE',
    description: 'User wants to see detailed information about a specific user: their roles, join date, trust score, and behavior history.',
    examples: [
      'who is @user',
      'show user profile of @user',
      'user info @user',
      'tell me about @user',
    ],
    handler: 'V3Integration',
  },

  // ============================================
  // ROOT INTENT: SERVER_INFO
  // ============================================
  {
    name: 'SERVER_INFO',
    description: 'User wants to see information about the Discord server: member count, channel count, roles, creation date, and general server details.',
    examples: [
      'what is the server info',
      'guild details',
      'how many members',
      'server stats',
    ],
    handler: 'ServerAnalytics',
  },

  // ============================================
  // ROOT INTENT: UNDO
  // ============================================
  {
    name: 'UNDO',
    description: 'User wants to undo or revert the last moderation action. This is used when the bot made a mistake or moderator changed their mind.',
    examples: [
      'undo that',
      'take it back',
      'revert',
      'cancel that action',
      'geri al',
    ],
    handler: 'V3Integration',
  },

  // ============================================
  // ROOT INTENT: MODIFY
  // ============================================
  {
    name: 'MODIFY',
    description: 'User wants to modify the last moderation action to a different action type. This is used when the bot chose the wrong action severity (e.g., "no, ban them instead" after a timeout).',
    examples: [
      'no, ban them instead',
      'change to timeout 2 hours',
      'make it a kick',
      'actually just warn them',
    ],
    handler: 'V3Integration',
  },

  // ============================================
  // ROOT INTENT: ADMIN_ACTION (NEW!)
  // ============================================
  {
    name: 'ADMIN_ACTION',
    description: 'User wants to perform server administration tasks: create/delete channels, create/edit roles, manage permissions, change server settings. This is NOT moderation - it is server management.',
    examples: [
      'create a channel named announcements',
      'delete the spam channel',
      'create a role called VIP',
      'give @user the moderator role',
      'change server settings',
    ],
    handler: 'AdminActionEngine',
    subIntents: [
      {
        name: 'CREATE_CHANNEL',
        description: 'Create a new text or voice channel with specified name and permissions.',
        examples: [
          'create a channel named general',
          'make a voice channel called gaming',
          'create text channel announcements',
        ],
        handler: 'AdminActionEngine',
        parentIntent: 'ADMIN_ACTION',
      },
      {
        name: 'DELETE_CHANNEL',
        description: 'Delete an existing channel by name or ID.',
        examples: [
          'delete the spam channel',
          'remove channel #old-chat',
          'delete this channel',
        ],
        handler: 'AdminActionEngine',
        parentIntent: 'ADMIN_ACTION',
      },
      {
        name: 'CREATE_ROLE',
        description: 'Create a new role with specified name, color, and permissions.',
        examples: [
          'create a role called VIP',
          'make a moderator role',
          'create role with name supporter',
        ],
        handler: 'AdminActionEngine',
        parentIntent: 'ADMIN_ACTION',
      },
      {
        name: 'ASSIGN_ROLE',
        description: 'Give a role to a user or remove a role from a user.',
        examples: [
          'give @user the moderator role',
          'assign VIP role to @user',
          'remove admin role from @user',
        ],
        handler: 'AdminActionEngine',
        parentIntent: 'ADMIN_ACTION',
      },
      {
        name: 'MANAGE_PERMISSIONS',
        description: 'Edit channel or role permissions.',
        examples: [
          'make #announcements read-only',
          'give moderators ban permissions',
          'restrict #nsfw to 18+',
        ],
        handler: 'AdminActionEngine',
        parentIntent: 'ADMIN_ACTION',
      },
    ],
  },

  // ============================================
  // ROOT INTENT: CHAT
  // ============================================
  {
    name: 'CHAT',
    description: 'User is having a casual conversation with the bot: greetings, questions about capabilities, thanks, status checks, or general chat. This is NOT a command - just conversation.',
    examples: [
      'hello',
      'what can you do',
      'thank you',
      'how are you',
      'nice work',
    ],
    handler: 'ChatEngine',
    subIntents: [
      {
        name: 'HELP',
        description: 'User is asking what the bot can do, requesting a list of features or capabilities, or asking for help understanding how to use the bot.',
        examples: [
          'what can you do',
          'help',
          'tell me your features',
          'what are your capabilities',
          'how do I use you',
        ],
        handler: 'ExecutionEngine',
        parentIntent: 'CHAT',
      },
      {
        name: 'GREETING',
        description: 'User is greeting the bot or saying hello.',
        examples: [
          'hello',
          'hi',
          'hey there',
          'good morning',
          'merhaba',
        ],
        handler: 'ExecutionEngine',
        parentIntent: 'CHAT',
      },
      {
        name: 'THANKS',
        description: 'User is thanking the bot or expressing appreciation.',
        examples: [
          'thank you',
          'thanks',
          'appreciate it',
          'teşekkür ederim',
        ],
        handler: 'ExecutionEngine',
        parentIntent: 'CHAT',
      },
      {
        name: 'STATUS',
        description: 'User is asking how the bot is doing or checking if it is operational.',
        examples: [
          'how are you',
          'how is it going',
          'you ok?',
          'are you working',
        ],
        handler: 'ExecutionEngine',
        parentIntent: 'CHAT',
      },
      {
        name: 'CASUAL',
        description: 'General casual conversation that does not fit other sub-intents.',
        examples: [
          'nice work',
          'that is cool',
          'interesting',
          'ok',
        ],
        handler: 'ExecutionEngine',
        parentIntent: 'CHAT',
      },
    ],
  },
];

/**
 * Get all root intents (no parent)
 */
export function getRootIntents(): IntentDefinition[] {
  return INTENT_REGISTRY.filter(intent => !intent.parentIntent);
}

/**
 * Get all sub-intents for a parent intent
 */
export function getSubIntents(parentName: string): IntentDefinition[] {
  const parent = INTENT_REGISTRY.find(intent => intent.name === parentName);
  return parent?.subIntents || [];
}

/**
 * Find intent by name (searches root and sub-intents)
 */
export function findIntent(name: string): IntentDefinition | null {
  // Search root intents
  const rootIntent = INTENT_REGISTRY.find(intent => intent.name === name);
  if (rootIntent) return rootIntent;

  // Search sub-intents
  for (const root of INTENT_REGISTRY) {
    if (root.subIntents) {
      const subIntent = root.subIntents.find(sub => sub.name === name);
      if (subIntent) return subIntent;
    }
  }

  return null;
}

/**
 * Format intent registry for AI prompt
 */
export function formatIntentsForAI(intents: IntentDefinition[]): string {
  let output = '';

  for (const intent of intents) {
    output += `\n${intent.name}:\n`;
    output += `  Description: ${intent.description}\n`;
    output += `  Examples:\n`;
    for (const example of intent.examples) {
      output += `    - "${example}"\n`;
    }
  }

  return output;
}
