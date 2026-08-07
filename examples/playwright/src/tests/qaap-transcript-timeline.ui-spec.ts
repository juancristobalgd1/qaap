// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect, test, type Page } from '@playwright/test';
import * as path from 'path';
import { TheiaAppLoader } from '../theia-app-loader';
import { TheiaWorkspace } from '../theia-workspace';

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const SAMPLE_FILES = path.join(path.resolve(__dirname, '../../src/tests/resources'), 'sample-files1');

async function dismissMobileTutorial(page: Page): Promise<void> {
    const skip = page.locator('button').filter({ hasText: /^skip$/i }).first();
    if (await skip.count()) {
        await skip.click();
    }
}

async function mountTimelineFixture(page: Page): Promise<void> {
    await page.evaluate(() => {
        document.getElementById('qaap-transcript-timeline-fixture')?.remove();
        const host = document.createElement('div');
        host.id = 'qaap-transcript-timeline-fixture';
        host.innerHTML = `
<div class="theia-mobile-agent-transcript-real-chat" style="padding:12px 14px 120px;">
  <div class="theia-mobile-agent-transcript-user-wrap" data-testid="user-message-wrap">
    <div class="theia-mobile-agent-transcript-msg theia-mod-user">Fix the failing tool step</div>
    <div class="theia-mobile-agent-transcript-user-actions">
      <button type="button" class="theia-mobile-agent-transcript-user-action theia-mod-edit" aria-label="Edit">
        <span class="codicon codicon-edit" aria-hidden="true"></span>
        <span class="theia-mobile-agent-transcript-user-action-label">Edit</span>
      </button>
      <button type="button" class="theia-mobile-agent-transcript-user-action theia-mod-copy" aria-label="Copy">
        <span class="codicon codicon-copy" aria-hidden="true"></span>
        <span class="theia-mobile-agent-transcript-user-action-label">Copy</span>
      </button>
    </div>
  </div>
  <div class="theia-mobile-agent-transcript-msg theia-mod-agent">
    <div class="theia-mobile-agent-transcript-segments">
      <details class="theia-mobile-agent-premium-card theia-mobile-agent-changed-files" data-testid="changed-files-card">
        <summary class="theia-mobile-agent-changed-files-summary">
          <span class="theia-mobile-agent-changed-files-chevron codicon codicon-chevron-right" aria-hidden="true"></span>
          <span class="theia-mobile-agent-changed-files-title">foo.ts</span>
          <span class="theia-mobile-agent-changed-files-stats">
            <span class="theia-mobile-agent-diff-stat theia-mod-added">+3</span>
            <span class="theia-mobile-agent-diff-stat theia-mod-removed">−1</span>
          </span>
        </summary>
        <div class="theia-mobile-agent-changed-files-collapsed-preview">
          <div class="theia-mobile-agent-changed-files-mini-diff">
            <pre class="theia-mobile-agent-changed-files-mini-diff-lines">
              <div class="theia-mobile-agent-changed-files-mini-diff-line theia-mod-add">
                <span class="theia-mobile-agent-changed-files-mini-diff-marker">+</span>
                <span class="theia-mobile-agent-changed-files-mini-diff-text">added line</span>
              </div>
            </pre>
          </div>
        </div>
        <div class="theia-mobile-agent-changed-files-list">
          <div class="theia-mobile-agent-changed-file theia-mod-edited"><span class="theia-mobile-agent-changed-file-name">foo.ts</span></div>
        </div>
      </details>
      <details class="theia-mobile-agent-premium-card theia-mobile-agent-activity-timeline theia-mod-inline theia-mod-cursor-trace" open data-transcript-activity-timeline="true">
        <summary class="theia-mobile-agent-activity-timeline-summary">
          <span class="theia-mobile-agent-activity-timeline-summary-label">Agent activity</span>
        </summary>
        <ol class="theia-mobile-agent-activity-list">
          <li class="theia-mobile-agent-activity-item theia-mod-success theia-mod-expandable-step" data-testid="terminal-step">
            <div class="theia-mobile-agent-activity-copy">
              <details class="theia-mobile-agent-activity-expand">
                <summary class="theia-mobile-agent-activity-expand-summary">
                  <span class="theia-mobile-agent-activity-row">
                    <span class="theia-mobile-agent-activity-verb">Ran</span>
                    <span class="theia-mobile-agent-activity-detail theia-mod-command">npm test</span>
                  </span>
                  <span class="theia-mobile-agent-activity-expand-chevron codicon codicon-chevron-right" aria-hidden="true"></span>
                </summary>
                <div class="theia-mobile-agent-activity-expand-body theia-mod-terminal">
                  <div class="theia-mobile-agent-activity-terminal-panel theia-mod-single">
                    <pre class="theia-mobile-agent-activity-terminal-output">PASS 1 test</pre>
                  </div>
                </div>
              </details>
            </div>
          </li>
          <li class="theia-mobile-agent-activity-item theia-mod-success theia-mod-expandable-step" data-testid="todo-step">
            <div class="theia-mobile-agent-activity-copy">
              <details class="theia-mobile-agent-activity-expand">
                <summary class="theia-mobile-agent-activity-expand-summary">
                  <span class="theia-mobile-agent-activity-row">
                    <span class="theia-mobile-agent-activity-verb">Updated</span>
                    <span class="theia-mobile-agent-activity-detail">task list</span>
                  </span>
                  <span class="theia-mobile-agent-activity-expand-chevron codicon codicon-chevron-right" aria-hidden="true"></span>
                </summary>
                <div class="theia-mobile-agent-activity-expand-body theia-mod-todo">
                  <div class="theia-mobile-agent-activity-todo-panel theia-mobile-agent-premium-card">
                    <ul class="theia-mobile-agent-todo-checklist theia-mod-premium">
                      <li class="theia-mobile-agent-todo-item theia-mod-completed"><span class="theia-mobile-agent-todo-label">Ship timeline expand</span></li>
                    </ul>
                  </div>
                </div>
              </details>
            </div>
          </li>
          <li class="theia-mobile-agent-activity-item theia-mod-error" data-testid="error-step">
            <div class="theia-mobile-agent-activity-copy">
              <details class="theia-mobile-agent-activity-error-panel" open>
                <summary class="theia-mobile-agent-activity-error-panel-summary">
                  <span class="theia-mobile-agent-activity-error-panel-icon codicon codicon-warning" aria-hidden="true"></span>
                  <span class="theia-mobile-agent-activity-error-panel-title-wrap">
                    <span class="theia-mobile-agent-activity-error-panel-code">InputValidationError</span>
                    <span class="theia-mobile-agent-activity-error-panel-preview">merge field required</span>
                  </span>
                  <span class="theia-mobile-agent-activity-error-panel-chevron codicon codicon-chevron-right" aria-hidden="true"></span>
                </summary>
                <div class="theia-mobile-agent-activity-error-panel-body">
                  <pre class="theia-mobile-agent-activity-error-panel-message">The merge field is required.</pre>
                  <button type="button" class="theia-mobile-agent-activity-checkpoint-restore">Restore to before this step</button>
                </div>
              </details>
            </div>
          </li>
        </ol>
      </details>
    </div>
  </div>
</div>`;
        const chat = document.querySelector('.theia-mobile-agent-transcript-real-chat')
            ?? document.querySelector('.theia-mobile-projects-scroll')
            ?? document.body;
        chat.append(host);
        host.querySelector<HTMLButtonElement>('.theia-mobile-agent-transcript-user-action.theia-mod-copy')
            ?.addEventListener('click', () => {
                navigator.clipboard.writeText('Fix the failing tool step').catch(() => undefined);
            });
    });
}

test.describe('@qaap-mobile transcript timeline', () => {

    test.use({ viewport: MOBILE_VIEWPORT });

    test('expands terminal, todo, and error panels and exposes changed-files stats plus user actions', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([SAMPLE_FILES]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);
        await expect(app.page.locator('.theia-mobile-projects-sticky-composer-input')).toBeVisible({ timeout: 60_000 });
        await mountTimelineFixture(app.page);

        const changedFiles = app.page.getByTestId('changed-files-card');
        await expect(changedFiles.locator('.theia-mobile-agent-changed-files-stats .theia-mod-added')).toHaveText('+3');
        await expect(changedFiles.locator('.theia-mobile-agent-changed-files-stats .theia-mod-removed')).toHaveText('−1');
        await changedFiles.locator('summary').click();
        await expect(changedFiles).toHaveAttribute('open', '');
        await expect(changedFiles.locator('.theia-mobile-agent-changed-files-mini-diff-line')).toBeVisible();

        const terminalExpand = app.page.getByTestId('terminal-step').locator('.theia-mobile-agent-activity-expand');
        await expect(terminalExpand).not.toHaveAttribute('open', '');
        await terminalExpand.locator('summary').click();
        await expect(terminalExpand).toHaveAttribute('open', '');
        await expect(terminalExpand.locator('.theia-mobile-agent-activity-terminal-output')).toContainText('PASS 1 test');

        const todoExpand = app.page.getByTestId('todo-step').locator('.theia-mobile-agent-activity-expand');
        await todoExpand.locator('summary').click();
        await expect(todoExpand).toHaveAttribute('open', '');
        await expect(todoExpand.locator('.theia-mobile-agent-todo-item')).toContainText('Ship timeline expand');

        const errorPanel = app.page.getByTestId('error-step').locator('.theia-mobile-agent-activity-error-panel');
        await expect(errorPanel).toHaveAttribute('open', '');
        await expect(errorPanel.locator('.theia-mobile-agent-activity-error-panel-code')).toHaveText('InputValidationError');
        await expect(errorPanel.locator('.theia-mobile-agent-activity-checkpoint-restore')).toHaveText('Restore to before this step');

        const userWrap = app.page.getByTestId('user-message-wrap');
        await expect(userWrap.locator('.theia-mobile-agent-transcript-user-action.theia-mod-edit')).toBeVisible();
        await expect(userWrap.locator('.theia-mobile-agent-transcript-user-action.theia-mod-copy')).toBeVisible();
        await userWrap.locator('.theia-mobile-agent-transcript-user-action.theia-mod-copy').click();
        await expect.poll(async () => app.page.evaluate(async () => navigator.clipboard.readText())).toContain('Fix the failing tool step');

        await app.page.close();
    });
});
