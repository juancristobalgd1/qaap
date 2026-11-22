// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { QAAP_BUILTIN_AGENT_DEFINITIONS, QAAP_RETIRED_AGENT_DEFINITIONS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { resolveQaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import { createAgUiCliStreamEmitter } from '@theia/qaap-shared-core/lib/common/qaap-cli-ag-ui-stream';
import { createAgentStreamAccumulator, parseAgentLogForTranscript } from '@theia/qaap-shared-core/lib/common/qaap-cli-transcript-stream';
import { QAAP_PI_PLAN_MODE_INSTRUCTION } from '../../common/qaap-agent-readonly-workspace';
import type { QaapAgentTask } from '../../common/qaap-agent-task';
import { QaapAgentTaskRunner } from '../qaap-agent-task-runner';
import type { QaapAgentTaskRunnerContext } from '../qaap-agent-task-runner-context';
import { buildAgentCommandExtracted, buildTemplateVarsExtracted } from '../qaap-agent-task-runner-streaming2';
import { buildChildEnvExtracted } from '../qaap-agent-task-runner-tool-pills2';
import { applyTemplate, applyTemplateWithoutPrompt, resolveAgentPromptTransport } from '../qaap-agent-task-runner-utils';
import { usesCodexToolGateHook } from '../qaap-codex-gate-overlay';
import { usesOpencodeGatePlugin } from '../qaap-tool-gate-opencode-adapter';
import { usesToolGateExtension } from '../qaap-tool-gate-pi-adapter';

/**
 * Support for the golden-equivalence spec of the harness contract (F0). The fixtures under
 * `test-resources/harness-golden/` were captured from the code that existed BEFORE the harness
 * adapters were introduced; the spec replays the same matrix through the production entry points and
 * compares byte for byte. Regenerate only on purpose: `QAAP_HARNESS_GOLDEN_UPDATE=1`.
 */

export const GOLDEN_AGENT_IDS: readonly string[] = ['claude', 'codex', 'opencode', 'pi', 'cursor', 'antigravity', 'copilot', 'grok', 'shell', 'openclaude'];

export const GOLDEN_FIXTURE_DIR = path.resolve(__dirname, '../../../test-resources/harness-golden');

const LONG_PROMPT = `Summarize the repository. ${'0123456789abcdef'.repeat(6200)}`; // ~99 KB: over the 96 KiB argv limit
const LONG_PROMPT_AGENT_IDS: readonly string[] = ['antigravity', 'grok'];
const SHORT_PROMPT = 'Fix the failing test in src/index.ts';

interface GoldenPolicy {
    readonly name: string;
    readonly autoApprove: boolean;
    readonly approvalPolicyId: string;
}

const POLICIES: readonly GoldenPolicy[] = [
    { name: 'request-approval', autoApprove: false, approvalPolicyId: 'request-approval' },
    { name: 'approve-for-me', autoApprove: true, approvalPolicyId: 'approve-for-me' },
    { name: 'full-access', autoApprove: true, approvalPolicyId: 'full-access' },
];

interface GoldenModel {
    readonly name: string;
    readonly modelId?: string;
    readonly effort?: 'low' | 'high' | 'max';
}

const MODELS: readonly GoldenModel[] = [
    { name: 'default' },
    { name: 'model', modelId: 'golden-model-1' },
    { name: 'model-effort', modelId: 'golden-model-1', effort: 'high' },
    { name: 'effort-only', effort: 'low' },
];

export type GoldenRecord = Record<string, unknown>;

/** Machine-independent text: the repo root and temp dirs vary per checkout and per run. */
export function normalizeGoldenText(text: string): string {
    const repoRoot = path.resolve(__dirname, '../../../../..');
    return text
        .split(repoRoot).join('<REPO>')
        .replace(/(?:\/private)?\/(?:var\/folders\/[^\s'"]+|tmp)\/qaap-[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*/g, '<TMP>')
        .replace(/<TMP>(?:\/[A-Za-z0-9_.-]+)*/g, '<TMP>');
}

function definitionFor(agentId: string): { template: string; bin: string; label: string } | undefined {
    return QAAP_BUILTIN_AGENT_DEFINITIONS.find(candidate => candidate.id === agentId)
        ?? QAAP_RETIRED_AGENT_DEFINITIONS.find(candidate => candidate.id === agentId);
}

/** What a build handed to the argv template as `{prompt}`; the real (decorated) prompt text is not part of the golden. */
export interface GoldenArgvPromptProbe {
    argvPrompt?: string;
}

export function commandContext(agentId: string, probe: GoldenArgvPromptProbe = {}): QaapAgentTaskRunnerContext {
    const definition = definitionFor(agentId);
    const ctx: Record<string, unknown> = {
        resolveAgentId: () => agentId,
        stripLeadingAgentMention: (value: string) => value,
        readAgentInstructions: () => undefined,
        readRepoMap: () => undefined,
        readRelevantFiles: () => undefined,
        readGitStatusSnapshot: () => undefined,
        readRepoMemory: () => undefined,
        readResearchLedger: () => undefined,
        readProjectInfo: () => undefined,
        assertQaiqConfigured: () => undefined,
        assertAgentModelAccess: () => undefined,
        isQaiqRunner: (id: string | undefined, command: string) => QaapAgentTaskRunner.prototype.isQaiqRunner.call({}, id, command),
        applyTemplate: (template: string, prompt: string, vars?: Record<string, string>) => {
            probe.argvPrompt = prompt;
            return applyTemplate(template, '<PROMPT>', vars);
        },
        applyTemplateWithoutPrompt,
        isProjectFolderTrusted: () => false,
        resolveQaiqProviderFlags: () => '',
        normalizeAgentBinding: (binding: unknown) => binding,
        resolveAgentSpawnIdentity: () => ({ uid: undefined, gid: undefined }),
        runsInTaskSandbox: () => false,
        resolveAntigravityBin: () => 'agy',
        detectedAgents: new Map(definition
            ? [[agentId, { id: agentId, label: definition.label, bin: definition.bin, template: definition.template }]]
            : []),
        buildTemplateVars: (...args: unknown[]) => buildTemplateVarsExtracted(ctx as unknown as QaapAgentTaskRunnerContext, ...(args as [string])),
    };
    return ctx as unknown as QaapAgentTaskRunnerContext;
}

/** The text delivered to the agent is decorated by prompt code this refactor does not touch; only its shape is golden. */
function describePromptText(text: string | undefined, userPrompt: string): GoldenRecord | null {
    if (text === undefined) {
        return null;
    }
    return {
        containsUserPrompt: text.includes(userPrompt),
        containsPiPlanInstruction: text.includes(QAAP_PI_PLAN_MODE_INSTRUCTION),
        containsInteractionModeInstruction: text.includes('[Qaap interaction-mode system instruction]'),
        endsWithUserPrompt: text.endsWith(userPrompt),
    };
}

function describeArgvPrompt(prompt: string | undefined, userPrompt: string): unknown {
    if (prompt === undefined) {
        return null;
    }
    // A prompt that moved to a private file leaves only a pointer in argv; keep that pointer (temp path normalized).
    return prompt.startsWith('Read the file at ') ? normalizeGoldenText(prompt) : describePromptText(prompt, userPrompt);
}

function promptFileHolds(dir: string | undefined, userPrompt: string): boolean | null {
    if (dir === undefined) {
        return null;
    }
    return fs.readdirSync(dir).some(name => fs.readFileSync(path.join(dir, name), 'utf8').includes(userPrompt));
}

function describeCommand(
    agentId: string,
    userPrompt: string,
    probe: GoldenArgvPromptProbe,
    run: () => ReturnType<typeof buildAgentCommandExtracted>,
    tempDirs: string[],
): GoldenRecord {
    try {
        const built = run();
        if (built.promptTempDir) {
            tempDirs.push(built.promptTempDir);
        }
        return {
            command: normalizeGoldenText(built.command),
            argvPrompt: describeArgvPrompt(probe.argvPrompt, userPrompt),
            stdinPromptMode: built.stdinPromptMode ?? null,
            stdinPrompt: describePromptText(built.stdinPrompt, userPrompt),
            hasPromptTempDir: built.promptTempDir !== undefined,
            promptFileHoldsUserPrompt: promptFileHolds(built.promptTempDir, userPrompt),
            agentId: built.agentId,
        };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error), agentId };
    }
}

/** buildAgentCommandExtracted over harness x mode x readOnly x policy x model/effort, plus long prompts. */
export function captureCommandMatrix(): Record<string, GoldenRecord> {
    const out: Record<string, GoldenRecord> = {};
    const tempDirs: string[] = [];
    try {
        for (const agentId of GOLDEN_AGENT_IDS) {
            for (const mode of ['agent', 'plan']) {
                for (const readOnly of [false, true]) {
                    for (const policy of POLICIES) {
                        for (const model of MODELS) {
                            const key = [agentId, mode, readOnly ? 'ro' : 'rw', policy.name, model.name].join('|');
                            const agentModel = model.modelId
                                ? { provider: 'openai' as const, vendor: agentId, modelId: model.modelId }
                                : undefined;
                            const probe: GoldenArgvPromptProbe = {};
                            out[key] = describeCommand(agentId, SHORT_PROMPT, probe, () => buildAgentCommandExtracted(
                                commandContext(agentId, probe), SHORT_PROMPT, agentId, policy.autoApprove, agentModel,
                                undefined, undefined, mode, policy.approvalPolicyId, undefined, undefined, readOnly, 'alice', model.effort,
                            ), tempDirs);
                        }
                    }
                }
            }
            // Prompt building is superlinear in the prompt size (~10 s for 100 KiB), so the long prompt only runs
            // where the transport depends on its size: antigravity (argv -> private file) and grok (--prompt-file).
            for (const policy of LONG_PROMPT_AGENT_IDS.includes(agentId) ? POLICIES.slice(1, 2) : []) {
                const probe: GoldenArgvPromptProbe = {};
                out[[agentId, 'long-prompt', policy.name].join('|')] = describeCommand(agentId, LONG_PROMPT, probe, () => buildAgentCommandExtracted(
                    commandContext(agentId, probe), LONG_PROMPT, agentId, policy.autoApprove, undefined,
                    undefined, undefined, 'agent', policy.approvalPolicyId, undefined, undefined, false, 'alice', undefined,
                ), tempDirs);
            }
        }
    } finally {
        for (const dir of tempDirs) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
    return out;
}

/** Short prompt through harnesses that react to running inside a task sandbox / with a Codex that supports approve-for-me. */
export function captureSandboxCommandMatrix(): Record<string, GoldenRecord> {
    const out: Record<string, GoldenRecord> = {};
    const tempDirs: string[] = [];
    for (const agentId of ['codex', 'claude']) {
        for (const policy of POLICIES) {
            const probe: GoldenArgvPromptProbe = {};
            const ctx = commandContext(agentId, probe) as unknown as Record<string, unknown>;
            ctx.runsInTaskSandbox = () => true;
            (ctx.detectedAgents as Map<string, Record<string, unknown>>).get(agentId)!.codexSupportsApproveForMe = true;
            out[[agentId, 'sandbox', policy.name].join('|')] = describeCommand(agentId, SHORT_PROMPT, probe, () => buildAgentCommandExtracted(
                ctx as unknown as QaapAgentTaskRunnerContext, SHORT_PROMPT, agentId, policy.autoApprove, undefined,
                undefined, undefined, 'agent', policy.approvalPolicyId, undefined, undefined, false, 'alice', undefined,
            ), tempDirs);
        }
    }
    return out;
}

/** Prompt transport per definition (id + bin + template), plus unknown ids and a custom template. */
export function capturePromptTransportMatrix(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const definitions = [...QAAP_BUILTIN_AGENT_DEFINITIONS, ...QAAP_RETIRED_AGENT_DEFINITIONS];
    for (const definition of definitions) {
        out[`detected:${definition.id}`] = resolveAgentPromptTransport(definition.id, definition);
        out[`id-only:${definition.id}`] = resolveAgentPromptTransport(definition.id);
    }
    out['bin:gemini'] = resolveAgentPromptTransport('antigravity', { id: 'antigravity', bin: 'gemini', template: 'gemini {prompt}' });
    out['bin:agy'] = resolveAgentPromptTransport('antigravity', { id: 'antigravity', bin: 'agy', template: 'agy -p {prompt}' });
    out['bin:cursor-agent'] = resolveAgentPromptTransport('custom', { id: 'custom', bin: 'cursor-agent', template: 'cursor-agent {prompt}' });
    out['bin:grok-custom-id'] = resolveAgentPromptTransport('mygrok', { id: 'mygrok', bin: 'grok', template: 'grok {prompt}' });
    out['bin:copilot-custom-id'] = resolveAgentPromptTransport('mycopilot', { id: 'mycopilot', bin: 'copilot', template: 'copilot -p {prompt}' });
    out['unknown:no-template'] = resolveAgentPromptTransport('unknown');
    out['unknown:undefined'] = resolveAgentPromptTransport(undefined);
    out['unknown:template-flag'] = resolveAgentPromptTransport('unknown', { template: 'tool -p {prompt}' });
    out['unknown:template-bare'] = resolveAgentPromptTransport('unknown', { template: 'tool {prompt}' });
    out['unknown:template-uppercase-id'] = resolveAgentPromptTransport(' CODEX ');
    return out;
}

const SEEDED_SECRET_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'QAAP_GATE_TOKEN', 'QAAP_DELEGATION_TOKEN'];

function envContext(): QaapAgentTaskRunnerContext {
    const stub: Record<string, unknown> = {
        resolveAgentSpawnIdentity: () => ({ uid: undefined }),
        resolveAgentCliPrefix: () => '/prefix',
        isTenantPrivilegeDropActive: () => false,
        stripSharedProviderEnv: () => undefined,
        applyProviderPreferenceEnv: () => undefined,
        resolveAgentBindingForTask: () => undefined,
        applyQaiqProviderEnv: () => undefined,
        isQaiqRunner: (id: string | undefined, command: string) => QaapAgentTaskRunner.prototype.isQaiqRunner.call({}, id, command),
        applyHelperEnv: () => false,
        applyToolGateEnv: () => undefined,
        toolGateWired: (): boolean => false,
        preferenceReaderForOwner: () => () => undefined,
        applyOpenRouterOpenAiCompatEnv: () => undefined,
        resolveAgentHome: () => '/h',
    };
    return new Proxy(stub, { get: (target, key) => key in target ? target[key as string] : () => undefined }) as unknown as QaapAgentTaskRunnerContext;
}

/** The child env buildChildEnvExtracted produces on a pinned process env (secrets reduced to a marker). */
export function captureEnvMatrix(): Record<string, GoldenRecord> {
    const saved = { ...process.env };
    const out: Record<string, GoldenRecord> = {};
    try {
        for (const key of Object.keys(process.env)) {
            delete process.env[key];
        }
        process.env.PATH = '/usr/bin:/bin';
        process.env.HOME = '/home/golden';
        for (const key of SEEDED_SECRET_KEYS) {
            process.env[key] = 'seeded-secret';
        }
        const ids: (string | undefined)[] = [...GOLDEN_AGENT_IDS, undefined];
        for (const agentId of ids) {
            for (const policy of POLICIES) {
                for (const readOnly of [false, true]) {
                    const command = agentId === undefined
                        ? 'codex exec --json -'
                        : (definitionFor(agentId)?.template ?? `${agentId} run`).replace(/\{[a-z_]+\}/g, '').trim();
                    const task = {
                        id: 'golden-task', cwd: '/w', ownerLogin: 'alice', command, agentId,
                        autoApprove: policy.autoApprove, readOnlyWorkspace: readOnly,
                    } as unknown as QaapAgentTask;
                    const env = buildChildEnvExtracted(envContext(), task);
                    const record: GoldenRecord = {};
                    for (const key of Object.keys(env).sort()) {
                        const value = env[key];
                        record[key] = value === undefined
                            ? null
                            : SEEDED_SECRET_KEYS.includes(key) ? '<secret>' : normalizeGoldenText(value);
                    }
                    out[[agentId ?? 'legacy-codex-command', policy.name, readOnly ? 'ro' : 'rw'].join('|')] = record;
                }
            }
        }
    } finally {
        for (const key of Object.keys(process.env)) {
            delete process.env[key];
        }
        Object.assign(process.env, saved);
    }
    return out;
}

const SAMPLE_LOGS: Readonly<Record<string, string>> = {
    plain: 'hello world\nsecond line\n',
    claudeStream: '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hi there"}]}}\n{"type":"result","subtype":"success","result":"Hi there","is_error":false}\n',
    codexStream: '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"Done"}}\n',
    opencodeStream: '{"type":"text","part":{"type":"text","text":"Done"}}\n',
    piStream: '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Done"}]}}\n',
};

/** Which accumulator / emitter / log parser each agent id resolves to, and what they do with sample logs. */
export function captureStreamMatrix(): Record<string, GoldenRecord> {
    const out: Record<string, GoldenRecord> = {};
    for (const agentId of [...GOLDEN_AGENT_IDS, 'qaiq', 'gemini', 'kimi', 'unknown', undefined]) {
        const record: GoldenRecord = {
            accumulator: createAgentStreamAccumulator(agentId)?.constructor.name ?? null,
            agUiEmitter: createAgUiCliStreamEmitter(agentId)?.constructor.name ?? null,
        };
        for (const [name, log] of Object.entries(SAMPLE_LOGS)) {
            const parsed = parseAgentLogForTranscript(agentId, log);
            record[`parse:${name}`] = JSON.parse(JSON.stringify(parsed));
            const accumulator = createAgentStreamAccumulator(agentId);
            if (accumulator) {
                accumulator.push(log);
                record[`accumulate:${name}`] = JSON.parse(JSON.stringify({
                    display: accumulator.getDisplayText(),
                    segments: accumulator.getSegments(),
                }));
            }
            const emitter = createAgUiCliStreamEmitter(agentId);
            if (emitter) {
                record[`agui:${name}`] = JSON.parse(JSON.stringify(emitter.push(log).map(event => ({ ...event, timestamp: undefined }))));
            }
        }
        out[agentId ?? 'undefined'] = record;
    }
    return out;
}

/** The spawn-time predicates the runner used to evaluate per agent id (gate wiring and quirks). */
export function captureWiringMatrix(): Record<string, GoldenRecord> {
    const out: Record<string, GoldenRecord> = {};
    for (const agentId of [...GOLDEN_AGENT_IDS, 'qaiq', 'gemini', 'unknown', ' Pi ', undefined]) {
        const capabilities = resolveQaapHarnessCapabilities(agentId);
        const { mapToolKind, ...data } = capabilities;
        void mapToolKind;
        out[agentId ?? 'undefined'] = {
            usesToolGateExtension: usesToolGateExtension(agentId),
            usesCodexToolGateHook: usesCodexToolGateHook(agentId),
            usesOpencodeGatePlugin: usesOpencodeGatePlugin(agentId),
            normalized: agentId?.trim().toLowerCase() ?? null,
            // Pre-existing capability fields only: the F0 extension fields are asserted by their own spec.
            capabilities: {
                gate: data.gate, canAsk: data.canAsk, whenAskUnsupported: data.whenAskUnsupported, askTtlSec: data.askTtlSec,
                shellGuard: data.shellGuard, untrustedFolderArgs: data.untrustedFolderArgs, trustedFolderArgs: data.trustedFolderArgs,
                untrustedFolderEnv: data.untrustedFolderEnv ?? null, delegateMcp: data.delegateMcp ?? null, usage: data.usage, costSource: data.costSource,
                toolKinds: ['Bash', 'Edit', 'Write', 'Read', 'WebFetch', 'mcp__x__y', 'Other'].map(name => mapToolKind(name, {})),
            },
        };
    }
    return out;
}

export interface GoldenSuite {
    readonly name: string;
    readonly capture: () => unknown;
}

export const GOLDEN_SUITES: readonly GoldenSuite[] = [
    { name: 'commands', capture: captureCommandMatrix },
    { name: 'commands-sandbox', capture: captureSandboxCommandMatrix },
    { name: 'prompt-transport', capture: capturePromptTransportMatrix },
    { name: 'child-env', capture: captureEnvMatrix },
    { name: 'streams', capture: captureStreamMatrix },
    { name: 'wiring', capture: captureWiringMatrix },
];
