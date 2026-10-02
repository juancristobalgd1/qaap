// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM, enableReactActEnvironment } from '@theia/core/lib/browser/test/jsdom';
let disableJSDOM = enableJSDOM();
let disableReactActEnvironment = enableReactActEnvironment();

import { expect } from 'chai';
import * as React from '@theia/core/shared/react';
import { createRoot, Root } from '@theia/core/shared/react-dom/client';
import type { QaapGitFileDiffResponse, QaapGitHunkLine } from '@theia/qaap-shared-core/lib/common/qaap-git-review';
import { QaapAgentFileSection, QaapAgentFileSectionProps } from './qaap-diff-review-agent-file-section';

disableReactActEnvironment();
disableJSDOM();

function ctx(n: number): QaapGitHunkLine {
    return { type: 'ctx', oldNumber: n, newNumber: n, text: `line ${n}` };
}

const DIFF = {
    path: 'src/a.ts',
    binary: false,
    hunks: [{
        header: '@@ -1,6 +1,6 @@',
        lines: [ctx(1), ctx(2), ctx(3), ctx(4), { type: 'del', oldNumber: 5, text: 'old' }, { type: 'add', newNumber: 5, text: 'new' }],
    }],
} as unknown as QaapGitFileDiffResponse;

describe('QaapAgentFileSection', () => {
    let host: HTMLElement;
    let root: Root;
    let calls: string[];

    before(() => {
        disableJSDOM = enableJSDOM();
        disableReactActEnvironment = enableReactActEnvironment();
    });

    after(() => {
        disableReactActEnvironment();
        disableJSDOM();
    });

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        calls = [];
    });

    afterEach(() => {
        React.act(() => root.unmount());
        host.remove();
    });

    function render(overrides: Partial<QaapAgentFileSectionProps>): void {
        const props: QaapAgentFileSectionProps = {
            file: { path: 'src/a.ts', status: 'M', adds: 1, dels: 1, staged: false } as QaapAgentFileSectionProps['file'],
            diff: DIFF,
            expanded: true,
            loading: false,
            errorDetail: undefined,
            iconClass: 'file-icon',
            fileActionsEnabled: true,
            fileActionRunning: false,
            expandedContextBlocks: undefined,
            onToggleFile: path => calls.push(`toggle:${path}`),
            onDiscardFile: path => calls.push(`discard:${path}`),
            onStageFile: path => calls.push(`stage:${path}`),
            onRetryDiff: path => calls.push(`retry:${path}`),
            onStageHunk: (path, hunkIndex) => calls.push(`hunk:${path}:${hunkIndex}`),
            onToggleContextBlock: (path, blockKey) => calls.push(`ctx:${path}:${blockKey}`),
            ...overrides,
        };
        React.act(() => root.render(<QaapAgentFileSection {...props} />));
    }

    function click(selector: string): void {
        React.act(() => host.querySelector<HTMLElement>(selector)!.click());
    }

    it('does not render hunk lines while collapsed', () => {
        render({ expanded: false });
        expect(host.querySelector('.qaap-agent-changes-hunks')!.hasAttribute('hidden')).to.equal(true);
        expect(host.querySelectorAll('.qaap-diff-review-line')).to.have.length(0);
    });

    it('renders changed lines with the leading context collapsed when expanded', () => {
        render({});
        expect(host.querySelectorAll('.qaap-diff-review-line')).to.have.length(2);
        expect(host.querySelector('.qaap-diff-review-collapsed')!.getAttribute('aria-expanded')).to.equal('false');
    });

    it('shows collapsed context lines once their block is expanded', () => {
        render({ expandedContextBlocks: new Set(['0:0']) });
        expect(host.querySelectorAll('.qaap-diff-review-line')).to.have.length(6);
    });

    it('routes header, context, file and hunk actions to the path-taking handlers', () => {
        render({});
        click('.qaap-agent-changes-filehdr-toggle');
        click('.qaap-diff-review-collapsed');
        click('.qaap-agent-changes-line-stage');
        click('.qaap-agent-changes-filehdr-actions button:last-child');
        expect(calls).to.deep.equal(['toggle:src/a.ts', 'ctx:src/a.ts:0:0', 'hunk:src/a.ts:0', 'stage:src/a.ts']);
    });

    it('hides per-line stage buttons when hunk actions are unavailable', () => {
        render({ onStageHunk: undefined });
        expect(host.querySelectorAll('.qaap-agent-changes-line-stage')).to.have.length(0);
    });

    it('marks added lines and the file header when the change silences a check', () => {
        const diff = {
            path: 'src/a.ts',
            binary: false,
            hunks: [{
                header: '@@ -1,1 +1,3 @@',
                lines: [
                    { type: 'del', oldNumber: 1, text: '// @ts-ignore' },
                    { type: 'add', newNumber: 1, text: '// eslint-disable-next-line no-console' },
                    { type: 'add', newNumber: 2, text: 'console.log(x);' },
                ],
            }],
        } as unknown as QaapGitFileDiffResponse;
        render({ diff });
        expect(host.querySelector('.qaap-agent-changes-suppression-badge')).to.not.equal(null);
        const flagged = host.querySelectorAll('.qaap-diff-review-line--suppression');
        expect(flagged).to.have.length(1);
        expect(flagged[0].getAttribute('data-qaap-suppression')).to.equal('eslint-disable');
        expect(flagged[0].querySelector('.qaap-diff-review-suppression-marker')).to.not.equal(null);
    });

    it('does not flag a clean diff', () => {
        render({});
        expect(host.querySelector('.qaap-agent-changes-suppression-badge')).to.equal(null);
        expect(host.querySelectorAll('.qaap-diff-review-line--suppression')).to.have.length(0);
    });

    it('offers a retry with the failure detail when the diff could not be loaded', () => {
        render({ diff: undefined, errorDetail: 'boom' });
        expect(host.textContent).to.contain('(boom)');
        click('.qaap-diff-review-inline-btn');
        expect(calls).to.deep.equal(['retry:src/a.ts']);
    });
});
