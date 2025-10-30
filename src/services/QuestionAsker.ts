/**
 * QUESTION ASKER - Ask Moderators for Missing Parameters
 *
 * Generates natural language questions when parameters are missing.
 * Waits for moderator response and extracts the value.
 */

import { Message, EmbedBuilder, TextChannel } from 'discord.js';
import { createLogger } from './Logger';
import { CommandParameter } from '../commands/CommandDictionary';
import { ContextResolver } from './ContextResolver';

const logger = createLogger('QuestionAsker');

export interface QuestionResponse {
  answered: boolean;
  value: any;
  rawResponse: string;
}

export class QuestionAsker {
  constructor(private contextResolver: ContextResolver) {}

  /**
   * Ask moderator for a missing parameter
   */
  async askForParameter(
    channel: TextChannel,
    parameter: CommandParameter,
    commandIntent: string
  ): Promise<Message> {
    const question = this.generateQuestion(parameter, commandIntent);

    const embed = new EmbedBuilder()
      .setTitle('❓ Missing Information')
      .setDescription(question)
      .setColor(0x3498db) // Blue
      .addFields({
        name: 'Expected',
        value: this.getExpectedFormat(parameter),
        inline: false
      })
      .setFooter({ text: 'Reply to this message with your answer, or say "cancel" to abort.' })
      .setTimestamp();

    const sentMessage = await channel.send({ embeds: [embed] });
    return sentMessage;
  }

  /**
   * Wait for moderator's response to the question
   */
  async waitForResponse(
    channel: TextChannel,
    moderatorId: string,
    parameter: CommandParameter,
    timeout = 60000
  ): Promise<QuestionResponse> {
    try {
      const filter = (m: Message) => m.author.id === moderatorId;

      const collected = await channel.awaitMessages({
        filter,
        max: 1,
        time: timeout,
        errors: ['time']
      });

      const response = collected.first();
      if (!response) {
        return { answered: false, value: null, rawResponse: '' };
      }

      const content = response.content.trim();

      // Check for cancellation
      if (content.toLowerCase() === 'cancel' || content.toLowerCase() === 'abort') {
        return { answered: false, value: null, rawResponse: content };
      }

      // Extract value based on parameter type
      const value = await this.extractValue(content, parameter);

      return {
        answered: true,
        value,
        rawResponse: content
      };

    } catch (error) {
      // Timeout
      logger.debug('Question timeout', error);
      return { answered: false, value: null, rawResponse: '' };
    }
  }

  /**
   * Generate question text for a parameter
   */
  private generateQuestion(parameter: CommandParameter, commandIntent: string): string {
    switch (parameter.type) {
      case 'user':
        return `Which user should I ${commandIntent}? Please mention them with @username.`;

      case 'duration':
        return `How long should this ${commandIntent} last?`;

      case 'number':
        return `How many ${parameter.name}?`;

      case 'channel':
        return `Which channel should I ${commandIntent}? Please mention with #channel.`;

      case 'role':
        return `Which role? Please mention with @role.`;

      case 'text':
        return `What ${parameter.name}?`;

      default:
        return `Please provide: ${parameter.description}`;
    }
  }

  /**
   * Get expected format hint for a parameter
   */
  private getExpectedFormat(parameter: CommandParameter): string {
    switch (parameter.type) {
      case 'user':
        return 'Example: @username or user ID';

      case 'duration':
        return 'Example: 10m, 1h, 24h, 7d';

      case 'number':
        return 'Example: 5, 10, 100';

      case 'channel':
        return 'Example: #channel-name';

      case 'role':
        return 'Example: @RoleName';

      case 'text':
        return 'Example: Any text';

      default:
        return parameter.description;
    }
  }

  /**
   * Extract value from moderator's response
   */
  private async extractValue(content: string, parameter: CommandParameter): Promise<any> {
    switch (parameter.type) {
      case 'user':
        {
          // Try to extract user mention
          const mentionMatch = content.match(/<@!?(\d+)>/);
          if (mentionMatch) {
            return mentionMatch[1]; // User ID
          }

          // Try to extract raw ID
          const idMatch = content.match(/\d{17,19}/);
          if (idMatch) {
            return idMatch[0];
          }

          return null;
        }

      case 'duration':
        {
          const duration = this.contextResolver.parseTimeExpression(content);
          return duration ? `${duration}ms` : null;
        }

      case 'number':
        {
          return this.contextResolver.parseNumber(content);
        }

      case 'channel':
        {
          // Extract channel mention
          const channelMatch = content.match(/<#(\d+)>/);
          if (channelMatch) {
            return channelMatch[1]; // Channel ID
          }

          return null;
        }

      case 'role':
        {
          // Extract role mention
          const roleMatch = content.match(/<@&(\d+)>/);
          if (roleMatch) {
            return roleMatch[1]; // Role ID
          }

          return null;
        }

      case 'text':
        {
          return content; // Return as-is
        }

      default:
        return content;
    }
  }

  /**
   * Send "Question Expired" message
   */
  async sendExpiredMessage(questionMessage: Message): Promise<void> {
    try {
      const embed = new EmbedBuilder()
        .setTitle('⏱️ Question Timeout')
        .setDescription('No response received. Command cancelled.')
        .setColor(0x95a5a6) // Gray
        .setTimestamp();

      await questionMessage.edit({ embeds: [embed] });
    } catch (error) {
      logger.error('Failed to update expired question', error);
    }
  }
}
