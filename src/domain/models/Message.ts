/**
 * DOMAIN MODEL: Message
 *
 * Core domain entity representing a Discord message in Becas context.
 * This is the single source of truth for message-related business logic.
 *
 * Design Principles:
 * - Immutable by default
 * - Rich domain model (behavior, not just data)
 * - Self-validating
 * - Framework-agnostic (no Discord.js dependencies)
 */

export interface MessageMetadata {
  hasUrls: boolean;
  hasMentions: boolean;
  hasAttachments: boolean;
  hasEmojis: boolean;
  isReply: boolean;
  replyToId?: string;
  channelType: 'text' | 'voice' | 'dm' | 'thread';
  isEdited: boolean;
  editCount: number;
}

export interface MessageAuthor {
  id: string;
  username: string;
  discriminator?: string;
  isBot: boolean;
  authorityLevel: 'owner' | 'admin' | 'moderator' | 'regular';
}

export interface MessageContext {
  guildId: string;
  channelId: string;
  timestamp: Date;
  locale?: string; // For multi-language support
}

export class Message {
  readonly id: string;
  readonly content: string;
  readonly author: MessageAuthor;
  readonly context: MessageContext;
  readonly metadata: MessageMetadata;

  constructor(
    id: string,
    content: string,
    author: MessageAuthor,
    context: MessageContext,
    metadata: MessageMetadata
  ) {
    this.id = id;
    this.content = content;
    this.author = author;
    this.context = context;
    this.metadata = metadata;

    // Self-validation
    this.validate();
  }

  /**
   * Domain validation rules
   */
  private validate(): void {
    if (!this.id || this.id.length === 0) {
      throw new Error('Message ID cannot be empty');
    }

    if (!this.content || this.content.length === 0) {
      throw new Error('Message content cannot be empty');
    }

    if (this.content.length > 4000) {
      throw new Error('Message content exceeds maximum length (4000 chars)');
    }

    if (!this.author.id) {
      throw new Error('Message author ID cannot be empty');
    }
  }

  /**
   * Business logic: Check if message is a bot command
   */
  isBotCommand(botName: string = 'becas'): boolean {
    const contentLower = this.content.toLowerCase().trim();
    return (
      contentLower.startsWith(`${botName} `) ||
      contentLower.startsWith(`hey ${botName}`) ||
      contentLower.startsWith(`@${botName}`) ||
      contentLower === botName
    );
  }

  /**
   * Business logic: Check if message is from privileged user
   */
  isFromPrivilegedUser(): boolean {
    return ['owner', 'admin', 'moderator'].includes(this.author.authorityLevel);
  }

  /**
   * Business logic: Extract command intent
   */
  extractCommand(botName: string = 'becas'): string | null {
    if (!this.isBotCommand(botName)) return null;

    const contentLower = this.content.toLowerCase().trim();

    // Remove bot mention prefix
    const withoutPrefix = contentLower
      .replace(new RegExp(`^(${botName}|hey ${botName}|@${botName})\\s*`, 'i'), '')
      .trim();

    return withoutPrefix || null;
  }

  /**
   * Business logic: Check if message needs moderation review
   */
  needsModerationReview(): boolean {
    // Bot messages never need moderation
    if (this.author.isBot) return false;

    // Owner/Admin messages with simple queries don't need review
    if (this.isFromPrivilegedUser() && this.content.length < 50 && !this.metadata.hasUrls) {
      return false;
    }

    // Messages with suspicious patterns need review
    if (this.metadata.hasUrls || this.metadata.hasMentions) {
      return true;
    }

    // Default: regular messages need review
    return true;
  }

  /**
   * Create a copy with updated content (for typo correction, etc.)
   */
  withContent(newContent: string): Message {
    return new Message(
      this.id,
      newContent,
      this.author,
      this.context,
      this.metadata
    );
  }

  /**
   * Convert to plain object (for serialization)
   */
  toJSON(): object {
    return {
      id: this.id,
      content: this.content,
      author: this.author,
      context: this.context,
      metadata: this.metadata,
    };
  }

  /**
   * Factory: Create from Discord.js Message object
   */
  static fromDiscordMessage(discordMessage: any): Message {
    // Extract metadata
    const metadata: MessageMetadata = {
      hasUrls: /https?:\/\/|www\./i.test(discordMessage.content),
      hasMentions: /@everyone|@here/i.test(discordMessage.content),
      hasAttachments: (discordMessage.attachments?.size ?? 0) > 0,
      hasEmojis: /<a?:\w+:\d+>/i.test(discordMessage.content),
      isReply: !!discordMessage.reference,
      replyToId: discordMessage.reference?.messageId,
      channelType: discordMessage.channel.isTextBased() ? 'text' : 'voice',
      isEdited: !!discordMessage.editedTimestamp,
      editCount: 0, // Discord doesn't provide this, would need tracking
    };

    // Determine authority level
    let authorityLevel: MessageAuthor['authorityLevel'] = 'regular';
    if (discordMessage.member) {
      if (discordMessage.member.id === discordMessage.guild?.ownerId) {
        authorityLevel = 'owner';
      } else if (discordMessage.member.permissions?.has('Administrator')) {
        authorityLevel = 'admin';
      } else if (
        discordMessage.member.permissions?.has('ModerateMembers') ||
        discordMessage.member.permissions?.has('KickMembers') ||
        discordMessage.member.permissions?.has('BanMembers')
      ) {
        authorityLevel = 'moderator';
      }
    }

    const author: MessageAuthor = {
      id: discordMessage.author.id,
      username: discordMessage.author.username,
      discriminator: discordMessage.author.discriminator,
      isBot: discordMessage.author.bot || false,
      authorityLevel,
    };

    const context: MessageContext = {
      guildId: discordMessage.guild?.id || 'dm',
      channelId: discordMessage.channel.id,
      timestamp: discordMessage.createdAt || new Date(),
      locale: discordMessage.guild?.preferredLocale,
    };

    return new Message(
      discordMessage.id,
      discordMessage.content,
      author,
      context,
      metadata
    );
  }
}
