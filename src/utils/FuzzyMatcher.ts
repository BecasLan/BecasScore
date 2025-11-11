/**
 * FUZZY MATCHING - AI-Powered Typo Correction
 *
 * "dolete" → "delete"
 * "bannuser" → "ban user"
 * "tiemout" → "timeout"
 * "sil şu mesajları" → "sil şu mesajları" (no change, correct Turkish)
 * "dolete son 5 mesaj" → "delete son 5 mesaj"
 *
 * Uses:
 * 1. Levenshtein distance for simple typos
 * 2. Qwen3:8b AI for context-aware correction (Turkish + English)
 */

import { OllamaService } from '../services/OllamaService';

export class FuzzyMatcher {
  private static aiCorrector: OllamaService | null = null;

  /**
   * Initialize AI corrector (lazy loading)
   */
  private static getAICorrector(): OllamaService {
    if (!this.aiCorrector) {
      this.aiCorrector = new OllamaService('cognitive'); // Qwen3:8b for context
      console.log('🔧 FuzzyMatcher: Initialized AI typo correction with Qwen3:8b');
    }
    return this.aiCorrector;
  }
  /**
   * Calculate Levenshtein distance between two strings
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Find closest match from a list of valid words
   */
  static findClosestMatch(input: string, validWords: string[], maxDistance: number = 2): string | null {
    let closest: string | null = null;
    let minDistance = Infinity;

    const inputLower = input.toLowerCase();

    for (const word of validWords) {
      const distance = this.levenshteinDistance(inputLower, word.toLowerCase());
      if (distance < minDistance && distance <= maxDistance) {
        minDistance = distance;
        closest = word;
      }
    }

    return closest;
  }

  /**
   * 🧠 AI-POWERED TYPO CORRECTION (Async, uses Qwen3:8b)
   */
  static async fixTyposAI(message: string): Promise<string> {
    // Skip if message is short or looks fine
    if (message.length < 10) return message;

    try {
      const prompt = `Fix typos in this Discord moderation command. Keep the meaning EXACTLY the same, only fix obvious typos.

**RULES:**
1. Fix obvious typos (dolete → delete, bannuser → ban user, tiemout → timeout)
2. Keep Turkish words as-is (sil, kullanıcı, mesaj, etc.)
3. Keep numbers and mentions unchanged
4. If no typos found, return ORIGINAL message
5. DO NOT change the command meaning or structure

**INPUT:** "${message}"

**OUTPUT (corrected text only, no explanations):**`;

      const systemPrompt = `You are a typo correction assistant for Discord moderation commands.
Support both English and Turkish.
Only fix OBVIOUS typos.`;

      const ai = this.getAICorrector();
      const corrected = await ai.generate(prompt, systemPrompt);

      // Trim and clean
      const fixed = corrected.trim().replace(/^["']|["']$/g, ''); // Remove quotes if AI added them

      // Only log if actual change was made
      if (fixed !== message) {
        console.log(`🔧 AI Typo Correction: "${message}" → "${fixed}"`);
        return fixed;
      }

      return message;
    } catch (error) {
      console.error('AI typo correction failed, falling back to original:', error);
      return message; // Return original if AI fails
    }
  }

  /**
   * Fix common typos in message content (FAST, synchronous fallback)
   */
  static fixTypos(message: string): string {
    const commonWords = [
      // Moderation commands (English)
      'delete', 'ban', 'kick', 'timeout', 'warn', 'mute', 'unmute', 'purge', 'clear',
      // Moderation commands (Turkish)
      'sil', 'yasakla', 'at', 'sustur', 'uyar', 'temizle',
      // Analytics
      'analyze', 'check', 'show', 'list', 'find', 'score', 'trust', 'stats',
      'analiz', 'kontrol', 'göster', 'listele', 'bul', 'skor', 'güven', 'istatistik',
      // Common words
      'user', 'users', 'message', 'messages', 'please', 'can', 'you',
      'last', 'first', 'all', 'recent', 'this', 'that',
      'kullanıcı', 'kullanıcılar', 'mesaj', 'mesajlar', 'lütfen',
      'son', 'ilk', 'tüm', 'hepsi', 'bu', 'şu',
    ];

    const words = message.split(/\s+/);
    const fixed = words.map(word => {
      // Skip short words (< 4 chars)
      if (word.length < 4) return word;

      // Skip mentions and numbers
      if (word.startsWith('<@') || /^\d+$/.test(word)) return word;

      // Check if word is already valid
      if (commonWords.some(valid => valid.toLowerCase() === word.toLowerCase())) {
        return word;
      }

      // Try to find close match
      const match = this.findClosestMatch(word, commonWords, 2);
      if (match) {
        console.log(`🔧 Quick Typo Correction: "${word}" → "${match}"`);
        return match;
      }

      return word;
    });

    return fixed.join(' ');
  }
}
