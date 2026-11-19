// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { PreviewAnnotationStore, createPreviewAnnotation } from '@theia/qaap-adapters/lib/browser/qaap-preview-annotation-store';
import type { PreviewAnnotationScope } from '@theia/qaap-adapters/lib/browser/qaap-preview-annotation-types';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { MobileProjectsTranscriptSurfacesUiContext } from './mobile-projects-transcript-surfaces-ui-context';
import { resolvePreviewAnnotationScopeExtracted } from './mobile-projects-transcript-surfaces-ui-streaming';

disableImportJSDOM();

describe('preview annotation scope', () => {
    let disableDOM: () => void;

    before(() => {
        disableDOM = enableJSDOM();
    });

    after(() => {
        disableDOM();
    });

    function ctxFor(liveUrl: string, conversationId: string): MobileProjectsTranscriptSurfacesUiContext {
        return {
            getTranscriptEmbeddedPreviewUrl: () => liveUrl,
            resolveTranscriptPreviewIdentity: () => ({
                userId: '_dev',
                workspaceId: '/ws/qa-e2e-todo',
                projectId: '/ws/qa-e2e-todo',
                conversationId,
                processId: 'proc-1',
            }),
            host: {
                transcriptEmbeddedPreview: undefined,
                transcriptOpenSummary: { id: conversationId },
                transcriptOpenSummaryId: conversationId,
                transcriptLastConv: undefined,
            },
        } as unknown as MobileProjectsTranscriptSurfacesUiContext;
    }

    const project = { id: 'qa-e2e-todo' } as MobileProjectEntry;
    const previewUrl = 'http://127.0.0.1:3002/';

    function scopeAt(liveUrl: string, conversationId = 'conv-1'): PreviewAnnotationScope {
        return resolvePreviewAnnotationScopeExtracted(ctxFor(liveUrl, conversationId), project, previewUrl);
    }

    it('keeps the hard-reload cache-bust marker out of the route', () => {
        expect(scopeAt('http://127.0.0.1:3002/?_qaap_cache_bust=1795010821889').route).to.equal('/');
        expect(scopeAt('http://127.0.0.1:3002/items?tab=2&_qaap_cache_bust=1795010821889#top').route).to.equal('/items?tab=2#top');
    });

    it('keeps a draft in the same scope across a hard reload, so Send clears it', () => {
        const store = new PreviewAnnotationStore(undefined);
        const before = scopeAt('http://127.0.0.1:3002/');
        store.add(createPreviewAnnotation(before, {
            comment: 'make it blue',
            anchor: { kind: 'document' } as never,
            documentXRatio: 0.5,
            documentYRatio: 0.5,
        }));
        const afterReload = scopeAt('http://127.0.0.1:3002/?_qaap_cache_bust=1795010821889');
        expect(store.listScope(afterReload)).to.have.length(1);
        expect(store.clearScope(afterReload)).to.equal(1);
        expect(store.list()).to.have.length(0);
    });

    it('never shares annotations between conversations of the same project or between projects', () => {
        const store = new PreviewAnnotationStore(undefined);
        const own = scopeAt('http://127.0.0.1:3002/', 'conv-1');
        store.add(createPreviewAnnotation(own, {
            comment: 'only for conv-1',
            anchor: { kind: 'document' } as never,
            documentXRatio: 0.1,
            documentYRatio: 0.1,
        }));
        const sibling = scopeAt('http://127.0.0.1:3002/', 'conv-2');
        expect(store.listScope(sibling)).to.deep.equal([]);
        expect(store.listForConversation(sibling.workspaceId, sibling.threadId, sibling.previewId)).to.deep.equal([]);
        const otherProject = resolvePreviewAnnotationScopeExtracted(
            ctxFor('http://127.0.0.1:3002/', 'conv-1'),
            { id: 'notes-dev' } as MobileProjectEntry,
            previewUrl,
        );
        expect(store.listScope(otherProject)).to.deep.equal([]);
        expect(store.listForConversation(otherProject.workspaceId, otherProject.threadId)).to.deep.equal([]);
    });
});
