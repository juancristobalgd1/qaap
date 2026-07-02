#!/usr/bin/env node
/**
 * Work Hub composer audit via REST API — same backend path as createConversation /
 * submitBackgroundAgentTask (postUserMessage → fast path or qaiq task).
 */
import fs from 'node:fs';
import { execSync } from 'child_process';

const BASE = process.env.QAAP_BASE_URL ?? 'http://localhost:3000';
const API = `${BASE}/qaap/api/agent-conversations`;
const CWD = process.env.QAAP_AUDIT_CWD ?? '/Users/jc/qaap';

const TASKS = [
    { id: 'wh-01', description: 'Revisa el estado del repo', prompt: 'revisa el estado del repo', timeoutMs: 60_000, expectFastPath: true },
    { id: 'wh-02', description: 'Muéstrame el diff', prompt: 'muéstrame el diff', timeoutMs: 60_000, expectFastPath: true },
    { id: 'wh-03', description: 'Lee package.json', prompt: 'lee package.json', timeoutMs: 60_000, expectFastPath: true },
    { id: 'wh-04', description: 'Busca TODO', prompt: 'busca TODO', timeoutMs: 60_000, expectFastPath: true },
    { id: 'wh-05', description: 'Find and fix a bug', prompt: 'find and fix a bug in this project', timeoutMs: 180_000, expectFastPath: false },
];

function resolveBundlePaths() {
    const root = '/Users/jc/qaap/examples/browser/lib/frontend';
    return { js: `${root}/bundle.js`, css: `${root}/bundle.css` };
}

async function createConversation(message) {
    const response = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: CWD, message, autoApprove: true }),
    });
    if (!response.ok) {
        throw new Error(`${response.status} ${await response.text()}`);
    }
    return response.json();
}

async function getConversation(id) {
    const response = await fetch(`${API}/${encodeURIComponent(id)}`);
    if (!response.ok) {
        throw new Error(`${response.status} ${await response.text()}`);
    }
    return response.json();
}

function isTurnComplete(conv) {
    if (conv.status === 'failed') {
        return true;
    }
    if (conv.status === 'streaming') {
        return false;
    }
    const lastUser = [...(conv.messages ?? [])].reverse().find(message => message.role === 'user');
    const lastAgent = [...(conv.messages ?? [])].reverse().find(message => message.role === 'agent');
    return !!lastUser && !!lastAgent && lastAgent.createdAt >= lastUser.createdAt;
}

function countToolCalls(conv) {
    let count = 0;
    for (const message of conv.messages ?? []) {
        if (message.role !== 'agent') {
            continue;
        }
        for (const segment of message.segments ?? []) {
            if (segment.type === 'tool') {
                count += 1;
            }
        }
    }
    return count;
}

async function waitForTurn(conversationId, timeoutMs) {
    const start = Date.now();
    let latest = await getConversation(conversationId);
    while (Date.now() - start < timeoutMs) {
        latest = await getConversation(conversationId);
        if (isTurnComplete(latest)) {
            return latest;
        }
        await new Promise(resolve => setTimeout(resolve, 750));
    }
    return latest;
}

async function runTask(task) {
    const started = Date.now();
    try {
        const created = await createConversation(task.prompt);
        const settled = await waitForTurn(created.id, task.timeoutMs);
        const totalMs = Date.now() - started;
        const toolCalls = countToolCalls(settled);
        const fastPath = settled.agentId === 'fast';
        const agentError = settled.messages?.find(message => message.role === 'agent' && message.error?.trim())?.error;
        const complete = isTurnComplete(settled);
        const reason = !complete && totalMs >= task.timeoutMs - 500
            ? 'timeout'
            : settled.status === 'failed' || agentError
                ? 'failed'
                : 'success';
        return {
            taskId: task.id,
            description: task.description,
            prompt: task.prompt,
            conversationId: settled.id,
            agentId: settled.agentId,
            status: settled.status,
            totalMs,
            toolCalls,
            fastPath,
            expectFastPath: task.expectFastPath,
            reason,
            ...(settled.lastTurnMetrics ? { lastTurnMetrics: settled.lastTurnMetrics } : {}),
            ...(agentError ? { error: agentError } : {}),
        };
    } catch (error) {
        return {
            taskId: task.id,
            description: task.description,
            prompt: task.prompt,
            conversationId: '',
            agentId: 'qaiq',
            status: 'failed',
            totalMs: Date.now() - started,
            toolCalls: 0,
            fastPath: false,
            expectFastPath: task.expectFastPath,
            reason: 'error',
            error: String(error),
        };
    }
}

function loadPanelBaseline() {
    const path = '/Users/jc/qaap/qaap-audit-after.json';
    if (!fs.existsSync(path)) {
        return undefined;
    }
    return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function printComparison(panel, workHub) {
    console.log('\n[WH-AUDIT] === PANEL (Fast agent) vs WORK HUB (composer) ===\n');
    console.log('| Prompt | Panel ms | Panel agent | WH ms | WH agent | WH fast | WH ok |');
    console.log('|--------|----------|-------------|-------|----------|---------|-------|');
    const panelByDesc = new Map((panel?.tasks ?? []).map(task => [task.description.toLowerCase(), task]));
    for (const task of workHub.tasks) {
        const panelTask = panelByDesc.get(task.description.toLowerCase());
        const panelMs = panelTask?.totalMs ?? '-';
        const panelAgent = panelTask?.agentId ?? '-';
        console.log(`| ${task.description.slice(0, 22).padEnd(22)} | ${String(panelMs).padStart(8)} | ${String(panelAgent).padEnd(11)} | ${String(task.totalMs).padStart(5)} | ${String(task.agentId).padEnd(8)} | ${task.fastPath ? 'yes' : 'no '} | ${task.reason === 'success' ? 'yes' : 'no '} |`);
    }
}

async function main() {
    const report = {
        timestamp: new Date().toISOString(),
        pipeline: 'work-hub-composer-api',
        workspace: CWD,
        bundle: {},
        tasks: [],
    };

    const bundlePaths = resolveBundlePaths();
    if (fs.existsSync(bundlePaths.js)) {
        const stat = fs.statSync(bundlePaths.js);
        report.bundle.jsBytes = stat.size;
        report.bundle.jsMB = (stat.size / 1024 / 1024).toFixed(2);
        try {
            const gz = execSync(`gzip -c "${bundlePaths.js}" | wc -c`, { encoding: 'utf8' }).trim();
            report.bundle.jsGzipKB = (parseInt(gz, 10) / 1024).toFixed(0);
        } catch { /* optional */ }
    } else {
        report.bundle.jsMissing = bundlePaths.js;
    }

    console.log(`[WH-AUDIT] API=${API}`);
    console.log(`[WH-AUDIT] cwd=${CWD}`);
    console.log(`[WH-AUDIT] Running ${TASKS.length} prompts...\n`);

    for (const task of TASKS) {
        console.log(`[WH-AUDIT] >>> ${task.id}: ${task.description}`);
        const result = await runTask(task);
        report.tasks.push(result);
        console.log(`[WH-AUDIT]     agent=${result.agentId} fast=${result.fastPath} total=${result.totalMs}ms tools=${result.toolCalls} reason=${result.reason}`);
        if (result.lastTurnMetrics) {
            console.log(`[WH-AUDIT]     metrics toolDurationMs=${result.lastTurnMetrics.toolDurationMs} loopDenied=${result.lastTurnMetrics.loopGuard?.deniedCount ?? 0}`);
        }
    }

    const outPath = '/Users/jc/qaap/qaap-work-hub-audit.json';
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\n[WH-AUDIT] Saved ${outPath}`);

    const success = report.tasks.filter(task => task.reason === 'success').length;
    const fast = report.tasks.filter(task => task.fastPath).length;
    console.log(`[WH-AUDIT] ${success}/${report.tasks.length} success | ${fast}/${report.tasks.length} fast-path`);

    const panel = loadPanelBaseline();
    if (panel) {
        printComparison(panel, report);
    }

    const failed = report.tasks.filter(task => task.reason !== 'success');
    if (failed.length > 0) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error('[WH-AUDIT] Fatal:', error);
    process.exit(1);
});
