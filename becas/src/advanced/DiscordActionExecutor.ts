import {
  Guild,
  GuildChannel,
  Role,
  GuildMember,
  TextChannel,
  VoiceChannel,
  ChannelType,
  PermissionFlagsBits,
  Collection,
  Message,
} from 'discord.js';
import { ParsedAction } from './NaturalLanguageActionParser';
import { createLogger } from '../services/Logger';

const logger = createLogger('DiscordExecutor');

export interface ExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  message: string;
}

export class DiscordActionExecutor {
  /**
   * Execute parsed action on Discord
   */
  async execute(action: ParsedAction, guild: Guild, executorId: string): Promise<ExecutionResult> {
    logger.info(`Executing action: ${action.action}`, { parameters: action.parameters });

    try {
      switch (action.action) {
        case 'create_channel':
          return await this.createChannel(guild, action.parameters);

        case 'delete_channel':
          return await this.deleteChannel(guild, action.parameters);

        case 'create_role':
          return await this.createRole(guild, action.parameters);

        case 'assign_role':
          return await this.assignRole(guild, action.parameters);

        case 'remove_role':
          return await this.removeRole(guild, action.parameters);

        case 'delete_role':
          return await this.deleteRole(guild, action.parameters);

        case 'kick_member':
          return await this.kickMember(guild, action.parameters);

        case 'ban_member':
          return await this.banMember(guild, action.parameters);

        case 'timeout_member':
          return await this.timeoutMember(guild, action.parameters);

        case 'remove_timeout':
          return await this.removeTimeout(guild, action.parameters);

        case 'create_thread':
          return await this.createThread(guild, action.parameters);

        case 'delete_messages':
          return await this.deleteMessages(guild, action.parameters);

        case 'pin_message':
          return await this.pinMessage(guild, action.parameters);

        case 'send_message':
          return await this.sendMessage(guild, action.parameters);

        case 'change_nickname':
          return await this.changeNickname(guild, action.parameters);

        case 'create_invite':
          return await this.createInvite(guild, action.parameters);

        case 'modify_permissions':
          return await this.modifyPermissions(guild, action.parameters);

        case 'change_server_name':
          return await this.changeServerName(guild, action.parameters);

        case 'lock_channel':
          return await this.lockChannel(guild, action.parameters);

        case 'unlock_channel':
          return await this.unlockChannel(guild, action.parameters);

        case 'archive_channel':
          return await this.archiveChannel(guild, action.parameters);

        case 'slowmode':
          return await this.setSlowmode(guild, action.parameters);

        default:
          return {
            success: false,
            error: `Unknown action: ${action.action}`,
            message: `I don't know how to ${action.action}`,
          };
      }
    } catch (error: any) {
      logger.error(`Failed to execute ${action.action}`, error);
      return {
        success: false,
        error: error.message,
        message: `Something went wrong: ${error.message}`,
      };
    }
  }

  /**
   * Create a channel
   */
  private async createChannel(guild: Guild, params: any): Promise<ExecutionResult> {
    const name = params.name || 'new-channel';
    const type = this.parseChannelType(params.channelType || 'text');

    const channel = await guild.channels.create({
      name,
      type: type as any, // Discord.js type narrowing issue
      reason: params.reason || 'Created by Becas',
    });

    logger.info(`Created channel: ${name}`, { channelId: channel.id });

    return {
      success: true,
      result: channel,
      message: `Created ${type === ChannelType.GuildVoice ? 'voice' : 'text'} channel #${name}`,
    };
  }

  /**
   * Delete a channel
   */
  private async deleteChannel(guild: Guild, params: any): Promise<ExecutionResult> {
    const channelId = this.extractId(params.target);
    if (!channelId) {
      return { success: false, error: 'No channel specified', message: 'Which channel?' };
    }

    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      return { success: false, error: 'Channel not found', message: 'Channel not found' };
    }

    const channelName = channel.name;
    await channel.delete(params.reason || 'Deleted by Becas');

    logger.info(`Deleted channel: ${channelName}`, { channelId });

    return {
      success: true,
      message: `Deleted #${channelName}`,
    };
  }

  /**
   * Create a role
   */
  private async createRole(guild: Guild, params: any): Promise<ExecutionResult> {
    const name = params.name || 'New Role';
    const color = params.color;
    const permissions = params.permissions || [];

    const role = await guild.roles.create({
      name,
      color: color as any,
      permissions: permissions.map((p: string) => PermissionFlagsBits[p as keyof typeof PermissionFlagsBits]),
      reason: params.reason || 'Created by Becas',
    });

    logger.info(`Created role: ${name}`, { roleId: role.id });

    return {
      success: true,
      result: role,
      message: `Created role @${name}`,
    };
  }

  /**
   * Assign role to member
   */
  private async assignRole(guild: Guild, params: any): Promise<ExecutionResult> {
    const member = this.getMemberFromTarget(guild, params.target);
    const roleName = params.name;

    if (!member) {
      return { success: false, error: 'Member not found', message: 'I couldn\'t find that user. Try using their exact username or mentioning them.' };
    }

    // Find role by name or ID
    let role: Role | undefined;
    const roleId = this.extractId(params.role || params.name);
    if (roleId) {
      role = guild.roles.cache.get(roleId);
    } else if (roleName) {
      role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    }

    if (!role) {
      return { success: false, error: 'Role not found', message: `Role "${roleName}" not found` };
    }

    await member.roles.add(role, params.reason || 'Assigned by Becas');

    logger.info(`Assigned role ${role.name} to ${member.user.username}`);

    return {
      success: true,
      message: `Gave @${member.user.username} the @${role.name} role`,
    };
  }

  /**
   * Remove role from member
   */
  private async removeRole(guild: Guild, params: any): Promise<ExecutionResult> {
    const member = this.getMemberFromTarget(guild, params.target);
    const roleName = params.name;

    if (!member) {
      return { success: false, error: 'Member not found', message: 'I couldn\'t find that user. Try using their exact username or mentioning them.' };
    }

    let role: Role | undefined;
    const roleId = this.extractId(params.role || params.name);
    if (roleId) {
      role = guild.roles.cache.get(roleId);
    } else if (roleName) {
      role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    }

    if (!role) {
      return { success: false, error: 'Role not found', message: `Role "${roleName}" not found` };
    }

    await member.roles.remove(role, params.reason || 'Removed by Becas');

    logger.info(`Removed role ${role.name} from ${member.user.username}`);

    return {
      success: true,
      message: `Removed @${role.name} from @${member.user.username}`,
    };
  }

  /**
   * Delete a role
   */
  private async deleteRole(guild: Guild, params: any): Promise<ExecutionResult> {
    const roleId = this.extractId(params.target || params.role);
    const roleName = params.name;

    let role: Role | undefined;
    if (roleId) {
      role = guild.roles.cache.get(roleId);
    } else if (roleName) {
      role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
    }

    if (!role) {
      return { success: false, error: 'Role not found', message: 'Role not found' };
    }

    const name = role.name;
    await role.delete(params.reason || 'Deleted by Becas');

    logger.info(`Deleted role: ${name}`);

    return {
      success: true,
      message: `Deleted role @${name}`,
    };
  }

  /**
   * Kick member
   */
  private async kickMember(guild: Guild, params: any): Promise<ExecutionResult> {
    const member = this.getMemberFromTarget(guild, params.target);
    if (!member) {
      return { success: false, error: 'Member not found', message: 'I couldn\'t find that user. Try using their exact username or mentioning them.' };
    }

    if (!member.kickable) {
      return { success: false, error: 'Cannot kick member', message: 'Their role is too high for me to kick' };
    }

    const username = member.user.username;
    await member.kick(params.reason || 'Kicked by Becas');

    logger.info(`Kicked ${username}`);

    return {
      success: true,
      message: `Kicked @${username}`,
    };
  }

  /**
   * Ban member
   */
  private async banMember(guild: Guild, params: any): Promise<ExecutionResult> {
    const member = this.getMemberFromTarget(guild, params.target);
    if (!member) {
      // Try banning by user ID (works even if not in server)
      const userId = this.extractId(params.target);
      if (userId) {
        try {
          await guild.members.ban(userId, { reason: params.reason || 'Banned by Becas' });
          logger.info(`Banned user ${userId}`);
          return {
            success: true,
            message: `Banned user`,
          };
        } catch (error) {
          return { success: false, error: 'Cannot ban user', message: 'Failed to ban user' };
        }
      }
      return { success: false, error: 'Member not found', message: 'I couldn\'t find that user. Try using their exact username or mentioning them.' };
    }

    if (!member.bannable) {
      return { success: false, error: 'Cannot ban member', message: 'Their role is too high for me to ban' };
    }

    const username = member.user.username;
    await member.ban({ reason: params.reason || 'Banned by Becas' });

    logger.info(`Banned ${username}`);

    return {
      success: true,
      message: `Banned @${username}`,
    };
  }

  /**
   * Timeout member
   */
  private async timeoutMember(guild: Guild, params: any): Promise<ExecutionResult> {
    const member = this.getMemberFromTarget(guild, params.target);
    if (!member) {
      return { success: false, error: 'Member not found', message: 'I couldn\'t find that user. Try using their exact username or mentioning them.' };
    }

    if (!member.moderatable) {
      return { success: false, error: 'Cannot timeout member', message: 'Their role is too high' };
    }

    const duration = params.duration || 600000; // Default 10 minutes
    await member.timeout(duration, params.reason || 'Timed out by Becas');

    const minutes = Math.floor(duration / 60000);
    logger.info(`Timed out ${member.user.username} for ${minutes} minutes`);

    return {
      success: true,
      message: `Timed out @${member.user.username} for ${minutes} minutes`,
    };
  }

  /**
   * Remove timeout from member
   */
  private async removeTimeout(guild: Guild, params: any): Promise<ExecutionResult> {
    const member = this.getMemberFromTarget(guild, params.target);
    if (!member) {
      return { success: false, error: 'Member not found', message: 'I couldn\'t find that user. Try using their exact username or mentioning them.' };
    }

    // Store username before checking status to avoid type narrowing issues
    const username = member.user.username;

    if (!member.isCommunicationDisabled()) {
      return { success: false, error: 'User not timed out', message: `@${username} isn't timed out` };
    }

    await member.timeout(null, params.reason || 'Timeout removed by Becas');

    logger.info(`Removed timeout from ${username}`);

    return {
      success: true,
      message: `Removed timeout from @${username}`,
    };
  }

  /**
   * Create thread
   */
  private async createThread(guild: Guild, params: any): Promise<ExecutionResult> {
    const channelId = this.extractId(params.channel || params.target);
    if (!channelId) {
      return { success: false, error: 'No channel specified', message: 'Create thread in which channel?' };
    }

    const channel = guild.channels.cache.get(channelId) as TextChannel;
    if (!channel || !channel.isTextBased()) {
      return { success: false, error: 'Invalid channel', message: 'That\'s not a text channel' };
    }

    const name = params.name || params.threadName || 'New Thread';
    const thread = await channel.threads.create({
      name,
      reason: params.reason || 'Created by Becas',
    });

    logger.info(`Created thread: ${name}`);

    return {
      success: true,
      result: thread,
      message: `Created thread "${name}"`,
    };
  }

  /**
   * Delete messages
   */
  private async deleteMessages(guild: Guild, params: any): Promise<ExecutionResult> {
    const channelId = this.extractId(params.channel || params.target);
    if (!channelId) {
      return { success: false, error: 'No channel specified', message: 'Delete messages from which channel?' };
    }

    const channel = guild.channels.cache.get(channelId) as TextChannel;
    if (!channel || !channel.isTextBased()) {
      return { success: false, error: 'Invalid channel', message: 'Invalid channel' };
    }

    const count = params.count || 10;
    const deleted = await channel.bulkDelete(count, true);

    logger.info(`Deleted ${deleted.size} messages from ${channel.name}`);

    return {
      success: true,
      message: `Deleted ${deleted.size} messages`,
    };
  }

  /**
   * Pin message
   */
  private async pinMessage(guild: Guild, params: any): Promise<ExecutionResult> {
    // Would need message reference - simplified for now
    return {
      success: false,
      message: 'Message pinning requires message reference',
    };
  }

  /**
   * Send message to channel
   */
  private async sendMessage(guild: Guild, params: any): Promise<ExecutionResult> {
    const channelId = this.extractId(params.channel || params.target);
    if (!channelId) {
      return { success: false, error: 'No channel specified', message: 'Send to which channel?' };
    }

    const channel = guild.channels.cache.get(channelId) as TextChannel;
    if (!channel || !channel.isTextBased()) {
      return { success: false, error: 'Invalid channel', message: 'Invalid channel' };
    }

    const content = params.content || params.message || 'Message from Becas';
    await channel.send(content);

    logger.info(`Sent message to ${channel.name}`);

    return {
      success: true,
      message: `Sent message to #${channel.name}`,
    };
  }

  /**
   * Change member nickname
   */
  private async changeNickname(guild: Guild, params: any): Promise<ExecutionResult> {
    const member = this.getMemberFromTarget(guild, params.target);
    if (!member) {
      return { success: false, error: 'Member not found', message: 'I couldn\'t find that user. Try using their exact username or mentioning them.' };
    }

    const nickname = params.name || params.nickname;
    await member.setNickname(nickname, params.reason || 'Changed by Becas');

    logger.info(`Changed nickname for ${member.user.username} to ${nickname}`);

    return {
      success: true,
      message: `Changed @${member.user.username}'s nickname to "${nickname}"`,
    };
  }

  /**
   * Create invite
   */
  private async createInvite(guild: Guild, params: any): Promise<ExecutionResult> {
    const channelId = this.extractId(params.channel || params.target);
    const channel = channelId
      ? guild.channels.cache.get(channelId)
      : guild.channels.cache.find(c => c.type === ChannelType.GuildText);

    if (!channel || !('createInvite' in channel)) {
      return { success: false, error: 'Cannot create invite', message: 'No valid channel found' };
    }

    const invite = await channel.createInvite({
      maxAge: params.duration ? params.duration / 1000 : 86400, // Default 24 hours
      maxUses: params.maxUses || 0,
      reason: params.reason || 'Created by Becas',
    });

    logger.info(`Created invite: ${invite.code}`);

    return {
      success: true,
      result: invite,
      message: `Created invite: ${invite.url}`,
    };
  }

  /**
   * Modify channel permissions
   */
  private async modifyPermissions(guild: Guild, params: any): Promise<ExecutionResult> {
    // Simplified - would need more complex permission handling
    return {
      success: false,
      message: 'Permission modification requires more specific details',
    };
  }

  /**
   * Change server name
   */
  private async changeServerName(guild: Guild, params: any): Promise<ExecutionResult> {
    const newName = params.name;
    if (!newName) {
      return { success: false, error: 'No name specified', message: 'What should I name it?' };
    }

    const oldName = guild.name;
    await guild.setName(newName, params.reason || 'Changed by Becas');

    logger.info(`Changed server name from "${oldName}" to "${newName}"`);

    return {
      success: true,
      message: `Changed server name to "${newName}"`,
    };
  }

  /**
   * Lock channel (deny send messages for @everyone)
   */
  private async lockChannel(guild: Guild, params: any): Promise<ExecutionResult> {
    const channelId = this.extractId(params.channel || params.target);
    if (!channelId) {
      return { success: false, error: 'No channel specified', message: 'Lock which channel?' };
    }

    const channel = guild.channels.cache.get(channelId) as TextChannel;
    if (!channel) {
      return { success: false, error: 'Channel not found', message: 'Channel not found' };
    }

    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      SendMessages: false,
    });

    logger.info(`Locked channel: ${channel.name}`);

    return {
      success: true,
      message: `Locked #${channel.name}`,
    };
  }

  /**
   * Unlock channel
   */
  private async unlockChannel(guild: Guild, params: any): Promise<ExecutionResult> {
    const channelId = this.extractId(params.channel || params.target);
    if (!channelId) {
      return { success: false, error: 'No channel specified', message: 'Unlock which channel?' };
    }

    const channel = guild.channels.cache.get(channelId) as TextChannel;
    if (!channel) {
      return { success: false, error: 'Channel not found', message: 'Channel not found' };
    }

    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      SendMessages: null,
    });

    logger.info(`Unlocked channel: ${channel.name}`);

    return {
      success: true,
      message: `Unlocked #${channel.name}`,
    };
  }

  /**
   * Archive channel
   */
  private async archiveChannel(guild: Guild, params: any): Promise<ExecutionResult> {
    const channelId = this.extractId(params.channel || params.target);
    if (!channelId) {
      return { success: false, error: 'No channel specified', message: 'Archive which channel?' };
    }

    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      return { success: false, error: 'Channel not found', message: 'Channel not found' };
    }

    // Move to "Archive" category or rename with [ARCHIVED] prefix
    const name = channel.name.startsWith('[ARCHIVED]') ? channel.name : `[ARCHIVED] ${channel.name}`;
    await channel.setName(name);

    logger.info(`Archived channel: ${channel.name}`);

    return {
      success: true,
      message: `Archived #${channel.name}`,
    };
  }

  /**
   * Set slowmode
   */
  private async setSlowmode(guild: Guild, params: any): Promise<ExecutionResult> {
    const channelId = this.extractId(params.channel || params.target);
    if (!channelId) {
      return { success: false, error: 'No channel specified', message: 'Set slowmode in which channel?' };
    }

    const channel = guild.channels.cache.get(channelId) as TextChannel;
    if (!channel || !channel.isTextBased()) {
      return { success: false, error: 'Invalid channel', message: 'Invalid channel' };
    }

    const seconds = params.count || 5;
    await channel.setRateLimitPerUser(seconds);

    logger.info(`Set slowmode in ${channel.name} to ${seconds} seconds`);

    return {
      success: true,
      message: `Set slowmode in #${channel.name} to ${seconds} seconds`,
    };
  }

  /**
   * Helper: Extract ID from mention or raw ID
   */
  private extractId(mention?: string): string | undefined {
    if (!mention) return undefined;

    // Extract from mention format <@123> or <#123> or <@&123>
    const match = mention.match(/[<@#&!]*(\d+)>/);
    if (match) return match[1];

    // Already an ID
    if (/^\d+$/.test(mention)) return mention;

    return undefined;
  }

  /**
   * Helper: Find user by name (username, nickname, or display name)
   */
  private findUserByName(guild: Guild, searchName: string): GuildMember | undefined {
    const search = searchName.toLowerCase().trim();

    logger.info(`Searching for user: "${searchName}"`);

    // Exact match on username
    let found = guild.members.cache.find((m: GuildMember) =>
      m.user.username.toLowerCase() === search
    );

    if (found) {
      logger.info(`Found exact username match: ${found.user.username}`);
      return found;
    }

    // Exact match on nickname
    found = guild.members.cache.find((m: GuildMember) =>
      m.nickname && m.nickname.toLowerCase() === search
    );

    if (found) {
      logger.info(`Found exact nickname match: ${found.nickname}`);
      return found;
    }

    // Exact match on displayName
    found = guild.members.cache.find((m: GuildMember) =>
      m.displayName.toLowerCase() === search
    );

    if (found) {
      logger.info(`Found exact display name match: ${found.displayName}`);
      return found;
    }

    // Fuzzy match (starts with)
    found = guild.members.cache.find((m: GuildMember) =>
      m.user.username.toLowerCase().startsWith(search) ||
      m.displayName.toLowerCase().startsWith(search) ||
      (m.nickname && m.nickname.toLowerCase().startsWith(search))
    );

    if (found) {
      logger.info(`Found fuzzy match: ${found.user.username}`);
      return found;
    }

    logger.info(`No user found matching "${searchName}"`);
    return undefined;
  }

  /**
   * Helper: Get member from target parameter (ID, mention, or username)
   */
  private getMemberFromTarget(guild: Guild, target?: string): GuildMember | undefined {
    if (!target) return undefined;

    // Try extracting ID first
    const userId = this.extractId(target);
    if (userId) {
      const member = guild.members.cache.get(userId);
      if (member) return member;
    }

    // If not an ID/mention, try searching by name
    // Clean up the target string (remove <@ and > if present)
    const cleanTarget = target.replace(/[<@>!]/g, '').trim();

    // Try to find by full name first
    let found = this.findUserByName(guild, cleanTarget);
    if (found) return found;

    // If full name didn't work, try each word individually
    // This helps with "hosea matthewes aka cainwell" -> searches "hosea", "matthewes", "cainwell" individually
    const words = cleanTarget.split(/\s+/).filter(w => w.length > 2);
    logger.info(`Trying individual words: ${words.join(', ')}`);

    for (const word of words) {
      found = this.findUserByName(guild, word);
      if (found) {
        logger.info(`Found user by word: "${word}" -> ${found.user.username}`);
        return found;
      }
    }

    logger.info(`Could not find user for target: "${target}"`);
    return undefined;
  }

  /**
   * Helper: Parse channel type
   */
  private parseChannelType(type: string): ChannelType {
    switch (type.toLowerCase()) {
      case 'voice':
        return ChannelType.GuildVoice;
      case 'announcement':
      case 'news':
        return ChannelType.GuildAnnouncement;
      case 'forum':
        return ChannelType.GuildForum;
      default:
        return ChannelType.GuildText;
    }
  }
}
