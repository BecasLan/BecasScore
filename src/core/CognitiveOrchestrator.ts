import { OllamaService } from '../services/OllamaService';
import { Message, TextChannel } from 'discord.js';
import { StructuredActionParser, StructuredAction } from './StructuredActionParser';
import { FeatureRegistry } from './FeatureRegistry';

/**
 * COGNITIVE ORCHESTRATOR - OpenAI/Claude Level Intelligence
 *
 * This is Becas's "brain" - the system that thinks, plans, and reasons
 * before taking action. Inspired by:
 * - OpenAI's Chain-of-Thought reasoning
 * - Claude's multi-step planning
 * - GPT-4's self-reflection
 *
 * Unlike simple command execution, this orchestrator:
 * 1. UNDERSTANDS what the user really wants (intent)
 * 2. PLANS the best approach (multi-step reasoning)
 * 3. VALIDATES safety and permissions
 * 4. EXECUTES with monitoring
 * 5. REFLECTS on outcomes (learns)
 */

export interface ReasoningStep {
  step: number;
  phase: 'understand' | 'plan' | 'validate' | 'execute' | 'reflect';
  thought: string;
  decision?: string;
  confidence: number;
}

export interface CognitiveDecision {
  understood: boolean;
  intent: string;
  reasoning: ReasoningStep[];
  action?: StructuredAction;
  needsClarification?: string;
  safetyWarning?: string;
  executionPlan?: string[];
  confidence: number;
}

export class CognitiveOrchestrator {
  private reasoningLLM: OllamaService;
  private actionParser: StructuredActionParser;

  constructor(actionParser: StructuredActionParser) {
    this.reasoningLLM = new OllamaService('analysis'); // Qwen3:8b for reasoning
    this.actionParser = actionParser;

    const featureCount = FeatureRegistry.getAllFeatures().length;
    console.log('🧠 CognitiveOrchestrator initialized - OpenAI/Claude level reasoning active');
    console.log(`  ✓ Feature Registry loaded (${featureCount} features available)`);
    console.log('  ✓ Using Qwen3:8b for superior context understanding');
  }

  /**
   * Main orchestration method - thinks through the entire process
   */
  async processCommand(
    message: Message,
    userCommand: string,
    hasModerationPerms: boolean
  ): Promise<CognitiveDecision> {
    console.log(`\n🧠 ===== COGNITIVE ORCHESTRATION START =====`);
    console.log(`📝 Command: "${userCommand}"`);
    console.log(`👤 User: ${message.author.username} (Mod: ${hasModerationPerms})`);

    const reasoningSteps: ReasoningStep[] = [];

    try {
      // STEP 1: UNDERSTAND - What does the user REALLY want?
      const understanding = await this.stepUnderstand(userCommand, reasoningSteps);

      if (understanding.needsClarification) {
        return {
          understood: false,
          intent: understanding.intent,
          reasoning: reasoningSteps,
          needsClarification: understanding.needsClarification,
          confidence: understanding.confidence
        };
      }

      // STEP 2: PLAN - How should we accomplish this?
      const plan = await this.stepPlan(userCommand, understanding.intent, reasoningSteps);

      // STEP 3: VALIDATE - Is this safe and allowed?
      const validation = await this.stepValidate(
        plan.action,
        hasModerationPerms,
        message.channel as TextChannel,
        reasoningSteps
      );

      if (validation.blocked) {
        return {
          understood: true,
          intent: understanding.intent,
          reasoning: reasoningSteps,
          safetyWarning: validation.reason,
          confidence: 1.0
        };
      }

      // STEP 4: EXECUTE (preparation)
      const executionPlan = await this.stepPrepareExecution(plan.action!, reasoningSteps);

      console.log(`✅ Cognitive orchestration complete`);
      console.log(`   Intent: ${understanding.intent}`);
      console.log(`   Action: ${plan.action?.action}`);
      console.log(`   Steps: ${reasoningSteps.length}`);
      console.log(`========================================\n`);

      return {
        understood: true,
        intent: understanding.intent,
        reasoning: reasoningSteps,
        action: plan.action,
        executionPlan,
        confidence: plan.confidence
      };

    } catch (error: any) {
      console.error('❌ Cognitive orchestration error:', error);
      return {
        understood: false,
        intent: 'Error in reasoning process',
        reasoning: reasoningSteps,
        needsClarification: `I encountered an error: ${error.message}`,
        confidence: 0
      };
    }
  }

  /**
   * STEP 1: UNDERSTAND - Deep intent recognition
   */
  private async stepUnderstand(
    command: string,
    reasoning: ReasoningStep[]
  ): Promise<{ intent: string; needsClarification?: string; confidence: number }> {
    console.log(`\n🔍 STEP 1: UNDERSTAND`);

    // Find relevant features for this command
    const relevantFeatures = FeatureRegistry.findRelevantFeatures(command);
    const featureContext = relevantFeatures.length > 0
      ? `\n**RELEVANT FEATURES I KNOW:**\n${relevantFeatures.map(f => `- ${f.name}: ${f.description}\n  Examples: ${f.examples.slice(0, 2).join(', ')}`).join('\n')}`
      : `\n**NOTE:** This command doesn't match any known features. It might be:
- A general conversation
- A new feature request
- A typo or unclear command`;

    const prompt = `You are BECAS, a Discord AI moderation bot analyzing a user command. Your job is to understand what the user REALLY wants.

COMMAND: "${command}"
${featureContext}

Analyze this command deeply:
1. What is the PRIMARY GOAL?
2. Does this match any of my known features?
3. Are there any CONSTRAINTS or CONDITIONS?
4. What is IMPLICIT (not stated but implied)?
5. Is there any AMBIGUITY that needs clarification?

Think step-by-step:

Example:
Command: "delete last 20 messages that contain FUD but keep important info"

Analysis:
1. PRIMARY GOAL: Clean up FUD (fear, uncertainty, doubt) messages
2. MATCHES FEATURE: delete_messages (bulk message deletion with filtering)
3. CONSTRAINTS:
   - Limited to last 20 messages
   - Must preserve "important information"
4. IMPLICIT:
   - User wants a smart filter, not blind deletion
   - "Important info" likely means facts, data, links
5. AMBIGUITY:
   - What defines "important information"?
   - What if a message is both FUD and important?

Your analysis of "${command}":`;

    const response = await this.reasoningLLM.generate(
      prompt,
      'You are a reasoning AI. Think deeply and explain your understanding.',
      { temperature: 0.3, maxTokens: 400 }
    );

    console.log(`💭 Understanding: ${response.substring(0, 200)}...`);

    // Extract intent
    const intentMatch = response.match(/PRIMARY GOAL[:\s]+([^\n]+)/i);
    const intent = intentMatch ? intentMatch[1].trim() : 'Execute moderation command';

    // Check for ambiguity
    const needsClarification = response.toLowerCase().includes('ambiguous') ||
                              response.toLowerCase().includes('unclear')
      ? this.extractClarificationQuestion(response)
      : undefined;

    const confidence = needsClarification ? 0.5 : 0.9;

    reasoning.push({
      step: 1,
      phase: 'understand',
      thought: response.substring(0, 300),
      decision: intent,
      confidence
    });

    return { intent, needsClarification, confidence };
  }

  /**
   * STEP 2: PLAN - Break down into actionable steps
   */
  private async stepPlan(
    command: string,
    intent: string,
    reasoning: ReasoningStep[]
  ): Promise<{ action?: StructuredAction; confidence: number }> {
    console.log(`\n📋 STEP 2: PLAN`);

    // Use existing StructuredActionParser to generate action plan
    const action = await this.actionParser.parseCommand(
      command,
      {} as TextChannel // Temp workaround - we'll fix this in integration
    );

    if (!action) {
      reasoning.push({
        step: 2,
        phase: 'plan',
        thought: 'Could not create a structured action plan from this command',
        confidence: 0
      });
      return { confidence: 0 };
    }

    const planDescription = `
Action: ${action.action}
Scope: ${action.scope.type} (${action.scope.count || 'all'})
Filters: ${JSON.stringify(action.filters || {})}
Parameters: ${JSON.stringify(action.parameters || {})}
`;

    console.log(`📝 Plan created:`);
    console.log(planDescription);

    reasoning.push({
      step: 2,
      phase: 'plan',
      thought: `Created execution plan: ${action.action} on ${action.scope.type}`,
      decision: planDescription.trim(),
      confidence: action.confidence
    });

    return { action, confidence: action.confidence };
  }

  /**
   * STEP 3: VALIDATE - Safety and permission checks
   */
  private async stepValidate(
    action: StructuredAction | undefined,
    hasModerationPerms: boolean,
    channel: TextChannel,
    reasoning: ReasoningStep[]
  ): Promise<{ blocked: boolean; reason?: string }> {
    console.log(`\n🛡️ STEP 3: VALIDATE`);

    if (!action) {
      reasoning.push({
        step: 3,
        phase: 'validate',
        thought: 'No action to validate - blocked',
        decision: 'BLOCKED: No executable action',
        confidence: 1.0
      });
      return { blocked: true, reason: 'No action could be determined' };
    }

    // Permission check
    const requiresModPerms = ['bulk_delete', 'ban', 'timeout', 'kick', 'mute'].includes(action.action);
    if (requiresModPerms && !hasModerationPerms) {
      const reason = `Action "${action.action}" requires moderation permissions`;
      reasoning.push({
        step: 3,
        phase: 'validate',
        thought: reason,
        decision: 'BLOCKED: Insufficient permissions',
        confidence: 1.0
      });
      return { blocked: true, reason };
    }

    // Safety check - analyze potential impact
    const riskLevel = this.assessRiskLevel(action);
    console.log(`⚠️ Risk level: ${riskLevel}`);

    if (riskLevel === 'high') {
      const reason = `This action has high risk - bulk ${action.action} on ${action.scope.count || 'many'} items`;
      reasoning.push({
        step: 3,
        phase: 'validate',
        thought: reason,
        decision: 'WARNING: High risk action - proceeding with caution',
        confidence: 0.7
      });
      // Don't block, but warn
    }

    reasoning.push({
      step: 3,
      phase: 'validate',
      thought: `Safety checks passed. Risk: ${riskLevel}, Permissions: ${hasModerationPerms ? 'OK' : 'NONE'}`,
      decision: 'APPROVED',
      confidence: 0.95
    });

    console.log(`✅ Validation passed`);
    return { blocked: false };
  }

  /**
   * STEP 4: PREPARE EXECUTION - Create execution plan
   */
  private async stepPrepareExecution(
    action: StructuredAction,
    reasoning: ReasoningStep[]
  ): Promise<string[]> {
    console.log(`\n⚙️ STEP 4: PREPARE EXECUTION`);

    const steps: string[] = [];

    if (action.action === 'bulk_delete') {
      steps.push(`1. Fetch last ${action.scope.count || 100} messages`);
      if (action.filters?.contentType) {
        steps.push(`2. Filter for: ${action.filters.contentType.join(', ')}`);
      }
      steps.push(`3. Delete filtered messages`);
      steps.push(`4. Report results to user`);
    } else if (action.action === 'ban' || action.action === 'timeout') {
      steps.push(`1. Scan recent messages for violations`);
      if (action.filters?.contentType) {
        steps.push(`2. Identify users with: ${action.filters.contentType.join(', ')}`);
      }
      steps.push(`3. Apply ${action.action} to violators`);
      steps.push(`4. Notify user of results`);
    }

    reasoning.push({
      step: 4,
      phase: 'execute',
      thought: `Prepared ${steps.length}-step execution plan`,
      decision: steps.join(' → '),
      confidence: 0.9
    });

    console.log(`📋 Execution plan (${steps.length} steps):`);
    steps.forEach(step => console.log(`   ${step}`));

    return steps;
  }

  /**
   * STEP 5: REFLECT - Learn from outcome (called after execution)
   */
  async reflect(
    action: StructuredAction,
    result: { success: boolean; message: string; affectedCount: number },
    userFeedback?: string
  ): Promise<void> {
    console.log(`\n🔄 STEP 5: REFLECT`);
    console.log(`   Success: ${result.success}`);
    console.log(`   Affected: ${result.affectedCount}`);
    console.log(`   Feedback: ${userFeedback || 'none'}`);

    const prompt = `You are an AI reflecting on the outcome of an action you took.

ACTION TAKEN:
${JSON.stringify(action, null, 2)}

RESULT:
Success: ${result.success}
Message: ${result.message}
Items affected: ${result.affectedCount}

USER FEEDBACK: ${userFeedback || 'No feedback yet'}

Reflect on this outcome:
1. Did it achieve the intended goal?
2. Were there any unexpected results?
3. What could be improved next time?
4. What pattern should be remembered?

Your reflection (be honest and insightful):`;

    const reflection = await this.reasoningLLM.generate(
      prompt,
      'You are a self-reflective AI learning from experience.',
      { temperature: 0.4, maxTokens: 300 }
    );

    console.log(`💭 Reflection: ${reflection.substring(0, 200)}...`);

    // TODO: Store this reflection in a learning database
    // This is where RLHF-style learning would happen
  }

  /**
   * Helper: Extract clarification question from analysis
   */
  private extractClarificationQuestion(analysis: string): string {
    const lines = analysis.split('\n');
    for (const line of lines) {
      if (line.includes('?') && (line.toLowerCase().includes('what') ||
                                  line.toLowerCase().includes('how') ||
                                  line.toLowerCase().includes('which'))) {
        return line.trim();
      }
    }
    return 'Could you clarify what you mean?';
  }

  /**
   * Helper: Assess risk level of an action
   */
  private assessRiskLevel(action: StructuredAction): 'low' | 'medium' | 'high' {
    const { action: actionType, scope } = action;

    // High risk: Ban or bulk operations on many items
    if (actionType === 'ban') return 'high';
    if (scope.count && scope.count > 50) return 'high';

    // Medium risk: Timeout or moderate bulk operations
    if (actionType === 'timeout' || actionType === 'kick') return 'medium';
    if (scope.count && scope.count > 10) return 'medium';

    // Low risk: Everything else
    return 'low';
  }

  /**
   * Helper: Format reasoning chain for display
   */
  formatReasoningChain(reasoning: ReasoningStep[]): string {
    let output = '**🧠 Reasoning Process:**\n\n';

    for (const step of reasoning) {
      const emoji = this.getPhaseEmoji(step.phase);
      output += `${emoji} **Step ${step.step} - ${step.phase.toUpperCase()}**\n`;
      output += `${step.thought.substring(0, 150)}...\n`;
      if (step.decision) {
        output += `→ Decision: ${step.decision}\n`;
      }
      output += `Confidence: ${(step.confidence * 100).toFixed(0)}%\n\n`;
    }

    return output;
  }

  private getPhaseEmoji(phase: string): string {
    const emojis: Record<string, string> = {
      'understand': '🔍',
      'plan': '📋',
      'validate': '🛡️',
      'execute': '⚙️',
      'reflect': '🔄'
    };
    return emojis[phase] || '🤔';
  }
}
