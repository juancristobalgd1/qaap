#!/usr/bin/env node
/**
 * E2E evaluación (composer UI): workspace vacío → prompt Rioja vía sticky composer → archivos.
 *
 * Gate P0 tras QA-001/002: el composer debe usar el cwd del hash URL, no Mockup.
 *
 * Requiere servidor en QAAP_BASE_URL con mock QAIQ en PATH.
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import {
    RIOJA_UI_FLOW_PROMPT,
    assertNoTutorialOverlay,
    checkWorkspaceFiles,
    clickTranscriptBackToHub,
    createEmptyWorkspace,
    createMobileBrowserContext,
    dismissTutorial,
    ensureMockQaiqSymlink,
    evaluateUiFlowSuccess,
    fetchBackendAgents,
    fmtMs,
    now,
    openWorkspace,
    pollConversation,
    readComposerProjectLabel,
    readTranscriptHeaderText,
    resolveMockQaiqPath,
    sampleAgentTranscriptUi,
    startNewAgentChat,
    submitPromptViaComposer,
} from './qaap-rioja-e2e-shared.mjs';

const OUT_DIR = path.join(process.cwd(), '..', '..', 'test-results', 'qaap-rioja-ui-flow');

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const workspace = createEmptyWorkspace('qaap-ui-ws-');
    const mockLink = ensureMockQaiqSymlink(OUT_DIR);

    const metrics = {
        workspace,
        mockQaiq: { script: resolveMockQaiqPath(), symlink: mockLink },
        steps: [],
        timings: {},
        issues: [],
        files: {},
        conversation: {},
        routing: {},
        uiDuringAgent: {},
        gates: {},
        errors: [],
    };

    const t0 = now();
    console.log('\n=== Qaap Rioja UI Flow Eval (composer + mock QAIQ) ===');
    console.log(`Workspace: ${workspace}`);

    const { browser, context } = await createMobileBrowserContext(chromium);
    const page = await context.newPage();

    let maxToolRows = 0;
    let maxThinking = 0;
    let firstUiSignalMs;

    try {
        const tLoad = now();
        await openWorkspace(page, workspace);
        await dismissTutorial(page);
        metrics.timings.shellLoadMs = now() - tLoad;

        metrics.backendAgents = await fetchBackendAgents(page);
        if (!metrics.backendAgents.ok || !metrics.backendAgents.agents?.some(a => a.id === 'qaiq')) {
            metrics.issues.push('Backend no detecta QAIQ — arranca con mock en PATH');
        }

        metrics.newChat = await startNewAgentChat(page).catch(err => ({ ok: false, error: String(err) }));
        metrics.composerProjectLabel = await readComposerProjectLabel(page);
        await page.screenshot({ path: path.join(OUT_DIR, '01-workspace-empty.png'), fullPage: true });

        const tPrompt = now();
        metrics.promptSentViaComposer = await submitPromptViaComposer(page, RIOJA_UI_FLOW_PROMPT);
        metrics.timings.promptSubmitMs = now() - tPrompt;
        metrics.steps.push('composer-submit');
        if (!metrics.promptSentViaComposer.ok) {
            throw new Error(`Composer submit failed: ${metrics.promptSentViaComposer.reason ?? 'unknown'}`);
        }

        metrics.tutorialAfterPrompt = await assertNoTutorialOverlay(page);
        if (!metrics.tutorialAfterPrompt.ok) {
            metrics.issues.push('Tutorial overlay visible after composer prompt (QA-006)');
        }
        await page.screenshot({ path: path.join(OUT_DIR, '02-prompt-sent.png'), fullPage: true });

        const tAgent = now();
        metrics.conversation = await pollConversation(page, workspace, {
            timeoutMs: 120_000,
            onPoll: async () => {
                const ui = await sampleAgentTranscriptUi(page);
                maxToolRows = Math.max(maxToolRows, ui.toolRows);
                maxThinking = Math.max(maxThinking, ui.thinking);
                if (firstUiSignalMs === undefined && (ui.toolRows > 0 || ui.thinking > 0)) {
                    firstUiSignalMs = now() - tAgent;
                }
            },
        });
        metrics.timings.agentCompleteMs = now() - tAgent;
        metrics.timings.agentUiFirstSignalMs = firstUiSignalMs ?? -1;

        metrics.uiDuringAgent = await sampleAgentTranscriptUi(page);
        metrics.uiDuringAgent.maxToolRows = maxToolRows;
        metrics.uiDuringAgent.maxThinking = maxThinking;

        metrics.routing.transcriptHeader = await readTranscriptHeaderText(page);
        metrics.routing.mockupHeader = /mockup\s*·/i.test(metrics.routing.transcriptHeader ?? '');
        metrics.routing.composerLabelMockup = /^mockup$/i.test((metrics.composerProjectLabel ?? '').trim());

        metrics.tutorialAfterAgent = await assertNoTutorialOverlay(page);
        if (!metrics.tutorialAfterAgent.ok) {
            metrics.issues.push('Tutorial overlay visible after agent turn (QA-006)');
        }

        metrics.files = checkWorkspaceFiles(workspace);

        metrics.backToWorkHub = await clickTranscriptBackToHub(page);
        if (!metrics.backToWorkHub.ok) {
            metrics.issues.push(`Back nav blocked or failed (QA-007): ${metrics.backToWorkHub.hit?.reason ?? metrics.backToWorkHub.reason ?? 'unknown'}`);
        }
        await page.screenshot({ path: path.join(OUT_DIR, '05-back-to-hub.png'), fullPage: true });

        metrics.timings.totalMs = now() - t0;
        metrics.gates = evaluateUiFlowSuccess(metrics);

        await page.screenshot({ path: path.join(OUT_DIR, '03-agent-progress.png'), fullPage: true });
        await page.screenshot({ path: path.join(OUT_DIR, '04-agent-done.png'), fullPage: true });

        const reportPath = path.join(OUT_DIR, 'report.json');
        fs.writeFileSync(reportPath, JSON.stringify(metrics, null, 2));

        console.log('\n--- Timings ---');
        for (const [k, v] of Object.entries(metrics.timings)) {
            console.log(`${k}: ${typeof v === 'number' && v >= 0 ? fmtMs(v) : v}`);
        }
        console.log('\n--- Gates (P0 composer flow) ---');
        console.log(JSON.stringify(metrics.gates, null, 2));
        console.log('\n--- Files ---');
        console.log(JSON.stringify(metrics.files, null, 2));
        console.log(`\nReporte: ${reportPath}`);

        if (!metrics.gates.all) {
            if (!metrics.gates.composerRouting) {
                metrics.issues.push('Composer enrutó al proyecto equivocado (QA-001)');
            }
            if (!metrics.gates.files) {
                metrics.issues.push('Workspace sin archivos Rioja tras turno agente');
            }
            if (!metrics.gates.agentIdle) {
                metrics.issues.push(`Conversación terminó en status=${metrics.conversation?.status ?? 'unknown'}`);
            }
            if (metrics.gates.noContradictoryBadges === false) {
                metrics.issues.push('Badges Failed + Active now simultáneos');
            }
            console.log('\n--- Issues ---');
            for (const issue of metrics.issues) {
                console.log(`- ${issue}`);
            }
        }

        process.exitCode = metrics.gates.all ? 0 : 1;
    } catch (err) {
        metrics.errors.push(String(err));
        metrics.timings.totalMs = now() - t0;
        metrics.uiDuringAgent = await sampleAgentTranscriptUi(page).catch(() => metrics.uiDuringAgent);
        metrics.gates = evaluateUiFlowSuccess(metrics);
        fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(metrics, null, 2));
        console.error(err);
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
}

main();
