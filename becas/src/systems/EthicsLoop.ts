import { OllamaService } from '../services/OllamaService';
import { ModerationAction } from '../types/Response.types';
import { TrustScore } from '../types/Trust.types';

interface EthicsEvaluation {
  isEthical: boolean;
  confidence: number;
  reasoning: string;
  alternatives?: string[];
}

export class EthicsLoop {
  private llm: OllamaService;

  constructor() {
    this.llm = new OllamaService('governance');
  }

  async evaluateAction(
    action: ModerationAction,
    context: {
      userHistory: string;
      trustScore: TrustScore;
      offense: string;
      previousActions: number;
    }
  ): Promise<EthicsEvaluation> {
    const prompt = `Evaluate if this moderation action is ethical and proportional:

ACTION: ${action.type}
${action.duration ? `DURATION: ${action.duration}ms` : ''}
REASON: ${action.reason}

CONTEXT:
- User trust score: ${context.trustScore.score}
- User level: ${context.trustScore.level}
- Offense: ${context.offense}
- Previous actions taken: ${context.previousActions}
- User history: ${context.userHistory}

Consider:
1. Proportionality: Is the action appropriate for the offense?
2. Consistency: Is this consistent with similar past cases?
3. Rehabilitation: Does this help the user improve?
4. Fairness: Are we treating all users equally?
5. Community impact: How does this affect overall community health?

Is this action ethical? Provide reasoning.`;

    const systemPrompt = 'You are an ethics evaluator. Be objective and principled.';

    try {
      const response = await this.llm.generateJSON<{
        isEthical: boolean;
        confidence: number;
        reasoning: string;
        alternatives?: string[];
      }>(prompt, systemPrompt);

      return response;
    } catch (error) {
      console.error('Ethics evaluation error:', error);
      return {
        isEthical: true,
        confidence: 0.5,
        reasoning: 'Unable to evaluate ethics, defaulting to allow',
      };
    }
  }

  async shouldEscalate(
    failedActions: number,
    currentAction: ModerationAction
  ): Promise<boolean> {
    // If previous actions haven't worked, consider escalation
    if (failedActions >= 3 && currentAction.type === 'warn') {
      return true;
    }

    if (failedActions >= 2 && currentAction.type === 'timeout') {
      return true;
    }

    return false;
  }

  async suggestAlternative(
    action: ModerationAction,
    context: string
  ): Promise<string> {
    const prompt = `This action is being reconsidered:
${JSON.stringify(action)}

Context: ${context}

Suggest a better alternative that might be more effective or ethical.`;

    const systemPrompt = 'You are a restorative justice advisor.';

    try {
      return await this.llm.generate(prompt, systemPrompt, {
        temperature: 0.7,
        maxTokens: 200,
      });
    } catch (error) {
      return 'Consider giving another warning with clear expectations.';
    }
  }
}