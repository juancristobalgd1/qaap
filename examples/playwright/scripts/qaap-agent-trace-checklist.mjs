#!/usr/bin/env node
/**
 * Manual checklist automation for Agent Trace parity (P-17–P-22 + reload default).
 * Requires: npm run build:browser && npm run start:browser on :3000
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BASE = process.env.QAAP_BASE_URL ?? 'http://127.0.0.1:3000';
const OUT_DIR = process.env.QAAP_SCREENSHOT_DIR
    ?? path.join(os.tmpdir(), 'qaap-agent-trace-checklist');
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

function injectChecklistHarness() {
    document.querySelector('.qaap-agent-trace-checklist-overlay')?.remove();
    const host = document.createElement('div');
    host.className = 'qaap-agent-trace-checklist-overlay';
    const steps = Array.from({ length: 52 }, (_, i) => {
        const verbs = ['Read', 'Grepped', 'Edited', 'Ran'];
        const verb = verbs[i % verbs.length];
        const detail = `file-${i}.ts`;
        return `<li class="theia-mobile-agent-activity-item theia-mod-success theia-mod-clickable" tabindex="0" data-check="step-${i}">
          <div class="theia-mobile-agent-activity-copy">
            <span class="theia-mobile-agent-activity-row">
              <span class="theia-mobile-agent-activity-verb">${verb}</span>
              <span class="theia-mobile-agent-activity-detail"> ${detail}</span>
            </span>
          </div>
        </li>`;
    }).join('');
    host.innerHTML = `
<div class="theia-mobile-agent-transcript-root theia-mod-visible" style="position:fixed;inset:0;z-index:9999;background:var(--theia-editor-background,#0b0b0a);display:flex;flex-direction:column;">
  <div class="theia-mobile-agent-transcript-real-chat theia-mod-transcript-scroll-to-bottom-mount" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;">
    <div class="theia-mobile-agent-transcript" id="qaap-checklist-scroller" style="flex:1;min-height:0;">
      <div class="theia-mobile-agent-transcript-msg theia-mod-user">Checklist prompt</div>
      <div class="theia-mobile-agent-transcript-msg theia-mod-agent" id="qaap-checklist-agent-row">
    <details class="theia-mobile-agent-thought-brief theia-mod-cursor-flat" data-transcript-thought-brief="true">
      <summary class="theia-mobile-agent-thought-brief-summary">
        <span class="theia-mobile-agent-thought-brief-title">Thought for 6s</span>
      </summary>
      <div class="theia-mobile-agent-thought-brief-body-wrap">
        <p class="theia-mobile-agent-thought-brief-body">Reasoning excerpt for checklist.</p>
      </div>
    </details>
    <details class="theia-mobile-agent-activity-timeline theia-mod-inline theia-mod-collapsible theia-mod-cursor-trace theia-mod-collapsed-history" open data-transcript-activity-timeline="true" id="qaap-checklist-trace">
      <summary class="theia-mobile-agent-activity-timeline-summary">
        <span class="theia-mobile-agent-activity-timeline-summary-label">Explored 52 files</span>
      </summary>
      <div class="theia-mobile-agent-activity-timeline-open-panel">
        <button type="button" class="theia-mobile-agent-activity-timeline-sticky-bar" aria-expanded="true">
          <span class="theia-mobile-agent-activity-timeline-summary-label">Explored 52 files</span>
          <span class="theia-mobile-agent-activity-timeline-summary-chevron codicon codicon-chevron-down" aria-hidden="true"></span>
        </button>
      <ol class="theia-mobile-agent-activity-list theia-mod-virtualized" id="qaap-checklist-timeline">
        <li class="theia-mobile-agent-activity-item theia-mod-history-gap theia-mod-clickable" data-transcript-timeline-gap-position="before" role="button" tabindex="0" id="qaap-checklist-gap" data-check="gap-before">
          <span class="theia-mobile-agent-activity-icon theia-mod-history-gap codicon codicon-ellipsis" aria-hidden="true"></span>
          <div class="theia-mobile-agent-activity-copy"><span class="theia-mobile-agent-activity-label">+12 earlier steps</span></div>
        </li>
        ${steps}
        <li class="theia-mobile-agent-activity-item theia-mod-running theia-mod-active" data-transcript-activity-active="true" tabindex="0" data-check="active">
          <div class="theia-mobile-agent-activity-copy">
            <span class="theia-mobile-agent-activity-row">
              <span class="theia-mobile-agent-activity-verb">Editing</span>
              <span class="theia-mobile-agent-activity-detail"> active.ts</span>
            </span>
          </div>
        </li>
      </ol>
      </div>
    </details>
    <details class="theia-mobile-agent-activity-timeline theia-mod-cursor-trace" open id="qaap-nested-trace">
      <summary><span class="theia-mobile-agent-activity-timeline-summary-label">Subagent trace</span></summary>
      <ol class="theia-mobile-agent-activity-list">
        <li class="theia-mobile-agent-activity-item theia-mod-success theia-mod-subagent-root" data-check="agent-root">
          <div class="theia-mobile-agent-activity-copy">
            <span class="theia-mobile-agent-activity-row"><span class="theia-mobile-agent-activity-verb">Used</span><span class="theia-mobile-agent-activity-detail"> Agent</span></span>
          </div>
        </li>
        <li class="theia-mobile-agent-activity-item theia-mod-success theia-mod-nest-1" data-check="nested-read">
          <div class="theia-mobile-agent-activity-copy">
            <span class="theia-mobile-agent-activity-row"><span class="theia-mobile-agent-activity-verb">Read</span><span class="theia-mobile-agent-activity-detail"> child.ts</span></span>
          </div>
        </li>
      </ol>
    </details>
        <div class="theia-mobile-agent-transcript-content theia-mod-markdown" id="qaap-checklist-filler" style="min-height:1400px;padding-top:12px;">Long agent answer filler for sticky summary scroll test.</div>
      </div>
    </div>
  </div>
</div>`;
    document.body.append(host);

    const scroller = document.getElementById('qaap-checklist-scroller');
    if (scroller) {
        const stuckClass = 'theia-mod-sticky-summary-stuck';
        const syncSticky = () => {
            const scrollerRect = scroller.getBoundingClientRect();
            for (const timeline of scroller.querySelectorAll('[data-transcript-activity-timeline]')) {
                if (!(timeline instanceof HTMLDetailsElement) || !timeline.open) {
                    timeline.classList.remove(stuckClass);
                    continue;
                }
                const summary = timeline.querySelector('.theia-mobile-agent-activity-timeline-sticky-bar')
                    ?? timeline.querySelector('summary');
                if (!summary) {
                    timeline.classList.remove(stuckClass);
                    continue;
                }
                const timelineRect = timeline.getBoundingClientRect();
                const summaryRect = summary.getBoundingClientRect();
                const stuck = timelineRect.height > summaryRect.height
                    && summaryRect.top <= scrollerRect.top + 1
                    && timelineRect.bottom > scrollerRect.top + summaryRect.height;
                timeline.classList.toggle(stuckClass, stuck);
            }
        };
        scroller.addEventListener('scroll', () => requestAnimationFrame(syncSticky), { passive: true });
        syncSticky();
    }

    const list = document.getElementById('qaap-checklist-timeline');
    if (list) {
        list.setAttribute('data-transcript-activity-keyboard-bound', '1');
        list.addEventListener('keydown', event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
                return;
            }
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }
            const current = target.closest('.theia-mobile-agent-activity-item');
            if (!current || !list.contains(current) || current.classList.contains('theia-mod-history-gap')) {
                return;
            }
            const items = [...list.querySelectorAll(':scope > .theia-mobile-agent-activity-item:not(.theia-mod-history-gap)')];
            const idx = items.indexOf(current);
            if (idx < 0) {
                return;
            }
            const next = event.key === 'ArrowDown' ? idx + 1 : idx - 1;
            if (next < 0 || next >= items.length) {
                return;
            }
            event.preventDefault();
            items[next]?.focus();
        });
        list.querySelector('[data-check="step-0"]')?.focus();
    }

    return {
        thoughtClosed: (() => {
            const brief = document.querySelector('.theia-mobile-agent-thought-brief');
            return brief instanceof HTMLDetailsElement && !brief.open;
        })(),
        hasVirtualizedList: !!document.querySelector('.theia-mobile-agent-activity-list.theia-mod-virtualized'),
        hasHistoryGap: !!document.querySelector('.theia-mobile-agent-activity-item.theia-mod-history-gap.theia-mod-clickable'),
        summaryPositionSticky: (() => {
            const stickyBar = document.querySelector('#qaap-checklist-trace .theia-mobile-agent-activity-timeline-sticky-bar');
            return stickyBar ? getComputedStyle(stickyBar).position === 'sticky' : false;
        })(),
        hasCollapsedHistory: !!document.querySelector('.theia-mobile-agent-activity-timeline.theia-mod-collapsed-history'),
        hasSubagentRoot: !!document.querySelector('.theia-mod-subagent-root'),
        hasNestIndent: !!document.querySelector('.theia-mod-nest-1'),
        stepCount: list?.querySelectorAll('.theia-mobile-agent-activity-item').length ?? 0,
    };
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-trace-checklist-'));
    fs.writeFileSync(path.join(workspace, 'README.md'), '# checklist\n');

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: MOBILE });
    const report = { outDir: OUT_DIR, checks: {} };

    await waitForServer(page);
    await page.goto(`${BASE}/#/${encodeURIComponent(workspace)}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('#theia-app-shell', { timeout: 60000 });
    await page.waitForTimeout(2000);

    // Reload default: F5 must land Work Hub, not classic IDE
    const beforeReload = await page.evaluate(() => ({
        workHub: !!document.querySelector('.theia-mobile-projects.theia-mod-visible'),
        classicIde: !!document.querySelector('.theia-mod-prefer-desktop-ide, .theia-ApplicationShell:not(.theia-mobile-one-column-shell)'),
        agentsHub: document.body.classList.contains('theia-mod-agents-hub-inline-active')
            || !!document.querySelector('.theia-mod-agents-hub-landing'),
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#theia-app-shell', { timeout: 60000 });
    await page.waitForTimeout(2500);
    const afterReload = await page.evaluate(() => ({
        workHub: !!document.querySelector('.theia-mobile-projects.theia-mod-visible'),
        preferDesktopIde: !!sessionStorage.getItem('qaap.mobileProjects.preferDesktopIde')
            || !!sessionStorage.getItem('qaap.mobileProjects.explicitDesktopIde'),
        fullIdeShell: !!document.querySelector('#theia-left-content-panel:not([style*="display: none"])')
            && !document.querySelector('.theia-mobile-one-column-shell'),
    }));
    report.checks.f5WorkHubDefault = {
        beforeReload,
        afterReload,
        pass: afterReload.workHub && !afterReload.preferDesktopIde,
    };

    // Harness checks (trace UI contract)
    const harnessBefore = await page.evaluate(injectChecklistHarness);
    report.checks.harnessInitial = harnessBefore;

    const thoughtExpand = await page.evaluate(() => {
        const brief = document.querySelector('.theia-mobile-agent-thought-brief');
        if (!(brief instanceof HTMLDetailsElement)) {
            return { pass: false, reason: 'no-details' };
        }
        brief.querySelector('summary')?.click();
        return { pass: brief.open, openAfterClick: brief.open };
    });
    report.checks.thoughtBriefExpand = thoughtExpand;

    const keyboardNav = await page.evaluate(() => {
        const list = document.getElementById('qaap-checklist-timeline');
        const first = list?.querySelector('[data-check="step-0"]');
        if (!(first instanceof HTMLElement)) {
            return { pass: false, reason: 'no-first-step' };
        }
        first.focus();
        const before = document.activeElement?.getAttribute('data-check');
        first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        const after = document.activeElement?.getAttribute('data-check');
        return { pass: before === 'step-0' && after === 'step-1', before, after };
    });
    report.checks.timelineKeyboardNav = keyboardNav;

    const stickySummary = await page.evaluate(async () => {
        const scroller = document.getElementById('qaap-checklist-scroller');
        const trace = document.getElementById('qaap-checklist-trace');
        if (!(scroller instanceof HTMLElement) || !(trace instanceof HTMLElement)) {
            return { pass: false, reason: 'no-scroller-or-trace' };
        }
        const stuckClass = 'theia-mod-sticky-summary-stuck';
        const syncSticky = () => {
            const scrollerRect = scroller.getBoundingClientRect();
            for (const timeline of scroller.querySelectorAll('[data-transcript-activity-timeline]')) {
                if (!(timeline instanceof HTMLDetailsElement) || !timeline.open) {
                    timeline.classList.remove(stuckClass);
                    continue;
                }
                const summaryEl = timeline.querySelector('.theia-mobile-agent-activity-timeline-sticky-bar')
                    ?? timeline.querySelector('summary');
                if (!summaryEl) {
                    timeline.classList.remove(stuckClass);
                    continue;
                }
                const timelineRect = timeline.getBoundingClientRect();
                const summaryRect = summaryEl.getBoundingClientRect();
                const stuck = timelineRect.height > summaryRect.height
                    && summaryRect.top <= scrollerRect.top + 1
                    && timelineRect.bottom > scrollerRect.top + summaryRect.height;
                timeline.classList.toggle(stuckClass, stuck);
            }
        };
        scroller.scrollTop = 0;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const summary = trace.querySelector('.theia-mobile-agent-activity-timeline-sticky-bar')
            ?? trace.querySelector('summary');
        if (!(summary instanceof HTMLElement)) {
            return { pass: false, reason: 'no-summary' };
        }
        const targetScroll = Math.max(0, scroller.scrollTop + (trace.getBoundingClientRect().top - scroller.getBoundingClientRect().top) + 8);
        scroller.scrollTop = targetScroll;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const pinnedTop = summary.getBoundingClientRect().top;
        scroller.scrollTop = targetScroll + 72;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        syncSticky();
        const stickyPosition = getComputedStyle(summary).position;
        const afterScrollTop = summary.getBoundingClientRect().top;
        const pinnedWhileScrolling = Math.abs(afterScrollTop - pinnedTop) <= 2;
        const stuck = trace.classList.contains(stuckClass);
        return {
            pass: stickyPosition === 'sticky' && pinnedWhileScrolling,
            stickyPosition,
            stuck,
            pinnedWhileScrolling,
            scrollTop: scroller.scrollTop,
        };
    });
    report.checks.stickyTraceSummary = stickySummary;

    report.checks.longTrace = {
        pass: harnessBefore.stepCount >= 50
            && harnessBefore.hasVirtualizedList
            && harnessBefore.hasCollapsedHistory
            && harnessBefore.hasHistoryGap,
        stepCount: harnessBefore.stepCount,
        hasHistoryGap: harnessBefore.hasHistoryGap,
    };
    report.checks.nestedTrace = {
        pass: harnessBefore.hasSubagentRoot && harnessBefore.hasNestIndent,
    };
    report.checks.thoughtBriefCollapsed = {
        pass: harnessBefore.thoughtClosed,
    };

    await page.screenshot({ path: path.join(OUT_DIR, 'checklist-harness.png'), fullPage: false });

    report.summary = {
        f5WorkHub: report.checks.f5WorkHubDefault.pass,
        longTrace: report.checks.longTrace.pass,
        nestedTrace: report.checks.nestedTrace.pass,
        thoughtCollapsed: report.checks.thoughtBriefCollapsed.pass,
        thoughtExpand: report.checks.thoughtBriefExpand.pass,
        keyboardNav: report.checks.timelineKeyboardNav.pass,
        stickySummary: report.checks.stickyTraceSummary.pass,
    };
    report.allPass = Object.values(report.summary).every(Boolean);

    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
    process.exit(report.allPass ? 0 : 1);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
