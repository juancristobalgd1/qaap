// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { FileChangesEvent, FileChangeType } from '@theia/filesystem/lib/common/files';
import { watchReviewRootFileChanges } from './qaap-diff-review-file-watch';

describe('qaap-diff-review — watchReviewRootFileChanges', () => {

    const fire = (emitter: Emitter<FileChangesEvent>, ...uris: string[]): void => {
        emitter.fire(new FileChangesEvent(uris.map(uri => ({ resource: new URI(uri), type: FileChangeType.UPDATED }))));
    };

    it('triggers for changes under the reviewed root only, and stops once disposed', () => {
        const emitter = new Emitter<FileChangesEvent>();
        let calls = 0;
        const watch = watchReviewRootFileChanges({ onDidFilesChange: emitter.event }, 'file:///work/repo', () => { calls++; });
        fire(emitter, 'file:///work/other/a.ts');
        expect(calls).to.equal(0);
        fire(emitter, 'file:///work/other/a.ts', 'file:///work/repo/src/a.ts');
        expect(calls).to.equal(1);
        watch.dispose();
        fire(emitter, 'file:///work/repo/src/a.ts');
        expect(calls).to.equal(1);
    });

    it('is inert without a root', () => {
        const emitter = new Emitter<FileChangesEvent>();
        let calls = 0;
        watchReviewRootFileChanges({ onDidFilesChange: emitter.event }, undefined, () => { calls++; });
        fire(emitter, 'file:///work/repo/src/a.ts');
        expect(calls).to.equal(0);
    });
});
