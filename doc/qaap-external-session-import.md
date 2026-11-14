# Importing conversations from other agent CLIs

Open a project in Qaap, see the conversations that project had in Claude Code, Codex, OpenCode or Pi
(T3 Code included: it drives those same CLIs and they write their native logs), import one with a click and
keep working on it from the Work Hub.

## Sources and project filter

All paths resolve from the backend's own home directory through `QaapUsageRoots` (the same roots the Usage
panel reads), so `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `PI_CODING_AGENT_SESSION_DIR` and `XDG_DATA_HOME` are honoured.

| CLI | Where | Session id | Project filter |
|---|---|---|---|
| Claude Code | `<config>/projects/<slug>/<uuid>.jsonl` (subagent logs in `<uuid>/` are ignored) | `sessionId` on every line (= file name) | `slug = cwd.replace(/[^A-Za-z0-9]/g, '-')` picks the folder; the `cwd` field of the first entry must equal the project path (slugs are lossy) |
| Codex | `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl` | `session_meta.payload.id` | `session_meta.payload.cwd` |
| OpenCode | `<data>/opencode/opencode.db` (SQLite, current) and the legacy `storage/{session,message,part}` JSON tree | `session.id` | `session.directory` |
| Pi | `<pi sessions>/--<cwd with / as ->--/*.jsonl` | `session` header `id` | `session` header `cwd` |
| T3 Code | nothing extra: its threads run Codex/Claude, whose native logs above already hold them (`originator: "T3 Code"` in Codex `session_meta`) | — | — |

Sessions that Qaap itself started (its CLI turns also write native logs) are hidden: their first user
message carries the Qaap prompt markers (`[QAAP task context]`, `[Qaap interaction-mode system instruction]`).

Listing reads only the head and tail of each log (first user message, cwd, title, timestamps), so a 10 MB
Claude session costs two small reads. The full file is parsed only on import.

## Mapping to the transcript

Every source becomes `QaapAgentMessage[]`: user turns as `role: 'user'` with the clean text, and each
assistant turn as one `role: 'agent'` message whose `traceEvents` are:

| Source item | Trace event |
|---|---|
| Claude `text` block / Codex assistant `output_text` / OpenCode `text` part / Pi `text` | `assistant_text` |
| Claude `thinking` (non-empty) / Codex `reasoning.summary` / OpenCode `reasoning` / Pi `thinking` | `thought` |
| Claude `tool_use` + `tool_result` / Codex `function_call`, `custom_tool_call`, `web_search_call` + outputs / OpenCode `tool` part (state carries input and output) / Pi `toolCall` + `toolResult` | `tool_call` (result truncated to 8 KB, `failed` when the tool reported an error) |

Consecutive assistant items between two user turns are one agent message, so the transcript paints them
like a native Qaap turn. Meta entries (slash-command echoes, system reminders, AGENTS.md / environment
context injections, sidechains) are dropped. Imports are capped (last 400 messages) so a giant session
cannot blow the conversation store.

## Continuing the thread

Qaap runs every turn as a stateless CLI call and replays the history in the prompt
(`buildConversationAgentPrompt`, with compaction). An imported conversation therefore continues with
**any** harness out of the box — that is the cross-harness path (b): the imported turns are the history
preamble, exactly like Qaap's own turns.

The conversation also keeps `externalSession: { source, sessionId, importedMessageCount }`. When the next
turn runs on the **same** CLI and every user turn since the import ran on it too, the turn resumes the
CLI's own session instead (path a) and sends only the new message, so the agent sees its full real context
(tool outputs, files read, thinking):

- Claude Code: `claude --resume <id> --print …` (keeps the same session id; verified with 2.1.319).
- Codex: `codex exec <exec flags> resume <id>` with the prompt on stdin (keeps the same thread id;
  verified with 0.167.0 — exec-level flags must come before `resume`).
- OpenCode / Pi: no native resume yet (`pi` runs with `--no-session`); they use path (b).

Once a turn of the thread runs on another harness, the native session no longer has the whole thread, so
Qaap falls back to path (b) for good.

The store sends both prompts (`nativeResumeSessionId` + `nativeResumeFallbackPrompt` on the task request);
the runner picks the short one only when `QaapExternalNativeResume.plan` proves the session is reachable from
the agent, so a turn never runs without its context:

- Claude: the session log must exist and the agent's `CLAUDE_CONFIG_DIR` (or `HOME/.claude`) must be the one
  it was imported from.
- Codex: Qaap runs every Codex turn in a per-task `CODEX_HOME` (the Tool Gate overlay), so the imported
  rollout is copied into the overlay's `sessions/` at the same relative path and written back when the turn
  ends — only if Codex appended to it and the user's copy did not change meanwhile. When the overlay is built
  for another uid (root backend dropping to the agent uid) this process cannot write back, so the turn uses
  path (b) instead.

## Rules

- Per-tenant only on hosted runtimes (same gate as Usage): a shared backend's home belongs to the operator.
- The `cwd` goes through `resolveOwnedRepositoryCwd`; only logs whose own cwd equals that path are listed.
- Read-only: Qaap never writes the source logs. The imported conversation is a copy; only a native resume
  appends to the CLI's session, which is what that CLI would do itself.
- Deduplicated by `(source, sessionId)` per owner: importing twice opens the existing conversation.

## API

- `GET /qaap/api/external-sessions?cwd=<project>` → `{ sessions: QaapExternalSessionSummaryDTO[] }`
- `POST /qaap/api/external-sessions/import` `{ cwd, source, sessionId }` → the conversation (201 new, 200 existing)
