/**
 * CONFIRMATION UI - Interactive Discord Buttons for Command Confirmation
 *
 * Creates Discord button/reaction UIs for:
 * - Yes/No confirmations
 * - User selection (when multiple candidates)
 * - Bulk action warnings
 *
 * Handles button interactions and updates conversation state.
 */

import {
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ButtonInteraction,
  EmbedBuilder
} from 'discord.js';
import { createLogger } from './Logger';
import { ConversationStateManager } from './ConversationState';
import { ResolutionCandidate } from './ContextResolver';

const logger = createLogger('ConfirmationUI');

export interface ConfirmationOptions {
  message: string; // Main confirmation message
  warningLevel: 'info' | 'warning' | 'danger';
  timeout?: number; // How long to wait for response (default: 60s)
}

export class ConfirmationUI {
  constructor(private conversationState: ConversationStateManager) {}

  /**
   * Ask Yes/No confirmation
   */
  async askYesNo(
    channel: Message['channel'],
    options: ConfirmationOptions
  ): Promise<Message> {
    const { message: text, warningLevel, timeout = 60000 } = options;

    // Create embed
    const embed = new EmbedBuilder()
      .setTitle(this.getEmojiForLevel(warningLevel) + ' Onay Gerekli')
      .setDescription(text)
      .setColor(this.getColorForLevel(warningLevel))
      .setTimestamp();

    // Create buttons
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('confirm_yes')
          .setLabel('✅ Evet')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('confirm_no')
          .setLabel('❌ Hayır')
          .setStyle(ButtonStyle.Danger)
      );

    // Send message
    if ('send' in channel) {
      const sentMessage = await channel.send({
        embeds: [embed],
        components: [row]
      });
      return sentMessage;
    }
    throw new Error('Channel does not support sending messages');
  }

  /**
   * Ask user to select from multiple candidates
   */
  async askUserSelection(
    channel: Message['channel'],
    candidates: ResolutionCandidate[],
    parameterName: string
  ): Promise<Message> {
    // Limit to top 4 candidates (Discord button limit = 5, need 1 for cancel)
    const topCandidates = candidates.slice(0, 4);

    // Create embed
    const embed = new EmbedBuilder()
      .setTitle('👥 Birden Fazla Eşleşme Bulundu')
      .setDescription(`**${parameterName}** için hangi kullanıcıyı kastettin?`)
      .setColor(0x3498db) // Blue
      .setTimestamp();

    // Add candidates to embed
    for (let i = 0; i < topCandidates.length; i++) {
      const candidate = topCandidates[i];
      embed.addFields({
        name: `${i + 1}. ${candidate.username}`,
        value: `${candidate.reason}\nGüven: ${(candidate.confidence * 100).toFixed(0)}%`,
        inline: true
      });
    }

    // Create buttons
    const buttons: ButtonBuilder[] = topCandidates.map((candidate, i) =>
      new ButtonBuilder()
        .setCustomId(`select_user_${i}`)
        .setLabel(`${i + 1}. ${candidate.username}`)
        .setStyle(ButtonStyle.Primary)
    );

    // Add cancel button
    buttons.push(
      new ButtonBuilder()
        .setCustomId('select_cancel')
        .setLabel('❌ İptal')
        .setStyle(ButtonStyle.Danger)
    );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

    // Send message
    if ('send' in channel) {
      const sentMessage = await channel.send({
        embeds: [embed],
        components: [row]
      });
      return sentMessage;
    }
    throw new Error('Channel does not support sending messages');
  }

  /**
   * Show bulk action warning
   */
  async askBulkActionConfirmation(
    channel: Message['channel'],
    action: string,
    targetCount: number,
    targetUsers: string[],
    parameters: { [key: string]: any }
  ): Promise<Message> {
    // Create detailed warning
    const userList = targetUsers.slice(0, 5).join(', ');
    const moreCount = targetUsers.length - 5;

    const embed = new EmbedBuilder()
      .setTitle('⚠️ TOPLU AKSIYON UYARISI')
      .setDescription(`**${targetCount} kullanıcıya** ${action} uygulanacak!`)
      .setColor(0xe74c3c) // Red
      .addFields({
        name: 'Etkilenecek Kullanıcılar',
        value: userList + (moreCount > 0 ? ` ... (+${moreCount} kişi daha)` : '')
      })
      .setFooter({ text: 'Bu işlem geri alınamaz!' })
      .setTimestamp();

    // Add parameters
    const paramText = Object.entries(parameters)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `**${key}:** ${value}`)
      .join('\n');

    if (paramText) {
      embed.addFields({ name: 'Parametreler', value: paramText });
    }

    // Create buttons
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('bulk_confirm')
          .setLabel('✅ Onayla')
          .setStyle(ButtonStyle.Danger), // Red for dangerous action
        new ButtonBuilder()
          .setCustomId('bulk_cancel')
          .setLabel('❌ İptal Et')
          .setStyle(ButtonStyle.Secondary)
      );

    // Send message
    if ('send' in channel) {
      const sentMessage = await channel.send({
        embeds: [embed],
        components: [row]
      });
      return sentMessage;
    }
    throw new Error('Channel does not support sending messages');
  }

  /**
   * Simple info message with OK button
   */
  async showInfo(
    channel: Message['channel'],
    title: string,
    message: string
  ): Promise<Message> {
    const embed = new EmbedBuilder()
      .setTitle('ℹ️ ' + title)
      .setDescription(message)
      .setColor(0x3498db) // Blue
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('info_ok')
          .setLabel('OK')
          .setStyle(ButtonStyle.Primary)
      );

    if ('send' in channel) {
      const sentMessage = await channel.send({
        embeds: [embed],
        components: [row]
      });
      return sentMessage;
    }
    throw new Error('Channel does not support sending messages');
  }

  /**
   * Listen for button interaction on a message
   */
  async waitForButtonClick(
    message: Message,
    timeout = 60000
  ): Promise<ButtonInteraction | null> {
    try {
      const interaction = await message.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: timeout
      });

      return interaction as ButtonInteraction;
    } catch (error) {
      // Timeout or error
      logger.debug('Button interaction timeout or error', error);
      return null;
    }
  }

  /**
   * Update message to show "Confirmed" state
   */
  async markAsConfirmed(message: Message, action: string): Promise<void> {
    try {
      const embed = new EmbedBuilder()
        .setTitle('✅ Onaylandı')
        .setDescription(`${action} komutu çalıştırılıyor...`)
        .setColor(0x2ecc71) // Green
        .setTimestamp();

      await message.edit({
        embeds: [embed],
        components: [] // Remove buttons
      });
    } catch (error) {
      logger.error('Failed to update confirmation message', error);
    }
  }

  /**
   * Update message to show "Cancelled" state
   */
  async markAsCancelled(message: Message): Promise<void> {
    try {
      const embed = new EmbedBuilder()
        .setTitle('❌ İptal Edildi')
        .setDescription('Komut iptal edildi.')
        .setColor(0x95a5a6) // Gray
        .setTimestamp();

      await message.edit({
        embeds: [embed],
        components: [] // Remove buttons
      });
    } catch (error) {
      logger.error('Failed to update cancellation message', error);
    }
  }

  /**
   * Update message to show "Expired" state
   */
  async markAsExpired(message: Message): Promise<void> {
    try {
      const embed = new EmbedBuilder()
        .setTitle('⏱️ Zaman Aşımı')
        .setDescription('Onay bekleme süresi doldu.')
        .setColor(0x95a5a6) // Gray
        .setTimestamp();

      await message.edit({
        embeds: [embed],
        components: [] // Remove buttons
      });
    } catch (error) {
      logger.error('Failed to update expired message', error);
    }
  }

  /**
   * Get emoji for warning level
   */
  private getEmojiForLevel(level: 'info' | 'warning' | 'danger'): string {
    switch (level) {
      case 'info': return 'ℹ️';
      case 'warning': return '⚠️';
      case 'danger': return '🚨';
    }
  }

  /**
   * Get color for warning level
   */
  private getColorForLevel(level: 'info' | 'warning' | 'danger'): number {
    switch (level) {
      case 'info': return 0x3498db; // Blue
      case 'warning': return 0xf39c12; // Orange
      case 'danger': return 0xe74c3c; // Red
    }
  }
}
