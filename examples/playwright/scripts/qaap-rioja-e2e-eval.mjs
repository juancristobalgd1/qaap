#!/usr/bin/env node
/**
 * E2E evaluación (API): proyecto vacío → agente QAIQ crea landing Rioja → preview.
 *
 * Requiere:
 *   - Browser app compilado y servidor en QAAP_BASE_URL (default http://127.0.0.1:3000)
 *   - Mock QAIQ en PATH como `qaiq` (scripts/mock-qaiq-rioja-agent)
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import {
    BASE,
    RIOJA_SCAFFOLD_PROMPT,
    assertNoTutorialOverlay,
    bootstrapPreview,
    checkWorkspaceFiles,
    createAgentConversation,
    createEmptyWorkspace,
    createMobileBrowserContext,
    ensureMockQaiqSymlink,
    evaluateApiFlowSuccess,
    fetchBackendAgents,
    fmtMs,
    now,
    openWorkspace,
    pollConversation,
    resolveMockQaiqPath,
    startNewAgentChat,
    waitForPreview,
} from './qaap-rioja-e2e-shared.mjs';

const OUT_DIR = path.join(process.cwd(), '..', '..', 'test-results', 'qaap-rioja-e2e');

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const workspace = createEmptyWorkspace();
    const mockLink = ensureMockQaiqSymlink(OUT_DIR);

    const metrics = {
        workspace,
        mockQaiq: { script: resolveMockQaiqPath(), symlink: mockLink },
        phases: {},
        files: {},
        conversation: {},
        preview: {},
        ux: [],
        errors: [],
    };

    const t0 = now();
    console.log('\n=== Qaap Rioja E2E Eval (API + mock QAIQ) ===');
    console.log(`Workspace vacío: ${workspace}`);
    console.log(`Mock QAIQ: ${resolveMockQaiqPath()}`);
    console.log(`Symlink: ${mockLink.linkPath} -> ${mockLink.target}`);

    const { browser, context } = await createMobileBrowserContext(chromium);
    const page = await context.newPage();

    try {
        const tLoad = now();
        await openWorkspace(page, workspace);
        metrics.phases.shellLoadMs = now() - tLoad;

        metrics.backendAgents = await fetchBackendAgents(page);
        if (!metrics.backendAgents.ok || !metrics.backendAgents.agents?.some(a => a.id === 'qaiq')) {
            metrics.errors.push('Backend no detecta QAIQ — reinicia con PATH incluyendo mock-qaiq-bin');
            console.warn('\n⚠️  Backend sin QAIQ mock. Reinicia el servidor con mock en PATH.\n');
        }

        metrics.newChat = await startNewAgentChat(page).catch(err => ({ ok: false, error: String(err) }));

        const composerVisible = await page.locator('.theia-mobile-projects-sticky-composer-input').isVisible();
        metrics.ux.push(composerVisible ? 'Composer sticky visible en workspace vacío' : 'Composer NO visible tras abrir workspace');
        await page.screenshot({ path: path.join(OUT_DIR, '01-workspace-empty.png'), fullPage: true });

        if (!composerVisible) {
            metrics.errors.push('No se pudo acceder al composer — flujo bloqueado');
            throw new Error('Composer not visible');
        }

        const tPrompt = now();
        let conversation;
        try {
            conversation = await createAgentConversation(page, workspace, RIOJA_SCAFFOLD_PROMPT, 'qaiq');
            metrics.conversationCreate = { ok: true, id: conversation.id, agentId: conversation.agentId, cwd: conversation.cwd };
        } catch (err) {
            metrics.conversationCreate = { ok: false, error: String(err) };
            throw err;
        }
        metrics.phases.promptSubmitMs = now() - tPrompt;
        metrics.tutorialAfterPrompt = await assertNoTutorialOverlay(page);
        if (!metrics.tutorialAfterPrompt.ok) {
            metrics.errors.push('Tutorial overlay visible after agent prompt (QA-006)');
        }
        await page.screenshot({ path: path.join(OUT_DIR, '02-prompt-sent.png'), fullPage: true });

        const tAgent = now();
        metrics.conversation = await pollConversation(page, workspace, { timeoutMs: 120_000 });
        metrics.phases.agentTurnMs = now() - tAgent;
        metrics.tutorialAfterAgent = await assertNoTutorialOverlay(page);
        if (!metrics.tutorialAfterAgent.ok) {
            metrics.errors.push('Tutorial overlay visible after agent turn (QA-006)');
        }

        metrics.files = checkWorkspaceFiles(workspace);
        await page.screenshot({ path: path.join(OUT_DIR, '03-agent-complete.png'), fullPage: true });

        const tPreviewPrompt = now();
        metrics.previewBootstrap = await bootstrapPreview(page, workspace, conversation, OUT_DIR).catch(err => ({
            ok: false,
            error: String(err),
            steps: ['bootstrap-threw'],
        }));
        metrics.phases.previewPromptMs = now() - tPreviewPrompt;

        const tPreview = now();
        metrics.preview = await waitForPreview(page, 5173, 120_000);
        metrics.phases.previewReadyMs = now() - tPreview;

        metrics.preview.iframeContent = await page.evaluate(async () => {
            const iframe = document.querySelector('iframe[src*="qaap-dev/5173"]');
            if (!(iframe instanceof HTMLIFrameElement)) {
                return { found: false };
            }
            try {
                const doc = iframe.contentDocument;
                return { found: true, title: doc?.title ?? '', h1: doc?.querySelector('h1')?.textContent ?? '' };
            } catch {
                return { found: true, crossOrigin: true };
            }
        });

        await page.screenshot({ path: path.join(OUT_DIR, '04-preview.png'), fullPage: true });
        metrics.phases.totalMs = now() - t0;
        metrics.gates = evaluateApiFlowSuccess(metrics);

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
        metrics.gates = evaluateApiFlowSuccess(metrics);
        fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(metrics, null, 2));
        console.error(err);
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
}

main();
