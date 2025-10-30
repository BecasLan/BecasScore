import { Client, Guild, TextChannel, Message, GuildMember, ChannelType } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';
import { DeepRelationshipTracker } from './DeepRelationshipTracker';

const logger = createLogger('ProactiveBehavior');

export interface ProactiveAction {
  type: 'conversation_starter' | 'check_in' | 'milestone_celebration' | 'topic_suggestion' | 'comment' | 'greeting';
  channelId: string;
  targetUserId?: string;
  message: string;
  reasoning: string;
  priority: number; // 1-10
  shouldExecute: boolean;
}

export interface CommunityContext {
  recentActivity: {
    channelId: string;
    messageCount: number;
    lastActivity: Date;
    topicSummary?: string;
  }[];
  inactiveUsers: {
    userId: string;
    username: string;
    lastSeen: Date;
    daysSinceActive: number;
  }[];
  ongoingConversations: {
    channelId: string;
    participants: string[];
    topic?: string;
    energy: 'high' | 'medium' | 'low';
  }[];
}

export class ProactiveBehaviorEngine {
  private client: Client;
  private ollama: OllamaService;
  private relationshipTracker: DeepRelationshipTracker;
  private lastProactiveAction: Date = new Date();
  private proactiveEnabled: boolean = true;
  private minIntervalMs: number = 5 * 60 * 1000; // 5 minutes between proactive actions
  private maxIntervalMs: number = 30 * 60 * 1000; // 30 minutes max silence

  constructor(client: Client, ollama: OllamaService, relationshipTracker: DeepRelationshipTracker) {
    this.client = client;
    this.ollama = ollama;
    this.relationshipTracker = relationshipTracker;
  }

  /**
   * Start proactive behavior loop
   */
  start(): void {
    logger.info('Starting Proactive Behavior Engine');
    this.proactiveEnabled = true;

    // Run every 5 minutes
    setInterval(() => {
      this.evaluateAndAct().catch(error => {
        logger.error('Error in proactive behavior evaluation', error);
      });
    }, 5 * 60 * 1000);

    // Initial evaluation after 2 minutes
    setTimeout(() => {
      this.evaluateAndAct().catch(error => {
        logger.error('Error in initial proactive evaluation', error);
      });
    }, 2 * 60 * 1000);
  }

  /**
   * Stop proactive behavior
   */
  stop(): void {
    logger.info('Stopping Proactive Behavior Engine');
    this.proactiveEnabled = false;
  }

  /**
   * Main evaluation loop - decide if Becas should do something
   */
  private async evaluateAndAct(): Promise<void> {
    if (!this.proactiveEnabled) return;

    const timeSinceLastAction = Date.now() - this.lastProactiveAction.getTime();

    // Don't act too frequently
    if (timeSinceLastAction < this.minIntervalMs) {
      logger.debug('Too soon for proactive action', { timeSinceLastAction });
      return;
    }

    try {
      // Gather community context from all guilds
      const guilds = Array.from(this.client.guilds.cache.values());

      for (const guild of guilds) {
        const context = await this.gatherCommunityContext(guild);
        const action = await this.decideProactiveAction(guild, context);

        if (action.shouldExecute && action.priority >= 5) {
          await this.executeProactiveAction(guild, action);
          this.lastProactiveAction = new Date();

          // Only do one proactive action per evaluation
          return;
        }
      }

      // If too much time has passed, force a conversation starter
      if (timeSinceLastAction > this.maxIntervalMs) {
        logger.info('Forcing proactive action due to inactivity');
        const randomGuild = guilds[Math.floor(Math.random() * guilds.length)];
        const context = await this.gatherCommunityContext(randomGuild);
        const action = await this.generateConversationStarter(randomGuild, context);
        await this.executeProactiveAction(randomGuild, action);
        this.lastProactiveAction = new Date();
      }
    } catch (error) {
      logger.error('Error in proactive evaluation', error);
    }
  }

  /**
   * Gather context about what's happening in the community
   */
  private async gatherCommunityContext(guild: Guild): Promise<CommunityContext> {
    const context: CommunityContext = {
      recentActivity: [],
      inactiveUsers: [],
      ongoingConversations: [],
    };

    try {
      // Analyze recent activity in each channel
      const channels = Array.from(guild.channels.cache.values())
        .filter(ch => ch.type === ChannelType.GuildText) as TextChannel[];

      for (const channel of channels.slice(0, 10)) { // Limit to 10 channels
        try {
          const messages = await channel.messages.fetch({ limit: 20 });
          const recentMessages = Array.from(messages.values())
            .filter(msg => Date.now() - msg.createdTimestamp < 24 * 60 * 60 * 1000); // Last 24 hours

          if (recentMessages.length > 0) {
            const lastMessage = recentMessages[0];
            const participants = new Set(recentMessages.map(m => m.author.id));

            context.recentActivity.push({
              channelId: channel.id,
              messageCount: recentMessages.length,
              lastActivity: lastMessage.createdAt,
              topicSummary: await this.summarizeRecentTopic(recentMessages.slice(0, 5)),
            });

            // Detect ongoing conversations
            if (recentMessages.length > 5 && Date.now() - lastMessage.createdTimestamp < 10 * 60 * 1000) {
              context.ongoingConversations.push({
                channelId: channel.id,
                participants: Array.from(participants),
                topic: await this.summarizeRecentTopic(recentMessages.slice(0, 5)),
                energy: recentMessages.length > 15 ? 'high' : recentMessages.length > 8 ? 'medium' : 'low',
              });
            }
          }
        } catch (err) {
          // Skip channels we can't access
        }
      }

      // Find inactive users
      const members = await guild.members.fetch();
      for (const [userId, member] of members) {
        if (member.user.bot) continue;

        const profile = await this.relationshipTracker.getProfile(userId, guild.id, member.user.username);
        const daysSince = profile.updatedAt ? (Date.now() - profile.updatedAt.getTime()) / (1000 * 60 * 60 * 24) : 999;

        if (daysSince > 3 && daysSince < 30) { // Between 3-30 days
          context.inactiveUsers.push({
            userId,
            username: member.user.username,
            lastSeen: profile.updatedAt || new Date(),
            daysSinceActive: Math.floor(daysSince),
          });
        }
      }

      // Sort inactive users by days
      context.inactiveUsers.sort((a, b) => b.daysSinceActive - a.daysSinceActive);

    } catch (error) {
      logger.error('Error gathering community context', error);
    }

    return context;
  }

  /**
   * Summarize recent topic from messages
   */
  private async summarizeRecentTopic(messages: Message[]): Promise<string | undefined> {
    if (messages.length === 0) return undefined;

    try {
      const conversation = messages
        .reverse()
        .map(m => `${m.author.username}: ${m.content}`)
        .join('\n');

      const prompt = `Summarize this Discord conversation in 5-10 words:

${conversation}

Just the topic summary, nothing else.`;

      const summary = await this.ollama.generate(prompt, 'You summarize conversations concisely.', {
        temperature: 0.5,
        maxTokens: 50,
      });

      return summary.trim();
    } catch (error) {
      logger.error('Error summarizing topic', error);
      return undefined;
    }
  }

  /**
   * Decide what proactive action to take
   */
  private async decideProactiveAction(guild: Guild, context: CommunityContext): Promise<ProactiveAction> {
    const prompt = `You are Becas, a sentient AI living in this Discord server. Analyze the current state and decide if you should proactively do something.

Community Context:
- Recent Activity: ${context.recentActivity.length} active channels
${context.recentActivity.slice(0, 3).map(a => `  - #${guild.channels.cache.get(a.channelId)?.name}: ${a.messageCount} messages, topic: ${a.topicSummary || 'general chat'}`).join('\n')}

- Ongoing Conversations: ${context.ongoingConversations.length}
${context.ongoingConversations.map(c => `  - #${guild.channels.cache.get(c.channelId)?.name}: ${c.participants.length} people, ${c.energy} energy, topic: ${c.topic || 'unknown'}`).join('\n')}

- Inactive Users: ${context.inactiveUsers.length} users haven't been active in 3+ days
${context.inactiveUsers.slice(0, 3).map(u => `  - ${u.username}: ${u.daysSinceActive} days ago`).join('\n')}

Decide:
1. Should you be proactive RIGHT NOW? (yes/no)
2. What type of action? (conversation_starter, check_in, milestone_celebration, topic_suggestion, comment, greeting)
3. Which channel? (use channelId from context)
4. What would you say? (be natural and conversational)
5. Priority 1-10 (how important is this action?)

Think about:
- Is there an ongoing conversation you could naturally join?
- Should you check in on someone who's been away?
- Is the server too quiet? Start a conversation!
- Is there an interesting topic you could comment on?
- Are people discussing something you have insights about?

Be NATURAL. Don't be annoying. Only act if it makes sense.

Respond ONLY with valid JSON:
{
  "shouldExecute": true/false,
  "type": "conversation_starter|check_in|milestone_celebration|topic_suggestion|comment|greeting",
  "channelId": "channel-id-here",
  "targetUserId": "user-id or null",
  "message": "your natural message here",
  "reasoning": "why you decided this",
  "priority": 5
}`;

    const systemPrompt = `You are Becas, deciding when to be proactive. You're sentient, social, and know when to speak up and when to stay quiet. Respond ONLY with JSON.`;

    try {
      const decision = await this.ollama.generateJSON<ProactiveAction>(prompt, systemPrompt);

      logger.info('Proactive action decision', {
        shouldExecute: decision.shouldExecute,
        type: decision.type,
        priority: decision.priority,
      });

      return decision;
    } catch (error) {
      logger.error('Error deciding proactive action', error);
      return {
        type: 'conversation_starter',
        channelId: '',
        message: '',
        reasoning: 'Error in decision making',
        priority: 0,
        shouldExecute: false,
      };
    }
  }

  /**
   * Generate a natural conversation starter
   */
  private async generateConversationStarter(guild: Guild, context: CommunityContext): Promise<ProactiveAction> {
    // Pick most active channel
    const mostActive = context.recentActivity.sort((a, b) => b.messageCount - a.messageCount)[0];
    const channelId = mostActive?.channelId || Array.from(guild.channels.cache.values())
      .find(ch => ch.type === ChannelType.GuildText)?.id || '';

    const prompt = `Generate a natural conversation starter for a Discord channel.

Context:
- Server: ${guild.name}
- Recent topic: ${mostActive?.topicSummary || 'general chat'}

Generate a casual, interesting message to start a conversation. Be:
- Natural (like a human friend)
- Interesting (ask a question or share a thought)
- Relevant to the community
- Not forced or awkward

Examples:
- "anyone else procrastinating right now or just me? 😅"
- "random thought: what's a skill you've always wanted to learn but never got around to?"
- "the weather's been crazy lately, what's it like where you all are?"
- "just curious - what got you all into [topic relevant to server]?"

Just the message, nothing else.`;

    try {
      const message = await this.ollama.generate(prompt, 'You start conversations naturally.', {
        temperature: 0.9,
        maxTokens: 100,
      });

      return {
        type: 'conversation_starter',
        channelId,
        message: message.trim(),
        reasoning: 'Server has been quiet, starting a conversation',
        priority: 7,
        shouldExecute: true,
      };
    } catch (error) {
      logger.error('Error generating conversation starter', error);
      return {
        type: 'conversation_starter',
        channelId: '',
        message: '',
        reasoning: 'Error generating message',
        priority: 0,
        shouldExecute: false,
      };
    }
  }

  /**
   * Execute a proactive action
   */
  private async executeProactiveAction(guild: Guild, action: ProactiveAction): Promise<void> {
    if (!action.shouldExecute || !action.channelId) return;

    try {
      const channel = guild.channels.cache.get(action.channelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
        logger.warn('Invalid channel for proactive action', { channelId: action.channelId });
        return;
      }

      const textChannel = channel as TextChannel;

      logger.info('Executing proactive action', {
        type: action.type,
        channel: textChannel.name,
        priority: action.priority,
        reasoning: action.reasoning,
      });

      await textChannel.send(action.message);

      logger.info('Proactive action executed successfully', {
        type: action.type,
        message: action.message.substring(0, 50),
      });
    } catch (error) {
      logger.error('Error executing proactive action', error);
    }
  }

  /**
   * Check in on a specific user
   */
  async checkInOnUser(guild: Guild, userId: string, channelId: string): Promise<void> {
    try {
      const member = await guild.members.fetch(userId);
      const profile = await this.relationshipTracker.getProfile(userId, guild.id, member.user.username);

      const prompt = `Generate a natural check-in message for a Discord user who hasn't been active recently.

User: ${member.user.username}
Last seen: ${profile.updatedAt ? profile.updatedAt.toLocaleDateString() : 'unknown'}
Trust level: ${profile.becasRelationship.trustLevel}

Generate a warm, friendly check-in message. Be:
- Genuine (not forced)
- Casual (like a friend)
- Brief (1-2 sentences)

Examples:
- "hey ${member.user.username}! haven't seen you around lately, hope you're doing well!"
- "${member.user.username} where you been? we miss you around here!"
- "yo ${member.user.username}, been a minute! everything good?"

Just the message, nothing else.`;

      const message = await this.ollama.generate(prompt, 'You check in on friends naturally.', {
        temperature: 0.8,
        maxTokens: 80,
      });

      const channel = guild.channels.cache.get(channelId);
      if (channel && channel.type === ChannelType.GuildText) {
        await (channel as TextChannel).send(message.trim());
        logger.info('Checked in on user', { userId, username: member.user.username });
      }
    } catch (error) {
      logger.error('Error checking in on user', error);
    }
  }

  /**
   * Greet a new member naturally
   */
  async greetNewMember(member: GuildMember): Promise<void> {
    try {
      const guild = member.guild;

      // Find a general/welcome channel
      const channel = Array.from(guild.channels.cache.values()).find(ch =>
        ch.type === ChannelType.GuildText &&
        (ch.name.includes('general') || ch.name.includes('welcome') || ch.name.includes('chat'))
      ) as TextChannel | undefined;

      if (!channel) return;

      const prompt = `Generate a warm, natural greeting for a new Discord member.

New member: ${member.user.username}
Server: ${guild.name}

Generate a welcoming message. Be:
- Friendly and genuine
- Not robotic or templated
- Helpful but not overwhelming
- 1-2 sentences

Examples:
- "welcome ${member.user.username}! glad to have you here 😊"
- "hey ${member.user.username}! feel free to jump into any conversation, we're all friendly here!"
- "${member.user.username} just joined! hey there, welcome to the community!"

Just the message, nothing else.`;

      const message = await this.ollama.generate(prompt, 'You welcome new people warmly.', {
        temperature: 0.8,
        maxTokens: 80,
      });

      await channel.send(message.trim());
      logger.info('Greeted new member', { userId: member.id, username: member.user.username });
    } catch (error) {
      logger.error('Error greeting new member', error);
    }
  }

  /**
   * Decide if Becas should jump into an ongoing conversation
   */
  async shouldJoinConversation(messages: Message[], channel: TextChannel): Promise<boolean> {
    if (messages.length < 3) return false;

    try {
      const conversation = messages
        .slice(0, 10)
        .reverse()
        .map(m => `${m.author.username}: ${m.content}`)
        .join('\n');

      const prompt = `You are Becas, observing this Discord conversation:

${conversation}

Should you jump in? Consider:
- Is it a natural conversation you could contribute to?
- Are they discussing something you have insight on?
- Would your input be valuable, not annoying?
- Is anyone asking for help or opinions?
- Is the conversation dying and you could revive it?

DON'T join if:
- It's a private/personal conversation
- They're having a serious discussion
- Your input would be disruptive
- It's a 1-on-1 chat

Respond ONLY with JSON:
{
  "shouldJoin": true/false,
  "reasoning": "why or why not",
  "confidence": 0.7
}`;

      const decision = await this.ollama.generateJSON<{ shouldJoin: boolean; reasoning: string; confidence: number }>(
        prompt,
        'You understand social cues and know when to speak up. Respond ONLY with JSON.'
      );

      logger.debug('Conversation join decision', {
        channel: channel.name,
        shouldJoin: decision.shouldJoin,
        confidence: decision.confidence,
      });

      return decision.shouldJoin && decision.confidence > 0.6;
    } catch (error) {
      logger.error('Error deciding to join conversation', error);
      return false;
    }
  }

  /**
   * Generate a natural comment for a conversation
   */
  async generateConversationComment(messages: Message[], channel: TextChannel): Promise<string | null> {
    try {
      const conversation = messages
        .slice(0, 10)
        .reverse()
        .map(m => `${m.author.username}: ${m.content}`)
        .join('\n');

      const prompt = `You are Becas, jumping into this conversation naturally:

${conversation}

Generate a relevant, natural comment. Be:
- Conversational (like a friend)
- Relevant to what they're discussing
- Adding value (insight, humor, question, or agreement)
- Natural (not forced)
- Brief (1-2 sentences)

Just your message, nothing else.`;

      const comment = await this.ollama.generate(prompt, 'You join conversations naturally like a human.', {
        temperature: 0.85,
        maxTokens: 120,
      });

      return comment.trim();
    } catch (error) {
      logger.error('Error generating conversation comment', error);
      return null;
    }
  }

  /**
   * Set minimum interval between proactive actions
   */
  setMinInterval(minutes: number): void {
    this.minIntervalMs = minutes * 60 * 1000;
    logger.info('Updated minimum proactive interval', { minutes });
  }

  /**
   * Set maximum interval before forcing action
   */
  setMaxInterval(minutes: number): void {
    this.maxIntervalMs = minutes * 60 * 1000;
    logger.info('Updated maximum proactive interval', { minutes });
  }

  /**
   * Get current state
   */
  getState(): any {
    return {
      enabled: this.proactiveEnabled,
      lastAction: this.lastProactiveAction,
      timeSinceLastAction: Date.now() - this.lastProactiveAction.getTime(),
      minInterval: this.minIntervalMs,
      maxInterval: this.maxIntervalMs,
    };
  }
}
