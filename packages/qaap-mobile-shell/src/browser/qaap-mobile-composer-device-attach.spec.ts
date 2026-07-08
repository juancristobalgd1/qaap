// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import URI from '@theia/core/lib/common/uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import type { AIVariableResolutionRequest } from '@theia/ai-core';
import type { StickyComposerContextEntry } from '../common/qaap-composer-context-entry';
import type { MobileComposerAttachHandlers } from './qaap-mobile-composer-device-attach';

/** In-memory FileService/WorkspaceService doubles good enough for the upload + FILE_VARIABLE path. */
function inMemoryBackend(roots: URI[]): {
    files: Map<string, string>;
    fileService: never;
    workspaceService: never;
} {
    const files = new Map<string, string>();
    const fileService = {
        exists: async (uri: URI) => files.has(uri.toString()),
        delete: async (uri: URI) => { files.delete(uri.toString()); },
        writeFile: async (uri: URI) => { files.set(uri.toString(), 'device-file-body'); },
        readFile: async (uri: URI) => ({ value: BinaryBuffer.fromString(files.get(uri.toString()) ?? '') }),
    };
    const workspaceService = {
        tryGetRoots: () => roots.map(resource => ({ resource })),
        getWorkspaceRelativePath: async (uri: URI) => {
            const root = roots[0];
            return root && uri.toString().startsWith(root.toString())
                ? uri.toString().slice(root.toString().length + 1)
                : undefined;
        },
        getRootPrefixedPath: (uri: URI) => uri.path.toString(),
    };
    return { files, fileService: fileService as never, workspaceService: workspaceService as never };
}

function deferredHandlers(uploadTargetDir?: URI): {
    handlers: MobileComposerAttachHandlers;
    settled: Promise<{ kind: 'finalize'; request: AIVariableResolutionRequest } | { kind: 'remove' }>;
} {
    let resolveSettled: (v: { kind: 'finalize'; request: AIVariableResolutionRequest } | { kind: 'remove' }) => void;
    const settled = new Promise<{ kind: 'finalize'; request: AIVariableResolutionRequest } | { kind: 'remove' }>(r => { resolveSettled = r; });
    return {
        settled,
        handlers: {
            uploadTargetDir,
            appendOptimistic: () => undefined,
            finalizeOptimistic: (_id, request) => resolveSettled({ kind: 'finalize', request }),
            removeOptimistic: () => resolveSettled({ kind: 'remove' }),
        },
    };
}

// `qaap-mobile-composer-device-attach` transitively imports browser services (@theia/workspace,
// @theia/filesystem) that touch `document` at module-load time, so require it lazily after JSDOM.
function loadAttach(): typeof import('./qaap-mobile-composer-device-attach') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('./qaap-mobile-composer-device-attach');
}

function collectingHandlers(uploadTargetDir?: URI): {
    handlers: MobileComposerAttachHandlers;
    appended: StickyComposerContextEntry[];
} {
    const appended: StickyComposerContextEntry[] = [];
    return {
        appended,
        handlers: {
            uploadTargetDir,
            appendOptimistic: entry => appended.push(entry),
            finalizeOptimistic: () => undefined,
            removeOptimistic: () => undefined,
        },
    };
}

function fakeServices(roots: URI[]): {
    fileUploadService: never;
    fileService: never;
    workspaceService: never;
} {
    return {
        fileUploadService: {} as never,
        fileService: {
            exists: async () => false,
            writeFile: async () => undefined,
        } as never,
        workspaceService: {
            tryGetRoots: () => roots.map(resource => ({ resource })),
            getWorkspaceRelativePath: async () => undefined,
        } as never,
    };
}

describe('qaap-mobile-composer-device-attach', () => {
    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
        // @lumino/dragdrop (pulled transitively via FILE_VARIABLE) references DragEvent at load time,
        // which jsdom does not provide. A stub is enough — these tests never dispatch drag events.
        const globals = globalThis as unknown as { DragEvent?: unknown };
        if (!globals.DragEvent) {
            globals.DragEvent = class DragEvent {};
        }
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('shows the pending chip using uploadTargetDir when no Theia workspace root is open', () => {
        const { attachDeviceFilesOptimistic } = loadAttach();
        const { handlers, appended } = collectingHandlers(new URI('file:///proj'));
        const file = new File(['hola'], 'notes.txt', { type: 'text/plain' });

        // The bug: this used to throw synchronously (no workspace root) before appending anything,
        // so no chip ever showed. It must now append the optimistic entry instead.
        expect(() => attachDeviceFilesOptimistic([file], fakeServices([]), handlers)).to.not.throw();
        expect(appended.length).to.equal(1);
        expect(appended[0]!.pending).to.equal(true);
        expect(appended[0]!.displayName).to.equal('notes.txt');
    });

    it('still throws when neither a workspace root nor an upload target dir is available', () => {
        const { attachDeviceFilesOptimistic } = loadAttach();
        const { handlers, appended } = collectingHandlers(undefined);
        const file = new File(['hola'], 'notes.txt', { type: 'text/plain' });

        expect(() => attachDeviceFilesOptimistic([file], fakeServices([]), handlers)).to.throw();
        expect(appended.length).to.equal(0);
    });

    it('prefers an open workspace root over the upload target dir', () => {
        const { attachDeviceFilesOptimistic } = loadAttach();
        const { handlers, appended } = collectingHandlers(new URI('file:///proj'));
        const file = new File(['hola'], 'notes.txt', { type: 'text/plain' });

        expect(() => attachDeviceFilesOptimistic([file], fakeServices([new URI('file:///ws')]), handlers)).to.not.throw();
        expect(appended.length).to.equal(1);
    });

    it('finalizes with an absolute-URI FILE_VARIABLE arg when there is no workspace root', async () => {
        const { attachDeviceFilesOptimistic } = loadAttach();
        const backend = inMemoryBackend([]); // no workspace root
        const { handlers, settled } = deferredHandlers(new URI('file:///proj'));
        const file = new File(['hola'], 'notes.txt', { type: 'text/plain' });

        attachDeviceFilesOptimistic([file], backend as never, handlers);
        const result = await settled;

        expect(result.kind).to.equal('finalize');
        if (result.kind === 'finalize') {
            expect(result.request.variable.name).to.equal('file');
            expect(result.request.arg).to.equal('file:///proj/notes.txt');
        }
        expect(backend.files.has('file:///proj/notes.txt')).to.equal(true);
    });

    it("the real Theia FILE_VARIABLE resolves that arg to the file's content (no workspace root)", async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { FileVariableContribution, FILE_VARIABLE } = require('@theia/ai-core/lib/browser/file-variable-contribution');
        const backend = inMemoryBackend([]);
        backend.files.set('file:///proj/notes.txt', 'device-file-body');

        const contribution = new FileVariableContribution();
        (contribution as { fileService: unknown }).fileService = backend.fileService;
        (contribution as { wsService: unknown }).wsService = backend.workspaceService;

        const resolved = await contribution.resolve({ variable: FILE_VARIABLE, arg: 'file:///proj/notes.txt' }, {});
        expect(resolved, 'FILE_VARIABLE should resolve the absolute-URI arg').to.not.equal(undefined);
        expect(resolved.contextValue).to.equal('device-file-body');
    });
});
