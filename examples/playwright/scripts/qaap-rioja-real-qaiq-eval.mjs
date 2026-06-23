#!/usr/bin/env node
/**
 * Smoke eval with the real `qaiq` CLI (not mock-qaiq-rioja-agent).
 *
 * Requires:
 *   - QAAP_REAL_QAIQ=1
 *   - Server at QAAP_BASE_URL started with real qaiq on PATH (no mock-qaiq-bin prefix)
 *   - QAIQ credentials configured for the CLI
 *
 * Uses HTTP API only (no Playwright browser).
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
    BASE,
    createAgentConversationApi,
    createEmptyWorkspace,
    fetchBackendAgentsApi,
    fmtMs,
    now,
    pollConversationApi,
    resolveMockQaiqPath,
} from './qaap-rioja-e2e-shared.mjs';

const OUT_DIR = path.join(process.cwd(), '..', '..', 'test-results', 'qaap-rioja-real-qaiq');
const REAL_PROMPT = 'Create a file named qaap-real-smoke.txt in the workspace root containing exactly: ok';
const SMOKE_FILE = 'qaap-real-smoke.txt';

/** Override via QAAP_REAL_QAIQ_MODEL='openrouter/nvidia/nemotron-3-super-120b-a12b:free' */
function resolveRealQaiqAgentModel() {
    const raw = process.env.QAAP_REAL_QAIQ_MODEL?.trim();
    if (raw) {
        const [vendor, ...rest] = raw.split('/');
        const modelId = rest.join('/') || raw;
        return { provider: 'openai', vendor: vendor || 'openrouter', modelId };
    }
    return {
        provider: 'openai',
        vendor: 'openrouter',
        modelId: 'nvidia/nemotron-3-super-120b-a12b:free',
    };
}

function resolveQaiqOnPath() {
    try {
        return execSync('command -v qaiq', { encoding: 'utf8' }).trim();
    } catch {
        return undefined;
    }
}

function isMockQaiqOnPath(qaiqPath) {
    if (!qaiqPath) {
        return false;
    }
    try {
        const real = fs.realpathSync(qaiqPath);
        const mock = fs.realpathSync(resolveMockQaiqPath());
        return real === mock;
    } catch {
        return qaiqPath.includes('mock-qaiq');
    }
}

function backendUsesMockQaiq(agents) {
    const qaiq = agents?.agents?.find(agent => agent.id === 'qaiq');
    if (!qaiq?.bin) {
        return false;
    }
    try {
        return fs.realpathSync(qaiq.bin) === fs.realpathSync(resolveMockQaiqPath());
    } catch {
        return String(qaiq.bin).includes('mock-qaiq');
    }
}

async function main() {
    if (process.env.QAAP_REAL_QAIQ !== '1') {
        console.log('Skip: set QAAP_REAL_QAIQ=1 to run the real QAIQ smoke eval.');
        process.exitCode = 0;
        return;
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const qaiqPath = resolveQaiqOnPath();
    if (!qaiqPath) {
        console.error('Real QAIQ smoke: `qaiq` not found on PATH.');
        process.exitCode = 1;
        return;
    }
    if (isMockQaiqOnPath(qaiqPath)) {
        console.error(`Real QAIQ smoke: shell PATH resolves to mock (${qaiqPath}).`);
        process.exitCode = 1;
        return;
    }

    const backendAgents = await fetchBackendAgentsApi();
    if (!backendAgents.ok) {
        console.error(`Real QAIQ smoke: backend unreachable at ${BASE} (${backendAgents.status ?? 'error'})`);
        process.exitCode = 1;
        return;
    }
    if (backendUsesMockQaiq(backendAgents)) {
        console.error('Real QAIQ smoke: backend still uses mock QAIQ. Restart server without mock-qaiq-bin in PATH.');
        process.exitCode = 1;
        return;
    }

    const workspace = createEmptyWorkspace('qaap-real-qaiq-');
    const agentModel = resolveRealQaiqAgentModel();
    const metrics = {
        workspace,
        qaiqPath,
        backendAgents,
        prompt: REAL_PROMPT,
        agentModel,
        phases: {},
        conversation: {},
        file: {},
        gates: {},
        errors: [],
    };

    const t0 = now();
    console.log('\n=== Qaap Real QAIQ Smoke Eval (API) ===');
    console.log(`Workspace: ${workspace}`);
    console.log(`QAIQ (shell): ${qaiqPath}`);
    console.log(`QAIQ (backend): ${backendAgents.agents?.find(a => a.id === 'qaiq')?.bin ?? 'unknown'}`);
    console.log(`Base: ${BASE}`);
    console.log(`Model: ${agentModel.vendor}/${agentModel.modelId}`);

    try {
        const tPrompt = now();
        const conversation = await createAgentConversationApi(workspace, REAL_PROMPT, 'qaiq', { agentModel });
        metrics.phases.promptSubmitMs = now() - tPrompt;
        metrics.conversationCreate = { ok: true, id: conversation.id };

        const tAgent = now();
        metrics.conversation = await pollConversationApi(workspace, { timeoutMs: 300_000 });
        metrics.phases.agentTurnMs = now() - tAgent;

        const smokePath = path.join(workspace, SMOKE_FILE);
        metrics.file = {
            exists: fs.existsSync(smokePath),
            content: fs.existsSync(smokePath) ? fs.readFileSync(smokePath, 'utf8').trim() : '',
        };

        metrics.phases.totalMs = now() - t0;
        metrics.gates = {
            conversation: metrics.conversation?.ok === true && metrics.conversation?.status === 'idle',
            smokeFile: metrics.file.exists && metrics.file.content === 'ok',
            all: metrics.conversation?.ok === true
                && metrics.conversation?.status === 'idle'
                && metrics.file.exists
                && metrics.file.content === 'ok',
        };

        const reportPath = path.join(OUT_DIR, 'report.json');
        fs.writeFileSync(reportPath, JSON.stringify(metrics, null, 2));

        console.log('\n--- Métricas ---');
        for (const [k, v] of Object.entries(metrics.phases)) {
            console.log(`${k}: ${fmtMs(v)}`);
        }
        console.log('\n--- Gates ---');
        console.log(JSON.stringify(metrics.gates, null, 2));
        if (!metrics.gates.all) {
            console.log('\n--- Conversation ---');
            console.log(JSON.stringify(metrics.conversation, null, 2));
        }
        console.log(`\nReporte: ${reportPath}`);

        process.exitCode = metrics.gates.all ? 0 : 1;
    } catch (err) {
        metrics.errors.push(String(err));
        metrics.phases.totalMs = now() - t0;
        fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(metrics, null, 2));
        console.error(err);
        process.exitCode = 1;
    }
}

main();
