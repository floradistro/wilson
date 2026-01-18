# Verify Local Tools Are Working

## Test 1: Ask Wilson to Read a File

```bash
wilson "read the package.json file and tell me what dependencies we have"
```

**Expected:**
- Wilson sends `local_tools` (including `read_file`) to backend
- Backend shows Read tool to Claude
- Claude requests Read tool
- Backend sends `pause_for_tools` event
- Wilson executes `read_file` locally
- Returns content to backend
- Claude sees content and responds

**If working:** You'll see file content and get a response about dependencies

**If broken:** Wilson will loop endlessly or say "I don't have access to file operations"

---

## Test 2: Ask Wilson to Write a File

```bash
wilson "create a new file called test.txt with the content 'hello world'"
```

**Expected:**
- Claude requests `write_file` tool
- Wilson executes it locally
- File is created

**Verify:** `cat test.txt` should show "hello world"

---

## Test 3: Check Debug Logs

Run Wilson with verbose logging to see the flow:

```bash
# Option 1: If Wilson has --verbose flag
wilson --verbose "read package.json"

# Option 2: Check network requests
# Open network inspector and look for /agentic-loop requests
# Verify 'local_tools' is in request body
```

**Look for:**
1. Request includes `local_tools: [...]` array
2. Response includes `pause_for_tools` events
3. Wilson logs show "Executing tool: read_file"
4. Second request includes `tool_results` in conversation history

---

## Test 4: Backend Edge Function Logs

Check Supabase logs for agentic-loop function:

```bash
supabase functions logs agentic-loop --limit 100
```

**Look for:**
- "Received local_tools: X tools"
- "Merged X local + Y database tools"
- "Claude requested local tool: read_file"
- "Sending pause_for_tools event"

---

## Common Issues

### Issue 1: Backend Not Accepting local_tools

**Symptom:** Claude says "I don't have access to file operations"

**Fix:** Backend needs to accept `local_tools` in interface:
```typescript
interface AgenticRequest {
  message: string;
  history: Message[];
  store_id?: string;
  local_tools?: ToolSchema[];  // ← Must be here
  // ...
}
```

### Issue 2: Backend Not Merging Tools

**Symptom:** Claude can see database tools but not local tools

**Fix:** Backend must merge tools before calling Claude:
```typescript
const allTools = [
  ...request.local_tools || [],
  ...databaseTools
];

await anthropic.messages.create({
  tools: allTools,  // ← Must include local tools
  // ...
})
```

### Issue 3: Backend Not Sending pause_for_tools

**Symptom:** Wilson gets tool requests but backend tries to execute them itself

**Fix:** Backend must check if tool is local:
```typescript
const requestedTools = getToolsFromClaude(response);
const hasLocalTools = requestedTools.some(t =>
  request.local_tools?.find(lt => lt.name === t.name)
);

if (hasLocalTools) {
  // Send pause_for_tools event
  sendSSE({
    type: 'pause_for_tools',
    pending_tools: requestedTools,
    assistant_content: response.content  // ← Must be raw array!
  });
  return;  // Don't execute tools server-side
}
```

### Issue 4: Losing tool_use Blocks

**Symptom:** Wilson executes tools but Claude requests them again endlessly

**Fix:** Backend MUST send `assistant_content` as **raw array**, not string:
```typescript
// ✅ CORRECT
{
  type: 'pause_for_tools',
  assistant_content: [
    { type: 'text', text: 'Let me read that file' },
    { type: 'tool_use', id: 'xxx', name: 'read_file', input: {...} }
  ]
}

// ❌ WRONG
{
  type: 'pause_for_tools',
  assistant_content: "Let me read that file"  // Lost tool_use blocks!
}
```

Wilson preserves this at `useStream.ts:146`:
```typescript
const assistantContent = raw.assistant_content as unknown[] | undefined;
// ↑ Must be array, not string!
```

---

## Expected Flow Diagram

```
User: "read package.json"
  ↓
Wilson → Backend
  - message: "read package.json"
  - local_tools: [{name: "read_file", ...}, ...]
  ↓
Backend → Claude API
  - tools: [local_tools + database_tools]
  ↓
Claude: "I'll use read_file tool"
  - returns: content: [text_block, tool_use_block]
  ↓
Backend → Wilson (SSE)
  - type: "pause_for_tools"
  - pending_tools: [{id, name: "read_file", input}]
  - assistant_content: [text_block, tool_use_block]  ← RAW!
  ↓
Wilson executes locally:
  - reads package.json
  - result: {tool_use_id, content: "...file content..."}
  ↓
Wilson → Backend (continuation)
  - history: [
      {role: "user", content: "read package.json"},
      {role: "assistant", content: [text, tool_use]},
      {role: "user", content: [{type: "tool_result", ...}]}
    ]
  ↓
Backend → Claude API (with history)
  ↓
Claude: "Here are the dependencies: ..."
  ↓
Wilson displays response
```

---

## Debugging Commands

### Check if Wilson sends local_tools:
```bash
# In src/services/api.ts, add:
console.log('Sending local_tools:', body.local_tools.map(t => t.name));
```

### Check if Wilson receives pause_for_tools:
```bash
# In src/hooks/useStream.ts, line 142:
console.log('Received pause_for_tools:', pendingTools);
```

### Check if tools execute locally:
```bash
# In src/hooks/useTools.ts, line 50:
console.log('Executing tool:', tool.name, tool.input);
```

### Check if results sent back:
```bash
# In src/hooks/useChat.ts, line 297:
console.log('Sending tool results:', toolResultBlocks);
```

---

## Conclusion

The Wilson client-side implementation is **CORRECT**. If local tools aren't working:

1. **Backend must accept** `local_tools` in request
2. **Backend must merge** local + database tools
3. **Backend must send** `pause_for_tools` when Claude requests local tool
4. **Backend must preserve** `assistant_content` as raw array (not string)

If the other developer implemented all 4 points, it should work. Test with the examples above to verify.
