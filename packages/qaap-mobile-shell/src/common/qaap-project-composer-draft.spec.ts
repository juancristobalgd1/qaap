// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    projectComposerDraftStorageKey,
    readProjectComposerDraft,
    writeProjectComposerDraft,
} from './qaap-project-composer-draft';

describe('qaap-project-composer-draft', () => {
    const storage = new Map<string, string>();

    beforeEach(() => {
        storage.clear();
        (global as unknown as { window: Window }).window = {
            sessionStorage: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => { storage.set(key, value); },
                removeItem: (key: string) => { storage.delete(key); },
                clear: () => { storage.clear(); },
                key: () => null,
                length: 0,
            },
        } as unknown as Window;
    });

    it('projectComposerDraftStorageKey scopes the key per project id', () => {
        expect(projectComposerDraftStorageKey('proj-a')).to.equal('qaap.composerDraft.proj-a');
        expect(projectComposerDraftStorageKey('proj-b')).to.equal('qaap.composerDraft.proj-b');
    });

    it('writes and reads a draft scoped to the project id', () => {
        writeProjectComposerDraft('proj-a', 'draft a');
        writeProjectComposerDraft('proj-b', 'draft b');
        expect(readProjectComposerDraft('proj-a', '')).to.equal('draft a');
        expect(readProjectComposerDraft('proj-b', '')).to.equal('draft b');
    });

    it('removes the stored draft when writing an empty value', () => {
        writeProjectComposerDraft('proj-a', 'draft a');
        writeProjectComposerDraft('proj-a', '');
        expect(storage.has(projectComposerDraftStorageKey('proj-a'))).to.equal(false);
    });

    it('falls back to the in-memory value when nothing is stored', () => {
        expect(readProjectComposerDraft('proj-a', 'in-memory fallback')).to.equal('in-memory fallback');
    });

    it('falls back to the in-memory value when sessionStorage throws', () => {
        (global as unknown as { window: Window }).window = {
            sessionStorage: {
                getItem: () => { throw new Error('unavailable'); },
                setItem: () => { throw new Error('unavailable'); },
                removeItem: () => { throw new Error('unavailable'); },
                clear: () => { /* noop */ },
                key: () => null,
                length: 0,
            },
        } as unknown as Window;
        expect(readProjectComposerDraft('proj-a', 'fallback')).to.equal('fallback');
        expect(() => writeProjectComposerDraft('proj-a', 'value')).to.not.throw();
    });
});
