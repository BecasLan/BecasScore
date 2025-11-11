/**
 * ADMIN ACTION ENGINE
 *
 * Handles server administration tasks via natural language:
 * - Create/delete channels
 * - Create/assign roles
 * - Manage permissions
 * - Server configuration
 *
 * This is separate from moderation - it's for server management.
 */

import { Message, Guild, TextChannel, ChannelType, PermissionFlagsBits } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';
import { getSubIntents } from './IntentRegistry';
import { BecasToolRegistry } from '../becasflow/registry/BecasToolRegistry';
import { BecasContext } from '../becasflow/types/BecasFlow.types';

const logger = createLogger('AdminActionEngine');

export class AdminActionEngine {
  private llm: OllamaService;
  private toolRegistry: BecasToolRegistry;

  constructor() {
    this.llm = new OllamaService('cognitive');
    this.toolRegistry = BecasToolRegistry.getInstance();
  }

  /**
   * Process an admin action request
   */
  async processAdminAction(query: string, message: Message): Promise<string> {
    if (!message.guild) {
      return '❌ This command can only be used in a server';
    }

    // Check if user has admin permissions
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      return '❌ You need Administrator permissions to use admin commands';
    }

    // Detect sub-intent
    const subIntent = await this.detectAdminSubIntent(query);
    logger.info(`Admin sub-intent: ${subIntent} for query: ${query}`);

    // Route to appropriate handler
    switch (subIntent) {
      case 'CREATE_CHANNEL':
        return await this.handleCreateChannel(query, message);

      case 'DELETE_CHANNEL':
        return await this.handleDeleteChannel(query, message);

      case 'CREATE_ROLE':
        return await this.handleCreateRole(query, message.guild);

      case 'ASSIGN_ROLE':
        return await this.handleAssignRole(query, message.guild);

      case 'MANAGE_PERMISSIONS':
        return await this.handleManagePermissions(query, message.guild);

      default:
        return '❌ I could not understand the admin action. Try: "create channel named announcements" or "create role called VIP"';
    }
  }

  /**
   * Detect ADMIN_ACTION sub-intent using AI
   */
  private async detectAdminSubIntent(query: string): Promise<string> {
    const subIntents = getSubIntents('ADMIN_ACTION');

    const prompt = `You must classify this query into exactly ONE sub-intent.

Query: "${query}"

Available sub-intents:
${subIntents.map(sub => `- ${sub.name}: ${sub.description}`).join('\n')}

IMPORTANT: Respond with ONLY the sub-intent name in this JSON format:
{"subIntent": "CREATE_CHANNEL"}

Valid values: CREATE_CHANNEL, DELETE_CHANNEL, CREATE_ROLE, ASSIGN_ROLE, MANAGE_PERMISSIONS`;

    try {
      const response = await this.llm.generate(
        prompt,
        'You are a classification AI. Return ONLY valid JSON with the subIntent field.',
        { temperature: 0.0, maxTokens: 30, format: 'json' }
      );

      // Try to parse JSON response
      try {
        const parsed = JSON.parse(response.trim());
        if (parsed.subIntent) {
          const subIntent = parsed.subIntent.toUpperCase();
          const validSubIntents = subIntents.map(s => s.name);
          return validSubIntents.includes(subIntent) ? subIntent : 'UNKNOWN';
        }
      } catch {
        // Fallback: try to extract sub-intent name directly from response
        const subIntent = response.trim().toUpperCase().replace(/[^A-Z_]/g, '');
        const validSubIntents = subIntents.map(s => s.name);
        if (validSubIntents.includes(subIntent)) {
          return subIntent;
        }
      }

      logger.warn(`Could not parse sub-intent from response: ${response}`);
      return 'UNKNOWN';
    } catch (error) {
      logger.error('Sub-intent detection failed:', error);
      return 'UNKNOWN';
    }
  }

  /**
   * Handle CREATE_CHANNEL sub-intent - Delegates to BecasFlow
   */
  private async handleCreateChannel(query: string, message: Message): Promise<string> {
    try {
      // Extract channel name using AI
      const extractionPrompt = `Extract the channel name from this command:

Query: "${query}"

Return ONLY the channel name, nothing else.
If there's no clear name, return "general".

Examples:
"create a channel named announcements" → "announcements"
"make a voice channel called gaming" → "gaming"
"create text channel support" → "support"`;

      const response = await this.llm.generate(
        extractionPrompt,
        'You are a data extraction system. Return only the extracted value.',
        { temperature: 0.1, maxTokens: 20 }
      );

      const channelName = response.trim();

      // Detect if voice or text
      const isVoice = query.toLowerCase().includes('voice');
      const channelType = isVoice ? 'voice' : 'text';

      // Delegate to BecasFlow create_channel tool
      const createChannelTool = this.toolRegistry.get('create_channel');
      if (!createChannelTool) {
        logger.error('create_channel tool not found in registry!');
        return '❌ Internal error: create_channel tool not registered';
      }

      // Build BecasContext (minimal context needed for tool execution)
      // Using 'as any' to bypass full context requirements since we only need Discord objects
      const context = {
        guild: message.guild!,
        channel: message.channel as TextChannel,
        member: message.member!,
        message: message,
        services: {}, // Add services if needed
      } as any as BecasContext;

      // Execute the tool
      const result = await createChannelTool.execute(
        {
          name: channelName,
          type: channelType,
          reason: `Created via admin command: "${query}"`,
        },
        context
      );

      if (result.success) {
        logger.info(`✅ Created ${channelType} channel: ${channelName} via BecasFlow`);
        return `✅ Created ${channelType} channel: <#${result.data.channelId}>`;
      } else {
        logger.error(`❌ Failed to create channel via BecasFlow: ${result.error}`);
        return `❌ Failed to create channel: ${result.error}`;
      }
    } catch (error) {
      logger.error('Failed to create channel:', error);
      return `❌ Failed to create channel: ${error}`;
    }
  }

  /**
   * Handle DELETE_CHANNEL sub-intent
   */
  private async handleDeleteChannel(query: string, message: Message): Promise<string> {
    // Extract channel name or ID
    const extractionPrompt = `Extract the channel to delete from this command:

Query: "${query}"

Return ONLY the channel name or "this" if referring to current channel.

Examples:
"delete the spam channel" → "spam"
"delete channel #old-chat" → "old-chat"
"delete this channel" → "this"`;

    try {
      const response = await this.llm.generate(
        extractionPrompt,
        'You are a data extraction system. Return only the extracted value.',
        { temperature: 0.1, maxTokens: 20 }
      );

      const channelIdentifier = response.trim().toLowerCase();

      // Find channel
      let targetChannel: TextChannel | null = null;

      if (channelIdentifier === 'this') {
        targetChannel = message.channel as TextChannel;
      } else {
        // Find by name
        targetChannel = message.guild!.channels.cache.find(
          ch => ch.name === channelIdentifier && ch.type === ChannelType.GuildText
        ) as TextChannel | undefined || null;
      }

      if (!targetChannel) {
        return `❌ Could not find channel: ${channelIdentifier}`;
      }

      const channelName = targetChannel.name;
      await targetChannel.delete();

      logger.info(`Deleted channel: ${channelName} in ${message.guild!.name}`);
      return `✅ Deleted channel: #${channelName}`;
    } catch (error) {
      logger.error('Failed to delete channel:', error);
      return `❌ Failed to delete channel: ${error}`;
    }
  }

  /**
   * Handle CREATE_ROLE sub-intent
   */
  private async handleCreateRole(query: string, guild: Guild): Promise<string> {
    // Extract role name using AI
    const extractionPrompt = `Extract the role name from this command:

Query: "${query}"

Return ONLY the role name, nothing else.

Examples:
"create a role called VIP" → "VIP"
"make a moderator role" → "Moderator"
"create role with name supporter" → "Supporter"`;

    try {
      const response = await this.llm.generate(
        extractionPrompt,
        'You are a data extraction system. Return only the extracted value.',
        { temperature: 0.1, maxTokens: 20 }
      );

      const roleName = response.trim();

      // Create role
      const newRole = await guild.roles.create({
        name: roleName,
        reason: `Created via Becas AI command`,
      });

      logger.info(`Created role: ${roleName} in ${guild.name}`);
      return `✅ Created role: ${newRole.toString()}`;
    } catch (error) {
      logger.error('Failed to create role:', error);
      return `❌ Failed to create role: ${error}`;
    }
  }

  /**
   * Handle ASSIGN_ROLE sub-intent
   */
  private async handleAssignRole(query: string, guild: Guild): Promise<string> {
    // Extract user and role using AI
    const extractionPrompt = `Extract the user ID and role name from this command:

Query: "${query}"

Return in format: "USER_ID|ROLE_NAME"
If user is mentioned as <@123456>, extract 123456.

Examples:
"give @user the moderator role" → "USER_ID|Moderator"
"assign VIP role to @user" → "USER_ID|VIP"
"remove admin role from @user" → "USER_ID|Admin"`;

    try {
      const response = await this.llm.generate(
        extractionPrompt,
        'You are a data extraction system. Return only the extracted value.',
        { temperature: 0.1, maxTokens: 50 }
      );

      // Parse user mention manually (AI may not extract it correctly)
      const userMatch = query.match(/<@!?(\d+)>/);
      if (!userMatch) {
        return '❌ Please mention the user you want to assign/remove the role from';
      }

      const userId = userMatch[1];
      const [, roleName] = response.split('|');

      // Find member and role
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        return '❌ User not found in this server';
      }

      const role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
      if (!role) {
        return `❌ Role not found: ${roleName}`;
      }

      // Determine if adding or removing
      const isRemove = query.toLowerCase().includes('remove') || query.toLowerCase().includes('take');

      if (isRemove) {
        await member.roles.remove(role);
        logger.info(`Removed role ${role.name} from ${member.user.tag} in ${guild.name}`);
        return `✅ Removed role ${role.toString()} from ${member.toString()}`;
      } else {
        await member.roles.add(role);
        logger.info(`Assigned role ${role.name} to ${member.user.tag} in ${guild.name}`);
        return `✅ Assigned role ${role.toString()} to ${member.toString()}`;
      }
    } catch (error) {
      logger.error('Failed to assign/remove role:', error);
      return `❌ Failed to assign/remove role: ${error}`;
    }
  }

  /**
   * Handle MANAGE_PERMISSIONS sub-intent
   */
  private async handleManagePermissions(query: string, guild: Guild): Promise<string> {
    // This is complex and requires careful permission management
    // For now, return a helpful message
    return `⚠️ Permission management is a complex feature.

For now, please use Discord's native permission settings:
• Right-click channel → Edit Channel → Permissions
• Server Settings → Roles → Edit Role

Natural language permission management coming soon!`;
  }
}
