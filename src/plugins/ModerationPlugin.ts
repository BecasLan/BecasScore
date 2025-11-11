/**
 * MODERATION PLUGIN
 *
 * Real implementation of violation detection as a kernel plugin.
 * This plugin subscribes to MessageReceived events and performs moderation.
 */

import { Plugin, BecasKernel } from '../kernel/BecasKernel';
import {
  MessageReceivedEvent,
  ViolationDetectedEvent,
  eventBus,
} from '../domain/events/DomainEvent';
import { Message } from '../domain/models/Message';
import { Violation, ViolationType, ViolationSeverity } from '../domain/models/Violation';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

const logger = createLogger('ModerationPlugin');

export class ModerationPlugin implements Plugin {
  name = 'moderation';
  version = '2.0.0';
  description = 'AI-powered content moderation with violation detection';
  dependencies = []; // No dependencies

  private ollama!: OllamaService;
  private kernel!: BecasKernel;

  /**
   * Initialize plugin - subscribe to events
   */
  async initialize(kernel: BecasKernel): Promise<void> {
    this.kernel = kernel;

    logger.info('🛡️ Initializing Moderation Plugin...');

    // Get OllamaService from kernel's service registry
    try {
      this.ollama = kernel.getService<OllamaService>('ollama');
    } catch (error) {
      // Service not registered yet, create our own
      this.ollama = new OllamaService('coreViolationDetection');
      kernel.registerService('ollama', this.ollama);
    }

    // Subscribe to message events
    const eventBusInstance = kernel.getEventBus();

    eventBusInstance.on<MessageReceivedEvent['payload']>(
      'message.received',
      this.handleMessage.bind(this)
    );

    logger.info('✅ Moderation Plugin initialized');
    logger.info('   → Subscribed to: message.received');
  }

  /**
   * Handle incoming messages
   */
  private async handleMessage(event: any): Promise<void> {
    const startTime = Date.now();

    try {
      // Extract message from event
      const messageData = event.payload;

      // Create domain model
      const message = new Message(
        messageData.messageId,
        messageData.content,
        {
          id: messageData.authorId,
          username: messageData.authorUsername || 'Unknown',
          isBot: messageData.isBot || false,
          authorityLevel: messageData.authorityLevel || 'regular',
        },
        {
          guildId: messageData.guildId,
          channelId: messageData.channelId,
          timestamp: new Date(),
        },
        {
          hasUrls: /https?:\/\/|www\./i.test(messageData.content),
          hasMentions: /@everyone|@here/i.test(messageData.content),
          hasAttachments: messageData.hasAttachments || false,
          hasEmojis: /<a?:\w+:\d+>/i.test(messageData.content),
          isReply: false,
          channelType: 'text',
          isEdited: false,
          editCount: 0,
        }
      );

      // Check if message needs moderation
      if (!message.needsModerationReview()) {
        logger.info(`⏭️ Message from ${message.author.username} skipped (no review needed)`);
        return;
      }

      // Run violation detection
      logger.info(`🔍 Checking message from ${message.author.username} for violations...`);

      const violations = await this.detectViolations(message);

      const duration = Date.now() - startTime;

      if (violations.length === 0) {
        logger.info(`✅ No violations detected (${duration}ms)`);
        return;
      }

      // Publish violation events
      for (const violation of violations) {
        await this.kernel.publishEvent(
          new ViolationDetectedEvent(
            {
              messageId: message.id,
              violationType: violation.type,
              severity: violation.severity,
              confidence: violation.confidence,
              evidence: violation.evidence.quotedText,
              reasoning: violation.reasoning,
            },
            event.metadata.eventId // Causation chain
          )
        );

        logger.warn(
          `⚠️ Violation: ${violation.getDescription()} - Action: ${violation.recommendedAction}`
        );
      }

      logger.info(`🛡️ Moderation complete (${duration}ms) - ${violations.length} violations`);
    } catch (error: any) {
      logger.error('Moderation error:', error);
    }
  }

  /**
   * Detect violations using unified AI check
   */
  private async detectViolations(message: Message): Promise<Violation[]> {
    try {
      const systemPrompt = `You are a content moderation AI. Analyze the message for ALL these violation types:

1. profanity - Offensive language, swear words, vulgar terms
2. hate_speech - Discrimination, slurs, bigotry
3. harassment - Bullying, threats, personal attacks
4. spam - Repetitive content, flooding, mass mentions
5. scam - Phishing, fraud, malicious links
6. explicit_content - NSFW, sexual content
7. doxxing - Sharing personal info (addresses, phone numbers, etc.)
8. raiding - Coordinated attacks, brigading
9. impersonation - Pretending to be someone else

Return ONLY valid JSON (no other text) with this structure:
{
  "violations": [
    {"type": "violation_name", "confidence": 0.0-1.0, "severity": "low|medium|high|critical", "evidence": "quoted text", "reasoning": "why detected"}
  ]
}

IMPORTANT:
- confidence must be 0.0-1.0 (e.g., 0.8, not 80)
- Only include violations with confidence >= 0.7
- severity levels: low (minor), medium (moderate), high (serious), critical (severe)
- If NO violations detected, return: {"violations": []}`;

      const userPrompt = `Message: "${message.content}"

Analyze for ALL violation types and return JSON.`;

      const response = await this.ollama.generateJSON<{ violations: any[] }>(
        userPrompt,
        systemPrompt
      );

      // Convert AI results to Violation domain models
      if (!response.violations || response.violations.length === 0) {
        return [];
      }

      const violations: Violation[] = [];

      for (const v of response.violations) {
        try {
          // Validate type
          const type = Object.values(ViolationType).find(t => t === v.type);
          if (!type) continue;

          // Validate severity
          const severity = Object.values(ViolationSeverity).find(s => s === v.severity);
          if (!severity) continue;

          // Create domain model (auto-calculates trust penalty, action, etc.)
          const violation = new Violation(
            type,
            v.confidence,
            severity,
            { quotedText: v.evidence },
            v.reasoning
          );

          violations.push(violation);
        } catch (error) {
          logger.warn('Invalid violation result:', error);
        }
      }

      return violations;
    } catch (error: any) {
      logger.error('Violation detection error:', error);
      return [];
    }
  }

  /**
   * Shutdown plugin - cleanup
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Moderation Plugin...');
    // No cleanup needed (event bus handles unsubscribe)
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check if Ollama service is available
      return await this.ollama.healthCheck();
    } catch (error) {
      return false;
    }
  }
}
