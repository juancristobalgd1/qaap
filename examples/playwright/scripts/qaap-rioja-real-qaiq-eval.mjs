#!/usr/bin/env node
/**
 * Smoke eval with the real `qaiq` CLI (not mock-qaiq-rioja-agent).
 *
 * Requires:
 *   - QAAP_REAL_QAIQ=1
 *   - Server at QAAP_BASE_URL started with real qaiq on PATH (no mock-qaiq-bin prefix)
 *   - QAIQ credentials configured for the CLI
 */
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
    BASE,
    createEmptyWorkspace,
    createMobileBrowserContext,
    dismissTutorial,
    fmtMs,
    now,
    openWorkspace,
    pollConversation,
    resolveMockQaiqPath,
} from './qaap-rioja-e2e-shared.mjs';

const OUT_DIR = path.join(process.cwd(), '..', '..', 'test-results', 'qaap-rioja-real-qaiq');
const REAL_PROMPT = 'Create a file named qaap-real-smoke.txt in the workspace root containing exactly: ok';
const SMOKE_FILE = 'qaap-real-smoke.txt';

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
        console.error(`Real QAIQ smoke: PATH resolves to mock (${qaiqPath}). Restart server without mock-qaiq-bin.`);
        process.exitCode = 1;
        return;
    }

    const workspace = createEmptyWorkspace('qaap-real-qaiq-');
    const metrics = {
        workspace,
        qaiqPath,
        prompt: REAL_PROMPT,
        phases: {},
        conversation: {},
        file: {},
        gates: {},
        errors: [],
    };

    const t0 = now();
    console.log('\n=== Qaap Real QAIQ Smoke Eval ===');
    console.log(`Workspace: ${workspace}`);
    console.log(`QAIQ: ${qaiqPath}`);
    console.log(`Base: ${BASE}`);

    const { browser, context } = await createMobileBrowserContext(chromium);
    const page = await context.newPage();

    try {
        await openWorkspace(page, workspace);
        await dismissTutorial(page);

        const tPrompt = now();
        const conversation = await page.evaluate(async ({ workspaceCwd, body }) => {
            const res = await fetch('/qaap/api/agent-conversations', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cwd: workspaceCwd,
                    agent: 'qaiq',
                    message: body,
                    title: 'Real QAIQ smoke',
                    autoApprove: true,
                    approvalPolicyId: 'full-access',
                }),
            });
            if (!res.ok) {
                throw new Error(`createConversation failed: ${res.status}`);
            }
            return res.json();
        }, { workspaceCwd: workspace, body: REAL_PROMPT });
        metrics.phases.promptSubmitMs = now() - tPrompt;
        metrics.conversationCreate = { ok: true, id: conversation.id };

        const tAgent = now();
        metrics.conversation = await pollConversation(page, workspace, { timeoutMs: 300_000 });
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
        console.log(`\nReporte: ${reportPath}`);

        process.exitCode = metrics.gates.all ? 0 : 1;
    } catch (err) {
        metrics.errors.push(String(err));
        metrics.phases.totalMs = now() - t0;
        fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(metrics, null, 2));
        console.error(err);
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
}

main();
