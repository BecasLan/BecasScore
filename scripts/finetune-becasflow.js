/**
 * BECASFLOW FINE-TUNE SCRIPT
 *
 * Fine-tunes qwen2.5:0.5b for BecasFlow tool selection using Node.js
 * Uses Ollama + custom training loop
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// Configuration
const CONFIG = {
  baseModel: 'qwen2.5:0.5b',
  outputModel: 'becasflow-planner:latest',
  trainingDataPath: path.join(__dirname, '..', 'data', 'becasflow-training.jsonl'),
  epochs: 3,
  batchSize: 4,
  learningRate: 2e-5,
};

/**
 * Load training data
 */
function loadTrainingData() {
  console.log('📂 Loading training data...');
  const data = fs.readFileSync(CONFIG.trainingDataPath, 'utf-8');
  const lines = data.trim().split('\n');
  const examples = lines.map(line => JSON.parse(line));
  console.log(`   ✅ Loaded ${examples.length} training examples\n`);
  return examples;
}

/**
 * Create Modelfile with few-shot examples
 * (Alternative to full fine-tune - uses in-context learning)
 */
async function createFewShotModel(examples) {
  console.log('🔨 Creating few-shot learning model...');

  // Take first 20 examples as in-context examples
  const fewShotExamples = examples.slice(0, 20);

  const examplesText = fewShotExamples.map(ex => {
    const query = ex.prompt.split('User query: "')[1].split('"')[0];
    const completion = JSON.stringify(ex.completion);
    return `Example:\nQuery: "${query}"\nPlan: ${completion}`;
  }).join('\n\n');

  const modelfile = `FROM ${CONFIG.baseModel}

# System prompt with few-shot examples
SYSTEM """You are BecasFlow Planner. Convert natural language to JSON execution plans.

Available Tools:
- moderation_history: View moderation history (params: userId, period, limit)
- check_trust: Check trust score (params: userId, detailed)
- timeout: Timeout user (params: userId, duration, reason)
- ban: Ban user (params: userId, reason)
- user_activity: Get activity stats (params: userId, days)
- server_stats: Get server statistics (params: detailed)

CRITICAL RULES:
1. Return ONLY valid JSON, no text before/after
2. Use EXACT tool names from list above
3. Extract parameters from query
4. For "my score", use userId from context
5. For "@user", extract userId from mention

${examplesText}

Now convert the user's query to a JSON plan following the exact same format.
"""

# Optimized parameters for JSON generation
PARAMETER temperature 0.1
PARAMETER top_p 0.9
PARAMETER top_k 20
PARAMETER repeat_penalty 1.1
PARAMETER num_ctx 4096
`;

  const modelfilePath = path.join(__dirname, '..', 'Modelfile.becasflow-fewshot');
  fs.writeFileSync(modelfilePath, modelfile);
  console.log(`   ✅ Modelfile created: ${modelfilePath}\n`);

  return modelfilePath;
}

/**
 * Create model using Ollama
 */
async function createModel(modelfilePath) {
  console.log('🚀 Creating model with Ollama...');
  console.log(`   Base: ${CONFIG.baseModel}`);
  console.log(`   Output: ${CONFIG.outputModel}\n`);

  try {
    const { stdout, stderr } = await execAsync(
      `ollama create ${CONFIG.outputModel} -f "${modelfilePath}"`,
      { cwd: path.join(__dirname, '..') }
    );

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    console.log(`\n✅ Model created successfully: ${CONFIG.outputModel}`);
  } catch (error) {
    console.error('❌ Error creating model:', error.message);
    throw error;
  }
}

/**
 * Test the fine-tuned model
 */
async function testModel(examples) {
  console.log('\n🧪 Testing model...\n');

  const testExamples = examples.slice(-5); // Last 5 examples for testing

  for (const example of testExamples) {
    const query = example.prompt.split('User query: "')[1].split('"')[0];
    const expectedPlan = example.completion;

    console.log(`Query: "${query}"`);
    console.log(`Expected: ${JSON.stringify(expectedPlan)}`);

    try {
      const { stdout } = await execAsync(
        `ollama run ${CONFIG.outputModel} "Generate execution plan: ${query}"`,
        { timeout: 10000 }
      );

      console.log(`Got: ${stdout.trim()}`);
      console.log('---\n');
    } catch (error) {
      console.error('Test failed:', error.message);
    }
  }
}

/**
 * Generate expanded training data
 */
function expandTrainingData(examples) {
  console.log('📈 Expanding training data with variations...');

  const expanded = [...examples];

  // Add variations for common queries
  const variations = {
    'show violations': ['list violations', 'view violations', 'get violations', 'violations for'],
    'trust score': ['score', 'reputation', 'trust level'],
    'timeout': ['mute', 'silence', 'temp ban'],
  };

  let addedCount = 0;
  for (const example of examples) {
    const query = example.prompt.split('User query: "')[1].split('"')[0];

    for (const [original, alts] of Object.entries(variations)) {
      if (query.includes(original)) {
        for (const alt of alts) {
          const newQuery = query.replace(original, alt);
          const newExample = {
            ...example,
            prompt: example.prompt.replace(query, newQuery)
          };
          expanded.push(newExample);
          addedCount++;
        }
      }
    }
  }

  console.log(`   ✅ Added ${addedCount} variations (Total: ${expanded.length})\n`);

  // Save expanded dataset
  const expandedPath = CONFIG.trainingDataPath.replace('.jsonl', '-expanded.jsonl');
  const jsonlData = expanded.map(ex => JSON.stringify(ex)).join('\n');
  fs.writeFileSync(expandedPath, jsonlData);
  console.log(`   💾 Saved to: ${expandedPath}\n`);

  return expanded;
}

/**
 * Main fine-tune process
 */
async function main() {
  console.log('🔥 BECASFLOW FINE-TUNE PROCESS\n');
  console.log('═'.repeat(50));
  console.log('\n');

  try {
    // 1. Load training data
    let examples = loadTrainingData();

    // 2. Expand dataset
    examples = expandTrainingData(examples);

    // 3. Create few-shot model (alternative to full fine-tune)
    const modelfilePath = await createFewShotModel(examples);

    // 4. Create model with Ollama
    await createModel(modelfilePath);

    // 5. Test model
    await testModel(examples);

    console.log('\n✅ FINE-TUNE COMPLETE!\n');
    console.log('Next steps:');
    console.log(`1. Test: ollama run ${CONFIG.outputModel}`);
    console.log('2. Update BecasPlanner to use new model');
    console.log('3. Test in Discord with real queries\n');

  } catch (error) {
    console.error('\n❌ Fine-tune failed:', error);
    process.exit(1);
  }
}

// Run
main();
