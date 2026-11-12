// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
// Disable only a jsdom this module installed: enableJSDOM returns the shared teardown when one already exists.
const hadImportDOM = typeof document !== 'undefined';
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { MobileProjectsTranscriptMessagesToolUiContext } from './mobile-projects-transcript-messages-tool-ui-context';
import { createTranscriptAgentFailureDialogExtracted } from './mobile-projects-transcript-messages-tool-ui-render';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

if (!hadImportDOM) {
    disableImportJSDOM();
}

describe('failure card "Change model" action', () => {

    useSuiteJSDOM();

    const ctx = {
        appendTranscriptShellSummaryTail: () => undefined,
        contentUi: { cleanTranscriptDisplayText: (text: string) => text },
    } as unknown as MobileProjectsTranscriptMessagesToolUiContext;

    const changeModelButton = (card: HTMLElement): HTMLButtonElement | null => card.querySelector<HTMLButtonElement>('.theia-mobile-agent-turn-failure-change-model');

    it('offers Change model on a usage limit and opens the model picker', () => {
        let opened = 0;
        const raw = 'You\'ve hit your usage limit. Upgrade to Plus to continue, or try again at Nov 19th, 2026 12:56 AM.';
        const card = createTranscriptAgentFailureDialogExtracted(ctx, raw, raw, { onChangeModel: () => { opened++; } });
        const button = changeModelButton(card);
        expect(button?.textContent).to.equal('Change model');
        button!.click();
        expect(opened).to.equal(1);
    });

    it('offers Change model when the model is unavailable at its provider', () => {
        const raw = 'The requested model is not supported.';
        const card = createTranscriptAgentFailureDialogExtracted(ctx, raw, raw, { onChangeModel: () => undefined });
        expect(changeModelButton(card)).to.not.equal(null);
    });

    it('omits the action when no model picker is wired', () => {
        const raw = 'The requested model is not supported.';
        const card = createTranscriptAgentFailureDialogExtracted(ctx, raw, raw);
        expect(changeModelButton(card)).to.equal(null);
    });

    it('omits the action for a failure another model cannot cure', () => {
        const raw = 'Something unexpected went wrong while writing the file.';
        const card = createTranscriptAgentFailureDialogExtracted(ctx, raw, raw, { onChangeModel: () => undefined });
        expect(changeModelButton(card)).to.equal(null);
    });
});
