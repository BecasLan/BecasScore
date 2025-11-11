# GUILD POLICY SYSTEM - TEST SCENARIOS

## 🧪 How to Test the Guild Policy System

### Prerequisites
1. ✅ System is running (`node dist`)
2. ✅ Bot is connected to Discord
3. ✅ You have admin permissions in a test guild
4. ✅ Database migration `030_guild_policy_system.sql` is applied

---

## Test Scenario 1: Create Guild Policy via Natural Language

### Test Steps:

**1. Create a "No Spam" policy:**
```
User: becas, create a policy that bans spam with 1 hour timeout
```

**Expected AI Response:**
```
✅ Guild Policy Created

Rule: No spam
Interpretation: Users should not send repetitive or promotional messages
Action: timeout (1h)
Severity: medium
Category: behavior
Policy ID: abc12345...

⚠️ This is a LOCAL guild policy. It does NOT affect global trust scores.
```

**Verification:**
- Check database: `SELECT * FROM guild_policies WHERE guild_id = 'YOUR_GUILD_ID';`
- Should see new policy with `rule_text = 'No spam'`
- `action_type` should be `timeout`
- `action_params` should contain `{"duration": 3600}`

---

**2. List all policies:**
```
User: becas, show me all server policies
```

**Expected Response:**
```
📋 Guild Policies (1 total)

🟡 Medium Severity
• No spam → timeout
  Users should not send repetitive or promotional messages
  ID: abc12345...

⚠️ These are LOCAL policies. They do NOT affect global trust scores.
```

---

## Test Scenario 2: Guild Policy Enforcement (LOCAL)

### Test Steps:

**1. Create test policy:**
```
User: becas, add policy "No testing allowed" warn
```

**2. Trigger the policy:**
```
User: This is a test message for testing
```

**Expected Behavior:**
- ⚠️ User receives warning in channel: "⚠️ @user, warning: Guild policy: No testing allowed"
- 🛡️ BecasCore logs show: `[GuildPolicyEngineDB] Guild policy violation: "No testing allowed" (confidence: 0.XX)`
- 🛡️ BecasCore logs show: `[GuildPolicyEngineDB] Local action executed: warn`
- ❌ Trust score: **NOT CHANGED** (verify with `becas, check my trust score`)

**Verification:**
- Check database: `SELECT * FROM guild_policy_enforcement WHERE user_id = 'USER_ID';`
- Should see enforcement record with `action_taken = 'warn'`
- Check trust score: Should remain unchanged

---

## Test Scenario 3: Becas Core Violation (GLOBAL)

### Test Steps:

**1. Send message with profanity:**
```
User: Fuck this shit
```

**Expected Behavior:**
- 🚫 Message may be deleted (if severity is high)
- 📉 Trust score decreased by 10-20 points
- 🛡️ BecasCore logs show:
  ```
  [BecasCoreViolationEngine] Core violation detected: profanity (severity: medium, confidence: 0.XX)
  [BecasCoreViolationEngine] Trust score decreased: 100 → 80 (-20 penalty)
  ```

**Verification:**
- Check database: `SELECT * FROM becas_core_violations WHERE user_id = 'USER_ID';`
- Should see violation with `violation_type = 'profanity'`
- Check trust score: `becas, check my trust score` → Should show decreased score

---

## Test Scenario 4: Dual Violation (BOTH Layers)

### Test Steps:

**1. Create guild policy:**
```
User: becas, create policy "No insults" ban
```

**2. Send message that violates BOTH:**
```
User: Fuck you admin, you're garbage
```

**Expected Behavior:**
- 🛡️ **LAYER 1 (Guild Policy):**
  - Detects "No insults" violation
  - LOCAL action: Ban from guild
- 🛡️ **LAYER 2 (Core Violation):**
  - Detects `profanity` violation (severity: high)
  - Trust penalty: -20
  - GLOBAL action: Trust score decrease
- 🚫 Message deleted
- 👤 User banned from THIS guild
- 📉 Trust score: 100 → 80 (or lower)

**Logs:**
```
[GuildPolicyEngineDB] Guild policy violation: "No insults" (confidence: 0.XX)
[GuildPolicyEngineDB] Local action executed: ban
[BecasCoreViolationEngine] Core violation detected: profanity (severity: high, confidence: 0.XX)
[BecasCoreViolationEngine] Trust score decreased: 100 → 80 (-20 penalty)
```

**Verification:**
- User should be banned from guild (check Discord)
- Trust score should be decreased (check database)
- Both `guild_policy_enforcement` and `becas_core_violations` should have records

---

## Test Scenario 5: Policy Discovery (Auto-scan #rules)

### Test Steps:

**1. Create #rules channel with rules:**
```
#rules channel content:
1. No spam or flooding
2. Be respectful to all members
3. No NSFW content
4. English only in #general
```

**2. Manually trigger discovery scan:**
```typescript
// In Discord, if you have a command to trigger manual scan:
User: becas, scan server rules

// OR wait for daily cron job at 3 AM UTC
```

**Expected Behavior:**
- 🔍 PolicyDiscoveryEngine scans #rules channel
- 🤖 AI extracts 4 rules from text
- 📊 Creates 4 new policies in database
- 📋 Logs show:
  ```
  [PolicyDiscoveryEngine] Found rules channel: #rules (123456789)
  [PolicyDiscoveryEngine] Extracted 4 valid rules from text
  [PolicyDiscoveryEngine] Policy discovery complete: 4 rules found, 4 created, 0 updated
  ```

**Verification:**
```sql
SELECT * FROM guild_policies WHERE learned_from = 'server_rules' AND guild_id = 'YOUR_GUILD_ID';
```
Should see 4 policies with:
- `learned_from = 'server_rules'`
- `source_channel_id = #rules channel ID`

---

## Test Scenario 6: Policy Learning from Moderator Actions

### Test Steps:

**1. Moderator performs 3 similar actions:**
```
Moderator: /timeout @user1 reason: spam
Moderator: /timeout @user2 reason: spam
Moderator: /timeout @user3 reason: spam
```

**Expected Behavior:**
- 📊 PolicyLearningEngine detects 3 similar actions
- 🤖 AI synthesizes policy suggestion:
  ```
  Rule: "No spam"
  Action: timeout
  Severity: medium
  ```
- 💬 Suggestion sent to admin channel with reactions (✅/❌)
- 📋 Logs show:
  ```
  [PolicyLearningEngine] Similar actions detected: 3 instances of timeout for "spam"
  [PolicyLearningEngine] Policy suggestion sent to admin channel
  ```

**Verification:**
- Admin should receive suggestion in designated channel
- React with ✅ to approve
- Policy should be created in database

---

## Test Scenario 7: Channel-Specific Policy

### Test Steps:

**1. Create channel-specific policy:**
```
User: becas, create policy "No memes in #serious" timeout 30m
```

**Expected AI Response:**
```
✅ Guild Policy Created

Rule: No memes in #serious
Interpretation: Users should not post memes in the #serious channel
Action: timeout (30m)
Severity: low
Category: channel_specific
Policy ID: xyz78901...
```

**2. Post meme in #serious:**
```
User (in #serious): [posts meme image]
```

**Expected Behavior:**
- 🛡️ Policy triggered (channel matches)
- ⚠️ User timed out for 30 minutes
- 📋 Logs show: `[GuildPolicyEngineDB] Channel-specific policy matched: #serious`

**3. Post meme in #general:**
```
User (in #general): [posts meme image]
```

**Expected Behavior:**
- ✅ No action taken (policy only applies to #serious)
- 📋 Logs show: `[GuildPolicyEngineDB] Skipping channel-specific policy (channel mismatch)`

---

## Test Scenario 8: Update Policy

### Test Steps:

**1. Update policy action:**
```
User: becas, update policy abc12345 action ban
```

**Expected Response:**
```
✏️ Policy Updated

Rule: No spam
Updated Field: action
New Value: ban
```

**Verification:**
```sql
SELECT * FROM guild_policies WHERE id LIKE 'abc12345%';
```
Should show `action_type = 'ban'` (changed from `timeout`)

---

## Test Scenario 9: Remove Policy

### Test Steps:

**1. Remove policy:**
```
User: becas, remove policy abc12345
```

**Expected Response:**
```
🗑️ Policy Removed

Rule: No spam
Action: ban
```

**Verification:**
```sql
SELECT * FROM guild_policies WHERE id LIKE 'abc12345%';
```
Should show `is_active = false` (soft delete)

---

## Test Scenario 10: Cross-Guild Isolation

### Test Steps:

**1. Create policy in Guild A:**
```
Guild A: becas, create policy "No politics" ban
```

**2. Check policies in Guild B:**
```
Guild B: becas, list policies
```

**Expected Response in Guild B:**
```
📋 No active policies found for this server.
```

**Verification:**
- Policies in Guild A should NOT appear in Guild B
- Database query confirms:
  ```sql
  SELECT COUNT(*) FROM guild_policies WHERE guild_id = 'GUILD_A_ID';  -- Should be > 0
  SELECT COUNT(*) FROM guild_policies WHERE guild_id = 'GUILD_B_ID';  -- Should be 0
  ```

---

## Verification Queries

### Check all guild policies:
```sql
SELECT
  rule_text,
  action_type,
  severity,
  learned_from,
  is_active,
  created_at
FROM guild_policies
WHERE guild_id = 'YOUR_GUILD_ID'
ORDER BY created_at DESC;
```

### Check policy enforcement history:
```sql
SELECT
  p.rule_text,
  e.user_id,
  e.action_taken,
  e.confidence,
  e.created_at
FROM guild_policy_enforcement e
JOIN guild_policies p ON e.policy_id = p.id
WHERE e.guild_id = 'YOUR_GUILD_ID'
ORDER BY e.created_at DESC
LIMIT 10;
```

### Check core violations:
```sql
SELECT
  user_id,
  violation_type,
  severity,
  trust_penalty,
  action_taken,
  timestamp
FROM becas_core_violations
WHERE guild_id = 'YOUR_GUILD_ID'
ORDER BY timestamp DESC
LIMIT 10;
```

### Check trust score changes:
```sql
SELECT
  user_id,
  old_score,
  new_score,
  change_amount,
  reason,
  changed_at
FROM trust_score_changes
WHERE user_id = 'USER_ID'
ORDER BY changed_at DESC
LIMIT 5;
```

---

## Expected Log Patterns

### Successful Policy Creation:
```
[PolicyManagementTool] Creating policy: "No spam"
[OllamaService] Generating AI interpretation...
[GuildPolicyEngineDB] Policy added: "No spam" for guild 123456789
[BecasToolRegistry] Tool execution: policy_management (success)
```

### Guild Policy Violation:
```
[BecasCore] 🛡️ Checking guild policies...
[GuildPolicyEngineDB] Loaded 5 policies for guild 123456789
[GuildPolicyEngineDB] Checking policy: "No spam"
[OllamaService] [guildPolicyMatching] Analyzing message...
[GuildPolicyEngineDB] Guild policy violation: "No spam" (confidence: 0.85)
[GuildPolicyEngineDB] Local action executed: timeout
[BecasCore] ⚠️ Guild policy violations detected: 1
```

### Core Violation:
```
[BecasCore] 🛡️ Checking Becas core violations...
[BecasCoreViolationEngine] Checking violation type: profanity
[OllamaService] [coreViolationDetection] Analyzing message...
[BecasCoreViolationEngine] Core violation detected: profanity (severity: high, confidence: 0.92)
[TrustScoreEngineDB] Decreasing trust score for user 987654321: 100 → 80 (-20 penalty)
[BecasCoreViolationEngine] Global action executed: timeout
```

### Policy Discovery:
```
[PolicyDiscoveryEngine] Daily policy discovery scan started
[PolicyDiscoveryEngine] Scanning guild: TestServer (123456789)
[PolicyDiscoveryEngine] Found rules channel: #rules (987654321)
[PolicyDiscoveryEngine] Found 1024 chars of rules text
[OllamaService] [policyDiscovery] Extracting rules...
[PolicyDiscoveryEngine] Extracted 8 valid rules from text
[GuildPolicyEngineDB] Creating policy: "No spam or flooding"
[GuildPolicyEngineDB] Creating policy: "Be respectful to all members"
[PolicyDiscoveryEngine] Policy discovery complete: 8 rules found, 8 created, 0 updated
```

---

## Common Issues & Troubleshooting

### Issue 1: Policy not triggering
**Symptoms:** Message violates policy but no action taken

**Checks:**
1. Verify policy is active: `SELECT is_active FROM guild_policies WHERE id = 'POLICY_ID';`
2. Check AI confidence: Logs should show confidence > 0.7
3. Verify guild_id matches: `SELECT guild_id FROM guild_policies WHERE id = 'POLICY_ID';`
4. Check channel-specific policies: `SELECT source_channel_id FROM guild_policies WHERE id = 'POLICY_ID';`

---

### Issue 2: Trust score not changing
**Symptoms:** Core violation detected but trust score unchanged

**Checks:**
1. Verify it's a CORE violation, not just guild policy
2. Check logs for `[TrustScoreEngineDB] Decreasing trust score...`
3. Query database: `SELECT * FROM becas_core_violations WHERE user_id = 'USER_ID';`
4. Check `trust_penalty` value in violation record

---

### Issue 3: Policies appearing in wrong guild
**Symptoms:** Policy created in Guild A shows in Guild B

**Checks:**
1. Verify guild_id in database: `SELECT guild_id FROM guild_policies WHERE id = 'POLICY_ID';`
2. Check policy cache: Restart bot to clear cache
3. Review logs for policy loading: Should show correct guild_id

---

## Success Criteria

✅ **Guild Policy System is working if:**

1. Policies can be created via natural language ✅
2. Policies are enforced on messages ✅
3. Guild policies do NOT affect trust score ✅
4. Core violations DO affect trust score ✅
5. Policies are isolated per guild ✅
6. Daily discovery scans #rules channels ✅
7. Policy learning detects moderator patterns ✅
8. Channel-specific policies only trigger in correct channel ✅
9. Policy updates/removals work correctly ✅
10. All enforcement is logged to database ✅

---

**Testing Status:** Ready for manual testing
**Estimated Testing Time:** 30-60 minutes for full test suite
