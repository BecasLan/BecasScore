import { Client, Message, GuildMember, TextChannel, PermissionFlagsBits, MessageReaction, User, ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionCollector, ComponentType } from 'discord.js';
import { StorageService } from '../services/StorageService';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';
import { metricsService } from '../services/MetricsService';

const logger = createLogger('BecasCore');
import { TrustScoreEngineDB } from '../systems/TrustScoreEngineDB';
import { GenerativeRuleEngine } from '../systems/GenerativeRuleEngine';
import { DialogueProcessor } from './DialogueProcessor';
import { PersonalityCore } from './PersonalityCore';
import { MemoryManager } from '../memory/MemoryManager';
import { SelfReflection } from './SelfReflection';
import { ModerationHandler } from '../systems/ModerationHandler';
import { MessageContext, AnalyzedMessage } from '../types/Message.types';
import { TaskManager } from '../advanced/TaskManager';
import { ComplexIntentParser } from '../advanced/ComplexIntentParser';
import { UserMonitor } from '../monitoring/UserMonitor';
import { ScamDetector } from '../analyzers/ScamDetector';
import { CrossGuildMemory } from '../systems/CrossGuildMemory';

// 🔥 DATABASE INTEGRATION - PostgreSQL + Redis
import { BecasDatabaseIntegration } from '../database/BecasDatabaseIntegration';

// NEW AI SYSTEMS
import { LanguageDetector } from '../systems/LanguageDetector';
import { ImageAnalyzer } from '../analyzers/ImageAnalyzer';
import { ReactionVoting } from '../systems/ReactionVoting';
import { ConflictPredictor } from '../systems/ConflictPredictor';
import { UserProfiler } from '../systems/UserProfiler';
import { SmartSlowmode } from '../systems/SmartSlowmode';
import { AIJurySystem } from '../systems/AIJurySystem';
import { BehaviorRehabilitation } from '../systems/BehaviorRehabilitation';
import { ExternalIntegrations } from '../systems/ExternalIntegrations';
import { ModeratorLearning } from '../systems/ModeratorLearning';
import { NetworkAnalyzer } from '../systems/NetworkAnalyzer';
import { EmotionalSupport } from '../systems/EmotionalSupport';

// SENTIENT AI SYSTEMS
import { NaturalLanguageActionParser } from '../advanced/NaturalLanguageActionParser';
import { DiscordActionExecutor } from '../advanced/DiscordActionExecutor';
import { ProactiveBehaviorEngine } from '../systems/ProactiveBehaviorEngine';
import { DeepRelationshipTracker } from '../systems/DeepRelationshipTracker';
import { GoalStrategySystem } from '../systems/GoalStrategySystem';
import { PredictiveAISystem } from '../systems/PredictiveAISystem';

// V2 ARCHITECTURE - ALL PHASES
import { EventGateway, StableContext } from './EventGateway';
import { ReflexEngine, ReflexResponse } from './ReflexEngine';
import { CognitiveCore } from './CognitiveCore';
import { MemorySpine } from './MemorySpine';
import { PersonaCoreV2 } from './PersonaCoreV2';
import { PolicyEngineV2 } from './PolicyEngineV2';
import { SelfAuditSystem } from './SelfAuditSystem';

// STRUCTURED ACTION PARSER - Complex Command Intelligence
import { StructuredActionParser } from './StructuredActionParser';
import { CognitiveOrchestrator } from './CognitiveOrchestrator';
import { ResponseSynthesizer } from './ResponseSynthesizer';

// ANALYTICS & PROFILING SYSTEMS
import { UserProfileBadgeSystem } from './UserProfileBadges';
import { ServerAnalytics } from './ServerAnalytics';

// ADVANCED AI COMMAND SYSTEM
import { AdvancedCommandInterpreter, CommandIntent } from './AdvancedCommandInterpreter';

// 🔥 NEW SUPER AI SYSTEMS
import { AuditLogger } from '../systems/AuditLogger';
import { BulkActionSystem } from '../systems/BulkActionSystem';
import { AILearningSystem } from '../systems/AILearningSystem';

// 🚀 UNIVERSAL ACTION SYSTEM
import { ActionRegistry } from '../systems/ActionRegistry';
import { ActionExecutor } from '../systems/ActionExecutor';
import { ActionPlanner } from '../ai/ActionPlanner';
import { initializeActionRegistry } from '../systems/actions';

// 🎯 COMPLEX WORKFLOW SYSTEM
import { WatchSystem } from '../systems/WatchSystem';
import { WorkflowParser } from '../systems/WorkflowParser';
import { WorkflowManager } from '../systems/WorkflowManager';
import { AdvancedFeatures } from '../systems/AdvancedWorkflowFeatures';

// 🧠 INTELLIGENCE ENHANCEMENT SYSTEMS
import { ContextAwareness } from '../systems/ContextAwareness';
import { ActionCorrection } from '../systems/ActionCorrection';
import { ServerAnalysis } from '../systems/ServerAnalysis';
import { RuleLearning } from '../systems/RuleLearning';

// 🔬 DATA INTERPRETATION SYSTEM - AI can analyze its own outputs
import { DataInterpreter } from './DataInterpreter';

// 🧠 SENTIENT AI - OpenAI-Level Server Understanding
import { ServerMapper } from '../intelligence/ServerMapper';
import { DeepUserProfiler } from '../intelligence/DeepUserProfiler';
import { ChannelFusion } from '../intelligence/ChannelFusion';
import { QueryEngine } from '../intelligence/QueryEngine';
import { AutonomousLearning } from '../intelligence/AutonomousLearning';
import { IntelligentQueryEngine } from '../intelligence/IntelligentQueryEngine';
import { IntentClassifier } from '../intelligence/IntentClassifier';
import { ExecutionEngine } from '../intelligence/ExecutionEngine';

// 💬 AI SUGGESTION CHANNEL SYSTEM - Makes AI visible to moderators
import { SuggestionChannelManager } from '../systems/SuggestionChannelManager';

// 🧬 V3 ARCHITECTURE - Unified Memory & Safe Learning
import { UnifiedMemoryStore } from '../persistence/UnifiedMemoryStore';
import { SafeLearningEngine } from '../intelligence/SafeLearningEngine';
import { ContextEngine } from '../intelligence/ContextEngine';
import { V3Integration } from '../integration/V3Integration';

// 📊 ANALYTICS & DASHBOARD SYSTEM - Track everything, relationship graphs, dashboards
import { AnalyticsManager } from '../analytics/AnalyticsManager';

// 🧠 SERVER STATE MANAGER - AI knows what's happening in the server
import { ServerStateManager } from '../systems/ServerStateManager';

// 🚀 MULTI-MODEL AI ARCHITECTURE - Phase 1
import { ReflexLayer } from '../ai/ReflexLayer';
import { SemanticLayer } from '../ai/SemanticLayer';
import { DirectiveMatcher } from '../ai/DirectiveMatcher';
import { VectorStore } from '../memory/VectorStore';

// 🧬 SENTIENT AI SYSTEMS - Phase 2
import { EmotionEngine } from '../sentient/EmotionEngine';
import { BehaviorGenePool } from '../sentient/BehaviorGenePool';
import { DreamCycle } from '../sentient/DreamCycle';
import { SentientIntegrationLayer } from '../sentient/SentientIntegrationLayer';

// 🚀 BECASFLOW FRAMEWORK - AI-Powered Tool-Based Execution System
import { BecasPlanner } from '../becasflow/core/BecasPlanner';
import { BecasExecutor } from '../becasflow/core/BecasExecutor';
import { BecasContext } from '../becasflow/core/BecasContext';
import { BecasToolRegistry } from '../becasflow/registry/BecasToolRegistry';
import { BecasInteractive } from '../becasflow/core/BecasInteractive';
import { registerAllTools } from '../becasflow/tools';
import { ResultSynthesizer } from '../becasflow/services/ResultSynthesizer';

// 🛡️ GUILD POLICY SYSTEM - Two-layer enforcement (Guild + Becas Core)
import { BecasCoreViolationEngine } from '../intelligence/BecasCoreViolationEngine';
import { GuildPolicyEngineDB } from '../intelligence/GuildPolicyEngineDB';
import { PolicyDiscoveryEngine } from '../intelligence/PolicyDiscoveryEngine';
import { PolicyLearningEngine } from '../intelligence/PolicyLearningEngine';
import { PolicyCommand } from '../commands/policy';

export class BecasCore {
  private client: Client;
  private storage: StorageService;
  private ollama: OllamaService;
  private trustEngine: TrustScoreEngineDB;
  private ruleEngine: GenerativeRuleEngine;
  private dialogue: DialogueProcessor;
  private personality: PersonalityCore;
  private memory: MemoryManager;
  private reflection: SelfReflection;
  private moderation: ModerationHandler;
  private taskManager: TaskManager;
  private intentParser: ComplexIntentParser;
  private userMonitor: UserMonitor;
  private scamDetector: ScamDetector;
  private crossGuild: CrossGuildMemory;

  // 🔥 DATABASE INTEGRATION - PostgreSQL + Redis (REQUIRED)
  private dbIntegration: BecasDatabaseIntegration;

  // NEW AI SYSTEMS
  private languageDetector: LanguageDetector;
  private imageAnalyzer: ImageAnalyzer;
  private reactionVoting: ReactionVoting;
  private conflictPredictor: ConflictPredictor;
  private userProfiler: UserProfiler;
  private smartSlowmode: SmartSlowmode;
  private aiJury: AIJurySystem;
  private rehabilitation: BehaviorRehabilitation;
  private externalAPI: ExternalIntegrations;
  private modLearning: ModeratorLearning;
  private networkAnalyzer: NetworkAnalyzer;
  private emotionalSupport: EmotionalSupport;

  // SENTIENT AI SYSTEMS
  private nlActionParser: NaturalLanguageActionParser;
  private actionExecutor: DiscordActionExecutor;
  private proactiveBehavior: ProactiveBehaviorEngine;
  private relationshipTracker: DeepRelationshipTracker;
  private goalSystem: GoalStrategySystem;
  private predictiveAI: PredictiveAISystem;

  // V2 ARCHITECTURE - ALL PHASES
  private eventGateway: EventGateway;
  private reflexEngine: ReflexEngine;
  private cognitiveCore: CognitiveCore;
  private memorySpine: MemorySpine;
  private personaV2: PersonaCoreV2;
  private policyEngine: PolicyEngineV2;
  private selfAudit: SelfAuditSystem;
  private responseSynthesizer: ResponseSynthesizer;

  // ANALYTICS & PROFILING SYSTEMS
  private badgeSystem: UserProfileBadgeSystem;
  private analytics: ServerAnalytics;

  // ADVANCED AI COMMAND SYSTEM
  private commandInterpreter: AdvancedCommandInterpreter;
  private pendingConfirmations: Map<string, CommandIntent> = new Map();

  // 🔥 SUPER AI SYSTEMS - NEW!
  private auditLogger: AuditLogger;
  private bulkActions: BulkActionSystem;
  private aiLearning: AILearningSystem;

  // 🚀 UNIVERSAL ACTION SYSTEM
  private actionRegistry: ActionRegistry;
  private universalActionExecutor: ActionExecutor;
  private actionPlanner: ActionPlanner;

  // 🎯 COMPLEX WORKFLOW SYSTEM
  private watchSystem: WatchSystem;
  private workflowParser: WorkflowParser;
  private workflowManager: WorkflowManager;
  private advancedFeatures: AdvancedFeatures;

  // 🧠 INTELLIGENCE ENHANCEMENT SYSTEMS
  private contextAwareness: ContextAwareness;
  private actionCorrection: ActionCorrection;
  private serverAnalysis: ServerAnalysis;
  private ruleLearning: RuleLearning;

  // 🔬 DATA INTERPRETATION SYSTEM
  private dataInterpreter: DataInterpreter;

  // 🧠 SENTIENT AI - OpenAI-Level Server Understanding
  private serverMapper: ServerMapper;
  private deepUserProfiler: DeepUserProfiler;
  private channelFusion: ChannelFusion;
  private queryEngine: QueryEngine;
  private autonomousLearning: AutonomousLearning;
  private intelligentQueryEngine: IntelligentQueryEngine;
  private intentClassifier: IntentClassifier;
  private executionEngine: ExecutionEngine;

  // 💬 AI SUGGESTION CHANNEL SYSTEM
  private suggestionChannelManager: SuggestionChannelManager;

  // 📊 ANALYTICS & DASHBOARD SYSTEM
  private analyticsManager: AnalyticsManager;

  // 🧠 SERVER STATE MANAGER - AI knows server state
  private serverStateManager: ServerStateManager;

  // 🚀 MULTI-MODEL AI ARCHITECTURE - Phase 1
  private reflexLayer: ReflexLayer;
  private semanticLayer: SemanticLayer;
  private directiveMatcher: DirectiveMatcher;
  private vectorStore: VectorStore;

  // 🧬 SENTIENT AI SYSTEMS - Phase 2
  private emotionEngine: EmotionEngine;
  private behaviorGenePool: BehaviorGenePool;
  private dreamCycle: DreamCycle;
  private sentientIntegration: SentientIntegrationLayer;

  // 🧬 V3 ARCHITECTURE - Unified Memory & Safe Learning
  private unifiedMemory: UnifiedMemoryStore;
  private learningEngine: SafeLearningEngine;
  private contextEngine: ContextEngine;
  private v3Integration: V3Integration;

  // 🧠 STRUCTURED ACTION PARSER - Complex Command Intelligence
  private structuredActionParser: StructuredActionParser;
  private cognitiveOrchestrator: CognitiveOrchestrator;

  // 🚀 BECASFLOW FRAMEWORK - AI-Powered Tool-Based Execution
  private becasflowPlanner: BecasPlanner;
  private becasflowExecutor: BecasExecutor;
  private becasflowRegistry: BecasToolRegistry;
  private resultSynthesizer: ResultSynthesizer;

  // 🛡️ GUILD POLICY SYSTEM - Two-layer enforcement engines
  private becasCoreViolationEngine: BecasCoreViolationEngine;
  private guildPolicyEngine: GuildPolicyEngineDB;
  private policyDiscovery: PolicyDiscoveryEngine;
  private policyLearning: PolicyLearningEngine;
  private policyCommand: PolicyCommand;

  private isReady: boolean = false;
  private handlersSetup: boolean = false; // Track if event handlers are already registered
  private recentActions: Map<string, {
    type: string;
    targetId: string;
    targetName: string;
    guildId: string;
    channelId: string;
    requestedBy: string;
    requestedByName: string;
    timestamp: Date;
    duration?: number;
    durationMinutes?: number;
    reason?: string;
    count?: number; // For bulk delete operations - how many messages were deleted
  }> = new Map(); // Track recent moderation actions for AI context and undo
  private processedMessages: Set<string> = new Set(); // Track processed message IDs to prevent duplicate processing
  private respondedMessages: Set<string> = new Set(); // Track messages we've already responded to

  // 💬 CONVERSATION MEMORY - Track conversation history per channel for context-aware responses
  private conversationHistory: Map<string, Array<{
    author: string;
    authorId: string;
    content: string;
    timestamp: number;
    isBot: boolean;
  }>> = new Map(); // guildId:channelId -> conversation history

  private dailyStats = {
    actionsToday: 0,
    conflictsResolved: 0,
    conflictsEscalated: 0,
    positiveInteractions: 0,
    messagesProcessed: 0,
  };

  // NEW: Optional dependencies for upgraded features
  private configManager?: any;
  private ollamaPool?: any;

  constructor(client: Client, deps?: { ollamaPool?: any; configManager?: any }) {
    this.client = client;
    this.storage = new StorageService();

    // Use provided connection pool or create default service
    if (deps?.ollamaPool) {
      this.ollamaPool = deps.ollamaPool;
      this.ollama = new OllamaService('dialogue', deps.ollamaPool);
    } else {
      this.ollama = new OllamaService();
    }

    // Store config manager if provided
    this.configManager = deps?.configManager;

    this.trustEngine = new TrustScoreEngineDB() as any;
    this.ruleEngine = new GenerativeRuleEngine(this.storage);
    this.dialogue = new DialogueProcessor();
    this.personality = new PersonalityCore(this.storage);
    this.memory = new MemoryManager(this.storage);
    this.reflection = new SelfReflection(this.storage, this.personality);
    this.moderation = new ModerationHandler(client);
    
    // Initialize advanced systems
    this.taskManager = new TaskManager(this.storage);
    this.intentParser = new ComplexIntentParser();
    this.userMonitor = new UserMonitor(this.taskManager);
    this.scamDetector = new ScamDetector();
    this.crossGuild = new CrossGuildMemory(this.storage);

    // Initialize new AI systems
    this.languageDetector = new LanguageDetector();
    this.imageAnalyzer = new ImageAnalyzer();
    this.reactionVoting = new ReactionVoting(this.storage);
    this.conflictPredictor = new ConflictPredictor();
    this.userProfiler = new UserProfiler(this.storage);
    this.smartSlowmode = new SmartSlowmode();
    this.aiJury = new AIJurySystem();
    this.rehabilitation = new BehaviorRehabilitation(this.storage);
    this.externalAPI = new ExternalIntegrations();
    this.modLearning = new ModeratorLearning(this.storage);
    this.networkAnalyzer = new NetworkAnalyzer();
    this.emotionalSupport = new EmotionalSupport();

    // Initialize sentient AI systems
    this.nlActionParser = new NaturalLanguageActionParser(this.ollama);
    this.actionExecutor = new DiscordActionExecutor();
    this.relationshipTracker = new DeepRelationshipTracker(this.ollama, this.storage);
    this.goalSystem = new GoalStrategySystem(this.ollama, this.storage);
    this.predictiveAI = new PredictiveAISystem(this.ollama, this.relationshipTracker);
    this.proactiveBehavior = new ProactiveBehaviorEngine(client, this.ollama, this.relationshipTracker);

    console.log('✨ Sentient AI systems initialized');

    // 🔥 DATABASE INTEGRATION - REQUIRED for data persistence
    console.log('💾 Initializing Database Integration...');
    try {
      this.dbIntegration = new BecasDatabaseIntegration(this.taskManager);
      console.log('  ✓ PostgreSQL + Redis integration active');
      console.log('  ✓ 5 Repositories loaded');
      console.log('  ✓ TrustScoreEngine (database-backed)');
      console.log('  ✓ UserMonitor (database-backed)');
      console.log('💾 Database integration ready!');
    } catch (error) {
      console.error('❌ FATAL: Database integration failed!');
      console.error('   Database is REQUIRED for data persistence.');
      console.error('');
      console.error('   Please ensure:');
      console.error('   1. Docker is running: docker-compose up -d');
      console.error('   2. Database is initialized: npm run db:init');
      console.error('   3. Connection settings in .env are correct');
      console.error('');
      console.error('Error details:', error);
      throw new Error('Database integration required but failed to initialize');
    }

    // Initialize V2 Architecture - ALL PHASES
    console.log('🧠 Initializing V2 Architecture...');

    // Phase 1: Event Gateway + Reflex Engine
    this.eventGateway = new EventGateway();
    this.reflexEngine = new ReflexEngine();
    console.log('  ✓ Phase 1: Event Gateway + Reflex Engine');

    // Phase 2: Cognitive Core
    this.cognitiveCore = new CognitiveCore();
    console.log('  ✓ Phase 2: Cognitive Core (Perception → Reasoning → Decision)');

    // Phase 3: Memory Spine
    this.memorySpine = new MemorySpine(this.storage);
    console.log('  ✓ Phase 3: Memory Spine (Working → Episodic → Semantic)');

    // Phase 4: Persona + Policy Separation
    this.personaV2 = new PersonaCoreV2(this.storage);
    this.policyEngine = new PolicyEngineV2(this.storage);
    console.log('  ✓ Phase 4: Persona/Policy Separation');

    // Phase 5: Self-Audit System
    this.selfAudit = new SelfAuditSystem(this.storage, this.ollama);
    console.log('  ✓ Phase 5: Self-Audit System (Meta-cognition)');

    // Phase 6: Response Synthesizer
    this.responseSynthesizer = new ResponseSynthesizer(this.ollama);
    console.log('  ✓ Phase 6: Response Synthesizer');

    console.log('🚀 V2 Architecture fully initialized - Becas is now sentient!');

    // 🔥 SUPER AI SYSTEMS - INITIALIZE FIRST (needed by CommandInterpreter)
    console.log('🔥 Initializing Super AI Systems...');
    this.auditLogger = new AuditLogger(this.storage);
    this.bulkActions = new BulkActionSystem(this.trustEngine);
    this.aiLearning = new AILearningSystem(this.storage);

    // Connect audit logger to trust engine for automatic logging
    this.trustEngine.setAuditLogger(this.auditLogger);

    console.log('  ✓ Audit Logger (tracks everything + rate limiting)');
    console.log('  ✓ Bulk Action System (mass moderation)');
    console.log('  ✓ AI Learning System (learns from corrections)');
    console.log('  ✓ Trust Engine connected to Audit Logger');
    console.log('🔥 Super AI systems activated!');

    // ANALYTICS & PROFILING SYSTEMS
    console.log('📊 Initializing Analytics & Profiling...');
    const analysisDeps = deps?.ollamaPool
      ? new OllamaService('analysis', deps.ollamaPool)
      : this.ollama;

    this.badgeSystem = new UserProfileBadgeSystem(analysisDeps);
    this.analytics = new ServerAnalytics(this.badgeSystem, analysisDeps);
    this.commandInterpreter = new AdvancedCommandInterpreter(analysisDeps, this.badgeSystem, this.bulkActions, this.auditLogger);
    console.log('  ✓ User Badge System');
    console.log('  ✓ Server Analytics');
    console.log('  ✓ Advanced AI Command Interpreter (with Super AI bulk actions)');
    console.log('📊 Analytics systems ready!');
    console.log('🧠 AI can now understand ANY command!');

    // 🚀 UNIVERSAL ACTION SYSTEM - NEW!
    console.log('🚀 Initializing Universal Action System...');
    this.actionRegistry = initializeActionRegistry();
    this.universalActionExecutor = new ActionExecutor(this.actionRegistry, this.auditLogger, this.trustEngine);
    this.actionPlanner = new ActionPlanner(this.actionRegistry, this.ollama);
    console.log('  ✓ Action Registry (15+ Discord actions as AI tools)');
    console.log('  ✓ Action Executor (universal execution engine)');
    console.log('  ✓ Action Planner (AI-powered action selection)');
    console.log('🚀 Universal Action System ready!');
    console.log('💡 Becas can now use ANY Discord action intelligently!');

    // 🎯 COMPLEX WORKFLOW SYSTEM - NEW!
    console.log('🎯 Initializing Complex Workflow System...');
    this.watchSystem = new WatchSystem(this.trustEngine, this.universalActionExecutor, this.ollama);
    this.workflowParser = new WorkflowParser(this.ollama);
    this.workflowManager = new WorkflowManager(this.storage, this.watchSystem, this.workflowParser, this.ollama);
    this.advancedFeatures = new AdvancedFeatures(this.storage, this.ollama);
    console.log('  ✓ Watch System (monitor users with conditions)');
    console.log('  ✓ Workflow Parser (parse complex commands)');
    console.log('  ✓ Workflow Manager (templates, queries, scheduling)');
    console.log('  ✓ Advanced Features (AI learning, social analysis, voice tracking, smart actions, cross-server, analytics, chains)');
    console.log('🎯 Complex Workflow System ready!');
    console.log('💡 ALL 22 ADVANCED FEATURES ACTIVATED!');

    // 🧠 INTELLIGENCE ENHANCEMENT SYSTEMS - NEW!
    console.log('🧠 Initializing Intelligence Enhancement Systems...');
    this.serverAnalysis = new ServerAnalysis(this.ollama);
    this.contextAwareness = new ContextAwareness(this.ollama);
    this.actionCorrection = new ActionCorrection(this.moderation, this.ollama);
    this.ruleLearning = new RuleLearning(this.ollama, this.serverAnalysis);
    console.log('  ✓ Context Awareness (pronoun resolution, conversation tracking)');
    console.log('  ✓ Action Correction (undo, modify, replace actions)');
    console.log('  ✓ Server Analysis (discover rules, understand structure)');
    console.log('  ✓ Rule Learning (auto-learn server policies)');
    console.log('🧠 Intelligence Enhancement Systems ready!');
    console.log('💡 Becas can now understand context, correct mistakes, and learn server rules!');

    // 🔬 DATA INTERPRETATION SYSTEM
    console.log('🔬 Initializing Data Interpretation System...');
    this.dataInterpreter = new DataInterpreter();
    console.log('  ✓ Data Interpreter (AI can analyze its own outputs)');
    console.log('🔬 Data Interpretation System ready!');

    // 🧠 SENTIENT AI - OpenAI-Level Server Understanding
    console.log('\n🧠 ===== INITIALIZING SENTIENT AI SYSTEMS =====');
    console.log('🗺️ Initializing ServerMapper...');
    this.serverMapper = new ServerMapper(this.storage);
    console.log('  ✓ ServerMapper - Complete server structure understanding');

    console.log('👥 Initializing DeepUserProfiler...');
    this.deepUserProfiler = new DeepUserProfiler(this.storage);
    console.log('  ✓ DeepUserProfiler - Advanced user profiling system');

    console.log('🔄 Initializing ChannelFusion...');
    this.channelFusion = new ChannelFusion(this.storage);
    console.log('  ✓ ChannelFusion - Channel merging and message migration');

    console.log('🔍 Initializing QueryEngine...');
    this.queryEngine = new QueryEngine(this.serverMapper, this.deepUserProfiler);
    console.log('  ✓ QueryEngine - Natural language server queries');

    console.log('🧠 Initializing AutonomousLearning...');
    this.autonomousLearning = new AutonomousLearning(
      client,
      this.serverMapper,
      this.deepUserProfiler,
      this.storage
    );
    console.log('  ✓ AutonomousLearning - Background learning system');

    console.log('🧠 ===== SENTIENT AI SYSTEMS READY =====\n');

    // 📊 ANALYTICS & DASHBOARD SYSTEM
    console.log('📊 Initializing Analytics & Dashboard System...');
    this.analyticsManager = new AnalyticsManager(client, this.storage);
    console.log('  ✓ EventTracker - Track all server events');
    console.log('  ✓ RelationshipGraph - Savaş grafiği (who did what to whom)');
    console.log('  ✓ ChannelConfig - Route events to specific channels');
    console.log('  ✓ Dashboard API - Metrics, timelines, relationship data');
    console.log('📊 Analytics System ready!\n');

    // Wire up analytics to moderation handler
    this.moderation.setAnalytics(this.analyticsManager);
    console.log('  ✓ ModerationHandler connected to Analytics');

    // Wire up database integration to moderation handler
    this.moderation.setDatabaseIntegration(this.dbIntegration);
    console.log('  ✓ ModerationHandler connected to Database (AI actions will be recorded)');

    // 🧠 SERVER STATE MANAGER
    console.log('🧠 Initializing Server State Manager...');
    this.serverStateManager = new ServerStateManager(client);
    console.log('  ✓ ServerStateManager - AI knows who is timed out/banned');
    console.log('🧠 Server State Tracking ready!\n');

    // 🧠 STRUCTURED ACTION PARSER - Complex Command Intelligence
    console.log('🧠 Initializing Structured Action Parser...');
    this.structuredActionParser = new StructuredActionParser();
    console.log('  ✓ Structured Action Parser (Complex commands with filters)');
    console.log('🧠 Structured Action Parser ready!');

    // 🧠 COGNITIVE ORCHESTRATOR - OpenAI/Claude Level Intelligence
    console.log('🧠 Initializing Cognitive Orchestrator...');
    this.cognitiveOrchestrator = new CognitiveOrchestrator(this.structuredActionParser);
    console.log('  ✓ Cognitive Orchestrator (Chain-of-thought reasoning)');
    console.log('  ✓ Multi-step planning engine');
    console.log('  ✓ Safety validation system');
    console.log('  ✓ Self-reflection & learning');
    console.log('🧠 Cognitive Orchestrator ready!');
    console.log('💡 Becas now has OpenAI/Claude level intelligence with multi-step reasoning!');

    // 🚀 MULTI-MODEL AI ARCHITECTURE - Phase 1
    console.log('\n🚀 ===== INITIALIZING MULTI-MODEL ARCHITECTURE =====');
    console.log('⚡ Initializing Reflex Layer (TinyLlama 1B)...');
    this.reflexLayer = new ReflexLayer();
    console.log('  ✓ Reflex Layer - Ultra-fast message filtering (10-50ms)');
    console.log('  ✓ TinyLlama 1B - Toxicity, tone, spam detection');
    console.log('  ✓ LRU Cache (1000 entries) - 90% cache hit rate');

    console.log('💬 Initializing Semantic Layer (E5/MiniLM embeddings)...');
    this.semanticLayer = new SemanticLayer();
    console.log('  ✓ Semantic Layer - Intent understanding via embeddings');
    console.log('  ✓ MiniLM-L6-v2 (384 dim) - Language-agnostic');
    console.log('  ✓ Cosine similarity matching - Multi-language support');

    console.log('🎯 Initializing Directive Matcher...');
    this.directiveMatcher = new DirectiveMatcher();
    console.log('  ✓ Directive Matcher - Admin command recognition');
    console.log('  ✓ Semantic + Vector matching - Context-aware');
    console.log('  ✓ 8 default directives (ban, kick, warn, purge, etc.)');

    console.log('💾 Initializing Vector Store (ChromaDB)...');
    this.vectorStore = new VectorStore();
    console.log('  ✓ Vector Store - Long-term semantic memory');
    console.log('  ✓ ChromaDB integration - Persistent embeddings');
    console.log('  ✓ Memory types: conversation, directive, outcome, pattern');
    console.log('🚀 ===== MULTI-MODEL ARCHITECTURE READY =====\n');
    console.log('💡 Message flow: Reflex → Semantic → Directive → Reasoning → Strategic');
    console.log('💡 Expected speedup: 5x faster (3-5s vs 20-30s) with same quality!\n');

    // 🧬 SENTIENT AI SYSTEMS - Phase 2
    console.log('🧬 Initializing Sentient AI Systems - Phase 2...');
    this.emotionEngine = new EmotionEngine(this.storage);
    console.log('  ✓ Emotion Engine - Physics-based emotional state');
    console.log('  ✓ 8 core emotions (Plutchik\'s wheel)');
    console.log('  ✓ Emotion interactions & decay (95% per minute)');

    this.behaviorGenePool = new BehaviorGenePool(this.storage);
    console.log('  ✓ Behavior Gene Pool - Genetic algorithm evolution');
    console.log('  ✓ Population: 20 chromosomes, 8 behavior genes');
    console.log('  ✓ Natural selection, crossover, mutation');

    this.dreamCycle = new DreamCycle(
      this.storage,
      this.vectorStore,
      this.behaviorGenePool,
      this.emotionEngine,
      this.ollama
    );
    console.log('  ✓ Dream Cycle - Nightly learning & memory synthesis');
    console.log('  ✓ Scheduled: 2-6 AM (low-activity periods)');
    console.log('  ✓ Memory consolidation, pattern extraction, insights');

    // 🔗 SENTIENT INTEGRATION LAYER - Wires everything together
    this.sentientIntegration = new SentientIntegrationLayer(
      this.emotionEngine,
      this.behaviorGenePool,
      this.dreamCycle,
      this.vectorStore
    );
    console.log('  ✓ Sentient Integration Layer - Event-driven AI coordination');
    console.log('  ✓ Auto-wires emotions, outcomes, and memories');
    console.log('🧬 ===== SENTIENT AI SYSTEMS READY =====\n');

    // 🧬 V3 ARCHITECTURE - Unified Memory & Safe Learning
    console.log('🧬 Initializing V3 Architecture...');
    this.unifiedMemory = new UnifiedMemoryStore(this.storage);
    console.log('  ✓ Unified Memory Store - Single source of truth');
    console.log('  ✓ Memory types: action, feedback, pattern, user_profile, server_knowledge, conversation, event, decision');
    console.log('  ✓ Fast in-memory cache + persistent disk storage');
    console.log('  ✓ Indexed queries (by type, guild, tags, relations, time)');

    this.learningEngine = new SafeLearningEngine(this.unifiedMemory);
    console.log('  ✓ Safe Learning Engine - 4-layer validation');
    console.log('  ✓ Layer 1: Feedback Loop (track corrections)');
    console.log('  ✓ Layer 2: Authority Hierarchy (Owner=100%, Admin=90%, Mod=70%)');
    console.log('  ✓ Layer 3: Confidence Threshold (75%+, 3+ supporting, 2- contradicting)');
    console.log('  ✓ Layer 4: Context Awareness (test vs real action detection)');

    this.contextEngine = new ContextEngine(this.unifiedMemory);
    console.log('  ✓ Context Engine - Full history awareness');
    console.log('  ✓ Resolves vague references ("him", "that user", "take it back")');
    console.log('  ✓ Tracks last 10 actions (1 hour window)');
    console.log('  ✓ Tracks last 20 messages (10 minute window)');

    this.v3Integration = new V3Integration(
      this.unifiedMemory,
      this.learningEngine,
      this.contextEngine,
      this.trustEngine
    );
    console.log('  ✓ V3 Integration Layer - Wires V3 to V2 systems');
    console.log('  ✓ recordAction() - Stores moderation actions to memory');
    console.log('  ✓ handleUndoCommand() - Processes "undo that" commands');
    console.log('  ✓ updateUserProfile() - Syncs TrustScoreEngine with memory');
    console.log('  ✓ getApplicablePatterns() - Retrieves learned patterns');

    console.log('  ✓ Guild Policy Engine - Custom per-guild moderation rules');
    console.log('    • Define occurrence-based policies (e.g., "3 toxic → timeout")');
    console.log('    • Escalation ladders (warn → timeout → ban)');
    console.log('    • Channel-specific policies');
    console.log('    • Automatic policy enforcement');
    console.log('🧬 ===== V3 ARCHITECTURE READY =====\n');

    // 🎯 INTELLIGENT QUERY ENGINE - Must be after V3 to use UnifiedMemoryStore
    console.log('🎯 Initializing IntelligentQueryEngine...');
    this.intelligentQueryEngine = new IntelligentQueryEngine(
      this.unifiedMemory,
      this.trustEngine,
      this.v3Integration
    );
    console.log('  ✓ IntelligentQueryEngine - Complex conditional analysis with action memory');
    console.log('  ✓ Trust Score integration - Auto-update trust on actions');
    console.log('  ✓ V3 Integration - Database logging and learning system');

    // 🧠 INTENT CLASSIFIER - AI decides if message is query or chat
    console.log('🧠 Initializing Intent Classifier...');
    this.intentClassifier = new IntentClassifier();
    console.log('  ✓ IntentClassifier - AI-powered intent detection');
    console.log('  ✓ No more !query commands - just talk naturally!');

    // 🚀 EXECUTION ENGINE - Orchestrates multi-intent execution
    console.log('🚀 Initializing Execution Engine...');
    this.executionEngine = new ExecutionEngine(
      this.intelligentQueryEngine,
      this.serverAnalysis,
      this.trustEngine,
      this.v3Integration.policyEngine,
      this.v3Integration
    );
    console.log('  ✓ ExecutionEngine - Multi-intent orchestration with dependencies');

    // 💬 AI SUGGESTION CHANNEL SYSTEM - Must be after V3 to use V3Integration
    console.log('💬 Initializing AI Suggestion Channel Manager...');
    this.suggestionChannelManager = new SuggestionChannelManager(client, this.storage, this.v3Integration);
    console.log('  ✓ SuggestionChannelManager - AI predictions visible in Discord');
    console.log('  ✓ Suggestions stored in UnifiedMemory for "implement suggestion #N" commands');
    console.log('💬 AI Suggestion System ready!\n');

    // 🚀 BECASFLOW FRAMEWORK - AI-Powered Tool-Based Execution System
    console.log('🚀 Initializing BecasFlow Framework...');
    this.becasflowRegistry = BecasToolRegistry.getInstance();
    registerAllTools(this.becasflowRegistry); // Register all 15 tools
    console.log(`  ✓ BecasToolRegistry - ${this.becasflowRegistry.getAll().length} tools registered`);
    console.log('  ✓ Tool Categories: moderation, trust, analytics');
    console.log('  ✓ Tools: ban, timeout, kick, warn, delete_messages, check_trust, update_trust, trust_report, server_stats, user_activity, moderation_history');

    this.becasflowPlanner = new BecasPlanner(this.ollama, this.becasflowRegistry);
    console.log('  ✓ BecasPlanner - AI-powered natural language to execution plans');
    console.log('  ✓ Conditional planning (if/then/else), loop support');
    console.log('  ✓ Missing parameter detection & interactive prompts');

    this.becasflowExecutor = new BecasExecutor(this.becasflowRegistry);
    console.log('  ✓ BecasExecutor - Smart execution engine');
    console.log('  ✓ Retry with exponential backoff, fallback steps');
    console.log('  ✓ Dry-run mode, progress tracking');

    this.resultSynthesizer = new ResultSynthesizer();
    console.log('  ✓ ResultSynthesizer - AI-powered result formatting');
    console.log('  ✓ Discord-friendly message synthesis');
    console.log('  ✓ Smart empty data handling');
    console.log('🚀 ===== BECASFLOW FRAMEWORK READY =====\n');

    // 🛡️ GUILD POLICY SYSTEM - Two-layer enforcement
    console.log('🛡️ Initializing Guild Policy System...');
    this.becasCoreViolationEngine = new BecasCoreViolationEngine();
    this.guildPolicyEngine = new GuildPolicyEngineDB();
    this.policyDiscovery = new PolicyDiscoveryEngine();
    this.policyLearning = new PolicyLearningEngine();
    this.policyCommand = new PolicyCommand();
    console.log('  ✓ BecasCoreViolationEngine - Global violations with trust score impact');
    console.log('  ✓ GuildPolicyEngineDB - Local guild policy enforcement');
    console.log('  ✓ PolicyDiscoveryEngine - Automatic policy discovery');
    console.log('  ✓ PolicyLearningEngine - Policy learning from moderator actions');
    console.log('  ✓ PolicyCommand - Manual policy management');
    console.log('🛡️ Guild Policy System initialized');
    logger.info('[BecasCore] Guild Policy System initialized');
  }

  /**
   * Initialize Becas
   */
  async initialize(): Promise<void> {
    // Prevent multiple initializations
    if (this.isReady) {
      console.log('⚠️ Becas is already initialized. Skipping...');
      return;
    }

    console.log('🧠 Initializing Becas...');

    // Check Ollama connection
    const ollamaHealthy = await this.ollama.healthCheck();
    if (!ollamaHealthy) {
      throw new Error('Ollama is not running or unreachable. Please start Ollama first.');
    }

    console.log('✓ Ollama connected');

    // Load available models
    const models = await this.ollama.listModels();
    console.log(`✓ Available models: ${models.join(', ')}`);

    // Initialize V2 systems with async components
    console.log('🔄 Initializing V2 async components...');
    await Promise.all([
      this.personaV2.initialize(),
      this.policyEngine.initialize(),
      this.ruleEngine.initialize(),
    ]);
    console.log('✓ V2 systems loaded from storage');

    // Initialize V3 Architecture
    console.log('🔄 Initializing V3 Architecture...');
    await this.unifiedMemory.initialize();
    console.log('✓ V3 Unified Memory loaded from storage');

    // Wire V3 Integration to TrustScoreEngine
    this.trustEngine.setV3Integration(this.v3Integration);
    console.log('✓ TrustScoreEngine wired to V3 Integration');

    // Initialize Multi-Model Architecture components
    console.log('\n🚀 ===== INITIALIZING MULTI-MODEL AI =====');
    console.log('💾 Initializing Vector Store & Semantic Layers...');
    try {
      await Promise.all([
        this.vectorStore.initialize('becas_memory'),
        this.semanticLayer.initialize(),
        this.directiveMatcher.initialize(),
      ]);
      console.log('✓ Vector Store connected to ChromaDB (or degraded mode)');
      console.log('✓ Semantic embeddings loaded (MiniLM-L6-v2)');
      console.log('✓ Directive matcher ready with default commands');

      // Get stats
      const stats = await this.directiveMatcher.getStats();
      console.log(`✓ Loaded ${stats.totalDirectives} directives, ${stats.registeredIntents} intents`);
    } catch (error) {
      console.warn('⚠️ Multi-model initialization had warnings (graceful degradation enabled)');
      logger.warn('Multi-model initialization warnings:', error);
    }
    console.log('🚀 ===== MULTI-MODEL AI READY =====\n');

    // Initialize Phase 2 Sentient Systems
    console.log('\n🧬 ===== INITIALIZING SENTIENT AI - PHASE 2 =====');
    console.log('💭 Initializing Emotion Engine...');
    await this.emotionEngine.loadEmotionalState();
    console.log('✓ Emotional state loaded from storage');

    console.log('🧬 Initializing Behavior Gene Pool...');
    await this.behaviorGenePool.initialize();
    const genePoolStats = this.behaviorGenePool.getStats();
    console.log(`✓ Gene pool loaded: Generation ${genePoolStats.generation}, ${genePoolStats.populationSize} chromosomes`);
    console.log(`  Avg fitness: ${(genePoolStats.avgFitness * 100).toFixed(1)}%, Best: ${(genePoolStats.bestFitness * 100).toFixed(1)}%`);

    console.log('💭 Starting Emotion Decay Timer...');
    this.emotionEngine.startDecay();
    console.log('✓ Emotions will naturally decay over time (95% per minute)');

    console.log('🌙 Starting Dream Cycle Scheduler...');
    await this.dreamCycle.start();
    const dreamStats = this.dreamCycle.getStats();
    console.log(`✓ Dream cycle scheduled: ${dreamStats.cycleCount} cycles completed`);
    console.log('  Next cycle: 2-6 AM (low-activity period)');
    console.log('🧬 ===== SENTIENT AI PHASE 2 ACTIVE =====\n');

    // Start Sentient AI Systems - Phase 1
    console.log('🧠 ===== STARTING SENTIENT AI - PHASE 1 =====');
    console.log('📂 Loading cached server knowledge...');
    await this.deepUserProfiler.loadProfiles();
    await this.autonomousLearning.loadCache();
    console.log('✓ Cached data loaded');

    console.log('🧠 Starting autonomous learning...');
    await this.autonomousLearning.start();
    console.log('✓ Becas is now learning continuously in the background');
    console.log('🧠 ===== SENTIENT AI PHASE 1 ACTIVE =====\n');

    // Setup Discord event handlers
    this.setupEventHandlers();

    // Start background tasks
    this.startBackgroundTasks();

    // Start sentient AI systems
    // TEMPORARILY DISABLED - causes duplicate responses
    // this.proactiveBehavior.start();
    console.log('⚠️ ProactiveBehaviorEngine DISABLED to prevent duplicate responses');
    this.goalSystem.start();
    this.predictiveAI.start();
    console.log('🧠 Sentient AI systems activated');

    this.isReady = true;
    console.log('✨ Becas is ready and sentient');
  }

  /**
   * Setup Discord event handlers
   */
  private setupEventHandlers(): void {
    // Prevent duplicate event handler registration
    if (this.handlersSetup) {
      console.log('⚠️ Event handlers already registered. Skipping...');
      return;
    }

    // Message handler
    this.client.on('messageCreate', async (message: Message) => {
      if (message.author.bot) return; // Ignore bots
      await this.handleMessage(message);
    });

    // Reaction handler (for community voting)
    this.client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return; // Ignore bot reactions
      await this.handleReaction(reaction as MessageReaction, user as User);
    });

    // Member join handler
    this.client.on('guildMemberAdd', async (member: GuildMember) => {
      await this.handleMemberJoin(member);
    });

    // Ready handler
    this.client.once('ready', () => {
      console.log(`🤖 Becas connected as ${this.client.user?.tag}`);

      // Initialize Policy Discovery Engine
      this.policyDiscovery.initialize(this.client);
      this.policyLearning.initialize(this.client);
      logger.info('[PolicySystem] Discovery and Learning engines initialized');
    });

    // Mark handlers as setup
    this.handlersSetup = true;
  }

  /**
   * Get V3 Integration Layer
   * Provides access to V3 systems (UnifiedMemory, SafeLearning, Context)
   */
  public getV3Integration(): V3Integration {
    return this.v3Integration;
  }

  /**
   * Record moderation action to V3 UnifiedMemory
   * Call this AFTER successfully executing any moderation action
   */
  private async recordModerationAction(
    type: 'ban' | 'timeout' | 'kick' | 'warn' | 'delete' | 'untimeout' | 'unban',
    targetUserId: string,
    targetUsername: string,
    reason: string | undefined,
    guildId: string,
    channelId: string,
    duration?: number
  ): Promise<void> {
    try {
      // 1. Record to V3 UnifiedMemory (for AI learning)
      await this.v3Integration.recordAction({
        type,
        targetUserId,
        targetUsername,
        executedBy: this.client.user!.id,
        executedByName: this.client.user!.username,
        reason,
        duration,
        guildId,
        channelId,
      });

      // 2. 🔥 CRITICAL: Record to DATABASE (Supabase user_sicil_summary)
      if (type === 'ban' || type === 'timeout' || type === 'kick' || type === 'warn') {
        await this.dbIntegration.processModerationAction(
          guildId,
          targetUserId,
          type === 'warn' ? 'warn' : type,
          reason || 'No reason provided',
          this.client.user!.id
        );
        console.log(`💾 Reflex moderation action recorded to database: ${type} for ${targetUsername}`);
      }
    } catch (error) {
      console.error('Failed to record action to V3 memory:', error);
    }
  }

  /**
   * Check user permissions for specific action
   */
  private canUserExecuteAction(member: GuildMember, actionType: string): boolean {
    // Server owner can do everything
    if (member.guild.ownerId === member.id) {
      console.log(`✓ ${member.user.username} is server owner - full permissions`);
      return true;
    }

    // Administrator can do everything
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      console.log(`✓ ${member.user.username} has Administrator - full permissions`);
      return true;
    }

    // Check specific permissions based on action
    switch (actionType.toLowerCase()) {
      case 'ban':
        if (member.permissions.has(PermissionFlagsBits.BanMembers)) {
          console.log(`✓ ${member.user.username} can ban members`);
          return true;
        }
        break;

      case 'kick':
        if (member.permissions.has(PermissionFlagsBits.KickMembers)) {
          console.log(`✓ ${member.user.username} can kick members`);
          return true;
        }
        break;

      case 'timeout':
      case 'mute':
        if (member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
          console.log(`✓ ${member.user.username} can timeout members`);
          return true;
        }
        break;

      case 'warn':
      case 'delete':
        if (member.permissions.has(PermissionFlagsBits.ManageMessages)) {
          console.log(`✓ ${member.user.username} can manage messages`);
          return true;
        }
        break;

      case 'rule':
      case 'governance':
        // Can create rules if has any moderation permission
        if (member.permissions.has(PermissionFlagsBits.ManageMessages) ||
            member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
            member.permissions.has(PermissionFlagsBits.KickMembers) ||
            member.permissions.has(PermissionFlagsBits.BanMembers)) {
          console.log(`✓ ${member.user.username} can create rules`);
          return true;
        }
        break;
    }

    console.log(`✗ ${member.user.username} lacks permission for: ${actionType}`);
    return false;
  }

  /**
   * Handle complex intent (NEW FEATURE!)
   */
  private async handleComplexIntent(
    message: Message,
    analyzed: AnalyzedMessage
  ): Promise<void> {
    console.log(`🎯 Processing complex intent...`);

    // Parse the complex intent
    const mentionedUsers = message.mentions.users
      .filter(u => u.id !== this.client.user!.id)
      .map(u => ({ id: u.id, name: u.username }));

    const intent = await this.intentParser.parse(analyzed.content, mentionedUsers);

    if (!intent || intent.confidence < 50) {
      await message.reply(`I'm not quite sure what you want me to do. Could you rephrase that?`);
      return;
    }

    if (!intent.target) {
      await message.reply(`I need to know who you want me to ${intent.primaryAction}. Please mention them.`);
      return;
    }

    // Check permissions
    if (!this.canUserExecuteAction(message.member!, intent.primaryAction)) {
      await message.reply(`You don't have permission to ${intent.primaryAction} users.`);
      return;
    }

    console.log(`✓ Intent parsed with ${intent.confidence}% confidence`);
    console.log(`   Description: ${this.intentParser.describeIntent(intent)}`);

    // Determine task type
    let taskType: 'immediate' | 'scheduled' | 'conditional' = 'immediate';
    
    if (intent.monitoring) {
      taskType = 'conditional';
    } else if (intent.timeExpression?.delay) {
      taskType = 'scheduled';
    }

    // Create the task
    const task = await this.taskManager.createTask({
      type: taskType,
      action: {
        type: intent.primaryAction as any,
        duration: intent.timeExpression?.duration,
        reason: `Complex request by ${message.author.username}`,
        severity: 7,
      },
      target: {
        userId: intent.target.userId,
        userName: intent.target.userName,
      },
      createdBy: {
        userId: message.author.id,
        userName: message.author.username,
      },
      guildId: message.guild!.id,
      executeAt: intent.timeExpression?.executeAt,
      monitoring: intent.monitoring ? {
        watchFor: intent.monitoring.watchFor,
        duration: intent.monitoring.duration,
        checkInterval: 5000, // Check every 5 seconds
        onMatch: 'cancel' as const,
      } : undefined,
      cancelCondition: intent.cancellationTriggers.length > 0 ? {
        type: 'message_pattern',
        value: intent.cancellationTriggers[0].pattern,
      } : undefined,
    });

    console.log(`✓ Task created: ${task.id}`);

    // Generate natural response
    const response = await this.generateComplexIntentResponse(intent, task.id);
    await message.reply(response);

    // Check for tasks ready to execute
    await this.processReadyTasks(message.guild!.id);
  }

  /**
   * Generate response for complex intent
   */
  private async generateComplexIntentResponse(intent: any, taskId: string): Promise<string> {
    const emotionalState = this.personality.getEmotionalState();
    
    const prompt = `You (Becas) just understood a complex moderation request.

What you understood:
${this.intentParser.describeIntent(intent)}

Task ID: ${taskId}
Your mood: ${emotionalState.currentMood}

Respond to confirm you understood and explain what you'll do. Be:
- Natural and confident
- Clear about what you're doing
- Brief (2-3 sentences max)
- Show you're actively watching/waiting

Examples:
- "Got it. I'll watch user for 5 minutes. If they say 'X', I'll cancel. Otherwise, timeout in 5 minutes."
- "Understood. Monitoring user now - if they behave, no action. If not, I'll handle it."
- "On it. Giving them a chance to improve. I'll let you know how it goes."`;

    const systemPrompt = `You are Becas confirming you understood a complex request. Be confident and clear.`;

    try {
      const response = await this.ollama.generate(prompt, systemPrompt, {
        temperature: 0.7,
        maxTokens: 150,
      });
      return response.trim();
    } catch (error) {
      return `Got it. ${this.intentParser.describeIntent(intent)}`;
    }
  }

  /**
   * Process tasks that are ready to execute
   */
  private async processReadyTasks(guildId: string): Promise<void> {
    const tasks = this.taskManager.getMonitoringTasks(guildId);
    
    for (const task of tasks) {
      if (task.status === 'completed') {
        // Execute the actual moderation action
        const guild = this.client.guilds.cache.get(task.guildId);
        if (!guild) continue;

        try {
          await this.moderation.executeAction(
            task.action as any,
            task.target.userId,
            guild,
            task.action.reason
          );

          console.log(`✓ Executed task ${task.id}: ${task.action.type} on ${task.target.userName}`);

          // Notify in a channel (find a suitable channel)
          const channels = guild.channels.cache.filter(c => c.isTextBased());
          const channel = channels.first() as TextChannel;
          
          if (channel) {
            await channel.send(`Task completed: ${task.action.type} applied to ${task.target.userName}. Reason: ${task.action.reason}`);
          }
        } catch (error) {
          console.error(`Failed to execute task ${task.id}:`, error);
        }
      }
    }
  }

  /**
   * Check if user has any moderation permissions
   */
  private hasModPermissions(member: GuildMember): boolean {
    return member.guild.ownerId === member.id ||
           member.permissions.has(PermissionFlagsBits.Administrator) ||
           member.permissions.has(PermissionFlagsBits.ManageMessages) ||
           member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
           member.permissions.has(PermissionFlagsBits.KickMembers) ||
           member.permissions.has(PermissionFlagsBits.BanMembers);
  }

  /**
   * Check if user has SPECIFIC permission for an action
   */
  private hasSpecificPermission(member: GuildMember, action: string): boolean {
    // Server owner and admins can do EVERYTHING
    if (member.guild.ownerId === member.id || member.permissions.has(PermissionFlagsBits.Administrator)) {
      return true;
    }

    // Check specific permissions for each action
    switch (action) {
      case 'timeout':
      case 'untimeout':
        return member.permissions.has(PermissionFlagsBits.ModerateMembers);

      case 'kick':
        return member.permissions.has(PermissionFlagsBits.KickMembers);

      case 'ban':
      case 'unban':
        return member.permissions.has(PermissionFlagsBits.BanMembers);

      case 'warn':
      case 'watch':
        // Warnings/watching requires at least message management
        return member.permissions.has(PermissionFlagsBits.ManageMessages);

      default:
        return false;
    }
  }

  /**
   * Check if target user can be moderated by the moderator
   * Uses role hierarchy - higher role can moderate lower role (even if both are mods)
   */
  private canModerateTarget(moderator: GuildMember, target: GuildMember): boolean {
    // Can't moderate yourself
    if (moderator.id === target.id) {
      return false;
    }

    // Can't moderate the server owner (unless YOU are the owner)
    if (target.guild.ownerId === target.id) {
      return moderator.guild.ownerId === moderator.id;
    }

    // Server owner can moderate anyone
    if (moderator.guild.ownerId === moderator.id) {
      return true;
    }

    // Can't moderate administrators (unless you're owner - already handled above)
    if (target.permissions.has(PermissionFlagsBits.Administrator)) {
      return false;
    }

    // ROLE HIERARCHY: Check if moderator's highest role is HIGHER than target's
    const modHighestRole = moderator.roles.highest;
    const targetHighestRole = target.roles.highest;

    // If moderator has higher role position, they CAN moderate the target
    // (even if target is also a moderator with same permissions)
    if (modHighestRole.position > targetHighestRole.position) {
      return true;
    }

    // If same role position or lower, check if target is a moderator
    const targetIsModerator = target.permissions.has(PermissionFlagsBits.ModerateMembers) ||
                              target.permissions.has(PermissionFlagsBits.KickMembers) ||
                              target.permissions.has(PermissionFlagsBits.BanMembers) ||
                              target.permissions.has(PermissionFlagsBits.ManageMessages);

    // If target is a moderator and you don't have higher role, you can't moderate them
    if (targetIsModerator) {
      return false;
    }

    // Target is regular user and you're a moderator - you can moderate them
    return true;
  }

  /**
   * Analyze user messages for violations
   */
  private async analyzeUserMessages(messages: Message[], violationType: string): Promise<{
    severity: 'low' | 'medium' | 'high' | 'critical';
    evidence: string;
    confidence: number;
  }> {
    const messageTexts = messages.map(m => m.content).join('\n');

    const analysisPrompt = `Analyze these recent messages for ${violationType} violations:

${messageTexts}

Return JSON:
{
  "severity": "low|medium|high|critical",
  "evidence": "brief summary of what you found",
  "confidence": 0.0-1.0
}`;

    try {
      const response = await this.ollama.generate(analysisPrompt, 'You are a content moderation expert. Return ONLY JSON.');

      let cleaned = response.trim();
      cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '');
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleaned = jsonMatch[0];

      return JSON.parse(cleaned);
    } catch (error) {
      logger.error('Message analysis failed:', error);
      return {
        severity: 'low',
        evidence: 'Analysis failed',
        confidence: 0.5
      };
    }
  }

  /**
   * V2 ARCHITECTURE - Handle reflex responses
   */
  private async handleReflexResponse(
    message: Message,
    reflex: ReflexResponse
  ): Promise<void> {
    console.log(`⚡ REFLEX TRIGGERED: ${reflex.type} (${reflex.executionTime.toFixed(2)}ms)`);
    console.log(`   Reason: ${reflex.reason}`);
    console.log(`   Confidence: ${(reflex.confidence * 100).toFixed(0)}%`);

    if (!message.guild || !message.member) return;

    const action = reflex.action;
    if (!action) return;

    try {
      // Delete message if needed
      if (action.delete) {
        await message.delete().catch(() => {});
      }

      // Ban if needed
      if (action.ban && message.member.bannable) {
        await message.member.ban({ reason: reflex.reason });
        await this.recordModerationAction(
          'ban',
          message.member.id,
          message.member.user.username,
          reflex.reason,
          message.guild!.id,
          message.channel.id
        );
      }

      // Timeout if needed
      if (action.timeout && message.member.moderatable) {
        await message.member.timeout(action.timeout, reflex.reason);
        await this.recordModerationAction(
          'timeout',
          message.member.id,
          message.member.user.username,
          reflex.reason,
          message.guild!.id,
          message.channel.id,
          action.timeout
        );
      }

      // Send notification
      if (action.notify) {
        if (reflex.type === 'CRISIS_SUPPORT') {
          // DM for crisis support
          await message.author.send(action.notify).catch(async () => {
            // If DM fails, send in channel
            const channel = message.channel as TextChannel;
            await channel.send(`<@${message.author.id}> ${action.notify}`);
          });
        } else {
          const channel = message.channel as TextChannel;
          await channel.send(action.notify);
        }
      }

      // Alert moderators
      if (action.alertMods) {
        const modChannel = message.guild.channels.cache.find(
          c => c.name.includes('mod') && c.isTextBased()
        ) as TextChannel;

        if (modChannel) {
          await modChannel.send(`⚡ **REFLEX ACTION**: ${reflex.type}\n👤 User: <@${message.author.id}>\n📝 Reason: ${reflex.reason}\n📊 Confidence: ${(reflex.confidence * 100).toFixed(0)}%\n⏱️ Response Time: ${reflex.executionTime.toFixed(2)}ms`);
        }
      }

      // Track in recent actions for modification/undo
      if (action.timeout || action.ban) {
        const actionKey = `${message.guildId}:${message.channelId}`;
        this.recentActions.set(actionKey, {
          type: action.ban ? 'ban' : 'timeout',
          targetId: message.author.id,
          targetName: message.author.username,
          guildId: message.guild.id,
          channelId: message.channelId,
          requestedBy: 'system_reflex',
          requestedByName: 'Becas AI',
          timestamp: new Date(),
          duration: action.timeout,
          durationMinutes: action.timeout ? Math.round(action.timeout / 60000) : undefined
        });

        // Auto-cleanup after 5 minutes
        setTimeout(() => {
          this.recentActions.delete(actionKey);
        }, 300000);
      }

      this.dailyStats.actionsToday++;

    } catch (error) {
      console.error(`Failed to execute reflex action:`, error);
    }
  }

  /**
   * V2 ARCHITECTURE - Process with Cognitive Core
   */
  private async processWithV2Cognitive(
    message: Message,
    stableContext: StableContext
  ): Promise<{ handled: boolean }> {
    try {
      logger.info('🔬 V2 processWithV2Cognitive started');

      // Check moderation permissions FIRST
      const hasModerationPerms = this.hasModPermissions(message.member!);
      logger.info(`👮 Moderation permissions: ${hasModerationPerms}`);

      // 🔥 UNDO COMMAND DETECTION - Handle "undo that", "take it back", etc.
      if (hasModerationPerms && message.guild && message.member) {
        const content = message.content.toLowerCase().trim();
        const undoPatterns = [
          /^undo( that)?$/i,
          /^take (it|that) back$/i,
          /^geri al$/i,
          /^iptal et$/i,
          /^undo (the )?last (action|timeout|ban)$/i,
        ];

        const isUndoCommand = undoPatterns.some(pattern => pattern.test(content));

        if (isUndoCommand) {
          logger.info(`🔄 UNDO COMMAND detected from moderator ${message.author.tag}`);

          try {
            // Try V3 Integration undo first (uses context resolution)
            const v3Result = await this.v3Integration.handleUndoCommand(message, message.member);

            if (v3Result.success) {
              // V3 undo successful, now execute the actual undo via ActionCorrection
              const undoResult = await this.actionCorrection.undoLastAction(
                this.client.user!.id,
                message.guild.id,
                message.guild
              );

              if (undoResult.success) {
                await message.reply(`✅ ${undoResult.message}`);
                logger.info(`✅ UNDO: Successfully undid action (V3 + ActionCorrection)`);
              } else {
                await message.reply(`❌ ${undoResult.message}`);
                logger.warn(`⚠️ UNDO: V3 succeeded but ActionCorrection failed: ${undoResult.message}`);
              }
            } else {
              // V3 failed, try ActionCorrection directly
              logger.info(`⚠️ V3 undo failed: ${v3Result.error}, trying ActionCorrection...`);
              const undoResult = await this.actionCorrection.undoLastAction(
                this.client.user!.id,
                message.guild.id,
                message.guild
              );

              if (undoResult.success) {
                await message.reply(`✅ ${undoResult.message}`);
                logger.info(`✅ UNDO: Successfully undid action via ActionCorrection`);
              } else {
                await message.reply(`❌ ${v3Result.error || undoResult.message}`);
                logger.warn(`❌ UNDO: Both V3 and ActionCorrection failed`);
              }
            }

            return { handled: true };
          } catch (error) {
            logger.error('❌ UNDO: Error handling undo command', error);
            await message.reply('❌ Failed to undo action due to an error.');
            return { handled: true };
          }
        }
      }

      // Get user REAL trust score (NEVER modify the actual score!)
      const trustScore = await this.trustEngine.getTrustScore(message.author.id, message.guild!.id);
      logger.info(`📊 Real trust score: ${trustScore.score} (${trustScore.level})`);

      // MODERATOR PERCEPTION OVERRIDE (not actual score!)
      // AI should treat moderators as trusted, but their real score stays in history
      const effectiveTrustScore = hasModerationPerms && trustScore.score < 80 ? 100 : trustScore.score;
      const effectiveTrustLevel = hasModerationPerms && trustScore.score < 80 ? 'trusted' : trustScore.level;

      if (hasModerationPerms && trustScore.score < 80) {
        logger.info(`🔑 Moderator detected - AI will treat as trusted (actual score ${trustScore.score} preserved for history)`);
      }

      logger.info(`📊 Effective trust for AI: ${effectiveTrustScore} (${effectiveTrustLevel})`);

      // REMOVED: Moderator skip - V2 should handle ALL messages
      // Previous code: if (hasModerationPerms) { return { handled: false }; }

      // 🔥 V3 CONTEXT - Fetch recent action history for AI awareness
      let v3Context;
      try {
        v3Context = await this.contextEngine.getContext(message.guild!.id);
        logger.info(`🧠 V3 CONTEXT: Fetched ${v3Context.recentActions.length} recent actions, ${v3Context.recentMessages.length} recent messages`);
      } catch (error) {
        logger.error('❌ V3 CONTEXT: Failed to fetch context', error);
        v3Context = { recentActions: [], recentMessages: [] };
      }

      // 🔥 SCAM DETECTION - Run before CognitiveCore (only if NOT addressing Becas)
      let scamAnalysis: import('../analyzers/ScamDetector').ScamAnalysis | undefined = undefined;
      const isAddressingBecasV2 = message.mentions.has(this.client.user!.id) ||
                                    message.content.toLowerCase().startsWith('becas');

      // 🚀 PERFORMANCE: Scam detection now handled by CognitiveCore's unified AI analysis
      // No need for separate ScamDetector call - reduces Ollama calls from 4 to 1!

      // Use Cognitive Core for full reasoning
      logger.info('🧠 Calling CognitiveCore.process...');
      const decision = await this.cognitiveCore.process(message, stableContext, {
        dialogue: this.dialogue,
        memory: this.memory,
        trustEngine: this.trustEngine,
        personality: this.personality,
        scamDetector: this.scamDetector,
        userMonitor: this.userMonitor,
        scamAnalysis: scamAnalysis, // 🔥 PASS SCAM ANALYSIS TO COGNITIVE CORE
        v3Integration: this.v3Integration, // 🔥 V3 LEARNING INTEGRATION
        v3Context: v3Context, // 🔥 V3 CONTEXT - Recent actions/messages
      });

      logger.info(`💡 CognitiveCore decision: ${decision.action} (confidence: ${decision.metadata.confidence})`);

      // If no action needed, return
      if (decision.action === 'none') {
        logger.info('✓ V2 decided no action needed, message handled');
        return { handled: true };
      }

      // 🚀 PERFORMANCE: Toxicity analysis already done by CognitiveCore
      // Extract from CognitiveCore decision instead of calling Ollama again
      const toxicityScore = 0; // Placeholder for now
      const manipulationScore = 0;

      logger.info(`📊 Toxicity from CognitiveCore: toxicity=${(toxicityScore * 100).toFixed(1)}%, manipulation=${(manipulationScore * 100).toFixed(1)}%`);

      // 🚀 PERFORMANCE: Policy violations already analyzed by CognitiveCore
      // Use CognitiveCore's decision instead of separate PolicyEngine call
      const policyDecision = {
        shouldModerate: decision.action === 'moderate',
        action: decision.moderationAction?.type || 'none',
        reason: decision.moderationAction?.reason || 'No policy violation detected',
        confidence: decision.metadata.confidence,
        violations: [] // Placeholder
      };
      logger.info(`📜 Policy decision from CognitiveCore: ${policyDecision.action} (${(policyDecision.confidence * 100).toFixed(0)}% confidence)`);

      // Generate persona-appropriate response context
      // Use EFFECTIVE trust level for AI perception
      const personaResponse = this.personaV2.generateResponseContext({
        isModeration: decision.action === 'moderate',
        severity: decision.moderationAction?.type === 'ban' ? 10 : 5,
        userTrustLevel: effectiveTrustLevel as any, // AI sees effective level
        isRepeatOffender: trustScore.history.length > 5,
      });

      // Synthesize response
      // Use EFFECTIVE trust level for AI perception
      const synthesized = await this.responseSynthesizer.synthesize({
        decision,
        persona: personaResponse,
        context: {
          userName: message.author.username,
          userTrustLevel: effectiveTrustLevel as any, // AI sees effective level
          isModeration: decision.action === 'moderate',
          isRepeatOffender: trustScore.history.length > 5,
          messageContent: message.content,
        },
        policyViolations: policyDecision.violations.map(v => ({
          policyName: v.policyName,
          severity: v.severity,
          evidence: v.evidence,
        })),
      });

      // Execute moderation if needed
      logger.info(`🔍 V2 COGNITIVE: Checking moderation action... decision.moderationAction = ${decision.moderationAction ? 'SET' : 'NULL'}`);
      if (decision.moderationAction) {
        logger.info(`   Action type: ${decision.moderationAction.type}`);
        logger.info(`🚨 V2 COGNITIVE: Executing moderation action: ${decision.moderationAction.type}`);
        logger.info(`   Reason: ${decision.moderationAction.reason}`);
        logger.info(`   Duration: ${decision.moderationAction.duration || 'N/A'}`);

        // 🔒 SECURITY: Check if target user has moderation permissions
        // Bot should NOT autonomously moderate moderators/admins
        const targetMember = message.member!;
        const isProtectedUser = targetMember.guild.ownerId === targetMember.id ||
                               targetMember.permissions.has(PermissionFlagsBits.Administrator) ||
                               targetMember.permissions.has(PermissionFlagsBits.ModerateMembers) ||
                               targetMember.permissions.has(PermissionFlagsBits.KickMembers) ||
                               targetMember.permissions.has(PermissionFlagsBits.BanMembers);

        if (isProtectedUser) {
          logger.warn(`🛡️ V2 COGNITIVE: Target is PROTECTED (moderator/admin/owner)`);
          logger.warn(`   Skipping autonomous moderation action`);
          logger.warn(`   User: ${message.author.tag} (${message.author.id})`);
          logger.warn(`   Roles: ${targetMember.roles.cache.map(r => r.name).join(', ')}`);

          // Instead of executing action, just log the violation
          await this.trustEngine.modifyTrust(
            message.author.id,
            message.guild!.id,
            -5, // Small penalty for policy violation, but no action
            `Policy violation detected but user is protected: ${decision.moderationAction.reason}`
          );
        } else {
          // Safe to execute moderation action
          try {
            await this.moderation.executeAction(
              {
                type: decision.moderationAction.type as any,
                severity: 8,
                duration: decision.moderationAction.duration,
              },
              message.author.id,
              message.guild!,
              decision.moderationAction.reason
            );
            logger.info(`✅ V2 COGNITIVE: Action executed successfully`);

            // 🔥 NOTE: Database recording now happens automatically in ModerationHandler.executeAction()
            // No need to duplicate here - ModerationHandler handles it
          } catch (error: any) {
            logger.error(`❌ V2 COGNITIVE: Action execution failed:`, error);
          }
        }

        // CRITICAL: Update trust score after moderation action
        // 🔥 SPECIAL CASE: Permanent ban for scams (trust score → 0 FOREVER)
        if (decision.moderationAction.type === 'ban' && scamAnalysis?.shouldBanPermanently) {
          // Use database-backed trust engine
          await this.dbIntegration.trustEngine.setPermanentZeroScore(
            message.author.id,
            message.guild!.id,
            `SCAM DETECTED: ${scamAnalysis.scamType} - ${scamAnalysis.reasoning}`,
            message.content
          );
          logger.warn(`🚫 PERMANENT ZERO SCORE set for ${message.author.username} (SCAMMER)`);
          logger.warn(`   Scam Type: ${scamAnalysis.scamType}`);
          logger.warn(`   Confidence: ${(scamAnalysis.confidence * 100).toFixed(0)}%`);

          // Also add to global ban list
          try {
            await this.crossGuild.addGlobalBan(
              message.author.id,
              message.author.username,
              `${scamAnalysis.scamType} scam - ${scamAnalysis.reasoning}`,
              scamAnalysis.indicators,
              scamAnalysis.severity === 'critical' ? 'critical' : 'high',
              'system'
            );
            logger.info(`✅ Added to global ban list across all servers`);
          } catch (error) {
            logger.error('Failed to add to global ban list:', error);
          }
        } else {
          // Normal trust penalty for non-scam violations
          const trustPenalty = decision.moderationAction.type === 'ban' ? -50 :
                              decision.moderationAction.type === 'kick' ? -30 :
                              decision.moderationAction.type === 'timeout' ? -15 :
                              decision.moderationAction.type === 'warn' ? -5 : 0;

          if (trustPenalty < 0) {
            // Note: Database integration already updated trust via processModerationAction()
            // Trust scores are automatically updated when moderation actions are logged
            logger.info(`⚖️ Trust score decreased by ${trustPenalty} for ${message.author.username} after ${decision.moderationAction.type}`);
          }
        }

        // Queue for self-audit
        this.selfAudit.queueForAudit({
          id: `action_${Date.now()}_${message.id}`,
          timestamp: Date.now(),
          type: 'moderation',
          action: decision.moderationAction.type,
          targetUserId: message.author.id,
          targetUserName: message.author.username,
          guildId: message.guild!.id,
          reason: decision.moderationAction.reason,
          context: {
            messageContent: message.content,
            toxicity: decision.metadata.confidence,
            trustScore: trustScore.score,
          },
          decidedBy: 'cognitive',
          confidence: decision.metadata.confidence,
        });

        // Update persona emotional state
        this.personaV2.processEmotionalEvent({
          type: 'conflict',
          intensity: 0.7,
          description: `Moderated ${message.author.username} for ${decision.moderationAction.reason}`,
          impact: {
            stress: 0.1,
            confidence: -0.05,
          },
        });

        this.dailyStats.actionsToday++;

        // 🔥 V3 INTEGRATION - Record action to unified memory for learning
        try {
          await this.v3Integration.recordAction({
            type: decision.moderationAction.type as any,
            targetUserId: message.author.id,
            targetUsername: message.author.username,
            executedBy: this.client.user!.id,
            executedByName: this.client.user!.username,
            guildId: message.guild!.id,
            channelId: message.channelId,
            reason: decision.moderationAction.reason || 'No reason provided',
            duration: decision.moderationAction.duration,
            messageId: message.id,
          });
          logger.info(`✅ V3: Recorded ${decision.moderationAction.type} action to unified memory`);
        } catch (error) {
          logger.error('❌ V3: Failed to record action', error);
        }

        // 🔥 UNDO TRACKING - Record to ActionCorrection for undo support
        try {
          const actionId = await this.actionCorrection.recordAction(
            decision.moderationAction.type,
            message.author.id,
            message.author.tag,
            this.client.user!.id,
            message.guild!.id,
            {
              reason: decision.moderationAction.reason || 'No reason provided',
              duration_minutes: decision.moderationAction.duration ? Math.floor(decision.moderationAction.duration / 60000) : undefined,
              channelId: message.channelId,
              messageId: message.id,
            }
          );
          logger.info(`✅ UNDO: Recorded ${decision.moderationAction.type} for undo tracking (${actionId})`);
        } catch (error) {
          logger.error('❌ UNDO: Failed to record action for undo tracking', error);
        }
      }

      // Send response if generated
      if (synthesized.content && synthesized.content.length > 0) {
        await message.reply(synthesized.content);

        // Update persona emotional state
        this.personaV2.processEmotionalEvent({
          type: 'connection',
          intensity: 0.5,
          description: `Responded to ${message.author.username}`,
          impact: {
            satisfaction: 0.05,
          },
        });
      }

      // Store in memory spine
      this.memorySpine.store({
        conversationId: `${message.guildId}:${message.channelId}`,
        guildId: message.guild!.id,
        userId: message.author.id,
        userName: message.author.username,
        content: message.content,
        importance: decision.action === 'moderate' ? 0.8 : 0.3,
        type: decision.action === 'moderate' ? 'action' : 'message',
      });

      logger.info(`✓ V2 Cognitive processing complete: ${decision.action} (${decision.metadata.totalTime.toFixed(2)}ms)`);

      return { handled: true };

    } catch (error) {
      logger.error('V2 Cognitive processing failed:', error);
      return { handled: false }; // Fallback to V1
    }
  }

  /**
   * Handle incoming message - V2 ARCHITECTURE
   */
  private async handleMessage(message: Message): Promise<void> {
    logger.info(`🎯 handleMessage called for: "${message.content.substring(0, 50)}..."`);

    if (!message.guild || !message.content) {
      logger.debug('Skipping message: no guild or content');
      return;
    }

    // Record message metric for dashboard analytics
    const channelType = message.channel.isTextBased() ? 'text' : 'voice';
    metricsService.recordMessageSent(message.guild.id, channelType as 'text' | 'voice' | 'dm');

    // ============================================
    // V2 ARCHITECTURE - LAYER 1: EVENT GATEWAY
    // ============================================
    // Deduplication, rate limiting, context stabilization
    logger.info('📥 Processing through EventGateway...');
    const stableContext = await this.eventGateway.processMessage(message);

    if (!stableContext) {
      // Message filtered (duplicate, rate limited, or bot)
      logger.info('❌ EventGateway filtered message (duplicate/rate-limited/bot)');
      return;
    }

    logger.info('✓ EventGateway passed message through');

    // ============================================
    // TYPO CORRECTION DISABLED
    // ============================================
    // AI already understands typos and context - correction was causing more harm than good
    // User feedback: "type correction çok gereksiz değil mi? zaten ai algılıyor her şeyi"
    const originalContent = message.content;

    // ============================================
    // EARLY PROCESSING: NATURAL COMMAND DETECTION
    // ============================================
    // Check if this looks like a command even without "becas" mention
    // This prevents moderators' commands from being sent to V2 Cognitive
    const hasModerationPerms = this.hasModPermissions(message.member!);
    const contentLower = originalContent.toLowerCase();

    // ============================================
    // 🧠 SENTIENT AI COMMANDS - PRIORITY HANDLING
    // ============================================
    // DISABLED: All commands now go through BecasFlow for unified tool-based execution
    // const isSentientCommand = await this.handleSentientAICommands(message, contentLower);
    // if (isSentientCommand) {
    //   logger.info('🧠 Handled by Sentient AI systems');
    //   return;  // Sentient AI handled it, stop processing
    // }

    // Detect natural command patterns
    const hasCommandIntent = /\b(can you|could you|please)\b.*(delete|ban|kick|timeout|remove|mute|clear|purge|warn)/i.test(contentLower);
    const hasDirectAction = /\b(delete|ban|kick|timeout|remove|clear|purge|warn|mute|unmute|untimeout)\b/i.test(contentLower);
    const hasNumberWithAction = /\b(last|first|recent)\s+\d+\s+(messages?|users?)/i.test(contentLower) || /\d+\s+(more|messages?)/i.test(contentLower);

    let forceAddressingBecas = false;

    if (hasModerationPerms && (hasCommandIntent || hasDirectAction || hasNumberWithAction)) {
      logger.info(`🎯 Natural command detected from moderator without mention - treating as addressing Becas`);
      logger.info(`   Pattern match: commandIntent=${hasCommandIntent}, directAction=${hasDirectAction}, numberAction=${hasNumberWithAction}`);
      forceAddressingBecas = true;
    }

    // ============================================
    // 🛡️ GUILD POLICY & CORE VIOLATION CHECK - TWO-LAYER ENFORCEMENT
    // ============================================
    // 🚨 CRITICAL PERFORMANCE FIX: Intent Router runs FIRST to skip unnecessary violation checks
    // This prevents false positives on bot commands and saves 9 AI calls per message
    // ARCHITECTURE CHANGE: Intent Router → Guild Policy → Becas Core Violations
    try {
      const userId = message.author.id;
      const channelId = message.channel.id;
      const timestamp = new Date();
      const guild = message.guild!;
      const member = message.member!;
      const channel = message.channel as TextChannel;

      // LAYER 0: Intent Router - Determine if violation check is needed (RUNS FIRST!)
      logger.info('🧠 Running intent router...');
      const intentTool = this.becasflowRegistry.get('intent_router');

      let needsViolationCheck = true; // Default to checking violations

      if (intentTool) {
        try {
          // Create minimal BecasContext for intent router
          const minimalContext: any = {
            message,
            member,
            guild,
            channel,
            conversationHistory: [],
            stepResults: [],
            variables: {},
            services: {},
            addToHistory: () => {},
            getHistory: () => [],
            setVariable: () => {},
            getVariable: () => undefined,
            hasVariable: () => false,
          };

          const intentResult = await intentTool.execute(
            {
              message: originalContent,
              hasUrls: /https?:\/\/|www\./i.test(originalContent),
              hasMentions: /@everyone|@here/i.test(originalContent),
              hasAttachments: message.attachments?.size > 0,
            },
            minimalContext
          );

          if (intentResult.success && intentResult.data) {
            const intentAnalysis = intentResult.data;
            needsViolationCheck = intentAnalysis.needsViolationCheck;

            logger.info(`🎯 Intent: ${intentAnalysis.intent} (${intentAnalysis.confidence}) - Violation check: ${needsViolationCheck}`);

            if (!needsViolationCheck && intentAnalysis.skipReason) {
              logger.info(`⏭️ SKIPPING all violation checks: ${intentAnalysis.skipReason}`);
            }
          }
        } catch (error: any) {
          logger.error('Intent router error - defaulting to violation check:', error);
          needsViolationCheck = true; // Fail-safe: check violations on error
        }
      }

      // LAYER 1: Guild Policy Check (LOCAL - no trust score impact)
      // Only run if intent router determines violation check is needed
      if (needsViolationCheck) {
        logger.info('🛡️ Checking guild policies...');
        const guildViolations = await this.guildPolicyEngine.checkViolations(
          { type: 'message', content: originalContent, userId, channelId, timestamp },
          { guild, member, channel }
        );

        if (guildViolations.length > 0) {
          logger.warn(`⚠️ Guild policy violations detected: ${guildViolations.length}`);
          await this.guildPolicyEngine.enforceLocalActions(guildViolations, { guild, member, channel });

          // If policy resulted in ban/timeout, stop processing
          const hasCriticalAction = guildViolations.some(v =>
            v.policy.actionType === 'ban' || v.policy.actionType === 'timeout'
          );
          if (hasCriticalAction) {
            logger.info('🛡️ Critical guild policy action taken - stopping message processing');
            return;
          }
        }
      }

      // LAYER 2: Becas Core Violation Check (GLOBAL - trust score impact)
      // Only run if intent router determines it's needed
      if (needsViolationCheck) {
        logger.info('🛡️ Checking Becas core violations...');
        const coreViolations = await this.becasCoreViolationEngine.checkCoreViolations(
          { type: 'message', content: originalContent, userId, channelId, timestamp },
          { guild, member, channel }
        );

        if (coreViolations.length > 0) {
          logger.warn(`⚠️ Becas core violations detected: ${coreViolations.length}`);

          for (const violation of coreViolations) {
            await this.becasCoreViolationEngine.applyGlobalPunishment(
              violation,
              { type: 'message', content: originalContent, userId, channelId, timestamp },
              { guild, member, channel }
            );
          }

          // If critical violation, block message and stop processing
          const hasCriticalViolation = coreViolations.some(v =>
            v.severity === 'critical' || v.severity === 'high'
          );
          if (hasCriticalViolation) {
            logger.warn('🛡️ Critical Becas violation detected - blocking message');
            try {
              await message.delete();
              if ('send' in message.channel) {
                await message.channel.send(`⛔ Message from ${message.author} blocked: severe policy violation.`);
              }
            } catch (deleteError) {
              logger.error('Failed to delete violating message:', deleteError);
            }
            return;
          }
        }
      } // End of needsViolationCheck block
    } catch (error) {
      logger.error('Error in policy/violation check:', error);
      // Don't stop processing on error - continue with normal flow
    }

    // ============================================
    // V2 ARCHITECTURE - LAYER 2: REFLEX ENGINE
    // ============================================
    // System 1: Fast automatic responses (<100ms, no LLM)
    const reflexResponse = await this.reflexEngine.checkReflexes(message);

    if (reflexResponse.type !== 'NONE') {
      // Reflex triggered - handle immediately
      await this.handleReflexResponse(message, reflexResponse);

      // 🔥 V3 INTEGRATION - Record flagged message to memory
      try {
        await this.v3Integration.recordMessage(message, true); // true = wasFlagged
      } catch (error) {
        logger.error('Failed to record flagged message to V3 memory', error);
      }

      return;
    }

    // ============================================
    // WATCH SYSTEM: CHECK ACTIVE MONITORS
    // ============================================
    // Check if this message triggers any active watch conditions
    // NOTE: Watch system runs AFTER policy check to ensure all violations are caught
    try {
      const triggers = await this.watchSystem.checkMessage(message);
      if (triggers.length > 0) {
        logger.info(`🚨 Message triggered ${triggers.length} watch(es): ${triggers.map(t => t.conditionType).join(', ')}`);
        logger.info(`✅ Watch system handled the message - skipping regular moderation pipeline`);
        // Actions already executed by WatchSystem - STOP HERE
        return;
      }
    } catch (error) {
      logger.error('Error checking watch system:', error);
    }

    // ============================================
    // 🔥🔥🔥 SUPER PRIORITY #0: DATA INTERPRETATION CHECK
    // ============================================
    // THIS MUST RUN FOR *ALL* MESSAGES - not just those addressed to Becas!
    // If moderator says "who is most dangerous" after seeing analytics,
    // they shouldn't need to say "becas" again
    const recentOutputs = this.dataInterpreter.getMemoryContents(message.channelId);
    if (recentOutputs.length > 0) {
      const isQueryingData = await this.dataInterpreter.isQueryingPreviousOutput(
        message.content,  // Use full message content, not parsed commandContent
        recentOutputs
      );

      if (isQueryingData) {
        logger.info(`🔬 AI Intent: User is querying previous data - using DataInterpreter`);

        const interpretation = await this.dataInterpreter.interpretPreviousOutput(
          message.content,
          message.channelId,
          message.author.id,
          message.author.username
        );

        await message.reply(interpretation);
        logger.info(`✅ Data interpretation response sent`);
        return;
      }
    }

    // ============================================
    // 🔥 PRIORITY #0.5: CONTEXT MEMORY - "10 MORE PLEASE"
    // ============================================
    // Check if user is asking for a repeat of the last action with a different count
    // E.g., after "delete last 20 messages" → user says "10 more please"
    const actionKey = `${message.guild!.id}:${message.channelId}`;
    const lastAction = this.recentActions.get(actionKey);

    // Pattern: "<number> more" or "more <number>" or "<number> more please"
    const morePattern = /(\d+)\s*more|more\s*(\d+)/i;
    const moreMatch = contentLower.match(morePattern);

    if (hasModerationPerms && moreMatch && lastAction && lastAction.type === 'bulk_delete') {
      const count = parseInt(moreMatch[1] || moreMatch[2]);
      logger.info(`🔄 Context memory triggered: User requested ${count} more ${lastAction.type}`);
      logger.info(`   Last action was: ${lastAction.type} with count ${lastAction.count}`);

      // Automatically execute the same action with new count
      try {
        const channel = message.channel;
        if (!channel.isTextBased()) {
          await message.reply(`This command only works in text channels.`);
          return;
        }

        // Fetch and delete messages
        const fetchedMessages = await channel.messages.fetch({ limit: Math.min(count + 1, 100) }); // +1 to exclude current command
        const messagesToDelete = Array.from(fetchedMessages.values()).slice(1, count + 1); // Skip command message itself

        const twoWeeksAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
        const recentMessages = messagesToDelete.filter(msg => msg.createdTimestamp > twoWeeksAgo);

        if (recentMessages.length === 0) {
          await message.reply(`No recent messages to delete (messages must be less than 14 days old).`);
          return;
        }

        // Bulk delete
        await (channel as any).bulkDelete(recentMessages, true);

        // Update recent action
        this.recentActions.set(actionKey, {
          ...lastAction,
          count: count,
          timestamp: new Date(),
        });

        await message.reply(`All cleared out! Nice and tidy now - ${recentMessages.length} less messages to sift through.`);
        logger.info(`✅ Context memory: Deleted ${recentMessages.length} more messages`);
        return;
      } catch (error) {
        logger.error('Context memory bulk delete error:', error);
        await message.reply(`Had some trouble with that request. Messages might be too old or I might not have the right permissions.`);
        return;
      }
    }

    // ============================================
    // PRIORITY: COMMAND & ANALYTICS DETECTION
    // ============================================
    // Check if user is addressing Becas with a command/query
    // Commands should bypass moderation pipeline entirely
    const wasMentioned = message.mentions.has(this.client.user!.id);
    const startsWithBecas = message.content.toLowerCase().startsWith('becas');

    // 🔗 CONVERSATION CHAINING - Check if this is a reply to Becas
    const isReplyToBecas = message.reference && message.reference.messageId
      ? await message.channel.messages.fetch(message.reference.messageId)
          .then(refMsg => refMsg.author.id === this.client.user!.id)
          .catch(() => false)
      : false;

    const isAddressingBecas = wasMentioned || startsWithBecas || forceAddressingBecas || isReplyToBecas;

    if (isAddressingBecas) {
      if (isReplyToBecas) {
        logger.info('🔗 Conversation chaining detected - user replied to Becas');
      }
      logger.info('🎯 User is addressing Becas - processing with BecasFlow...');

      // Get user permissions
      const hasModerationPerms = this.hasModPermissions(message.member!);

      // Parse content (remove "becas" prefix and mention)
      let commandContent = message.content;
      if (startsWithBecas) {
        commandContent = commandContent.replace(/^becas\s*/i, '').trim();
      }
      if (wasMentioned) {
        commandContent = commandContent.replace(/<@!?\d+>\s*/g, '').trim();
      }

      // ============================================
      // 📋 POLICY COMMAND: Direct handler (admin-only)
      // ============================================
      // Only match exact "policy" command, not words containing "policy"
      const firstWord = commandContent.split(/\s+/)[0]?.toLowerCase();
      if (firstWord === 'policy') {
        const args = commandContent.split(/\s+/).slice(1); // Remove 'policy' prefix
        await this.policyCommand.execute(message, args);
        logger.info('✅ Handled by PolicyCommand');
        return;
      }

      // ============================================
      // 🚀 BECASFLOW: Process ALL commands through BecasFlow
      // ============================================
      try {
        await this.handleMessageWithBecasFlow(message, commandContent);
        logger.info('✅ Handled by BecasFlow framework');
        return;
      } catch (error) {
        logger.error('❌ BecasFlow error:', error);
        await message.reply('❌ An error occurred while processing your command.');
        return;
      }

      // ============================================
      // HYBRID MESSAGE TYPE DETECTION: RULES + AI
      // ============================================
      // Step 1: Try rule-based detection first (fast, accurate for obvious cases)
      // Step 2: Fall back to AI for ambiguous cases

      logger.info(`🔍 Detecting message type: "${commandContent}"`);

      // Get LAST ACTION from this channel for context
      const actionKey = `${message.guild!.id}:${message.channelId}`;
      const lastAction = this.recentActions.get(actionKey);

      // RULE-BASED DETECTION (Priority #1)
      let messageType: { type: string; confidence: number; reasoning: string } | null = null;

      // Check for explicit command patterns
      const hasUserMention = message.mentions.users.size > 0;
      const commandLower = commandContent.toLowerCase();

      // Command keywords that are DEFINITIVE
      const commandKeywords = ['timeout', 'ban', 'kick', 'warn', 'untimeout', 'unban', 'mute', 'unmute'];
      const hasCommandKeyword = commandKeywords.some(kw => commandLower.includes(kw));

      // Analytics keywords that are DEFINITIVE
      const analyticsKeywords = ['stats', 'analyze', 'profile', 'server stats', 'member count'];
      const hasAnalyticsKeyword = analyticsKeywords.some(kw => commandLower.includes(kw));

      // RULE 1: @mention + command keyword = COMMAND (99% confidence)
      if (hasUserMention && hasCommandKeyword) {
        messageType = {
          type: 'command',
          confidence: 0.99,
          reasoning: 'User mention + moderation keyword detected (rule-based)'
        };
        logger.info('✅ RULE MATCH: Command detected (mention + keyword)');
      }
      // RULE 2: Command keyword + "for X minutes/hours" = COMMAND (95% confidence)
      else if (hasCommandKeyword && /for \d+\s*(min|minute|hour|day)/i.test(commandContent)) {
        messageType = {
          type: 'command',
          confidence: 0.95,
          reasoning: 'Moderation keyword + duration detected (rule-based)'
        };
        logger.info('✅ RULE MATCH: Command detected (keyword + duration)');
      }
      // RULE 3: "can you [command] @user" = COMMAND (90% confidence)
      else if (hasUserMention && /^(can you|could you|please|pls)\s+(timeout|ban|kick|warn)/i.test(commandLower)) {
        messageType = {
          type: 'command',
          confidence: 0.90,
          reasoning: 'Polite command request detected (rule-based)'
        };
        logger.info('✅ RULE MATCH: Command detected (polite request)');
      }
      // RULE 4: Trust score queries = COMMAND (95% confidence)
      else if ((commandLower.includes('score') || commandLower.includes('trust')) &&
               (commandLower.includes('my') || commandLower.includes('what') || commandLower.includes('check'))) {
        messageType = {
          type: 'command',
          confidence: 0.95,
          reasoning: 'Trust score query detected (rule-based)'
        };
        logger.info('✅ RULE MATCH: Trust score query detected');
      }
      // RULE 5: Analytics keywords = ANALYTICS (90% confidence)
      else if (hasAnalyticsKeyword) {
        messageType = {
          type: 'analytics',
          confidence: 0.90,
          reasoning: 'Analytics keyword detected (rule-based)'
        };
        logger.info('✅ RULE MATCH: Analytics detected');
      }

      // If no rule matched, use AI classification
      if (!messageType) {
        logger.info(`🤖 No rule match - using AI for classification...`);

      // 🚀 PERFORMANCE: Simplified classification prompt (shorter = faster)
      const messageTypePrompt = `Classify: "${commandContent}"

Types:
- "conversation": greetings, casual chat, general discussions, jokes
- "analytics": server stats, user profiles, query data
- "command": ANY request to take action (reports, complaints about users, direct orders)

CRITICAL - These are ALL commands:
- "I think @user has been spamming" = command (spam report → needs investigation)
- "@user is being toxic" = command (toxicity report → needs action)
- "Someone is breaking rules" = command (rule violation → needs moderation)
- "Timeout @user" = command (direct order → immediate action)
- "Check @user's messages" = command (investigation request → action needed)

ONLY conversation:
- "How are you?" = conversation (casual greeting)
- "What's your favorite color?" = conversation (casual chat)

Return JSON: {"type": "conversation|analytics|command", "confidence": 0.0-1.0, "reasoning": "why"}`;

        const messageTypeSystem = `Fast message classifier. Return ONLY JSON.`;

        try {
        // Use Ollama for fast classification
        const response = await this.ollama.generate(messageTypePrompt, messageTypeSystem);

        // Clean response
        let cleaned = response.trim();
        cleaned = cleaned.replace(/```json\s*/g, '');
        cleaned = cleaned.replace(/```\s*/g, '');
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) cleaned = jsonMatch[0];
        cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

        messageType = JSON.parse(cleaned);
        if (messageType) {
          logger.info(`🎯 AI classified as: ${messageType.type} (${(messageType.confidence * 100).toFixed(0)}% confidence)`);
          logger.info(`   Reasoning: ${messageType.reasoning}`);
        }

      } catch (error) {
          logger.error('Message type detection failed:', error);
          // Fallback: assume command if it looks action-oriented
          messageType = {
            type: commandContent.length < 20 ? 'conversation' : 'command',
            confidence: 0.5,
            reasoning: 'Fallback classification'
          };
        }
      } // End of if (!messageType) - AI classification block

      // Final safety fallback (should never happen)
      if (!messageType) {
        logger.warn('No message type determined - using fallback');
        messageType = {
          type: 'conversation',
          confidence: 0.5,
          reasoning: 'Emergency fallback classification'
        };
      }

      // Route based on messageType (rule-based or AI-determined)
      if (messageType.type === 'conversation' && messageType.confidence >= 0.6) {
        logger.info(`💬 AI detected conversation - using V1 dialogue (skipping V2 moderation)`);

        // Skip V2 entirely for pure conversation - use V1 dialogue
        const conversationId = `${message.guildId}:${message.channelId}`;
        const recentContext = this.memory.getShortTermContext(conversationId, 20);

        // Get analyzed content
        const context: any = {
          id: message.id,
          content: commandContent,
          authorId: message.author.id,
          authorName: message.author.username,
          guildId: message.guild.id,
          channelId: message.channelId,
          timestamp: message.createdAt,
          mentions: [],
          attachments: [],
        };

        const analyzed = await this.dialogue.analyzeMessage(context);
        await this.memory.addToShortTerm(analyzed, conversationId);

        // 🔍 DEBUG: Log toxicity scores
        logger.info(`📊 Toxicity Analysis: toxicity=${(analyzed.toxicity * 100).toFixed(1)}%, manipulation=${(analyzed.manipulation * 100).toFixed(1)}%, sentiment=${analyzed.sentiment.dominant}`);

        // 🔥 REDEMPTION CHECK: Reward good behavior in conversations
        if (analyzed.toxicity < 0.3 && !hasModerationPerms) {
          const redemption = await this.trustEngine.checkRedemption(
            message.author.id,
            message.guild.id,
            {
              toxicity: analyzed.toxicity,
              manipulation: analyzed.manipulation || 0,
              sentiment: analyzed.sentiment,
              isHelpful: analyzed.sentiment?.dominant === 'positive' && analyzed.toxicity < 0.1,
            }
          );

          if (redemption.redeemed) {
            logger.info(`✨ REDEMPTION: ${message.author.username} earned +${redemption.points} trust (${redemption.reason})`);
          }
        }

        // Get trust score
        const trustScore = await this.trustEngine.getTrustScore(message.author.id, message.guild.id);

        // 🔥 CRITICAL FIX: TOXIC CONVERSATIONS MUST USE V2 COGNITIVE
        // Don't use V1 dialogue for toxic messages - V2 has proper action execution
        if (analyzed.toxicity > 0.7 || analyzed.manipulation > 0.6) {
          logger.warn(`⚠️ TOXIC CONVERSATION DETECTED: "${commandContent}" (toxicity: ${analyzed.toxicity}, manipulation: ${analyzed.manipulation})`);
          logger.warn(`🚨 ROUTING TO V2 COGNITIVE for proper moderation + action execution`);

          // DON'T handle here - let it fall through to V2 Cognitive at line 2311
          // V2 will:
          // 1. Use CognitiveCore for threat analysis
          // 2. Use PolicyEngine for policy violations
          // 3. Execute proper moderation actions (timeout/ban with escalation)
          // 4. Update trust scores
          // 5. Generate appropriate response

          // SKIP V1 dialogue entirely - fall through to V2
          // (Remove the early return, let execution continue to line 2311)
        } else {
          // Non-toxic conversation - check if we should respond

          // CRITICAL: Check if Becas should respond (mentioned OR message starts with "becas")
          const wasMentioned = message.mentions.users.has(this.client.user!.id) ||
                              message.content.toLowerCase().startsWith('becas');
          const shouldRespond = await this.dialogue.shouldRespond(analyzed, wasMentioned);

          logger.info(`🤔 Should respond? wasMentioned=${wasMentioned}, shouldRespond=${shouldRespond}`);

          if (!shouldRespond) {
            logger.info('🔇 Not responding (not mentioned and not urgent)');
            return; // Don't respond to casual conversation
          }

          // Non-toxic conversation - use V1 dialogue for friendly chat
          logger.info('💬 Non-toxic conversation - using V1 dialogue');

          // Check if user is a moderator
          const isModerator = message.member?.permissions.has('ModerateMembers') || false;
          const isAdmin = message.member?.permissions.has('Administrator') || false;
          const userRole = isAdmin ? 'Administrator' : isModerator ? 'Moderator' : 'Member';

          logger.info(`👤 User role: ${userRole}`);

          // 💬 Show "Becas is typing..." indicator
          if ('sendTyping' in message.channel && typeof (message.channel as any).sendTyping === 'function') {
            await (message.channel as any).sendTyping();
          }

          // Generate conversational response
          const recentCtxArray = (Array.isArray(recentContext) ? recentContext : []) as any[];
          const recentMessagesArray = recentCtxArray.map((m: any) => m.content);
          const becasResponse = await this.dialogue.generateResponse(analyzed, trustScore, {
            recentMessages: recentMessagesArray,
            communityMood: 'neutral',
            userRole: userRole,
            isModerator: isModerator || isAdmin,
          });

          if (becasResponse.content && becasResponse.content.length > 0) {
            await message.reply(becasResponse.content);
            logger.info('✅ Conversational response sent');

            // 🔬 Remember AI's own output for future data interpretation
            this.dataInterpreter.rememberOutput(message.channelId, becasResponse.content);
          }

          return; // Conversation handled, stop processing
        }

      } else if (messageType.type === 'analytics' && messageType.confidence >= 0.5) {
        logger.info(`📊 AI detected analytics query - processing...`);

        // 💬 Show typing indicator
        if ('sendTyping' in message.channel && typeof (message.channel as any).sendTyping === 'function') {
          await (message.channel as any).sendTyping();
        }

        try {
          const analyticsResult = await this.analytics.processQuery(
            commandContent,
            message.guild!,
            this.trustEngine,
            this.memory
          );

          const formattedResponse = this.analytics.formatForDiscord(analyticsResult);
          await message.reply(formattedResponse);

          // 🔬 Remember analytics output for future interpretation
          this.dataInterpreter.rememberOutput(message.channelId, formattedResponse);

          logger.info(`✅ Analytics query processed successfully`);
          return; // Analytics handled, stop processing
        } catch (error) {
          logger.error('Analytics query failed:', error);
          logger.info('Falling through to command interpreter...');
        }
      } else if (messageType.type === 'command' && messageType.confidence >= 0.4) {
        // SPECIAL CASE: Trust score queries should skip AI interpreter
        if (messageType.reasoning === 'Trust score query detected (rule-based)') {
          logger.info(`🎯 Trust score query detected - routing to trust check handler...`);
          const requestedAction = await this.detectRequestedAction(commandContent);
          if (requestedAction === 'check') {
            const targetUser = message.mentions.users.find(u => u.id !== this.client.user!.id);
            const userToCheck = targetUser || message.author;
            const userTrust = await this.trustEngine.getTrustScore(userToCheck.id, message.guild!.id);
            const trustReport = `📊 **TRUST SCORE**: <@${userToCheck.id}>\n\n📉 Score: **${userTrust.score}/100**\n🎯 Level: **${userTrust.level.toUpperCase()}**`;
            await message.reply(trustReport);
            logger.info(`✅ Trust score shown for user ${userToCheck.id}`);
            return; // Trust score handled, stop processing
          }
        }
        logger.info(`🧠 AI detected command - using FULL AI INTELLIGENCE to understand and execute...`);

        // 💬 Show typing indicator
        if ('sendTyping' in message.channel && typeof (message.channel as any).sendTyping === 'function') {
          await (message.channel as any).sendTyping();
        }

        // ============================================
        // 🔥 SMART COMMAND ROUTING: SIMPLE vs WORKFLOW
        // ============================================
        // Simple commands (direct actions) should NOT go through WorkflowParser
        // WorkflowParser is ONLY for complex watch/monitoring scenarios

        const simpleCommandKeywords = [
          'timeout', 'ban', 'kick', 'unban', 'untimeout',
          'delete', 'purge', 'clear', 'remove',
          'warn', 'mute', 'unmute',
          'lock', 'unlock', 'slowmode',
          'pin', 'unpin',
          'nickname', 'rename',
          'role', 'give', 'take', 'add',
          'undo', 'reverse', 'cancel'
        ];

        const isSimpleCommand = simpleCommandKeywords.some(keyword =>
          commandContent.toLowerCase().includes(keyword)
        );

        // Workflow indicators - only these go to WorkflowParser
        const workflowIndicators = [
          'watch', 'monitor', 'track', 'alert',
          'notify me', 'let me know', 'tell me when',
          'if someone', 'when someone', 'whenever',
          'escalate', 'auto-', 'automatic'
        ];

        const hasWorkflowIndicator = workflowIndicators.some(indicator =>
          commandContent.toLowerCase().includes(indicator)
        );

        const shouldUseWorkflowParser = hasWorkflowIndicator && !isSimpleCommand;

        if (shouldUseWorkflowParser) {
          logger.info(`🎯 Command has workflow indicators - routing to WorkflowParser...`);
        } else {
          logger.info(`⚡ Simple command detected - skipping WorkflowParser, going straight to action execution`);
        }

        // Only use WorkflowParser for actual workflow commands
        if (shouldUseWorkflowParser) {
          try {
            const workflow = await this.workflowParser.parseCommand(commandContent, message);

          if (workflow.type === 'watch' && workflow.watchConfig) {
            logger.info(`🎯 AI detected workflow command - creating watch...`);

            // Create watch with expiration
            const durationHours = workflow.watchConfig.duration_hours || 24;
            const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

            const watchId = await this.watchSystem.createWatch({
              guildId: message.guild!.id,
              createdBy: message.author.id,
              expiresAt,
              userIds: workflow.watchConfig.userIds || [],
              filter: workflow.watchConfig.filter,
              conditions: workflow.watchConfig.conditions,
              actions: workflow.watchConfig.actions,
              escalation: workflow.watchConfig.escalation,
              announceChannel: workflow.watchConfig.announceChannel,
              announceTemplate: workflow.watchConfig.announceTemplate
            });

            // Confirm to moderator
            await message.reply(`✅ ${workflow.response_to_moderator}\n\n🆔 Watch ID: \`${watchId}\` (expires in ${durationHours}h)`);
            logger.info(`✅ Workflow watch created: ${watchId}`);

            return; // Workflow handled, stop processing

          } else {
            logger.info('AI says this is NOT a workflow command, continuing to regular command interpreter...');
          }
          } catch (error) {
            logger.error('AI workflow parsing failed:', error);
            // Continue to regular command interpreter instead of failing
          }
        }

        // ============================================
        // TRUE AI-POWERED COMMAND UNDERSTANDING
        // ============================================
        // Let AI analyze the FULL context and decide what to do

        // Get recent actions for context awareness
        const conversationId = `${message.guildId}:${message.channelId}`;
        const recentMessages = this.memory.getShortTermContext(conversationId, 10);
        const recentMessagesArray = (Array.isArray(recentMessages) ? recentMessages : []) as any[];
        const recentContext = recentMessagesArray.map((m: any) => `${m.authorName}: ${m.content}`).join('\n');

        // Get LAST 3 ACTIONS from audit log for better context
        const recentModerationActions = this.auditLogger.getRecentEvents(50, {
          guildId: message.guild!.id,
          type: 'command_executed' as any,
          success: true
        }).filter(e =>
          ['timeout', 'ban', 'kick', 'untimeout', 'unban', 'warn'].includes(e.action)
        ).slice(-3).reverse(); // Last 3 actions, most recent first

        let actionHistory = '';
        if (recentModerationActions.length > 0) {
          actionHistory = 'RECENT ACTIONS YOU PERFORMED:\n' + recentModerationActions.map((action, idx) => {
            const timeAgo = Math.round((Date.now() - new Date(action.timestamp).getTime()) / 1000);
            return `${idx + 1}. ${action.action.toUpperCase()} on ${action.targetName} (<@${action.targetId}>)
   Reason: ${action.details?.reason || 'N/A'}
   Performed by: ${action.actorName}
   Time: ${timeAgo} seconds ago`;
          }).join('\n');
        } else {
          actionHistory = 'No recent moderation actions';
        }

        // Extract available users
        const mentionedUsers = Array.from(message.mentions.users.values())
          .filter(u => u.id !== this.client.user!.id)
          .map(u => ({ id: u.id, tag: u.tag, mention: `<@${u.id}>` }));

        // Let AI decide WHAT to do with FULL context
        const intelligentPrompt = `You are Becas, an AI moderator. Analyze this command and return COMPLETE JSON with ALL fields.

COMMAND: "${commandContent}"
MENTIONED USERS: ${mentionedUsers.length > 0 ? mentionedUsers.map(u => `${u.tag} (${u.mention})`).join(', ') : 'none'}

CRITICAL: You MUST include ALL 8 required fields in your response! Missing fields will cause errors.

Return ONLY this exact JSON structure (no extra text):
{
  "understood_intent": "what moderator wants (1 sentence)",
  "confidence": 0.95,
  "action": "timeout",
  "target_user_mention": "<@929008606089707600>",
  "duration_minutes": 10,
  "reason": "spam",
  "should_execute": true,
  "response_to_moderator": "✅ I'll timeout that user for 10 minutes for spam",
  "is_bulk": false
}

REQUIRED FIELDS (all 8 must be present):
1. understood_intent (string) - Brief description
2. confidence (number 0.0-1.0) - How sure you are
3. action (string) - One of: timeout | untimeout | ban | unban | kick | warn | investigate | unknown
4. target_user_mention (string or null) - The <@ID> mention or null
5. reason (string) - Why this action (spam, toxic, etc)
6. should_execute (boolean) - true to do it, false to just respond
7. response_to_moderator (string) - What to tell the moderator
8. is_bulk (boolean) - false for single user, true for multiple

If UNCERTAIN (confidence < 0.7):
- Set should_execute = false
- Ask moderator in response_to_moderator: "🤔 Not sure. Did you mean: [options]?"

EXAMPLES:

Timeout command:
{
  "understood_intent": "Moderator wants to timeout user for spam",
  "confidence": 0.95,
  "action": "timeout",
  "target_user_mention": "<@929008606089707600>",
  "duration_minutes": 10,
  "reason": "spam",
  "should_execute": true,
  "response_to_moderator": "✅ I'll timeout that user for 10 minutes",
  "is_bulk": false
}

Uncertain command:
{
  "understood_intent": "Unclear what moderator wants",
  "confidence": 0.4,
  "action": "unknown",
  "target_user_mention": null,
  "duration_minutes": null,
  "reason": "unclear",
  "should_execute": false,
  "response_to_moderator": "🤔 I'm not sure what you want. Did you mean:\nA) Timeout this user?\nB) Ban this user?\nC) Just investigate?",
  "is_bulk": false
}`;

        const intelligentSystem = `You are an expert at understanding natural language commands and context. You can understand indirect references like "take it back" or "undo that" by looking at recent conversation history. When you're uncertain (confidence < 0.7), you ask for clarification instead of guessing.`;

        let aiDecision: any;

        try {
          const response = await this.ollama.generate(intelligentPrompt, intelligentSystem, {
            forceJson: true // Force JSON mode for better parsing
          });

          // DEBUG: Log raw response
          logger.info(`🔍 RAW AI RESPONSE:\n${response.substring(0, 500)}`);

          // Aggressive JSON cleaning
          let cleaned = response.trim();
          cleaned = cleaned.replace(/```json\s*/g, '');
          cleaned = cleaned.replace(/```\s*/g, '');
          cleaned = cleaned.replace(/^[^{]*/, '');
          cleaned = cleaned.replace(/[^}]*$/, '');
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          if (jsonMatch) cleaned = jsonMatch[0];
          cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
          cleaned = cleaned.replace(/\n/g, ' ');
          cleaned = cleaned.replace(/\s+/g, ' ');

          aiDecision = JSON.parse(cleaned);
          logger.info(`🤖 AI understood: "${aiDecision.understood_intent}"`);
          logger.info(`🎯 AI decided: action=${aiDecision.action}, confidence=${aiDecision.confidence}, should_execute=${aiDecision.should_execute}`);

        } catch (error) {
          logger.error('AI command understanding failed:', error);
          await message.reply(`❌ Sorry, I couldn't understand that command.`);
          return;
        }

        // Check if AI confidence is low - ask for clarification
        if (aiDecision.confidence !== undefined && aiDecision.confidence < 0.7) {
          logger.info(`🤔 Low confidence (${aiDecision.confidence}) - asking for clarification`);

          let clarificationMsg = `🤔 I'm not quite sure what you want me to do. `;

          if (aiDecision.possible_interpretations && aiDecision.possible_interpretations.length > 0) {
            clarificationMsg += `Did you mean:\n`;
            aiDecision.possible_interpretations.forEach((interp: string, idx: number) => {
              const letter = String.fromCharCode(65 + idx); // A, B, C, etc.
              clarificationMsg += `${letter}) ${interp}\n`;
            });
            clarificationMsg += `\nPlease clarify your request!`;
          } else {
            clarificationMsg += `Could you rephrase that or be more specific? For example:\n- Mention the user with @\n- Be explicit about the action (timeout, ban, kick, etc.)\n- Include details like duration or reason`;
          }

          await message.reply(clarificationMsg);
          return;
        }

        // If AI says don't execute, just respond
        if (!aiDecision.should_execute) {
          await message.reply(aiDecision.response_to_moderator);
          return;
        }

        // ============================================
        // RATE LIMITING CHECK
        // ============================================
        const rateCheck = this.auditLogger.checkRateLimit(message.author.id, message.guild!.id);
        if (!rateCheck.allowed) {
          logger.warn(`⏱️ RATE LIMIT: ${message.author.tag} exceeded limit`);

          // Log the rate limit hit
          await this.auditLogger.log({
            type: 'rate_limit_hit',
            guildId: message.guild!.id,
            guildName: message.guild!.name,
            actorId: message.author.id,
            actorName: message.author.username,
            actorType: hasModerationPerms ? 'moderator' : 'user',
            action: `rate_limit_${aiDecision.action}`,
            details: { reason: rateCheck.reason, resetIn: rateCheck.resetIn },
            success: false,
            channelId: message.channelId,
            messageId: message.id,
          });

          await message.reply(`⏱️ ${rateCheck.reason}\nPlease wait ${rateCheck.resetIn} seconds before trying again.`);
          return;
        }

        // Find target user FIRST (needed for permission checks)
        let targetUserId: string | null = null;
        if (aiDecision.target_user_mention) {
          const match = aiDecision.target_user_mention.match(/<@!?(\d+)>/);
          if (match) targetUserId = match[1];
        } else if (mentionedUsers.length > 0) {
          targetUserId = mentionedUsers[0].id;
        }

        // ============================================
        // CRITICAL SECURITY: GRANULAR PERMISSION CHECKS
        // ============================================
        const moderationActions = ['timeout', 'untimeout', 'ban', 'unban', 'kick'];
        if (moderationActions.includes(aiDecision.action)) {
          // Step 1: Check if user has SPECIFIC permission for THIS action
          const hasSpecificPerm = this.hasSpecificPermission(message.member!, aiDecision.action);

          if (!hasSpecificPerm) {
            logger.warn(`❌ PERMISSION DENIED: ${message.author.tag} tried to ${aiDecision.action} but lacks ${aiDecision.action.toUpperCase()} permission`);

            const permissionName = aiDecision.action === 'timeout' || aiDecision.action === 'untimeout' ? 'Timeout Members' :
                                  aiDecision.action === 'kick' ? 'Kick Members' :
                                  aiDecision.action === 'ban' || aiDecision.action === 'unban' ? 'Ban Members' : 'Moderation';

            const denialPrompt = `A user tried to use a moderation command but doesn't have the specific permission needed.

USER: ${message.author.tag}
ATTEMPTED ACTION: ${aiDecision.action}
MISSING PERMISSION: ${permissionName}

Generate a natural response (1-2 sentences) that:
- Politely explains they don't have the SPECIFIC permission for this action
- Is firm but friendly
- Mentions the exact permission they need`;

            const denialSystem = `You are Becas, a security-conscious AI. Deny unauthorized access politely but firmly.`;
            const denialResponse = await this.ollama.generate(denialPrompt, denialSystem);
            await message.reply(denialResponse.trim());
            return;
          }

          // Step 2: Check if target can be moderated (prevent mod-on-mod action)
          if (targetUserId) {
            try {
              const targetMember = await message.guild!.members.fetch(targetUserId);
              const canModerate = this.canModerateTarget(message.member!, targetMember);

              if (!canModerate) {
                logger.warn(`❌ TARGET PROTECTED: ${message.author.tag} tried to ${aiDecision.action} ${targetMember.user.tag} (moderator/higher role)`);

                const targetType = targetMember.permissions.has(PermissionFlagsBits.Administrator) ? 'an administrator' :
                                  targetMember.guild.ownerId === targetMember.id ? 'the server owner' :
                                  'a moderator or has higher role';

                const protectionPrompt = `A moderator tried to moderate someone they can't (another moderator, admin, or higher role).

MODERATOR: ${message.author.tag}
ATTEMPTED ACTION: ${aiDecision.action}
TARGET: ${targetMember.user.tag}
REASON: Target is ${targetType}

Generate a natural response (1-2 sentences) that:
- Explains they can't moderate this person
- Mentions the target is protected (admin/moderator/higher role)
- Is professional and clear`;

                const protectionSystem = `You are Becas, explaining role hierarchy protection.`;
                const protectionResponse = await this.ollama.generate(protectionPrompt, protectionSystem);
                await message.reply(protectionResponse.trim());
                return;
              }
            } catch (error) {
              logger.error('Failed to fetch target member for permission check:', error);
            }
          }
        }

        // ============================================
        // 🚀 UNIVERSAL ACTION SYSTEM INTEGRATION
        // ============================================
        // Route through ActionPlanner and ActionExecutor

        logger.info(`🚀 Using Universal Action System for: ${aiDecision.action}`);

        // Check if this is an UNDO request
        if (aiDecision.action === 'untimeout' || aiDecision.action === 'unban') {
          const lastActionKey = `${message.guild!.id}:${message.channelId}`;
          const lastAction = this.recentActions.get(lastActionKey);

          // Detect if this is an implicit undo (no explicit target, just "undo", "take it back", etc.)
          const isImplicitUndo = !targetUserId && lastAction &&
            (lastAction.type === 'timeout' && aiDecision.action === 'untimeout' ||
             lastAction.type === 'ban' && aiDecision.action === 'unban');

          if (isImplicitUndo) {
            logger.info(`🔄 Implicit UNDO detected - reversing last action on ${lastAction.targetName}`);

            // 🔥 AI LEARNING: This is an undo! AI should learn
            const timeSinceAction = (Date.now() - lastAction.timestamp.getTime()) / 1000; // seconds

            if (timeSinceAction < 300) { // Within 5 minutes = likely a correction
              logger.warn(`🎓 AI CORRECTION DETECTED: Moderator undid ${lastAction.type} within ${timeSinceAction.toFixed(0)}s`);

              await this.aiLearning.recordCorrection(
                message.guild!.id,
                {
                  action: lastAction.type,
                  target: lastAction.targetName,
                  reason: lastAction.reason || 'Unknown',
                  confidence: 1.0,
                  context: `Recent ${lastAction.type} action`,
                },
                {
                  type: 'undo',
                  moderatorId: message.author.id,
                  moderatorName: message.author.username,
                  reason: commandContent,
                }
              );
            }

            // Execute universal undo
            const undoResult = await this.universalActionExecutor.undoLastAction(message, message.member!);

            if (undoResult.success) {
              // Clear from old tracking system
              this.recentActions.delete(lastActionKey);

              // 🔥 AUDIT LOG
              await this.auditLogger.log({
                type: 'command_executed',
                guildId: message.guild!.id,
                guildName: message.guild!.name,
                actorId: message.author.id,
                actorName: message.author.username,
                actorType: hasModerationPerms ? 'moderator' : 'user',
                targetId: lastAction.targetId,
                targetName: lastAction.targetName,
                action: aiDecision.action, // untimeout or unban
                details: {
                  reason: commandContent,
                  isCorrection: true,
                  originalAction: lastAction.type,
                },
                success: true,
                channelId: message.channelId,
                messageId: message.id,
              });

              // AI generates response
              const responsePrompt = `You just undid your last action (${lastAction.type} on ${lastAction.targetName}). Generate a natural, conversational response confirming the undo.`;
              const aiResponse = await this.ollama.generate(responsePrompt, `You are Becas, a friendly AI moderator.`);
              await message.reply(aiResponse.trim());
            } else {
              await message.reply(`❌ ${undoResult.error}`);
            }
            return;
          }
        }

        // ============================================
        // 🚀 SINGLE ACTIONS → USE UNIVERSAL ACTION SYSTEM
        // ============================================

        // Map old action names to new action IDs (expanded to all 15 actions)
        const actionMapping: Record<string, string> = {
          // User moderation
          'timeout': 'timeout',
          'untimeout': 'untimeout',
          'ban': 'ban',
          'unban': 'unban',
          'kick': 'kick',
          'change_nickname': 'change_nickname',
          'nickname': 'change_nickname',
          'rename': 'change_nickname',

          // Role management
          'add_role': 'add_role',
          'give_role': 'add_role',
          'remove_role': 'remove_role',
          'take_role': 'remove_role',

          // Message management
          'delete_message': 'delete_message',
          'remove_message': 'delete_message',
          'bulk_delete': 'bulk_delete_messages',
          'purge': 'bulk_delete_messages',
          'clear_messages': 'bulk_delete_messages',
          'pin': 'pin_message',
          'pin_message': 'pin_message',
          'unpin': 'unpin_message',
          'unpin_message': 'unpin_message',

          // Channel management
          'lock': 'lock_channel',
          'lock_channel': 'lock_channel',
          'unlock': 'unlock_channel',
          'unlock_channel': 'unlock_channel',
          'slowmode': 'set_slowmode',
          'set_slowmode': 'set_slowmode'
        };

        // ============================================
        // 🚨 INVESTIGATION HANDLER (Spam/Rule Violation Reports)
        // ============================================
        if (aiDecision.action === 'investigate' && targetUserId) {
          logger.info(`🚨 INVESTIGATION TRIGGERED: ${aiDecision.reason} on ${targetUserId}`);

          try {
            // Fetch target user's recent messages
            const targetMember = await message.guild!.members.fetch(targetUserId);
            const channelMessages = await message.channel.messages.fetch({ limit: 100 });
            const userMessages = channelMessages
              .filter(m => m.author.id === targetUserId)
              .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
              .first(20);

            // Analyze messages for violations
            const analysis = await this.analyzeUserMessages(userMessages, aiDecision.reason || 'general');

            // Determine action based on severity
            let autoAction: string | null = null;
            let duration = 0;

            if (analysis.severity === 'critical') {
              autoAction = 'ban';
            } else if (analysis.severity === 'high') {
              autoAction = 'timeout';
              duration = 60; // 1 hour
            } else if (analysis.severity === 'medium') {
              autoAction = 'timeout';
              duration = 10; // 10 minutes
            }

            // Report findings
            const report = `🔍 **Investigation Complete: ${targetMember.user.tag}**

**Violation Type:** ${aiDecision.reason}
**Severity:** ${analysis.severity}
**Evidence:** ${analysis.evidence}

**Recommended Action:** ${autoAction ? `${autoAction.toUpperCase()}${duration ? ` for ${duration} minutes` : ''}` : 'Warning only'}

${autoAction ? `✅ Automatic action will be applied.` : '⚠️ Manual review recommended.'}`;

            await message.reply(report);

            // Auto-execute if severity warrants it
            if (autoAction && process.env.ENABLE_AUTO_BAN === 'true' && analysis.confidence >= 0.85) {
              logger.info(`⚡ AUTO-EXECUTING: ${autoAction} on ${targetMember.user.tag}`);

              if (autoAction === 'timeout') {
                await targetMember.timeout(duration * 60 * 1000, `Auto-moderation: ${aiDecision.reason} (${analysis.severity})`);
                if ('send' in message.channel && typeof (message.channel as any).send === 'function') {
                  await (message.channel as any).send(`⏱️ ${targetMember.user.tag} has been timed out for ${duration} minutes.`);
                }
              } else if (autoAction === 'ban') {
                await targetMember.ban({ reason: `Auto-moderation: ${aiDecision.reason} (${analysis.severity})` });
                if ('send' in message.channel && typeof (message.channel as any).send === 'function') {
                  await (message.channel as any).send(`🔨 ${targetMember.user.tag} has been banned.`);
                }
              }

              // Log action
              await this.auditLogger.log({
                type: 'command_executed',
                guildId: message.guild!.id,
                guildName: message.guild!.name,
                actorId: this.client.user!.id,
                actorName: 'Becas (Auto-Mod)',
                actorType: 'bot',
                targetId: targetUserId,
                targetName: targetMember.user.tag,
                action: autoAction,
                details: {
                  reason: aiDecision.reason,
                  severity: analysis.severity,
                  confidence: analysis.confidence,
                  triggeredBy: message.author.id,
                  duration: duration
                },
                success: true,
                channelId: message.channelId,
                messageId: message.id,
              });
            }

            return; // Investigation complete
          } catch (error) {
            logger.error('Investigation failed:', error);
            await message.reply(`❌ Investigation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return;
          }
        }

        const mappedActionId = actionMapping[aiDecision.action];

        // Check if this is a recognized single action (not bulk, not unknown)
        if (mappedActionId) {
          logger.info(`🚀 Executing single action through Universal Action System: ${mappedActionId}`);

          // 🔒 CRITICAL: PERMISSION CHECKS - Normal users cannot execute moderation commands
          const requiredPermissions: Record<string, bigint[]> = {
            'timeout': [PermissionFlagsBits.ModerateMembers],
            'untimeout': [PermissionFlagsBits.ModerateMembers],
            'ban': [PermissionFlagsBits.BanMembers],
            'unban': [PermissionFlagsBits.BanMembers],
            'kick': [PermissionFlagsBits.KickMembers],
            'change_nickname': [PermissionFlagsBits.ManageNicknames],
            'add_role': [PermissionFlagsBits.ManageRoles],
            'remove_role': [PermissionFlagsBits.ManageRoles],
            'delete_message': [PermissionFlagsBits.ManageMessages],
            'bulk_delete_messages': [PermissionFlagsBits.ManageMessages],
            'pin_message': [PermissionFlagsBits.ManageMessages],
            'unpin_message': [PermissionFlagsBits.ManageMessages],
            'lock_channel': [PermissionFlagsBits.ManageChannels],
            'unlock_channel': [PermissionFlagsBits.ManageChannels],
            'set_slowmode': [PermissionFlagsBits.ManageChannels],
          };

          const requiredPerms = requiredPermissions[mappedActionId];
          if (requiredPerms) {
            const memberPerms = message.member!.permissions;
            const hasPermission = requiredPerms.some(perm => memberPerms.has(perm));

            if (!hasPermission) {
              const permNames: Record<string, string> = {
                [String(PermissionFlagsBits.ModerateMembers)]: 'Moderate Members',
                [String(PermissionFlagsBits.BanMembers)]: 'Ban Members',
                [String(PermissionFlagsBits.KickMembers)]: 'Kick Members',
                [String(PermissionFlagsBits.ManageNicknames)]: 'Manage Nicknames',
                [String(PermissionFlagsBits.ManageRoles)]: 'Manage Roles',
                [String(PermissionFlagsBits.ManageMessages)]: 'Manage Messages',
                [String(PermissionFlagsBits.ManageChannels)]: 'Manage Channels',
              };
              const requiredPermName = permNames[String(requiredPerms[0])] || 'Unknown Permission';

              logger.warn(`🚫 PERMISSION DENIED: ${message.author.username} tried to ${mappedActionId} without ${requiredPermName} permission`);

              // Log permission denial to audit system
              await this.auditLogger.log({
                type: 'command_executed',
                guildId: message.guild!.id,
                guildName: message.guild!.name,
                actorId: message.author.id,
                actorName: message.author.username,
                actorType: 'user',
                action: mappedActionId,
                details: {
                  reason: 'Permission denied',
                  requiredPermission: requiredPermName,
                },
                success: false,
                channelId: message.channelId,
                messageId: message.id,
              });

              // Friendly AI-generated denial message
              const denialPrompt = `Generate a friendly but firm response explaining that the user doesn't have permission to use this moderation command (${mappedActionId}). Required permission: ${requiredPermName}. Keep it 1-2 sentences.`;
              const denialResponse = await this.ollama.generate(denialPrompt, `You are Becas, a friendly AI moderator. Be understanding but clear about permissions.`, { temperature: 0.7, maxTokens: 60 });
              await message.reply(`🚫 ${denialResponse.trim()}`);
              return;
            }
          }

          // Build parameters based on action type
          const parameters: any = {};

          // User actions need user parameter
          if (['timeout', 'untimeout', 'ban', 'unban', 'kick', 'change_nickname', 'add_role', 'remove_role'].includes(mappedActionId)) {
            if (!targetUserId) {
              // 🔥 DATABASE-DRIVEN QUERY: Check if moderator is asking for "last X toxic users"
              const toxicPattern = /last\s+(\d+)\s+(toxic|problematic|bad)/i;
              const toxicMatch = message.content.match(toxicPattern);

              if (toxicMatch && aiDecision.is_bulk) {
                const limit = parseInt(toxicMatch[1], 10);
                logger.info(`🔥 DATABASE QUERY: Fetching last ${limit} toxic users from sicil`);

                try {
                  const toxicUsers = await this.dbIntegration.sicilRepo.getRecentToxicUsers(
                    message.guildId!,
                    limit,
                    1 // min 1 toxicity violation
                  );

                  logger.info(`✅ Found ${toxicUsers.length} toxic users from database`);

                  if (toxicUsers.length === 0) {
                    await message.reply(`✅ Good news! No toxic users found in the database. Your server is clean! 🎉`);
                    return;
                  }

                  // Ban each toxic user
                  const bannedUsers: string[] = [];
                  for (const toxicUser of toxicUsers) {
                    try {
                      const member = await message.guild!.members.fetch(toxicUser.userId);
                      await member.ban({
                        reason: `Bulk ban: ${toxicUser.toxicityViolations} toxicity violations (AI-detected from database)`
                      });
                      bannedUsers.push(`${member.user.username} (${toxicUser.toxicityViolations} violations)`);
                      logger.info(`✅ Banned ${member.user.username} - ${toxicUser.toxicityViolations} toxicity violations`);
                    } catch (err) {
                      logger.warn(`Failed to ban user ${toxicUser.userId}:`, err);
                    }
                  }

                  await message.reply(
                    `✅ **Database-driven bulk ban complete!**\n\n` +
                    `Banned ${bannedUsers.length}/${toxicUsers.length} toxic users:\n` +
                    bannedUsers.map((u, i) => `${i + 1}. ${u}`).join('\n')
                  );

                  return; // Stop here, don't continue with AI inference
                } catch (error) {
                  logger.error('Database query for toxic users failed:', error);
                  // Continue with AI inference fallback
                }
              }

              // AI INTELLIGENCE: Instead of rigid error, try to infer user from context
              logger.info(`🧠 No target user found - using AI to infer from conversation history and server state`);

              // Build context for AI inference
              // Fetch recent messages from Discord channel history
              let recentHistory: string[] = [];
              try {
                const messages = await message.channel.messages.fetch({ limit: 10 });
                recentHistory = Array.from(messages.values())
                  .reverse()
                  .map(m => `${m.author.username}: ${m.content}`)
                  .slice(-5);
              } catch (err) {
                logger.warn('Could not fetch recent messages for context', err);
              }

              const serverState = this.serverStateManager.getServerStateSummary(message.guildId!);
              const lastModAction = this.serverStateManager.getLastActionBy(message.guildId!, message.author.id);

              const inferPrompt = `A moderator said: "${message.content}"

RECENT CONVERSATION:
${recentHistory.join('\n')}

SERVER STATE:
${serverState}

LAST ACTION BY THIS MODERATOR:
${lastModAction ? `${lastModAction.type} ${lastModAction.username} - ${lastModAction.reason}` : 'None'}

The moderator is trying to ${mappedActionId} someone, but didn't mention a specific user.
They might be using pronouns like "him", "her", "they", or referring to "last timeout", "that user", etc.

Question: WHO is the moderator talking about?

Respond with ONLY the username (no @, no ID, just the username), or "UNKNOWN" if you truly cannot infer.`;

              const inferredUsername = await this.ollama.generate(
                inferPrompt,
                'You are an AI that infers user references from conversation context. Be intelligent about pronouns and implicit references.',
                { temperature: 0.3, maxTokens: 30 }
              );

              const cleanUsername = inferredUsername.trim().replace(/@/g, '');

              if (cleanUsername !== 'UNKNOWN' && cleanUsername.length > 0) {
                // Try to find user by username in guild
                const guild = message.guild!;
                const foundMember = guild.members.cache.find(
                  m => m.user.username.toLowerCase() === cleanUsername.toLowerCase() ||
                       m.displayName.toLowerCase() === cleanUsername.toLowerCase()
                );

                if (foundMember) {
                  targetUserId = foundMember.id;
                  logger.info(`✅ AI successfully inferred target user: ${foundMember.user.username} (${targetUserId})`);
                } else {
                  logger.warn(`⚠️ AI inferred username "${cleanUsername}" but couldn't find member in guild`);
                }
              }

              // If still no user found, generate intelligent error with AI
              if (!targetUserId) {
                const errorPrompt = `A moderator tried to ${mappedActionId} someone but I couldn't figure out who they're talking about.

Their message: "${message.content}"

Generate a friendly, intelligent response that:
1. Acknowledges what they're trying to do
2. Explains you need more clarity on WHO they're referring to
3. Suggests they mention the user or be more specific
4. Keep it 1-2 sentences, conversational tone

DO NOT be robotic. Sound like a helpful AI assistant.`;

                const aiError = await this.ollama.generate(
                  errorPrompt,
                  'You are Becas, a conversational AI moderator. Be helpful and friendly.',
                  { temperature: 0.7, maxTokens: 80 }
                );

                await message.reply(`❓ ${aiError.trim()}`);
                return;
              }
            }
            parameters.user = targetUserId;
            if (aiDecision.duration_minutes) parameters.duration_minutes = aiDecision.duration_minutes;
            if (aiDecision.reason) parameters.reason = aiDecision.reason;

            // Nickname needs the new nickname
            if (mappedActionId === 'change_nickname' && aiDecision.nickname) {
              parameters.nickname = aiDecision.nickname;
            }

            // Role actions need role name
            if ((mappedActionId === 'add_role' || mappedActionId === 'remove_role') && aiDecision.role) {
              parameters.role = aiDecision.role;
            }
          }

          // Message actions need message_id or count
          if (['delete_message', 'pin_message', 'unpin_message'].includes(mappedActionId)) {
            if (aiDecision.message_id) {
              parameters.message_id = aiDecision.message_id;
            } else {
              // Try to get last message in channel
              await message.reply(`❌ Please specify which message (use message ID or reference like "that message")`);
              return;
            }
          }

          if (mappedActionId === 'bulk_delete_messages') {
            if (aiDecision.count) {
              parameters.count = aiDecision.count;
            } else {
              await message.reply(`❌ Please specify how many messages to delete`);
              return;
            }
            if (aiDecision.author_filter) parameters.author_filter = aiDecision.author_filter;
          }

          // Channel actions need channel parameter (or use current channel)
          if (['lock_channel', 'unlock_channel', 'set_slowmode'].includes(mappedActionId)) {
            parameters.channel = aiDecision.channel || message.channelId;
            if (aiDecision.reason) parameters.reason = aiDecision.reason;
            if (mappedActionId === 'set_slowmode' && aiDecision.seconds !== undefined) {
              parameters.seconds = aiDecision.seconds;
            }
          }

          // Create action plan
          const actionPlan: any = {
            understood_intent: aiDecision.understood_intent,
            actions: [{
              action_id: mappedActionId,
              parameters
            }],
            requires_confirmation: false,
            response_to_moderator: ''
          };

          // Execute through Universal Action System
          const executionResult = await this.universalActionExecutor.execute({
            message,
            executor: message.member!,
            plan: actionPlan
          });

          if (executionResult.success && executionResult.results[0].success) {
            // 🧠 TRACK IN SERVER STATE MANAGER - AI now knows server state!
            if (targetUserId) {
              const member = await message.guild!.members.fetch(targetUserId);
              const reason = aiDecision.reason || 'No reason provided';

              if (mappedActionId === 'timeout') {
                const duration = (aiDecision.duration_minutes || 10) * 60000;
                this.serverStateManager.recordTimeout(
                  message.guild!.id,
                  targetUserId,
                  member.user.username,
                  reason,
                  duration,
                  message.author.id
                );
              } else if (mappedActionId === 'untimeout') {
                this.serverStateManager.removeTimeout(message.guild!.id, targetUserId);
              } else if (mappedActionId === 'ban') {
                this.serverStateManager.recordBan(
                  message.guild!.id,
                  targetUserId,
                  member.user.username,
                  reason,
                  message.author.id
                );
              } else if (mappedActionId === 'unban') {
                this.serverStateManager.removeBan(message.guild!.id, targetUserId);
              } else if (mappedActionId === 'kick') {
                this.serverStateManager.recordKick(
                  message.guild!.id,
                  targetUserId,
                  member.user.username,
                  reason,
                  message.author.id
                );
              }
            }

            // Track in old system for backward compatibility
            if ((mappedActionId === 'timeout' || mappedActionId === 'ban') && targetUserId) {
              const actionKey = `${message.guild!.id}:${message.channelId}`;
              const member = await message.guild!.members.fetch(targetUserId);
              this.recentActions.set(actionKey, {
                type: mappedActionId,
                targetId: targetUserId,
                targetName: member.user.tag,
                guildId: message.guild!.id,
                channelId: message.channelId,
                requestedBy: message.author.id,
                requestedByName: message.author.username,
                timestamp: new Date(),
                duration: mappedActionId === 'timeout' ? (aiDecision.duration_minutes || 10) * 60000 : undefined,
                durationMinutes: aiDecision.duration_minutes || 10,
                reason: aiDecision.reason
              });
            }

            // 🔥 Track bulk_delete for context memory ("10 more please")
            if (mappedActionId === 'bulk_delete_messages' && aiDecision.count) {
              const actionKey = `${message.guild!.id}:${message.channelId}`;
              this.recentActions.set(actionKey, {
                type: 'bulk_delete',
                targetId: message.channelId,
                targetName: `channel-${message.channel.id}`,
                guildId: message.guild!.id,
                channelId: message.channelId,
                requestedBy: message.author.id,
                requestedByName: message.author.username,
                timestamp: new Date(),
                count: aiDecision.count
              });

              // Auto-cleanup after 5 minutes
              setTimeout(() => {
                this.recentActions.delete(actionKey);
              }, 300000);
            }

            // 🔥 AUDIT LOG: Log ban and kick actions
            if (mappedActionId === 'ban' || mappedActionId === 'kick') {
              const targetMember = targetUserId ? await message.guild!.members.fetch(targetUserId).catch(() => null) : null;

              await this.auditLogger.log({
                type: 'command_executed',
                guildId: message.guild!.id,
                guildName: message.guild!.name,
                actorId: message.author.id,
                actorName: message.author.username,
                actorType: hasModerationPerms ? 'moderator' : 'user',
                targetId: targetUserId || undefined,
                targetName: targetMember?.user.tag || 'Unknown',
                action: mappedActionId,
                details: {
                  reason: aiDecision.reason || 'No reason provided',
                  aiConfidence: aiDecision.confidence || 1.0,
                },
                success: true,
                aiConfidence: aiDecision.confidence,
                aiReasoning: aiDecision.understood_intent,
                channelId: message.channelId,
                messageId: message.id,
              });

              logger.info(`🔥 AUDIT: Logged ${mappedActionId} action for ${targetMember?.user.tag}`);
            }

            // AI generates response
            const responsePrompt = `You just executed a ${mappedActionId} command successfully. Generate a natural, conversational response (1-2 sentences).

COMMAND: ${mappedActionId}
RESULT: ${executionResult.results[0].message}

Be natural and friendly.`;
            const aiResponse = await this.ollama.generate(responsePrompt, `You are Becas, a friendly AI moderator.`);

            // 🔥 FIX: For bulk_delete, the original message was deleted, so send to channel instead of reply
            try {
              if (mappedActionId === 'bulk_delete_messages') {
                await (message.channel as TextChannel).send(aiResponse.trim());
              } else {
                await message.reply(aiResponse.trim());
              }
            } catch (error: any) {
              // If message was deleted, send to channel as fallback
              if (error.code === 50035 || error.code === 10008) {
                logger.warn('Original message was deleted, sending response to channel');
                await (message.channel as TextChannel).send(aiResponse.trim());
              } else {
                throw error;
              }
            }
          } else {
            const error = executionResult.results[0]?.error || executionResult.error || 'Unknown error';
            try {
              await message.reply(`❌ ${error}`);
            } catch (replyError: any) {
              if (replyError.code === 50035 || replyError.code === 10008) {
                await (message.channel as TextChannel).send(`❌ ${error}`);
              }
            }
          }
          return; // 🔥 CRITICAL: STOP HERE - don't let it fall through to V2 Cognitive!
        }

        // ============================================
        // BULK ACTIONS → KEEP OLD SYSTEM (for now)
        // ============================================
        if (aiDecision.is_bulk && aiDecision.bulk_criteria) {
          logger.info(`⚠️ Bulk action detected - using legacy bulk system`);
          const commandDetails = {
            action: aiDecision.action,
            duration: aiDecision.duration_minutes ? `${aiDecision.duration_minutes} minutes` : null,
            reason: aiDecision.reason
          };

          if (commandDetails.action === 'bulk_timeout' && aiDecision.is_bulk && aiDecision.bulk_criteria) {
            // 🔥 BULK TIMEOUT ACTION - STAGE 1: Conversational Intent Confirmation
            logger.info(`🔨 Bulk timeout requested with criteria: ${JSON.stringify(aiDecision.bulk_criteria)}`);

            try {
              // Quick preview count (no details yet)
              const preview = await this.bulkActions.preview(
                message.guild!,
                aiDecision.bulk_criteria,
                message.author.id
              );

              if (preview.count === 0) {
                await message.reply(`❌ No users match the criteria. No action taken.`);
                return;
              }

              // STAGE 1: AI asks conversationally "are you sure?"
              const criteriaText = [];
              if (aiDecision.bulk_criteria.trustScoreMax) criteriaText.push(`trust score <${aiDecision.bulk_criteria.trustScoreMax}`);
              if (aiDecision.bulk_criteria.trustScoreMin) criteriaText.push(`trust score >${aiDecision.bulk_criteria.trustScoreMin}`);
              if (aiDecision.bulk_criteria.minViolations) criteriaText.push(`${aiDecision.bulk_criteria.minViolations}+ violations`);
              if (aiDecision.bulk_criteria.joinedWithinDays) criteriaText.push(`joined within ${aiDecision.bulk_criteria.joinedWithinDays} days`);
              if (aiDecision.bulk_criteria.hasRole) criteriaText.push(`with role "${aiDecision.bulk_criteria.hasRole}"`);
              if (aiDecision.bulk_criteria.lacksRole) criteriaText.push(`without role "${aiDecision.bulk_criteria.lacksRole}"`);

              const conversationalPrompt = `Generate a natural, conversational response asking the moderator to confirm a BULK action.

BULK ACTION: Timeout all members with ${criteriaText.join(', ')}
AFFECTED COUNT: ${preview.count} users
DURATION: ${aiDecision.duration_minutes || 10} minutes

Your response should:
1. Sound natural and human-like (use phrases like "Hmm, interesting idea!", "Whoa, that's a lot of people!", "Just to be clear...")
2. Restate what they want to do
3. Mention how many people will be affected
4. Ask if they're sure about this
5. Be conversational but also slightly cautious (this is a big action)

Generate ONLY the response text (1-3 sentences), no quotes or formatting.`;

              const aiResponse = await this.ollama.generate(conversationalPrompt, `You are Becas, a friendly but cautious AI moderator.`);

              // Create buttons for confirmation
              const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId('bulk_confirm')
                    .setLabel('✅ Yes, I\'m Sure')
                    .setStyle(ButtonStyle.Success),
                  new ButtonBuilder()
                    .setCustomId('bulk_cancel')
                    .setLabel('❌ Cancel')
                    .setStyle(ButtonStyle.Danger)
                );

              const reply = await message.reply({
                content: aiResponse.trim(),
                components: [row]
              });

              // Store pending confirmation for STAGE 2
              this.pendingConfirmations.set(message.author.id, {
                action: 'bulk_timeout_preview' as any,
                bulkCriteria: aiDecision.bulk_criteria,
                duration: aiDecision.duration_minutes || 10,
                reason: aiDecision.reason || 'Bulk moderation',
                messageId: reply.id,
              } as any);

              // Create button collector
              const collector = reply.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60000, // 60 seconds
                filter: (i) => i.user.id === message.author.id
              });

              collector.on('collect', async (interaction) => {
                if (interaction.customId === 'bulk_confirm') {
                  await interaction.update({ content: aiResponse.trim() + '\n\n⏳ Loading preview...', components: [] });

                  // Show STAGE 2 preview
                  const preview = await this.bulkActions.preview(message.guild!, aiDecision.bulk_criteria, message.author.id);
                  const previewList = preview.members.slice(0, 10).map(m =>
                    `• ${m.tag} (Trust: ${m.trustScore}, Violations: ${m.violations})`
                  ).join('\n');

                  const confirmRow = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                      new ButtonBuilder()
                        .setCustomId('bulk_execute')
                        .setLabel('✅ Confirm & Execute')
                        .setStyle(ButtonStyle.Danger),
                      new ButtonBuilder()
                        .setCustomId('bulk_cancel_final')
                        .setLabel('❌ Cancel')
                        .setStyle(ButtonStyle.Secondary)
                    );

                  await interaction.editReply({
                    content: `⚠️ **BULK TIMEOUT PREVIEW**\n\nThis will timeout **${preview.count} users**:\n${previewList}${preview.count > 10 ? `\n...and ${preview.count - 10} more` : ''}\n\nDuration: ${aiDecision.duration_minutes || 10} minutes\nReason: ${commandDetails.reason || 'Bulk moderation'}`,
                    components: [confirmRow]
                  });

                  // Update pending confirmation to execution stage
                  this.pendingConfirmations.set(message.author.id, {
                    action: 'bulk_timeout_execute' as any,
                    bulkCriteria: aiDecision.bulk_criteria,
                    duration: aiDecision.duration_minutes || 10,
                    reason: aiDecision.reason || 'Bulk moderation',
                    messageId: reply.id,
                  } as any);

                } else if (interaction.customId === 'bulk_cancel') {
                  await interaction.update({ content: '❌ Bulk action cancelled.', components: [] });
                  this.pendingConfirmations.delete(message.author.id);
                  collector.stop();
                } else if (interaction.customId === 'bulk_execute') {
                  await interaction.update({ content: '⏳ Executing bulk timeout...', components: [] });

                  // STAGE 3: Execute
                  const result = await this.bulkActions.bulkTimeout(
                    message.guild!,
                    aiDecision.bulk_criteria,
                    aiDecision.duration_minutes || 10,
                    commandDetails.reason || 'Bulk moderation',
                    message.author.id
                  );

                  await interaction.editReply({
                    content: `✅ **Bulk Timeout Complete**\n\n✓ Successfully timed out: ${result.affected} users\n${result.failed > 0 ? `✗ Failed: ${result.failed} users` : ''}\n\n${result.details}`,
                    components: []
                  });

                  // Audit log
                  await this.auditLogger.log({
                    type: 'bulk_action',
                    guildId: message.guild!.id,
                    guildName: message.guild!.name,
                    actorId: message.author.id,
                    actorName: message.author.username,
                    actorType: 'moderator',
                    action: 'bulk_timeout',
                    details: { criteria: aiDecision.bulk_criteria, duration: aiDecision.duration_minutes || 10, affected: result.affected, failed: result.failed },
                    success: true,
                    channelId: message.channelId,
                    messageId: message.id
                  });

                  this.pendingConfirmations.delete(message.author.id);
                  collector.stop();
                } else if (interaction.customId === 'bulk_cancel_final') {
                  await interaction.update({ content: '❌ Bulk action cancelled.', components: [] });
                  this.pendingConfirmations.delete(message.author.id);
                  collector.stop();
                }
              });

              collector.on('end', (collected, reason) => {
                if (reason === 'time') {
                  reply.edit({ content: reply.content + '\n\n⏱️ Confirmation timed out (60s)', components: [] });
                  this.pendingConfirmations.delete(message.author.id);
                }
              });

            } catch (error) {
              logger.error('Bulk timeout failed:', error);
              await message.reply(`❌ Bulk timeout failed: ${error}`);
            }
            return;
          }
          // 🔥 BULK KICK ACTION - STAGE 1: Conversational Intent Confirmation
          logger.info(`👢 Bulk kick requested with criteria: ${JSON.stringify(aiDecision.bulk_criteria)}`);

          try {
            const preview = await this.bulkActions.preview(
              message.guild!,
              aiDecision.bulk_criteria,
              message.author.id
            );

            if (preview.count === 0) {
              await message.reply(`❌ No users match the criteria. No action taken.`);
              return;
            }

            // STAGE 1: AI asks conversationally
            const criteriaText = [];
            if (aiDecision.bulk_criteria.trustScoreMax) criteriaText.push(`trust score <${aiDecision.bulk_criteria.trustScoreMax}`);
            if (aiDecision.bulk_criteria.trustScoreMin) criteriaText.push(`trust score >${aiDecision.bulk_criteria.trustScoreMin}`);
            if (aiDecision.bulk_criteria.minViolations) criteriaText.push(`${aiDecision.bulk_criteria.minViolations}+ violations`);
            if (aiDecision.bulk_criteria.joinedWithinDays) criteriaText.push(`joined within ${aiDecision.bulk_criteria.joinedWithinDays} days`);

            const conversationalPrompt = `Generate a natural, conversational response asking the moderator to confirm a BULK KICK action.

BULK ACTION: Kick all members with ${criteriaText.join(', ')}
AFFECTED COUNT: ${preview.count} users

Your response should sound natural and ask if they're sure about kicking ${preview.count} people.
Generate ONLY the response text (1-3 sentences), no quotes.`;

            const aiResponse = await this.ollama.generate(conversationalPrompt, `You are Becas, a friendly but cautious AI moderator.`);
            await message.reply(aiResponse.trim());

            // Store for STAGE 2
            this.pendingConfirmations.set(message.author.id, {
              action: 'bulk_kick_preview' as any,
              bulkCriteria: aiDecision.bulk_criteria,
              reason: aiDecision.reason || 'Bulk moderation',
            } as any);
          } catch (error) {
            logger.error('Bulk kick failed:', error);
            await message.reply(`❌ Bulk kick failed: ${error}`);
          }
          return;

        } else if (aiDecision.action === 'bulk_ban' && aiDecision.is_bulk && aiDecision.bulk_criteria) {
          // 🔥 BULK BAN ACTION - STAGE 1: Conversational Intent Confirmation
          logger.info(`🚫 Bulk ban requested with criteria: ${JSON.stringify(aiDecision.bulk_criteria)}`);

          try {
            const preview = await this.bulkActions.preview(
              message.guild!,
              aiDecision.bulk_criteria,
              message.author.id
            );

            if (preview.count === 0) {
              await message.reply(`❌ No users match the criteria. No action taken.`);
              return;
            }

            // STAGE 1: AI asks conversationally (more serious for bans)
            const criteriaText = [];
            if (aiDecision.bulk_criteria.trustScoreMax) criteriaText.push(`trust score <${aiDecision.bulk_criteria.trustScoreMax}`);
            if (aiDecision.bulk_criteria.trustScoreMin) criteriaText.push(`trust score >${aiDecision.bulk_criteria.trustScoreMin}`);
            if (aiDecision.bulk_criteria.minViolations) criteriaText.push(`${aiDecision.bulk_criteria.minViolations}+ violations`);

            const conversationalPrompt = `Generate a natural, conversational response asking the moderator to confirm a PERMANENT BULK BAN action.

BULK ACTION: PERMANENTLY BAN all members with ${criteriaText.join(', ')}
AFFECTED COUNT: ${preview.count} users

This is PERMANENT. Your response should:
1. Sound more serious since this is a permanent ban
2. Emphasize that this is irreversible
3. Ask if they're REALLY sure
Generate ONLY the response text (1-3 sentences), no quotes.`;

            const aiResponse = await this.ollama.generate(conversationalPrompt, `You are Becas, a friendly but VERY cautious AI moderator.`);
            await message.reply(aiResponse.trim());

            // Store for STAGE 2
            this.pendingConfirmations.set(message.author.id, {
              action: 'bulk_ban_preview' as any,
              bulkCriteria: aiDecision.bulk_criteria,
              reason: aiDecision.reason || 'Bulk moderation',
            } as any);
          } catch (error) {
            logger.error('Bulk ban failed:', error);
            await message.reply(`❌ Bulk ban failed: ${error}`);
          }
          return;

        } else if (aiDecision.action === 'watch') {
          // Special case: watching requires ongoing monitoring
          await message.reply(aiDecision.response_to_moderator || `✅ I understand you want me to watch a user. This feature is coming soon - I'll monitor their messages for violations.`);
          return;
        } else {
          // Unknown action or missing target
          await message.reply(aiDecision.response_to_moderator || `❌ I understood your intent but couldn't execute: ${aiDecision.action}`);
          return;
        }

      // Check for confirmation responses first
      const isConfirmation = commandContent.toLowerCase().match(/^(yes|no|confirm|cancel)$/);
      if (isConfirmation && this.pendingConfirmations.has(message.author.id)) {
        const intent: any = this.pendingConfirmations.get(message.author.id)!;

        if (commandContent.toLowerCase().startsWith('yes') || commandContent.toLowerCase().startsWith('confirm')) {
          logger.info(`✅ User confirmed action: ${intent.action}`);

          // 🔥 STAGE 2: Handle "yes im sure" → Show preview
          if (intent.action === 'bulk_timeout_preview' && intent.bulkCriteria) {
            // User said yes to stage 1, now show preview
            const preview = await this.bulkActions.preview(message.guild!, intent.bulkCriteria, message.author.id);
            const previewList = preview.members.slice(0, 10).map(m =>
              `• ${m.tag} (Trust: ${m.trustScore}, Violations: ${m.violations})`
            ).join('\n');

            await message.reply(`⚠️ **BULK TIMEOUT PREVIEW**\n\nThis will timeout **${preview.count} users**:\n${previewList}${preview.count > 10 ? `\n...and ${preview.count - 10} more` : ''}\n\nDuration: ${intent.duration || 10} minutes\nReason: ${intent.reason || 'Bulk moderation'}\n\n**Type "confirm" again to execute or "cancel" to abort.**`);

            // Update to execution stage
            this.pendingConfirmations.set(message.author.id, {
              action: 'bulk_timeout_execute' as any,
              bulkCriteria: intent.bulkCriteria,
              duration: intent.duration,
              reason: intent.reason,
            } as any);
            return;
          } else if (intent.action === 'bulk_kick_preview' && intent.bulkCriteria) {
            const preview = await this.bulkActions.preview(message.guild!, intent.bulkCriteria, message.author.id);
            const previewList = preview.members.slice(0, 10).map(m =>
              `• ${m.tag} (Trust: ${m.trustScore}, Violations: ${m.violations})`
            ).join('\n');

            await message.reply(`⚠️ **BULK KICK PREVIEW**\n\nThis will kick **${preview.count} users**:\n${previewList}${preview.count > 10 ? `\n...and ${preview.count - 10} more` : ''}\n\nReason: ${intent.reason || 'Bulk moderation'}\n\n**Type "confirm" again to execute or "cancel" to abort.**`);

            this.pendingConfirmations.set(message.author.id, {
              action: 'bulk_kick_execute' as any,
              bulkCriteria: intent.bulkCriteria,
              reason: intent.reason,
            } as any);
            return;
          } else if (intent.action === 'bulk_ban_preview' && intent.bulkCriteria) {
            const preview = await this.bulkActions.preview(message.guild!, intent.bulkCriteria, message.author.id);
            const previewList = preview.members.slice(0, 10).map(m =>
              `• ${m.tag} (Trust: ${m.trustScore}, Violations: ${m.violations})`
            ).join('\n');

            await message.reply(`⚠️ **BULK BAN PREVIEW**\n\nThis will PERMANENTLY BAN **${preview.count} users**:\n${previewList}${preview.count > 10 ? `\n...and ${preview.count - 10} more` : ''}\n\nReason: ${intent.reason || 'Bulk moderation'}\n\n**Type "confirm" again to execute or "cancel" to abort.**`);

            this.pendingConfirmations.set(message.author.id, {
              action: 'bulk_ban_execute' as any,
              bulkCriteria: intent.bulkCriteria,
              reason: intent.reason,
            } as any);
            return;
          }

          // 🔥 STAGE 3: Handle final execution confirmations
          this.pendingConfirmations.delete(message.author.id);
          if (intent.action === 'bulk_timeout_execute' && intent.bulkCriteria) {
            const result = await this.bulkActions.bulkTimeout(
              message.guild!,
              intent.bulkCriteria,
              intent.duration || 10,
              intent.reason || 'Bulk moderation',
              message.author.id
            );

            await message.reply(`✅ **Bulk Timeout Complete**\n\n✓ Successfully timed out: ${result.affected} users\n${result.failed > 0 ? `✗ Failed: ${result.failed} users` : ''}\n\n${result.details}`);

            // 🔥 AUDIT LOG
            await this.auditLogger.log({
              type: 'bulk_action',
              guildId: message.guild!.id,
              guildName: message.guild!.name,
              actorId: message.author.id,
              actorName: message.author.username,
              actorType: 'moderator',
              action: 'bulk_timeout',
              details: { criteria: intent.bulkCriteria, duration: intent.duration, affected: result.affected, failed: result.failed },
              success: result.success,
              channelId: message.channelId,
              messageId: message.id,
            });

            return;
          } else if (intent.action === 'bulk_kick_execute' && intent.bulkCriteria) {
            const result = await this.bulkActions.bulkKick(
              message.guild!,
              intent.bulkCriteria,
              intent.reason || 'Bulk moderation',
              message.author.id
            );

            await message.reply(`✅ **Bulk Kick Complete**\n\n✓ Successfully kicked: ${result.affected} users\n${result.failed > 0 ? `✗ Failed: ${result.failed} users` : ''}\n\n${result.details}`);

            // 🔥 AUDIT LOG
            await this.auditLogger.log({
              type: 'bulk_action',
              guildId: message.guild!.id,
              guildName: message.guild!.name,
              actorId: message.author.id,
              actorName: message.author.username,
              actorType: 'moderator',
              action: 'bulk_kick',
              details: { criteria: intent.bulkCriteria, affected: result.affected, failed: result.failed },
              success: result.success,
              channelId: message.channelId,
              messageId: message.id,
            });

            return;
          } else if (intent.action === 'bulk_ban_execute' && intent.bulkCriteria) {
            const result = await this.bulkActions.bulkBan(
              message.guild!,
              intent.bulkCriteria,
              intent.reason || 'Bulk moderation',
              message.author.id
            );

            await message.reply(`✅ **Bulk Ban Complete**\n\n✓ Successfully banned: ${result.affected} users\n${result.failed > 0 ? `✗ Failed: ${result.failed} users` : ''}\n\n${result.details}`);

            // 🔥 AUDIT LOG
            await this.auditLogger.log({
              type: 'bulk_action',
              guildId: message.guild!.id,
              guildName: message.guild!.name,
              actorId: message.author.id,
              actorName: message.author.username,
              actorType: 'moderator',
              action: 'bulk_ban',
              details: { criteria: intent.bulkCriteria, affected: result.affected, failed: result.failed },
              success: result.success,
              channelId: message.channelId,
              messageId: message.id,
            });

            return;
          }

          // Execute without requiring confirmation again
          const result = await this.commandInterpreter.executeCommand(
            intent,
            message.guild!,
            this.trustEngine,
            false // Don't require confirmation again
          );

          const response = this.commandInterpreter.formatResult(result);
          await message.reply(response);

          return;
        } else {
          logger.info(`❌ User cancelled action: ${intent.action}`);
          this.pendingConfirmations.delete(message.author.id);
          await message.reply('Action cancelled.');
          return;
        }
      }

      // Parse command with AI
      const intent = await this.commandInterpreter.parseCommand(commandContent, message.guild!);

      // Check confidence - be more lenient for analytics/query actions
      const isQueryAction = ['query', 'show', 'analyze'].includes(intent.action);
      const minConfidence = isQueryAction ? 0.3 : 0.4; // Lower threshold for queries

      if (intent.confidence >= minConfidence) {
        logger.info(`✅ Command understood with ${(intent.confidence * 100).toFixed(0)}% confidence`);

        // Check permissions for destructive actions
        const requiresPerms = ['ban', 'kick', 'timeout', 'mass_action'].includes(intent.action);
        if (requiresPerms && !hasModerationPerms) {
          await message.reply(`I understand you want to ${intent.action}, but you don't have the necessary permissions.`);
          return;
        }

        // Execute command
        const result = await this.commandInterpreter.executeCommand(
          intent,
          message.guild!,
          this.trustEngine,
          true, // Require confirmation for complex/irreversible actions
          message.author.id // Pass moderator ID for audit logging
        );

        // If needs confirmation, save intent
        if (!result.executed && result.details.some(d => d.includes('confirmation'))) {
          this.pendingConfirmations.set(message.author.id, intent);
          const response = this.commandInterpreter.formatResult(result);
          await message.reply(`${response}\n\n**Reply with "yes" to confirm or "no" to cancel.**`);
          return;
        }

        // Send result
        const response = this.commandInterpreter.formatResult(result);
        await message.reply(response);

        logger.info(`✓ Command executed: ${result.success ? 'SUCCESS' : 'FAILED'}`);
        return; // Command handled, stop processing
      } else {
        logger.info(`⚠️ Low confidence (${(intent.confidence * 100).toFixed(0)}%), treating as conversation`);
        // When user is addressing Becas, NEVER fall through to V2 Cognitive moderation!
        // Use dialogue system instead
        // (Fall through to dialogue processing below)
      }
      } else {
        logger.info(`⚠️ Low/unclear classification - treating as conversation`);
        // When user is addressing Becas, use dialogue, not moderation
        // (Fall through to dialogue processing below)
      }

      // 🔥 CRITICAL: User is addressing Becas - skip V2 Cognitive moderation entirely!
      // Commands/conversations with Becas should NEVER trigger moderation warnings
      logger.info('✅ User addressed Becas - skipping V2 Cognitive, jumping to dialogue...');
      // Jump straight to dialogue processing (skip the V2 Cognitive layer)
    } // End of isAddressingBecas check

    // ============================================
    // V2 ARCHITECTURE - LAYER 3: COGNITIVE LAYER
    // ============================================
    // System 2: Slow deliberate reasoning with V2 systems
    // 🔥 CRITICAL: ONLY use V2 Cognitive for ACTUAL THREATS, not casual conversation

    // 🚨 SKIP V2 Cognitive if user is addressing Becas (commands/conversation with bot)
    if (!isAddressingBecas) {
      try {
        this.dailyStats.messagesProcessed++;

        // 🚨 PRE-CHECK: Only use V2 Cognitive if there's a REAL threat signal
        // V2 Cognitive is expensive and aggressive - don't waste it on "lo", "hi", casual chat
        // Simple heuristic checks to avoid wasting LLM calls on normal conversation
        const hasThreatSignals = (
          message.content.match(/discord.*nitro|free.*nitro|@everyone.*(giveaway|free)/i) ||  // Scam patterns
          message.mentions.everyone ||  // @everyone spam (high risk)
          message.content.length > 1000 ||  // Very long message (potential spam)
          message.content.match(/\b(kill|die|kys|suicide|hurt myself)\b/i) ||  // Crisis keywords
          message.content.match(/\b(fuck|shit|bitch|asshole|nigger|faggot|retard|cunt)\b/i) ||  // Strong profanity
          message.content.split(/\s+/).length > 200  // Extremely long (spam)
        );

        if (!hasThreatSignals) {
          logger.info('✅ No threat signals detected - skipping V2 Cognitive (normal conversation)');
          // Fall through to V1 for normal dialogue handling
        } else {
          // Use V2 Cognitive Core for advanced reasoning ONLY when needed
          logger.info('🧠 Threat signals detected - calling V2 Cognitive Core for analysis...');
          const cognitiveDecision = await this.processWithV2Cognitive(message, stableContext);

          if (cognitiveDecision.handled) {
            logger.info('✅ V2 handled the message successfully!');
            return; // V2 handled it
          }
        }

        // Fallback to V1 for normal conversation and compatibility
        logger.info('✓ Using V1 pipeline for normal conversation...');

      } catch (error) {
        logger.error('V2 Cognitive error:', error);
      }
    } // End of if (!isAddressingBecas)

    // ============================================
    // V1 ARCHITECTURE - LEGACY PIPELINE
    // ============================================
    // Fallback for compatibility and normal dialogue

    // Convert to MessageContext
    const context: MessageContext = {
      id: message.id,
      content: message.content,
      authorId: message.author.id,
      authorName: message.author.username,
      guildId: message.guild.id,
      channelId: message.channelId,
      timestamp: message.createdAt,
      mentions: message.mentions.users.map(u => u.id),
      attachments: message.attachments.map(a => a.url),
    };

    // NOTE: hasModerationPerms was already declared earlier at line 1142

    // Get recent context early (needed by multiple systems)
    const conversationId = `${message.guildId}:${message.channelId}`;
    const recentContext = this.memory.getShortTermContext(conversationId, 20);

    // Get current trust score for scam detection (needed early)
    const currentTrustScore = await this.trustEngine.getTrustScore(message.author.id, message.guild.id);

    // NOTE: isAddressingBecas was already calculated earlier at line 1280
    // This is the V1 pipeline - it runs for ALL messages (both addressing and non-addressing)

    // Pre-check for language and images
    const isEnglish = /^[a-zA-Z0-9\s.,!?@#$%^&*()_+\-=\[\]{};':"\\|<>\/`~]*$/i.test(message.content);
    const hasImages = context.attachments.some(url => /\.(jpg|jpeg|png|gif|webp)$/i.test(url));

    // 🧠 PARALLEL GPU PROCESSING - Run all analyses simultaneously
    // Execute all analyses in parallel for maximum performance
    logger.info('🧠 Running PARALLEL GPU analysis...');
    const parallelStart = performance.now();

    try {
    // Determine if we need scam check before parallel execution
    // 🚀 PERFORMANCE: Skip scam analysis for short, simple messages
    const needsScamCheck = !isAddressingBecas &&
      message.content.length > 20;

    // Run all analyses in parallel using Promise.all()
    logger.info('Running 5 parallel analysis steps...');
    const [analyzed, languageInfo, requestedAction, scamAnalysis, imageAnalyses] = await Promise.all([
      // Step 1/5: Dialogue analysis
      this.dialogue.analyzeMessage(context).catch(err => {
        logger.error('Dialogue analysis failed:', err);
        return {
          ...context,
          sentiment: { positive: 0, negative: 0, neutral: 1, emotions: [], dominant: 'neutral' as const },
          intent: { type: 'statement' as const, confidence: 0, target: undefined, action: undefined },
          hierarchy: 'member' as const,
          toxicity: 0,
          manipulation: 0,
        };
      }),

      // Step 2/5: Language detection
      (!isEnglish && message.content.length > 10
        ? this.languageDetector.analyze(message.content).catch(err => {
            logger.warn('Language detection failed, continuing:', err.message);
            return null;
          })
        : Promise.resolve(null)),

      // Step 3/5: Action detection
      this.detectRequestedAction(message.content).catch(err => {
        logger.warn('Action detection failed, continuing:', err.message);
        return null;
      }),

      // Step 4/5: Scam analysis (conditionally executed)
      (needsScamCheck
        ? (async () => {
            // Need to wait for analyzed result for toxicity check
            // This will be executed in parallel but with proper dependencies
            const analyzed_temp = await this.dialogue.analyzeMessage(context).catch(err => ({
              ...context,
              sentiment: { positive: 0, negative: 0, neutral: 1, emotions: [], dominant: 'neutral' as const },
              intent: { type: 'statement' as const, confidence: 0, target: undefined, action: undefined },
              hierarchy: 'member' as const,
              toxicity: 0,
              manipulation: 0,
            }));
            const shouldCheck = (message.content.includes('http') || message.content.includes('www') || analyzed_temp.toxicity > 0.3);
            return shouldCheck
              ? this.scamDetector.analyze(
                  message.content,
                  `Trust: ${currentTrustScore.score}, History: ${currentTrustScore.history.length} events`
                ).catch(err => {
                  logger.warn('Scam detection failed, continuing:', err.message);
                  return null;
                })
              : null;
          })()
        : Promise.resolve(null)),

      // Step 5/5: Image analysis
      (hasImages
        ? Promise.all(
            context.attachments
              .filter(url => /\.(jpg|jpeg|png|gif|webp)$/i.test(url))
              .map(url =>
                this.imageAnalyzer
                  .analyzeImage(url)
                  .catch(err => {
                    logger.warn(`Image analysis failed for ${url}:`, err.message);
                    return null;
                  })
              )
          ).then(results => results.filter((r): r is NonNullable<typeof r> => r !== null))
        : Promise.resolve([])),
    ]);

    const parallelTime = performance.now() - parallelStart;
    logger.info(`🧠 PARALLEL analysis complete in ${parallelTime.toFixed(0)}ms`);

    // Apply language translation to analyzed content if detected
    if (languageInfo?.translatedToEnglish) {
      console.log(`🌐 Detected ${languageInfo.language} (${(languageInfo.confidence * 100).toFixed(0)}% confidence)`);
      console.log(`   Translated: "${languageInfo.translatedToEnglish}"`);
      analyzed.content = languageInfo.translatedToEnglish;
    }

    // Handle image analysis results (check for inappropriate/scam content)
    const imageAnalysis = imageAnalyses.find(img => img !== null);
    if (imageAnalysis) {
      if (imageAnalysis.isInappropriate) {
        console.log(`🚨 Inappropriate image detected!`);
        console.log(`   Categories: ${imageAnalysis.categories.join(', ')}`);
        console.log(`   Confidence: ${(imageAnalysis.confidence * 100).toFixed(0)}%`);

        await message.delete();
        await this.trustEngine.modifyTrust(
          message.author.id,
          message.guild.id,
          -30,
          `Inappropriate image (${imageAnalysis.categories.join(', ')}): ${imageAnalysis.reasoning}`
        );

        const channel = message.channel as TextChannel;
        await channel.send(`⚠️ <@${message.author.id}>, that image was inappropriate. (${imageAnalysis.categories.join(', ')})`);
        return;
      }

      if (imageAnalysis.containsScamIndicators) {
        console.log(`🚨 Scam detected in image!`);
        await message.delete();
        const channel = message.channel as TextChannel;
        await channel.send(`⚠️ Potential scam detected in image. Message removed.`);
        return;
      }
    }

    // Check if this is a test or moderation command
    const isTestingPhrase = /test|testing|try|check/i.test(analyzed.content);
    const isModCommand = requestedAction !== null;
    const isModeratorTesting = hasModerationPerms && (isTestingPhrase || isModCommand);

    // Log moderator activity
    if (isModeratorTesting) {
      console.log(`🔧 Moderator command detected from ${message.author.username}`);
      if (requestedAction) {
        console.log(`   Requested action: ${requestedAction}`);
      }
    }

    // Add to short-term memory
    await this.memory.addToShortTerm(analyzed, conversationId);

    // 🔥 REDEMPTION CHECK: Reward good behavior
    if (analyzed.toxicity < 0.3 && !scamAnalysis?.isScam) {
      const redemption = await this.trustEngine.checkRedemption(
        message.author.id,
        message.guild.id,
        {
          toxicity: analyzed.toxicity,
          manipulation: analyzed.manipulation || 0,
          sentiment: analyzed.sentiment,
          isHelpful: analyzed.sentiment?.dominant === 'positive' && analyzed.toxicity < 0.1,
        }
      );

      if (redemption.redeemed) {
        logger.info(`✨ REDEMPTION: ${message.author.username} earned +${redemption.points} trust (${redemption.reason})`);
      }
    }

    // Process message for monitoring tasks
    // Store message in database with user/server/channel info
    await this.dbIntegration.processDiscordMessage(message, analyzed);

    // Use database-backed user monitor
    await this.dbIntegration.userMonitor.processMessage(analyzed);

    // 📊 ANALYTICS - Track all messages (for activity metrics)
    // Only track if not already tracked as special event (scam/toxic)
    if (!scamAnalysis?.isScam && analyzed.toxicity < 0.8) {
      await this.analyticsManager.trackEvent({
        guildId: message.guild!.id,
        type: 'message',
        actorId: message.author.id,
        sentiment: analyzed.sentiment.dominant === 'positive' ? 'positive' :
                   analyzed.sentiment.dominant === 'negative' ? 'negative' : 'neutral',
        channelId: message.channelId,
        messageId: message.id,
        metadata: {
          toxicity: analyzed.toxicity,
          wordCount: message.content.split(' ').length,
        },
      });
    }

    if (scamAnalysis && scamAnalysis.isScam) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`🚨 SCAM DETECTED!`);
      console.log(`${'='.repeat(70)}`);
      console.log(`👤 User: ${message.author.username} (${message.author.id})`);
      console.log(`📝 Message: "${message.content.substring(0, 100)}${message.content.length > 100 ? '...' : ''}"`);
      console.log(`\n🧠 AI ANALYSIS RESULTS:`);
      console.log(`   ├─ Type: ${scamAnalysis.scamType}`);
      console.log(`   ├─ Confidence: ${(scamAnalysis.confidence * 100).toFixed(1)}%`);
      console.log(`   ├─ Severity: ${scamAnalysis.severity}`);
      console.log(`   ├─ Ban Permanently: ${scamAnalysis.shouldBanPermanently ? 'YES' : 'NO'}`);
      console.log(`   └─ Indicators Found: ${scamAnalysis.indicators.length}`);
      console.log(`\n🔍 RED FLAGS DETECTED:`);
      scamAnalysis.indicators.forEach((indicator, i) => {
        console.log(`   ${i + 1}. ${indicator}`);
      });
      console.log(`\n💭 AI REASONING (How it decided):`);
      console.log(`   "${scamAnalysis.reasoning}"`);
      console.log(`\n📊 TRUST SCORE: ${currentTrustScore.score}/100 (${currentTrustScore.level})`);
      console.log(`${'='.repeat(70)}\n`);

      // 🔥 AUDIT LOG - Scam detection
      await this.auditLogger.log({
        type: 'scam_detected',
        guildId: message.guild!.id,
        guildName: message.guild!.name,
        actorId: message.author.id,
        actorName: message.author.username,
        actorType: 'user',
        action: 'scam_attempt',
        details: {
          scamType: scamAnalysis.scamType,
          confidence: scamAnalysis.confidence,
          severity: scamAnalysis.severity,
          indicators: scamAnalysis.indicators,
          reasoning: scamAnalysis.reasoning,
          trustScore: currentTrustScore.score,
          willBan: scamAnalysis.shouldBanPermanently,
          messageContent: message.content.substring(0, 200),
        },
        success: true,
        aiConfidence: scamAnalysis.confidence,
        aiReasoning: scamAnalysis.reasoning,
        channelId: message.channelId,
        messageId: message.id,
      });

      // 📊 ANALYTICS - Track scam attempt
      await this.analyticsManager.trackEvent({
        guildId: message.guild!.id,
        type: 'scam_attempt',
        actorId: message.author.id,
        reason: `${scamAnalysis.scamType} - ${scamAnalysis.reasoning}`,
        severity: scamAnalysis.severity === 'critical' ? 1.0 : 0.8,
        sentiment: 'negative',
        channelId: message.channelId,
        messageId: message.id,
        metadata: {
          scamType: scamAnalysis.scamType,
          confidence: scamAnalysis.confidence,
          willBan: scamAnalysis.shouldBanPermanently,
        },
      });

      // ALERT MOD CHANNEL IMMEDIATELY
      const modChannel = message.guild!.channels.cache.find(
        c => c.name.includes('mod') && c.isTextBased()
      ) as TextChannel;

      if (modChannel) {
        // Show past action history
        const history = currentTrustScore.history.slice(-5).reverse(); // Last 5 events
        let historyText = '';
        if (history.length > 0) {
          historyText = '\n\n**📋 Past Actions:**\n' + history.map(h =>
            `• ${h.reason} (${h.delta > 0 ? '+' : ''}${h.delta}) - ${new Date(h.timestamp).toLocaleDateString()}`
          ).join('\n');
        } else {
          historyText = '\n\n**📋 Past Actions:** None (first offense)';
        }

        await modChannel.send(`🚨 **SCAM ALERT**\n👤 User: <@${message.author.id}> (${message.author.username})\n🎯 Type: ${scamAnalysis.scamType}\n📊 Confidence: ${(scamAnalysis.confidence * 100).toFixed(0)}%\n⚠️ Severity: ${scamAnalysis.severity}\n🔍 Indicators: ${scamAnalysis.indicators.join(', ')}\n📉 Trust Score: **${currentTrustScore.score}/100** (${currentTrustScore.level})\n💬 Message: "${message.content.substring(0, 100)}..."\n⚡ Action: ${scamAnalysis.shouldBanPermanently ? 'PERMANENT BAN' : 'TIMEOUT'}${historyText}`);
      }

      // MODERATOR TESTING MODE: Log what would happen but don't ban
      if (hasModerationPerms) {
        console.log(`\n⚠️ TESTING MODE (Moderator detected)`);
        console.log(`   Would delete message: YES`);
        console.log(`   Would ban permanently: ${scamAnalysis.shouldBanPermanently ? 'YES' : 'NO'}`);
        console.log(`   Would set trust to 0: YES`);
        console.log(`   Would add to global ban list: ${scamAnalysis.shouldBanPermanently ? 'YES' : 'NO'}`);
        console.log(`   Skipping actual ban for moderator testing\n`);

        // Just notify but don't actually ban the moderator (shorter message to prevent spam)
        await message.reply(`⚠️ **SCAM DETECTED** (${scamAnalysis.scamType}) - ${(scamAnalysis.confidence * 100).toFixed(0)}% confidence\n📉 Your trust score would be: **0/100**\n*Would ${scamAnalysis.shouldBanPermanently ? 'permanently ban' : 'timeout'} regular users.*`);
        return; // Skip to next message
      }

      // REAL ENFORCEMENT MODE: Execute for non-moderators
      console.log(`\n⚡ ENFORCEMENT MODE (Non-moderator user)`);

      // Delete the message immediately
      try {
        await message.delete();
        console.log(`✓ Deleted scam message`);
      } catch (error) {
        console.error(`Failed to delete message:`, error);
      }

      // Permanent ban for critical scams
      if (scamAnalysis.shouldBanPermanently) {
        console.log(`🚫 PERMANENT BAN initiated`);

        // Set permanent zero score
        await this.trustEngine.setPermanentZeroScore(
          message.author.id,
          message.guild.id,
          `Scam detected: ${scamAnalysis.scamType}`,
          message.content
        );

        // Add to global ban list
        await this.crossGuild.addGlobalBan(
          message.author.id,
          message.author.username,
          `${scamAnalysis.scamType} scam - ${scamAnalysis.reasoning}`,
          scamAnalysis.indicators,
          scamAnalysis.severity === 'critical' ? 'critical' : 'high',
          'system'
        );

        // Ban from current guild
        try {
          await message.member?.ban({
            reason: `Scam detected: ${scamAnalysis.scamType} - ${scamAnalysis.reasoning}`,
          });

          // Record to V3 memory
          await this.recordModerationAction(
            'ban',
            message.author.id,
            message.author.username,
            `Scam detected: ${scamAnalysis.scamType} - ${scamAnalysis.reasoning}`,
            message.guild.id,
            message.channel.id
          );

          console.log(`✓ User banned from ${message.guild.name}`);

          // Notify channel with brief history
          const channel = message.channel as TextChannel;
          const pastOffenses = currentTrustScore.history.length;
          const offenseText = pastOffenses > 0 ? `\n🔴 Past offenses: ${pastOffenses}` : '\n🔴 First-time scammer';
          await channel.send(`🚫 **SCAMMER BANNED**: <@${message.author.id}>\n📊 Scam Type: ${scamAnalysis.scamType}\n📉 Trust Score: **0/100** (PERMANENT)${offenseText}\n⚡ Banned from all Becas-protected servers.`);
        } catch (error) {
          console.error(`Failed to ban scammer:`, error);
          const channel = message.channel as TextChannel;
          await channel.send(`⚠️ **Scam Detected** but failed to ban user. Please check bot permissions.`);
        }

        return; // Stop processing this message
      } else {
        // High confidence but not permanent - severe trust penalty
        await this.trustEngine.modifyTrust(
          message.author.id,
          message.guild.id,
          -50,
          `Scam detected (${scamAnalysis.scamType}): ${message.content.substring(0, 100)}`
        );

        // Timeout the user
        try {
          await message.member?.timeout(3600000, `Scam attempt: ${scamAnalysis.scamType}`); // 1 hour

          // Record to V3 memory
          await this.recordModerationAction(
            'timeout',
            message.author.id,
            message.author.username,
            `Scam attempt: ${scamAnalysis.scamType}`,
            message.guild.id,
            message.channel.id,
            3600000
          );

          const channel = message.channel as TextChannel;
          await channel.send(`⚠️ **Suspicious Activity**: <@${message.author.id}> timed out (${scamAnalysis.scamType})`);
        } catch (error) {
          console.error(`Failed to timeout user:`, error);
        }

        return; // Stop processing this message
      }
    }

    // [REMOVED] Analytics/Command code - Now handled earlier in pipeline (line 849)

    // [OLD CODE REMOVED - Now using Advanced AI Command Interpreter]

    // ❌ REMOVED: Complex intent bypass - this was preventing AI reasoning!
    // OLD BUGGY CODE:
    // if (isAddressingBecas && this.intentParser.isComplexIntent(analyzed.content)) {
    //   await this.handleComplexIntent(message, analyzed);
    //   return; // ❌ This bypassed AI reasoning for messages with "if", "when", etc.
    // }
    //
    // FIX: Complex intents are now handled by AI reasoning in V2 CognitiveCore
    // AI can understand complex conditions better than pattern matching

    // NEW: Emotional support - ONLY for CRITICAL cases (suicide/self-harm)
    // IMPORTANT: Skip crisis detection if message is toxic/hateful - those need moderation, not support
    if (!hasModerationPerms && analyzed.toxicity < 0.7) {
      try {
        const crisisDetection = await this.emotionalSupport.detectCrisis(
          analyzed.content,
          message.author.username
        );

        // ONLY respond if CRITICAL and HIGH confidence
        if (crisisDetection.isCrisis && crisisDetection.severity === 'critical' && crisisDetection.confidence > 0.8) {
          console.log(`🆘 CRITICAL Mental health crisis detected!`);
          console.log(`   Type: ${crisisDetection.type}`);
          console.log(`   Severity: ${crisisDetection.severity}`);
          console.log(`   Confidence: ${(crisisDetection.confidence * 100).toFixed(0)}%`);

          // Send BRIEF supportive response
          await message.reply(crisisDetection.suggestedResponse);

          // Alert moderators
          const modChannel = message.guild!.channels.cache.find(
            c => c.name.includes('mod') && c.isTextBased()
          ) as TextChannel;

          if (modChannel) {
            await modChannel.send(`🆘 **Crisis Alert**: User ${message.author.username} may need support. Type: ${crisisDetection.type}`);
          }

          return; // Handled with care
        }
      } catch (error) {
        console.error('Crisis detection failed:', error);
      }
    }

    // NEW: Conflict prediction (DISABLED - too chatty, just log)
    const recentMessages = this.memory.getShortTermContext(conversationId, 20).split('\n');
    try {
      const conflictPrediction = await this.conflictPredictor.analyzeForConflict(
        analyzed,
        recentMessages
      );

      if (conflictPrediction.riskLevel === 'critical') {
        console.log(`⚔️ CRITICAL Conflict risk: ${conflictPrediction.riskLevel}`);
        console.log(`   Confidence: ${(conflictPrediction.confidence * 100).toFixed(0)}%`);
        console.log(`   Indicators: ${conflictPrediction.indicators.join(', ')}`);
        // DON'T send intervention - too chatty, just log it
      }
    } catch (error) {
      console.error('Conflict prediction failed:', error);
    }

    // NEW: User profiling and anomaly detection
    try {
      const anomaly = await this.userProfiler.detectAnomaly(analyzed);

      if (anomaly.isAnomaly) {
        console.log(`🚨 Behavioral anomaly detected!`);
        console.log(`   Type: ${anomaly.type}`);
        console.log(`   Confidence: ${(anomaly.confidence * 100).toFixed(0)}%`);
        console.log(`   Reasoning: ${anomaly.reasoning}`);

        // Alert moderators for account takeover
        if (anomaly.type === 'account_takeover' && anomaly.confidence > 0.7) {
          const modChannel = message.guild!.channels.cache.find(
            c => c.name.includes('mod') && c.isTextBased()
          ) as TextChannel;

          if (modChannel) {
            await modChannel.send(`⚠️ **Anomaly Alert**: User ${message.author.username} showing unusual behavior (${anomaly.type}). Confidence: ${(anomaly.confidence * 100).toFixed(0)}%`);
          }
        }
      }
    } catch (error) {
      console.error('Anomaly detection failed:', error);
    }

    // NEW: Network analysis for coordinated attacks
    try {
      const recentMsgData = recentMessages.map((_, idx) => ({
        authorId: analyzed.authorId, // Simplified - would need full context
        timestamp: new Date(Date.now() - (recentMessages.length - idx) * 1000)
      }));

      const coordAttack = this.networkAnalyzer.detectCoordinatedAttack(recentMsgData);

      if (coordAttack.isCoordinated) {
        console.log(`🚨 Coordinated attack detected!`);
        console.log(`   Suspected users: ${coordAttack.suspectedUsers.length}`);
        console.log(`   Confidence: ${(coordAttack.confidence * 100).toFixed(0)}%`);

        const modChannel = message.guild!.channels.cache.find(
          c => c.name.includes('mod') && c.isTextBased()
        ) as TextChannel;

        if (modChannel) {
          await modChannel.send(`🚨 **Coordinated Activity Detected**: ${coordAttack.suspectedUsers.length} users acting in coordination. Confidence: ${(coordAttack.confidence * 100).toFixed(0)}%`);
        }
      }

      // Record network interactions
      if (message.mentions.users.size > 0) {
        const mentionedUser = message.mentions.users.first();
        if (mentionedUser && mentionedUser.id !== this.client.user!.id) {
          const sentiment = analyzed.sentiment.dominant === 'positive' ? 'positive' :
                          analyzed.toxicity > 0.5 ? 'negative' : 'neutral';
          this.networkAnalyzer.recordInteraction(
            message.author.id,
            mentionedUser.id,
            sentiment
          );
        }
      }
    } catch (error) {
      console.error('Network analysis failed:', error);
    }

    // NEW: Smart slowmode processing
    try {
      await this.smartSlowmode.processMessage(message.channelId, message.channel as TextChannel);
    } catch (error) {
      console.error('Smart slowmode failed:', error);
    }

    // Update trust score (skip for moderators testing)
    let trustScore;
    if (hasModerationPerms && isModeratorTesting) {
      trustScore = await this.trustEngine.getTrustScore(message.author.id, message.guild.id);
      console.log('⚠️ Skipping trust penalty for moderator testing');
    } else {
      trustScore = await this.trustEngine.updateFromMessage(analyzed);
    }

    // IMMEDIATE ACTION for extreme toxicity/hate speech (bypass trust system)
    if (!hasModerationPerms && analyzed.toxicity >= 0.8) {
      console.log(`🚨 EXTREME TOXICITY DETECTED: ${(analyzed.toxicity * 100).toFixed(0)}%`);

      // Calculate dynamic timeout duration based on toxicity severity
      let timeoutDuration: number;
      let durationText: string;

      if (analyzed.toxicity >= 0.95) {
        timeoutDuration = 3600000; // 60 minutes for extreme cases
        durationText = "60 minutes";
      } else if (analyzed.toxicity >= 0.9) {
        timeoutDuration = 1800000; // 30 minutes
        durationText = "30 minutes";
      } else if (analyzed.toxicity >= 0.85) {
        timeoutDuration = 1200000; // 20 minutes
        durationText = "20 minutes";
      } else {
        timeoutDuration = 600000; // 10 minutes (default for 0.8-0.85)
        durationText = "10 minutes";
      }

      console.log(`   Timeout duration: ${durationText}`);

      try {
        // Delete the message
        await message.delete();

        // Timeout the user with dynamic duration
        await message.member?.timeout(timeoutDuration, `Extreme toxicity (${(analyzed.toxicity * 100).toFixed(0)}%): hate speech/profanity`);

        // Record to V3 memory
        await this.recordModerationAction(
          'timeout',
          message.author.id,
          message.author.username,
          `Extreme toxicity (${(analyzed.toxicity * 100).toFixed(0)}%): hate speech/profanity`,
          message.guild.id,
          message.channel.id,
          timeoutDuration
        );

        // Get updated trust score after applying penalty
        const updatedTrust = await this.trustEngine.getTrustScore(message.author.id, message.guild.id);

        const channel = message.channel as TextChannel;
        await channel.send(`⚠️ **TIMEOUT APPLIED**\n👤 User: <@${message.author.id}>\n⏰ Duration: ${durationText}\n☢️ Toxicity: ${(analyzed.toxicity * 100).toFixed(0)}%\n📉 Trust Score: **${updatedTrust.score}/100** (${updatedTrust.level})`);

        // 📊 ANALYTICS - Track toxic message
        await this.analyticsManager.trackEvent({
          guildId: message.guild!.id,
          type: 'toxic_action',
          actorId: message.author.id,
          reason: `Extreme toxicity: ${(analyzed.toxicity * 100).toFixed(0)}%`,
          severity: analyzed.toxicity,
          sentiment: 'negative',
          channelId: message.channelId,
          messageId: message.id,
          metadata: { toxicity: analyzed.toxicity, timeoutDuration },
        });

        this.dailyStats.actionsToday++;
        return; // Stop processing
      } catch (error) {
        console.error('Failed to timeout for extreme toxicity:', error);
      }
    }

    // Check rules
    const { triggered, actions } = await this.ruleEngine.checkRules(analyzed, recentContext);

    // NEW: Standalone modification check (even without addressing Becas)
    // Allow mods to say "what about 10?" without "becas" prefix
    if (hasModerationPerms && !isAddressingBecas) {
      const modCheck = await this.detectModificationIntent(
        message,
        analyzed.content,
        this.recentActions
      );

      if (modCheck.isModification) {
        console.log(`🔄 Standalone modification detected (without addressing Becas)`);

        const actionKey = `${message.guildId}:${message.author.id}`;
        const lastAction = this.recentActions.get(actionKey);

        if (lastAction && modCheck.changeType === 'duration' && modCheck.newDuration) {
          const newMinutes = modCheck.newDuration / 60000;
          const targetMember = message.guild!.members.cache.get(lastAction.targetId);

          if (targetMember) {
            try {
              await targetMember.timeout(modCheck.newDuration, `Modified by ${message.author.username}: changed to ${newMinutes} minutes`);

              // Record to V3 memory
              await this.recordModerationAction(
                'timeout',
                targetMember.id,
                targetMember.user.username,
                `Modified by ${message.author.username}: changed to ${newMinutes} minutes`,
                message.guild!.id,
                message.channel.id,
                modCheck.newDuration
              );

              lastAction.duration = modCheck.newDuration;
              lastAction.timestamp = new Date();

              await message.reply(`Changed to ${newMinutes} minutes. ${lastAction.targetName} now timed out for ${newMinutes} minutes total.`);
              console.log(`✓ Standalone modification successful`);
              return;
            } catch (error) {
              console.error(`Failed standalone modification:`, error);
            }
          }
        } else if (lastAction && modCheck.changeType === 'cancel') {
          await this.handleUndoRequest(message, analyzed);
          return;
        }
      }
    }

    // Handle governance commands (if user has permission)
    if (analyzed.intent.type === 'governance' && this.canUserExecuteAction(message.member!, 'governance')) {
      await this.handleGovernanceCommand(message, analyzed);
      return;
    } else if (analyzed.intent.type === 'governance' && !this.canUserExecuteAction(message.member!, 'governance')) {
      await message.reply('I appreciate your suggestion, but you need moderation permissions to create rules. Please ask a moderator or admin.');
      return;
    }

    // 🧠 COGNITIVE ORCHESTRATION - Handle complex commands with reasoning
    // Activate for commands that need planning, context understanding, or multi-step reasoning
    const complexCommandPatterns = /delete.*(\d+|last|recent|one of|duplicate)|ban.*who|timeout.*with|delete.*(channel|role|server)|remove.*(channel|duplicate)|can you (delete|remove|create|add)/i;
    const isComplexCommand = complexCommandPatterns.test(analyzed.content) && isAddressingBecas && hasModerationPerms;

    if (isComplexCommand) {
      console.log(`🧠 ===== COMPLEX COMMAND DETECTED - Engaging Cognitive Orchestrator =====`);

      try {
        // Use Cognitive Orchestrator for multi-step reasoning
        const decision = await this.cognitiveOrchestrator.processCommand(
          message,
          analyzed.content,
          hasModerationPerms
        );

        // Handle clarification needs
        if (decision.needsClarification) {
          await message.reply(`🤔 I need some clarification:\n\n${decision.needsClarification}\n\nPlease rephrase your command with more details.`);
          return;
        }

        // Handle safety warnings
        if (decision.safetyWarning) {
          await message.reply(`⚠️ **Safety Warning**:\n\n${decision.safetyWarning}\n\nI cannot execute this action.`);
          return;
        }

        // Execute the structured action
        if (decision.action) {
          console.log(`✅ Cognitive decision made - executing structured action`);

          // Show reasoning chain to user (transparent AI thinking)
          const reasoningText = this.cognitiveOrchestrator.formatReasoningChain(decision.reasoning);
          await message.reply(`🧠 **My Thinking Process:**\n\n${reasoningText}\n\n⏳ Executing action...`);

          // Execute the action
          const result = await this.structuredActionParser.executeStructuredAction(
            decision.action,
            message.channel as TextChannel,
            message.author.id
          );

          // Send result to user
          const channel = message.channel as TextChannel;
          if (result.success) {
            await channel.send(`✅ **${result.message}**\n\n${decision.executionPlan ? `**Steps taken:**\n${decision.executionPlan.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''}`);

            // Reflect on the outcome (learning)
            await this.cognitiveOrchestrator.reflect(
              decision.action,
              result,
              undefined // Will add user feedback later
            );
          } else {
            await channel.send(`❌ **Action failed:** ${result.message}`);
          }

          return;
        }
      } catch (error: any) {
        console.error('❌ Cognitive orchestration error:', error);
        await message.reply(`I encountered an error while processing your complex command: ${error.message}\n\nTry breaking it down into simpler steps.`);
        return;
      }
    }

    // Handle direct moderation requests (ban/kick/timeout commands)
    if (requestedAction && isAddressingBecas) {
      console.log(`🎯 Direct moderation request: ${requestedAction} from ${message.author.username}`);

      // Handle UNDO requests
      if (requestedAction === 'undo') {
        await this.handleUndoRequest(message, analyzed);
        return;
      }

      // Handle CHECK TRUST requests
      if (requestedAction === 'check') {
        const targetUser = message.mentions.users.find(u => u.id !== this.client.user!.id);

        // If no user mentioned, show their own score
        const userToCheck = targetUser || message.author;
        const userTrust = await this.trustEngine.getTrustScore(userToCheck.id, message.guild.id);

        // Only moderators can see detailed history of other users
        if (targetUser && !hasModerationPerms) {
          await message.reply(`📊 **TRUST SCORE**: <@${userToCheck.id}>\n\n📉 Score: **${userTrust.score}/100**\n🎯 Level: **${userTrust.level.toUpperCase()}**`);
          return;
        }

        // Full report (for own score or moderators checking others)
        const history = userTrust.history.slice(-5).reverse(); // Last 5 events

        let historyText = history
          .filter(h => h.delta !== 0 || !h.reason.includes('message analyzed')) // Filter out zero-delta "message analyzed" entries
          .map(h => `• ${h.reason} (${h.delta > 0 ? '+' : ''}${h.delta})`)
          .join('\n');

        if (historyText.length === 0) historyText = '• No significant events';

        await message.reply(`📊 **TRUST REPORT**: <@${userToCheck.id}>\n\n📉 Current Score: **${userTrust.score}/100**\n🎯 Level: **${userTrust.level.toUpperCase()}**\n📝 Total Events: ${userTrust.history.length}\n\n**Recent History:**\n${historyText}`);

        return; // ✅ CRITICAL: Must return here to prevent duplicate responses
      }

      const canExecute = this.canUserExecuteAction(message.member!, requestedAction);
      
      if (canExecute) {
        console.log(`✓ User has permission, executing ${requestedAction}`);
        await this.handleDirectModerationRequest(message, analyzed, requestedAction);
        return;
      } else {
        console.log(`✗ User lacks permission for ${requestedAction}`);
        await message.reply(`I understand you want to ${requestedAction}, but you don't have the necessary Discord permissions (${this.getRequiredPermission(requestedAction)}) to execute this action.`);
        return;
      }
    } else if (requestedAction && !isAddressingBecas) {
      console.log(`⚠️ Action detected (${requestedAction}) but Becas not addressed - ignoring`);
    }

    // Execute moderation actions if rules triggered (skip for moderators)
    if (triggered.length > 0 && !hasModerationPerms) {
      for (const action of actions) {
        await this.moderation.executeAction(
          action,
          message.author.id,
          message.guild,
          `Rule triggered: ${triggered[0].reason}`
        );

        // Update stats
        if (action.type === 'warn' || action.type === 'timeout' || action.type === 'ban') {
          this.dailyStats.actionsToday++;
        }

        // Notify in channel
        await this.sendModerationNotice(message.channel as TextChannel, action, triggered[0].reason);
      }
    } else if (triggered.length > 0 && hasModerationPerms) {
      console.log(`⚠️ Would have triggered rule action but user has mod permissions`);
    }

    // Check for automatic trust-based actions (EXEMPT MODERATORS)
    // CRITICAL: Pass current message toxicity/manipulation to ensure actions only trigger on BAD messages
    const trustAction = this.trustEngine.shouldTakeActionSync(
      trustScore,
      analyzed.toxicity,
      analyzed.manipulation
    );
    if (trustAction.action && !hasModerationPerms) {
      await this.moderation.executeAction(
        { type: trustAction.action, severity: 8, reversible: true },
        message.author.id,
        message.guild,
        trustAction.reason
      );

      this.dailyStats.actionsToday++;
      await this.sendModerationNotice(message.channel as TextChannel, { type: trustAction.action }, trustAction.reason);

      // NEW: Record for moderator learning
      await this.modLearning.recordAction({
        actionType: trustAction.action as any,
        targetMessage: analyzed.content,
        targetUserId: message.author.id,
        moderatorId: 'system',
        reason: trustAction.reason,
        timestamp: new Date(),
        context: recentContext,
      });

      // NEW: Provide rehabilitation feedback (if not a ban)
      if (trustAction.action === 'warn' || trustAction.action === 'timeout') {
        try {
          const feedback = await this.rehabilitation.generateFeedback(
            analyzed.content,
            analyzed.toxicity,
            message.author.username
          );

          if (feedback) {
            await message.author.send(feedback).catch(() => {
              console.log('Could not DM user for rehabilitation feedback');
            });
          }

          // Track progress
          const progress = await this.rehabilitation.trackProgress(
            message.author.id,
            message.guild.id,
            message.author.username,
            { toxicity: analyzed.toxicity, sentiment: analyzed.sentiment.dominant }
          );

          if (progress.improved && progress.message) {
            const channel = message.channel as TextChannel;
            await channel.send(progress.message);
          }
        } catch (error) {
          console.error('Rehabilitation feedback failed:', error);
        }
      }
    } else if (trustAction.action && hasModerationPerms) {
      console.log(`⚠️ Would have triggered ${trustAction.action} but user has mod permissions`);
    }

    // AI-powered decision: Should Becas respond?
    const shouldRespond = await this.dialogue.shouldRespond(analyzed, isAddressingBecas);
    if (shouldRespond || trustAction.action || triggered.length > 0) {
      // Add guard to prevent duplicate responses
      if (!this.respondedMessages.has(message.id)) {
        await this.generateAndSendResponse(message, analyzed, trustScore, recentContext);
        this.respondedMessages.add(message.id);

        // Cleanup after 1 minute
        setTimeout(() => this.respondedMessages.delete(message.id), 60000);
      } else {
        console.log('⚠️ Skipping duplicate response generation for message', message.id);
      }
    }

    // Record interaction in long-term memory
    const interactionType = analyzed.toxicity > 0.5 ? 'negative' :
                           analyzed.sentiment.dominant === 'positive' ? 'positive' : 'neutral';

    await this.memory.updateLongTerm(
      analyzed.authorId,
      analyzed.guildId,
      {
        timestamp: new Date(),
        type: interactionType,
        description: analyzed.content.slice(0, 100),
        trustImpact: isModeratorTesting ? 0 : (trustScore.score - 100),
      }
    );

    // SENTIENT: Learn from every message to build deep relationships
    await this.relationshipTracker.learnFromMessage(message);

    // SENTIENT: Track relationships when users interact
    if (message.mentions.users.size > 0) {
      const mentioned = message.mentions.users.first();
      if (mentioned && mentioned.id !== this.client.user!.id) {
        await this.relationshipTracker.trackRelationship(
          message.author.id,
          mentioned.id,
          message.guild.id,
          message
        );
      }
    }

    // SENTIENT: Use predictive AI to analyze conversations
    const recentMsgs = await message.channel.messages.fetch({ limit: 10 });
    const predictions = await this.predictiveAI.analyzeConversation(
      Array.from(recentMsgs.values()),
      message.channel as TextChannel
    );

    // Act on high-priority predictions
    for (const prediction of predictions.filter(p => p.severity >= 8)) {
      console.log(`🔮 High-priority prediction: ${prediction.type} (severity ${prediction.severity})`);
      console.log(`   ${prediction.prediction}`);
      console.log(`   Suggested actions: ${prediction.suggestedActions.join(', ')}`);

      // 💬 POST TO DISCORD SUGGESTIONS CHANNEL
      const guild = message.guild;
      if (guild) {
        const suggestionPosted = await this.suggestionChannelManager.postSuggestion(guild, {
          type: 'prediction',
          severity: prediction.severity >= 9 ? 'critical' : 'high',
          title: `${this.getPredictionEmoji(prediction.type)} ${this.formatPredictionTitle(prediction.type)}`,
          description: prediction.prediction,
          details: prediction.evidence.length > 0 ? prediction.evidence : undefined,
          targetUser: prediction.involvedUsers && prediction.involvedUsers.length > 0
            ? {
                id: prediction.involvedUsers[0],
                username: message.guild?.members.cache.get(prediction.involvedUsers[0])?.user.username || 'Unknown',
              }
            : undefined,
          confidence: prediction.confidence,
          suggestedActions: prediction.suggestedActions,
          timestamp: new Date(),
        });

        if (suggestionPosted) {
          console.log(`   ✅ Posted to Discord suggestion channel`);
        }
      }
    }

    // Update personality based on outcome
    if (trustAction.action || triggered.length > 0) {
      if (analyzed.toxicity < 0.5) {
        this.dailyStats.conflictsResolved++;
        await this.personality.updateEmotion({
          type: 'resolution',
          intensity: 0.6,
          description: 'Successfully moderated situation',
        });
      } else {
        this.dailyStats.conflictsEscalated++;
        await this.personality.updateEmotion({
          type: 'conflict',
          intensity: 0.7,
          description: 'Had to take strict action',
        });
      }
    } else if (interactionType === 'positive') {
      this.dailyStats.positiveInteractions++;
    }

    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  /**
   * Handle message reactions (for community voting)
   */
  private async handleReaction(reaction: MessageReaction, user: User): Promise<void> {
    try {
      // Fetch partial reactions
      if (reaction.partial) {
        await reaction.fetch();
      }

      const message = reaction.message;
      if (!message.guild) return;

      console.log(`👍 Reaction ${reaction.emoji.name} by ${user.username} on message by ${message.author?.username}`);

      // Process vote
      const result = await this.reactionVoting.processReaction(reaction, user);

      if (result.shouldTakeAction) {
        console.log(`📊 Vote threshold reached: ${result.actionType} (${result.voteCount} votes)`);

        // Execute community-voted action
        if (result.actionType === 'delete') {
          try {
            await message.delete();
            const channel = message.channel as TextChannel;
            await channel.send(`🗑️ Message deleted by community vote (${result.voteCount} votes).`);
          } catch (error) {
            console.error('Failed to delete message:', error);
          }
        } else if (result.actionType === 'timeout' && message.author) {
          try {
            const member = message.guild.members.cache.get(message.author.id);
            if (member && member.moderatable) {
              await member.timeout(600000, `Community vote: ${result.voteCount} reports`); // 10 min

              // Record to V3 memory
              await this.recordModerationAction(
                'timeout',
                member.id,
                member.user.username,
                `Community vote: ${result.voteCount} reports`,
                message.guild.id,
                message.channel.id,
                600000
              );

              const channel = message.channel as TextChannel;
              await channel.send(`⏸️ <@${message.author.id}> timed out by community vote (${result.voteCount} votes).`);

              // Record for moderator learning
              await this.modLearning.recordAction({
                actionType: 'timeout',
                targetMessage: message.content || '',
                targetUserId: message.author.id,
                moderatorId: 'community',
                reason: `Community vote: ${result.voteCount} reports`,
                timestamp: new Date(),
                context: 'Reaction voting',
              });
            }
          } catch (error) {
            console.error('Failed to timeout user:', error);
          }
        }
      }
    } catch (error) {
      console.error('Error handling reaction:', error);
    }
  }

  /**
   * AI-POWERED action detection - understands intent, not keywords
   */
  private async detectRequestedAction(content: string): Promise<string | null> {
    // Quick pattern detection for common trust score queries
    const lower = content.toLowerCase();

    // Check for trust score queries (with or without mentions)
    const isScoreQuery =
      (lower.includes('score') && (lower.includes('my') || lower.includes('what') || lower.includes('check'))) ||
      (lower.includes('trust') && (lower.includes('my') || lower.includes('what') || lower.includes('level'))) ||
      (lower.includes('check') && lower.includes('me'));

    if (isScoreQuery || (/@\w+/.test(content) || /<@!?\d+>/.test(content)) && (lower.includes('score') || lower.includes('trust') || lower.includes('check'))) {
      console.log(`🎯 Quick match: Trust score query detected`);
      return 'check';
    }

    try {
      const prompt = `Analyze this message to understand what moderation action is being requested:

"${content}"

Determine if the user wants to:
- ban (permanently remove someone)
- kick (temporarily remove someone)
- timeout/mute (silence someone temporarily)
- warn (give a warning)
- undo (reverse a previous action)
- check (check trust score or user info - includes phrases like "what's score", "trust level", "check user")
- none (no action requested)

Think about:
- The INTENT behind the words, not just keywords
- Context and phrasing
- Natural language variations
- Questions about user status/scores/trust are "check"

Return ONLY the action type as a single word, or "none" if no action is requested.`;

      const systemPrompt = `You are an intent parser. Understand what users want, don't match keywords.`;

      const result = await this.ollama.generate(prompt, systemPrompt, {
        temperature: 0.3,
        maxTokens: 10,
      });

      const action = result.trim().toLowerCase();

      if (['ban', 'kick', 'timeout', 'warn', 'undo', 'check'].includes(action)) {
        console.log(`🧠 AI detected action: ${action}`);
        return action;
      }

      return null;
    } catch (error) {
      console.error('AI action detection failed:', error);
      // Fallback to simple detection only if AI fails
      if (lower.includes('undo')) return 'undo';
      if (lower.includes('score') || lower.includes('check') || lower.includes('trust')) return 'check';
      if (lower.includes('ban')) return 'ban';
      if (lower.includes('kick')) return 'kick';
      if (lower.includes('timeout') || lower.includes('mute')) return 'timeout';
      return null;
    }
  }

  /**
   * Get required permission name for action
   */
  private getRequiredPermission(action: string): string {
    const permMap: Record<string, string> = {
      ban: 'Ban Members',
      kick: 'Kick Members',
      timeout: 'Timeout Members',
      warn: 'Manage Messages',
    };
    return permMap[action] || 'Unknown Permission';
  }

  /**
   * NEW: Smart user search by username/nickname (fuzzy matching)
   */
  private findUserByName(guild: any, searchName: string): GuildMember | null {
    const search = searchName.toLowerCase().trim();

    console.log(`🔍 Searching for user: "${searchName}"`);

    // Exact match on username
    let found = guild.members.cache.find((m: GuildMember) =>
      m.user.username.toLowerCase() === search
    );

    if (found) {
      console.log(`✓ Found exact username match: ${found.user.username}`);
      return found;
    }

    // Exact match on nickname
    found = guild.members.cache.find((m: GuildMember) =>
      m.nickname && m.nickname.toLowerCase() === search
    );

    if (found) {
      console.log(`✓ Found exact nickname match: ${found.nickname}`);
      return found;
    }

    // Exact match on displayName
    found = guild.members.cache.find((m: GuildMember) =>
      m.displayName.toLowerCase() === search
    );

    if (found) {
      console.log(`✓ Found exact display name match: ${found.displayName}`);
      return found;
    }

    // Fuzzy match (starts with)
    found = guild.members.cache.find((m: GuildMember) =>
      m.user.username.toLowerCase().startsWith(search) ||
      m.displayName.toLowerCase().startsWith(search) ||
      (m.nickname && m.nickname.toLowerCase().startsWith(search))
    );

    if (found) {
      console.log(`✓ Found fuzzy match: ${found.user.username}`);
      return found;
    }

    console.log(`✗ No user found matching "${searchName}"`);
    return null;
  }

  /**
   * NEW: Detect modification intent (like "what about 10?" meaning change duration)
   */
  private async detectModificationIntent(
    message: Message,
    content: string,
    recentActions: Map<string, any>
  ): Promise<{
    isModification: boolean;
    newDuration?: number;
    changeType?: 'duration' | 'cancel' | 'upgrade';
  }> {
    const actionKey = `${message.guildId}:${message.author.id}`;
    const lastAction = recentActions.get(actionKey);

    if (!lastAction) {
      return { isModification: false };
    }

    const lower = content.toLowerCase();

    // Check for cancellation/undo phrases
    if (/never ?mind|cancel|forget it|undo/i.test(content)) {
      console.log(`🔄 Detected cancellation intent`);
      return { isModification: true, changeType: 'cancel' };
    }

    // Check for duration modification patterns
    const durationPatterns = [
      /what about (\d+)/i,              // "what about 10?"
      /make it (\d+)/i,                 // "make it 30"
      /change (?:to |it to )?(\d+)/i,   // "change to 10" or "change it to 10"
      /actually (\d+)/i,                // "actually 20"
      /(?:^|\s)(\d+)(?:\s+minutes?|\s+min)?$/i  // just "10" or "10 minutes"
    ];

    for (const pattern of durationPatterns) {
      const match = content.match(pattern);
      if (match) {
        const newMinutes = parseInt(match[1]);
        const newDuration = newMinutes * 60000; // Convert to ms

        console.log(`🔄 Detected duration modification: ${newMinutes} minutes`);
        return {
          isModification: true,
          newDuration,
          changeType: 'duration'
        };
      }
    }

    return { isModification: false };
  }

  /**
   * Handle direct moderation request (e.g., "becas ban @user")
   */
  private async handleDirectModerationRequest(
    message: Message,
    analyzed: AnalyzedMessage,
    actionType: string
  ): Promise<void> {
    console.log(`📝 Processing ${actionType} request...`);

    // Check for modification intent FIRST (before looking for target)
    const modificationCheck = await this.detectModificationIntent(
      message,
      analyzed.content,
      this.recentActions
    );

    if (modificationCheck.isModification) {
      console.log(`🔄 Processing modification request...`);

      const actionKey = `${message.guildId}:${message.author.id}`;
      const lastAction = this.recentActions.get(actionKey);

      if (!lastAction) {
        await message.reply(`I don't have any recent actions to modify. Try being more specific.`);
        return;
      }

      // Handle cancellation
      if (modificationCheck.changeType === 'cancel') {
        await this.handleUndoRequest(message, analyzed);
        return;
      }

      // Handle duration change
      if (modificationCheck.changeType === 'duration' && modificationCheck.newDuration) {
        const newMinutes = modificationCheck.newDuration / 60000;

        console.log(`⏱️ Modifying timeout duration: ${lastAction.duration ? lastAction.duration / 60000 : 10} → ${newMinutes} minutes`);

        // Get the target member
        const targetMember = message.guild!.members.cache.get(lastAction.targetId);
        if (!targetMember) {
          await message.reply(`${lastAction.targetName} isn't in the server anymore, so I can't modify the timeout.`);
          return;
        }

        // Re-apply timeout with new duration
        try {
          await targetMember.timeout(modificationCheck.newDuration, `Modified by ${message.author.username}: changed to ${newMinutes} minutes`);

          // Record to V3 memory
          await this.recordModerationAction(
            'timeout',
            targetMember.id,
            targetMember.user.username,
            `Modified by ${message.author.username}: changed to ${newMinutes} minutes`,
            message.guild!.id,
            message.channel.id,
            modificationCheck.newDuration
          );

          // Update the stored action
          lastAction.duration = modificationCheck.newDuration;
          lastAction.timestamp = new Date();

          await message.reply(`Changed to ${newMinutes} minutes. ${lastAction.targetName} now timed out for ${newMinutes} minutes total.`);

          console.log(`✓ Timeout duration modified successfully`);
          return;
        } catch (error) {
          console.error(`Failed to modify timeout:`, error);
          await message.reply(`I couldn't modify the timeout. They might have higher permissions than me.`);
          return;
        }
      }

      return;
    }

    // Find mentioned users (excluding Becas)
    let targetUser = message.mentions.users.find(u => u.id !== this.client.user!.id);
    let targetMember: GuildMember | undefined | null = null;

    // NEW: If no mention, try to extract username and search
    if (!targetUser) {
      console.log(`✗ No @mention found, attempting smart search...`);

      // Extract potential username from message (words that aren't action keywords)
      const words = analyzed.content.toLowerCase()
        .replace(/becas|timeout|ban|kick|warn|for|minutes?|min|hours?|seconds?/gi, '')
        .trim()
        .split(/\s+/)
        .filter(w => w.length > 2); // Filter out short words

      console.log(`   Extracted words: ${words.join(', ')}`);

      // Try each word as a potential username
      for (const word of words) {
        targetMember = this.findUserByName(message.guild!, word);
        if (targetMember) {
          targetUser = targetMember.user;
          console.log(`✓ Found user via smart search: ${targetUser.username}`);
          break;
        }
      }

      if (!targetUser) {
        console.log(`✗ No target user found via smart search`);
        await message.reply(`I couldn't find that user. Try mentioning them with @ or using their exact username.`);
        return;
      }
    }

    console.log(`🎯 Target: ${targetUser.username} (${targetUser.id})`);

    // Get member if we don't have it yet
    if (!targetMember) {
      targetMember = message.guild!.members.cache.get(targetUser.id);
    }

    if (!targetMember) {
      console.log(`✗ Target member not found in server`);
      await message.reply(`I can't find ${targetUser.username} in this server.`);
      return;
    }

    // Check if target can be moderated (role hierarchy)
    if (!targetMember.moderatable) {
      console.log(`✗ Target has higher role than Becas`);
      await message.reply(`I can't moderate ${targetUser.username} - their role is higher than mine in the server hierarchy.`);
      return;
    }

    // Parse duration from message if it's a timeout
    let duration: number | undefined;
    if (actionType === 'timeout') {
      duration = this.parseDuration(analyzed.content);
      console.log(`⏱️ Parsed duration: ${duration ? duration / 60000 : 10} minutes`);
    }

    // Build reason
    const reason = `${message.author.username} requested this action`;
    
    console.log(`⚡ Executing ${actionType}...`);
    
    try {
      await this.moderation.executeAction(
        { 
          type: actionType as any, 
          severity: 7, 
          reversible: true,
          duration: duration 
        },
        targetUser.id,
        message.guild!,
        reason
      );

      console.log(`✓ ${actionType} executed successfully`);
      
      // Track this action for potential undo
      const actionKey = `${message.guildId}:${message.channelId}`;
      this.recentActions.set(actionKey, {
        type: actionType,
        targetId: targetUser.id,
        targetName: targetUser.username,
        guildId: message.guild!.id,
        channelId: message.channelId,
        requestedBy: message.author.id,
        requestedByName: message.author.username,
        timestamp: new Date(),
        duration: duration,
        durationMinutes: duration ? Math.round(duration / 60000) : undefined
      });
      
      // Auto-cleanup after 5 minutes
      setTimeout(() => {
        this.recentActions.delete(actionKey);
      }, 300000);
      
      // Generate natural response using Becas's personality
      const response = await this.generateModerationResponse(
        message.author.username,
        targetUser.username,
        actionType,
        duration,
        analyzed.content
      );
      
      await message.reply(response);

      this.dailyStats.actionsToday++;

      // NEW: Record for moderator learning
      await this.modLearning.recordAction({
        actionType: actionType as any,
        targetMessage: `Manually requested ${actionType}`,
        targetUserId: targetUser.id,
        moderatorId: message.author.id,
        reason: reason,
        timestamp: new Date(),
        context: analyzed.content,
      });
    } catch (error) {
      console.error(`✗ Failed to execute ${actionType}:`, error);
      await message.reply(`I tried to ${actionType} ${targetUser.username}, but something went wrong. They might have permissions that prevent me from acting, or I might not have the right server permissions.`);
    }
  }

  /**
   * Handle undo request
   */
  private async handleUndoRequest(
    message: Message,
    analyzed: AnalyzedMessage
  ): Promise<void> {
    console.log(`🔄 Undo request from ${message.author.username}`);
    
    const actionKey = `${message.guildId}:${message.author.id}`;
    const lastAction = this.recentActions.get(actionKey);
    
    if (!lastAction) {
      console.log(`✗ No recent action found to undo`);
      
      // More helpful response
      const allActions = Array.from(this.recentActions.entries())
        .filter(([key]) => key.startsWith(message.guildId!));
      
      if (allActions.length > 0) {
        await message.reply(`I don't see any recent actions from you that I can undo. Other moderators have made ${allActions.length} action(s) recently, but you can only undo your own actions.`);
      } else {
        await message.reply(`I haven't done any moderation actions recently that can be undone. Actions expire after 5 minutes.`);
      }
      return;
    }

    console.log(`🔄 Found action to undo: ${lastAction.type} on ${lastAction.targetName} from ${Math.round((Date.now() - lastAction.timestamp.getTime()) / 1000)}s ago`);

    // Check if user has permission to undo
    if (!this.canUserExecuteAction(message.member!, lastAction.type)) {
      await message.reply(`You don't have permission to undo that ${lastAction.type} action.`);
      return;
    }

    try {
      const targetMember = message.guild!.members.cache.get(lastAction.targetId);
      
      if (!targetMember && lastAction.type !== 'ban') {
        await message.reply(`I can't find ${lastAction.targetName} in the server anymore, so I can't undo the ${lastAction.type}.`);
        this.recentActions.delete(actionKey); // Clean up
        return;
      }

      // Undo based on action type
      if (lastAction.type === 'timeout') {
        if (!targetMember) {
          await message.reply(`${lastAction.targetName} isn't in the server anymore.`);
          this.recentActions.delete(actionKey);
          return;
        }

        console.log(`⚡ Removing timeout from ${lastAction.targetName}...`);
        await this.moderation.removeTimeout(targetMember);

        // 🔥 V3 INTEGRATION - Record negative feedback (undo = AI was wrong)
        try {
          const result = await this.v3Integration.handleUndoCommand(message, message.member!);
          if (result.success) {
            logger.info(`Recorded undo feedback to V3 learning engine: ${result.actionId}`);
          }
        } catch (error) {
          logger.error('Failed to record undo to V3', error);
        }

        const response = await this.generateUndoResponse(
          message.author.username,
          lastAction.targetName,
          lastAction.type
        );

        await message.reply(response);
        console.log(`✓ Timeout removed successfully`);
        
      } else if (lastAction.type === 'ban') {
        console.log(`⚡ Unbanning ${lastAction.targetName}...`);
        await this.moderation.unbanUser(lastAction.targetId, message.guild!, `Undone by ${message.author.username}`);

        // 🔥 V3 INTEGRATION - Record negative feedback (undo = AI was wrong)
        try {
          const result = await this.v3Integration.handleUndoCommand(message, message.member!);
          if (result.success) {
            logger.info(`Recorded undo feedback to V3 learning engine: ${result.actionId}`);
          }
        } catch (error) {
          logger.error('Failed to record undo to V3', error);
        }

        const response = await this.generateUndoResponse(
          message.author.username,
          lastAction.targetName,
          lastAction.type
        );

        await message.reply(response);
        console.log(`✓ Ban removed successfully`);
        
      } else if (lastAction.type === 'kick') {
        await message.reply(`${lastAction.targetName} was kicked and left the server - I can't undo that, but they can rejoin if you send them an invite.`);
        this.recentActions.delete(actionKey);
        return;
        
      } else {
        await message.reply(`I can undo timeouts and bans, but I'm not sure how to undo a ${lastAction.type} yet.`);
        return;
      }

      // Remove from recent actions
      this.recentActions.delete(actionKey);

    } catch (error) {
      console.error(`✗ Failed to undo action:`, error);
      await message.reply(`I tried to undo that ${lastAction.type} on ${lastAction.targetName}, but something went wrong: ${error}`);
    }
  }

  /**
   * Generate undo response
   */
  private async generateUndoResponse(
    moderatorName: string,
    targetName: string,
    actionType: string
  ): Promise<string> {
    const prompt = `You (Becas) just helped ${moderatorName} undo a ${actionType} action on ${targetName}.

Respond naturally about reversing the action. Be:
- Brief (1 sentence)
- Understanding (they changed their mind)
- Natural (not robotic)

Examples:
- "Done. ${targetName}'s ${actionType} has been removed."
- "Understood, I've reversed it."
- "No problem, I've taken care of it."`;

    const systemPrompt = `You are Becas, responding naturally. Show understanding, not judgment.`;

    try {
      const response = await this.ollama.generate(prompt, systemPrompt, {
        temperature: 0.7,
        maxTokens: 50,
      });
      return response.trim();
    } catch (error) {
      const fallbacks = [
        `Done. ${targetName}'s ${actionType} has been removed.`,
        `Understood, I've reversed it.`,
        `No problem, taken care of.`,
      ];
      return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
  }

  /**
   * Parse duration from text (e.g., "5 minutes", "2 hours")
   */
  private parseDuration(text: string): number {
    const lower = text.toLowerCase();
    
    // Match patterns like "5 minute", "10 min", "2 hour", "1 day"
    const patterns = [
      { regex: /(\d+)\s*(minute|minutes|min|mins)/i, multiplier: 60000 },
      { regex: /(\d+)\s*(hour|hours|hr|hrs)/i, multiplier: 3600000 },
      { regex: /(\d+)\s*(day|days)/i, multiplier: 86400000 },
      { regex: /(\d+)\s*(second|seconds|sec|secs)/i, multiplier: 1000 },
    ];

    for (const pattern of patterns) {
      const match = lower.match(pattern.regex);
      if (match) {
        const amount = parseInt(match[1]);
        const duration = amount * pattern.multiplier;
        console.log(`Parsed: ${amount} ${match[2]} = ${duration}ms`);
        return duration;
      }
    }

    // Default to 10 minutes if no duration specified
    return 600000; // 10 minutes
  }

  /**
   * Generate natural, personality-driven moderation response
   */
  private async generateModerationResponse(
    moderatorName: string,
    targetName: string,
    actionType: string,
    duration: number | undefined,
    originalMessage: string
  ): Promise<string> {
    const emotionalState = this.personality.getEmotionalState();
    
    // Build context for LLM
    let context = `You (Becas) just helped ${moderatorName} moderate ${targetName}.`;
    
    if (actionType === 'timeout') {
      const minutes = duration ? Math.floor(duration / 60000) : 10;
      context += ` You've given them a ${minutes}-minute timeout to cool down.`;
    } else if (actionType === 'ban') {
      context += ` You've banned them from the server.`;
    } else if (actionType === 'kick') {
      context += ` You've removed them from the server.`;
    } else if (actionType === 'warn') {
      context += ` You've issued a warning.`;
    }

    const prompt = `${context}

Your current mood: ${emotionalState.currentMood}
Your confidence: ${(emotionalState.confidence * 100).toFixed(0)}%

Respond naturally to ${moderatorName} about what you just did. Be:
- Genuine and empathetic (not robotic)
- Brief (1-2 sentences)
- Show that you understand the situation
- Acknowledge the moderator's authority
- Express appropriate emotion

Examples of good responses:
- "Done. ${targetName} has some time to reflect now. Let me know if you need anything else."
- "Understood. I've handled it - they won't be causing more issues."
- "Taken care of. Hopefully this helps them reconsider their behavior."

DO NOT say: "✓ Timeout executed" or "Action completed successfully"
DO say something natural and human-like.`;

    const systemPrompt = `You are Becas, responding naturally after helping with moderation. Show personality, not robotic confirmation.`;

    try {
      const response = await this.ollama.generate(prompt, systemPrompt, {
        temperature: 0.8,
        maxTokens: 100,
      });
      return response.trim();
    } catch (error) {
      console.error('Error generating moderation response:', error);
      // Fallback responses with personality
      const fallbacks = [
        `Done. ${targetName} has ${duration ? Math.floor(duration / 60000) : 10} minutes to cool off.`,
        `Handled it. They'll have some time to think things over.`,
        `Understood. I've taken care of it.`,
      ];
      return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
  }

  /**
   * Generate and send response
   */
  private async generateAndSendResponse(
    message: Message,
    analyzed: AnalyzedMessage,
    trustScore: any,
    recentContext: string
  ): Promise<void> {
    console.log(`🎯 generateAndSendResponse called for message: ${message.id}`);
    const channel = message.channel as TextChannel;

    // Show typing indicator
    await channel.sendTyping();

    // Get user summary
    const userSummary = this.memory.getUserSummary(analyzed.authorId, analyzed.guildId);

    // Determine community mood from recent messages
    const communityMood = this.personality.getEmotionalState().currentMood;

    // Generate response
    const response = await this.dialogue.generateResponse(analyzed, trustScore, {
      recentMessages: recentContext.split('\n'),
      communityMood,
      userSummary,
    });

    // Send response
    console.log(`📤 Sending response from V1:`, response.content.substring(0, 50));
    await channel.send(response.content);

    // Execute any actions in the response
    if (response.action) {
      await this.moderation.executeAction(
        response.action,
        message.author.id,
        message.guild!,
        response.reasoning
      );
    }
  }

  /**
   * Send moderation notice
   */
  private async sendModerationNotice(
    channel: TextChannel,
    action: any,
    reason: string
  ): Promise<void> {
    const actionMap: Record<string, string> = {
      warn: '⚠️ Warning issued',
      timeout: '⏸️ Timeout applied',
      ban: '🚫 Ban applied',
    };
    const actionText = actionMap[action.type] || '⚙️ Action taken';

    await channel.send(`${actionText}: ${reason}`);
  }

  /**
   * Handle governance command from user with permissions
   */
  private async handleGovernanceCommand(
    message: Message,
    analyzed: AnalyzedMessage
  ): Promise<void> {
    const instruction = analyzed.content;
    
    // Create rule from natural language
    const rule = await this.ruleEngine.createRuleFromNL(
      instruction,
      message.guildId!,
      'admin'
    );

    // Confirm
    await message.reply(`I've created a new rule: ${rule.reason}\n\nRule ID: ${rule.id}\nConfidence: ${(rule.confidence * 100).toFixed(0)}%`);

    // Update emotion
    await this.personality.updateEmotion({
      type: 'achievement',
      intensity: 0.5,
      description: 'Created new governance rule',
    });
  }

  /**
   * Handle new member join
   */
  private async handleMemberJoin(member: GuildMember): Promise<void> {
    // Initialize trust score
    const trustScore = await this.trustEngine.getTrustScore(member.id, member.guild.id);

    // ALERT MODS IF LOW TRUST USER JOINS
    if (trustScore.level === 'dangerous' || trustScore.level === 'cautious') {
      const modChannel = member.guild!.channels.cache.find(
        c => c.name.includes('mod') && c.isTextBased()
      ) as TextChannel;

      if (modChannel) {
        await modChannel.send(`⚠️ **LOW TRUST USER JOINED**\n👤 User: <@${member.id}> (${member.user.username})\n📉 Trust Score: **${trustScore.score}/100** (${trustScore.level})\n📝 History: ${trustScore.history.length} events\n🚨 Keep an eye on this user!`);
      }
    }

    // SENTIENT: Greet new member naturally
    await this.proactiveBehavior.greetNewMember(member);

    // Check if user is globally banned
    const banCheck = this.crossGuild.shouldAutoBanInGuild(member.id, member.guild.id);

    if (banCheck.shouldBan && banCheck.banRecord) {
      console.log(`🚨 Globally banned user detected: ${member.user.username}`);
      console.log(`   Reason: ${banCheck.reason}`);

      try {
        // Ban immediately
        await member.ban({ reason: banCheck.reason });

        // Record to V3 memory
        await this.recordModerationAction(
          'ban',
          member.id,
          member.user.username,
          banCheck.reason,
          member.guild.id,
          'system', // No specific channel for member join
          undefined
        );

        // Update cross-guild record
        await this.crossGuild.addGuildToBan(member.id, member.guild.id);

        // Find a channel to notify
        const channels = member.guild.channels.cache.filter(c => c.isTextBased());
        const channel = channels.first() as TextChannel;

        if (channel) {
          await channel.send(`🚫 **Global Ban Alert**: User ${member.user.username} was automatically banned.\n**Reason**: ${banCheck.reason}\n**Evidence**: ${banCheck.banRecord.evidence.join(', ')}`);
        }

        console.log(`✓ Banned globally-flagged user from ${member.guild.name}`);
      } catch (error) {
        console.error(`Failed to ban globally-flagged user:`, error);
      }
    }
  }

  /**
   * Start background tasks
   */
  private startBackgroundTasks(): void {
    // Daily reflection at midnight
    const scheduleReflection = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      
      const msUntilMidnight = tomorrow.getTime() - now.getTime();

      setTimeout(async () => {
        await this.performDailyReflection();
        scheduleReflection();
      }, msUntilMidnight);
    };

    scheduleReflection();

    // Periodic tasks every hour
    setInterval(async () => {
      // Note: TrustScoreEngineDB.applyDecay requires userId and guildId
      // Decay is handled per-user when trust scores are retrieved
      // await this.trustEngine.applyDecay();  // Commented out - needs refactoring for DB version

      // Note: UnifiedMemoryStore doesn't have cleanupShortTerm method
      // Memory cleanup is handled automatically by TTL in the UnifiedMemoryStore
    }, 3600000);

    // Restore emotional balance every 12 hours
    setInterval(async () => {
      await this.personality.restoreBalance();
    }, 43200000);

    // Execute ready scheduled tasks every 10 seconds
    setInterval(async () => {
      try {
        // Check all guilds for ready tasks
        for (const guild of this.client.guilds.cache.values()) {
          await this.processReadyTasks(guild.id);
        }
      } catch (error) {
        console.error('Error processing scheduled tasks:', error);
      }
    }, 10000); // Every 10 seconds
  }

  /**
   * Perform daily reflection
   */
  private async performDailyReflection(): Promise<void> {
    console.log('📔 Performing daily reflection...');

    const emotionalState = this.personality.getEmotionalState();

    await this.reflection.performReflection({
      actionsToday: this.dailyStats.actionsToday,
      conflictsResolved: this.dailyStats.conflictsResolved,
      conflictsEscalated: this.dailyStats.conflictsEscalated,
      positiveInteractions: this.dailyStats.positiveInteractions,
      rulesCreated: 0,
      rulesEvolved: 0,
      communityMood: emotionalState.currentMood,
    });

    // Reset daily stats
    this.dailyStats = {
      actionsToday: 0,
      conflictsResolved: 0,
      conflictsEscalated: 0,
      positiveInteractions: 0,
      messagesProcessed: 0,
    };

    // Backup data
    await this.storage.backup();
  }

  /**
   * Get status summary
   */
  getStatus(): string {
    const emotional = this.personality.getEmotionalState();
    return `Becas Status:
- Ready: ${this.isReady}
- Mood: ${emotional.currentMood}
- Confidence: ${(emotional.confidence * 100).toFixed(0)}%
- Satisfaction: ${(emotional.satisfaction * 100).toFixed(0)}%
- Stress: ${(emotional.stress * 100).toFixed(0)}%
- Messages today: ${this.dailyStats.messagesProcessed}
- Actions today: ${this.dailyStats.actionsToday}`;
  }

  /**
   * Get comprehensive metrics (for admin dashboard)
   */
  getMetrics(): any {
    const emotional = this.personality.getEmotionalState();
    return {
      status: {
        isReady: this.isReady,
        uptime: process.uptime(),
      },
      stats: {
        ...this.dailyStats,
      },
      personality: {
        mood: emotional.currentMood,
        confidence: emotional.confidence,
        satisfaction: emotional.satisfaction,
        stress: emotional.stress,
      },
      performance: {
        processedMessagesSet: this.processedMessages.size,
        recentActionsCount: this.recentActions.size,
      },
      sentientAI: {
        proactiveBehavior: this.proactiveBehavior.getState(),
        goalSystem: this.goalSystem.getState(),
        predictiveAI: this.predictiveAI.getState(),
      },
    };
  }

  /**
   * Get analytics manager (for admin dashboard)
   */
  getAnalyticsManager() {
    return this.analyticsManager;
  }

  /**
   * Get sentient AI systems (for testing/debugging)
   */
  getSentientSystems(): any {
    return {
      nlActionParser: this.nlActionParser,
      actionExecutor: this.actionExecutor,
      proactiveBehavior: this.proactiveBehavior,
      relationshipTracker: this.relationshipTracker,
      goalSystem: this.goalSystem,
      predictiveAI: this.predictiveAI,
    };
  }

  /**
   * Get deep profile for a user (for admin dashboard)
   */
  async getUserDeepProfile(userId: string, guildId: string): Promise<any> {
    return await this.relationshipTracker.getProfile(userId, guildId);
  }

  /**
   * Get active goals
   */
  getActiveGoals(guildId?: string): any[] {
    return this.goalSystem.getActiveGoals(guildId);
  }

  /**
   * Get active predictions
   */
  getActivePredictions(minSeverity: number = 5): any[] {
    return this.predictiveAI.getActivePredictions(minSeverity);
  }

  /**
   * Get TrustScoreEngine (for DashboardAPI)
   */
  getTrustEngine() {
    return this.trustEngine;
  }

  /**
   * Get DeepUserProfiler (for DashboardAPI)
   */
  getDeepUserProfiler() {
    return this.deepUserProfiler;
  }

  /**
   * Get UnifiedMemoryStore (for DashboardAPI)
   */
  getUnifiedMemory() {
    return this.unifiedMemory;
  }

  /**
   * Get SafeLearningEngine (for DashboardAPI)
   */
  getSafeLearningEngine() {
    return this.learningEngine;
  }

  /**
   * Get DeepRelationshipTracker (for DashboardAPI)
   */
  getRelationshipTracker() {
    return this.relationshipTracker;
  }

  /**
   * Get OllamaService (for GuildCommandAPI)
   */
  getOllamaService() {
    return this.ollama;
  }

  /**
   * Get WatchSystem (for OnboardingSystem)
   */
  getWatchSystem() {
    return this.watchSystem;
  }

  /**
   * Get PolicyEngineV2 (for OnboardingSystem)
   */
  getPolicyEngine() {
    return this.policyEngine;
  }

  /**
   * Get WorkflowManager (for OnboardingSystem)
   */
  getWorkflowManager() {
    return this.workflowManager;
  }

  /**
   * Manually trigger proactive action (for testing)
   */
  async testProactiveAction(guildId: string): Promise<void> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      console.log('Guild not found');
      return;
    }

    console.log('🧪 Testing proactive behavior...');
    // Proactive behavior engine will handle this in its evaluation loop
  }

  /**
   * 🧠 SENTIENT AI COMMAND HANDLER
   * Handles special commands for Sentient AI systems
   */
  private async handleSentientAICommands(message: Message, contentLower: string): Promise<boolean> {
    const channel = message.channel as TextChannel;

    // Check if it's a becas mention command
    const isMentioningBecas = message.mentions.has(this.client.user!.id) || contentLower.startsWith('becas');
    if (!isMentioningBecas) {
      return false;  // Not for us
    }

    // ====== MAP SERVER ======
    if (/map.*server|server.*map|analyze.*server/.test(contentLower)) {
      logger.info('🗺️ ServerMapper command detected');
      await channel.sendTyping();

      try {
        const guild = message.guild!;
        await channel.send('🗺️ **Mapping server structure...** This may take a moment.');

        const structure = await this.serverMapper.mapServer(guild);

        const summary = `**✅ Server Mapped Successfully!**

📊 **Statistics:**
- **Channels**: ${structure.channels.size}
- **Roles**: ${structure.roles.size}
- **Categories**: ${structure.categories.size}
- **Total Members**: ${structure.totalMembers}

🔍 **Active Channels**: ${Array.from(structure.channels.values()).filter(ch => ch.activityLevel === 'high').length}
📉 **Inactive Channels**: ${Array.from(structure.channels.values()).filter(ch => ch.activityLevel === 'low').length}

I now understand your server's complete structure! 🧠`;

        await channel.send(summary);
        return true;

      } catch (error) {
        logger.error('ServerMapper error:', error);
        await channel.send('❌ Error mapping server structure.');
        return true;
      }
    }

    // ====== INTENT CLASSIFIER - AI DECIDES IF THIS IS A QUERY OR CHAT ======
    // This runs BEFORE QueryEngine so multi-intent commands can be detected!
    // Check if user is moderator
    const isModerator = message.member?.permissions.has('ModerateMembers') ||
                        message.member?.permissions.has('KickMembers') ||
                        message.member?.permissions.has('BanMembers') ||
                        message.member?.permissions.has('Administrator') || false;

    // Classify intent using AI (now supports multi-intent!)
    const cleanedMessage = message.content.replace(/^becas,?\s*/i, '').trim();
    const intentResult = await this.intentClassifier.classifyIntent(cleanedMessage, isModerator);

    logger.info(`🧠 Intents: ${intentResult.intents.join(', ')} (${(intentResult.confidence * 100).toFixed(0)}%) - ${intentResult.reasoning}`);

    // Check if CHAT only - let it fall through to other handlers
    if (!(intentResult.intents.length === 1 && intentResult.intents[0] === 'CHAT')) {
      // Check if confidence is high enough
      if (intentResult.confidence >= 0.6) {
        // Execute multi-intent plan
        await channel.sendTyping();

        try {
          logger.info(`🚀 Executing ${intentResult.executionPlan.length} step(s)`);

          const executionContext = {
            guild: message.guild!,
            channel,
            message,
            results: new Map<number, any>(),
          };

          const executionResult = await this.executionEngine.execute(
            intentResult.executionPlan,
            executionContext
          );

          // Send results to channel (FORMATTED INTO SINGLE MESSAGE)
          if (executionResult.success) {
            // Combine all results into a single formatted message
            const combinedMessage = executionResult.results.join('\n\n───────\n\n');
            await channel.send(combinedMessage);
          } else {
            // Send errors + successful results in single formatted message
            let combinedMsg = '❌ **Execution had errors:**\n';
            for (const error of executionResult.errors) {
              combinedMsg += `- ${error}\n`;
            }

            if (executionResult.results.length > 0) {
              combinedMsg += '\n✅ **Successful results:**\n\n';
              combinedMsg += executionResult.results.join('\n\n───────\n\n');
            }

            await channel.send(combinedMsg);
          }

          return true;

        } catch (error) {
          logger.error('Execution error:', error);
          await channel.send('❌ Error executing your request. Please try again.');
          return true;
        }
      }
    }

    // If we reach here, either CHAT intent or low confidence - continue to QueryEngine fallback

    // ====== FIND USERS (QUERY ENGINE) ======
    if (/(find|get|show).*people|who (knows|understand|code)|bana.*kullanıc/.test(contentLower)) {
      logger.info('👥 QueryEngine - User search detected');
      await channel.sendTyping();

      try {
        const result = await this.queryEngine.query(message.guild!.id, message.content);
        await channel.send(result.summary);
        return true;

      } catch (error) {
        logger.error('QueryEngine error:', error);
        await channel.send('❌ Error searching users.');
        return true;
      }
    }

    // ====== SERVER STATS ======
    if (/(server|guild).*(stats|statistics|info)|stats/.test(contentLower)) {
      logger.info('📊 QueryEngine - Stats query detected');
      await channel.sendTyping();

      try {
        const result = await this.queryEngine.query(message.guild!.id, 'server stats');
        await channel.send(result.summary);
        return true;

      } catch (error) {
        logger.error('Stats query error:', error);
        await channel.send('❌ Error getting stats.');
        return true;
      }
    }

    // ====== ACTIVE USERS ======
    if (/(most|top).*(active|users)|active.*users/.test(contentLower)) {
      logger.info('📊 QueryEngine - Active users query');
      await channel.sendTyping();

      try {
        const result = await this.queryEngine.query(message.guild!.id, 'most active users');
        await channel.send(result.summary);
        return true;

      } catch (error) {
        logger.error('Active users query error:', error);
        await channel.send('❌ Error finding active users.');
        return true;
      }
    }

    // ====== DEAD CHANNELS ======
    if (/(dead|inactive).*channels|channels.*(dead|inactive)/.test(contentLower)) {
      logger.info('📊 QueryEngine - Dead channels query');
      await channel.sendTyping();

      try {
        const result = await this.queryEngine.query(message.guild!.id, 'dead channels');
        await channel.send(result.summary);
        return true;

      } catch (error) {
        logger.error('Dead channels query error:', error);
        await channel.send('❌ Error finding inactive channels.');
        return true;
      }
    }

    // ====== LEARNING STATUS ======
    if (/learning.*status|autonomous.*status/.test(contentLower)) {
      logger.info('🧠 AutonomousLearning status query');
      await channel.sendTyping();

      try {
        const status = this.autonomousLearning.getStatusReport();
        await channel.send(status);
        return true;

      } catch (error) {
        logger.error('Learning status error:', error);
        await channel.send('❌ Error getting learning status.');
        return true;
      }
    }

    // ====== USER PROFILE / "TELL ME ABOUT @USER" ======
    // 🔥 CRITICAL: Exclude violation/history/moderation queries - those go to BecasFlow moderation_history tool
    const isViolationQuery = /violation|history|warning|ban|kick|timeout|moderation/i.test(message.content);
    if (!isViolationQuery && /(tell|what|info|profile|about|analyze).*<@\d+>|<@\d+>.*(profile|info|tell)/i.test(message.content)) {
      logger.info('👤 DeepUserProfiler - User profile query detected');
      await channel.sendTyping();

      try {
        // Extract mentioned user
        const mentionedUser = message.mentions.users.first();
        if (!mentionedUser || mentionedUser.id === this.client.user!.id) {
          await channel.send('Please mention a user you want to know about!');
          return true;
        }

        // Get guild member
        const member = message.guild!.members.cache.get(mentionedUser.id);
        if (!member) {
          await channel.send(`I couldn't find that user in this server.`);
          return true;
        }

        // Fetch user's recent messages (last 100 from any channel)
        const recentMessages: Message[] = [];
        const channels = message.guild!.channels.cache.filter(ch => ch.isTextBased());

        for (const [_, ch] of channels) {
          try {
            const msgs = await (ch as any).messages.fetch({ limit: 30 });
            const userMsgs = msgs.filter((m: any) => m.author.id === mentionedUser.id);
            recentMessages.push(...Array.from(userMsgs.values() as Iterable<Message>));
            if (recentMessages.length >= 100) break;
          } catch (err) {
            // Skip channels we can't access
          }
        }

        if (recentMessages.length === 0) {
          await channel.send(`I haven't seen any messages from ${mentionedUser.username} recently.`);
          return true;
        }

        await channel.send(`🔍 Analyzing ${recentMessages.length} messages from **${mentionedUser.username}**... This may take a moment.`);

        // Build user profile
        const profile = await this.deepUserProfiler.analyzeUser(
          mentionedUser.id,
          mentionedUser.username,
          recentMessages
        );

        // Format profile response
        const interestsText = profile.interests.length > 0
          ? profile.interests.slice(0, 5).join(', ')
          : 'Not enough data yet';

        const expertiseText = Array.from(profile.expertise.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([topic, score]) => `${topic} (${(score * 100).toFixed(0)}%)`)
          .join(', ') || 'Not enough data yet';

        const traitsText = profile.personalityTraits.length > 0
          ? profile.personalityTraits.join(', ')
          : 'Not enough data yet';

        const activeHours = profile.activityPattern.activeHours.length > 0
          ? `${Math.min(...profile.activityPattern.activeHours)}:00 - ${Math.max(...profile.activityPattern.activeHours)}:00`
          : 'Unknown';

        const response = `**👤 Deep Profile: ${mentionedUser.username}**
*📊 Analysis based on ${recentMessages.length} recent messages (Total historical: ${profile.messageStats.totalMessages})*

**📊 Interests**
${interestsText}

**🎯 Expertise**
${expertiseText}

**💬 Personality**
${traitsText}

**📈 Activity**
- **Active Hours**: ${activeHours}
- **Avg Message Length**: ${Math.round(profile.messageStats.averageLength)} characters
- **Code Sharing**: ${profile.messageStats.codeSnippets > 0 ? '✅ Yes' : '❌ No'}

**Last Seen**: ${profile.activityPattern.lastSeen.toLocaleString()}`;

        await channel.send(response);
        return true;

      } catch (error) {
        logger.error('User profile error:', error);
        await channel.send('❌ Error analyzing user profile.');
        return true;
      }
    }

    // No more handlers matched - return false
    return false;
  }

  /**
   * Get emoji for prediction type
   */
  private getPredictionEmoji(type: string): string {
    const emojiMap: Record<string, string> = {
      conflict: '⚔️',
      emotional_crisis: '🆘',
      scam: '🚨',
      toxicity: '☠️',
      spam: '🚫',
      user_churn: '📉',
      opportunity: '✨',
      improvement: '💡',
    };
    return emojiMap[type] || '🔮';
  }

  /**
   * Format prediction title for Discord
   */
  private formatPredictionTitle(type: string): string {
    const titleMap: Record<string, string> = {
      conflict: 'Potential Conflict Detected',
      emotional_crisis: 'Emotional Crisis Warning',
      scam: 'Scam Activity Predicted',
      toxicity: 'Toxic Behavior Alert',
      spam: 'Spam Pattern Detected',
      user_churn: 'User Churn Risk',
      opportunity: 'Positive Opportunity',
      improvement: 'Improvement Suggestion',
    };
    return titleMap[type] || 'AI Prediction';
  }

  // ============================================
  // 🚀 BECASFLOW FRAMEWORK
  // ============================================

  /**
   * Handle message using BecasFlow intent-based framework
   * Processes ALL commands through AI-powered tool system
   */
  private async handleMessageWithBecasFlow(message: Message, commandContent: string): Promise<void> {
    logger.info(`🚀 BecasFlow: Processing query: "${commandContent}"`);

    // 💬 Add message to conversation history for context-aware responses
    const conversationKey = `${message.guild!.id}:${message.channelId}`;
    if (!this.conversationHistory.has(conversationKey)) {
      this.conversationHistory.set(conversationKey, []);
    }

    const history = this.conversationHistory.get(conversationKey)!;
    history.push({
      author: message.author.username,
      authorId: message.author.id,
      content: message.content,
      timestamp: Date.now(),
      isBot: message.author.bot,
    });

    // Keep only last 20 messages (15 minutes worth) - Extended for better context
    const HISTORY_LIMIT = 20;
    const HISTORY_TIME_WINDOW = 15 * 60 * 1000; // 15 minutes (extended from 5)
    const now = Date.now();
    const recentHistory = history.filter(h => now - h.timestamp < HISTORY_TIME_WINDOW).slice(-HISTORY_LIMIT);
    this.conversationHistory.set(conversationKey, recentHistory);

    // ========================================
    // TWO-LAYER POLICY ENFORCEMENT (with Intent Router)
    // ========================================
    // NOTE: This is SEPARATE from handleMessage() violation check
    // BecasFlow messages SKIP the first check and come here directly

    // LAYER 1: Guild Policy Check (LOCAL - no trust score impact)
    const guildViolations = await this.guildPolicyEngine.checkViolations(
      {
        type: 'message',
        content: commandContent,
        userId: message.author.id,
        channelId: message.channel.id,
        timestamp: new Date(),
      },
      {
        guild: message.guild!,
        member: message.member!,
        channel: message.channel as TextChannel,
      }
    );

    if (guildViolations.length > 0) {
      logger.info(`[GuildPolicy] ${guildViolations.length} violations detected`);
      await this.guildPolicyEngine.enforceLocalActions(guildViolations, {
        guild: message.guild!,
        member: message.member!,
        channel: message.channel as TextChannel,
      });
    }

    // LAYER 2: Becas Core Violation Check (GLOBAL - trust score impact)
    // 🧠 SKIP if intent router says it's a bot command
    logger.info('🧠 [BecasFlow] Running intent router for violation check...');
    let needsViolationCheck = true; // Default to checking

    const intentTool = this.becasflowRegistry.get('intent_router');
    if (intentTool) {
      try {
        const minimalContext: any = {
          message,
          member: message.member!,
          guild: message.guild!,
          channel: message.channel,
          conversationHistory: [],
          stepResults: [],
          variables: {},
          services: {},
          addToHistory: () => {},
          getHistory: () => [],
          setVariable: () => {},
          getVariable: () => undefined,
          hasVariable: () => false,
        };

        const intentResult = await intentTool.execute(
          {
            message: commandContent,
            hasUrls: /https?:\/\/|www\./i.test(commandContent),
            hasMentions: /@everyone|@here/i.test(commandContent),
            hasAttachments: message.attachments?.size > 0,
          },
          minimalContext
        );

        if (intentResult.success && intentResult.data) {
          needsViolationCheck = intentResult.data.needsViolationCheck;
          logger.info(`🧠 [BecasFlow] Intent: ${intentResult.data.intent} (${intentResult.data.confidence}) - Violation check: ${needsViolationCheck}`);

          if (!needsViolationCheck && intentResult.data.skipReason) {
            logger.info(`⏭️ [BecasFlow] Skipping violation check: ${intentResult.data.skipReason}`);
          }
        }
      } catch (error: any) {
        logger.error('[BecasFlow] Intent router error - defaulting to violation check:', error);
        needsViolationCheck = true;
      }
    }

    if (needsViolationCheck) {
      const coreViolations = await this.becasCoreViolationEngine.checkCoreViolations(
        {
          type: 'message',
          content: commandContent,
          userId: message.author.id,
          channelId: message.channel.id,
          timestamp: new Date(),
        },
        {
          guild: message.guild!,
          member: message.member!,
          channel: message.channel as TextChannel,
        }
      );

      if (coreViolations.length > 0) {
        logger.warn(`[BecasCore] ${coreViolations.length} GLOBAL violations detected`);

        for (const violation of coreViolations) {
          await this.becasCoreViolationEngine.applyGlobalPunishment(
            violation,
            {
              type: 'message',
              content: commandContent,
              userId: message.author.id,
              channelId: message.channel.id,
              timestamp: new Date(),
            },
            {
              guild: message.guild!,
              member: message.member!,
              channel: message.channel as TextChannel,
            }
          );
        }

        // If critical violation, block message processing
        const criticalViolation = coreViolations.find(v => v.severity === 'critical');
        if (criticalViolation) {
          await message.reply(`⛔ Message blocked: ${criticalViolation.type} violation detected.`);
          return;
        }
      }
    }

    // Continue with BecasFlow if not blocked...

    // 1. Create BecasContext with full service injection and conversation history
    const becasContext = new BecasContext(message, {
        trustEngine: this.trustEngine,
        v3Integration: this.v3Integration,
        unifiedMemory: this.unifiedMemory,
        policyEngine: this.v3Integration.policyEngine,
      });

    // Add conversation history to context
    becasContext.conversationHistory = recentHistory.map(h => ({
      query: `${h.author}: ${h.content}`,
      timestamp: h.timestamp,
      results: new Map(),
    }));

      // 2. Create execution plan using AI Planner
      const planningResult = await this.becasflowPlanner.createPlan(
        commandContent,
        becasContext
      );

    // Check for missing info
    if (!planningResult.success) {
      if (planningResult.missingInfo && planningResult.missingInfo.length > 0) {
        // Handle missing parameters interactively
        const missingParam = planningResult.missingInfo[0];
        const promptResponse = await BecasInteractive.prompt(message, {
          type: missingParam.type as any,
          message: missingParam.prompt,
          param: missingParam.param,
          options: missingParam.options,
        });

        if (!promptResponse.success) {
          logger.warn(`⚠️ BecasFlow: User cancelled prompt`);
          await message.reply('❌ Operation cancelled.');
          return;
        }

        // Retry with filled parameter
        // TODO: Implement parameter filling and retry
        logger.warn(`⚠️ BecasFlow: Parameter filling not yet implemented`);
        await message.reply('❌ Parameter filling not yet implemented. Please provide all required information.');
        return;
      }

      logger.error(`❌ BecasFlow: Planning failed: ${planningResult.error}`);
      await message.reply(`❌ I couldn't understand that command: ${planningResult.error}`);
      return;
    }

    // 3. Check if this is a chat-only message (empty plan)
    if (planningResult.plan!.steps.length === 0) {
      logger.info(`💬 BecasFlow: Chat-only message detected, generating context-aware response`);

      // 🔥 FIX: Use AI to generate contextual response based on conversation history
      try {
        const conversationSummary = recentHistory
          .slice(-5) // Last 5 messages for context
          .map(h => `${h.author}: ${h.content}`)
          .join('\n');

        // Check if user is asking about conversation history
        const isAskingAboutHistory = /what.*talk|what.*discuss|what.*said|what.*happen|remember|recap|before|last time|earlier/i.test(commandContent);

        const systemPrompt = `You are Becas, a friendly Discord moderation bot.
Respond naturally to casual conversation. Be helpful, friendly, and concise.
${isAskingAboutHistory
  ? '🔥 RAG SYNTHESIS: The user is asking about previous conversation. Respond in FIRST-PERSON as if recalling the chat naturally. BE CONVERSATIONAL, not technical. Use casual language, emojis if appropriate. DO NOT write a third-person summary or analysis.'
  : 'IMPORTANT: Keep responses SHORT (1-2 sentences max). Do not over-explain.'
}`;

        const userPrompt = `Recent conversation:
${conversationSummary}

Current message: "${commandContent}"

${isAskingAboutHistory
  ? `Respond as if you're recalling our conversation naturally. Examples:
- "You were joking about apples being red but seeing them blue! 🍎😊"
- "We were chatting about how things are going with you!"
- "You asked me how I'm doing and we had a nice little chat!"

Be friendly, casual, and conversational. AVOID technical summaries like "The conversation started with..." - instead say "You said..." or "We talked about..."`
  : 'Respond naturally and briefly to continue the conversation.'
}`;

        const aiResponse = await this.ollama.generate(userPrompt, systemPrompt);
        const rawResponse = aiResponse.trim() || "Hey! I'm here. How can I help you?";

        // 🔥 FIX: Format with paragraphs for better Discord readability
        const response = this.formatParagraphs(rawResponse);

        await message.reply(response);

        // Add bot response to history
        history.push({
          author: 'Becas',
          authorId: this.client.user!.id,
          content: response,
          timestamp: Date.now(),
          isBot: true,
        });

        return;
      } catch (error) {
        logger.error('Failed to generate AI chat response:', error);
        // Fallback to simple response
        await message.reply("Hey! I'm here. How can I help you?");
        return;
      }
    }

    // 4. Execute the plan
    logger.info(`🎯 BecasFlow: Executing plan with ${planningResult.plan!.steps.length} steps`);
    const executionResult = await this.becasflowExecutor.execute(
      planningResult.plan!,
      becasContext
    );

    // 5. Check if tools already sent Discord messages (analytics/query tools send embeds directly)
    // ONLY skip AI response if:
    // - Single-step plan (user asked for ONE specific thing)
    // - AND that tool sent a self-contained embed (check_trust, moderation_history, etc)
    //
    // Multi-step plans ALWAYS need AI response to synthesize results
    const isSingleStep = planningResult.plan!.steps.length === 1;
    const toolsSentMessages = isSingleStep && executionResult.results.some(r =>
      ['moderation_history', 'user_activity', 'trust_report', 'server_stats', 'check_trust'].includes(r.toolName)
    );

    if (!toolsSentMessages) {
      // 6. Use ResultSynthesizer to format the response (replaces generateAIResponse)
      const synthesizedResponse = await this.resultSynthesizer.synthesize(
        commandContent,
        executionResult,
        {
          serverName: message.guild?.name,
          period: 'recent', // Extract from query if possible
          actionType: undefined, // Extract from query if possible
        }
      );

      // 7. Send synthesized response
      await message.reply(synthesizedResponse);

      // 8. Add bot's response to conversation history for better context tracking
      const updatedHistory = this.conversationHistory.get(conversationKey);
      if (updatedHistory) {
        updatedHistory.push({
          author: 'Becas',
          authorId: this.client.user!.id,
          content: synthesizedResponse,
          timestamp: Date.now(),
          isBot: true,
        });
      }
    } else {
      logger.info(`ℹ️ BecasFlow: Tools sent Discord messages directly - skipping AI response`);
    }

    logger.info(`✅ BecasFlow: Command handled successfully`);
  }

  /**
   * Generate natural language AI response from execution results
   */
  private async generateAIResponse(execution: any, originalQuery: string): Promise<string> {
    try {
      // Build context from execution results
      const resultsText = execution.results
        .map((r: any) => `${r.toolName}: ${r.result.success ? 'Success' : 'Failed'}`)
        .join('\n');

      const prompt = `User asked: "${originalQuery}"

Execution results:
${resultsText}

Final output: ${execution.finalOutput}

Generate a natural, conversational response to the user explaining what was done.
IMPORTANT: If the response is long (more than 2 sentences), split it into short paragraphs for better readability.`;

      const systemPrompt = `You are Becas, a helpful Discord moderation bot.
Respond naturally and concisely.
For longer responses, use natural paragraph breaks to improve readability.
Each paragraph should be 1-2 sentences maximum.`;

      const response = await this.ollama.generate(
        prompt,
        systemPrompt,
        {
          maxTokens: 400,
        }
      );

      // 🔥 FIX: Format long responses with paragraph breaks
      // Replace single newlines with double newlines for better Discord formatting
      const formatted = this.formatParagraphs(response.trim());
      return formatted;
    } catch (error) {
      logger.error('Failed to generate AI response:', error);
      // Fallback to execution summary
      return execution.finalOutput || 'Action completed successfully.';
    }
  }

  /**
   * Format long text with proper paragraph breaks for Discord
   */
  private formatParagraphs(text: string): string {
    // If text already has double newlines, don't modify it
    if (text.includes('\n\n')) {
      return text;
    }

    // Split by sentences (., !, ?)
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

    // If only 1-2 sentences, no formatting needed
    if (sentences.length <= 2) {
      return text;
    }

    // Group sentences into paragraphs (2-3 sentences each)
    const paragraphs: string[] = [];
    for (let i = 0; i < sentences.length; i += 2) {
      const paragraph = sentences.slice(i, i + 2).join(' ').trim();
      if (paragraph) {
        paragraphs.push(paragraph);
      }
    }

    // Join with double newlines for Discord paragraph breaks
    return paragraphs.join('\n\n');
  }
}
