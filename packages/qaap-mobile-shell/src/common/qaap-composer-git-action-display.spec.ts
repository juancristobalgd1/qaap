// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    createComposerGitActionDisplayMarker,
    isComposerGitActionOnlyMessage,
    parseComposerGitActionDisplayMarker,
} from './qaap-composer-git-action-display';

describe('qaap-composer-git-action-display', () => {
    it('round-trips git action markers', () => {
        const marker = createComposerGitActionDisplayMarker({
            action: 'commit-push',
            label: 'Commit & Push',
            branch: 'main',
            status: 'completed',
            insertions: 4,
            deletions: 1,
        });
        const parsed = parseComposerGitActionDisplayMarker(marker);
        expect(parsed).to.deep.equal({
            action: 'commit-push',
            label: 'Commit & Push',
            branch: 'main',
            status: 'completed',
            insertions: 4,
            deletions: 1,
        });
        expect(isComposerGitActionOnlyMessage(marker)).to.equal(true);
    });

    it('rejects malformed markers', () => {
        expect(parseComposerGitActionDisplayMarker('Commit & Push')).to.equal(undefined);
        expect(parseComposerGitActionDisplayMarker('<!-- qaap-composer-git-action broken -->')).to.equal(undefined);
    });

    it('treats branched git-action markers as display-only', () => {
        const metadata = {
            action: 'commit-push' as const,
            label: 'Commit & Push',
            branch: 'main',
            status: 'completed' as const,
        };
        const marker = createComposerGitActionDisplayMarker(metadata);
        expect(isComposerGitActionOnlyMessage(marker)).to.equal(true);
        const parsed = parseComposerGitActionDisplayMarker(marker);
        expect(parsed).to.not.equal(undefined);
        expect(isComposerGitActionOnlyMessage(createComposerGitActionDisplayMarker(parsed!))).to.equal(true);
    });
});
