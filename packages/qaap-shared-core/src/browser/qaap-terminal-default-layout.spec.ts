// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { QaapTerminalFrontendContribution } from './qaap-terminal-frontend-contribution';

disableImportJSDOM();

describe('QaapTerminalFrontendContribution default layout (IDE surface)', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
        });
        window.location.hash = '';
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    interface FakeContribution {
        added: Array<{ widget: unknown; area: unknown }>;
        resolveStart: () => void;
        rejectStart: (error: Error) => void;
        context: object;
    }

    function fakeContribution(groupingMode?: string): FakeContribution {
        const added: Array<{ widget: unknown; area: unknown }> = [];
        let resolveStart: () => void = () => undefined;
        let rejectStart: (error: Error) => void = () => undefined;
        const widget = {
            start: () => new Promise<number>((resolve, reject) => {
                resolveStart = () => resolve(1);
                rejectStart = reject;
            }),
        };
        const context = {
            preferenceService: { ready: Promise.resolve(), get: () => groupingMode },
            newTerminal: async () => widget,
            shell: { addWidget: (w: unknown, options: { area: unknown }) => added.push({ widget: w, area: options.area }) },
        };
        return { added, resolveStart: () => resolveStart(), rejectStart: error => rejectStart(error), context };
    }

    it('adds the bottom terminal without waiting for the backend shell to spawn', async () => {
        const fake = fakeContribution();
        await QaapTerminalFrontendContribution.prototype.initializeLayout.call(fake.context);
        // The start() promise is still pending here: the layout step finished before the spawn answered.
        expect(fake.added).to.have.length(1);
        expect(fake.added[0].area).to.equal('bottom');
        fake.resolveStart();
    });

    it('reports a failed spawn instead of leaving an unhandled rejection', async () => {
        const fake = fakeContribution();
        const errors: unknown[] = [];
        const originalError = console.error;
        console.error = (...args: unknown[]) => { errors.push(args); };
        try {
            await QaapTerminalFrontendContribution.prototype.initializeLayout.call(fake.context);
            fake.rejectStart(new Error('spawn failed'));
            await new Promise(resolve => setTimeout(resolve, 0));
        } finally {
            console.error = originalError;
        }
        expect(errors).to.have.length(1);
    });

    it('keeps the upstream tree grouping opt-out', async () => {
        const fake = fakeContribution('tree');
        await QaapTerminalFrontendContribution.prototype.initializeLayout.call(fake.context);
        expect(fake.added).to.have.length(0);
    });
});
