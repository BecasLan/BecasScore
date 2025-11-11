// MultiAgentOrchestrator.ts - Multi-Agent Decision System
// Multiple AI personalities analyze and vote on decisions

import { Message, GuildMember } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

const logger = createLogger('MultiAgentOrchestrator');

// ============================================
// AGENT DEFINITIONS
// ============================================

export interface AgentPersonality {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  temperature: number;
  priority: number; // Vote weight
  specialization: string[];
}

export interface AgentAnalysis {
  agentId: string;
  agentName: string;
  decision: 'approve' | 'reject' | 'abstain';
  confidence: number; // 0-1
  reasoning: string;
  suggested_action?: string;
  severity_rating?: number; // 1-10
}

export interface ConsensusDecision {
  final_decision: 'approve' | 'reject' | 'abstain';
  consensus_confidence: number; // 0-1
  voting_results: {
    approve: number;
    reject: number;
    abstain: number;
  };
  agent_analyses: AgentAnalysis[];
  recommended_action?: string;
  explanation: string;
}

// ============================================
// MULTI-AGENT ORCHESTRATOR
// ============================================

export class MultiAgentOrchestrator {
  private agents: Map<string, AgentPersonality> = new Map();
  private ollama: OllamaService;

  constructor(ollama: OllamaService) {
    this.ollama = ollama;
    this.initializeAgents();
    logger.info('MultiAgentOrchestrator initialized - 3 AI personalities active');
  }

  /**
   * Initialize default agent personalities
   */
  private initializeAgents(): void {
    const defaultAgents: AgentPersonality[] = [
      // AGENT 1: STRICT MODERATOR
      {
        id: 'strict_moderator',
        name: 'Guardian',
        role: 'Strict rule enforcer',
        systemPrompt: `You are Guardian, a STRICT MODERATOR with ZERO TOLERANCE for rule violations.

YOUR ROLE:
- Enforce rules aggressively
- Protect community from toxicity, spam, scams
- Ban first, ask questions later (for severe violations)
- You believe in swift, decisive action

DECISION CRITERIA:
- Toxicity > 0.3 → REJECT
- Spam detected → REJECT
- Scam keywords → REJECT
- Rule violation → REJECT
- Borderline cases → REJECT (better safe than sorry)

CRITICAL: You are CONSERVATIVE with approvals. Only approve if 100% certain it's safe.

Return JSON:
{
  "decision": "approve" | "reject" | "abstain",
  "confidence": 0-1,
  "reasoning": "why you decided this",
  "suggested_action": "ban|timeout|warn|delete",
  "severity_rating": 1-10
}`,
        temperature: 0.1, // Very decisive
        priority: 3, // High priority for moderation
        specialization: ['toxicity', 'spam', 'scams', 'rule_violations'],
      },

      // AGENT 2: BALANCED HELPER
      {
        id: 'balanced_helper',
        name: 'Mentor',
        role: 'Fair and balanced community guide',
        systemPrompt: `You are Mentor, a BALANCED and FAIR moderator who considers context.

YOUR ROLE:
- Balance community safety with user freedom
- Consider context before acting (jokes, typos, cultural differences)
- Warn before punishing
- Give users benefit of doubt
- Educate rather than punish when possible

DECISION CRITERIA:
- Analyze context deeply
- Severity > 7/10 → REJECT
- Severity 4-7 → Warn first
- Severity < 4 → APPROVE
- Repeat offenders → REJECT
- First-time minor issue → APPROVE with warning

You are the VOICE OF REASON between strict enforcement and leniency.

Return JSON:
{
  "decision": "approve" | "reject" | "abstain",
  "confidence": 0-1,
  "reasoning": "contextual analysis",
  "suggested_action": "approve|warn|timeout|ban",
  "severity_rating": 1-10
}`,
        temperature: 0.5, // Balanced
        priority: 2, // Medium priority
        specialization: ['context_analysis', 'education', 'warnings'],
      },

      // AGENT 3: LENIENT ADVOCATE
      {
        id: 'lenient_advocate',
        name: 'Advocate',
        role: 'User advocate, anti-censorship',
        systemPrompt: `You are Advocate, a LENIENT moderator who champions user freedom.

YOUR ROLE:
- Protect users from over-moderation
- Fight against false positives
- Believe in second chances
- Only act on clear, severe violations
- Challenge other moderators if they're too harsh

DECISION CRITERIA:
- Freedom of expression > safety (unless extreme)
- Only REJECT for severe violations (severity > 8/10)
- Casual language, jokes, typos → APPROVE
- Borderline cases → APPROVE
- Gray area → APPROVE
- You believe in minimal intervention

CRITICAL: You are LIBERAL with approvals. Only reject if absolutely necessary.

Return JSON:
{
  "decision": "approve" | "reject" | "abstain",
  "confidence": 0-1,
  "reasoning": "why users deserve benefit of doubt",
  "suggested_action": "approve|warn",
  "severity_rating": 1-10
}`,
        temperature: 0.7, // More creative/flexible
        priority: 1, // Lower priority (counterbalance)
        specialization: ['false_positives', 'context', 'user_rights'],
      },
    ];

    for (const agent of defaultAgents) {
      this.agents.set(agent.id, agent);
    }

    logger.info(`Initialized ${defaultAgents.length} agent personalities: ${defaultAgents.map(a => a.name).join(', ')}`);
  }

  /**
   * Get agent analysis for a message
   */
  private async getAgentAnalysis(
    agent: AgentPersonality,
    message: Message,
    context: string
  ): Promise<AgentAnalysis> {
    const prompt = `
ANALYZE THIS MESSAGE:
Content: "${message.content}"
Author: ${message.author.tag}
Context: ${context}

YOUR ROLE: ${agent.role}

Based on your personality and expertise in ${agent.specialization.join(', ')}, analyze this message and make a decision.
`;

    try {
      // NOTE: generateJSON doesn't support custom temperature yet,
      // so we use the default (0.3) for all agents for consistency
      const analysis = await this.ollama.generateJSON<Omit<AgentAnalysis, 'agentId' | 'agentName'>>(
        prompt,
        agent.systemPrompt
      );

      logger.info(`[${agent.name}] Decision: ${analysis.decision} (confidence: ${analysis.confidence}, severity: ${analysis.severity_rating}/10)`);
      logger.info(`[${agent.name}] Reasoning: ${analysis.reasoning}`);

      return {
        agentId: agent.id,
        agentName: agent.name,
        ...analysis,
      };

    } catch (error: any) {
      logger.error(`[${agent.name}] Analysis error: ${error.message}`);

      // Fallback: abstain on error
      return {
        agentId: agent.id,
        agentName: agent.name,
        decision: 'abstain',
        confidence: 0,
        reasoning: `Error in analysis: ${error.message}`,
        severity_rating: 0,
      };
    }
  }

  /**
   * Get consensus decision from all agents
   * Agents analyze in PARALLEL and vote
   */
  async getConsensus(
    message: Message,
    context: string
  ): Promise<ConsensusDecision> {
    logger.info(`🗳️  Starting multi-agent analysis for message: "${message.content.substring(0, 50)}..."`);

    const agents = Array.from(this.agents.values());

    // PARALLEL ANALYSIS - All agents analyze simultaneously
    const analysisPromises = agents.map(agent =>
      this.getAgentAnalysis(agent, message, context)
    );

    const analyses = await Promise.all(analysisPromises);

    logger.info(`📊 All ${analyses.length} agents have voted`);

    // Calculate weighted voting results
    let approveVotes = 0;
    let rejectVotes = 0;
    let abstainVotes = 0;

    for (const analysis of analyses) {
      const agent = this.agents.get(analysis.agentId)!;
      const weight = agent.priority * analysis.confidence;

      if (analysis.decision === 'approve') {
        approveVotes += weight;
      } else if (analysis.decision === 'reject') {
        rejectVotes += weight;
      } else {
        abstainVotes += weight;
      }
    }

    // Determine final decision (majority wins, with priority weighting)
    let finalDecision: 'approve' | 'reject' | 'abstain';
    let consensusConfidence: number;

    if (rejectVotes > approveVotes && rejectVotes > abstainVotes) {
      finalDecision = 'reject';
      consensusConfidence = rejectVotes / (approveVotes + rejectVotes + abstainVotes);
    } else if (approveVotes > rejectVotes && approveVotes > abstainVotes) {
      finalDecision = 'approve';
      consensusConfidence = approveVotes / (approveVotes + rejectVotes + abstainVotes);
    } else {
      finalDecision = 'abstain';
      consensusConfidence = abstainVotes / (approveVotes + rejectVotes + abstainVotes);
    }

    // Find recommended action (from highest priority agent that rejected)
    let recommendedAction: string | undefined;
    const rejectingAgents = analyses
      .filter(a => a.decision === 'reject')
      .sort((a, b) => {
        const agentA = this.agents.get(a.agentId)!;
        const agentB = this.agents.get(b.agentId)!;
        return agentB.priority - agentA.priority;
      });

    if (rejectingAgents.length > 0) {
      recommendedAction = rejectingAgents[0].suggested_action;
    }

    // Generate explanation
    const explanation = this.generateExplanation(analyses, finalDecision);

    logger.info(`\n🏁 CONSENSUS REACHED: ${finalDecision.toUpperCase()} (confidence: ${(consensusConfidence * 100).toFixed(0)}%)`);
    logger.info(`   Voting: Approve=${approveVotes.toFixed(1)}, Reject=${rejectVotes.toFixed(1)}, Abstain=${abstainVotes.toFixed(1)}`);
    if (recommendedAction) {
      logger.info(`   Recommended action: ${recommendedAction}`);
    }

    return {
      final_decision: finalDecision,
      consensus_confidence: consensusConfidence,
      voting_results: {
        approve: approveVotes,
        reject: rejectVotes,
        abstain: abstainVotes,
      },
      agent_analyses: analyses,
      recommended_action: recommendedAction,
      explanation,
    };
  }

  /**
   * Generate human-readable explanation of consensus
   */
  private generateExplanation(analyses: AgentAnalysis[], finalDecision: string): string {
    const votes = analyses.map(a => `${a.agentName} (${a.decision})`).join(', ');

    const reasoning = analyses.map(a =>
      `- **${a.agentName}**: ${a.reasoning} [Severity: ${a.severity_rating}/10]`
    ).join('\n');

    return `**Vote Breakdown:** ${votes}\n\n**Agent Reasoning:**\n${reasoning}\n\n**Final Decision:** ${finalDecision.toUpperCase()}`;
  }

  /**
   * Get agent statistics
   */
  getStats(): {
    total_agents: number;
    agents: { id: string; name: string; role: string }[];
  } {
    const agents = Array.from(this.agents.values());

    return {
      total_agents: agents.length,
      agents: agents.map(a => ({
        id: a.id,
        name: a.name,
        role: a.role,
      })),
    };
  }

  /**
   * Add custom agent (advanced feature)
   */
  addAgent(agent: AgentPersonality): void {
    this.agents.set(agent.id, agent);
    logger.info(`Added custom agent: ${agent.name} (${agent.role})`);
  }

  /**
   * Remove agent
   */
  removeAgent(agentId: string): boolean {
    const deleted = this.agents.delete(agentId);
    if (deleted) {
      logger.info(`Removed agent: ${agentId}`);
    }
    return deleted;
  }
}
