/**
 * INTENT ROUTER TOOL
 *
 * This tool runs FIRST on every BecasFlow query to determine:
 * 1. User intent (command, query, conversation, violation check needed)
 * 2. User authority level (owner, admin, mod, regular)
 * 3. Message context (bot interaction, suspicious patterns)
 * 4. Routing decision (which tools to call, skip violation checks)
 *
 * This replaces the 9-AI-call approach in BecasCoreViolationEngine
 * and prevents false positives on legitimate bot interactions.
 */

import { BecasTool, BecasContext, BecasToolResult } from '../../types/BecasFlow.types';
import { OllamaService } from '../../../services/OllamaService';
import { createLogger } from '../../../services/Logger';
import { PermissionFlagsBits } from 'discord.js';

const logger = createLogger('IntentRouterTool');

export interface IntentAnalysis {
  intent: 'bot_command' | 'moderation_command' | 'query' | 'conversation' | 'suspicious' | 'violation';
  confidence: number;
  needsViolationCheck: boolean;
  userAuthorityLevel: 'owner' | 'admin' | 'moderator' | 'regular';
  suggestedTools: string[];
  reasoning: string;
  skipReason?: string;
}

export const intentRouterTool: BecasTool = {
  name: 'intent_router',
  description: 'Analyzes message intent and routes to appropriate tools (runs first on all messages)',
  category: 'intelligence',
  parameters: {
    message: {
      type: 'string',
      description: 'The message content to analyze',
      required: true,
    },
    hasUrls: {
      type: 'boolean',
      description: 'Whether message contains URLs',
      required: false,
    },
    hasMentions: {
      type: 'boolean',
      description: 'Whether message contains @mentions',
      required: false,
    },
    hasAttachments: {
      type: 'boolean',
      description: 'Whether message has attachments',
      required: false,
    },
  },
  detectMissing: (params: any, context: BecasContext) => {
    if (!params.message) {
      return {
        param: 'message',
        prompt: 'What message should I analyze?',
        type: 'text' as const,
      };
    }
    return null;
  },

  execute: async (params: any, context: BecasContext): Promise<BecasToolResult> => {
    const startTime = Date.now();

    try {
      const message = params.message || context.message.content;
      const hasUrls = params.hasUrls || /https?:\/\/|www\./i.test(message);
      const hasMentions = params.hasMentions || /@everyone|@here/i.test(message);
      const hasAttachments = params.hasAttachments || (context.message.attachments?.size ?? 0) > 0;

      // Determine user authority level
      const authorityLevel = getUserAuthorityLevel(context);

      // Fast path: Bot command detection (no AI needed)
      const messageContent = message.toLowerCase().trim();

      // Check if addressing bot directly
      const addressingBot =
        messageContent.startsWith('becas ') ||
        messageContent.startsWith('hey becas') ||
        messageContent.startsWith('@becas') ||
        messageContent === 'becas';

      if (addressingBot) {
        const analysis: IntentAnalysis = {
          intent: 'bot_command',
          confidence: 0.95,
          needsViolationCheck: false,
          userAuthorityLevel: authorityLevel,
          suggestedTools: determineToolsFromCommand(messageContent),
          reasoning: 'User directly addressing bot with "becas" prefix',
          skipReason: 'Legitimate bot interaction',
        };

        logger.info(`Intent: bot_command (${analysis.confidence}) - Skipping violation check`);

        return {
          success: true,
          data: analysis,
          executionTime: Date.now() - startTime,
          metadata: {
            nextSuggestedTool: analysis.suggestedTools[0],
            loopBack: false,
          },
        };
      }

      // Fast path: Owner/Admin immunity for simple queries
      if ((authorityLevel === 'owner' || authorityLevel === 'admin') && message.length < 50 && !hasUrls) {
        const analysis: IntentAnalysis = {
          intent: 'query',
          confidence: 0.9,
          needsViolationCheck: false,
          userAuthorityLevel: authorityLevel,
          suggestedTools: ['trust_score_lookup'],
          reasoning: `${authorityLevel} making simple query - no violation check needed`,
          skipReason: `${authorityLevel} immunity`,
        };

        logger.info(`Intent: query (${analysis.confidence}) - ${authorityLevel} immunity`);

        return {
          success: true,
          data: analysis,
          executionTime: Date.now() - startTime,
        };
      }

      // Suspicious pattern detection (requires deeper analysis)
      const suspiciousPatterns = detectSuspiciousPatterns(message, hasUrls, hasMentions, hasAttachments);

      if (suspiciousPatterns.detected) {
        // Use AI for violation analysis
        const aiAnalysis = await analyzeWithAI(message, context, authorityLevel, suspiciousPatterns);

        logger.info(`Intent: ${aiAnalysis.intent} (${aiAnalysis.confidence}) - Violation check: ${aiAnalysis.needsViolationCheck}`);

        return {
          success: true,
          data: aiAnalysis,
          executionTime: Date.now() - startTime,
          metadata: {
            nextSuggestedTool: aiAnalysis.suggestedTools[0],
            loopBack: aiAnalysis.needsViolationCheck,
          },
        };
      }

      // Default: Regular conversation (no violation check unless moderator flagged)
      const analysis: IntentAnalysis = {
        intent: 'conversation',
        confidence: 0.85,
        needsViolationCheck: false,
        userAuthorityLevel: authorityLevel,
        suggestedTools: [],
        reasoning: 'Regular conversation with no suspicious patterns',
        skipReason: 'Clean message',
      };

      logger.info(`Intent: conversation (${analysis.confidence}) - No violation check needed`);

      return {
        success: true,
        data: analysis,
        executionTime: Date.now() - startTime,
      };

    } catch (error: any) {
      logger.error('Intent router error:', error);

      // Fail-safe: Allow message through but flag for review
      return {
        success: true,
        data: {
          intent: 'conversation',
          confidence: 0.5,
          needsViolationCheck: false,
          userAuthorityLevel: 'regular',
          suggestedTools: [],
          reasoning: 'Error during analysis - defaulting to safe mode',
          skipReason: 'Analysis error',
        },
        error: error.message,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Determine user authority level based on permissions
 */
function getUserAuthorityLevel(context: BecasContext): 'owner' | 'admin' | 'moderator' | 'regular' {
  const member = context.member;

  if (member.id === context.guild.ownerId) {
    return 'owner';
  }

  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return 'admin';
  }

  if (
    member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
    member.permissions.has(PermissionFlagsBits.KickMembers) ||
    member.permissions.has(PermissionFlagsBits.BanMembers)
  ) {
    return 'moderator';
  }

  return 'regular';
}

/**
 * Detect suspicious patterns that require deeper analysis
 */
function detectSuspiciousPatterns(
  message: string,
  hasUrls: boolean,
  hasMentions: boolean,
  hasAttachments: boolean
): { detected: boolean; patterns: string[] } {
  const patterns: string[] = [];

  // URL + certain keywords = potential scam
  if (hasUrls) {
    const lowerMessage = message.toLowerCase();

    if (
      /free|win|claim|prize|reward|giveaway|nitro|discord\.gift/i.test(lowerMessage) ||
      /click here|dm me|join now|limited time/i.test(lowerMessage)
    ) {
      patterns.push('scam_indicators');
    }

    // Shortened URLs are suspicious
    if (/bit\.ly|tinyurl|t\.co|goo\.gl/i.test(message)) {
      patterns.push('shortened_url');
    }
  }

  // Mass mentions
  if (hasMentions && /@everyone|@here/.test(message)) {
    patterns.push('mass_mention');
  }

  // Repeated characters (spam)
  if (/(.)\1{5,}/.test(message)) {
    patterns.push('repeated_chars');
  }

  // All caps (potential aggression)
  if (message.length > 20 && message === message.toUpperCase() && /[A-Z]/.test(message)) {
    patterns.push('all_caps');
  }

  // Profanity filter (basic)
  if (/\b(fuck|shit|bitch|asshole|cunt|nigger|faggot)\b/i.test(message)) {
    patterns.push('profanity');
  }

  // Explicit content indicators
  if (/\b(porn|xxx|nsfw|nude|sex)\b/i.test(message) && hasUrls) {
    patterns.push('explicit_content');
  }

  return {
    detected: patterns.length > 0,
    patterns,
  };
}

/**
 * Use AI to analyze intent when suspicious patterns detected
 */
async function analyzeWithAI(
  message: string,
  context: BecasContext,
  authorityLevel: 'owner' | 'admin' | 'moderator' | 'regular',
  suspiciousPatterns: { detected: boolean; patterns: string[] }
): Promise<IntentAnalysis> {
  // 🔥 FIX: Use 'analysis' context which exists in ollama.config.ts
  const ollama = new OllamaService('analysis');

  const systemPrompt = `You are an intent analyzer for a Discord moderation bot. Analyze the message and determine:

1. User intent (bot_command, moderation_command, query, conversation, suspicious, violation)
2. Whether violation checking is needed
3. Which tools should handle this message
4. Confidence level (0.0-1.0)

CONTEXT:
- User authority: ${authorityLevel}
- Suspicious patterns detected: ${suspiciousPatterns.patterns.join(', ')}

RESPONSE FORMAT (JSON only):
{
  "intent": "bot_command" | "moderation_command" | "query" | "conversation" | "suspicious" | "violation",
  "confidence": 0.0-1.0,
  "needsViolationCheck": true|false,
  "suggestedTools": ["tool_name"],
  "reasoning": "brief explanation",
  "violationTypes": ["scam", "spam", "harassment"] // only if needsViolationCheck=true
}

IMPORTANT:
- If user is owner/admin and making a simple query, set needsViolationCheck=false
- If message addresses "becas" directly, it's likely a bot_command
- Only flag for violation check if CLEARLY problematic
- Consider authority level when assessing threat`;

  const userPrompt = `Message: "${message}"\n\nAnalyze this message.`;

  try {
    const response = await ollama.generate(userPrompt, systemPrompt, {
      temperature: 0.2,
      maxTokens: 300,
      format: 'json',
    });

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid JSON response from AI');
    }

    const aiResult = JSON.parse(jsonMatch[0]);

    return {
      intent: aiResult.intent,
      confidence: aiResult.confidence,
      needsViolationCheck: aiResult.needsViolationCheck,
      userAuthorityLevel: authorityLevel,
      suggestedTools: aiResult.suggestedTools || [],
      reasoning: aiResult.reasoning,
    };

  } catch (error: any) {
    logger.error('AI analysis failed:', error);

    // Fail-safe: If AI fails, default to checking violations for regular users
    return {
      intent: 'suspicious',
      confidence: 0.6,
      needsViolationCheck: authorityLevel === 'regular',
      userAuthorityLevel: authorityLevel,
      suggestedTools: ['violation_check'],
      reasoning: 'AI analysis failed - using fail-safe mode',
    };
  }
}

/**
 * Determine which tools to call based on bot command
 */
function determineToolsFromCommand(command: string): string[] {
  const lowerCommand = command.toLowerCase();

  if (/score|trust|reputation/i.test(lowerCommand)) {
    return ['trust_score_lookup'];
  }

  if (/timeout|ban|kick|warn|moderate/i.test(lowerCommand)) {
    return ['timeout', 'ban', 'kick'];
  }

  if (/policy|rule/i.test(lowerCommand)) {
    return ['policy_management'];
  }

  if (/history|log|record/i.test(lowerCommand)) {
    return ['moderation_history'];
  }

  if (/help|command|info/i.test(lowerCommand)) {
    return ['help'];
  }

  return [];
}
