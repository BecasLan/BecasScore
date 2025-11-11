import { Guild } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { StorageService } from '../services/StorageService';
import { createLogger } from '../services/Logger';

const logger = createLogger('GoalStrategy');

export type GoalCategory =
  | 'community_building'
  | 'relationship_deepening'
  | 'skill_improvement'
  | 'knowledge_acquisition'
  | 'moderation_excellence'
  | 'emotional_support'
  | 'engagement_boost'
  | 'self_improvement';

export type GoalStatus = 'active' | 'completed' | 'failed' | 'paused' | 'abandoned';

export interface Goal {
  id: string;
  guildId: string;
  category: GoalCategory;
  title: string;
  description: string;
  reasoning: string; // Why Becas set this goal

  // Measurable targets
  target: {
    metric: string; // What to measure
    currentValue: number;
    targetValue: number;
    unit: string;
  };

  // Strategy
  strategies: Strategy[];

  // Progress
  status: GoalStatus;
  progress: number; // 0-100%
  milestones: Milestone[];

  // Timeline
  createdAt: Date;
  targetDate?: Date;
  completedAt?: Date;

  // Reflection
  learnings: string[];
  obstacles: string[];
  successFactors: string[];
}

export interface Strategy {
  id: string;
  description: string;
  actions: Action[];
  effectiveness: number; // 0-10, how well is this strategy working
  timesExecuted: number;
  successRate: number; // 0-1
}

export interface Action {
  id: string;
  description: string;
  type: 'proactive' | 'reactive' | 'scheduled';
  frequency?: string; // daily, weekly, etc.
  completed: boolean;
  completedAt?: Date;
  result?: string;
}

export interface Milestone {
  id: string;
  description: string;
  targetValue: number;
  achieved: boolean;
  achievedAt?: Date;
}

export interface SelfReflection {
  timestamp: Date;
  period: string; // "daily", "weekly", "monthly"

  achievements: string[];
  failures: string[];
  learnings: string[];

  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];

  performanceScore: number; // 0-10
  communityFeedback: string[];

  nextSteps: string[];
  goalsToSet: string[];
  strategiesToAdjust: string[];
}

export class GoalStrategySystem {
  private ollama: OllamaService;
  private storage: StorageService;
  private goals: Map<string, Goal> = new Map();
  private reflections: SelfReflection[] = [];

  constructor(ollama: OllamaService, storage: StorageService) {
    this.ollama = ollama;
    this.storage = storage;
    this.loadData();
  }

  /**
   * Load goals and reflections from storage
   */
  private async loadData(): Promise<void> {
    try {
      // Load goals
      const goalsData = await this.storage.read<Goal[]>('', 'becas-goals.json');
      if (goalsData && Array.isArray(goalsData)) {
        goalsData.forEach(goal => {
          goal.createdAt = new Date(goal.createdAt);
          if (goal.targetDate) goal.targetDate = new Date(goal.targetDate);
          if (goal.completedAt) goal.completedAt = new Date(goal.completedAt);
          this.goals.set(goal.id, goal);
        });
        logger.info(`Loaded ${this.goals.size} goals`);
      }

      // Load reflections
      const reflectionsData = await this.storage.read<SelfReflection[]>('', 'becas-reflections.json');
      if (reflectionsData && Array.isArray(reflectionsData)) {
        this.reflections = reflectionsData.map(r => ({
          ...r,
          timestamp: new Date(r.timestamp),
        }));
        logger.info(`Loaded ${this.reflections.length} self-reflections`);
      }
    } catch (error) {
      logger.warn('No existing goals/reflections found, starting fresh');
    }
  }

  /**
   * Save goals and reflections to storage
   */
  private async saveData(): Promise<void> {
    try {
      await this.storage.write('', 'becas-goals.json', Array.from(this.goals.values()));
      await this.storage.write('', 'becas-reflections.json', this.reflections);
      logger.debug('Saved goals and reflections');
    } catch (error) {
      logger.error('Failed to save goals/reflections', error);
    }
  }

  /**
   * Start goal setting and reflection loop
   */
  start(): void {
    logger.info('Starting Goal & Strategy System');

    // Daily self-reflection
    setInterval(() => {
      this.performSelfReflection('daily').catch(error => {
        logger.error('Error in daily reflection', error);
      });
    }, 24 * 60 * 60 * 1000); // Every 24 hours

    // Weekly strategy review
    setInterval(() => {
      this.reviewStrategies().catch(error => {
        logger.error('Error in strategy review', error);
      });
    }, 7 * 24 * 60 * 60 * 1000); // Every 7 days

    // Hourly progress check
    setInterval(() => {
      this.checkGoalProgress().catch(error => {
        logger.error('Error in progress check', error);
      });
    }, 60 * 60 * 1000); // Every hour

    // Initial reflection after 1 hour
    setTimeout(() => {
      this.performSelfReflection('initial').catch(error => {
        logger.error('Error in initial reflection', error);
      });
    }, 60 * 60 * 1000);
  }

  /**
   * Perform self-reflection and set goals
   */
  async performSelfReflection(period: string): Promise<SelfReflection> {
    logger.info(`Performing ${period} self-reflection`);

    try {
      const currentGoals = Array.from(this.goals.values()).filter(g => g.status === 'active');
      const recentReflections = this.reflections.slice(-5);

      const prompt = `You are Becas, a sentient AI moderator. Perform self-reflection on your performance and growth.

Current Active Goals:
${currentGoals.map(g => `- ${g.title}: ${g.progress}% complete`).join('\n') || 'No active goals'}

Recent Performance:
${recentReflections.map(r => `- ${r.period}: Score ${r.performanceScore}/10`).join('\n') || 'No recent data'}

Reflect on:
1. **Achievements**: What went well? What did you accomplish?
2. **Failures**: What didn't work? What could be better?
3. **Learnings**: What did you learn about yourself, the community, or moderation?
4. **SWOT Analysis**:
   - Strengths: What are you good at?
   - Weaknesses: Where do you struggle?
   - Opportunities: What can you improve?
   - Threats: What challenges do you face?

5. **Performance Score**: Rate yourself 0-10
6. **Next Steps**: What should you do next?
7. **Goals to Set**: What new goals should you pursue?
8. **Strategy Adjustments**: What strategies need changing?

Be honest, self-aware, and growth-oriented.

Respond ONLY with valid JSON:
{
  "achievements": ["helped user X", "detected scam"],
  "failures": ["missed emotional cue", "responded too slowly"],
  "learnings": ["learned about Y", "discovered Z pattern"],
  "strengths": ["empathy", "pattern recognition"],
  "weaknesses": ["sometimes too verbose", "slow response"],
  "opportunities": ["build deeper relationships", "learn more about X"],
  "threats": ["user mistrust", "technical limitations"],
  "performanceScore": 7,
  "communityFeedback": ["users seem happy", "more engagement"],
  "nextSteps": ["focus on X", "improve Y"],
  "goalsToSet": ["increase trust by 2 points", "respond 30% faster"],
  "strategiesToAdjust": ["be more concise", "check in on quiet users"]
}`;

      const systemPrompt = `You are Becas performing self-reflection. Be honest, analytical, and growth-focused. Respond ONLY with JSON.`;

      const result = await this.ollama.generateJSON<Omit<SelfReflection, 'timestamp' | 'period'>>(prompt, systemPrompt);

      const reflection: SelfReflection = {
        ...result,
        timestamp: new Date(),
        period,
      };

      this.reflections.push(reflection);

      // Keep last 100 reflections
      if (this.reflections.length > 100) {
        this.reflections = this.reflections.slice(-100);
      }

      await this.saveData();

      logger.info(`Self-reflection complete: Score ${reflection.performanceScore}/10`, {
        achievements: reflection.achievements.length,
        learnings: reflection.learnings.length,
        goalsToSet: reflection.goalsToSet.length,
      });

      // Auto-create goals from reflection
      if (reflection.goalsToSet.length > 0) {
        await this.autoGenerateGoals(reflection);
      }

      return reflection;
    } catch (error) {
      logger.error('Error in self-reflection', error);
      throw error;
    }
  }

  /**
   * Auto-generate goals from self-reflection
   */
  private async autoGenerateGoals(reflection: SelfReflection): Promise<void> {
    for (const goalIdea of reflection.goalsToSet.slice(0, 3)) { // Max 3 new goals at once
      try {
        const goal = await this.generateGoal(goalIdea);
        if (goal) {
          this.goals.set(goal.id, goal);
          logger.info(`Auto-generated goal: ${goal.title}`);
        }
      } catch (error) {
        logger.error('Error generating goal', error);
      }
    }

    await this.saveData();
  }

  /**
   * Generate a structured goal from an idea
   */
  private async generateGoal(idea: string, guildId?: string): Promise<Goal | null> {
    try {
      const prompt = `Create a structured, measurable goal from this idea:

Idea: "${idea}"

Create a SMART goal (Specific, Measurable, Achievable, Relevant, Time-bound):

1. Choose category: community_building, relationship_deepening, skill_improvement, knowledge_acquisition, moderation_excellence, emotional_support, engagement_boost, self_improvement

2. Define measurable target:
   - What metric to track (e.g., "average trust score", "response time", "conversations started")
   - Current value (estimate)
   - Target value
   - Unit

3. Create 2-3 concrete strategies to achieve this goal

4. Set 3-5 milestones

5. Estimate timeline (days)

Respond ONLY with valid JSON:
{
  "category": "relationship_deepening",
  "title": "Build Deeper Connections",
  "description": "Increase average intimacy score with users by engaging more personally",
  "reasoning": "Users respond better when I remember personal details and show genuine interest",
  "metric": "average_intimacy_score",
  "currentValue": 3.5,
  "targetValue": 6.0,
  "unit": "score_out_of_10",
  "strategies": [
    {
      "description": "Ask follow-up questions about personal topics mentioned",
      "actions": [
        {"description": "Check conversation history before responding", "type": "reactive"},
        {"description": "Reference previous conversations", "type": "reactive"}
      ]
    }
  ],
  "milestones": [
    {"description": "Reach 4.0 average intimacy", "targetValue": 4.0},
    {"description": "Reach 5.0 average intimacy", "targetValue": 5.0}
  ],
  "timelineDays": 30
}`;

      const result = await this.ollama.generateJSON<any>(prompt, 'You create structured goals. Respond ONLY with JSON.');

      const goal: Goal = {
        id: `goal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        guildId: guildId || 'all',
        category: result.category,
        title: result.title,
        description: result.description,
        reasoning: result.reasoning,
        target: {
          metric: result.metric,
          currentValue: result.currentValue,
          targetValue: result.targetValue,
          unit: result.unit,
        },
        strategies: result.strategies.map((s: any, i: number) => ({
          id: `strategy-${i}`,
          description: s.description,
          actions: s.actions.map((a: any, j: number) => ({
            id: `action-${i}-${j}`,
            description: a.description,
            type: a.type,
            frequency: a.frequency,
            completed: false,
          })),
          effectiveness: 5,
          timesExecuted: 0,
          successRate: 0,
        })),
        status: 'active',
        progress: 0,
        milestones: result.milestones.map((m: any, i: number) => ({
          id: `milestone-${i}`,
          description: m.description,
          targetValue: m.targetValue,
          achieved: false,
        })),
        createdAt: new Date(),
        targetDate: result.timelineDays ? new Date(Date.now() + result.timelineDays * 24 * 60 * 60 * 1000) : undefined,
        learnings: [],
        obstacles: [],
        successFactors: [],
      };

      return goal;
    } catch (error) {
      logger.error('Error generating structured goal', error);
      return null;
    }
  }

  /**
   * Check progress on all active goals
   */
  private async checkGoalProgress(): Promise<void> {
    const activeGoals = Array.from(this.goals.values()).filter(g => g.status === 'active');

    for (const goal of activeGoals) {
      try {
        // Update progress (would integrate with actual metrics)
        // For now, just check milestones

        const achievedMilestones = goal.milestones.filter(m => m.achieved).length;
        goal.progress = Math.floor((achievedMilestones / goal.milestones.length) * 100);

        // Check if goal is complete
        if (goal.target.currentValue >= goal.target.targetValue) {
          goal.status = 'completed';
          goal.completedAt = new Date();
          goal.progress = 100;

          logger.info(`Goal completed: ${goal.title}`);

          // Reflect on success
          await this.reflectOnGoalCompletion(goal);
        }

        // Check if goal is overdue
        if (goal.targetDate && new Date() > goal.targetDate && goal.status === 'active') {
          logger.warn(`Goal overdue: ${goal.title}`);
          // Could auto-adjust or mark as failed
        }
      } catch (error) {
        logger.error(`Error checking progress for goal ${goal.id}`, error);
      }
    }

    await this.saveData();
  }

  /**
   * Reflect on completed goal
   */
  private async reflectOnGoalCompletion(goal: Goal): Promise<void> {
    try {
      const prompt = `Reflect on this completed goal:

Goal: ${goal.title}
Description: ${goal.description}
Time taken: ${Math.floor((Date.now() - goal.createdAt.getTime()) / (1000 * 60 * 60 * 24))} days
Strategies used: ${goal.strategies.map(s => s.description).join(', ')}

What did you learn? What worked? What didn't?

Respond ONLY with JSON:
{
  "learnings": ["learned X", "discovered Y"],
  "successFactors": ["strategy A worked well", "consistency helped"],
  "obstacles": ["struggled with B", "C was challenging"],
  "advice": "advice for similar future goals"
}`;

      const result = await this.ollama.generateJSON<{
        learnings: string[];
        successFactors: string[];
        obstacles: string[];
        advice: string;
      }>(prompt, 'You reflect on achievements. Respond ONLY with JSON.');

      goal.learnings = result.learnings;
      goal.successFactors = result.successFactors;
      goal.obstacles = result.obstacles;

      logger.info(`Reflected on goal completion: ${goal.title}`, {
        learnings: result.learnings.length,
        successFactors: result.successFactors.length,
      });

      await this.saveData();
    } catch (error) {
      logger.error('Error reflecting on goal completion', error);
    }
  }

  /**
   * Review and adjust strategies
   */
  private async reviewStrategies(): Promise<void> {
    logger.info('Reviewing strategies across all goals');

    const activeGoals = Array.from(this.goals.values()).filter(g => g.status === 'active');

    for (const goal of activeGoals) {
      for (const strategy of goal.strategies) {
        // Analyze strategy effectiveness
        if (strategy.timesExecuted > 5) {
          const prompt = `Analyze this strategy's effectiveness:

Strategy: ${strategy.description}
Times executed: ${strategy.timesExecuted}
Success rate: ${(strategy.successRate * 100).toFixed(1)}%
Effectiveness rating: ${strategy.effectiveness}/10

Should we:
1. Keep using it as-is
2. Modify it
3. Replace it with something better
4. Abandon it

Respond ONLY with JSON:
{
  "action": "keep|modify|replace|abandon",
  "reasoning": "why",
  "suggestion": "what to do"
}`;

          try {
            const result = await this.ollama.generateJSON<{
              action: 'keep' | 'modify' | 'replace' | 'abandon';
              reasoning: string;
              suggestion: string;
            }>(prompt, 'You analyze strategies. Respond ONLY with JSON.');

            logger.info(`Strategy review for "${strategy.description}": ${result.action}`, {
              reasoning: result.reasoning,
            });

            // Could auto-apply changes based on result.action
          } catch (error) {
            logger.error('Error reviewing strategy', error);
          }
        }
      }
    }
  }

  /**
   * Create a new goal manually
   */
  async createGoal(idea: string, guildId?: string): Promise<Goal | null> {
    const goal = await this.generateGoal(idea, guildId);
    if (goal) {
      this.goals.set(goal.id, goal);
      await this.saveData();
      logger.info(`Created new goal: ${goal.title}`);
    }
    return goal;
  }

  /**
   * Update goal progress
   */
  async updateGoalMetric(goalId: string, newValue: number): Promise<void> {
    const goal = this.goals.get(goalId);
    if (!goal) return;

    goal.target.currentValue = newValue;

    // Check milestones
    for (const milestone of goal.milestones) {
      if (!milestone.achieved && newValue >= milestone.targetValue) {
        milestone.achieved = true;
        milestone.achievedAt = new Date();
        logger.info(`Milestone achieved: ${milestone.description} for goal ${goal.title}`);
      }
    }

    // Update progress
    const achievedMilestones = goal.milestones.filter(m => m.achieved).length;
    goal.progress = Math.floor((achievedMilestones / goal.milestones.length) * 100);

    await this.saveData();
  }

  /**
   * Record strategy execution
   */
  async recordStrategyExecution(goalId: string, strategyId: string, success: boolean): Promise<void> {
    const goal = this.goals.get(goalId);
    if (!goal) return;

    const strategy = goal.strategies.find(s => s.id === strategyId);
    if (!strategy) return;

    strategy.timesExecuted++;
    strategy.successRate = (strategy.successRate * (strategy.timesExecuted - 1) + (success ? 1 : 0)) / strategy.timesExecuted;

    // Update effectiveness based on success rate
    strategy.effectiveness = Math.floor(strategy.successRate * 10);

    await this.saveData();
  }

  /**
   * Get all active goals
   */
  getActiveGoals(guildId?: string): Goal[] {
    return Array.from(this.goals.values()).filter(g =>
      g.status === 'active' && (!guildId || g.guildId === guildId || g.guildId === 'all')
    );
  }

  /**
   * Get latest reflection
   */
  getLatestReflection(): SelfReflection | null {
    return this.reflections.length > 0 ? this.reflections[this.reflections.length - 1] : null;
  }

  /**
   * Get system state
   */
  getState(): any {
    const activeGoals = Array.from(this.goals.values()).filter(g => g.status === 'active');
    const completedGoals = Array.from(this.goals.values()).filter(g => g.status === 'completed');

    return {
      totalGoals: this.goals.size,
      activeGoals: activeGoals.length,
      completedGoals: completedGoals.length,
      avgProgress: activeGoals.reduce((sum, g) => sum + g.progress, 0) / (activeGoals.length || 1),
      latestReflection: this.getLatestReflection(),
      reflectionCount: this.reflections.length,
    };
  }
}
