// Qaap tool gate PreToolUse hook for Codex (`hooks.json` command). Standalone: Node built-ins plus the
// sibling Pi extension's `askGate` client, so the retry and fail-closed logic exists once.
//
// Protocol facts verified against codex-cli 0.165 (see doc/qaap-codex-tool-gate.md):
//   * stdin is the hook JSON (`tool_name`, `tool_input`, `cwd`, `tool_use_id`, ...).
//   * stdout `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"|"deny", ...}}`
//     with exit 0 is honoured, `updatedInput` included. `permissionDecision: "ask"` is NOT honoured: Codex
//     lets the call proceed, so this hook never emits it (the gate blocks on asks and answers allow/deny).
//   * exit 2 blocks the call and shows stderr as the reason. Any other exit code (a crash, exit 1) and a
//     hook timeout let the tool RUN. Everything here therefore ends in exit 0 with a decision, or exit 2.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { askGate } from './qaap-tool-gate-pi.mjs';

export const EXIT_BLOCK = 2;

function output(permissionDecision, extra = {}) {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, ...extra } });
}

/** Maps a gate decision to the hook's stdout/stderr/exit code. Anything but a well-formed allow blocks. */
export function toHookResult(decision) {
    if (decision && decision.kind === 'allow') {
        const updated = decision.updatedInput && typeof decision.updatedInput === 'object' ? { updatedInput: decision.updatedInput } : {};
        return { exitCode: 0, stdout: output('allow', updated), stderr: '' };
    }
    const reason = decision && typeof decision.reason === 'string' && decision.reason ? decision.reason : 'Blocked by the Qaap safety gate.';
    return {
        exitCode: decision && decision.source === 'gate-error' ? EXIT_BLOCK : 0,
        stdout: output('deny', { permissionDecisionReason: reason }),
        stderr: reason,
    };
}

/** Pure core: hook stdin text -> hook result. Never throws. */
export async function handleHookInput(raw, env = process.env, fetchImpl = globalThis.fetch, options = {}) {
    try {
        let event;
        try {
            event = JSON.parse(raw);
        } catch {
            return toHookResult({ kind: 'deny', source: 'gate-error', reason: 'The Qaap safety gate could not read the Codex hook input.' });
        }
        if (!event || typeof event !== 'object') {
            return toHookResult({ kind: 'deny', source: 'gate-error', reason: 'The Qaap safety gate could not read the Codex hook input.' });
        }
        const input = event.tool_input && typeof event.tool_input === 'object' ? event.tool_input : {};
        const decision = await askGate({
            agentId: 'codex',
            // The server recomputes the kind from the tool name; this is informational only.
            toolKind: 'other',
            rawToolName: String(event.tool_name ?? ''),
            input,
            cwd: String(event.cwd ?? process.cwd()),
            ...(event.tool_use_id ? { harnessCallId: String(event.tool_use_id) } : {}),
        }, env, fetchImpl, options);
        return toHookResult(decision);
    } catch (error) {
        return toHookResult({
            kind: 'deny', source: 'gate-error',
            reason: `The Qaap safety gate failed (${error instanceof Error ? error.message : String(error)}).`,
        });
    }
}

async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

async function main() {
    const result = await handleHookInput(await readStdin());
    if (result.stderr) {
        process.stderr.write(`${result.stderr}\n`);
    }
    process.stdout.write(`${result.stdout}\n`);
    process.exitCode = result.exitCode;
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
    main().catch(error => {
        process.stderr.write(`The Qaap safety gate failed (${error instanceof Error ? error.message : String(error)}).\n`);
        process.exitCode = EXIT_BLOCK;
    });
}
