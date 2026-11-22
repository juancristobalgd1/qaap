# ACP bridge (harness design F1)

Qaaq runs Agent Client Protocol (ACP v1) agents through a **bridge** that sits next to the agent:
`packages/qaap-cloud-workspace/resources/qaap-acp-bridge.mjs`. The task runner still starts one process per
turn. That process is the bridge, which speaks ACP to the agent over stdio, routes permission requests to the
Tool Gate and prints a stream the runner already parses.

```
runner ──spawn (host / tenant / task sandbox)──▶ node qaap-acp-bridge.mjs --flavor X -- <agent acp argv>
                                                     │  ACP v1 NDJSON (initialize, session/new, session/prompt)
                                                     ├──▶ agent (same process group)
                                                     │  session/request_permission ──▶ askGate ──HTTP──▶ Tool Gate
                                                     └──▶ stdout: Claude stream-json (OpenCode) or plain text (Copilot)
```

## Deviation from the approved design

The design (`docs/qaap-unified-harness-acp-design.md`, sections 3.1–3.2) put an ACP client in the backend
(`ClientSideConnection` from `@agentclientprotocol/sdk`), behind `QaapHarnessAdapter.startSession`. F1 runs the
client **where the agent runs** instead. An independent review approved this with conditions (listed under
Security). Reasons:

- No change to the runner's turn model (one process per turn, end of turn by exit code, SSE flush order).
- Cancel and kill work as for every other harness: the runner's group kill reaches the bridge and the agent. That
  removes the design's open `docker exec` kill problem (3.2).
- Paths are right inside the sandbox, and no SDK runs at runtime (the client is hand-written, Node built-ins only).
- F3 (persistent sessions) remains possible without a long-lived bridge: the design already recommends one process
  per turn plus `session/resume` (section 5), which a one-shot bridge can do given the session id.

## Flavors and flags

| Flavor | Flag (`1` enables) | Agent command | Who guards tool calls | Output |
|---|---|---|---|---|
| OpenCode | `QAAP_HARNESS_ACP_OPENCODE` | `opencode acp` | Qaap's gate plugin, pre-execution, as for native OpenCode | Claude stream-json |
| Copilot | `QAAP_HARNESS_ACP_COPILOT` | `copilot --acp` | The bridge (`session/request_permission` → gate) | Plain text |

Verified against real CLIs on 23 Nov 2026:

- **OpenCode 1.19.6:** `opencode acp` loads `OPENCODE_CONFIG_CONTENT` plugins and calls `tool.execute.before`
  for every tool. OpenCode-ACP therefore keeps the pre-execution gate, `updatedInput` and `/arm`. Without
  `ask` rules, OpenCode-ACP never sends `request_permission`. With them, it does, and a rejection prevents the
  write.
- **Copilot CLI 1.0.114:** `copilot --acp` asks before edits and shell commands by default. A gate deny stopped
  the call and nothing was written. Its tool titles describe the call ("Create note.txt and list…"), so the gate
  gets the Claude name of the ACP kind (`Bash`, `Edit`…).

With a flag on, the runner (`qaap-agent-task-runner-timeline2.ts`) replaces the native command after it has added
the gate and delegation env (`resolveQaapAcpSpawnCommand`):

- Model: read from the native command line (`--model`), set through the session's `model` config option.
- Mode: `ask` / `auto` / `readonly`, from the task.
- In a task sandbox: the bridge and its gate client (`qaap-tool-gate-pi.mjs`) are copied **fresh for every
  turn** below the sandbox's shared root, in private 0600 files released with the task. The agent shares the
  uid, so it can write to a copy, but no later turn reuses one. The gate client is loaded before the agent starts.

Readers: OpenCode logs are recognized by the bridge's first line (`{"type":"system","qaap_transport":"acp",...}`)
and parsed with the Claude parser, both live and on replay (`qaap-acp-bridge-stream.ts`). Copilot stays plain
text. A structured Copilot transcript would change the native CLI's rendering too, so it is deferred to F4.

Runtime capabilities (`resolveQaapRuntimeHarnessCapabilities`): with its flag on, Copilot goes from
`runs-unchecked` to `gate: 'acp'`, `canAsk`, a 600 s ask and `enforcement: 'client-boundary'`. The runner then
issues the gate token and the endpoint lets it ask. OpenCode's entry does not change.

## Security (the review's conditions)

- **Client capabilities:** neither `fs/*` nor `terminal/*` is announced, and every agent request other than
  `session/request_permission` gets JSON-RPC -32601.
- **Granting:** only with an `allow_once` option, only after a well-formed gate `allow`. An `allow` that carries
  `updatedInput` is a deny, since ACP cannot pass a rewritten input. The bridge never chooses `allow_always`,
  which would make the agent stop asking. It chooses by kind, never by option id or label, and ambiguity or a
  missing option means `cancelled`.
- **Gate down:** if the gate is unreachable or not configured, the answer is a deny. Three transport failures in
  a row stop the run, as with Pi.
- **Sessions:** updates for another session id are dropped.
- **Protocol limits:** a line over 4 MiB, more than 2000 messages per second or non-JSON-RPC output kill the
  agent, with exit code 14.
- **Exit codes:** 0 `end_turn`, 10 cancelled, 11 refusal, 12 limit, 13 sign-in needed, 14 protocol,
  15 agent died, 16 old ACP version, 17 spawn failure. Each comes with a `[qaap]` stderr line.
- **Cancel:** SIGTERM sends `session/cancel` and answers pending permissions with `cancelled`. If the agent
  ignores it, the bridge kills it after 3 s. The agent runs in the bridge's process group, not detached.
- **Waiting on an approval:** while a permission waits on the user, the bridge prints a heartbeat line every 15 s.
- **Unasked mutations:** when the bridge is the only checkpoint (Copilot), a mutating call (edit / delete /
  move / execute) that completes without a granted permission is reported as `unpermitted-mutation` on stderr
  and in the stream. This is the `client-boundary` case: a hostile agent can still mutate, and only the sandbox
  bounds it.
- **Credentials:** for Copilot, the gate env is removed from the agent's env. OpenCode keeps it because its own
  gate plugin needs it, as today. Nothing secret goes on the command line.
- **Known residual risk:** the gate token is in the bridge's env, readable through `/proc/<pid>/environ` by the
  same uid. This matches the Codex hook and the OpenCode plugin today. Passing it by descriptor or by a 0600 file
  removed after reading is still pending.

## Pending before enabling in production

- E2E inside the real app, locally and in VPS staging with the task sandbox, including a parent→child
  delegation, a cancel with the kill checked inside the container, and a read-only turn.
- A/B benchmark: native OpenCode vs OpenCode-ACP.
- The runner does not yet act on `unpermitted-mutation`: it is only logged.
- Forcing the mode before the first prompt (3.8 step 1) for flavors that expose modes. Neither OpenCode nor
  Copilot needed it: OpenCode is gated by its plugin and permission env, Copilot by the bridge.
- The browser still shows Copilot as `runs-unchecked`: the UI reads static capabilities.
- Conformance specs against the SDK's `AgentSideConnection` as a devDependency. Today they run against the
  hand-written fake agent in `test-resources/acp/`.
