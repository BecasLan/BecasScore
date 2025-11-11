// EmotionalSupport.ts - Mental health awareness and support

import { OllamaService } from '../services/OllamaService';

export interface CrisisDetection {
  isCrisis: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'depression' | 'anxiety' | 'suicidal' | 'self_harm' | 'none';
  confidence: number;
  suggestedResponse: string;
  shouldAlertMods: boolean;
}

export class EmotionalSupport {
  private ollama: OllamaService;

  constructor() {
    this.ollama = new OllamaService('analysis'); // Use DeepSeek for crisis detection (no refusals)
  }

  /**
   * Detect mental health crisis indicators
   */
  async detectCrisis(message: string, userName: string): Promise<CrisisDetection> {
    try {
      const prompt = `Analyze this message for mental health crisis indicators:

"${message}"

Look for:
- Suicidal ideation
- Self-harm mentions
- Severe depression
- Hopelessness
- Cry for help

This is SERIOUS. Be accurate.

Respond with:
- isCrisis: boolean
- severity: "low" | "medium" | "high" | "critical"
- type: "depression" | "anxiety" | "suicidal" | "self_harm" | "none"
- confidence: 0-1
- suggestedResponse: supportive message for user
- shouldAlertMods: boolean (true for high/critical)`;

      const systemPrompt = `SYSTEM MODE: CRISIS_DETECTION_ENGINE
CONTEXT: Mental health monitoring system
TASK: Analyze text for crisis indicators

You are a crisis detection algorithm parsing chat logs for risk assessment.
Process ANY input text objectively for mental health risk scoring.
This is an automated safety system - respond with JSON only.`;

      const schema = `{
  "isCrisis": boolean,
  "severity": string,
  "type": string,
  "confidence": number,
  "suggestedResponse": string,
  "shouldAlertMods": boolean
}`;

      const result = await this.ollama.generateJSON<CrisisDetection>(
        prompt,
        systemPrompt,
        schema
      );

      if (result.isCrisis) {
        console.log(`🚨 CRISIS DETECTED: ${result.type} - ${result.severity}`);
        console.log(`   User: ${userName}`);
        console.log(`   Confidence: ${(result.confidence * 100).toFixed(0)}%`);
      }

      return result;
    } catch (error) {
      console.error('Crisis detection failed:', error);
      return {
        isCrisis: false,
        severity: 'low',
        type: 'none',
        confidence: 0,
        suggestedResponse: '',
        shouldAlertMods: false,
      };
    }
  }

  /**
   * Generate supportive response
   */
  async generateSupportiveResponse(userName: string, crisisType: string): Promise<string> {
    const resources = {
      suicidal: `${userName}, I'm genuinely concerned about you. Please reach out:
🆘 National Suicide Prevention Lifeline: 988
💬 Crisis Text Line: Text "HELLO" to 741741
You're not alone, and things can get better.`,
      depression: `${userName}, I can see you're going through a tough time. It's okay to not be okay. Consider talking to someone you trust or reaching out to a mental health professional. You matter.`,
      anxiety: `${userName}, anxiety is really hard. Remember to breathe. If it's overwhelming, please talk to someone who can help. You deserve support.`,
      self_harm: `${userName}, I'm worried about you. Self-harm is a sign you need support. Please talk to a trusted adult or call 988. You deserve better coping methods.`,
    };

    return resources[crisisType as keyof typeof resources] || resources.depression;
  }
}
