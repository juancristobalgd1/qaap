# Codex and the Qaap tool gate

Spike results on `codex-cli 0.165.0` (run with a temporary `CODEX_HOME` and a fake OpenAI-compatible provider).

| Question | Result |
|---|---|
| `hooks.json` shape | `{"hooks":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"…","timeout":<sec>}]}]}}`. The field is `timeout`; `timeoutSec` is silently ignored (default 600). |
| Hook input | stdin JSON: `tool_name` (`Bash`, `mcp__…`), `tool_input` (`{command}`), `cwd`, `tool_use_id`, `model`, `permission_mode`. |
| Hook output | `hookSpecificOutput.permissionDecision` `allow`/`deny` (+ `permissionDecisionReason`, `updatedInput`) with exit 0 is honoured; `updatedInput` rewrites the command. `ask` is NOT honoured (the tool runs). Exit 2 blocks and shows stderr. Any other exit (crash, 1) and a hook timeout let the tool RUN. |
| Can a hook wait? | Yes. A 150 s hook completed and its answer applied; `timeout` up to 900 s is accepted. The command runs in a shell. |
| Hook trust | An untrusted hook is skipped silently. Trust is `config.toml` `[hooks.state."<canonical hooks.json path>:pre_tool_use:0:0"] trusted_hash = "sha256:…"`, where the hash is sha256 of the key-sorted JSON `{"event_name":"pre_tool_use","hooks":[{"async":false,"command":…,"timeout":…,"type":"command"}],"matcher":"*"}`. The path is canonical (macOS `/var` vs `/private/var`). |
| Project hooks | `codex exec` writes `[projects."<cwd>"] trust_level = "trusted"` itself, so with no entry project hooks and config DO load (and `--dangerously-bypass-hook-trust` would run them). An explicit `trust_level = "untrusted"` entry is honoured and keeps them out, even with the bypass flag. |

Decisions: pre-seed hook trust (no bypass flag), write an explicit `untrusted` project entry for untrusted folders, verify
trust with `codex app-server` `hooks/list` once per Codex version (an untrusted hook would fail open), and keep the ask
window (600 s) below the hook timeout (660 s). Pre-seeding relies on Codex's hash algorithm, which is not a public
contract: the probe turns any drift into a failed spawn instead of an ungated run.

Wiring: `QaapCodexGateOverlayBuilder` (`qaap-codex-gate-overlay.ts`) builds `CODEX_HOME=<tmp>/<task>/codex-home` at
spawn (copy of `auth.json`, filtered owner `config.toml`, generated `hooks.json`), `resources/qaap-tool-gate-codex-hook.mjs`
is the fail-closed hook, and the overlay is deleted when the process closes. A login Codex refreshed during the task is
written back to the owner's home before deletion, because refresh tokens rotate.
