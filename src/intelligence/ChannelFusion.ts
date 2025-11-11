import { Guild, TextChannel, Message, Collection } from 'discord.js';
import { StorageService } from '../services/StorageService';

/**
 * CHANNEL FUSION - Merge Channels & Migrate Messages
 *
 * This system handles complex channel operations:
 * - Merge multiple channels into one
 * - Migrate all messages (chronologically sorted)
 * - Create backups before deletion
 * - Update server maps after operations
 *
 * Example: "merge #gaming with #gaming-2"
 */

export interface ChannelBackup {
  channelId: string;
  channelName: string;
  messages: Array<{
    id: string;
    content: string;
    authorId: string;
    authorName: string;
    timestamp: Date;
    attachments: string[];
    embeds: any[];
  }>;
  createdAt: Date;
}

export interface MergeResult {
  success: boolean;
  targetChannel: string;
  sourceChannels: string[];
  messagesMigrated: number;
  backupCreated: boolean;
  errors: string[];
}

export class ChannelFusion {
  private storage: StorageService;
  private backups: Map<string, ChannelBackup> = new Map();

  constructor(storage: StorageService) {
    this.storage = storage;
    console.log('🔄 ChannelFusion initialized - AI can merge and migrate channels');
  }

  /**
   * Merge multiple channels into one target channel
   */
  async mergeChannels(
    guild: Guild,
    targetChannelId: string,
    sourceChannelIds: string[],
    options?: {
      deleteSource?: boolean;
      createBackup?: boolean;
      sortByTimestamp?: boolean;
    }
  ): Promise<MergeResult> {
    const opts = {
      deleteSource: true,
      createBackup: true,
      sortByTimestamp: true,
      ...options
    };

    const result: MergeResult = {
      success: false,
      targetChannel: '',
      sourceChannels: [],
      messagesMigrated: 0,
      backupCreated: false,
      errors: []
    };

    try {
      // Get target channel
      const targetChannel = guild.channels.cache.get(targetChannelId) as TextChannel;
      if (!targetChannel || !targetChannel.isTextBased()) {
        result.errors.push('Target channel not found or not a text channel');
        return result;
      }

      result.targetChannel = targetChannel.name;

      console.log(`\n🔄 ===== CHANNEL FUSION: Merging into #${targetChannel.name} =====`);

      // Collect all messages from all source channels
      const allMessages: Array<{
        message: Message;
        channelName: string;
      }> = [];

      for (const sourceId of sourceChannelIds) {
        const sourceChannel = guild.channels.cache.get(sourceId) as TextChannel;
        if (!sourceChannel || !sourceChannel.isTextBased()) {
          result.errors.push(`Source channel ${sourceId} not found or not a text channel`);
          continue;
        }

        result.sourceChannels.push(sourceChannel.name);

        console.log(`📥 Fetching messages from #${sourceChannel.name}...`);

        // Create backup if requested
        if (opts.createBackup) {
          await this.createBackup(sourceChannel);
          result.backupCreated = true;
        }

        // Fetch all messages (paginated)
        const messages = await this.fetchAllMessages(sourceChannel);
        console.log(`  Found ${messages.size} messages in #${sourceChannel.name}`);

        messages.forEach(msg => {
          allMessages.push({
            message: msg,
            channelName: sourceChannel.name
          });
        });
      }

      // Sort messages by timestamp if requested
      if (opts.sortByTimestamp) {
        allMessages.sort((a, b) =>
          a.message.createdTimestamp - b.message.createdTimestamp
        );
      }

      console.log(`\n📤 Migrating ${allMessages.length} messages to #${targetChannel.name}...`);

      // Migrate messages to target channel
      let migratedCount = 0;
      const batchSize = 10;

      for (let i = 0; i < allMessages.length; i += batchSize) {
        const batch = allMessages.slice(i, i + batchSize);

        for (const { message, channelName } of batch) {
          try {
            // Format migrated message
            const migratedContent = this.formatMigratedMessage(
              message,
              channelName
            );

            await targetChannel.send(migratedContent);
            migratedCount++;

            // Rate limiting
            await this.sleep(500);
          } catch (error) {
            result.errors.push(`Failed to migrate message ${message.id}: ${error}`);
          }
        }

        console.log(`  Progress: ${migratedCount}/${allMessages.length}`);
      }

      result.messagesMigrated = migratedCount;

      // Delete source channels if requested
      if (opts.deleteSource) {
        console.log(`\n🗑️ Deleting source channels...`);

        for (const sourceId of sourceChannelIds) {
          try {
            const sourceChannel = guild.channels.cache.get(sourceId);
            if (sourceChannel) {
              await sourceChannel.delete('Merged into another channel');
              console.log(`  ✅ Deleted #${sourceChannel.name}`);
            }
          } catch (error) {
            result.errors.push(`Failed to delete channel ${sourceId}: ${error}`);
          }
        }
      }

      result.success = result.errors.length === 0;
      console.log(`\n✅ Channel fusion complete: ${migratedCount} messages migrated`);

      return result;

    } catch (error) {
      result.errors.push(`Channel fusion failed: ${error}`);
      console.error('Channel fusion error:', error);
      return result;
    }
  }

  /**
   * Fetch all messages from a channel (handles pagination)
   */
  private async fetchAllMessages(channel: TextChannel): Promise<Collection<string, Message>> {
    const allMessages = new Collection<string, Message>();
    let lastId: string | undefined;

    try {
      while (true) {
        const options: any = { limit: 100 };
        if (lastId) {
          options.before = lastId;
        }

        const messages = await channel.messages.fetch(options);

        // Check if Collection or single Message
        if (messages instanceof Collection) {
          if (messages.size === 0) break;
          messages.forEach((msg: Message) => allMessages.set(msg.id, msg));
          lastId = messages.last()?.id;
        } else {
          // Single message fetch
          break;
        }

        // Rate limiting
        await this.sleep(1000);
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
    }

    return allMessages;
  }

  /**
   * Create backup of channel before deletion
   */
  private async createBackup(channel: TextChannel): Promise<void> {
    console.log(`💾 Creating backup of #${channel.name}...`);

    const messages = await this.fetchAllMessages(channel);

    const backup: ChannelBackup = {
      channelId: channel.id,
      channelName: channel.name,
      messages: messages.map(msg => ({
        id: msg.id,
        content: msg.content,
        authorId: msg.author.id,
        authorName: msg.author.username,
        timestamp: msg.createdAt,
        attachments: msg.attachments.map(att => att.url),
        embeds: msg.embeds.map(embed => embed.toJSON())
      })),
      createdAt: new Date()
    };

    this.backups.set(channel.id, backup);

    // Save to disk
    await this.storage.save(
      `backup_${channel.id}_${Date.now()}.json`,
      backup
    );

    console.log(`  ✅ Backup created: ${messages.size} messages saved`);
  }

  /**
   * Format migrated message with source info
   */
  private formatMigratedMessage(message: Message, sourceChannelName: string): string {
    const timestamp = message.createdAt.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    let content = `**[Migrated from #${sourceChannelName}]** | **${message.author.username}** | ${timestamp}\n`;
    content += message.content;

    // Add attachments
    if (message.attachments.size > 0) {
      content += '\n\n**Attachments:**\n';
      message.attachments.forEach(att => {
        content += `${att.url}\n`;
      });
    }

    return content;
  }

  /**
   * Find duplicate channels (same name or similar purpose)
   */
  findDuplicateChannels(
    guild: Guild,
    channelName: string
  ): TextChannel[] {
    const normalizedName = channelName.toLowerCase().replace(/[-_\s]/g, '');

    return guild.channels.cache
      .filter(ch => {
        if (!ch.isTextBased() || ch.type !== 0) return false;

        const chName = ch.name.toLowerCase().replace(/[-_\s]/g, '');

        // Exact match or contains the name
        return chName === normalizedName ||
               chName.includes(normalizedName) ||
               normalizedName.includes(chName);
      })
      .map(ch => ch as TextChannel);
  }

  /**
   * Get backup for a channel
   */
  getBackup(channelId: string): ChannelBackup | undefined {
    return this.backups.get(channelId);
  }

  /**
   * List all backups
   */
  listBackups(): ChannelBackup[] {
    return Array.from(this.backups.values());
  }

  /**
   * Sleep helper for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Restore channel from backup
   */
  async restoreFromBackup(
    guild: Guild,
    backupId: string,
    newChannelName?: string
  ): Promise<{ success: boolean; channelId?: string; error?: string }> {
    const backup = this.backups.get(backupId);
    if (!backup) {
      return { success: false, error: 'Backup not found' };
    }

    try {
      // Create new channel
      const channelName = newChannelName || `restored-${backup.channelName}`;
      const newChannel = await guild.channels.create({
        name: channelName,
        type: 0 // Text channel
      });

      console.log(`📤 Restoring ${backup.messages.length} messages to #${channelName}...`);

      // Restore messages
      for (const msg of backup.messages) {
        try {
          const content = `**${msg.authorName}** | ${new Date(msg.timestamp).toLocaleString()}\n${msg.content}`;
          await newChannel.send(content);
          await this.sleep(500);
        } catch (error) {
          console.error('Error restoring message:', error);
        }
      }

      console.log(`✅ Channel restored: #${channelName}`);
      return { success: true, channelId: newChannel.id };

    } catch (error) {
      return { success: false, error: `Restore failed: ${error}` };
    }
  }
}
