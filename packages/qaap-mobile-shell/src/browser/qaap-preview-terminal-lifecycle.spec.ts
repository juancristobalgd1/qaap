// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QAAP_PREVIEW_TERMINAL_KIND,
    extractQaapPreviewTerminalPort,
    isQaapBootRestoredPreviewTerminal,
    isQaapRestoredPreviewTerminal,
    isRestoredPreviewProbeOwned,
    shouldDisposeRestoredPreviewTerminal,
} from './qaap-preview-terminal-lifecycle';

describe('qaap-preview-terminal-lifecycle', () => {
    const cwd = 'file:///workspace/repos/users/alice/project-a';

    it('matches a marked preview terminal only in the same project cwd', () => {
        expect(isQaapRestoredPreviewTerminal({
            kind: QAAP_PREVIEW_TERMINAL_KIND,
            title: 'Dev (renamed)',
            cwd,
            disposed: false,
        }, 'Dev (project-a)', cwd)).to.equal(true);
        expect(isQaapRestoredPreviewTerminal({
            kind: QAAP_PREVIEW_TERMINAL_KIND,
            title: 'Dev (project-a)',
            cwd: 'file:///workspace/repos/users/alice/project-b',
            disposed: false,
        }, 'Dev (project-a)', cwd)).to.equal(false);
    });

    it('recognizes the exact legacy title but not a user terminal or another app', () => {
        expect(isQaapRestoredPreviewTerminal({
            kind: 'user',
            title: 'Dev (project-a)',
            cwd: `${cwd}/`,
            disposed: false,
        }, 'Dev (project-a)', cwd)).to.equal(true);
        expect(isQaapRestoredPreviewTerminal({
            kind: 'user',
            title: 'Terminal',
            cwd,
            disposed: false,
        }, 'Dev (project-a)', cwd)).to.equal(false);
        expect(isQaapRestoredPreviewTerminal({
            kind: 'user',
            title: 'Dev (project-b)',
            cwd,
            disposed: false,
        }, 'Dev (project-a)', cwd)).to.equal(false);
    });

    it('ignores disposed terminals', () => {
        expect(isQaapRestoredPreviewTerminal({
            kind: QAAP_PREVIEW_TERMINAL_KIND,
            title: 'Dev (project-a)',
            cwd,
            disposed: true,
        }, 'Dev (project-a)', cwd)).to.equal(false);
    });

    it('extracts only an explicit allocator-owned port from the restored command', () => {
        expect(extractQaapPreviewTerminalPort([
            '-l',
            '-c',
            "QAAP_PREVIEW_PORT='3002' PORT='3002' npm run dev",
        ])).to.equal(3002);
        expect(extractQaapPreviewTerminalPort(['-c', 'PORT=3003 npm run dev'])).to.equal(undefined);
        expect(extractQaapPreviewTerminalPort(['-c', 'echo QAAP_PREVIEW_PORT=99999'])).to.equal(undefined);
    });

    it('matches boot-scoped restored preview terminals under workspace roots', () => {
        const roots = [cwd, 'file:///workspace/repos/users/alice'];
        expect(isQaapBootRestoredPreviewTerminal({
            kind: QAAP_PREVIEW_TERMINAL_KIND,
            title: 'anything',
            cwd: `${cwd}/apps/web`,
            disposed: false,
        }, roots)).to.equal(true);
        expect(isQaapBootRestoredPreviewTerminal({
            kind: 'user',
            title: 'Dev (project-a)',
            cwd,
            disposed: false,
        }, roots)).to.equal(true);
        expect(isQaapBootRestoredPreviewTerminal({
            kind: 'user',
            title: 'Terminal',
            cwd,
            disposed: false,
        }, roots)).to.equal(false);
        expect(isQaapBootRestoredPreviewTerminal({
            kind: QAAP_PREVIEW_TERMINAL_KIND,
            title: 'Dev (project-a)',
            cwd: 'file:///tmp/outside',
            disposed: false,
        }, roots)).to.equal(false);
    });

    it('shouldDisposeRestoredPreviewTerminal fails closed without a port marker or live claim', () => {
        expect(shouldDisposeRestoredPreviewTerminal({
            hasPortMarker: false,
            probeReady: true,
            probeOwned: true,
        })).to.equal(true);
        expect(shouldDisposeRestoredPreviewTerminal({
            hasPortMarker: true,
            probeReady: false,
            probeOwned: false,
        })).to.equal(true);
        expect(shouldDisposeRestoredPreviewTerminal({
            hasPortMarker: true,
            probeReady: true,
            probeOwned: false,
        })).to.equal(true);
        expect(shouldDisposeRestoredPreviewTerminal({
            hasPortMarker: true,
            probeReady: true,
            probeOwned: true,
        })).to.equal(false);
    });

    it('isRestoredPreviewProbeOwned requires ready plus preview or project identity', () => {
        expect(isRestoredPreviewProbeOwned({ ready: false, previewId: 'p1' })).to.equal(false);
        expect(isRestoredPreviewProbeOwned({ ready: true })).to.equal(false);
        expect(isRestoredPreviewProbeOwned({ ready: true, previewId: 'p1' })).to.equal(true);
        expect(isRestoredPreviewProbeOwned({ ready: true, projectId: 'ws:file:///a' })).to.equal(true);
    });
});
