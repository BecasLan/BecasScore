// AIJurySystem.ts - Multi-model consensus for critical decisions

import { OllamaService } from '../services/OllamaService';

export interface JuryVerdict {
  decision: 'ban' | 'timeout' | 'warn' | 'no_action';
  consensus: number; // 0-1, how much models agree
  votes: {
    model: string;
    decision: string;
    confidence: number;
    reasoning: string;
  }[];
  finalReasoning: string;
}

export class AIJurySystem {
  private models: string[] = ['llama3', 'mistral', 'qwen2.5']; // Multiple AI models

  /**
   * Get jury verdict on scam/ban decision
   */
  async getVerdict(
    message: string,
    context: string,
    questionType: 'scam' | 'toxicity' | 'harassment'
  ): Promise<JuryVerdict> {
    console.log(`⚖️ Convening AI Jury (${this.models.length} models)...`);

    const votes: JuryVerdict['votes'] = [];

    // Query each model
    for (const model of this.models) {
      try {
        const ollama = new OllamaService(model);

        const prompt = `Analyze this message for ${questionType}:

MESSAGE: "${message}"
CONTEXT: ${context}

Should moderation action be taken?

Respond with:
- decision: "ban" | "timeout" | "warn" | "no_action"
- confidence: 0-1
- reasoning: brief explanation`;

        const systemPrompt = `You are part of an AI jury. Be fair and accurate.`;

        const schema = `{
  "decision": string,
  "confidence": number,
  "reasoning": string
}`;

        const result = await ollama.generateJSON<{
          decision: string;
          confidence: number;
          reasoning: string;
        }>(prompt, systemPrompt, schema);

        votes.push({
          model,
          decision: result.decision,
          confidence: result.confidence,
          reasoning: result.reasoning,
        });

        console.log(`   ${model}: ${result.decision} (${(result.confidence * 100).toFixed(0)}%)`);
      } catch (error) {
        console.error(`Model ${model} failed:`, error);
      }
    }

    // Calculate consensus
    const decisionCounts = votes.reduce((acc, vote) => {
      acc[vote.decision] = (acc[vote.decision] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const majorityDecision = Object.entries(decisionCounts)
      .sort((a, b) => b[1] - a[1])[0][0] as JuryVerdict['decision'];

    const consensus = (decisionCounts[majorityDecision] || 0) / votes.length;

    const finalReasoning = votes
      .filter(v => v.decision === majorityDecision)
      .map(v => v.reasoning)
      .join('; ');

    console.log(`   📊 VERDICT: ${majorityDecision.toUpperCase()} (${(consensus * 100).toFixed(0)}% consensus)`);

    return {
      decision: majorityDecision,
      consensus,
      votes,
      finalReasoning,
    };
  }

  /**
   * Check if verdict should be trusted
   */
  isTrustworthy(verdict: JuryVerdict): boolean {
    return verdict.consensus >= 0.66; // 2/3+ agreement
  }
}
