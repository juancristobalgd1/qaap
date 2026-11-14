// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { createMobileTurnResultFooterElement, MOBILE_TURN_RESULT_CLASS } from './mobile-turn-result-footer';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

describe('mobile-turn-result-footer', () => {

    useSuiteJSDOM();

    const handlers = () => {
        const calls: string[] = [];
        return {
            calls,
            handlers: {
                onOpenPreview: () => calls.push('open'),
                onRunPreview: () => calls.push('run'),
                onCreatePr: () => calls.push('pr'),
                onContinue: () => calls.push('continue'),
            },
        };
    };

    const buttonLabels = (footer: HTMLElement): string[] => [...footer.querySelectorAll<HTMLButtonElement>(`.${MOBILE_TURN_RESULT_CLASS}-action`)]
        .map(button => button.textContent ?? '');

    it('offers Create PR as the single primary action when git has changes to commit', () => {
        const { calls, handlers: h } = handlers();
        const footer = createMobileTurnResultFooterElement({ state: { previewState: 'none', canCreatePr: true } }, h);
        expect(buttonLabels(footer)).to.deep.equal(['Create PR']);
        footer.querySelector<HTMLButtonElement>('.theia-mod-primary')!.click();
        expect(calls).to.deep.equal(['pr']);
    });

    it('falls back to Continue when there is nothing to commit', () => {
        const { calls, handlers: h } = handlers();
        const footer = createMobileTurnResultFooterElement({ state: { previewState: 'none', canCreatePr: false } }, h);
        expect(buttonLabels(footer)).to.deep.equal(['Continue']);
        footer.querySelector<HTMLButtonElement>('.theia-mod-primary')!.click();
        expect(calls).to.deep.equal(['continue']);
    });

    it('shows Open preview for a live preview and Run app for a runnable project, each wired to its handler', () => {
        const live = handlers();
        const liveFooter = createMobileTurnResultFooterElement({ state: { previewState: 'live', canCreatePr: false } }, live.handlers);
        expect(buttonLabels(liveFooter)).to.deep.equal(['Open preview', 'Continue']);
        liveFooter.querySelector<HTMLButtonElement>('.theia-mod-secondary')!.click();
        expect(live.calls).to.deep.equal(['open']);

        const runnable = handlers();
        const runnableFooter = createMobileTurnResultFooterElement({ state: { previewState: 'runnable', canCreatePr: true } }, runnable.handlers);
        expect(buttonLabels(runnableFooter)).to.deep.equal(['Run app', 'Create PR']);
        runnableFooter.querySelector<HTMLButtonElement>('.theia-mod-secondary')!.click();
        expect(runnable.calls).to.deep.equal(['run']);
    });

    it('shows a disabled starting state while a preview boots', () => {
        const { handlers: h } = handlers();
        const footer = createMobileTurnResultFooterElement({ state: { previewState: 'starting', canCreatePr: false } }, h);
        const starting = footer.querySelector<HTMLButtonElement>('.theia-mod-busy');
        expect(starting?.textContent).to.equal('Starting preview…');
        expect(starting?.disabled).to.equal(true);
    });

    it('renders the verification verdict with its informative details', () => {
        const { handlers: h } = handlers();
        const footer = createMobileTurnResultFooterElement({
            verdict: { tone: 'warning', title: 'Completed with warnings', details: ['Checks: failing (npm test)'] },
            state: { previewState: 'none', canCreatePr: false },
        }, h);
        expect(footer.querySelector(`.${MOBILE_TURN_RESULT_CLASS}-verdict.theia-mod-warning .${MOBILE_TURN_RESULT_CLASS}-verdict-title`)?.textContent)
            .to.equal('Completed with warnings');
        expect(footer.querySelector(`.${MOBILE_TURN_RESULT_CLASS}-verdict-details`)?.textContent).to.equal('Checks: failing (npm test)');
    });

    it('omits the verdict row when the turn produced no verification verdict', () => {
        const { handlers: h } = handlers();
        const footer = createMobileTurnResultFooterElement({ state: { previewState: 'none', canCreatePr: false } }, h);
        expect(footer.querySelector(`.${MOBILE_TURN_RESULT_CLASS}-verdict`)).to.equal(null);
    });
});
