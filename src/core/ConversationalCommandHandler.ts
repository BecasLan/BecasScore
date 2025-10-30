/**
 * CONVERSATIONAL COMMAND HANDLER - Main Orchestrator
 *
 * Coordinates all conversational command components:
 * - IntentRecognizer
 * - ContextResolver
 * - ConversationState
 * - ConfirmationUI
 * - QuestionAsker
 * - BulkActionResolver
 * - SafetyGuard
 *
 * Flow:
 * 1. Recognize intent from natural language
 * 2. Resolve missing parameters via context
 * 3. Ask questions if still missing
 * 4. Confirm dangerous actions
 * 5. Execute command
 */

import { Message, TextChannel, GuildMember } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { IntentRecognizer, RecognizedIntent } from '../ai/IntentRecognizer';
import { ContextResolver, ResolutionCandidate } from '../services/ContextResolver';
import { ConversationStateManager } from '../services/ConversationState';
import { ConfirmationUI } from '../services/ConfirmationUI';
import { QuestionAsker } from '../services/QuestionAsker';
import { BulkActionResolver, BulkTarget } from '../services/BulkActionResolver';
import { SafetyGuard } from '../services/SafetyGuard';
import { getCommandByIntent } from '../commands/CommandDictionary';
import { createLogger } from '../services/Logger';

const logger = createLogger('ConversationalCommandHandler');

export class ConversationalCommandHandler {
  private intentRecognizer: IntentRecognizer;
  private contextResolver: ContextResolver;
  private conversationState: ConversationStateManager;
  private confirmationUI: ConfirmationUI;
  private questionAsker: QuestionAsker;
  private bulkActionResolver: BulkActionResolver;
  private safetyGuard: SafetyGuard;

  constructor(private ollama: OllamaService) {
    this.intentRecognizer = new IntentRecognizer(ollama);
    this.contextResolver = new ContextResolver();
    this.conversationState = new ConversationStateManager();
    this.confirmationUI = new ConfirmationUI(this.conversationState);
    this.questionAsker = new QuestionAsker(this.contextResolver);
    this.bulkActionResolver = new BulkActionResolver();
    this.safetyGuard = new SafetyGuard();
  }

  /**
   * Process a moderator command message
   */
  async processCommand(message: Message): Promise<void> {
    if (!(message.channel instanceof TextChannel)) return;
    if (!message.guild) return;
    if (!message.member) return;

    try {
      // 1. Check if continuing existing conversation
      const existingConv = this.conversationState.get(message.author.id, message.channel.id);
      if (existingConv) {
        await this.continueConversation(message, existingConv);
        return;
      }

      // 2. Recognize new intent
      logger.info(`Processing new command: "${message.content}"`);

      const recognized = await this.intentRecognizer.recognizeIntent(message.content, {
        lastMentionedUser: message.mentions.users.first()?.id,
        repliedToUser: message.reference ? (await message.fetchReference()).author.id : undefined,
        currentChannel: message.channel.id
      });

      if (!recognized) {
        logger.debug('No intent recognized');
        return;
      }

      // 3. Create conversation
      const conversation = this.conversationState.create(
        message.author.id,
        message.channel.id,
        message.guild.id,
        recognized.intent,
        recognized.confidence,
        recognized.parameters,
        recognized.missingParams
      );

      this.conversationState.addMessage(
        message.author.id,
        message.channel.id,
        'moderator',
        message.content
      );

      // 4. Resolve missing parameters via context
      if (conversation.missingParams.length > 0) {
        await this.resolveMissingParameters(message, conversation);
      }

      // 5. Check if ready to execute
      if (this.conversationState.isReady(message.author.id, message.channel.id)) {
        await this.executeCommand(message);
      }

    } catch (error) {
      logger.error('Failed to process command', error);
      await message.reply('Sorry, something went wrong processing your command.');
    }
  }

  /**
   * Continue an existing conversation (parameter update, confirmation response, etc.)
   */
  private async continueConversation(message: Message, conversation: any): Promise<void> {
    const content = message.content.toLowerCase().trim();

    // Check for cancellation
    if (content === 'cancel' || content === 'abort' || content === 'stop') {
      this.conversationState.cancel(message.author.id, message.channel.id);
      await message.reply('Command cancelled.');
      return;
    }

    // Check if waiting for parameter input
    if (conversation.status === 'awaiting_input') {
      await this.handleParameterResponse(message, conversation);
      return;
    }

    // Otherwise, treat as parameter update
    await this.handleParameterUpdate(message, conversation);
  }

  /**
   * Resolve missing parameters using context
   */
  private async resolveMissingParameters(message: Message, conversation: any): Promise<void> {
    const commandDef = getCommandByIntent(conversation.intent);
    if (!commandDef) return;

    for (const missingParam of [...conversation.missingParams]) {
      const paramDef = commandDef.parameters.find(p => p.name === missingParam);
      if (!paramDef) continue;

      // Get context clues for this parameter
      const contextClues = commandDef.contextClues[missingParam];
      if (!contextClues) continue;

      // Try to resolve via context
      if (paramDef.type === 'user') {
        const strategies = contextClues.map(c => c.strategy);
        const candidates = await this.contextResolver.resolveMissingUser(message, strategies);

        if (candidates.length === 1 && candidates[0].confidence >= 0.85) {
          // Single high-confidence candidate - use it
          this.conversationState.updateParameter(
            message.author.id,
            message.channel.id,
            missingParam,
            candidates[0].userId
          );
          logger.info(`Auto-resolved ${missingParam} to ${candidates[0].username}`);
        } else if (candidates.length > 1) {
          // Multiple candidates - ask user to choose
          const selectionMsg = await this.confirmationUI.askUserSelection(
            message.channel as TextChannel,
            candidates,
            missingParam
          );

          this.conversationState.setConfirmationMessage(
            message.author.id,
            message.channel.id,
            selectionMsg.id
          );

          // Wait for button click
          const interaction = await this.confirmationUI.waitForButtonClick(selectionMsg);
          if (interaction && interaction.customId.startsWith('select_user_')) {
            const index = parseInt(interaction.customId.split('_')[2]);
            const selected = candidates[index];

            this.conversationState.updateParameter(
              message.author.id,
              message.channel.id,
              missingParam,
              selected.userId
            );

            await interaction.reply(`Selected: ${selected.username}`);
            await this.confirmationUI.markAsConfirmed(selectionMsg, `${missingParam} = ${selected.username}`);
          }
        }
      } else if (paramDef.type === 'duration') {
        // Try to parse duration from message
        const duration = this.contextResolver.parseTimeExpression(message.content);
        if (duration) {
          this.conversationState.updateParameter(
            message.author.id,
            message.channel.id,
            missingParam,
            `${duration}ms`
          );
        }
      }
    }

    // Check if still have missing required parameters
    const updatedConv = this.conversationState.get(message.author.id, message.channel.id);
    if (updatedConv && updatedConv.missingParams.length > 0) {
      // Ask for first missing parameter
      const firstMissing = updatedConv.missingParams[0];
      const paramDef = commandDef.parameters.find(p => p.name === firstMissing);
      if (paramDef) {
        const questionMsg = await this.questionAsker.askForParameter(
          message.channel as TextChannel,
          paramDef,
          conversation.intent
        );

        this.conversationState.setQuestionMessage(
          message.author.id,
          message.channel.id,
          questionMsg.id
        );
      }
    }
  }

  /**
   * Handle moderator's response to a parameter question
   */
  private async handleParameterResponse(message: Message, conversation: any): Promise<void> {
    const commandDef = getCommandByIntent(conversation.intent);
    if (!commandDef || conversation.missingParams.length === 0) return;

    const paramName = conversation.missingParams[0];
    const paramDef = commandDef.parameters.find(p => p.name === paramName);
    if (!paramDef) return;

    // Extract value from response
    const value = await this.questionAsker.waitForResponse(
      message.channel as TextChannel,
      message.author.id,
      paramDef,
      0 // Don't wait, we already have the message
    );

    if (value.answered && value.value) {
      this.conversationState.updateParameter(
        message.author.id,
        message.channel.id,
        paramName,
        value.value
      );

      await message.reply(`Got it: ${paramName} = ${value.value}`);

      // Check if ready
      if (this.conversationState.isReady(message.author.id, message.channel.id)) {
        await this.executeCommand(message);
      } else {
        // Ask next question
        await this.resolveMissingParameters(message, conversation);
      }
    }
  }

  /**
   * Handle parameter updates ("no wait, do this instead")
   */
  private async handleParameterUpdate(message: Message, conversation: any): Promise<void> {
    // Re-recognize intent to extract new parameters
    const recognized = await this.intentRecognizer.recognizeIntent(message.content);

    if (recognized && recognized.intent === conversation.intent) {
      // Update parameters
      for (const [key, value] of Object.entries(recognized.parameters)) {
        if (value !== null && value !== undefined) {
          this.conversationState.updateParameter(
            message.author.id,
            message.channel.id,
            key,
            value
          );
        }
      }

      await message.reply('Updated parameters.');

      // Check if ready
      if (this.conversationState.isReady(message.author.id, message.channel.id)) {
        await this.executeCommand(message);
      }
    }
  }

  /**
   * Execute the command (with safety checks and confirmation)
   */
  private async executeCommand(message: Message): Promise<void> {
    const conversation = this.conversationState.get(message.author.id, message.channel.id);
    if (!conversation || !message.guild || !message.member) return;

    // 1. Safety checks
    const safetyCheck = await this.safetyGuard.checkSafety(
      message.member as GuildMember,
      conversation.intent,
      conversation.parameters,
      message.guild
    );

    if (!safetyCheck.safe) {
      await message.reply(`❌ Safety check failed: ${safetyCheck.reason}`);
      this.conversationState.cancel(message.author.id, message.channel.id, safetyCheck.reason);
      return;
    }

    // 2. Confirmation if needed
    if (safetyCheck.requiresConfirmation) {
      const confirmMsg = await this.confirmationUI.askYesNo(
        message.channel,
        {
          message: safetyCheck.warningMessage || 'Confirm action?',
          warningLevel: 'warning'
        }
      );

      this.conversationState.setConfirmationMessage(
        message.author.id,
        message.channel.id,
        confirmMsg.id
      );

      const interaction = await this.confirmationUI.waitForButtonClick(confirmMsg);
      if (!interaction || interaction.customId === 'confirm_no') {
        await this.confirmationUI.markAsCancelled(confirmMsg);
        this.conversationState.cancel(message.author.id, message.channel.id, 'User cancelled');
        return;
      }

      await this.confirmationUI.markAsConfirmed(confirmMsg, conversation.intent);
      await interaction.reply('Executing command...');
    }

    // 3. Execute command (delegate to actual executor)
    await this.actuallyExecuteCommand(message, conversation);

    // 4. Complete conversation
    this.conversationState.complete(message.author.id, message.channel.id);

    // 5. Remember target for context
    if (conversation.parameters.target) {
      this.contextResolver.rememberTarget(message.author.id, conversation.parameters.target);
    }

    // 6. Log for audit
    this.safetyGuard.logExecution(
      message.author.id,
      conversation.intent,
      conversation.parameters,
      true
    );
  }

  /**
   * Actually execute the Discord command
   * (This will be implemented to call actual Discord.js methods)
   */
  private async actuallyExecuteCommand(message: Message, conversation: any): Promise<void> {
    const { intent, parameters } = conversation;

    logger.info(`Executing command: ${intent}`, parameters);

    // TODO: Implement actual Discord command execution
    // For now, just reply with what would be executed
    await message.reply(`✅ Would execute: ${intent} with params: ${JSON.stringify(parameters)}`);
  }

  /**
   * Get conversation state manager (for external access)
   */
  getConversationState(): ConversationStateManager {
    return this.conversationState;
  }
}
