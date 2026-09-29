# Qaap agent lifecycle hooks

Qaap runs external agent CLIs (qaiq, codex, claude, …) one turn at a time through
`QaapAgentTaskRunner`. Agent hooks are shell commands Qaap itself runs around those turns, whatever
CLI drives them. The configuration format is compatible with Claude Code's `hooks` JSON.

## Configuration

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "./scripts/check-bash.sh", "timeout": 30 }] }
    ],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "git branch --show-current" }] }]
  }
}
```

Sources:

| Source | Location | Review |
|---|---|---|
| User | settings key `qaap.agentHooks` (same object) and `~/.qaap/hooks.json` in the HOME hooks run under (the tenant HOME with uid isolation; the backend HOME only for unowned / skip-auth runs) | none — the user's own config |
| Workspace | `.qaap/hooks.json`, found from the turn's cwd upwards to the git root | **must be trusted** |

`matcher` follows Claude Code: empty or `*` matches all, `A|B` matches tool names exactly, anything
else is a regex. `timeout` is in seconds (default 60, max 600). Only `command` hooks are supported.

## Events and semantics

| Event | Where it fires | Effect |
|---|---|---|
| `SessionStart` | before the first turn this backend process sees for a conversation (`source: "startup"`) | stdout is added as context |
| `UserPromptSubmit` | before the CLI command is built (`applyPreTurnAgentHooks` in `spawnProcessWhenReady`) | exit 2 blocks the turn (task fails, stderr in the log); stdout / `additionalContext` is appended to the prompt |
| `PreToolUse` | QAIQ stdio `control_request` approvals (`createQaiqPreToolUseHookGate` in `spawnProcessExtracted`) | exit 2 or `deny` rejects with the reason; `allow` approves (Qaap's destructive / dev-server guards still apply); `ask` queues it for the user; no decision falls through to normal auto-approval |
| `PostToolUse` | finished tool segments of the streaming agent reply (`QaapAgentPostToolUseHookBridge`) | notification only |
| `Stop` | a running/queued task finishes (`QaapAgentTaskRunner.finishTask`) | notification only |

Hook input is JSON on stdin: `session_id` (conversation id, else task id), `cwd`, `hook_event_name`,
plus `prompt`, `tool_name` / `tool_input` / `tool_response` / `tool_use_id`, `source`, and
`qaap_task_id` / `qaap_turn_state`. Env adds `CLAUDE_PROJECT_DIR` / `QAAP_PROJECT_DIR`,
`QAAP_HOOK_EVENT`, `QAAP_HOOK_SOURCE`; backend secrets (`*TOKEN*`, `*API_KEY*`, …) are stripped.

Exit 0 = success (stdout may be JSON: `decision`, `reason`, `continue:false` + `stopReason`,
`hookSpecificOutput.permissionDecision` / `permissionDecisionReason` / `additionalContext`); exit 2 =
blocking; anything else, a timeout or a spawn failure = non-blocking error. Errors never fail a
turn: they are logged (`[qaap-agent-hooks]`) and kept as warnings returned by the status endpoint.

All hook processes are spawned through `QaapTenantSpawnService.spawnPreparedAsync`
(`QaapAgentHookProcessRunner`), i.e. under the same tenant identity / container as the agent CLI.

## Workspace trust review

Workspace hooks do not run until the owner trusts them. Trust is stored in SQLite
(`agent-hook-trust` namespace, `@theia/qaap-persistence`) keyed by owner login + canonical repo root
and bound to the sha256 of the normalized declaration (`normalizeQaapAgentHookDeclaration`); any
change to an event, matcher, command or timeout returns the workspace to `pending`. Formatting-only
edits do not. Symlinked `.qaap` dirs/files and files over 64 KB are refused.

REST (`QAAP_AGENT_HOOKS_API_PATH = /api/qaap/agent-hooks`, owner-checked like the other agent APIs):

- `GET ?cwd=` → user hooks, workspace declaration (`state`: `none|pending|trusted|ignored`, `digest`, commands), recent warnings.
- `POST /trust`, `POST /ignore` with `{ cwd, digest }` → 409 when the file changed since the listing.
- `POST /revoke` with `{ cwd }`.

UI: `QaapAgentHooksTrustContribution` shows a notification listing the commands with **Trust** /
**Ignore** when the open project has pending workspace hooks (checked on workspace open and on
window focus, at most once a minute).

## Limitations

- `PreToolUse` only covers approvals Qaap mediates (QAIQ stdio control requests); CLIs that decide
  tool use internally (codex, legacy y/n stdin prompts) only get `PostToolUse`.
- `SessionStart` tracking is in memory: the first turn after a backend restart fires it again.
- `Stop` / `PostToolUse` cannot block or continue a turn; hooks run in parallel per event.
- A conversation in a separate worktree path is a separate workspace identity and needs its own review.
