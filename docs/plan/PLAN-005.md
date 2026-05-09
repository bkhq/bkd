# PLAN-005 Fix OpenCode hanging without error on quota exhaustion

- **status**: completed
- **createdAt**: 2026-05-09 10:30
- **approvedAt**: (pending)
- **relatedTask**: BUG-001

## Context

When OpenCode (ACP agent) encounters quota exhaustion or other API failures, the underlying `connection.prompt()` call from `@agentclientprotocol/sdk` may hang indefinitely without resolving or rejecting. The OpenCode process itself stays alive (OS-level process is still running), but no ACP events are emitted to stdout.

Current behavior:
1. User sends a message
2. `AcpProtocolHandler.runPrompt()` calls `this.connection.prompt()`
3. OpenCode internally hits quota limit → internal API call stalls
4. No `acp-error` or `acp-prompt-result` event is emitted
5. The stdout stream remains open but silent
6. `consumeStream` waits indefinitely for output
7. After 3 minutes, GC detects stall; after 7 minutes total, force-kills the process
8. User sees "thinking" spinner for 7+ minutes with no error explanation

The problem is that the ACP protocol handler has no upper bound on how long `prompt()` can take. Unlike HTTP APIs with built-in timeouts, the ACP SDK's `prompt()` is a long-running call that can legitimately take minutes (for complex reasoning), but it should never hang forever.

## Proposal

Add a timeout wrapper around `this.connection.prompt()` in `AcpProtocolHandler.runPrompt()`. When the timeout fires:
1. Emit an `acp-error` event with a descriptive message
2. Emit an `acp-prompt-result` event with `stopReason: 'error'` so the normalizer produces a turn-completion entry
3. Attempt to cancel the session via `this.connection.cancel()`

This gives the user immediate feedback instead of waiting 7 minutes for GC force-kill.

### Code Change

In `apps/api/src/engines/executors/acp/protocol-handler.ts`, modify `runPrompt()`:

```typescript
private async runPrompt(prompt: string, attachments?: EngineAttachment[]): Promise<void> {
  if (!this.sessionId) {
    throw new Error('ACP session is not initialized')
  }

  const startedAt = Date.now()
  this.onActivity?.()

  const contentBlocks: ContentBlock[] = [{ type: 'text', text: prompt }]

  if (attachments?.length) {
    for (const attachment of attachments) {
      const imageBlock = await this.buildImageBlock(attachment)
      if (imageBlock) {
        contentBlocks.push(imageBlock)
      }
    }
  }

  try {
    const result = await this.runPromptWithTimeout(contentBlocks, startedAt)

    this.sink.emit({
      type: 'acp-prompt-result',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      stopReason: result.stopReason,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ACP prompt failed'
    this.sink.emit({
      type: 'acp-error',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      error: message,
    })
    this.sink.emit({
      type: 'acp-prompt-result',
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      stopReason: 'error',
      durationMs: Date.now() - startedAt,
      error: message,
    })
  }
}

private async runPromptWithTimeout(
  contentBlocks: ContentBlock[],
  startedAt: number,
): Promise<{ stopReason: string }> {
  const PROMPT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`ACP prompt timed out after ${PROMPT_TIMEOUT_MS / 60000} minutes`))
    }, PROMPT_TIMEOUT_MS)

    this.connection
      .prompt({
        sessionId: this.sessionId!,
        prompt: contentBlocks,
      })
      .then((result) => {
        clearTimeout(timeout)
        resolve(result)
      })
      .catch((error) => {
        clearTimeout(timeout)
        reject(error)
      })
  })
}
```

The 10-minute timeout is a balance:
- Complex reasoning/tasks legitimately take several minutes
- But 10 minutes is well below the GC stall detection threshold (3min), so users get feedback much faster
- If a task truly needs more than 10 minutes, it can be split into smaller prompts

### Additional Considerations

1. **Cancel on timeout**: After timeout rejection, the `catch` block already emits error events. We should also attempt to cancel the hung session to free resources:

```typescript
catch (error) {
  const message = error instanceof Error ? error.message : 'ACP prompt failed'
  // ... emit events ...
  // Attempt to cancel the hung prompt
  void this.interrupt().catch(() => {})
}
```

2. **Constants**: Define `ACP_PROMPT_TIMEOUT_MS` in `apps/api/src/engines/issue/constants.ts` alongside other timeout constants.

3. **Test impact**: The `protocol-handler.ts` file is part of the ACP executor stack. No existing tests directly test the timeout behavior. The change is additive and only affects the error path.

## Risks

1. **False positives for long-running tasks**: A 10-minute timeout might interrupt genuinely long reasoning chains. However:
   - The GC already force-kills after 7 minutes anyway, so this is actually more lenient
   - Users can retry with smaller prompts
   - The timeout error message clearly explains what happened

2. **SDK cancel behavior**: Calling `interrupt()` on a timed-out session may fail or have side effects. We wrap it in `catch(() => {})` to make it best-effort.

## Scope

- Modify `apps/api/src/engines/executors/acp/protocol-handler.ts`
- Add constant to `apps/api/src/engines/issue/constants.ts`
- ~30 lines of code changed

## Alternatives

1. **Shorter timeout (5 min)**: More aggressive, but higher false-positive rate for legitimate long tasks.
2. **No timeout, rely on GC**: Current behavior — bad UX.
3. **Configurable timeout per engine**: More flexible but adds complexity. Can be done later if needed.

## Annotations

(User annotations and responses. Keep all history.)
