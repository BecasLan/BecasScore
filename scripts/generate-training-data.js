/**
 * BECASFLOW FINE-TUNE DATASET GENERATOR
 *
 * Automatically generates training examples for tool selection
 */

const fs = require('fs');
const path = require('path');

// Tool definitions
const TOOLS = [
  {
    name: 'moderation_history',
    category: 'analytics',
    description: 'View moderation history for a user',
    params: { userId: 'string', period: 'string', limit: 'number' }
  },
  {
    name: 'check_trust',
    category: 'trust',
    description: 'Check user trust score',
    params: { userId: 'string', detailed: 'boolean' }
  },
  {
    name: 'timeout',
    category: 'moderation',
    description: 'Timeout a user',
    params: { userId: 'string', duration: 'number', reason: 'string' }
  },
  {
    name: 'ban',
    category: 'moderation',
    description: 'Ban a user from server',
    params: { userId: 'string', reason: 'string' }
  },
  {
    name: 'user_activity',
    category: 'analytics',
    description: 'Get user activity statistics',
    params: { userId: 'string', days: 'number' }
  },
  {
    name: 'server_stats',
    category: 'analytics',
    description: 'Get server statistics',
    params: { detailed: 'boolean' }
  }
];

// Query templates for each tool
const QUERY_TEMPLATES = {
  moderation_history: [
    'show violations for @{userId}',
    'what violations does @{userId} have',
    'check moderation history for @{userId}',
    'show all violations about @{userId}',
    'list violations @{userId}'
  ],
  check_trust: [
    'my trust score',
    'check my score',
    "what's my trust score",
    'check trust @{userId}',
    'show trust score for @{userId}'
  ],
  timeout: [
    'timeout @{userId} for {duration} minutes',
    'mute @{userId} {duration}min',
    'silence @{userId} for {duration}m',
    'timeout @{userId}'
  ],
  ban: [
    'ban @{userId}',
    'ban @{userId} for {reason}',
    'permanently ban @{userId}',
    'kick and ban @{userId}'
  ],
  user_activity: [
    'show activity for @{userId}',
    'how active is @{userId}',
    'user stats @{userId}',
    'get activity @{userId}'
  ],
  server_stats: [
    'server statistics',
    'show server stats',
    'server overview',
    'guild statistics'
  ]
};

// Generate tool descriptions string
function generateToolDescriptions(tools) {
  return tools.map(t =>
    `- ${t.name}: ${t.description} (category: ${t.category})`
  ).join('\n');
}

// Generate params from template
function generateParams(template, tool) {
  const params = {};

  // Extract variables from template
  const userIdMatch = template.match(/@\{userId\}/);
  const durationMatch = template.match(/\{duration\}/);
  const reasonMatch = template.match(/\{reason\}/);

  if (userIdMatch) {
    params.userId = '1234567890';
  }

  if (durationMatch) {
    params.duration = 10;
  }

  if (reasonMatch) {
    params.reason = 'Rule violation';
  }

  // Add other params based on tool definition
  if (tool.params.period) {
    params.period = 'month';
  }

  if (tool.params.limit) {
    params.limit = 10;
  }

  if (tool.params.detailed !== undefined) {
    params.detailed = true;
  }

  if (tool.params.days) {
    params.days = 7;
  }

  return params;
}

// Generate training examples
function generateTrainingData() {
  const examples = [];
  const toolDescriptions = generateToolDescriptions(TOOLS);

  for (const tool of TOOLS) {
    const templates = QUERY_TEMPLATES[tool.name] || [];

    for (const template of templates) {
      // Generate user query from template
      const query = template
        .replace(/@\{userId\}/g, '@user')
        .replace(/\{duration\}/g, '10')
        .replace(/\{reason\}/g, 'spam');

      const params = generateParams(template, tool);

      const example = {
        prompt: `Available tools:\n${toolDescriptions}\n\nUser query: "${query}"\n\nGenerate execution plan as JSON:`,
        completion: {
          steps: [{
            id: 'step_1',
            toolName: tool.name,
            params: params
          }]
        }
      };

      examples.push(example);
    }
  }

  return examples;
}

// Generate multi-step examples (advanced)
function generateMultiStepExamples() {
  const examples = [];
  const toolDescriptions = generateToolDescriptions(TOOLS);

  // Example: "show toxic users and timeout them"
  examples.push({
    prompt: `Available tools:\n${toolDescriptions}\n\nUser query: "show users with trust score below 50 and timeout them"\n\nGenerate execution plan as JSON:`,
    completion: {
      steps: [
        {
          id: 'step_1',
          toolName: 'user_activity',
          params: { days: 30 }
        },
        {
          id: 'step_2',
          toolName: 'check_trust',
          params: { userId: '$step1.users', detailed: false }
        },
        {
          id: 'step_3',
          toolName: 'timeout',
          params: { userId: '$step2.filtered', duration: 10, reason: 'Low trust score' }
        }
      ]
    }
  });

  return examples;
}

// Main
function main() {
  console.log('🔥 Generating BecasFlow Fine-Tune Dataset...\n');

  const singleStepExamples = generateTrainingData();
  const multiStepExamples = generateMultiStepExamples();

  const allExamples = [...singleStepExamples, ...multiStepExamples];

  console.log(`✅ Generated ${allExamples.length} training examples`);
  console.log(`   - Single-step: ${singleStepExamples.length}`);
  console.log(`   - Multi-step: ${multiStepExamples.length}\n`);

  // Save as JSONL (format for fine-tuning)
  const outputPath = path.join(__dirname, '..', 'data', 'becasflow-training.jsonl');
  const jsonlData = allExamples.map(ex => JSON.stringify(ex)).join('\n');

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, jsonlData);

  console.log(`💾 Saved to: ${outputPath}`);
  console.log('\n🚀 Next steps:');
  console.log('   1. Review the dataset');
  console.log('   2. Add more examples manually if needed');
  console.log('   3. Run fine-tuning with: ollama create becasflow-planner -f Modelfile');
}

main();
