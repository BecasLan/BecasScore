import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

const logger = createLogger('NLActionParser');

export type DiscordAction =
  | 'create_channel'
  | 'delete_channel'
  | 'create_role'
  | 'assign_role'
  | 'remove_role'
  | 'delete_role'
  | 'kick_member'
  | 'ban_member'
  | 'timeout_member'
  | 'remove_timeout'
  | 'create_thread'
  | 'delete_messages'
  | 'pin_message'
  | 'send_message'
  | 'change_nickname'
  | 'move_to_thread'
  | 'create_invite'
  | 'modify_permissions'
  | 'change_server_name'
  | 'lock_channel'
  | 'unlock_channel'
  | 'archive_channel'
  | 'slowmode'
  | 'none';

export interface ParsedAction {
  action: DiscordAction;
  confidence: number;
  parameters: {
    target?: string;           // User, channel, or role mention
    name?: string;             // Name for creation
    reason?: string;           // Reason for action
    duration?: number;         // Duration in ms
    count?: number;            // Message count, slowmode seconds, etc.
    permissions?: string[];    // Permission flags
    color?: string;            // Role color
    channelType?: 'text' | 'voice' | 'announcement' | 'forum';
    threadName?: string;       // Thread name
    position?: number;         // Channel/role position
    [key: string]: any;
  };
  reasoning: string;
  requiresConfirmation: boolean;  // Dangerous actions need confirmation
  shouldExecute: boolean;         // False if just asking/discussing
}

export class NaturalLanguageActionParser {
  private ollama: OllamaService;

  constructor(ollama?: OllamaService) {
    this.ollama = ollama || new OllamaService();
  }

  /**
   * Parse natural language into executable Discord action
   */
  async parse(message: string, context?: string): Promise<ParsedAction> {
    logger.info('Parsing natural language action', { message: message.substring(0, 100) });

    // Extract mentions from the message first
    const userMentions = this.extractMentions(message);
    const channelMentions = this.extractChannelMentions(message);
    const roleMentions = this.extractRoleMentions(message);

    logger.debug('Extracted mentions', { userMentions, channelMentions, roleMentions });

    const prompt = `Analyze this Discord message to determine what action the user wants Becas (an AI moderator) to perform:

Message: "${message}"
${context ? `Context: ${context}` : ''}

Detected mentions in message:
- Users: ${userMentions.length > 0 ? userMentions.map(id => `<@${id}>`).join(', ') : 'none'}
- Channels: ${channelMentions.length > 0 ? channelMentions.map(id => `<#${id}>`).join(', ') : 'none'}
- Roles: ${roleMentions.length > 0 ? roleMentions.map(id => `<@&${id}>`).join(', ') : 'none'}

Determine:
1. What Discord action they want (create channel, assign role, ban user, etc.)
2. Extract ALL parameters (names, targets, reasons, durations, etc.)
3. Whether this is an ACTUAL REQUEST or just asking/discussing
4. Whether it needs confirmation (dangerous actions like bans, deletions)
5. Confidence level (0-1)

Available actions:
- create_channel, delete_channel, create_role, assign_role, remove_role, delete_role
- kick_member, ban_member, timeout_member, remove_timeout
- create_thread, delete_messages, pin_message, send_message
- change_nickname, move_to_thread, create_invite
- modify_permissions, change_server_name
- lock_channel, unlock_channel, archive_channel, slowmode
- none (no action requested)

Think about:
- Is this a COMMAND or just CONVERSATION? ("can you create a channel" vs "what do you think about creating a channel?")
- Are they asking Becas to DO something or just talking?
- What are ALL the parameters? (name, target user, reason, duration, count, color, type, etc.)

CRITICAL: Respond ONLY with valid JSON. NO comments, NO explanations, NO annotations in the JSON.

Example of CORRECT JSON:
{
  "action": "timeout_member",
  "confidence": 0.95,
  "parameters": {
    "target": "<@799311717502287923>",
    "duration": 300000,
    "reason": "requested by admin"
  },
  "reasoning": "User wants to timeout mentioned user for 5 minutes",
  "requiresConfirmation": false,
  "shouldExecute": true
}

RULES for JSON:
- duration MUST be a NUMBER (like 300000), NOT a string with comments (like "300000 (5 minutes)")
- target MUST be the EXACT mention from the message (like "<@799311717502287923>")
- count MUST be a NUMBER
- ALL values must be valid JSON types (string, number, boolean, array, object)
- NO comments inside the JSON

Your JSON response:`;

    const systemPrompt = `You are an expert at understanding natural language requests for Discord actions.
You understand the difference between actual requests and just discussing possibilities.
You extract ALL relevant parameters accurately.
You identify dangerous actions that need confirmation.
Respond ONLY with valid JSON.`;

    try {
      const result = await this.ollama.generateJSON<ParsedAction>(prompt, systemPrompt);

      logger.info('Parsed action', {
        action: result.action,
        confidence: result.confidence,
        shouldExecute: result.shouldExecute,
      });

      // Post-process: Ensure correct user/channel/role IDs are used
      if (result.parameters.target) {
        // If target is set but looks generic, use the first mention
        if (result.parameters.target.includes('@user') || result.parameters.target.includes('@member')) {
          if (userMentions.length > 0) {
            result.parameters.target = `<@${userMentions[0]}>`;
            logger.debug('Corrected target to first user mention', { target: result.parameters.target });
          }
        } else if (result.parameters.target.includes('#channel')) {
          if (channelMentions.length > 0) {
            result.parameters.target = `<#${channelMentions[0]}>`;
            logger.debug('Corrected target to first channel mention', { target: result.parameters.target });
          }
        } else if (result.parameters.target.includes('@role')) {
          if (roleMentions.length > 0) {
            result.parameters.target = `<@&${roleMentions[0]}>`;
            logger.debug('Corrected target to first role mention', { target: result.parameters.target });
          }
        }
      } else {
        // No target specified but we have mentions - auto-fill
        if (userMentions.length > 0 && ['timeout_member', 'remove_timeout', 'ban_member', 'kick_member', 'assign_role', 'remove_role', 'change_nickname'].includes(result.action)) {
          result.parameters.target = `<@${userMentions[0]}>`;
          logger.debug('Auto-filled target from user mention', { target: result.parameters.target });
        }
      }

      // Validate confidence (lowered from 0.6 to 0.4 for more AI flexibility)
      if (result.confidence < 0.4) {
        logger.warn('Low confidence in action parsing', { confidence: result.confidence });
        return {
          action: 'none',
          confidence: 0,
          parameters: {},
          reasoning: 'Not confident enough in understanding the request',
          requiresConfirmation: false,
          shouldExecute: false,
        };
      }

      return result;
    } catch (error) {
      logger.error('Failed to parse natural language action', error);
      return {
        action: 'none',
        confidence: 0,
        parameters: {},
        reasoning: 'Failed to parse request',
        requiresConfirmation: false,
        shouldExecute: false,
      };
    }
  }

  /**
   * Generate natural confirmation message for action
   */
  async generateConfirmation(action: ParsedAction): Promise<string> {
    const prompt = `Generate a natural confirmation message for this action:

Action: ${action.action}
Parameters: ${JSON.stringify(action.parameters)}
Reasoning: ${action.reasoning}

Generate a brief, natural message asking for confirmation. Be:
- Conversational (not robotic)
- Clear about what will happen
- Include relevant details
- Keep it short (1-2 sentences)

Examples:
- "Just to confirm - you want me to ban @user for spamming? This is permanent."
- "Creating a new #gaming channel - should I make it public or members-only?"
- "About to delete the last 50 messages in #general. Sound good?"

Respond with just the confirmation message, nothing else.`;

    const systemPrompt = `You are Becas, asking for confirmation naturally. Be conversational.`;

    try {
      const response = await this.ollama.generate(prompt, systemPrompt, {
        temperature: 0.7,
        maxTokens: 100,
      });
      return response.trim();
    } catch (error) {
      logger.error('Failed to generate confirmation', error);
      return `Confirm: ${action.action} with ${JSON.stringify(action.parameters)}?`;
    }
  }

  /**
   * Generate natural response after action execution
   */
  async generateExecutionResponse(
    action: ParsedAction,
    success: boolean,
    result?: any
  ): Promise<string> {
    // If we have a result message, use it directly
    if (result && result.message) {
      return result.message;
    }

    // Otherwise generate a simple response
    if (success) {
      let msg = '';
      const target = action.parameters.target || '';

      switch (action.action) {
        case 'timeout_member':
          const duration = action.parameters.duration || 600000;
          const mins = Math.floor(duration / 60000);
          msg = `Done. ${target} has been timed out for ${mins} minutes.`;
          break;
        case 'remove_timeout':
          msg = `Done. Removed timeout from ${target}.`;
          break;
        case 'ban_member':
          msg = `Done. ${target} has been banned.`;
          break;
        case 'kick_member':
          msg = `Done. ${target} has been kicked.`;
          break;
        default:
          msg = `Done. ${action.action.replace('_', ' ')} completed.`;
      }

      return msg;
    } else {
      const errorMsg = result?.error || result?.message || 'something went wrong';
      return `Couldn't complete that - ${errorMsg}.`;
    }
  }

  /**
   * Check if action is dangerous and needs extra confirmation
   */
  isDangerousAction(action: DiscordAction): boolean {
    const dangerous = [
      'ban_member',
      'delete_channel',
      'delete_role',
      'delete_messages',
      'change_server_name',
    ];
    return dangerous.includes(action);
  }

  /**
   * Extract mentioned users from message
   */
  extractMentions(message: string): string[] {
    const regex = /<@!?(\d+)>/g;
    const matches = message.matchAll(regex);
    return Array.from(matches, m => m[1]);
  }

  /**
   * Extract channel mentions from message
   */
  extractChannelMentions(message: string): string[] {
    const regex = /<#(\d+)>/g;
    const matches = message.matchAll(regex);
    return Array.from(matches, m => m[1]);
  }

  /**
   * Extract role mentions from message
   */
  extractRoleMentions(message: string): string[] {
    const regex = /<@&(\d+)>/g;
    const matches = message.matchAll(regex);
    return Array.from(matches, m => m[1]);
  }

  /**
   * Parse duration from natural language
   */
  parseDuration(text: string): number | undefined {
    const patterns = [
      { regex: /(\d+)\s*s(?:ec(?:ond)?s?)?/i, multiplier: 1000 },
      { regex: /(\d+)\s*m(?:in(?:ute)?s?)?/i, multiplier: 60000 },
      { regex: /(\d+)\s*h(?:(?:ou)?rs?)?/i, multiplier: 3600000 },
      { regex: /(\d+)\s*d(?:ays?)?/i, multiplier: 86400000 },
      { regex: /(\d+)\s*w(?:eeks?)?/i, multiplier: 604800000 },
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern.regex);
      if (match) {
        return parseInt(match[1]) * pattern.multiplier;
      }
    }

    return undefined;
  }

  /**
   * Parse color from text
   */
  parseColor(text: string): string | undefined {
    // Hex color
    const hexMatch = text.match(/#([0-9A-Fa-f]{6})/);
    if (hexMatch) return hexMatch[0];

    // Named colors
    const colorMap: Record<string, string> = {
      red: '#FF0000',
      blue: '#0000FF',
      green: '#00FF00',
      yellow: '#FFFF00',
      purple: '#800080',
      orange: '#FFA500',
      pink: '#FFC0CB',
      black: '#000000',
      white: '#FFFFFF',
    };

    const lower = text.toLowerCase();
    for (const [name, hex] of Object.entries(colorMap)) {
      if (lower.includes(name)) return hex;
    }

    return undefined;
  }
}
