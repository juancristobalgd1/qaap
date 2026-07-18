// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    createPreviewAnnotation,
    isBlankAnnotationComment,
    PreviewAnnotationStore,
    sanitizeAnnotationComment,
} from './qaap-preview-annotation-store';
import type { PreviewAnnotationScope } from './qaap-preview-annotation-types';
import {
    buildPreviewFeedbackDedupeKey,
    confirmedAnnotationsForChat,
    formatPreviewFeedbackAgentContext,
    formatPreviewFeedbackChipTitle,
} from './qaap-preview-annotation-context';

function scope(partial?: Partial<PreviewAnnotationScope>): PreviewAnnotationScope {
    return {
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        previewUrl: 'http://localhost:3001/',
        route: '/home',
        viewportMode: 'mobile',
        viewportWidth: 390,
        viewportHeight: 844,
        ...partial,
    };
}

describe('qaap-preview-annotation-store', () => {
    it('sanitizes and rejects blank comments', () => {
        expect(sanitizeAnnotationComment('  hello\u0000  ')).to.equal('hello');
        expect(isBlankAnnotationComment('   ')).to.equal(true);
        expect(isBlankAnnotationComment('ok')).to.equal(false);
    });

    it('neutralizes backtick fences that would break the outbound fenced block', () => {
        expect(sanitizeAnnotationComment('```\ncode fence\n```')).to.equal('code fence');
        expect(sanitizeAnnotationComment('before\n````js\nafter')).to.equal('before\njs\nafter');
        expect(sanitizeAnnotationComment('inline ``` stays')).to.equal('inline ``` stays');
    });

    it('isolates annotations by conversation and route', () => {
        const store = new PreviewAnnotationStore(undefined);
        store.add(createPreviewAnnotation(scope(), {
            comment: 'a',
            anchor: { kind: 'page', documentXRatio: 0.1, documentYRatio: 0.2 },
            documentXRatio: 0.1,
            documentYRatio: 0.2,
            status: 'confirmed',
        }));
        store.add(createPreviewAnnotation(scope({ threadId: 'thread-2' }), {
            comment: 'b',
            anchor: { kind: 'page', documentXRatio: 0.3, documentYRatio: 0.4 },
            documentXRatio: 0.3,
            documentYRatio: 0.4,
            status: 'confirmed',
        }));
        store.add(createPreviewAnnotation(scope({ route: '/about' }), {
            comment: 'c',
            anchor: { kind: 'page', documentXRatio: 0.5, documentYRatio: 0.6 },
            documentXRatio: 0.5,
            documentYRatio: 0.6,
            status: 'confirmed',
        }));

        expect(store.listScope(scope()).map(item => item.comment)).to.deep.equal(['a']);
        expect(store.listForConversation('ws-1', 'thread-1').map(item => item.comment)).to.deep.equal(['a', 'c']);
        expect(store.listVisibleMarkers(scope({ route: '/about' })).map(item => item.comment)).to.deep.equal(['c']);
    });

    it('supports provisional confirm, cancel via remove, multi, edit, and undo', () => {
        const store = new PreviewAnnotationStore(undefined);
        const first = store.add(createPreviewAnnotation(scope(), {
            comment: '',
            anchor: { kind: 'element', selector: 'button.cta', xRatio: 0.5, yRatio: 0.5 },
            documentXRatio: 0.2,
            documentYRatio: 0.3,
            status: 'draft',
        }));
        expect(store.update(first.id, { comment: '   ', status: 'confirmed' })?.comment).to.equal('');
        store.update(first.id, { comment: 'Fix CTA', status: 'confirmed' });
        store.remove(first.id); // cancel path
        expect(store.listScope(scope())).to.have.length(0);

        const a = store.add(createPreviewAnnotation(scope(), {
            comment: 'one',
            anchor: { kind: 'page', documentXRatio: 0.1, documentYRatio: 0.1 },
            documentXRatio: 0.1,
            documentYRatio: 0.1,
            status: 'confirmed',
        }));
        const b = store.add(createPreviewAnnotation(scope(), {
            comment: 'two',
            anchor: { kind: 'page', documentXRatio: 0.2, documentYRatio: 0.2 },
            documentXRatio: 0.2,
            documentYRatio: 0.2,
            status: 'confirmed',
        }));
        store.update(a.id, { comment: 'one-edited' });
        expect(store.get(a.id)?.comment).to.equal('one-edited');
        expect(store.undoLast(scope())?.id).to.equal(b.id);
        expect(store.listScope(scope()).map(item => item.id)).to.deep.equal([a.id]);
    });

    it('clearScope removes draft/confirmed/attached only for that scope', () => {
        const store = new PreviewAnnotationStore(undefined);
        store.add(createPreviewAnnotation(scope({ route: '/about' }), {
            id: 'other-route',
            comment: 'keep-other-route',
            anchor: { kind: 'page', documentXRatio: 0.1, documentYRatio: 0.1 },
            documentXRatio: 0.1,
            documentYRatio: 0.1,
            status: 'confirmed',
        }));
        store.add(createPreviewAnnotation(scope(), {
            id: 'draft-1',
            comment: '',
            anchor: { kind: 'page', documentXRatio: 0.2, documentYRatio: 0.2 },
            documentXRatio: 0.2,
            documentYRatio: 0.2,
            status: 'draft',
        }));
        store.add(createPreviewAnnotation(scope(), {
            id: 'conf-1',
            comment: 'ship',
            anchor: { kind: 'page', documentXRatio: 0.3, documentYRatio: 0.3 },
            documentXRatio: 0.3,
            documentYRatio: 0.3,
            status: 'confirmed',
        }));
        store.markAttached(['conf-1']);
        expect(store.clearScope(scope())).to.equal(2);
        expect(store.listScope(scope())).to.have.length(0);
        expect(store.get('other-route')?.comment).to.equal('keep-other-route');
    });

    it('formats chip title, agent context, and stable dedupe key', () => {
        const items = [
            createPreviewAnnotation(scope(), {
                comment: 'Move button',
                anchor: { kind: 'element', selector: 'button.cta', xRatio: 0.4, yRatio: 0.6 },
                documentXRatio: 0.2,
                documentYRatio: 0.3,
                status: 'confirmed',
                element: { tagName: 'button', sourceFile: 'src/Cta.tsx', sourceLine: 12 },
            }),
            createPreviewAnnotation(scope(), {
                comment: 'More padding',
                anchor: { kind: 'page', documentXRatio: 0.5, documentYRatio: 0.5 },
                documentXRatio: 0.5,
                documentYRatio: 0.5,
                status: 'confirmed',
            }),
        ];
        const title = formatPreviewFeedbackChipTitle(items, '/home', 'mobile');
        expect(title).to.contain('Preview feedback');
        expect(title).to.contain('/home');
        const body = formatPreviewFeedbackAgentContext(items);
        expect(body).to.contain('Move button');
        expect(body).to.contain('button.cta');
        expect(body).to.contain('src/Cta.tsx');
        expect(body).to.not.contain('<html');
        const key = buildPreviewFeedbackDedupeKey(items[0]!, items.map(item => item.id));
        expect(key).to.equal(buildPreviewFeedbackDedupeKey(items[0]!, [...items.map(item => item.id)].reverse()));
        expect(confirmedAnnotationsForChat(items)).to.have.length(2);
    });
});
