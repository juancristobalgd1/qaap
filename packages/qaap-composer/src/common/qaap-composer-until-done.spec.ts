// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    readStoredComposerUntilDone,
    resolveComposerUntilDoneForSubmit,
    resolveUntilDoneDisabledReason,
    writeStoredComposerUntilDone,
} from './qaap-composer-until-done';

describe('qaap-composer-until-done', () => {
    const globalWithWindow = globalThis as unknown as { window?: { localStorage: Storage } };
    let previousWindow: { localStorage: Storage } | undefined;

    beforeEach(() => {
        previousWindow = globalWithWindow.window;
        const values = new Map<string, string>();
        globalWithWindow.window = {
            localStorage: {
                getItem: (key: string) => values.get(key) ?? null, // eslint-disable-line no-null/no-null
                setItem: (key: string, value: string) => { values.set(key, value); },
                removeItem: (key: string) => { values.delete(key); },
            } as Storage,
        };
    });

    afterEach(() => {
        globalWithWindow.window = previousWindow;
    });

    it('persists the toggle per project cwd', () => {
        expect(readStoredComposerUntilDone('/repo')).to.equal(false);
        writeStoredComposerUntilDone('/repo', true);
        expect(readStoredComposerUntilDone('/repo')).to.equal(true);
        expect(readStoredComposerUntilDone('/other')).to.equal(false);
        writeStoredComposerUntilDone('/repo', false);
        expect(readStoredComposerUntilDone('/repo')).to.equal(false);
        expect(readStoredComposerUntilDone(undefined)).to.equal(false);
    });

    it('is disabled under manual approval and in Plan mode', () => {
        expect(resolveUntilDoneDisabledReason({ approvalPolicyId: 'request-approval', modeId: 'agent' })).to.equal('Requires auto-approve');
        expect(resolveUntilDoneDisabledReason({ approvalPolicyId: 'approve-for-me', modeId: 'plan' })).to.match(/Plan mode/);
        expect(resolveUntilDoneDisabledReason({ approvalPolicyId: 'full-access', modeId: 'agent' })).to.equal(undefined);
    });

    it('starts a loop on submit only when enabled and usable', () => {
        writeStoredComposerUntilDone('/repo', true);
        expect(resolveComposerUntilDoneForSubmit({ cwd: '/repo', approvalPolicyId: 'approve-for-me', modeId: 'agent' })).to.equal(true);
        expect(resolveComposerUntilDoneForSubmit({ cwd: '/repo', approvalPolicyId: 'request-approval', modeId: 'agent' })).to.equal(false);
        expect(resolveComposerUntilDoneForSubmit({ cwd: '/other', approvalPolicyId: 'approve-for-me', modeId: 'agent' })).to.equal(false);
    });
});
