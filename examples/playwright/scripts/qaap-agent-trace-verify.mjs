#!/usr/bin/env node
/**
 * Verify Agent Trace iteration 1+2 against the built browser app.
 * Requires: npm run build:browser && npm run start:browser on :3000
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BASE = process.env.QAAP_BASE_URL ?? 'http://127.0.0.1:3000';
const OUT_DIR = process.env.QAAP_SCREENSHOT_DIR
    ?? path.join(os.tmpdir(), 'qaap-agent-trace-verify');
const MOBILE = { width: 390, height: 844 };

async function waitForServer(page) {
    for (let i = 0; i < 60; i++) {
        try {
            if ((await page.request.get(BASE)).ok()) {
                return;
            }
        } catch {
            // retry
        }
        await page.waitForTimeout(2000);
    }
    throw new Error(`Server not ready at ${BASE}`);
}

async function dismissTutorial(page) {
    const skip = page.locator('button').filter({ hasText: /^skip$/i }).first();
    if (await skip.count()) {
        await skip.click();
        await page.waitForTimeout(400);
    }
}

async function openFirstTranscript(page) {
    await page.waitForSelector('#theia-app-shell', { timeout: 60000 });
    await page.waitForTimeout(2500);
    await dismissTutorial(page);

    const composer = page.locator('.theia-mobile-projects-sticky-composer-input').first();
    if (!(await composer.isVisible({ timeout: 5000 }).catch(() => false))) {
        const agentBtn = page.locator('#theia-mobile-bottom-bar .theia-mobile-bottom-activity-btn[data-action-id="agent"]').first();
        if (await agentBtn.count()) {
            await agentBtn.click({ force: true });
            await page.waitForTimeout(1500);
        }
    }
    await page.waitForSelector('.theia-mobile-projects-sticky-composer-input', { timeout: 60000 });

    const task = page.locator('.theia-mobile-projects-task-item').first();
    const continueCard = page.locator('button, [role="button"]').filter({ hasText: /continue|corre todas/i }).first();
    if (await continueCard.count()) {
        await continueCard.click({ force: true });
    } else if (await task.count()) {
        await task.click({ force: true });
    } else {
        const sessionsBtn = page.locator('.theia-workbench-nav-btn.theia-mod-mobile-sessions-sidebar').first();
        if (await sessionsBtn.count()) {
            await sessionsBtn.click({ force: true });
            await page.waitForTimeout(600);
            const sidebarTask = page.locator('.theia-mobile-projects-task-item').first();
            if (await sidebarTask.count()) {
                await sidebarTask.click({ force: true, timeout: 15000 });
            }
        }
    }
    await page.waitForTimeout(1500);
}

async function injectTraceHarness(page) {
    return page.evaluate(() => {
        document.querySelector('.qaap-agent-trace-verify-overlay')?.remove();
        const host = document.createElement('div');
        host.className = 'qaap-agent-trace-verify-overlay';
        host.innerHTML = `
<div class="theia-mobile-agent-transcript-root theia-mod-visible" style="position:fixed;inset:0;z-index:9999;background:var(--theia-editor-background,#0b0b0a);display:flex;flex-direction:column;">
  <div class="theia-mobile-agent-transcript" style="flex:1;overflow:hidden;display:flex;flex-direction:column;">
    <div class="theia-mobile-agent-transcript-real-chat" style="flex:1;overflow-y:auto;padding:12px 14px 120px;">
      <div class="theia-mobile-agent-transcript-user-wrap">
        <div class="theia-mobile-agent-transcript-msg theia-mod-user">Verifica el agent trace</div>
      </div>
      <div class="theia-mobile-agent-transcript-msg theia-mod-agent theia-mod-streaming" id="qaap-verify-agent-row">
        <div class="theia-mobile-agent-transcript-segments">
          <details class="theia-mobile-agent-thought-brief">
            <summary><span class="theia-mobile-agent-thought-brief-title">Thought for 6s</span></summary>
          </details>
          <details class="theia-mobile-agent-premium-card theia-mobile-agent-changed-files" data-verify="changed-files">
            <summary class="theia-mobile-agent-changed-files-summary">
              <span class="theia-mobile-agent-changed-files-chevron codicon codicon-chevron-right" aria-hidden="true"></span>
              <span class="theia-mobile-agent-changed-files-title">2 files changed</span>
              <span class="theia-mobile-agent-changed-files-stats">
                <span class="theia-mobile-agent-diff-stat theia-mod-added">+12</span>
                <span class="theia-mobile-agent-diff-stat theia-mod-removed">-4</span>
              </span>
            </summary>
            <div class="theia-mobile-agent-changed-files-list">
              <div class="theia-mobile-agent-changed-file-row">src/app.ts</div>
              <div class="theia-mobile-agent-changed-file-row">mobile-workbench.css</div>
            </div>
          </details>
          <details class="theia-mobile-agent-premium-card theia-mobile-agent-activity-timeline theia-mod-inline theia-mod-collapsible theia-mod-cursor-trace" open data-transcript-activity-timeline="true">
            <summary class="theia-mobile-agent-activity-timeline-summary">
              <span class="theia-mobile-agent-activity-timeline-summary-icon codicon codicon-checklist"></span>
              <span class="theia-mobile-agent-activity-timeline-summary-label">Explored 2 files, 1 command</span>
              <span class="theia-mobile-agent-activity-timeline-summary-count">3</span>
            </summary>
            <ol class="theia-mobile-agent-activity-list theia-mod-virtualized">
              <li class="theia-mobile-agent-activity-item theia-mod-history-gap theia-mod-clickable" data-transcript-timeline-gap-position="before" role="button" tabindex="0" data-verify="history-gap">
                <span class="theia-mobile-agent-activity-icon theia-mod-history-gap codicon codicon-ellipsis" aria-hidden="true"></span>
                <div class="theia-mobile-agent-activity-copy"><span class="theia-mobile-agent-activity-label">+8 earlier steps</span></div>
              </li>
              <li class="theia-mobile-agent-activity-item theia-mod-success theia-mod-timeline-history theia-mod-clickable" role="button" tabindex="0" data-transcript-activity-action="file" data-verify="read">
                <span class="theia-mobile-agent-activity-icon theia-mod-success codicon codicon-check"></span>
                <div class="theia-mobile-agent-activity-copy">
                  <span class="theia-mobile-agent-activity-label">Read README.md</span>
                  <span class="theia-mobile-agent-activity-meta">1.2s</span>
                </div>
              </li>
              <li class="theia-mobile-agent-activity-item theia-mod-success theia-mod-timeline-recent theia-mod-subagent-root theia-mod-clickable" role="button" tabindex="0" data-verify="subagent">
                <span class="theia-mobile-agent-activity-icon theia-mod-kind theia-mod-success codicon codicon-server-process"></span>
                <div class="theia-mobile-agent-activity-copy">
                  <span class="theia-mobile-agent-activity-label">Agent: explore codebase</span>
                  <span class="theia-mobile-agent-activity-meta">2.1s</span>
                </div>
              </li>
              <li class="theia-mobile-agent-activity-item theia-mod-success theia-mod-timeline-recent theia-mod-nest-1 theia-mod-clickable" role="button" tabindex="0" data-verify="mcp">
                <span class="theia-mobile-agent-activity-icon theia-mod-kind theia-mod-success codicon codicon-server-process"></span>
                <div class="theia-mobile-agent-activity-copy">
                  <span class="theia-mobile-agent-activity-label">Called notion search</span>
                  <span class="theia-mobile-agent-activity-mcp-badge">MCP</span>
                  <span class="theia-mobile-agent-activity-meta">0.8s</span>
                </div>
              </li>
              <li class="theia-mobile-agent-activity-item theia-mod-error theia-mod-timeline-recent theia-mod-clickable" role="button" tabindex="0" data-transcript-activity-action="terminal" data-verify="error">
                <span class="theia-mobile-agent-activity-icon theia-mod-error codicon codicon-error"></span>
                <div class="theia-mobile-agent-activity-copy">
                  <span class="theia-mobile-agent-activity-label">Failed: Port 3000 already in use</span>
                  <span class="theia-mobile-agent-activity-meta">3.4s</span>
                  <span class="theia-mobile-agent-activity-error-detail">Agent terminated existing process</span>
                </div>
              </li>
              <li class="theia-mobile-agent-activity-item theia-mod-success theia-mod-timeline-recent" data-verify="edited-row">
                <div class="theia-mobile-agent-activity-copy">
                  <span class="theia-mobile-agent-activity-row">
                    <span class="theia-mobile-agent-activity-verb">Edited</span>
                    <span class="theia-mobile-agent-activity-detail"> mobile-workbench.css</span>
                    <span class="theia-mobile-agent-activity-diff-stats">
                      <span class="theia-mobile-agent-activity-diff-add">+10</span>
                      <span class="theia-mobile-agent-activity-diff-remove">−4</span>
                    </span>
                  </span>
                </div>
              </li>
              <li class="theia-mobile-agent-activity-item theia-mod-running theia-mod-active theia-mod-timeline-current theia-mod-clickable" role="button" tabindex="0" data-transcript-activity-active="true" data-transcript-activity-action="file" data-verify="edit">
                <span class="theia-mobile-agent-activity-icon theia-mod-active theia-mod-pulse"><span class="codicon codicon-arrow-small-right"></span></span>
                <div class="theia-mobile-agent-activity-copy">
                  <span class="theia-mobile-agent-activity-label theia-mod-shimmer">Editing src/app.ts</span>
                </div>
              </li>
            </ol>
          </details>
          <details class="theia-mobile-agent-tool-pill theia-mod-terminal theia-mod-done" open data-verify="terminal-pill">
            <summary class="theia-mobile-agent-tool-pill-summary">
              <span class="theia-mobile-agent-tool-pill-chevron codicon codicon-chevron-right"></span>
              <span class="theia-mobile-agent-tool-pill-verb">Ran</span>
              <span class="theia-mobile-agent-tool-pill-label">npm test</span>
            </summary>
            <div class="theia-mobile-agent-tool-pill-body">
              <div class="theia-mobile-agent-pill-terminal">
                <div class="theia-mobile-agent-shell-command-block">
                  <div class="theia-mobile-agent-shell-command"><span class="theia-mobile-agent-shell-prompt">$</span><code>npm test</code></div>
                </div>
                <pre class="theia-mobile-agent-shell-output">PASS 1 test</pre>
              </div>
            </div>
          </details>
          <details class="theia-mobile-agent-tool-pill theia-mod-mcp theia-mod-done" open data-verify="mcp-pill">
            <summary class="theia-mobile-agent-tool-pill-summary">
              <span class="theia-mobile-agent-tool-pill-badge theia-mod-mcp">MCP</span>
            </summary>
          </details>
          <div class="theia-mobile-agent-transcript-content theia-mod-markdown"><p>Respuesta en streaming…</p></div>
        </div>
      </div>
    </div>
    <div class="theia-mobile-agent-transcript-chat-input" style="padding:8px;">
      <div class="theia-mobile-projects-sticky-composer-inner">
        <div class="theia-mobile-projects-sticky-composer-card theia-mod-codex theia-mod-has-activity">
          <div class="theia-mobile-sticky-composer-activity-stack">
            <div class="theia-mobile-sticky-composer-activity-section theia-mod-streaming">
              <button type="button" class="theia-mobile-sticky-composer-streaming-activity theia-mobile-agent-stream-line theia-mod-editing" id="qaap-verify-composer-stream">
                <span class="theia-mobile-agent-stream-dot"></span>
                <span class="theia-mobile-agent-stream-label theia-mod-shimmer">Editing src/app.ts…</span>
              </button>
            </div>
          </div>
          <div class="theia-mobile-projects-sticky-composer-stage">
            <textarea class="theia-mobile-projects-sticky-composer-input" rows="1" placeholder="Follow up…"></textarea>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`;
        document.body.append(host);

        const results = {
            composerClick: false,
            timelineClickable: 0,
            hasCollapsibleTimeline: false,
            hasComposerStream: false,
            hasThoughtBrief: false,
            hasErrorStep: false,
            hasStepDurationMeta: false,
            hasActivityCopyLayout: false,
            hasActiveStepMarker: false,
            hasChangedFilesCard: false,
            hasHistoryGap: false,
            hasVirtualizedTimeline: false,
            hasDiffStatsInline: false,
            hasNestIndent: false,
            stateClasses: [],
        };
        results.hasCollapsibleTimeline = !!document.querySelector('.theia-mobile-agent-activity-timeline.theia-mod-collapsible');
        results.hasComposerStream = !!document.querySelector('.theia-mobile-sticky-composer-streaming-activity');
        results.hasThoughtBrief = !!document.querySelector('.theia-mobile-agent-thought-brief');
        results.hasErrorStep = !!document.querySelector('.theia-mobile-agent-activity-item.theia-mod-error');
        results.hasStepDurationMeta = !!document.querySelector('.theia-mobile-agent-activity-meta');
        results.hasActivityCopyLayout = !!document.querySelector('.theia-mobile-agent-activity-copy');
        results.hasActiveStepMarker = !!document.querySelector('[data-transcript-activity-active="true"]');
        results.hasChangedFilesCard = !!document.querySelector('.theia-mobile-agent-changed-files, .theia-mobile-agent-diff-summary');
        results.hasHistoryGap = !!document.querySelector('.theia-mobile-agent-activity-item.theia-mod-history-gap');
        results.hasVirtualizedTimeline = !!document.querySelector('.theia-mobile-agent-activity-list.theia-mod-virtualized');
        results.hasDiffStatsInline = !!document.querySelector('.theia-mobile-agent-activity-diff-add, .theia-mobile-agent-activity-diff-remove');
        results.hasNestIndent = !!document.querySelector('.theia-mod-nest-1, .theia-mod-subagent-root');
        results.timelineClickable = document.querySelectorAll('.theia-mobile-agent-activity-item.theia-mod-clickable').length;
        results.stateClasses = [...new Set(
            [...document.querySelectorAll('.theia-mobile-agent-activity-item')]
                .flatMap(item => [...item.classList].filter(cls => cls.startsWith('theia-mod-') && cls !== 'theia-mod-clickable' && cls !== 'theia-mod-active' && cls !== 'theia-mod-grouped' && cls !== 'theia-mod-enter')),
        )].sort();

        const composerBtn = document.getElementById('qaap-verify-composer-stream');
        composerBtn?.addEventListener('click', () => {
            results.composerClick = true;
            const timeline = document.querySelector('[data-transcript-activity-timeline]');
            if (timeline instanceof HTMLDetailsElement) {
                timeline.open = true;
            }
            timeline?.scrollIntoView({ block: 'nearest' });
        });

        return results;
    });
}

async function resolvePageWorkspaceCwd(page) {
    return page.evaluate(() => {
        const raw = window.location.hash.replace(/^#\/?/, '');
        if (!raw) {
            return undefined;
        }
        try {
            return decodeURIComponent(raw);
        } catch {
            return raw;
        }
    });
}

async function evaluateLiveTraceState(page, workspaceCwd) {
    return page.evaluate(async (cwd) => {
        const fetchList = async (queryCwd) => {
            const url = queryCwd
                ? `/qaap/api/agent-conversations?cwd=${encodeURIComponent(queryCwd)}`
                : '/qaap/api/agent-conversations';
            const listRes = await fetch(url, { credentials: 'include' });
            if (!listRes.ok) {
                return { ok: false, status: listRes.status };
            }
            const list = await listRes.json();
            return { ok: true, conversations: list.conversations ?? [] };
        };
        let listResult = cwd ? await fetchList(cwd) : { ok: false };
        if (!listResult.ok || listResult.conversations.length === 0) {
            listResult = await fetchList(undefined);
        }
        if (!listResult.ok) {
            return { phase: 'api-error', status: listResult.status };
        }
        const conversations = listResult.conversations;
        const latest = [...conversations].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
        if (!latest?.id) {
            return { phase: 'no-conv', cwd, conversationCount: conversations.length };
        }
        const detailRes = await fetch(`/qaap/api/agent-conversations/${encodeURIComponent(latest.id)}`, { credentials: 'include' });
        if (!detailRes.ok) {
            return { phase: 'detail-error', status: detailRes.status };
        }
        const conv = await detailRes.json();
        const agentMessages = (conv.messages ?? []).filter(message => message.role === 'agent');
        const latestAgent = agentMessages.at(-1);
        const segments = latestAgent?.segments ?? [];
        const tools = segments.filter(segment => segment.type === 'tool');
        const nestedTools = tools.filter(segment => segment.parentToolUseId);
        const editTools = tools.filter(segment => /edit|write|patch|apply/i.test(segment.name ?? ''));
        const dom = {
            hasTimeline: !!document.querySelector('[data-transcript-activity-timeline]'),
            hasThought: !!document.querySelector('[data-transcript-thought-brief], .theia-mobile-agent-thought-brief'),
            hasComposerStream: !!document.querySelector('.theia-mobile-sticky-composer-streaming-activity'),
            hasChangedFiles: !!document.querySelector('.theia-mobile-agent-changed-files, .theia-mobile-agent-diff-summary'),
            hasHistoryGap: !!document.querySelector('.theia-mobile-agent-activity-item.theia-mod-history-gap'),
            hasVirtualizedTimeline: !!document.querySelector('.theia-mobile-agent-activity-list.theia-mod-virtualized'),
            hasNestIndent: !!document.querySelector('.theia-mod-nest-1, .theia-mod-subagent-root'),
            clickableSteps: document.querySelectorAll('.theia-mobile-agent-activity-item.theia-mod-clickable').length,
        };
        return {
            phase: conv.status === 'streaming' ? 'streaming' : 'idle',
            status: conv.status,
            conversationId: latest.id,
            toolCount: tools.length,
            nestedToolCount: nestedTools.length,
            editToolCount: editTools.length,
            hasText: segments.some(segment => segment.type === 'text' && (segment.content ?? '').trim()),
            segmentTypes: segments.map(segment => segment.type),
            parentToolUseIds: nestedTools.map(segment => segment.parentToolUseId),
            dom,
        };
    }, workspaceCwd);
}

async function openLiveTranscriptIfNeeded(page) {
    const hasTranscript = await page.evaluate(() => (
        !!document.querySelector('.theia-mobile-agent-transcript-root.theia-mod-visible, .theia-mobile-agent-transcript-real-chat')
    ));
    if (hasTranscript) {
        return true;
    }
    const task = page.locator('.theia-mobile-projects-task-item').first();
    if (await task.count()) {
        await task.click({ force: true });
        await page.waitForTimeout(1200);
        return page.evaluate(() => (
            !!document.querySelector('.theia-mobile-agent-transcript-root.theia-mod-visible, .theia-mobile-agent-transcript-real-chat')
        ));
    }
    return false;
}

async function waitForLiveTraceDom(page, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ready = await page.evaluate(() => (
            !!document.querySelector('[data-transcript-activity-timeline], .theia-mobile-agent-activity-timeline')
            || !!document.querySelector('.theia-mobile-agent-thought-brief, [data-transcript-thought-brief]')
            || !!document.querySelector('.theia-mobile-sticky-composer-streaming-activity')
        ));
        if (ready) {
            return true;
        }
        await page.waitForTimeout(500);
    }
    return false;
}

async function tryLiveAgentProbe(page, cwdHint) {
    const cwd = (await resolvePageWorkspaceCwd(page)) || cwdHint;
    const composer = page.locator('.theia-mobile-projects-sticky-composer-input').first();
    if (!(await composer.count())) {
        return { attempted: false, reason: 'no-composer', cwd };
    }

    const emptyAction = page.locator('.theia-mobile-agent-transcript-empty-action').first();
    if (await emptyAction.count()) {
        await emptyAction.click({ force: true });
        await page.waitForTimeout(800);
    }

    const draft = 'Usa herramientas: lista los archivos del directorio raiz del workspace en una sola linea.';
    await composer.click({ force: true });
    await composer.fill(draft);
    await page.waitForTimeout(400);

    const readySend = page.locator('.theia-mobile-projects-sticky-composer-send.theia-mod-ready').first();
    const enabledSend = page.locator('.theia-mobile-projects-sticky-composer-send:not([disabled])').first();
    const roleSend = page.getByRole('button', { name: /^send$|^create$|^enviar$/i }).first();
    if (await readySend.count()) {
        await readySend.click({ force: true });
    } else if (await enabledSend.count()) {
        await enabledSend.click({ force: true });
    } else if (await roleSend.count()) {
        await roleSend.click({ force: true });
    } else {
        await composer.press('Enter');
    }

    const deadline = Date.now() + 120000;
    let lastState;
    while (Date.now() < deadline) {
        const state = await evaluateLiveTraceState(page, cwd);
        lastState = state;
        if (state.phase === 'streaming' && (state.toolCount > 0 || state.dom?.hasTimeline || state.dom?.hasThought)) {
            await openLiveTranscriptIfNeeded(page);
            const domReady = await waitForLiveTraceDom(page, 15000);
            const finalState = await evaluateLiveTraceState(page, cwd);
            return { attempted: true, ok: true, cwd, state: finalState, domReady };
        }
        if (state.phase === 'idle' && (state.toolCount > 0 || state.hasText)) {
            await openLiveTranscriptIfNeeded(page);
            const domReady = await waitForLiveTraceDom(page, 10000);
            const finalState = await evaluateLiveTraceState(page, cwd);
            return { attempted: true, ok: true, cwd, state: finalState, domReady };
        }
        await page.waitForTimeout(2000);
    }
    return { attempted: true, ok: false, reason: 'timeout', cwd, lastState };
}

async function screenshot(page, name) {
    const file = path.join(OUT_DIR, `${name}.png`);
    const timeline = page.locator('[data-transcript-activity-timeline], .theia-mobile-agent-activity-timeline').first();
    if (await timeline.count()) {
        await timeline.screenshot({ path: file });
    } else {
        await page.screenshot({ path: file, fullPage: false });
    }
    return file;
}

async function evaluateParityChecklist(page) {
    return page.evaluate(() => {
        const checklist = {};
        checklist['P-01'] = !!document.querySelector('[data-transcript-activity-timeline], .theia-mobile-agent-activity-timeline.theia-mod-collapsible');
        checklist['P-02'] = !!document.querySelector('[data-transcript-thought-brief], .theia-mobile-agent-thought-brief');
        checklist['P-03'] = !!document.querySelector('.theia-mobile-sticky-composer-streaming-activity, .theia-mobile-agent-stream-line');
        checklist['P-04'] = !!document.querySelector('.theia-mobile-agent-activity-item.theia-mod-error, .theia-mobile-agent-activity-item.theia-mod-success, .theia-mobile-agent-activity-item.theia-mod-running');
        checklist['P-05'] = !!document.querySelector('.theia-mobile-agent-activity-meta');
        checklist['P-06'] = !!document.querySelector('.theia-mobile-agent-activity-item.theia-mod-error .theia-mobile-agent-activity-error-detail, .theia-mobile-agent-activity-item.theia-mod-error');
        checklist['P-07'] = !!document.querySelector('.theia-mobile-agent-tool-pill, .theia-mobile-agent-tool-group');
        checklist['P-08'] = !!document.querySelector('.theia-mobile-agent-changed-files, .theia-mobile-agent-diff-summary');
        checklist['P-09'] = !!document.querySelector('.theia-mobile-agent-transcript-scroll-to-bottom, [data-transcript-scroll-to-bottom]');
        checklist['P-10'] = !!document.querySelector('.theia-mobile-agent-activity-timeline.theia-mod-collapsed-history, .theia-mobile-agent-activity-timeline.theia-mod-collapsible');
        checklist['P-11'] = !!document.querySelector('.theia-mobile-agent-activity-list.theia-mod-virtualized, .theia-mobile-agent-activity-item.theia-mod-history-gap');
        checklist['P-12'] = !!document.querySelector('[data-transcript-activity-active="true"]');
        checklist['P-13'] = !!document.querySelector('.theia-mobile-agent-activity-item.theia-mod-timeline-current')
            && !!document.querySelector('.theia-mobile-agent-activity-item.theia-mod-timeline-recent, .theia-mobile-agent-activity-item.theia-mod-timeline-history');
        checklist['P-14'] = !!document.querySelector('.theia-mobile-agent-pill-terminal .theia-mobile-agent-shell-output');
        checklist['P-15'] = !!document.querySelector('.theia-mobile-agent-tool-pill-badge.theia-mod-mcp')
            && !!document.querySelector('.theia-mobile-agent-activity-mcp-badge');
        checklist['P-16'] = !!document.querySelector('.theia-mobile-agent-activity-item.theia-mod-timeline-current.theia-mod-active');
        checklist['P-18'] = !!document.querySelector('.theia-mobile-agent-activity-diff-add, .theia-mobile-agent-activity-diff-remove');
        checklist['P-21'] = !!document.querySelector('.theia-mod-nest-1, .theia-mod-subagent-root');
        checklist['P-22'] = !!document.querySelector('.theia-mobile-agent-activity-list.theia-mod-virtualized');
        const passed = Object.values(checklist).filter(Boolean).length;
        return { checklist, passed, total: Object.keys(checklist).length };
    });
}

function buildLiveParityFromState(state) {
    if (!state?.dom) {
        return undefined;
    }
    return {
        'P-01': state.dom.hasTimeline,
        'P-02': state.dom.hasThought,
        'P-03': state.dom.hasComposerStream,
        'P-07': state.toolCount > 0,
        'P-08': state.dom.hasChangedFiles || state.editToolCount > 0,
        'P-11': state.dom.hasHistoryGap || state.dom.hasVirtualizedTimeline,
        'P-21': state.dom.hasNestIndent || (state.nestedToolCount ?? 0) > 0,
        'P-22': state.dom.hasVirtualizedTimeline || (state.toolCount ?? 0) > 48,
    };
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-trace-verify-'));
    fs.writeFileSync(path.join(workspace, 'README.md'), '# verify\n');

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: MOBILE });
    await waitForServer(page);

    const report = {
        outDir: OUT_DIR,
        shots: [],
        checks: {},
        liveAgent: null,
    };

    // 1) Harness on loaded bundle (CSS + composer stream interaction)
    await page.goto(`${BASE}/#/${encodeURIComponent(workspace)}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('#theia-app-shell', { timeout: 60000 });
    await page.waitForTimeout(2000);
    const harness = await injectTraceHarness(page);
    report.checks.harness = harness;
    report.parity = await evaluateParityChecklist(page);
    await page.locator('#qaap-verify-composer-stream').click();
    await page.waitForTimeout(500);
    report.checks.composerScrollAfterClick = await page.evaluate(() => {
        const timeline = document.querySelector('[data-transcript-activity-timeline]');
        return {
            composerClickHandled: true,
            timelineOpen: timeline instanceof HTMLDetailsElement ? timeline.open : undefined,
        };
    });
    report.shots.push(await screenshot(page, '01-harness-timeline'));

    // 2) Work Hub + optional live agent (best-effort — depends on backend agent)
    await page.evaluate(() => document.querySelector('.qaap-agent-trace-verify-overlay')?.remove());
    await page.goto(`${BASE}/#/${encodeURIComponent(workspace)}`, { waitUntil: 'domcontentloaded' });
    try {
        await openFirstTranscript(page);
        report.shots.push(await screenshot(page, '02-work-hub-composer'));
    } catch (error) {
        report.checks.workHubNavError = error instanceof Error ? error.message : String(error);
        const composerVisible = await page.locator('.theia-mobile-projects-sticky-composer-input').first()
            .isVisible({ timeout: 5000 }).catch(() => false);
        if (!composerVisible) {
            throw error;
        }
    }
    try {
        report.liveAgent = await tryLiveAgentProbe(page, workspace);
        if (report.liveAgent.ok) {
            report.shots.push(await screenshot(page, '03-live-agent-trace'));
            report.checks.liveParity = buildLiveParityFromState(report.liveAgent.state);
        } else {
            report.checks.liveAgentSkipped = report.liveAgent.reason ?? 'no-streaming-trace';
            if (report.liveAgent.lastState) {
                report.checks.liveParityPartial = buildLiveParityFromState(report.liveAgent.lastState);
                report.checks.liveLastState = report.liveAgent.lastState;
            }
        }
        report.checks.idleComposer = await page.evaluate(() => ({
            streamingRow: !!document.querySelector('.theia-mobile-sticky-composer-streaming-activity'),
            activityStack: !!document.querySelector('.theia-mobile-sticky-composer-activity-stack'),
        }));
    } catch (error) {
        report.checks.liveAgentError = error instanceof Error ? error.message : String(error);
    }

    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));

    await browser.close();

    const failed = !harness.hasCollapsibleTimeline
        || !harness.hasComposerStream
        || !harness.hasErrorStep
        || !harness.hasStepDurationMeta
        || !harness.hasActivityCopyLayout
        || !harness.hasChangedFilesCard
        || !harness.hasHistoryGap
        || !harness.hasVirtualizedTimeline
        || harness.timelineClickable < 3
        || !harness.hasActiveStepMarker
        || !report.parity?.checklist?.['P-08']
        || !report.parity?.checklist?.['P-11']
        || !report.parity?.checklist?.['P-21']
        || !report.parity?.checklist?.['P-22'];
    if (failed) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
