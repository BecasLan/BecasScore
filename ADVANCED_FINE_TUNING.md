# Advanced Fine-Tuning System

## Overview

The Becas Advanced Fine-Tuning System is a comprehensive, fully-automated pipeline for continuous model improvement through production data. It collects high-quality training examples across 14 different categories, performs A/B testing, and automatically manages the fine-tuning lifecycle.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRODUCTION EVENTS                             │
│  (violations, scams, intents, tools, trust scores, etc.)        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│          AdvancedFineTuningPlugin (Data Collection)              │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ 14 Training Categories:                               │      │
│  │  • Violation Detection    • Scam Detection           │      │
│  │  • Intent Classification  • Tool Selection            │      │
│  │  • Trust Prediction       • Moderation Decisions      │      │
│  │  • Policy Interpretation  • Sentiment Analysis        │      │
│  │  • Language Detection     • Network Analysis          │      │
│  │  • User Profiling         • Workflow Parsing          │      │
│  │  • Human Corrections      • RAG Enhancement           │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                  │
│  Quality Filtering: Gold (>0.90), Silver (>0.75), Bronze (>0.60) │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│        FineTuningOrchestratorPlugin (Pipeline Management)        │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ Automated Pipeline:                                   │      │
│  │  1. Monitor training data collection                  │      │
│  │  2. Trigger fine-tuning when thresholds met           │      │
│  │  3. Create Modelfile and export dataset               │      │
│  │  4. Execute Ollama fine-tuning                        │      │
│  │  5. Register model for A/B testing                    │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                  │
│  Thresholds: 500+ Gold examples, 2000+ total, 0.85+ avg quality │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│         ModelABTestingPlugin (Performance Validation)            │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ Shadow Testing:                                       │      │
│  │  • Run base model and fine-tuned model in parallel    │      │
│  │  • Compare confidence, accuracy, latency              │      │
│  │  • Track win rate and quality metrics                 │      │
│  │  • Sample 20% of production requests                  │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                  │
│  Promotion Criteria: 100+ tests, 65%+ win rate                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│          Model Promotion & Deployment (Production)               │
│  • Automatic model promotion (optional)                          │
│  • Model versioning and rollback                                │
│  • Performance monitoring                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. AdvancedFineTuningPlugin

**Purpose**: Collect comprehensive training data from ALL system capabilities.

**Features**:
- **14 Training Categories** covering every aspect of the system
- **Quality Tier System**: Gold (0.90+), Silver (0.75+), Bronze (0.60+)
- **Multi-dimensional Quality Scoring**:
  - Base confidence (0-0.35)
  - Detailed reasoning (+0.15)
  - Clear outcome (+0.15)
  - Human validation (+0.20) - HIGHEST VALUE
  - RAG enhancement (+0.10)
  - Multiple precedents (+0.05)
  - Contextual data (+0.10)
  - Edge case (+0.10)
  - Common pattern (+0.05)

**Event Subscriptions**:
- `violation.detected` → Violation detection examples
- `scam.detected` → Scam detection examples
- `intent.analyzed` → Intent classification examples
- `tool.executed` → Tool selection examples
- `trust_score.changed` → Trust prediction examples
- `moderation.action_executed` → Moderation decision examples
- `ai.correction` → Human correction examples (GOLD tier)
- `rag.context_enhanced` → RAG-enhanced examples (GOLD tier)
- `policy.evaluated` → Policy interpretation examples
- `sentiment.analyzed` → Sentiment analysis examples
- `network.raid_detected` → Network analysis examples
- `user.profile_updated` → User profiling examples
- `workflow.parsed` → Workflow parsing examples

**Data Export**:
- JSONL format for Ollama fine-tuning
- Balanced datasets (equal positive/negative examples)
- Configurable filters (category, quality tier, model target)
- Automatic dataset statistics

### 2. ModelABTestingPlugin

**Purpose**: Validate fine-tuned models against base models in production.

**Features**:
- **Shadow Testing**: Run both models in parallel, production uses base model
- **Performance Metrics**:
  - Accuracy delta (compared to ground truth)
  - Confidence delta
  - Latency delta
  - Quality score (0-1)
- **Sample Rate**: Test 20% of production requests (configurable)
- **Statistical Analysis**: Track win rate, confidence intervals
- **Model Registry**: Manage multiple base and fine-tuned models

**A/B Test Lifecycle**:
1. Register base model (e.g., qwen3:1.7b)
2. Register fine-tuned model (e.g., becas-qwen-violations-v1)
3. Set up A/B test for task type
4. Run shadow tests on production traffic
5. Collect performance metrics
6. Generate comparison report
7. Recommend promotion/rollback

**Comparison Report**:
- Overall winner (Model A vs Model B)
- Statistical confidence (0-1)
- Win rate by task type
- Sample size per category
- Promotion recommendation

### 3. FineTuningOrchestratorPlugin

**Purpose**: Orchestrate the entire fine-tuning pipeline end-to-end.

**Features**:
- **Automatic Monitoring**: Checks training data readiness every hour
- **Pipeline Automation**:
  1. **Collecting** → Monitor example collection
  2. **Ready for Training** → Thresholds met
  3. **Training** → Execute fine-tuning
  4. **Testing** → Run A/B tests
  5. **Evaluating** → Analyze performance
  6. **Promoting** → Deploy to production
  7. **Deployed** → In production use
  8. **Failed** → Error recovery

**Configuration**:
```typescript
{
  minGoldExamples: 500,           // Need 500+ GOLD tier examples
  minTotalExamples: 2000,         // Total 2000+ examples
  minQualityScore: 0.85,          // Average quality >= 0.85
  minTestsBeforePromotion: 100,   // Run 100+ A/B tests
  minWinRateForPromotion: 0.65,   // 65%+ win rate required
  autoFineTune: true,             // Auto-trigger fine-tuning
  autoPromote: false,             // Manual approval for safety
  autoRollback: true              // Auto-rollback on failures
}
```

**Job Management**:
- Fine-tuning job tracking
- Version control (v1, v2, v3...)
- Rollback to previous versions
- Job persistence (saved to disk)

**Ollama Integration**:
- Automatically creates Modelfiles
- Executes `ollama create` command
- Manages fine-tuning adapters
- Handles model registration

## Training Categories

### 1. Violation Detection
**Model**: Qwen3 1.7B (fast context understanding)
**Examples**: Messages flagged as policy violations
**Quality Factors**: Confidence, clear outcome, detailed reasoning

### 2. Scam Detection
**Model**: Qwen3 1.7B (contextual understanding)
**Examples**: Phishing, airdrops, crypto scams, social engineering
**Quality Factors**: Confidence, edge cases (social engineering), indicators

### 3. Intent Classification
**Model**: Qwen3 1.7B
**Examples**: Deep intent analysis (FUD, criticism, jokes, frustration)
**Quality Factors**: Emotional state accuracy, contextual data

### 4. Tool Selection
**Model**: Llama 3.2 3B (reasoning)
**Examples**: BecasFlow tool selection decisions
**Quality Factors**: Successful execution, parameter inference

### 5. Trust Score Prediction
**Model**: General
**Examples**: Trust score changes based on user behavior
**Quality Factors**: Accurate delta prediction, clear reasoning

### 6. Moderation Decisions
**Model**: General
**Examples**: Action selection (ban, timeout, warning)
**Quality Factors**: Appropriate severity, justification

### 7. Policy Interpretation
**Model**: General
**Examples**: Policy rule evaluation
**Quality Factors**: Accurate violation matching, threshold understanding

### 8. Sentiment Analysis
**Model**: Qwen3 1.7B
**Examples**: Message sentiment and emotion detection
**Quality Factors**: Score accuracy, emotion classification

### 9. Language Detection
**Model**: General
**Examples**: Auto-detect message language
**Quality Factors**: High confidence, correct identification

### 10. Network Analysis
**Model**: General
**Examples**: Raid detection, bot patterns, coordinated attacks
**Quality Factors**: Pattern recognition, multi-user correlation

### 11. User Profiling
**Model**: General
**Examples**: User behavior prediction, risk assessment
**Quality Factors**: Historical accuracy, risk level prediction

### 12. Workflow Parsing
**Model**: Llama 3.2 3B (reasoning)
**Examples**: BecasFlow workflow interpretation
**Quality Factors**: Correct step extraction, dependency understanding

### 13. Human Corrections (GOLD TIER)
**Model**: All models
**Examples**: Moderator corrections of AI decisions
**Quality Factors**: ALWAYS high quality, valuable edge cases

### 14. RAG Context Enhancement (GOLD TIER)
**Model**: All models
**Examples**: Decisions enhanced with historical context
**Quality Factors**: Multiple precedents, improved confidence

## Quality Tier System

### Gold Tier (0.90+)
**Characteristics**:
- Very high confidence (>= 0.9)
- Human validated OR RAG-enhanced
- Detailed reasoning
- Clear outcome
- Multiple precedents (for RAG)

**Use Cases**:
- Primary fine-tuning dataset
- Edge case learning
- Human correction integration

### Silver Tier (0.75-0.89)
**Characteristics**:
- Good confidence (0.75-0.89)
- Detailed reasoning
- Clear outcome
- Contextual data

**Use Cases**:
- Supplemental training data
- Dataset balancing
- Coverage improvement

### Bronze Tier (0.60-0.74)
**Characteristics**:
- Acceptable confidence
- Basic reasoning
- May lack context

**Use Cases**:
- Dataset augmentation
- Common pattern learning
- Volume increase

### Reject (< 0.60)
**Characteristics**:
- Low confidence
- Ambiguous outcome
- Insufficient reasoning

**Action**: Not used for training

## Dataset Balancing

**Problem**: Imbalanced datasets lead to biased models.

**Solution**: Automatic balancing by outcome

**Process**:
1. Group examples by outcome (success, failure, uncertain)
2. Find minimum group size
3. Sample equally from each group
4. Maintain quality thresholds

**Result**: Balanced positive/negative examples

## Model Versioning

**Format**: `becas-{base_model}-{category}-v{version}`

**Examples**:
- `becas-qwen-violations-v1`
- `becas-qwen-scam_detection-v2`
- `becas-llama-tool_selection-v1`

**Version Management**:
- Auto-increment version numbers
- Track previous versions for rollback
- Store training dataset reference
- Record promotion reasons

## Human Feedback Loop

**Integration**: AI Learning System → Advanced Fine-Tuning

**Process**:
1. Moderator corrects AI decision
2. AI Learning System analyzes correction
3. Creates correction event with:
   - Original AI decision
   - Moderator action
   - Mistake analysis
   - Lesson learned
4. Advanced Fine-Tuning Plugin collects as GOLD tier example
5. Added to human correction category
6. Used in next fine-tuning cycle

**Result**: AI learns from mistakes continuously

## A/B Testing Workflow

### Setup Phase
```typescript
// Register base model
abTestingPlugin.registerModel({
  name: 'qwen3-base',
  type: 'base',
  modelId: 'qwen3:1.7b',
});

// Register fine-tuned model (auto-done by orchestrator)
abTestingPlugin.registerModel({
  name: 'becas-qwen-violations-v1',
  type: 'fine_tuned',
  modelId: 'becas-qwen-violations-v1',
});

// Set up A/B test
abTestingPlugin.setupABTest(
  'violation_detection',
  'qwen3-base',
  'becas-qwen-violations-v1'
);
```

### Testing Phase
- 20% of production requests tested
- Both models run in parallel
- Base model output used in production (shadow testing)
- Results compared and metrics collected

### Evaluation Phase
```typescript
const report = await abTestingPlugin.generateComparisonReport(
  'qwen3-base',
  'becas-qwen-violations-v1'
);

console.log(report.overallWinner);      // 'A' or 'B' or 'tie'
console.log(report.confidence);         // 0-1 statistical confidence
console.log(report.recommendation);     // 'promote_B', 'keep_A', 'need_more_data'
console.log(report.reasoning);          // Detailed explanation
```

### Promotion Phase
```typescript
// Manual promotion
await orchestratorPlugin.promoteModel(job);

// Or automatic (if configured)
config.autoPromote = true;
```

## Fine-Tuning Pipeline

### 1. Automatic Trigger
**Conditions**:
- 500+ Gold tier examples
- 2000+ Total examples
- 0.85+ Average quality score

### 2. Dataset Export
```typescript
const datasetPath = await fineTuningPlugin.exportDataset(
  'violations_v1',
  {
    category: 'violation_detection',
    minTier: 'bronze',
    balance: true,
  }
);
```

**Output Format** (JSONL):
```json
{"input": "...", "output": "...", "system": "...", "metadata": {...}, "quality": "gold"}
{"input": "...", "output": "...", "system": "...", "metadata": {...}, "quality": "silver"}
...
```

### 3. Modelfile Creation
```
FROM qwen3:1.7b

SYSTEM """
You are Becas, an advanced AI moderation assistant specialized in violation_detection.
You provide accurate, context-aware analysis with high confidence and detailed reasoning.
"""

ADAPTER violations_v1_1234567890.jsonl

PARAMETER temperature 0.3
PARAMETER top_p 0.9
PARAMETER top_k 40
PARAMETER num_ctx 4096
```

### 4. Ollama Fine-Tuning
```bash
ollama create becas-qwen-violations-v1 -f modelfile
```

### 5. A/B Testing Registration
```typescript
abTestingPlugin.setupABTest(
  'violation_detection',
  'qwen3-base',
  'becas-qwen-violations-v1'
);
```

### 6. Performance Validation
**Criteria**:
- 100+ A/B tests completed
- 65%+ win rate
- Statistical significance

### 7. Promotion
**Options**:
- Manual approval (default)
- Automatic promotion (if configured)
- Rollback to previous version (if issues detected)

## Monitoring & Metrics

### Training Data Stats
```typescript
const stats = advancedFineTuningPlugin.getStats();

console.log(stats.totalExamples);           // Total collected
console.log(stats.byCategory);              // Count per category
console.log(stats.byTier);                  // Gold, Silver, Bronze
console.log(stats.avgQualityPerCategory);   // Quality per category
console.log(stats.humanCorrectionCount);    // Human feedback count
console.log(stats.ragEnhancedCount);        // RAG-enhanced count
```

### A/B Testing Stats
```typescript
const stats = abTestingPlugin.getStats();

console.log(stats.totalTests);              // Total A/B tests
console.log(stats.byTaskType);              // Tests per task type
console.log(stats.byModel);                 // Per-model performance
```

### Pipeline Stats
```typescript
const stats = orchestratorPlugin.getStats();

console.log(stats.totalJobs);               // Fine-tuning jobs
console.log(stats.byStage);                 // Jobs per pipeline stage
console.log(stats.byCategory);              // Jobs per category
console.log(stats.deployedModels);          // Models in production
console.log(stats.averageWinRate);          // Avg win rate across all models
```

## Best Practices

### 1. Start with High-Quality Data
- Prioritize Gold tier examples
- Enable human feedback loops
- Use RAG enhancement where possible
- Validate edge cases manually

### 2. Gradual Rollout
- Start with bronze tier inclusion
- Monitor A/B test results closely
- Require manual approval for first few versions
- Enable automatic promotion only after confidence

### 3. Category-Specific Models
- Train separate models for different tasks
- Use Qwen for fast categories (violations, scams, intent)
- Use Llama for reasoning categories (tool selection, workflows)
- Fine-tune on category-specific data only

### 4. Regular Retraining
- Retrain monthly as new data accumulates
- Include recent human corrections
- Monitor quality degradation over time
- Keep multiple versions for rollback

### 5. Performance Monitoring
- Track win rate trends
- Monitor latency impact
- Watch for quality regression
- Set up alerts for failures

## API Usage

### Collect Custom Examples
```typescript
// Publish event to trigger collection
await kernel.publishEvent(
  new GenericDomainEvent('custom.example', {
    category: 'violation_detection',
    input: 'Message text...',
    output: 'Expected analysis...',
    confidence: 0.95,
    outcome: 'success',
  })
);
```

### Export Dataset
```typescript
const path = await advancedFineTuningPlugin.exportDataset(
  'my_dataset',
  {
    category: 'scam_detection',
    modelTarget: 'qwen',
    minQuality: 0.80,
    maxExamples: 5000,
    balance: true,
  }
);
```

### Trigger Fine-Tuning
```typescript
const job = await orchestratorPlugin.createFineTuningJob('violation_detection');

// Monitor progress
console.log(job.stage);  // 'training', 'testing', 'evaluating', etc.
```

### Promote Model
```typescript
await orchestratorPlugin.promoteModel(job);
```

### Rollback Model
```typescript
await orchestratorPlugin.rollbackModel('violation_detection', 'Performance degradation detected');
```

## Events

### Published Events
- `fine_tuning.completed` - Fine-tuning job completed
- `fine_tuning.failed` - Fine-tuning job failed
- `fine_tuning.ready_for_promotion` - Model ready for production
- `fine_tuning.promoted` - Model promoted to production
- `fine_tuning.rolled_back` - Model rolled back
- `ab_test.completed` - A/B test completed

### Consumed Events
- `violation.detected`
- `scam.detected`
- `intent.analyzed`
- `tool.executed`
- `trust_score.changed`
- `moderation.action_executed`
- `ai.correction`
- `rag.context_enhanced`
- `policy.evaluated`
- `sentiment.analyzed`
- `network.raid_detected`
- `user.profile_updated`
- `workflow.parsed`

## Troubleshooting

### Not Collecting Examples
1. Check event subscriptions are active
2. Verify events are being published
3. Check minimum confidence thresholds
4. Review quality filtering criteria

### Fine-Tuning Not Triggering
1. Check example counts meet thresholds
2. Verify quality scores meet requirements
3. Check `autoFineTune` configuration
4. Review orchestrator logs

### A/B Tests Not Running
1. Verify A/B test setup
2. Check sample rate configuration
3. Ensure both models are registered
4. Review event publishing

### Model Not Promoted
1. Check win rate meets threshold
2. Verify minimum tests completed
3. Review `autoPromote` configuration
4. Check for statistical significance

## Performance Considerations

### Memory Usage
- Max 50,000 examples per category (configurable)
- In-memory storage with disk persistence
- Automatic cleanup of old examples

### Latency Impact
- A/B testing runs in parallel (no production latency)
- 20% sample rate limits overhead
- Shadow testing ensures production uses base model

### Storage Requirements
- JSONL datasets: ~1-5 MB per 1000 examples
- Job files: ~10 KB per job
- Model files: Managed by Ollama

## Security Considerations

### Data Privacy
- No PII in training examples
- Message content sanitized
- User IDs hashed

### Model Safety
- Manual promotion for critical models
- Rollback capability
- A/B testing before production
- Human validation for edge cases

## Future Enhancements

1. **Multi-Guild Training**: Train separate models per guild
2. **Federated Learning**: Combine datasets across instances
3. **Active Learning**: Request labels for uncertain examples
4. **Continuous Fine-Tuning**: Incremental updates vs full retraining
5. **Model Ensembles**: Combine multiple fine-tuned models
6. **Adversarial Training**: Improve robustness with adversarial examples
7. **Transfer Learning**: Bootstrap new categories from existing models
8. **Automated Hyperparameter Tuning**: Optimize fine-tuning parameters

## Conclusion

The Becas Advanced Fine-Tuning System provides a production-ready, fully-automated pipeline for continuous model improvement. By collecting high-quality examples from real-world usage, performing rigorous A/B testing, and managing the entire lifecycle automatically, it ensures Becas AI continuously improves while maintaining safety and reliability.

Key benefits:
- **Fully Automated**: From data collection to deployment
- **Comprehensive**: 14 categories covering all capabilities
- **Quality-Focused**: Gold/Silver/Bronze tier system
- **Safe**: A/B testing, rollback, manual approval options
- **Scalable**: Handles millions of examples efficiently
- **Intelligent**: Learns from human corrections and RAG insights
