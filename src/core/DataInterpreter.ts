import { OllamaService } from '../services/OllamaService';

/**
 * DataInterpreter - AI can analyze and interpret its own outputs
 * Makes Becas a true analyst that understands the data it produces
 */
export class DataInterpreter {
  private analyzer: OllamaService;
  private conversationMemory: Map<string, string[]> = new Map(); // Track AI's own outputs

  constructor() {
    this.analyzer = new OllamaService('analysis'); // Use DeepSeek for deep reasoning
    console.log('🔬 DataInterpreter initialized - AI can now interpret its own data');
  }

  /**
   * Store AI's own output for future reference
   */
  rememberOutput(channelId: string, output: string): void {
    const memory = this.conversationMemory.get(channelId) || [];
    memory.push(output);

    // Keep last 10 outputs
    if (memory.length > 10) {
      memory.shift();
    }

    this.conversationMemory.set(channelId, memory);
    console.log(`💾 Stored output in memory for channel ${channelId}`);
  }

  /**
   * Interpret data/output that AI previously generated
   * This allows AI to understand commands like "who is high-risk from that list?"
   */
  async interpretPreviousOutput(
    userQuery: string,
    channelId: string,
    userId: string,
    userName: string
  ): Promise<string> {
    const recentOutputs = this.conversationMemory.get(channelId) || [];

    if (recentOutputs.length === 0) {
      return `<@${userId}>, I haven't shared any data in this channel yet. Could you be more specific about what you'd like me to analyze?`;
    }

    // Get the most recent output that looks like data
    const dataOutput = recentOutputs.reverse().find(output =>
      output.includes('Trust Score') ||
      output.includes('trust score') ||
      output.includes('Server Analysis') ||
      output.includes('User Analysis') ||
      output.includes('Key Insights') ||
      output.includes('|') ||
      output.includes('---') ||
      output.includes('Average') ||
      output.includes('members') ||
      output.match(/\d+\s*-/) ||  // Numbered list
      output.match(/[\u{1F300}-\u{1F9FF}]/u)  // Contains emoji (indicates formatted output)
    );

    if (!dataOutput) {
      return `<@${userId}>, I don't see any data tables or lists in my recent responses. What information are you looking for?`;
    }

    console.log(`🔍 AI analyzing its own output for user query: "${userQuery}"`);

    const prompt = `You are an AI analyst reviewing data you previously generated. A user is asking you to interpret this data.

YOUR PREVIOUS OUTPUT:
${dataOutput}

USER'S QUESTION:
${userQuery}

ANALYSIS INSTRUCTIONS:
1. Carefully read and understand the data YOU generated
2. Answer the user's specific question based on that data
3. Be specific - mention names, numbers, and details from the data
4. If asking about "high-risk" or similar, identify users with:
   - Low trust scores (<50)
   - High toxicity
   - Warnings or violations
5. Format your response naturally, addressing the user as <@${userId}>

Remember: You are analyzing YOUR OWN data output. Be confident and precise.

Your analytical response:`;

    try {
      console.log(`🤖 Sending interpretation request to LLM...`);
      const analysis = await this.analyzer.generate(
        prompt,
        'You are a data analyst AI that can interpret its own outputs. Be precise and helpful.',
        { temperature: 0.4, maxTokens: 400 } // Increased for reliability
      );

      console.log(`📨 LLM interpretation response: "${analysis}"`);
      console.log(`📏 Response length: ${analysis.length} chars`);

      const cleaned = analysis.trim();
      console.log(`🧹 Cleaned response length: ${cleaned.length} chars`);

      // 🔥 CRITICAL: If LLM returns empty, generate manual analysis
      if (!cleaned || cleaned.length === 0) {
        console.log(`⚠️ LLM returned empty interpretation - generating manual analysis`);
        console.log(`📊 Data output to analyze: "${dataOutput.substring(0, 200)}..."`);

        // Extract high-risk users from the data manually
        const highRiskMatch = dataOutput.match(/⚠️\s*(\d+)\s*high-risk/i);
        const avgTrustMatch = dataOutput.match(/Average trust score:\s*(\d+)/i);

        console.log(`🔍 Regex matches: highRisk=${highRiskMatch?.[1]}, avgTrust=${avgTrustMatch?.[1]}`);
        console.log(`🔍 Query includes 'dangerous': ${userQuery.toLowerCase().includes('dangerous')}`);

        if (highRiskMatch && userQuery.toLowerCase().includes('dangerous')) {
          const count = highRiskMatch[1];
          const response = `<@${userId}>, based on the server analysis, there are **${count} high-risk members** with trust scores below 30. These are the most concerning users from a moderation perspective. ${avgTrustMatch ? `The server average is ${avgTrustMatch[1]}/100.` : ''}`;
          console.log(`✅ Returning manual analysis: "${response}"`);
          return response;
        }

        // Generic fallback
        const fallback = `<@${userId}>, I found data in my recent output but I'm having difficulty analyzing it in detail. The analysis shows server statistics with trust scores and member counts. Could you ask a more specific question?`;
        console.log(`⚠️ Returning generic fallback: "${fallback}"`);
        return fallback;
      }

      console.log(`✅ Returning LLM analysis: "${cleaned.substring(0, 100)}..."`);
      return cleaned;
    } catch (error) {
      console.error('❌ Data interpretation error:', error);
      const errorResponse = `<@${userId}>, I'm having trouble analyzing that data right now. Could you rephrase your question?`;
      console.log(`❌ Returning error response: "${errorResponse}"`);
      return errorResponse;
    }
  }

  /**
   * Check if user query is asking about previous AI output
   * 🔥 AI-POWERED: No fragile patterns, pure intelligence
   */
  async isQueryingPreviousOutput(query: string, recentOutputs: string[]): Promise<boolean> {
    // Quick check: If no recent outputs, can't be querying them
    if (recentOutputs.length === 0) {
      console.log(`🧠 Intent Check: No recent outputs in memory, returning false`);
      return false;
    }

    console.log(`\n🔍 ===== AI INTENT DETECTION DEBUG =====`);
    console.log(`📝 User Query: "${query}"`);
    console.log(`📦 Memory has ${recentOutputs.length} recent outputs`);
    console.log(`📋 Recent outputs preview:`);
    recentOutputs.slice(-3).forEach((out, i) => {
      console.log(`  ${i + 1}. ${out.substring(0, 150)}...`);
    });

    // 🧠 AI Intent Detection: Let AI decide if user is referencing previous data
    const prompt = `You are an intent analyzer. A user just asked a question. You need to determine if they're asking about DATA that was ALREADY SHOWN to them.

USER'S QUESTION: "${query}"

RECENT AI OUTPUTS (these were already shown to the user):
${recentOutputs.slice(-3).map((out, i) => `${i + 1}. ${out.substring(0, 300)}...`).join('\n\n')}

CRITICAL THINKING:
1. Look at the RECENT AI OUTPUTS above - do they contain data (stats, lists, analysis, numbers)?
2. Look at the USER'S QUESTION - are they asking about that data?
3. Key indicators for YES:
   - User asks "who", "which", "what about", "how many" referring to data above
   - User asks for analysis/interpretation of data shown above
   - User uses reference words like "that", "those", "from above", "bunlardan", "o liste"
   - User asks about specific items from a list/table shown above

EXAMPLES:

If AI showed "Server Analysis: 4 members, 3 high-risk", then:
✅ YES: "who is most dangerous" (asking about the high-risk data)
✅ YES: "bunlardan kim tehlikeli" (same in Turkish)
✅ YES: "show me the risky ones" (asking about data shown)
✅ YES: "what about highest" (asking about rankings in data)
✅ YES: "second one?" (referring to list items)

❌ NO: "analyze this server" (NEW request, not about previous data)
❌ NO: "hello how are you" (greeting, not about data)
❌ NO: "ban that spammer" (command, not data query)

DECISION RULE: If there's data in RECENT AI OUTPUTS and user is asking about it, answer YES. Otherwise NO.

Respond with ONLY: YES or NO`;

    console.log(`\n🤖 Sending prompt to LLM (first 500 chars):`);
    console.log(prompt.substring(0, 500) + '...\n');

    try {
      const response = await this.analyzer.generate(
        prompt,
        'You are a precise intent classifier. Respond with only YES or NO.',
        { temperature: 0.3, maxTokens: 20 } // Increased temp & tokens for reliability
      );

      console.log(`📨 LLM raw response: "${response}"`);
      const decision = response.trim().toUpperCase();
      console.log(`🔍 Cleaned decision: "${decision}"`);

      // 🔥 CRITICAL FIX: If LLM returns empty or invalid response, use smart fallback
      if (!decision || decision.length === 0) {
        console.log(`⚠️ LLM returned empty response - using smart fallback`);
        // Smart fallback: If there's data in memory AND query contains question words, assume YES
        const hasQuestionWord = /\b(who|what|which|where|when|how|kim|ne|nerede|hangi)\b/i.test(query);
        const hasData = recentOutputs.some(out =>
          out.includes('Analysis') ||
          out.includes('trust score') ||
          out.includes('members') ||
          out.includes('📊')
        );
        const smartFallback = hasQuestionWord && hasData;
        console.log(`🧠 Smart Fallback: hasQuestionWord=${hasQuestionWord}, hasData=${hasData} → ${smartFallback ? 'QUERYING' : 'NEW'}`);
        console.log(`========================================\n`);
        return smartFallback;
      }

      const isQuerying = decision.includes('YES');

      console.log(`🧠 AI Intent: "${query}" → ${isQuerying ? 'QUERYING previous data' : 'NEW request'}`);
      console.log(`========================================\n`);
      return isQuerying;
    } catch (error) {
      console.error('Intent detection error:', error);
      // Fallback: Smart heuristic check
      const hasQuestionWord = /\b(who|what|which|where|when|how|kim|ne|nerede|hangi)\b/i.test(query);
      const hasData = recentOutputs.some(out =>
        out.includes('Analysis') ||
        out.includes('trust score') ||
        out.includes('members') ||
        out.includes('📊')
      );
      const smartFallback = hasQuestionWord && hasData;
      console.log(`⚠️ Error fallback - Smart heuristic: ${smartFallback}`);
      return smartFallback;
    }
  }

  /**
   * Analyze raw data and provide insights
   */
  async analyzeData(
    data: string,
    question: string,
    userId: string
  ): Promise<string> {
    console.log(`📊 AI analyzing data with question: "${question}"`);

    const prompt = `You are an AI data analyst. Analyze this data and answer the user's question.

DATA:
${data}

USER'S QUESTION:
${question}

Provide a clear, concise analysis addressing the user as <@${userId}>. Focus on:
- Key patterns and insights
- Specific numbers and facts
- Direct answer to their question

Your analysis:`;

    try {
      const analysis = await this.analyzer.generate(
        prompt,
        'You are a skilled data analyst. Be precise and insightful.',
        { temperature: 0.4, maxTokens: 300 }
      );

      return analysis.trim();
    } catch (error) {
      console.error('Data analysis error:', error);
      return `<@${userId}>, I encountered an error analyzing that data. Please try again.`;
    }
  }

  /**
   * Clear memory for a channel
   */
  clearMemory(channelId: string): void {
    this.conversationMemory.delete(channelId);
    console.log(`🧹 Cleared output memory for channel ${channelId}`);
  }

  /**
   * Get actual memory contents (not just summary)
   */
  getMemoryContents(channelId: string): string[] {
    return this.conversationMemory.get(channelId) || [];
  }

  /**
   * Get summary of what AI remembers
   */
  getMemorySummary(channelId: string): string {
    const memory = this.conversationMemory.get(channelId) || [];
    return `Remembered ${memory.length} recent outputs`;
  }
}
