/**
 * BECAS INTERACTIVE - USER PROMPT SYSTEM
 *
 * Handles interactive user prompts with Discord integration.
 * Supports multiple prompt types with timeout handling.
 *
 * Features:
 * - Button prompts (Discord buttons)
 * - Select menus (Discord select menus)
 * - Text input (message collection)
 * - Confirm dialogs (yes/no buttons)
 * - Timeout handling
 * - Validation
 */

import {
  Message,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { BecasPrompt, BecasPromptResponse } from '../types/BecasFlow.types';
import { createLogger } from '../../services/Logger';

const logger = createLogger('BecasInteractive');

export class BecasInteractive {
  /**
   * Show interactive prompt to user
   */
  static async prompt(message: Message, promptConfig: BecasPrompt): Promise<BecasPromptResponse> {
    logger.info(`Showing ${promptConfig.type} prompt for: ${promptConfig.param}`);

    try {
      switch (promptConfig.type) {
        case 'button':
          return await this.promptButton(message, promptConfig);

        case 'select':
          return await this.promptSelect(message, promptConfig);

        case 'text':
          return await this.promptText(message, promptConfig);

        case 'confirm':
          return await this.promptConfirm(message, promptConfig);

        default:
          throw new Error(`Unknown prompt type: ${promptConfig.type}`);
      }
    } catch (error) {
      logger.error('Error showing prompt:', error);
      return {
        success: false,
        cancelled: true,
      };
    }
  }

  /**
   * Show button prompt
   */
  private static async promptButton(
    message: Message,
    config: BecasPrompt
  ): Promise<BecasPromptResponse> {
    if (!config.options || config.options.length === 0) {
      throw new Error('Button prompt requires options');
    }

    // Create buttons (max 5 per row, max 25 total)
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();
    let buttonCount = 0;

    for (const option of config.options.slice(0, 25)) {
      const button = new ButtonBuilder()
        .setCustomId(`becas_btn_${config.param}_${buttonCount}`)
        .setLabel(option.label)
        .setStyle(ButtonStyle.Primary);

      if (option.emoji) {
        button.setEmoji(option.emoji);
      }

      currentRow.addComponents(button);
      buttonCount++;

      if (buttonCount % 5 === 0 || buttonCount === config.options.length) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder<ButtonBuilder>();
      }
    }

    // Send message with buttons
    const promptMessage = await message.reply({
      content: config.message,
      components: rows,
    });

    // Wait for button click
    const timeout = config.timeout || 60000; // 60 seconds default

    try {
      const interaction = await promptMessage.awaitMessageComponent<ComponentType.Button>({
        filter: (i) => i.user.id === message.author.id,
        time: timeout,
      });

      // Get selected option
      const buttonIndex = parseInt(interaction.customId.split('_').pop() || '0');
      const selectedOption = config.options[buttonIndex];

      await interaction.update({
        content: `${config.message}\n\n✓ Selected: **${selectedOption.label}**`,
        components: [],
      });

      return {
        success: true,
        value: selectedOption.value,
      };
    } catch (error) {
      // Timeout or error
      await promptMessage.edit({
        content: `${config.message}\n\n⏱️ Timed out`,
        components: [],
      });

      return {
        success: false,
        timedOut: true,
      };
    }
  }

  /**
   * Show select menu prompt
   */
  private static async promptSelect(
    message: Message,
    config: BecasPrompt
  ): Promise<BecasPromptResponse> {
    if (!config.options || config.options.length === 0) {
      throw new Error('Select prompt requires options');
    }

    // Create select menu (max 25 options)
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`becas_select_${config.param}`)
      .setPlaceholder(config.placeholder || 'Select an option')
      .addOptions(
        config.options.slice(0, 25).map((option, idx) => ({
          label: option.label,
          value: String(idx),
          description: option.description?.substring(0, 100),
          emoji: option.emoji,
        }))
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    // Send message with select menu
    const promptMessage = await message.reply({
      content: config.message,
      components: [row],
    });

    // Wait for selection
    const timeout = config.timeout || 60000;

    try {
      const interaction = await promptMessage.awaitMessageComponent<ComponentType.StringSelect>({
        filter: (i) => i.user.id === message.author.id,
        time: timeout,
      });

      // Get selected option
      const selectedIndex = parseInt(interaction.values[0]);
      const selectedOption = config.options[selectedIndex];

      await interaction.update({
        content: `${config.message}\n\n✓ Selected: **${selectedOption.label}**`,
        components: [],
      });

      return {
        success: true,
        value: selectedOption.value,
      };
    } catch (error) {
      // Timeout or error
      await promptMessage.edit({
        content: `${config.message}\n\n⏱️ Timed out`,
        components: [],
      });

      return {
        success: false,
        timedOut: true,
      };
    }
  }

  /**
   * Show text input prompt
   */
  private static async promptText(
    message: Message,
    config: BecasPrompt
  ): Promise<BecasPromptResponse> {
    // Send prompt message
    const promptMessage = await message.reply(
      `${config.message}${config.placeholder ? `\n*${config.placeholder}*` : ''}`
    );

    // Wait for text response
    const timeout = config.timeout || 60000;

    try {
      // Type check for channel
      if (!('awaitMessages' in message.channel)) {
        throw new Error('Channel does not support message collection');
      }

      const collected = await message.channel.awaitMessages({
        filter: (m) => m.author.id === message.author.id,
        max: 1,
        time: timeout,
        errors: ['time'],
      });

      const response = collected.first();
      if (!response) {
        throw new Error('No response collected');
      }

      const value = response.content.trim();

      // Validate if validation function provided
      if (config.validation) {
        const validationResult = config.validation(value);
        if (validationResult !== true) {
          await message.reply(
            `❌ Invalid input: ${typeof validationResult === 'string' ? validationResult : 'Validation failed'}`
          );
          return {
            success: false,
            cancelled: true,
          };
        }
      }

      await promptMessage.edit(`${config.message}\n\n✓ Answer: **${value}**`);

      return {
        success: true,
        value,
      };
    } catch (error) {
      // Timeout
      await promptMessage.edit(`${config.message}\n\n⏱️ Timed out`);

      return {
        success: false,
        timedOut: true,
      };
    }
  }

  /**
   * Show confirm dialog (yes/no)
   */
  private static async promptConfirm(
    message: Message,
    config: BecasPrompt
  ): Promise<BecasPromptResponse> {
    // Create yes/no buttons
    const yesButton = new ButtonBuilder()
      .setCustomId('becas_confirm_yes')
      .setLabel('Yes')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✓');

    const noButton = new ButtonBuilder()
      .setCustomId('becas_confirm_no')
      .setLabel('No')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('✗');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(yesButton, noButton);

    // Send message
    const promptMessage = await message.reply({
      content: config.message,
      components: [row],
    });

    // Wait for button click
    const timeout = config.timeout || 30000; // 30 seconds for confirm

    try {
      const interaction = await promptMessage.awaitMessageComponent<ComponentType.Button>({
        filter: (i) => i.user.id === message.author.id,
        time: timeout,
      });

      const confirmed = interaction.customId === 'becas_confirm_yes';

      await interaction.update({
        content: `${config.message}\n\n${confirmed ? '✓ Confirmed' : '✗ Cancelled'}`,
        components: [],
      });

      return {
        success: true,
        value: confirmed,
        cancelled: !confirmed,
      };
    } catch (error) {
      // Timeout
      await promptMessage.edit({
        content: `${config.message}\n\n⏱️ Timed out`,
        components: [],
      });

      return {
        success: false,
        timedOut: true,
      };
    }
  }

  /**
   * Show multi-step form (multiple prompts in sequence)
   */
  static async promptMultiple(
    message: Message,
    prompts: BecasPrompt[]
  ): Promise<{ success: boolean; values: Record<string, any>; cancelled?: boolean }> {
    const values: Record<string, any> = {};

    for (const prompt of prompts) {
      const response = await this.prompt(message, prompt);

      if (!response.success || response.cancelled || response.timedOut) {
        return {
          success: false,
          values,
          cancelled: true,
        };
      }

      values[prompt.param] = response.value;
    }

    return {
      success: true,
      values,
    };
  }

  /**
   * Create common prompts (helpers)
   */
  static helpers = {
    /**
     * User selection prompt
     */
    selectUser(userIds: string[], usernames: string[]): BecasPrompt {
      return {
        type: 'select',
        message: 'Select a user:',
        param: 'userId',
        options: userIds.map((id, idx) => ({
          label: usernames[idx] || id,
          value: id,
        })),
      };
    },

    /**
     * Reason input prompt
     */
    inputReason(paramName: string = 'reason'): BecasPrompt {
      return {
        type: 'text',
        message: 'Enter a reason:',
        param: paramName,
        placeholder: 'e.g., Spam, harassment, etc.',
        validation: (input) => {
          if (input.length < 3) {
            return 'Reason must be at least 3 characters';
          }
          if (input.length > 500) {
            return 'Reason must be less than 500 characters';
          }
          return true;
        },
      };
    },

    /**
     * Duration selection prompt
     */
    selectDuration(): BecasPrompt {
      return {
        type: 'select',
        message: 'Select timeout duration:',
        param: 'duration',
        options: [
          { label: '5 minutes', value: 5 * 60 * 1000 },
          { label: '10 minutes', value: 10 * 60 * 1000 },
          { label: '30 minutes', value: 30 * 60 * 1000 },
          { label: '1 hour', value: 60 * 60 * 1000 },
          { label: '6 hours', value: 6 * 60 * 60 * 1000 },
          { label: '1 day', value: 24 * 60 * 60 * 1000 },
          { label: '1 week', value: 7 * 24 * 60 * 60 * 1000 },
        ],
      };
    },

    /**
     * Confirm action prompt
     */
    confirmAction(action: string, target: string): BecasPrompt {
      return {
        type: 'confirm',
        message: `Are you sure you want to **${action}** ${target}?`,
        param: 'confirmed',
        defaultValue: false,
        timeout: 30000,
      };
    },

    /**
     * Number input prompt
     */
    inputNumber(paramName: string, message: string, min?: number, max?: number): BecasPrompt {
      return {
        type: 'text',
        message,
        param: paramName,
        validation: (input) => {
          const num = parseInt(input);
          if (isNaN(num)) {
            return 'Must be a number';
          }
          if (min !== undefined && num < min) {
            return `Must be at least ${min}`;
          }
          if (max !== undefined && num > max) {
            return `Must be at most ${max}`;
          }
          return true;
        },
      };
    },
  };
}
