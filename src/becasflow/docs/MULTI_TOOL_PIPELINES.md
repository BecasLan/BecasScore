# BecasFlow Multi-Tool Pipelines

## Overview

BecasFlow now supports **multi-step data pipelines** where tools can pass data to each other, enabling complex queries that compose simple operations.

## Key Features

### 1. Step-to-Step Data Passing

Use `outputAs` to store a step's result in a variable:

```json
{
  "id": "step_1",
  "toolName": "moderation_history",
  "params": {"userId": "123"},
  "outputAs": "raw_violations"
}
```

### 2. Variable References

Three syntaxes supported:

#### `{{variable}}` - Recommended (Most Intuitive)
```json
{
  "id": "step_2",
  "toolName": "data_filter",
  "params": {
    "data": "{{raw_violations}}",
    "field": "action_type",
    "value": "timeout"
  }
}
```

#### `$variable` - Legacy Syntax
```json
{"data": "$raw_violations"}
```

#### `stepResults.stepId` - Direct Step Reference
```json
{"data": "stepResults.step_1"}
```

### 3. Nested Field Access

Access nested fields using dot notation:

```json
{"userId": "{{step_1.data.userId}}"}
{"timestamp": "{{raw_violations.0.timestamp}}"}
```

## Data Manipulation Tools

### `data_filter` - Filter Arrays
```json
{
  "toolName": "data_filter",
  "params": {
    "data": "{{raw_data}}",
    "field": "action_type",
    "condition": "equals",
    "value": "timeout"
  }
}
```

**Conditions:**
- `equals` / `not_equals`
- `contains` (string search)
- `greater_than` / `less_than` (numeric)
- `in_array` (check if value in array)

### `data_sort` - Sort Arrays
```json
{
  "toolName": "data_sort",
  "params": {
    "data": "{{filtered_data}}",
    "by": "timestamp",
    "order": "desc"
  }
}
```

**Orders:** `asc`, `desc`, `ascending`, `descending`

### `data_slice` - Extract Portions
```json
{
  "toolName": "data_slice",
  "params": {
    "data": "{{sorted_data}}",
    "mode": "first",
    "count": 3
  }
}
```

**Modes:**
- `first` - Take first N items
- `last` - Take last N items
- `range` - Take items from start to end index

## Complete Example

**User Query:** "Show me only timeout violations for @user from last week, sorted by most recent, just the last 3"

**AI-Generated Plan:**
```json
{
  "steps": [
    {
      "id": "step_1",
      "toolName": "moderation_history",
      "params": {
        "userId": "1234567890",
        "period": "week",
        "limit": 100
      },
      "outputAs": "all_violations"
    },
    {
      "id": "step_2",
      "toolName": "data_filter",
      "params": {
        "data": "{{all_violations.actions}}",
        "field": "type",
        "condition": "equals",
        "value": "timeout"
      },
      "outputAs": "timeout_only"
    },
    {
      "id": "step_3",
      "toolName": "data_sort",
      "params": {
        "data": "{{timeout_only}}",
        "by": "timestamp",
        "order": "desc"
      },
      "outputAs": "sorted_timeouts"
    },
    {
      "id": "step_4",
      "toolName": "data_slice",
      "params": {
        "data": "{{sorted_timeouts}}",
        "mode": "first",
        "count": 3
      },
      "outputAs": "final_result"
    }
  ]
}
```

## More Examples

### Example 1: "Show worst 5 violations"
```json
{
  "steps": [
    {"id": "fetch", "toolName": "moderation_history", "outputAs": "raw"},
    {"id": "sort", "toolName": "data_sort", "params": {"data": "{{raw.actions}}", "by": "severity", "order": "desc"}, "outputAs": "sorted"},
    {"id": "limit", "toolName": "data_slice", "params": {"data": "{{sorted}}", "mode": "first", "count": 5}}
  ]
}
```

### Example 2: "Show violations containing 'spam'"
```json
{
  "steps": [
    {"id": "fetch", "toolName": "moderation_history", "outputAs": "raw"},
    {"id": "filter", "toolName": "data_filter", "params": {"data": "{{raw.actions}}", "field": "reason", "condition": "contains", "value": "spam"}}
  ]
}
```

### Example 3: "Show bans and kicks only"
```json
{
  "steps": [
    {"id": "fetch", "toolName": "moderation_history", "outputAs": "raw"},
    {"id": "filter", "toolName": "data_filter", "params": {"data": "{{raw.actions}}", "field": "type", "condition": "in_array", "value": ["ban", "kick"]}}
  ]
}
```

## Benefits

### ✅ Flexibility
AI can understand nuanced queries like "only last", "worst 3", "sorted by date"

### ✅ Reusability
Data tools work with ANY data source, not just moderation_history

### ✅ Composability
Complex queries = Simple tools combined

### ✅ AI Power
LLM decides which tools to use and in what order

### ✅ Maintainability
Each tool does one thing well

## Tool Return Format

For data to be pipeable, tools must return:

```typescript
{
  success: true,
  data: [...], // Array or object that can be passed to next tool
  message: "...",
  metadata: {...}
}
```

The `data` field is what gets stored in variables and passed between steps.

## Future Enhancements

- `data_group` - Group by field
- `data_aggregate` - Count, sum, average
- `data_join` - Combine multiple datasets
- `data_transform` - Map/reduce operations
- Conditional pipelines (if/else based on data)
