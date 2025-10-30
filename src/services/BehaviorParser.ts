import axios from 'axios';
import logger from '../utils/logger';

/**
 * BehaviorParser
 *
 * Converts natural language descriptions into BDL (Behavior Definition Language) JSON.
 * Allows moderators to create custom behaviors without coding.
 *
 * Example:
 * Input: "When a new user joins, send them a welcome DM"
 * Output: BDL JSON with trigger: guildMemberAdd, action: sendDM
 */

export interface BDLBehavior {
  id?: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: BDLTrigger;
  tracking?: BDLTracking;
  analysis?: BDLAnalysis;
  actions: BDLAction[];
  safety: BDLSafety;
}

export interface BDLTrigger {
  type: 'event' | 'schedule' | 'condition' | 'pattern';
  event?: string;  // For event type
  filters?: Record<string, any>;
  cron?: string;  // For schedule type
  timezone?: string;
  check?: string;  // For condition type
  interval?: string;
  pattern?: string;  // For pattern type
  scope?: string;
}

export interface BDLTracking {
  enabled: boolean;
  targetType: 'user' | 'channel' | 'server';
  targetId: string;
  duration: string;
  collect: {
    messages?: number;
    reactions?: boolean;
    voiceActivity?: boolean;
    roleChanges?: boolean;
    customData?: Record<string, string>;
  };
  stopConditions?: string[];
}

export interface BDLAnalysis {
  type: 'ai' | 'rules' | 'threshold' | 'pattern' | 'none';
  model?: string;
  prompt?: string;
  temperature?: number;
  outputSchema?: Record<string, string>;
  rules?: Array<{ if: string; then: Record<string, any> }>;
  metrics?: Record<string, { min?: number; max?: number }>;
  patterns?: string[];
}

export interface BDLAction {
  type: string;
  target?: string;
  message?: string;
  roleId?: string;
  channelId?: string;
  duration?: string;
  reason?: string;
  condition?: string;
  question?: string;
  expectedAnswer?: string;
  timeout?: string;
  onCorrect?: BDLAction;
  onIncorrect?: BDLAction;
  onTimeout?: BDLAction;
  embed?: Record<string, any>;
  level?: string;
  data?: string;
  title?: string;
  description?: string;
  assignTo?: string;
  priority?: string;
  behaviorId?: string;
  [key: string]: any;
}

export interface BDLSafety {
  maxExecutionsPerHour?: number;
  maxExecutionsPerUser?: number;
  requireModApproval?: boolean;
  allowedRoles?: string[];
  preventInfiniteLoops?: boolean;
  errorRetries?: number;
  disableOnErrors?: boolean;
  sandbox?: boolean;
}

export class BehaviorParser {
  private ollamaUrl: string;
  private model: string;

  constructor(ollamaUrl: string = 'http://localhost:11434', model: string = 'qwen2.5:14b') {
    this.ollamaUrl = ollamaUrl;
    this.model = model;
  }

  /**
   * Parse natural language into BDL
   */
  async parse(description: string, serverId: string): Promise<BDLBehavior> {
    logger.info(`Parsing behavior: "${description}"`);

    try {
      const prompt = this.buildPrompt(description);
      const response = await this.callOllama(prompt);
      const bdl = this.extractBDLFromResponse(response);

      // Validate BDL
      this.validateBDL(bdl);

      // Add defaults
      bdl.enabled = true;
      bdl.safety = bdl.safety || this.getDefaultSafety();

      logger.info(`Successfully parsed behavior: ${bdl.name}`);

      return bdl;

    } catch (error) {
      logger.error('Error parsing behavior:', error);
      throw new Error(`Failed to parse behavior: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build prompt for LLM
   */
  private buildPrompt(description: string): string {
    return `You are a Behavior Definition Language (BDL) generator for a Discord moderation bot.

**User Request:** "${description}"

**Your Task:** Convert this natural language description into BDL JSON format.

**BDL Structure:**
{
  "name": "Behavior Name",
  "description": "What this does",
  "trigger": { ... },
  "tracking": { ... } (optional),
  "analysis": { ... } (optional),
  "actions": [ ... ],
  "safety": { ... }
}

**Trigger Types:**
1. Event: { "type": "event", "event": "messageCreate|guildMemberAdd|messageReactionAdd|...", "filters": {...} }
2. Schedule: { "type": "schedule", "cron": "0 9 * * *", "timezone": "UTC" }
3. Condition: { "type": "condition", "check": "user.messageCount > 10", "interval": "5m" }
4. Pattern: { "type": "pattern", "pattern": "5 messages in 10 seconds" }

**Common Events:**
- messageCreate (new message)
- guildMemberAdd (user joins)
- guildMemberRemove (user leaves)
- messageReactionAdd (reaction added)
- voiceStateUpdate (voice activity)

**Tracking (optional):**
{
  "enabled": true,
  "targetType": "user|channel|server",
  "targetId": "\${triggeredUserId}",
  "duration": "24h|7d|...",
  "collect": {
    "messages": 10,
    "customData": { "linkCount": "\${count(messages.links)}" }
  }
}

**Analysis (optional):**
- AI: { "type": "ai", "prompt": "...", "outputSchema": {...} }
- Rules: { "type": "rules", "rules": [{ "if": "linkCount > 5", "then": {...} }] }
- Threshold: { "type": "threshold", "metrics": { "messageCount": { "min": 5 } } }
- None: { "type": "none" }

**Actions (required):**
- sendDM: { "type": "sendDM", "target": "\${triggeredUserId}", "message": "..." }
- addRole: { "type": "addRole", "target": "...", "roleId": "..." }
- removeRole: { "type": "removeRole", "target": "...", "roleId": "..." }
- timeout: { "type": "timeout", "target": "...", "duration": "1h", "reason": "..." }
- kick: { "type": "kick", "target": "...", "reason": "..." }
- ban: { "type": "ban", "target": "...", "reason": "..." }
- sendMessage: { "type": "sendMessage", "channelId": "...", "message": "..." }
- askQuestion: { "type": "askQuestion", "target": "...", "question": "...", "expectedAnswer": "...", "onCorrect": {...}, "onIncorrect": {...} }
- log: { "type": "log", "level": "info", "message": "..." }
- createTicket: { "type": "createTicket", "title": "...", "description": "..." }

**Action Conditions:**
Add "condition": "analysis.isSpammer === true" to make actions conditional

**Safety:**
{
  "maxExecutionsPerHour": 100,
  "maxExecutionsPerUser": 5,
  "requireModApproval": false,
  "preventInfiniteLoops": true,
  "disableOnErrors": true
}

**Examples:**

1. "When a new user joins, send them a welcome DM"
{
  "name": "Welcome DM",
  "description": "Send welcome message to new members",
  "trigger": { "type": "event", "event": "guildMemberAdd" },
  "actions": [
    { "type": "sendDM", "target": "\${triggeredUserId}", "message": "Welcome to the server!" }
  ],
  "safety": { "maxExecutionsPerHour": 50 }
}

2. "Track new users' first 10 messages and timeout them if they post links"
{
  "name": "New User Link Monitor",
  "description": "Detect spam from new users",
  "trigger": { "type": "event", "event": "guildMemberAdd" },
  "tracking": {
    "enabled": true,
    "targetType": "user",
    "targetId": "\${triggeredUserId}",
    "duration": "24h",
    "collect": { "messages": 10, "customData": { "linkCount": "\${count(messages.links)}" } },
    "stopConditions": ["messageCount >= 10"]
  },
  "analysis": {
    "type": "threshold",
    "metrics": { "linkCount": { "max": 2 } }
  },
  "actions": [
    { "type": "timeout", "target": "\${triggeredUserId}", "duration": "1h", "reason": "Too many links", "condition": "linkCount > 2" }
  ],
  "safety": { "maxExecutionsPerHour": 100 }
}

3. "Give 'Active' role to users who send 50 messages"
{
  "name": "Active Member Role",
  "description": "Reward active users",
  "trigger": { "type": "event", "event": "messageCreate" },
  "analysis": {
    "type": "threshold",
    "metrics": { "userTotalMessages": { "min": 50 } }
  },
  "actions": [
    { "type": "addRole", "target": "\${triggeredUserId}", "roleId": "ROLE_ID_PLACEHOLDER", "condition": "userTotalMessages >= 50" }
  ],
  "safety": { "maxExecutionsPerUser": 1 }
}

**Important:**
- Use "\${triggeredUserId}" for the user who triggered the behavior
- Use "\${triggeredChannelId}" for the channel
- Use role IDs as "ROLE_ID_PLACEHOLDER" (moderator will replace)
- Use channel IDs as "CHANNEL_ID_PLACEHOLDER"
- Set reasonable safety limits
- Return ONLY valid JSON (no markdown, no explanations)

Now convert the user's request to BDL JSON:`;
  }

  /**
   * Call Ollama API
   */
  private async callOllama(prompt: string): Promise<string> {
    const response = await axios.post(
      `${this.ollamaUrl}/api/generate`,
      {
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature: 0.2,  // Low for structured output
          num_predict: 2000
        }
      },
      { timeout: 60000 }
    );

    return response.data.response;
  }

  /**
   * Extract BDL from LLM response
   */
  private extractBDLFromResponse(response: string): BDLBehavior {
    try {
      // Remove markdown code blocks
      let jsonStr = response.trim();
      jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '');

      // Find JSON object
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const bdl = JSON.parse(jsonMatch[0]);

      return bdl as BDLBehavior;

    } catch (error) {
      logger.error('Failed to parse LLM response:', error);
      logger.error('Raw response:', response);
      throw new Error('Failed to extract BDL from LLM response');
    }
  }

  /**
   * Validate BDL structure
   */
  private validateBDL(bdl: BDLBehavior): void {
    if (!bdl.name || bdl.name.trim().length === 0) {
      throw new Error('Behavior must have a name');
    }

    if (!bdl.trigger || !bdl.trigger.type) {
      throw new Error('Behavior must have a trigger');
    }

    if (!bdl.actions || bdl.actions.length === 0) {
      throw new Error('Behavior must have at least one action');
    }

    // Validate trigger type
    const validTriggerTypes = ['event', 'schedule', 'condition', 'pattern'];
    if (!validTriggerTypes.includes(bdl.trigger.type)) {
      throw new Error(`Invalid trigger type: ${bdl.trigger.type}`);
    }

    // Validate event trigger
    if (bdl.trigger.type === 'event' && !bdl.trigger.event) {
      throw new Error('Event trigger must specify an event');
    }

    // Validate schedule trigger
    if (bdl.trigger.type === 'schedule' && !bdl.trigger.cron) {
      throw new Error('Schedule trigger must specify a cron expression');
    }

    // Validate actions
    for (const action of bdl.actions) {
      if (!action.type) {
        throw new Error('Action must have a type');
      }
    }
  }

  /**
   * Get default safety settings
   */
  private getDefaultSafety(): BDLSafety {
    return {
      maxExecutionsPerHour: 100,
      maxExecutionsPerUser: 10,
      requireModApproval: false,
      preventInfiniteLoops: true,
      errorRetries: 3,
      disableOnErrors: true,
      sandbox: true
    };
  }

  /**
   * Get behavior templates
   */
  getTemplates(): Array<{ id: string; name: string; description: string; example: string }> {
    return [
      {
        id: 'welcome-dm',
        name: 'Welcome DM',
        description: 'Send a welcome message to new members',
        example: 'When a new user joins, send them a welcome DM'
      },
      {
        id: 'bot-verification',
        name: 'Bot Verification',
        description: 'Ask new users a question to verify they are human',
        example: 'When a new user joins, ask them a math question. If correct, give them the Verified role'
      },
      {
        id: 'link-monitor',
        name: 'New User Link Monitor',
        description: 'Track new users for spam links',
        example: 'Track new users\' first 10 messages. If they post more than 3 links, timeout them for 1 hour'
      },
      {
        id: 'auto-role',
        name: 'Auto Role on Activity',
        description: 'Give roles based on activity',
        example: 'Give the Active Member role to users who send 50 messages'
      },
      {
        id: 'daily-report',
        name: 'Daily Server Report',
        description: 'Send daily activity summary',
        example: 'Every day at 9 AM, send a summary of yesterday\'s activity to the mod channel'
      },
      {
        id: 'spam-detector',
        name: 'Spam Detector',
        description: 'Detect and handle spam messages',
        example: 'If someone sends more than 5 messages in 10 seconds, timeout them for 5 minutes'
      }
    ];
  }
}

/**
 * Example usage:
 *
 * const parser = new BehaviorParser('http://localhost:11434', 'qwen2.5:14b');
 *
 * // Parse natural language
 * const bdl = await parser.parse(
 *   'When a new user joins, send them a welcome DM',
 *   serverId
 * );
 *
 * console.log('Generated BDL:', bdl);
 * // {
 * //   name: "Welcome DM",
 * //   trigger: { type: "event", event: "guildMemberAdd" },
 * //   actions: [{ type: "sendDM", message: "Welcome!" }],
 * //   ...
 * // }
 *
 * // Get templates
 * const templates = parser.getTemplates();
 * console.log('Available templates:', templates);
 */
