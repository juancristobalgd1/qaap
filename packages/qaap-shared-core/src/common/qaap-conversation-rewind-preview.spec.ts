// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildRewindPreviewDTO,
    classifyRewindFile,
    classifyRewindFiles,
    parseRewindRestoreOptions,
    resolveRewindBaselineCommit,
    rewindRestoreConfirmationError,
    selectRewindFiles,
    type QaapRewindFileState,
} from './qaap-conversation-rewind-preview';

const known = { baselineKnown: true };

function state(partial: Partial<QaapRewindFileState> & { path: string }): QaapRewindFileState {
    return { tracked: true, ...partial };
}

describe('qaap-conversation-rewind-preview', () => {
    describe('classifyRewindFile', () => {
        it('skips files whose content already matches the checkpoint', () => {
            expect(classifyRewindFile(state({ path: 'a', target: 'x', current: 'x', baseline: 'x' }), known)).to.equal(undefined);
        });

        it('marks an agent-only edit as safe restore with line stats', () => {
            const file = classifyRewindFile(state({ path: 'a', target: 't', current: 'agent', baseline: 'agent', added: 2, removed: 5 }), known);
            expect(file).to.deep.equal({ path: 'a', action: 'restore', safety: 'safe', reasons: [], added: 2, removed: 5 });
        });

        it('marks a file changed after the agent turn as unsafe', () => {
            const file = classifyRewindFile(state({ path: 'a', target: 't', current: 'user', baseline: 'agent' }), known);
            expect(file?.safety).to.equal('unsafe');
            expect(file?.reasons).to.deep.equal(['modified-externally']);
        });

        it('deletes an agent-created untracked file safely', () => {
            const file = classifyRewindFile(state({ path: 'new.ts', current: 'n', baseline: 'n', tracked: false }), known);
            expect(file).to.include({ action: 'delete', safety: 'safe' });
        });

        it('flags an agent-created file that was edited afterwards', () => {
            const file = classifyRewindFile(state({ path: 'new.ts', current: 'edited', baseline: 'n', tracked: false }), known);
            expect(file).to.include({ action: 'delete', safety: 'unsafe' });
            expect(file?.reasons).to.deep.equal(['modified-externally']);
        });

        it('leaves untracked files the agent never saw alone', () => {
            expect(classifyRewindFile(state({ path: 'notes.txt', current: 'u', tracked: false }), known)).to.equal(undefined);
        });

        it('flags tracked files created outside the agent that restore would delete', () => {
            const file = classifyRewindFile(state({ path: 'user.ts', current: 'u', tracked: true }), known);
            expect(file).to.include({ action: 'delete', safety: 'unsafe' });
            expect(file?.reasons).to.deep.equal(['created-externally']);
        });

        it('recreates a file the agent deleted (safe) and flags external deletions', () => {
            expect(classifyRewindFile(state({ path: 'gone', target: 't' }), known)).to.include({ action: 'recreate', safety: 'safe' });
            const external = classifyRewindFile(state({ path: 'gone', target: 't', baseline: 'agent' }), known);
            expect(external).to.include({ action: 'recreate', safety: 'unsafe' });
            expect(external?.reasons).to.deep.equal(['deleted-externally']);
        });

        it('flags ignored content on disk that would be overwritten', () => {
            const file = classifyRewindFile(state({ path: '.env', target: 't', presentOnDisk: true }), known);
            expect(file).to.include({ action: 'restore', safety: 'unsafe' });
            expect(file?.reasons).to.deep.equal(['ignored-content']);
        });

        it('flags binary, large and conflicted files even when agent-made', () => {
            const file = classifyRewindFile(state({
                path: 'img.png', target: 't', current: 'c', baseline: 'c', binary: true, sizeBytes: 5 * 1024 * 1024, conflicted: true, added: 1,
            }), known);
            expect(file?.safety).to.equal('unsafe');
            expect(file?.reasons).to.deep.equal(['conflict', 'binary', 'large']);
            expect(file?.added).to.equal(undefined);
        });

        it('treats everything as unsafe without a baseline', () => {
            const file = classifyRewindFile(state({ path: 'a', target: 't', current: 'c' }), { baselineKnown: false });
            expect(file?.reasons).to.deep.equal(['unknown-baseline']);
        });
    });

    it('classifyRewindFiles drops untouched files and sorts by path', () => {
        const files = classifyRewindFiles([
            state({ path: 'b', target: 't', current: 'c', baseline: 'c' }),
            state({ path: 'a', target: 't', current: 'c', baseline: 'x' }),
            state({ path: 'same', target: 's', current: 's' }),
        ], known);
        expect(files.map(file => file.path)).to.deep.equal(['a', 'b']);
    });

    describe('resolveRewindBaselineCommit', () => {
        it('uses the newest turn checkpoint', () => {
            expect(resolveRewindBaselineCommit([
                { commit: 'c1', label: 'Turn 1' },
                { commit: 'c2', label: 'Turn 2' },
            ])).to.equal('c2');
        });

        it('uses the restored commit after a restore', () => {
            expect(resolveRewindBaselineCommit([
                { commit: 'c1', label: 'Turn 1' },
                { commit: 'u1', label: 'Before restore', restoredFrom: 'c1' },
            ])).to.equal('c1');
        });

        it('is unknown after a legacy undo snapshot or with no checkpoints', () => {
            expect(resolveRewindBaselineCommit([{ commit: 'u1', label: 'Before rewind' }])).to.equal(undefined);
            expect(resolveRewindBaselineCommit([])).to.equal(undefined);
        });
    });

    it('selects safe files and requires confirmation for unsafe "all" restores', () => {
        const files = classifyRewindFiles([
            state({ path: 'safe', target: 't', current: 'c', baseline: 'c' }),
            state({ path: 'unsafe', target: 't', current: 'c', baseline: 'x' }),
        ], known);
        expect(selectRewindFiles(files, 'safe').map(file => file.path)).to.deep.equal(['safe']);
        expect(selectRewindFiles(files, 'all')).to.have.length(2);
        expect(rewindRestoreConfirmationError(files, { mode: 'all' })).to.be.a('string');
        expect(rewindRestoreConfirmationError(files, { mode: 'all', confirmUnsafe: true })).to.equal(undefined);
        expect(rewindRestoreConfirmationError(files, { mode: 'safe' })).to.equal(undefined);
    });

    it('parses restore options defensively', () => {
        expect(parseRewindRestoreOptions(undefined)).to.equal(undefined);
        expect(parseRewindRestoreOptions({})).to.equal(undefined);
        expect(parseRewindRestoreOptions({ mode: 'safe' })).to.deep.equal({ mode: 'safe', confirmUnsafe: false });
        expect(parseRewindRestoreOptions({ mode: 'all', confirmUnsafe: 'yes' })).to.deep.equal({ mode: 'all', confirmUnsafe: false });
        expect(parseRewindRestoreOptions({ mode: 'all', confirmUnsafe: true })).to.deep.equal({ mode: 'all', confirmUnsafe: true });
    });

    it('caps the DTO list but keeps unsafe files and full counts', () => {
        const files = classifyRewindFiles([
            state({ path: 'a', target: 't', current: 'c', baseline: 'c' }),
            state({ path: 'b', target: 't', current: 'c', baseline: 'c' }),
            state({ path: 'z', target: 't', current: 'c', baseline: 'x' }),
        ], known);
        const dto = buildRewindPreviewDTO({ conversationId: 'c', hasRestore: true }, files, 2);
        expect(dto.files.map(file => file.path)).to.deep.equal(['z', 'a']);
        expect(dto).to.include({ safeCount: 2, unsafeCount: 1, truncated: true });
    });
});
