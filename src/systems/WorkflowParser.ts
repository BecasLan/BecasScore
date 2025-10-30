// WorkflowParser.ts - Parse complex natural language commands into workflows
// Example: "watch all trust <50 users for 3 hours if they make FUD ban them and announce in #banned"

import { Message } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { WatchCondition, ConditionType, ConditionalAction, EscalationConfig } from './WatchSystem';
import { createLogger } from '../services/Logger';

const logger = createLogger('WorkflowParser');

// ============================================
// WORKFLOW COMMAND
// ============================================

export interface WorkflowCommand {
  type: 'watch' | 'simple';

  // For watch workflows
  watchConfig?: {
    duration_hours: number;
    filter?: {
      trustScoreMin?: number;
      trustScoreMax?: number;
      hasRole?: string;
      lacksRole?: string;
      joinedWithinDays?: number;
    };
    userIds?: string[];
    conditions: WatchCondition[];
    actions: ConditionalAction[]; // 🔥 NEW: Supports conditional actions
    escalation?: EscalationConfig; // 🔥 NEW: Escalation config
    announceChannel?: string;
    announceTemplate?: string;
  };

  // For simple actions
  simpleAction?: {
    action_id: string;
    parameters: Record<string, any>;
  };

  understood_intent: string;
  response_to_moderator: string;
}

// ============================================
// WORKFLOW PARSER
// ============================================

export class WorkflowParser {
  private ollama: OllamaService;

  constructor(ollama: OllamaService) {
    this.ollama = ollama;
    logger.info('WorkflowParser initialized');
  }

  /**
   * Parse a natural language command into a workflow
   * NO REGEX - Pure AI reasoning to determine if this is a workflow command
   */
  async parseCommand(commandText: string, message: Message): Promise<WorkflowCommand> {
    logger.info(`Parsing workflow command: "${commandText}"`);

    // 🧠 Let AI decide if this is a workflow command
    // Always try to parse as watch command - AI will tell us if it's not
    return await this.parseWatchCommand(commandText, message);
  }

  /**
   * Parse any command - AI decides if it's a workflow
   */
  private async parseWatchCommand(commandText: string, message: Message): Promise<WorkflowCommand> {
    const prompt = `You are a superintelligent AI workflow parser. Analyze this command.

MODERATOR'S COMMAND: "${commandText}"

🧠 THINK DEEPLY:
Is this person asking you to MONITOR/WATCH users for behaviors? Or is it something else?

If it's a monitoring workflow, figure out:
- WHO to monitor? (specific users via @mentions, or filter by trust score/role/join date)
- WHAT to watch for? (FUD, spam, toxicity, negative sentiment, message velocity)
- HOW LONG to monitor? (extract from "for X hours/minutes" or default to 24 hours)
- WHAT ACTIONS to take when detected? (warn, timeout X minutes, ban, kick)
- ESCALATION? (if they say "1st warn, 2nd timeout, 3rd ban" use escalation stages)
- CONDITIONAL ACTIONS? (if they say "if trust >50 just warn, else ban" use conditional actions)
- ANNOUNCE where? (extract channel like "#security-log")

If this is NOT a monitoring workflow (like a simple "timeout user" or "show stats"), return:
{
  "understood_intent": "not a workflow - simple action",
  "duration_hours": 0,
  "filter": null,
  "conditions": [],
  "actions": [],
  "escalation": null,
  "announceChannel": null,
  "response_to_moderator": "This doesn't seem to be a monitoring workflow"
}

Otherwise, return a complete monitoring workflow:
{
  "understood_intent": "brief description",
  "duration_hours": number,
  "filter": {
    "trustScoreMin": number | null,
    "trustScoreMax": number | null,
    "hasRole": "string" | null,
    "lacksRole": "string" | null,
    "joinedWithinDays": number | null
  } | null,
  "userIds": ["string"] | null,
  "conditions": [
    {
      "type": "fud_detection" | "negative_sentiment" | "spam_detection" | "toxicity" | "custom_keyword",
      "description": "what to watch for",
      "keywords": ["string"] | null,
      "threshold": number | null
    }
  ],
  "actions": [
    {
      "action_id": "ban" | "kick" | "timeout" | etc,
      "parameters": {
        "reason": "string",
        "duration_minutes": number | null
      },
      "condition": {
        "type": "trust_score" | "violation_count" | "user_age_days" | "always",
        "operator": ">" | "<" | ">=" | "<=" | "==" | "!=",
        "value": number
      } | null,
      "elseAction": { "action_id": "...", "parameters": {...} } | null
    }
  ],
  "escalation": {
    "enabled": boolean,
    "resetAfterHours": number | null,
    "stages": [
      {
        "violationCount": number,
        "action_id": "...",
        "parameters": {...},
        "description": "..."
      }
    ]
  } | null,
  "announceChannel": "#channel-name" | null,
  "response_to_moderator": "natural confirmation message"
}

IMPORTANT: This is NOT a programming test. You must THINK about what the moderator truly wants.

Available condition types: "fud_detection", "negative_sentiment", "spam_detection", "toxicity", "sentiment_trend", "message_velocity", "custom_keyword"
Available actions: "ban", "kick", "timeout", "warn", "untimeout"
For timeouts, specify duration_minutes in parameters.

If you see words like "1st time", "2nd time", "3rd time" - use escalation.
If you see "if trust >X do Y else Z" - use conditional actions with if/else.
If no duration specified, default to 24 hours.

Think step by step, then output clean JSON.`;

    let response = '';
    let jsonStr = '';

    try {
      response = await this.ollama.generate(prompt, 'You are a superintelligent JSON generator. Output ONLY valid JSON. No markdown. No explanations. No extra text. JUST the JSON object.');

      // Better JSON extraction
      let cleaned = response.trim();

      // Remove markdown code blocks
      cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '');

      // Find the FIRST { and LAST }
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');

      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error('No JSON object found in response');
      }

      jsonStr = cleaned.substring(firstBrace, lastBrace + 1);

      logger.info(`========================================`);
      logger.info(`🤖 RAW LLM RESPONSE:`);
      logger.info(response.substring(0, 500));
      logger.info(`========================================`);
      logger.info(`🧹 CLEANED RESPONSE:`);
      logger.info(cleaned.substring(0, 500));
      logger.info(`========================================`);
      logger.info(`📦 EXTRACTED JSON:`);
      logger.info(jsonStr.substring(0, 500));
      logger.info(`========================================`);

      const parsed = JSON.parse(jsonStr);
      logger.info(`✅ JSON parsed successfully!`);

      // Extract mentioned users
      const mentionedUserIds = Array.from(message.mentions.users.keys());

      return {
        type: 'watch',
        watchConfig: {
          duration_hours: parsed.duration_hours || 1,
          filter: parsed.filter,
          userIds: parsed.userIds || (mentionedUserIds.length > 0 ? mentionedUserIds : undefined),
          conditions: parsed.conditions || [],
          actions: parsed.actions || [],
          escalation: parsed.escalation, // 🔥 NEW: Include escalation config
          announceChannel: parsed.announceChannel ?
            this.extractChannelId(parsed.announceChannel, message) : undefined,
          announceTemplate: undefined
        },
        understood_intent: parsed.understood_intent,
        response_to_moderator: parsed.response_to_moderator
      };

    } catch (error: any) {
      logger.error('Failed to parse watch command:', error);
      logger.error('AI Response was:', response);
      logger.error('Attempted JSON extraction:', jsonStr || 'N/A');
      return {
        type: 'simple',
        simpleAction: undefined,
        understood_intent: 'Failed to parse command',
        response_to_moderator: `Sorry, the AI generated invalid JSON. This is a bug in the workflow parser.`
      };
    }
  }

  /**
   * Parse a simple action command (fallback)
   */
  private async parseSimpleCommand(commandText: string): Promise<WorkflowCommand> {
    return {
      type: 'simple',
      simpleAction: undefined, // Will be handled by existing system
      understood_intent: 'Simple action command',
      response_to_moderator: 'Processing action...'
    };
  }

  /**
   * Extract channel ID from channel mention or name
   */
  private extractChannelId(channelRef: string, message: Message): string | undefined {
    // Check if it's a channel mention like <#123456>
    const mentionMatch = channelRef.match(/<#(\d+)>/);
    if (mentionMatch) return mentionMatch[1];

    // Check if it's a channel name like #general
    const channelName = channelRef.replace(/^#/, '').toLowerCase();
    const channel = message.guild?.channels.cache.find(c =>
      c.name.toLowerCase() === channelName
    );

    return channel?.id;
  }
}
