# BecasFlow Framework

Complete Discord-native AI workflow automation framework with tool-based architecture, conditional execution, and self-healing capabilities.

## Architecture

```
BecasFlow/
├── types/
│   └── BecasFlow.types.ts      # All TypeScript type definitions
├── core/
│   ├── BecasConditions.ts      # Conditional logic engine (if/then/else)
│   ├── BecasContext.ts         # Conversation memory & state
│   ├── BecasPlanner.ts         # AI planning system (Ollama)
│   ├── BecasExecutor.ts        # Execution engine
│   └── BecasInteractive.ts     # User prompt system
├── registry/
│   └── BecasToolRegistry.ts    # Tool registration & discovery
├── tools/
│   ├── moderation/             # Moderation tools
│   │   ├── ban.tool.ts
│   │   ├── timeout.tool.ts
│   │   ├── kick.tool.ts
│   │   ├── warn.tool.ts
│   │   └── delete_messages.tool.ts
│   ├── trust/                  # Trust score tools
│   │   ├── check_trust.tool.ts
│   │   ├── update_trust.tool.ts
│   │   └── trust_report.tool.ts
│   └── analytics/              # Analytics tools
│       ├── server_stats.tool.ts
│       ├── user_activity.tool.ts
│       └── moderation_history.tool.ts
└── index.ts                    # Main exports
```

## Features

### 1. Tool-Based Architecture
- MCP/LangChain style tool definitions
- Parameter schemas with validation
- Missing data detection
- Tool chaining and looping
- Preconditions and postconditions

### 2. AI Planning
- Natural language to execution plan
- Ollama-powered intent understanding
- Multi-step plan generation
- Conditional planning (if/then/else)
- Context-aware (references previous results)

### 3. Execution Engine
- Sequential and parallel execution
- Conditional branching
- Loop support
- Error handling with retry
- Dry-run mode
- Progress reporting

### 4. Interactive Prompts
- Button prompts (Discord buttons)
- Select menus
- Text input with validation
- Confirm dialogs
- Timeout handling

### 5. Context Management
- Conversation history (last 10 queries)
- Reference resolution ("ban them" → resolves from history)
- Variable storage
- Service injection
- Smart caching

### 6. Conditional Logic
- Compare operators (>, <, ==, !=, etc.)
- Contains, matches (regex)
- Custom functions
- AND/OR/NOT logic
- Field path resolution (dot notation)

## Quick Start

### 1. Initialize Framework

```typescript
import { BecasFlow, registerAllTools } from './becasflow';
import { OllamaService } from './services/OllamaService';

// Initialize Ollama
const ollama = new OllamaService('planning');

// Create BecasFlow instance
const becasFlow = new BecasFlow(ollama);

// Register all built-in tools
registerAllTools();
```

### 2. Execute Natural Language Commands

```typescript
import { BecasContext } from './becasflow';

// Execute query
const result = await becasFlow.execute(
  "ban @spammer for harassment and delete their messages",
  message, // Discord message object
  {
    trustEngine,
    v3Integration,
    unifiedMemory,
  }
);

console.log(result.finalOutput);
```

### 3. Create Custom Tools

```typescript
import { BecasTool } from './becasflow';

const myTool: BecasTool = {
  name: 'my_tool',
  description: 'Does something useful',
  category: 'utility',

  parameters: {
    param1: {
      type: 'string',
      description: 'First parameter',
      required: true,
    },
    param2: {
      type: 'number',
      description: 'Second parameter',
      required: false,
      default: 10,
    },
  },

  async execute(params, context) {
    // Your logic here
    return {
      success: true,
      data: { result: 'done' },
    };
  },

  canChainTo: ['other_tool'],
  requiresConfirmation: true,
};

// Register
becasFlow.getRegistry().register(myTool);
```

## Built-in Tools

### Moderation
- **ban** - Ban a user permanently
- **timeout** - Timeout (mute) a user temporarily
- **kick** - Kick a user (they can rejoin)
- **warn** - Issue a warning
- **delete_messages** - Bulk delete messages

### Trust
- **check_trust** - View trust score and history
- **update_trust** - Manually adjust trust score
- **trust_report** - Generate server-wide trust report

### Analytics
- **server_stats** - Display server statistics
- **user_activity** - Analyze user activity patterns
- **moderation_history** - View moderation history

## Advanced Usage

### Conditional Execution

```typescript
const plan: BecasPlan = {
  id: 'conditional_example',
  query: 'Check user and ban if low trust',
  steps: [
    {
      id: 'check',
      toolName: 'check_trust',
      params: { userId: '123' },
      outputAs: 'trustData',
    },
    {
      id: 'ban_if_low',
      toolName: 'ban',
      params: { userId: '123' },
      condition: {
        type: 'lessThan',
        field: 'stepResults.check.score',
        value: 30,
      },
    },
  ],
};
```

### Loop Execution

```typescript
const plan: BecasPlan = {
  id: 'loop_example',
  query: 'Keep deleting messages until count is low',
  steps: [
    {
      id: 'delete_loop',
      toolName: 'delete_messages',
      params: { count: 10 },
      loop: {
        condition: {
          type: 'greaterThan',
          field: 'variables.messageCount',
          value: 100,
        },
        maxIterations: 10,
        steps: [/* loop steps */],
      },
    },
  ],
};
```

### Interactive Prompts

```typescript
import { BecasInteractive } from './becasflow';

// Show button prompt
const response = await BecasInteractive.prompt(message, {
  type: 'button',
  message: 'Select an action',
  param: 'action',
  options: [
    { label: 'Ban', value: 'ban', emoji: '🔨' },
    { label: 'Kick', value: 'kick', emoji: '👢' },
    { label: 'Warn', value: 'warn', emoji: '⚠️' },
  ],
});

if (response.success) {
  console.log('Selected:', response.value);
}
```

### Context Chaining

```typescript
// First query: "check trust for @user"
await becasFlow.execute("check trust for @user", message, services);

// Second query: "ban them" (resolves @user from context)
await becasFlow.execute("ban them", message, services);
```

## Integration with Existing Systems

### TrustScoreEngine

```typescript
const result = await becasFlow.execute(
  "check trust for @user",
  message,
  {
    trustEngine: yourTrustEngine,
  }
);
```

### V3Integration

```typescript
const result = await becasFlow.execute(
  "ban @spammer",
  message,
  {
    v3Integration: yourV3Integration,
  }
);
```

### UnifiedMemory

```typescript
const result = await becasFlow.execute(
  "show moderation history",
  message,
  {
    unifiedMemory: yourUnifiedMemory,
  }
);
```

## Error Handling

```typescript
const result = await becasFlow.execute(query, message, services);

if (!result.success) {
  // Check errors
  result.errors.forEach((error) => {
    console.error(`Step ${error.stepId}: ${error.error}`);
  });
}

// Check individual step results
result.results.forEach((stepResult) => {
  if (!stepResult.result.success) {
    console.error(`Tool ${stepResult.toolName} failed`);
  }
});
```

## Testing

### Dry Run Mode

```typescript
const result = await becasFlow.execute(
  "ban @user",
  message,
  services,
  {
    execution: {
      dryRun: true, // Doesn't actually execute, just simulates
      verbose: true,
    },
  }
);
```

### Manual Plan Execution

```typescript
const planner = becasFlow.getPlanner();
const executor = becasFlow.getExecutor();

// Create plan
const planningResult = await planner.createPlan(query, context);

if (planningResult.success && planningResult.plan) {
  // Execute plan
  const executionResult = await executor.execute(
    planningResult.plan,
    context,
    { dryRun: true }
  );
}
```

## Performance

- **Average planning time**: 500-1500ms (depends on Ollama model)
- **Average execution time**: 100-500ms per step
- **Context memory**: Last 10 queries (configurable)
- **Cache TTL**: 5 minutes

## Best Practices

1. **Always provide services** - Tools work best with TrustEngine, V3Integration
2. **Use confirmations** - Set `requiresConfirmation: true` for destructive actions
3. **Chain tools** - Define `canChainTo` for natural workflows
4. **Handle missing data** - Implement `detectMissing` for better UX
5. **Add preconditions** - Validate before execution
6. **Test with dry-run** - Always test complex plans first
7. **Monitor performance** - Use execution metadata for optimization

## Troubleshooting

### "Tool not found"
- Make sure you called `registerAllTools()`
- Check tool name spelling

### "Missing required parameters"
- Implement `detectMissing` in your tool
- Provide default values

### "Permission denied"
- Check tool preconditions
- Verify Discord permissions

### "AI planning failed"
- Check Ollama connection
- Reduce plan complexity
- Provide more context

## Contributing

To add a new tool:

1. Create tool file in appropriate category
2. Implement `BecasTool` interface
3. Export from `tools/index.ts`
4. Add to `ALL_TOOLS` array
5. Test with dry-run mode

## License

Part of the BecasScore project.
