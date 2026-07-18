// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

let disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import {
    ELEMENT_ANNOTATION_POINT_TYPE,
    ELEMENT_ANNOTATION_REANCHOR_RESULT_TYPE,
    ELEMENT_SET_MODE_TYPE,
} from '@theia/qaap-element-inspector/lib/browser/element-inspector-types';
import { QaapPreviewAnnotationController } from './qaap-preview-annotation-controller';
import { PreviewAnnotationStore } from './qaap-preview-annotation-store';
import { QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND } from './qaap-preview-annotation-context';

disableJSDOM();

function createFrame(): HTMLIFrameElement {
    const frame = document.createElement('iframe');
    const win = {
        postMessage: (_data: unknown, _origin: string) => { /* noop */ },
    };
    const install = (): void => {
        Object.defineProperty(frame, 'contentWindow', {
            configurable: true,
            get: () => win,
        });
    };
    install();
    frame.addEventListener('load', install);
    return frame;
}

function frameMessage(
    frame: HTMLIFrameElement,
    data: unknown,
    source: unknown = frame.contentWindow,
): Pick<MessageEvent, 'data' | 'source'> {
    return { data, source: source as MessageEventSource };
}

/** jsdom often lacks PointerEvent; MouseEvent with the same type still reaches listeners. */
function dispatchPointer(target: EventTarget, type: 'pointerdown' | 'pointerup' | 'pointercancel', pointerId = 1): void {
    if (typeof PointerEvent === 'function') {
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId }));
        return;
    }
    const event = new MouseEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    target.dispatchEvent(event);
}

describe('qaap-preview-annotation-controller', () => {
    let toDispose: DisposableCollection;

    before(() => {
        disableJSDOM = enableJSDOM();
        if (typeof window.requestAnimationFrame !== 'function') {
            window.requestAnimationFrame = (cb: FrameRequestCallback): number => window.setTimeout(() => cb(Date.now()), 0) as unknown as number;
        }
        if (typeof window.cancelAnimationFrame !== 'function') {
            window.cancelAnimationFrame = (id: number): void => {
                window.clearTimeout(id);
            };
        }
    });

    after(() => {
        disableJSDOM();
    });

    beforeEach(() => {
        toDispose = new DisposableCollection();
        document.body.replaceChildren();
        try {
            sessionStorage?.removeItem('qaap.preview.annotations.v1');
        } catch {
            /* jsdom without storage */
        }
    });

    afterEach(() => {
        toDispose.dispose();
        document.body.replaceChildren();
    });

    it('activates annotate via set-mode without changing iframe src', () => {
        const frame = createFrame();
        frame.src = 'http://localhost:3001/app';
        const initialSrc = frame.src;
        const slot = document.createElement('div');
        slot.append(frame);
        document.body.append(slot);
        const posted: unknown[] = [];
        (frame.contentWindow as { postMessage: (data: unknown) => void }).postMessage = data => {
            posted.push(data);
        };
        const store = new PreviewAnnotationStore(undefined);
        const controller = new QaapPreviewAnnotationController({
            frame,
            frameSlot: slot,
            commands: {
                getCommand: () => undefined,
                executeCommand: async () => undefined,
            } as never,
            messageService: { info: () => { /* */ }, warn: () => { /* */ }, error: () => { /* */ } } as never,
            store,
            getScope: () => ({
                workspaceId: 'ws',
                threadId: 't1',
                previewUrl: frame.src,
                route: '/app',
                viewportMode: 'desktop',
                viewportWidth: 800,
                viewportHeight: 600,
            }),
            startSelectPicker: () => { /* */ },
            injectBridge: () => { /* */ },
            toDispose,
        });
        controller.setInteractionMode('annotate');
        expect(frame.src).to.equal(initialSrc);
        expect(posted.some(item => (item as { type?: string; mode?: string }).type === ELEMENT_SET_MODE_TYPE
            && (item as { mode?: string }).mode === 'annotate')).to.equal(true);
        expect(controller.getInteractionMode()).to.equal('annotate');
    });

    it('creates provisional marker, confirms, rejects empty, cancels, and undoes', () => {
        const frame = createFrame();
        const slot = document.createElement('div');
        slot.append(frame);
        document.body.append(slot);
        const store = new PreviewAnnotationStore(undefined);
        const controller = new QaapPreviewAnnotationController({
            frame,
            frameSlot: slot,
            commands: {
                getCommand: () => ({ id: QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND }),
                executeCommand: async () => true,
            } as never,
            messageService: { info: () => { /* */ }, warn: () => { /* */ }, error: () => { /* */ } } as never,
            store,
            getScope: () => ({
                workspaceId: 'ws',
                threadId: 't1',
                previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
                route: '/home',
                viewportMode: 'mobile',
                viewportWidth: 390,
                viewportHeight: 844,
            }),
            startSelectPicker: () => { /* */ },
            injectBridge: () => { /* */ },
            toDispose,
        });
        controller.setInteractionMode('annotate');

        controller.onWindowMessage(frameMessage(frame, {
            type: ELEMENT_ANNOTATION_POINT_TYPE,
            payload: {
                version: 1,
                clientX: 40,
                clientY: 60,
                route: '/home',
                pageUrl: 'http://localhost:3001/home',
                documentXRatio: 0.2,
                documentYRatio: 0.3,
                viewportWidth: 390,
                viewportHeight: 844,
                scrollX: 0,
                scrollY: 0,
                element: {
                    selector: 'button.cta',
                    tagName: 'button',
                    rect: { top: 10, left: 10, width: 80, height: 40 },
                    xRatio: 0.5,
                    yRatio: 0.5,
                    documentXRatio: 0.2,
                    documentYRatio: 0.3,
                },
            },
        }));

        expect(store.listScope({
            workspaceId: 'ws', threadId: 't1', previewUrl: 'http://localhost:3001/', route: '/home',
        })).to.have.length(1);
        expect(document.querySelector('.qaap-preview-annotation-popover')).to.exist;

        const textarea = document.querySelector('.qaap-preview-annotation-popover-input') as HTMLTextAreaElement;
        const confirm = document.querySelector('.qaap-preview-annotation-popover-confirm') as HTMLButtonElement;
        textarea.value = '   ';
        confirm.click();
        expect(store.list()[0]?.status).to.equal('draft');

        textarea.value = 'Looks off';
        confirm.click();
        expect(store.list()[0]?.status).to.equal('confirmed');
        expect(store.list()[0]?.comment).to.equal('Looks off');

        controller.onWindowMessage(frameMessage(frame, {
            type: ELEMENT_ANNOTATION_POINT_TYPE,
            payload: {
                version: 1,
                clientX: 10,
                clientY: 10,
                route: '/home',
                pageUrl: 'http://localhost:3001/home',
                documentXRatio: 0.1,
                documentYRatio: 0.1,
                viewportWidth: 390,
                viewportHeight: 844,
                scrollX: 0,
                scrollY: 0,
            },
        }));
        const cancel = document.querySelector('.qaap-preview-annotation-popover-cancel') as HTMLButtonElement;
        cancel.click();
        expect(store.listScope({
            workspaceId: 'ws', threadId: 't1', previewUrl: 'http://localhost:3001/', route: '/home',
        })).to.have.length(1);

        controller.undoLastAnnotation();
        expect(store.listScope({
            workspaceId: 'ws', threadId: 't1', previewUrl: 'http://localhost:3001/', route: '/home',
        })).to.have.length(0);
    });

    it('attaches composerSession controls into the Cursor-style annotation popover', async () => {
        const frame = createFrame();
        const slot = document.createElement('div');
        slot.append(frame);
        document.body.append(slot);
        const store = new PreviewAnnotationStore(undefined);
        let attached = 0;
        let disposed = 0;
        const controller = new QaapPreviewAnnotationController({
            frame,
            frameSlot: slot,
            commands: {
                getCommand: () => ({ id: QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND }),
                executeCommand: async () => true,
            } as never,
            messageService: { info: () => { /* */ }, warn: () => { /* */ }, error: () => { /* */ } } as never,
            store,
            getScope: () => ({
                workspaceId: 'ws',
                threadId: 't1',
                previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
                route: '/home',
                viewportMode: 'desktop',
                viewportWidth: 800,
                viewportHeight: 600,
            }),
            startSelectPicker: () => { /* */ },
            injectBridge: () => { /* */ },
            toDispose,
            composerSession: {
                attach: host => {
                    attached += 1;
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'theia-mobile-projects-sticky-composer-agent';
                    btn.textContent = 'Codex';
                    host.append(btn);
                    return {
                        dispose: () => {
                            disposed += 1;
                            host.replaceChildren();
                        },
                    };
                },
            },
        });
        controller.setInteractionMode('annotate');
        controller.onWindowMessage(frameMessage(frame, {
            type: ELEMENT_ANNOTATION_POINT_TYPE,
            payload: {
                version: 1,
                clientX: 40,
                clientY: 60,
                route: '/home',
                pageUrl: 'http://localhost:3001/home',
                documentXRatio: 0.2,
                documentYRatio: 0.3,
                viewportWidth: 390,
                viewportHeight: 844,
                scrollX: 0,
                scrollY: 0,
                element: {
                    selector: 'button.cta',
                    tagName: 'button',
                    rect: { top: 10, left: 10, width: 80, height: 40 },
                    xRatio: 0.5,
                    yRatio: 0.5,
                    documentXRatio: 0.2,
                    documentYRatio: 0.3,
                },
            },
        }));
        expect(attached).to.equal(1);
        const popover = document.querySelector('.qaap-preview-annotation-popover') as HTMLElement;
        expect(popover).to.exist;
        expect(popover.querySelector('.qaap-preview-annotation-popover-session .theia-mobile-projects-sticky-composer-agent'))
            .to.exist;
        expect(document.querySelector('.qaap-preview-annotation-workhub-composer')).to.not.exist;

        const cancel = popover.querySelector('.qaap-preview-annotation-popover-cancel') as HTMLButtonElement;
        cancel.click();
        expect(disposed).to.equal(1);
    });

    it('applies setComposerSession after construction (reuse / late wire)', async () => {
        const frame = createFrame();
        const slot = document.createElement('div');
        slot.append(frame);
        document.body.append(slot);
        const store = new PreviewAnnotationStore(undefined);
        let attached = 0;
        const controller = new QaapPreviewAnnotationController({
            frame,
            frameSlot: slot,
            commands: {
                getCommand: () => ({ id: QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND }),
                executeCommand: async () => true,
            } as never,
            messageService: { info: () => { /* */ }, warn: () => { /* */ }, error: () => { /* */ } } as never,
            store,
            getScope: () => ({
                workspaceId: 'ws',
                threadId: 't1',
                previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
                route: '/home',
                viewportMode: 'desktop',
                viewportWidth: 800,
                viewportHeight: 600,
            }),
            startSelectPicker: () => { /* */ },
            injectBridge: () => { /* */ },
            toDispose,
        });
        controller.setComposerSession({
            attach: host => {
                attached += 1;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'theia-mobile-projects-sticky-composer-agent';
                btn.textContent = 'QAIQ';
                host.append(btn);
                return { dispose: () => host.replaceChildren() };
            },
        });
        controller.setInteractionMode('annotate');
        controller.onWindowMessage(frameMessage(frame, {
            type: ELEMENT_ANNOTATION_POINT_TYPE,
            payload: {
                version: 1,
                clientX: 40,
                clientY: 60,
                route: '/home',
                pageUrl: 'http://localhost:3001/home',
                documentXRatio: 0.2,
                documentYRatio: 0.3,
                viewportWidth: 390,
                viewportHeight: 844,
                scrollX: 0,
                scrollY: 0,
                element: {
                    selector: 'button.cta',
                    tagName: 'button',
                    rect: { top: 10, left: 10, width: 80, height: 40 },
                    xRatio: 0.5,
                    yRatio: 0.5,
                    documentXRatio: 0.2,
                    documentYRatio: 0.3,
                },
            },
        }));
        expect(attached).to.equal(1);
        expect(document.querySelector('.qaap-preview-annotation-popover')).to.exist;
        expect(document.querySelector(
            '.qaap-preview-annotation-popover-session .theia-mobile-projects-sticky-composer-agent',
        )?.textContent).to.equal('QAIQ');
    });

    it('rejects unauthorized message sources', () => {
        const frame = createFrame();
        const slot = document.createElement('div');
        slot.append(frame);
        document.body.append(slot);
        // Re-assert contentWindow shim after attach (jsdom may replace it).
        const trusted = { postMessage: () => { /* */ } };
        Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => trusted });
        const store = new PreviewAnnotationStore(undefined);
        const controller = new QaapPreviewAnnotationController({
            frame,
            frameSlot: slot,
            commands: { getCommand: () => undefined, executeCommand: async () => undefined } as never,
            messageService: { info: () => { /* */ }, warn: () => { /* */ }, error: () => { /* */ } } as never,
            store,
            getScope: () => ({
                workspaceId: 'ws',
                threadId: 't1',
                previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
                route: '/',
                viewportMode: 'desktop',
                viewportWidth: 800,
                viewportHeight: 600,
            }),
            startSelectPicker: () => { /* */ },
            injectBridge: () => { /* */ },
            toDispose,
        });
        controller.setInteractionMode('annotate');
        const outsider = { postMessage: () => { /* */ } };
        controller.onWindowMessage(frameMessage(frame, {
            type: ELEMENT_ANNOTATION_POINT_TYPE,
            payload: {
                version: 1,
                clientX: 1,
                clientY: 1,
                route: '/',
                pageUrl: 'http://localhost:3001/',
                documentXRatio: 0.1,
                documentYRatio: 0.1,
                viewportWidth: 800,
                viewportHeight: 600,
                scrollX: 0,
                scrollY: 0,
            },
        }, outsider));
        expect(store.list()).to.have.length(0);
        controller.onWindowMessage(frameMessage(frame, {
            type: ELEMENT_ANNOTATION_POINT_TYPE,
            payload: {
                version: 1,
                clientX: 1,
                clientY: 1,
                route: '/',
                pageUrl: 'http://localhost:3001/',
                documentXRatio: 0.1,
                documentYRatio: 0.1,
                viewportWidth: 800,
                viewportHeight: 600,
                scrollX: 0,
                scrollY: 0,
            },
        }, trusted));
        expect(store.list()).to.have.length(1);
    });

    it('Send attaches+submits confirmed annotations, toasts, clears store/markers, and exits annotate', async () => {
        const frame = createFrame();
        const slot = document.createElement('div');
        slot.append(frame);
        document.body.append(slot);
        const store = new PreviewAnnotationStore(undefined);
        const calls: Array<{ id: string; args: unknown }> = [];
        const toasts: Array<{ message: string; kind?: string }> = [];
        const scope = {
            workspaceId: 'ws',
            threadId: 't1',
            previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
            route: '/home',
            viewportMode: 'mobile' as const,
            viewportWidth: 390,
            viewportHeight: 844,
        };
        const controller = new QaapPreviewAnnotationController({
            frame,
            frameSlot: slot,
            commands: {
                getCommand: (id: string) => id === QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND ? { id } : undefined,
                executeCommand: async (id: string, args: unknown) => {
                    calls.push({ id, args });
                    return true;
                },
            } as never,
            messageService: { info: () => { /* */ }, warn: () => { /* */ }, error: () => { /* */ } } as never,
            notify: (message, kind) => { toasts.push({ message, kind }); },
            store,
            getScope: () => scope,
            startSelectPicker: () => { /* */ },
            injectBridge: () => { /* */ },
            toDispose,
        });
        store.add({
            id: 'a1',
            workspaceId: 'ws',
            threadId: 't1',
            previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
            route: '/home',
            comment: 'Hi',
            viewport: { mode: 'mobile', width: 390, height: 844 },
            anchor: { kind: 'page', documentXRatio: 0.2, documentYRatio: 0.3 },
            documentXRatio: 0.2,
            documentYRatio: 0.3,
            status: 'confirmed',
            createdAt: Date.now(),
        });
        store.add({
            id: 'a2',
            workspaceId: 'ws',
            threadId: 't1',
            previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
            route: '/home',
            comment: 'There',
            viewport: { mode: 'mobile', width: 390, height: 844 },
            anchor: { kind: 'page', documentXRatio: 0.4, documentYRatio: 0.5 },
            documentXRatio: 0.4,
            documentYRatio: 0.5,
            status: 'confirmed',
            createdAt: Date.now() + 1,
        });
        store.add({
            id: 'draft-left',
            workspaceId: 'ws',
            threadId: 't1',
            previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
            route: '/home',
            comment: '',
            viewport: { mode: 'mobile', width: 390, height: 844 },
            anchor: { kind: 'page', documentXRatio: 0.1, documentYRatio: 0.1 },
            documentXRatio: 0.1,
            documentYRatio: 0.1,
            status: 'draft',
            createdAt: Date.now() + 2,
        });
        controller.startAnnotateMode();
        // Seed marker positions so the overlay has numbered buttons before Send.
        controller.onWindowMessage(frameMessage(frame, {
            type: ELEMENT_ANNOTATION_REANCHOR_RESULT_TYPE,
            payload: {
                items: [
                    { id: 'a1', clientX: 10, clientY: 20, unresolved: false },
                    { id: 'a2', clientX: 30, clientY: 40, unresolved: false },
                    { id: 'draft-left', clientX: 5, clientY: 5, unresolved: false },
                ],
            },
        }));
        const markersHost = slot.querySelector('.qaap-preview-annotation-markers') as HTMLElement;
        expect(markersHost.querySelectorAll('.qaap-preview-annotation-marker')).to.have.length(3);

        await controller.addAnnotationsToChat();
        expect(calls).to.have.length(1);
        expect(calls[0]!.id).to.equal(QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND);
        expect(calls[0]!.args).to.include({ submit: true });
        expect((calls[0]!.args as { dedupeKey: string }).dedupeKey).to.contain('a1');
        expect((calls[0]!.args as { dedupeKey: string }).dedupeKey).to.contain('a2');
        expect((calls[0]!.args as { images?: unknown[] }).images).to.equal(undefined);
        expect(store.get('a1')).to.equal(undefined);
        expect(store.get('a2')).to.equal(undefined);
        expect(store.get('draft-left')).to.equal(undefined);
        expect(store.listScope(scope)).to.have.length(0);
        expect(store.listVisibleMarkers(scope)).to.have.length(0);
        expect(markersHost.querySelectorAll('.qaap-preview-annotation-marker')).to.have.length(0);
        expect(controller.getInteractionMode()).to.equal('browse');
        expect(toasts).to.have.length(1);
        expect(toasts[0]!.message).to.match(/2 annotations sent to chat/);

        // Cleared scope: nothing left to send again.
        await controller.addAnnotationsToChat();
        expect(calls).to.have.length(1);
        expect(toasts.some(entry => /Confirm at least one annotation/i.test(entry.message))).to.equal(true);
    });

    it('Send includes confirmed annotations from other routes after SPA navigation', async () => {
        const frame = createFrame();
        const slot = document.createElement('div');
        slot.append(frame);
        document.body.append(slot);
        const store = new PreviewAnnotationStore(undefined);
        const calls: Array<{ id: string; args: unknown }> = [];
        const controller = new QaapPreviewAnnotationController({
            frame,
            frameSlot: slot,
            commands: {
                getCommand: (id: string) => id === QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND ? { id } : undefined,
                executeCommand: async (id: string, args: unknown) => {
                    calls.push({ id, args });
                    return true;
                },
            } as never,
            messageService: { info: () => { /* */ }, warn: () => { /* */ }, error: () => { /* */ } } as never,
            store,
            // The user navigated the preview SPA to /checkout after confirming on other routes.
            getScope: () => ({
                workspaceId: 'ws',
                threadId: 't1',
                previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
                route: '/checkout',
                viewportMode: 'mobile',
                viewportWidth: 390,
                viewportHeight: 844,
            }),
            startSelectPicker: () => { /* */ },
            injectBridge: () => { /* */ },
            toDispose,
        });
        store.add({
            id: 'home-1',
            workspaceId: 'ws',
            threadId: 't1',
            previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
            route: '/home',
            comment: 'Home issue',
            viewport: { mode: 'mobile', width: 390, height: 844 },
            anchor: { kind: 'page', documentXRatio: 0.2, documentYRatio: 0.3 },
            documentXRatio: 0.2,
            documentYRatio: 0.3,
            status: 'confirmed',
            createdAt: Date.now(),
        });
        store.add({
            id: 'pricing-1',
            workspaceId: 'ws',
            threadId: 't1',
            previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
            route: '/pricing',
            comment: 'Pricing issue',
            viewport: { mode: 'mobile', width: 390, height: 844 },
            anchor: { kind: 'page', documentXRatio: 0.4, documentYRatio: 0.5 },
            documentXRatio: 0.4,
            documentYRatio: 0.5,
            status: 'confirmed',
            createdAt: Date.now() + 1,
        });

        await controller.addAnnotationsToChat();
        expect(calls).to.have.length(1);
        const args = calls[0]!.args as { chipTitle: string; contextBody: string; dedupeKey: string };
        expect(args.dedupeKey).to.contain('home-1');
        expect(args.dedupeKey).to.contain('pricing-1');
        expect(args.contextBody).to.contain('/home');
        expect(args.contextBody).to.contain('/pricing');
        // Mixed routes: the chip title falls back to the live scope route.
        expect(args.chipTitle).to.contain('/checkout');
        expect(store.get('home-1')).to.equal(undefined);
        expect(store.get('pricing-1')).to.equal(undefined);
    });

    it('Send commits a typed-but-unconfirmed popover draft instead of dropping it', async () => {
        const frame = createFrame();
        const slot = document.createElement('div');
        slot.append(frame);
        document.body.append(slot);
        const store = new PreviewAnnotationStore(undefined);
        const calls: Array<{ id: string; args: unknown }> = [];
        const controller = new QaapPreviewAnnotationController({
            frame,
            frameSlot: slot,
            commands: {
                getCommand: (id: string) => id === QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND ? { id } : undefined,
                executeCommand: async (id: string, args: unknown) => {
                    calls.push({ id, args });
                    return true;
                },
            } as never,
            messageService: { info: () => { /* */ }, warn: () => { /* */ }, error: () => { /* */ } } as never,
            store,
            getScope: () => ({
                workspaceId: 'ws',
                threadId: 't1',
                previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
                route: '/home',
                viewportMode: 'mobile',
                viewportWidth: 390,
                viewportHeight: 844,
            }),
            startSelectPicker: () => { /* */ },
            injectBridge: () => { /* */ },
            toDispose,
        });
        controller.setInteractionMode('annotate');
        controller.onWindowMessage(frameMessage(frame, {
            type: ELEMENT_ANNOTATION_POINT_TYPE,
            payload: {
                version: 1,
                clientX: 40,
                clientY: 60,
                route: '/home',
                pageUrl: 'http://localhost:3001/home',
                documentXRatio: 0.2,
                documentYRatio: 0.3,
                viewportWidth: 390,
                viewportHeight: 844,
                scrollX: 0,
                scrollY: 0,
            },
        }));
        const textarea = document.querySelector('.qaap-preview-annotation-popover-input') as HTMLTextAreaElement;
        textarea.value = 'Still typing this one';

        await controller.addAnnotationsToChat();
        expect(calls).to.have.length(1);
        const args = calls[0]!.args as { contextBody: string };
        expect(args.contextBody).to.contain('Still typing this one');
        expect(document.querySelector('.qaap-preview-annotation-popover')).to.not.exist;
        expect(store.list()).to.have.length(0);
    });

    it('Send includes pending annotate screenshot as image chat context', async () => {
        const frame = createFrame();
        const slot = document.createElement('div');
        slot.append(frame);
        document.body.append(slot);
        const store = new PreviewAnnotationStore(undefined);
        const calls: Array<{ id: string; args: unknown }> = [];
        const controller = new QaapPreviewAnnotationController({
            frame,
            frameSlot: slot,
            commands: {
                getCommand: (id: string) => id === QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND ? { id } : undefined,
                executeCommand: async (id: string, args: unknown) => {
                    calls.push({ id, args });
                    return true;
                },
            } as never,
            messageService: { info: () => { /* */ }, warn: () => { /* */ }, error: () => { /* */ } } as never,
            store,
            getScope: () => ({
                workspaceId: 'ws',
                threadId: 't1',
                previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
                route: '/home',
                viewportMode: 'mobile',
                viewportWidth: 390,
                viewportHeight: 844,
            }),
            startSelectPicker: () => { /* */ },
            injectBridge: () => { /* */ },
            toDispose,
        });
        store.add({
            id: 'shot-1',
            workspaceId: 'ws',
            threadId: 't1',
            previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
            route: '/home',
            comment: 'With screenshot',
            viewport: { mode: 'mobile', width: 390, height: 844 },
            anchor: { kind: 'page', documentXRatio: 0.2, documentYRatio: 0.3 },
            documentXRatio: 0.2,
            documentYRatio: 0.3,
            status: 'confirmed',
            createdAt: Date.now(),
        });
        controller.setPendingChatScreenshot({
            name: 'preview-screenshot.png',
            mimeType: 'image/png',
            data: 'ZmFrZQ==',
        });
        expect(controller.getPendingChatScreenshot()?.data).to.equal('ZmFrZQ==');
        await controller.addAnnotationsToChat();
        expect(calls).to.have.length(1);
        const args = calls[0]!.args as {
            submit: boolean;
            images?: Array<{ name: string; mimeType: string; data: string }>;
        };
        expect(args.submit).to.equal(true);
        expect(args.images).to.have.length(1);
        expect(args.images![0]).to.deep.equal({
            name: 'preview-screenshot.png',
            mimeType: 'image/png',
            data: 'ZmFrZQ==',
        });
        expect(controller.getPendingChatScreenshot()).to.equal(undefined);
        expect(store.get('shot-1')).to.equal(undefined);
    });

    it('Send does not mark attached or toast success when attach/submit fails', async () => {
        const frame = createFrame();
        const slot = document.createElement('div');
        slot.append(frame);
        document.body.append(slot);
        const store = new PreviewAnnotationStore(undefined);
        const toasts: Array<{ message: string; kind?: string }> = [];
        const controller = new QaapPreviewAnnotationController({
            frame,
            frameSlot: slot,
            commands: {
                getCommand: (id: string) => id === QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND ? { id } : undefined,
                executeCommand: async () => false,
            } as never,
            messageService: { info: () => { /* */ }, warn: () => { /* */ }, error: () => { /* */ } } as never,
            notify: (message, kind) => { toasts.push({ message, kind }); },
            store,
            getScope: () => ({
                workspaceId: 'ws',
                threadId: 't1',
                previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
                route: '/home',
                viewportMode: 'mobile',
                viewportWidth: 390,
                viewportHeight: 844,
            }),
            startSelectPicker: () => { /* */ },
            injectBridge: () => { /* */ },
            toDispose,
        });
        store.add({
            id: 'fail-1',
            workspaceId: 'ws',
            threadId: 't1',
            previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
            route: '/home',
            comment: 'Nope',
            viewport: { mode: 'mobile', width: 390, height: 844 },
            anchor: { kind: 'page', documentXRatio: 0.2, documentYRatio: 0.3 },
            documentXRatio: 0.2,
            documentYRatio: 0.3,
            status: 'confirmed',
            createdAt: Date.now(),
        });
        await controller.addAnnotationsToChat();
        expect(store.get('fail-1')?.status).to.equal('confirmed');
        expect(toasts).to.have.length(1);
        expect(toasts[0]!.kind).to.equal('warn');
        expect(toasts[0]!.message).to.match(/Could not send annotations to chat/i);
    });

    it('overlays URL chrome with annotate action bar and wires close/undo/send', async () => {
        const frame = createFrame();
        const slot = document.createElement('div');
        slot.append(frame);
        const chrome = document.createElement('div');
        chrome.className = 'theia-mini-browser-toolbar';
        const urlField = document.createElement('div');
        urlField.className = 'theia-mini-browser-url-field';
        const workbench = document.createElement('div');
        workbench.className = 'theia-mini-browser-workbench-controls';
        const overflow = document.createElement('button');
        overflow.className = 'qaap-agent-preview-toolbar-overflow';
        chrome.append(urlField, workbench, overflow);
        document.body.append(slot, chrome);

        let screenshotCalls = 0;
        const store = new PreviewAnnotationStore(undefined);
        const controller = new QaapPreviewAnnotationController({
            frame,
            frameSlot: slot,
            toolbarHost: workbench,
            commands: {
                getCommand: (id: string) => id === QAAP_WORK_HUB_ATTACH_COMPOSER_CONTEXT_COMMAND ? { id } : undefined,
                executeCommand: async () => true,
            } as never,
            messageService: { info: () => { /* */ }, warn: () => { /* */ }, error: () => { /* */ } } as never,
            store,
            getScope: () => ({
                workspaceId: 'ws',
                threadId: 't1',
                previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
                route: '/home',
                viewportMode: 'mobile',
                viewportWidth: 390,
                viewportHeight: 844,
            }),
            startSelectPicker: () => { /* */ },
            injectBridge: () => { /* */ },
            takeScreenshot: () => { screenshotCalls += 1; },
            toDispose,
        });

        const bar = chrome.querySelector('.qaap-preview-annotate-toolbar') as HTMLElement;
        expect(bar).to.exist;
        expect(chrome.contains(bar)).to.equal(true);
        expect(workbench.contains(bar)).to.equal(false);
        expect(bar.parentElement).to.equal(chrome);
        expect(bar.classList.contains('qaap-mod-visible')).to.equal(false);
        expect(urlField.classList.contains('qaap-mod-annotate-hidden')).to.equal(false);

        const initialSrc = frame.src;
        controller.setInteractionMode('annotate');
        expect(frame.src).to.equal(initialSrc);
        expect(bar.classList.contains('qaap-mod-visible')).to.equal(true);
        expect(urlField.classList.contains('qaap-mod-annotate-hidden')).to.equal(true);
        expect(chrome.classList.contains('qaap-mod-annotate-active')).to.equal(true);
        expect(workbench.contains(bar)).to.equal(false);
        expect(bar.querySelector('.codicon-trash')).to.equal(null);

        const send = bar.querySelector('.qaap-preview-annotate-toolbar-send') as HTMLButtonElement;
        const badge = bar.querySelector('.qaap-preview-annotate-toolbar-send-badge') as HTMLElement;
        const undo = bar.querySelector('.qaap-preview-annotate-toolbar-icon-btn.codicon-discard') as HTMLButtonElement;
        const screenshot = bar.querySelector('.qaap-preview-annotate-toolbar-icon-btn.codicon-device-camera') as HTMLButtonElement;
        const compare = bar.querySelector('.qaap-preview-annotate-toolbar-icon-btn.qaap-preview-annotate-toolbar-compare-btn') as HTMLButtonElement;
        expect(send).to.exist;
        expect(undo).to.exist;
        expect(screenshot).to.exist;
        expect(compare).to.exist;
        expect(compare.classList.contains('codicon-diff-single')).to.equal(false);
        expect(compare.querySelector('svg.qaap-preview-annotate-toolbar-compare-icon')).to.exist;
        expect(compare.title).to.equal('Hold to see original');
        expect(compare.getAttribute('aria-label')).to.equal('Hold to see original');
        expect(send.disabled).to.equal(true);
        expect(badge.hidden).to.equal(true);
        expect(undo.disabled || undo.classList.contains('qaap-mod-disabled')).to.equal(true);

        expect(screenshot.title).to.equal('Screenshot and attach');
        expect(screenshot.getAttribute('aria-label')).to.equal('Screenshot and attach');
        screenshot.click();
        expect(screenshotCalls).to.equal(1);

        store.add({
            id: 'ready-1',
            workspaceId: 'ws',
            threadId: 't1',
            previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
            route: '/home',
            comment: 'Ship it',
            viewport: { mode: 'mobile', width: 390, height: 844 },
            anchor: { kind: 'page', documentXRatio: 0.2, documentYRatio: 0.3 },
            documentXRatio: 0.2,
            documentYRatio: 0.3,
            status: 'confirmed',
            createdAt: Date.now(),
        });
        // Re-enter annotate to refresh toolbar affordances after external store mutation.
        controller.setInteractionMode('browse');
        controller.setInteractionMode('annotate');
        expect(send.disabled).to.equal(false);
        expect(badge.hidden).to.equal(false);
        expect(badge.textContent).to.equal('1');
        expect(undo.disabled).to.equal(false);

        const markersHost = slot.querySelector('.qaap-preview-annotation-markers') as HTMLElement;
        expect(markersHost).to.exist;
        expect(markersHost.hidden).to.equal(false);
        dispatchPointer(compare, 'pointerdown', 1);
        expect(markersHost.hidden).to.equal(true);
        expect(bar.classList.contains('qaap-mod-comparing-original')).to.equal(true);
        dispatchPointer(compare, 'pointerup', 1);
        expect(markersHost.hidden).to.equal(false);
        expect(bar.classList.contains('qaap-mod-comparing-original')).to.equal(false);

        undo.click();
        expect(store.get('ready-1')).to.equal(undefined);
        expect(send.disabled).to.equal(true);
        expect(badge.hidden).to.equal(true);

        store.add({
            id: 'ready-2',
            workspaceId: 'ws',
            threadId: 't1',
            previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
            route: '/home',
            comment: 'Again',
            viewport: { mode: 'mobile', width: 390, height: 844 },
            anchor: { kind: 'page', documentXRatio: 0.2, documentYRatio: 0.3 },
            documentXRatio: 0.2,
            documentYRatio: 0.3,
            status: 'confirmed',
            createdAt: Date.now(),
        });
        controller.setInteractionMode('browse');
        controller.setInteractionMode('annotate');
        expect(send.disabled).to.equal(false);
        expect(badge.textContent).to.equal('1');
        await controller.addAnnotationsToChat();
        expect(store.get('ready-2')).to.equal(undefined);
        expect(controller.getInteractionMode()).to.equal('browse');
        expect(send.disabled).to.equal(true);
        expect(badge.hidden).to.equal(true);
        expect(bar.classList.contains('qaap-mod-visible')).to.equal(false);
        expect(urlField.classList.contains('qaap-mod-annotate-hidden')).to.equal(false);
        expect(chrome.classList.contains('qaap-mod-annotate-active')).to.equal(false);
    });

    it('mounts annotate toolbar after workbench is parented under chrome (embedded race)', () => {
        const frame = createFrame();
        const slot = document.createElement('div');
        slot.append(frame);
        const chrome = document.createElement('div');
        chrome.className = 'qaap-agent-preview-embedded-toolbar theia-mini-browser-toolbar';
        const urlField = document.createElement('div');
        urlField.className = 'theia-mini-browser-url-field';
        const workbench = document.createElement('div');
        workbench.className = 'theia-mini-browser-workbench-controls';
        const history = document.createElement('button');
        history.className = 'qaap-agent-preview-toolbar-history';
        const overflow = document.createElement('button');
        overflow.className = 'qaap-agent-preview-toolbar-overflow';
        // Reproduce embedded mount order: controller created before workbench is under chrome.
        document.body.append(slot, chrome);

        const controller = new QaapPreviewAnnotationController({
            frame,
            frameSlot: slot,
            toolbarHost: workbench,
            commands: {
                getCommand: () => undefined,
                executeCommand: async () => true,
            } as never,
            messageService: { info: () => { /* */ }, warn: () => { /* */ }, error: () => { /* */ } } as never,
            getScope: () => ({
                workspaceId: 'ws',
                threadId: 't1',
                previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
                route: '/home',
                viewportMode: 'mobile',
                viewportWidth: 390,
                viewportHeight: 844,
            }),
            startSelectPicker: () => { /* */ },
            injectBridge: () => { /* */ },
            toDispose,
        });

        expect(chrome.querySelector('.qaap-preview-annotate-toolbar')).to.equal(null);

        chrome.append(history, urlField, workbench, overflow);
        controller.setToolbarHost(workbench);
        controller.startAnnotateMode();

        const bar = chrome.querySelector('.qaap-preview-annotate-toolbar') as HTMLElement;
        expect(bar).to.exist;
        expect(bar.parentElement).to.equal(chrome);
        expect(bar.classList.contains('qaap-mod-visible')).to.equal(true);
        expect(chrome.classList.contains('qaap-mod-annotate-active')).to.equal(true);
        expect(urlField.classList.contains('qaap-mod-annotate-hidden')).to.equal(true);

        controller.setInteractionMode('browse');
        expect(bar.classList.contains('qaap-mod-visible')).to.equal(false);
        expect(chrome.classList.contains('qaap-mod-annotate-active')).to.equal(false);
        expect(urlField.classList.contains('qaap-mod-annotate-hidden')).to.equal(false);
    });

    it('ignores annotate taps while holding compare-to-original', () => {
        const frame = createFrame();
        const slot = document.createElement('div');
        slot.append(frame);
        const chrome = document.createElement('div');
        chrome.className = 'theia-mini-browser-toolbar';
        const urlField = document.createElement('div');
        urlField.className = 'theia-mini-browser-url-field';
        const workbench = document.createElement('div');
        workbench.className = 'theia-mini-browser-workbench-controls';
        chrome.append(urlField, workbench);
        document.body.append(slot, chrome);

        const store = new PreviewAnnotationStore(undefined);
        const controller = new QaapPreviewAnnotationController({
            frame,
            frameSlot: slot,
            toolbarHost: workbench,
            commands: {
                getCommand: () => undefined,
                executeCommand: async () => true,
            } as never,
            messageService: { info: () => { /* */ }, warn: () => { /* */ }, error: () => { /* */ } } as never,
            store,
            getScope: () => ({
                workspaceId: 'ws',
                threadId: 't1',
                previewId: 'http://localhost:3001/',
            previewUrl: 'http://localhost:3001/',
                route: '/home',
                viewportMode: 'mobile',
                viewportWidth: 390,
                viewportHeight: 844,
            }),
            startSelectPicker: () => { /* */ },
            injectBridge: () => { /* */ },
            toDispose,
        });

        controller.setInteractionMode('annotate');
        const bar = chrome.querySelector('.qaap-preview-annotate-toolbar') as HTMLElement;
        const compare = bar.querySelector('.qaap-preview-annotate-toolbar-compare-btn') as HTMLButtonElement;
        dispatchPointer(compare, 'pointerdown', 7);

        controller.onWindowMessage(frameMessage(frame, {
            type: ELEMENT_ANNOTATION_POINT_TYPE,
            payload: {
                clientX: 40,
                clientY: 50,
                documentXRatio: 0.2,
                documentYRatio: 0.3,
                pageUrl: 'http://localhost:3001/home',
                route: '/home',
            },
        }));
        expect(store.listScope({
            workspaceId: 'ws',
            threadId: 't1',
            previewUrl: 'http://localhost:3001/',
            route: '/home',
        })).to.have.length(0);

        dispatchPointer(compare, 'pointerup', 7);
        controller.onWindowMessage(frameMessage(frame, {
            type: ELEMENT_ANNOTATION_POINT_TYPE,
            payload: {
                clientX: 40,
                clientY: 50,
                documentXRatio: 0.2,
                documentYRatio: 0.3,
                pageUrl: 'http://localhost:3001/home',
                route: '/home',
            },
        }));
        expect(store.listScope({
            workspaceId: 'ws',
            threadId: 't1',
            previewUrl: 'http://localhost:3001/',
            route: '/home',
        })).to.have.length(1);
    });
});
