import { OllamaService } from '../services/OllamaService';
import { Message, TextChannel } from 'discord.js';

/**
 * STRUCTURED ACTION PARSER
 *
 * Transforms natural language commands into executable, structured actions.
 * Enables complex, conditional moderation commands like:
 * - "delete last 20 messages that contain FUD"
 * - "ban users who posted scam links in the last hour"
 * - "timeout members with toxic messages for 10 minutes"
 *
 * Unlike regex-based parsing, this uses LLM intelligence to understand:
 * - Filters (FUD, toxic, scam, spam, etc.)
 * - Conditions (if/else logic)
 * - Scope (last N messages, specific users, time ranges)
 * - Actions (delete, ban, timeout, warn)
 */

export interface StructuredAction {
  // Primary action to execute
  action: 'bulk_delete' | 'ban' | 'timeout' | 'warn' | 'analyze' | 'kick' | 'mute' | 'delete_channel' | 'create_channel';

  // Scope: What to operate on
  scope: {
    type: 'messages' | 'users' | 'channels';
    count?: number;              // "last 20 messages"
    timeRange?: number;          // "in the last hour" (milliseconds)
    specific?: string[];         // Specific user IDs or message IDs
    channelName?: string;        // For channel operations
  };

  // Filters: Conditions to apply
  filters?: {
    contentType?: ('fud' | 'toxic' | 'scam' | 'spam' | 'negative' | 'positive')[];
    authorId?: string;           // "from user X"
    sentiment?: 'negative' | 'positive' | 'neutral';
    toxicityThreshold?: number;  // 0-1
    keywords?: string[];         // "containing word X"
    duplicate?: boolean;         // For finding duplicate channels/roles
  };

  // Action parameters
  parameters?: {
    duration?: number;           // For timeout/mute (milliseconds)
    reason?: string;             // Moderation reason
    deleteMessages?: boolean;    // For ban: also delete user's messages
  };

  // Conditional logic
  conditional?: {
    if: {
      condition: string;         // "if toxic"
      thenAction: string;        // "ban"
    };
    else?: {
      action: string;            // "warn"
    };
  };

  // Confidence in parsing
  confidence: number;            // 0-1
  originalCommand: string;       // For logging/debugging
}

export class StructuredActionParser {
  private llm: OllamaService;

  constructor() {
    this.llm = new OllamaService('analysis'); // Use DeepSeek for reasoning
    console.log('🧠 StructuredActionParser initialized - commands can now be complex!');
  }

  /**
   * Parse natural language command into structured action
   */
  async parseCommand(
    command: string,
    channel: TextChannel
  ): Promise<StructuredAction | null> {
    console.log(`\n🔍 ===== PARSING COMPLEX COMMAND =====`);
    console.log(`📝 Command: "${command}"`);

    const prompt = `You are a command parser for a Discord moderation bot. Parse the user's natural language command into a structured JSON action.

USER COMMAND: "${command}"

Parse this into a JSON object with the following structure:

{
  "action": "bulk_delete" | "ban" | "timeout" | "warn" | "analyze" | "kick" | "mute" | "delete_channel" | "create_channel",
  "scope": {
    "type": "messages" | "users" | "channels",
    "count": number (optional),
    "timeRange": number in milliseconds (optional),
    "channelName": string (optional, for channel operations)
  },
  "filters": {
    "contentType": ["fud", "toxic", "scam", "spam", "negative", "positive"] (optional),
    "toxicityThreshold": 0-1 (optional),
    "keywords": string[] (optional),
    "duplicate": boolean (optional, for finding duplicate channels)
  },
  "parameters": {
    "duration": number in milliseconds (optional, for timeout/mute),
    "reason": string (optional),
    "deleteMessages": boolean (optional, for ban)
  },
  "confidence": 0-1,
  "originalCommand": "${command}"
}

EXAMPLES:

1. "delete last 20 messages that contain FUD"
{
  "action": "bulk_delete",
  "scope": {"type": "messages", "count": 20},
  "filters": {"contentType": ["fud"]},
  "confidence": 0.95,
  "originalCommand": "delete last 20 messages that contain FUD"
}

2. "ban users who posted scam links"
{
  "action": "ban",
  "scope": {"type": "users"},
  "filters": {"contentType": ["scam"]},
  "parameters": {"deleteMessages": true, "reason": "Posted scam links"},
  "confidence": 0.9,
  "originalCommand": "ban users who posted scam links"
}

3. "timeout members with toxic messages for 10 minutes"
{
  "action": "timeout",
  "scope": {"type": "users"},
  "filters": {"contentType": ["toxic"]},
  "parameters": {"duration": 600000, "reason": "Toxic behavior"},
  "confidence": 0.92,
  "originalCommand": "timeout members with toxic messages for 10 minutes"
}

4. "delete last 50 FUD messages"
{
  "action": "bulk_delete",
  "scope": {"type": "messages", "count": 50},
  "filters": {"contentType": ["fud"]},
  "confidence": 0.93,
  "originalCommand": "delete last 50 FUD messages"
}

5. "delete one of the duplicate gaming channels"
{
  "action": "delete_channel",
  "scope": {"type": "channels", "channelName": "gaming"},
  "filters": {"duplicate": true},
  "parameters": {"reason": "Removing duplicate channel"},
  "confidence": 0.88,
  "originalCommand": "delete one of the duplicate gaming channels"
}

IMPORTANT:
- Only return valid JSON, nothing else
- If command is unclear, set confidence < 0.5
- For time durations: 1 min = 60000ms, 1 hour = 3600000ms, 1 day = 86400000ms
- For "FUD" or "fear, uncertainty, doubt", use contentType: ["fud"]
- For "toxic" or "negative", use contentType: ["toxic"] or ["negative"]
- For "scam" or "phishing", use contentType: ["scam"]

Your JSON response:`;

    try {
      const response = await this.llm.generate(
        prompt,
        'You are a precise JSON parser. Only output valid JSON.',
        { temperature: 0.2, maxTokens: 500 }
      );

      console.log(`📨 LLM raw response: "${response}"`);

      // Clean the response - extract JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log(`❌ No JSON found in response`);
        return null;
      }

      const parsed: StructuredAction = JSON.parse(jsonMatch[0]);

      console.log(`✅ Parsed action:`);
      console.log(`   Action: ${parsed.action}`);
      console.log(`   Scope: ${parsed.scope.type} (count: ${parsed.scope.count || 'all'})`);
      console.log(`   Filters: ${JSON.stringify(parsed.filters || {})}`);
      console.log(`   Confidence: ${(parsed.confidence * 100).toFixed(0)}%`);
      console.log(`========================================\n`);

      // Validate confidence
      if (parsed.confidence < 0.5) {
        console.log(`⚠️ Low confidence (${parsed.confidence}), rejecting parse`);
        return null;
      }

      return parsed;

    } catch (error) {
      console.error('❌ Command parsing error:', error);
      return null;
    }
  }

  /**
   * Execute structured action
   */
  async executeStructuredAction(
    action: StructuredAction,
    channel: TextChannel,
    requesterId: string
  ): Promise<{ success: boolean; message: string; affectedCount: number }> {
    console.log(`\n⚡ ===== EXECUTING STRUCTURED ACTION =====`);
    console.log(`🎯 Action: ${action.action}`);
    console.log(`📊 Scope: ${action.scope.type} (${action.scope.count || 'all'})`);
    console.log(`🔍 Filters: ${JSON.stringify(action.filters || {})}`);

    try {
      if (action.action === 'bulk_delete' && action.scope.type === 'messages') {
        return await this.executeFilteredBulkDelete(action, channel, requesterId);
      }

      if (action.action === 'ban' && action.scope.type === 'users') {
        return await this.executeFilteredBan(action, channel, requesterId);
      }

      if (action.action === 'timeout' && action.scope.type === 'users') {
        return await this.executeFilteredTimeout(action, channel, requesterId);
      }

      if (action.action === 'delete_channel' && action.scope.type === 'channels') {
        return await this.executeChannelDeletion(action, channel, requesterId);
      }

      return {
        success: false,
        message: `Action "${action.action}" with scope "${action.scope.type}" not yet implemented`,
        affectedCount: 0
      };

    } catch (error: any) {
      console.error(`❌ Execution error:`, error);
      return {
        success: false,
        message: `Execution failed: ${error.message}`,
        affectedCount: 0
      };
    }
  }

  /**
   * Execute bulk delete with filters
   */
  private async executeFilteredBulkDelete(
    action: StructuredAction,
    channel: TextChannel,
    requesterId: string
  ): Promise<{ success: boolean; message: string; affectedCount: number }> {
    const fetchCount = Math.min(action.scope.count || 100, 100);

    console.log(`📥 Fetching last ${fetchCount} messages...`);
    const messages = await channel.messages.fetch({ limit: fetchCount });

    console.log(`🔍 Filtering ${messages.size} messages...`);
    const messagesToDelete = [];

    for (const [id, msg] of messages) {
      // Skip bot's own messages and the command message
      if (msg.author.bot) continue;

      // Apply filters
      if (action.filters) {
        const shouldDelete = await this.messageMatchesFilters(msg, action.filters);
        if (shouldDelete) {
          messagesToDelete.push(msg);
        }
      } else {
        // No filters = delete all
        messagesToDelete.push(msg);
      }
    }

    console.log(`🗑️ Deleting ${messagesToDelete.length} filtered messages...`);

    // Filter messages older than 14 days (Discord limitation)
    const twoWeeksAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
    const recentMessages = messagesToDelete.filter(m => m.createdTimestamp > twoWeeksAgo);

    if (recentMessages.length === 0) {
      return {
        success: false,
        message: 'No messages matched the filters (or all are older than 14 days)',
        affectedCount: 0
      };
    }

    await channel.bulkDelete(recentMessages, true);

    const filterDesc = this.describeFilters(action.filters);
    return {
      success: true,
      message: `Deleted ${recentMessages.length} messages${filterDesc}`,
      affectedCount: recentMessages.length
    };
  }

  /**
   * Execute ban with filters
   */
  private async executeFilteredBan(
    action: StructuredAction,
    channel: TextChannel,
    requesterId: string
  ): Promise<{ success: boolean; message: string; affectedCount: number }> {
    // Fetch recent messages to find violating users
    const messages = await channel.messages.fetch({ limit: 100 });
    const violators = new Set<string>();

    for (const [id, msg] of messages) {
      if (msg.author.bot) continue;

      if (action.filters) {
        const matches = await this.messageMatchesFilters(msg, action.filters);
        if (matches) {
          violators.add(msg.author.id);
        }
      }
    }

    console.log(`🚨 Found ${violators.size} violating users to ban`);

    let bannedCount = 0;
    const reason = action.parameters?.reason || 'Violated community guidelines';

    for (const userId of violators) {
      try {
        const member = await channel.guild.members.fetch(userId);
        await member.ban({
          reason,
          deleteMessageSeconds: action.parameters?.deleteMessages ? 86400 : 0 // Last 24h
        });
        bannedCount++;
        console.log(`✅ Banned user ${userId}`);
      } catch (error: any) {
        console.error(`❌ Failed to ban ${userId}:`, error.message);
      }
    }

    const filterDesc = this.describeFilters(action.filters);
    return {
      success: bannedCount > 0,
      message: `Banned ${bannedCount} user(s)${filterDesc}`,
      affectedCount: bannedCount
    };
  }

  /**
   * Execute timeout with filters
   */
  private async executeFilteredTimeout(
    action: StructuredAction,
    channel: TextChannel,
    requesterId: string
  ): Promise<{ success: boolean; message: string; affectedCount: number }> {
    const messages = await channel.messages.fetch({ limit: 100 });
    const violators = new Set<string>();

    for (const [id, msg] of messages) {
      if (msg.author.bot) continue;

      if (action.filters) {
        const matches = await this.messageMatchesFilters(msg, action.filters);
        if (matches) {
          violators.add(msg.author.id);
        }
      }
    }

    console.log(`⏱️ Found ${violators.size} violating users to timeout`);

    let timedOutCount = 0;
    const duration = action.parameters?.duration || 600000; // Default 10 minutes
    const reason = action.parameters?.reason || 'Violated community guidelines';

    for (const userId of violators) {
      try {
        const member = await channel.guild.members.fetch(userId);
        await member.timeout(duration, reason);
        timedOutCount++;
        console.log(`✅ Timed out user ${userId} for ${duration / 60000} minutes`);
      } catch (error: any) {
        console.error(`❌ Failed to timeout ${userId}:`, error.message);
      }
    }

    const filterDesc = this.describeFilters(action.filters);
    const durationMin = Math.round(duration / 60000);
    return {
      success: timedOutCount > 0,
      message: `Timed out ${timedOutCount} user(s) for ${durationMin} minutes${filterDesc}`,
      affectedCount: timedOutCount
    };
  }

  /**
   * Check if message matches filters using AI analysis
   */
  private async messageMatchesFilters(
    message: Message,
    filters: StructuredAction['filters']
  ): Promise<boolean> {
    if (!filters || Object.keys(filters).length === 0) {
      return true; // No filters = match all
    }

    const content = message.content;

    // Keyword filter
    if (filters.keywords) {
      const hasKeyword = filters.keywords.some(kw =>
        content.toLowerCase().includes(kw.toLowerCase())
      );
      if (!hasKeyword) return false;
    }

    // Content type filter (FUD, toxic, scam, etc.)
    if (filters.contentType && filters.contentType.length > 0) {
      const matchesType = await this.checkContentType(content, filters.contentType);
      if (!matchesType) return false;
    }

    return true;
  }

  /**
   * Execute channel deletion with duplicate detection
   */
  private async executeChannelDeletion(
    action: StructuredAction,
    currentChannel: TextChannel,
    requesterId: string
  ): Promise<{ success: boolean; message: string; affectedCount: number }> {
    const guild = currentChannel.guild;
    const channelName = action.scope.channelName;

    if (!channelName) {
      return {
        success: false,
        message: 'No channel name specified for deletion',
        affectedCount: 0
      };
    }

    console.log(`🔍 Finding channels matching: ${channelName}`);

    // Find all channels with similar names
    const matchingChannels = guild.channels.cache.filter(ch =>
      ch.isTextBased() &&
      ch.name.toLowerCase().includes(channelName.toLowerCase())
    );

    console.log(`📋 Found ${matchingChannels.size} matching channels`);

    if (matchingChannels.size === 0) {
      return {
        success: false,
        message: `No channels found matching "${channelName}"`,
        affectedCount: 0
      };
    }

    if (matchingChannels.size === 1) {
      return {
        success: false,
        message: `Only one channel found with name "${channelName}" - not a duplicate`,
        affectedCount: 0
      };
    }

    // Find duplicate (pick one that's NOT the current channel if possible)
    const channelToDelete = matchingChannels.find(ch => ch.id !== currentChannel.id) || matchingChannels.first();

    if (!channelToDelete) {
      return {
        success: false,
        message: 'Could not determine which channel to delete',
        affectedCount: 0
      };
    }

    try {
      const channelNameToDelete = channelToDelete.name;
      await channelToDelete.delete(action.parameters?.reason || 'Duplicate channel removed');

      console.log(`✅ Deleted duplicate channel: ${channelNameToDelete}`);

      return {
        success: true,
        message: `Deleted duplicate channel #${channelNameToDelete}`,
        affectedCount: 1
      };
    } catch (error: any) {
      console.error(`❌ Failed to delete channel:`, error.message);
      return {
        success: false,
        message: `Failed to delete channel: ${error.message}`,
        affectedCount: 0
      };
    }
  }

  /**
   * AI-powered content type detection
   */
  private async checkContentType(
    content: string,
    types: string[]
  ): Promise<boolean> {
    const prompt = `Analyze this Discord message and determine if it contains any of these content types: ${types.join(', ')}

MESSAGE: "${content}"

CONTENT TYPE DEFINITIONS:
- FUD: Fear, Uncertainty, Doubt - spreading panic, negativity about projects/people
- toxic: Hate speech, insults, harassment, aggressive language
- scam: Phishing links, fake giveaways, "free nitro" scams
- spam: Repetitive messages, excessive advertisements
- negative: Generally negative sentiment or pessimism
- positive: Encouraging, supportive, optimistic content

Does this message contain ANY of: ${types.join(', ')}?

Respond with ONLY: YES or NO`;

    try {
      const response = await this.llm.generate(
        prompt,
        'You are a content classifier. Respond with only YES or NO.',
        { temperature: 0.3, maxTokens: 10 }
      );

      const decision = response.trim().toUpperCase();
      return decision.includes('YES');
    } catch (error) {
      console.error('Content type check error:', error);
      return false; // Default to not matching on error
    }
  }

  /**
   * Describe filters in human-readable format
   */
  private describeFilters(filters?: StructuredAction['filters']): string {
    if (!filters || Object.keys(filters).length === 0) {
      return '';
    }

    const parts: string[] = [];

    if (filters.contentType && filters.contentType.length > 0) {
      parts.push(`containing ${filters.contentType.join(', ')}`);
    }

    if (filters.keywords && filters.keywords.length > 0) {
      parts.push(`with keywords: ${filters.keywords.join(', ')}`);
    }

    if (filters.toxicityThreshold !== undefined) {
      parts.push(`toxicity > ${(filters.toxicityThreshold * 100).toFixed(0)}%`);
    }

    return parts.length > 0 ? ` (${parts.join('; ')})` : '';
  }
}
