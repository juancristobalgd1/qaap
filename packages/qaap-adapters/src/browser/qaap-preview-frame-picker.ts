// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { generateUuid } from '@theia/core/lib/common/uuid';
import { nls } from '@theia/core/lib/common/nls';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ElementInspectorService } from '@theia/qaap-element-inspector/lib/browser/element-inspector-service';
import {
    ELEMENT_PICKER_CANCEL_TYPE,
    ELEMENT_PICKER_MESSAGE_TYPE,
    ELEMENT_PICKER_START_TYPE,
    ELEMENT_REFRESH_RESPONSE_TYPE,
    ELEMENT_SET_MODE_TYPE,
    PickedElement,
    type PreviewInteractionMode,
} from '@theia/qaap-element-inspector/lib/browser/element-inspector-types';
import { buildElementBridgeScript, buildElementPickerScript } from '@theia/qaap-element-inspector/lib/browser/element-picker-script';
import {
    ELEMENT_INSPECTOR_REVEAL_COMMAND_ID,
} from '@theia/qaap-element-inspector/lib/browser/element-inspector-contribution';
import type { QaapPreviewInlineInspector } from './qaap-preview-inline-inspector';
import { QaapPreviewAnnotationController } from './qaap-preview-annotation-controller';
import type { AnnotationComposerSessionControls } from './qaap-preview-annotation-popover';
import type { PreviewAnnotationScope } from './qaap-preview-annotation-types';
import {
    QAAP_PREVIEW_BRIDGE_INIT_TYPE,
    QAAP_PREVIEW_BRIDGE_READY_TYPE,
} from '../common/qaap-preview-bridge-protocol';

/** DOM picker + inspector bridge for a single preview iframe (mini-browser or embedded). */
@injectable()
export class QaapPreviewFramePickerFactory {

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    @inject(ClipboardService)
    protected readonly clipboard: ClipboardService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    @inject(ElementInspectorService)
    protected readonly inspectorService: ElementInspectorService;

    create(frame: HTMLIFrameElement, toDispose: DisposableCollection): QaapPreviewFramePicker {
        return new QaapPreviewFramePicker(
            frame,
            this.commands,
            this.clipboard,
            this.messageService,
            this.inspectorService,
            toDispose,
        );
    }
}

export class QaapPreviewFramePicker {

    protected pickerListenerInstalled = false;
    protected inlineInspector: QaapPreviewInlineInspector | undefined;
    protected annotationController: QaapPreviewAnnotationController | undefined;
    protected annotationScopeProvider: (() => PreviewAnnotationScope | undefined) | undefined;
    protected notifyHandler: ((message: string, kind?: 'info' | 'warn') => void) | undefined;
    protected composerSession: AnnotationComposerSessionControls | undefined;
    protected readonly bridgeChannelId = generateUuid();

    constructor(
        protected readonly frame: HTMLIFrameElement,
        protected readonly commands: CommandRegistry,
        protected readonly clipboard: ClipboardService,
        protected readonly messageService: MessageService,
        protected readonly inspectorService: ElementInspectorService,
        protected readonly toDispose: DisposableCollection,
    ) {
        this.installPickerListener();
        toDispose.push(Disposable.create(() => {
            this.pickerListenerInstalled = false;
            this.annotationController = undefined;
        }));
    }

    connectInlineInspector(inspector: QaapPreviewInlineInspector): void {
        this.inlineInspector = inspector;
    }

    setAnnotationScopeProvider(provider: () => PreviewAnnotationScope | undefined): void {
        this.annotationScopeProvider = provider;
    }

    /** Work Hub–visible toast hook (MobileSnackbar); forwarded to the annotation controller. */
    setNotify(notify: ((message: string, kind?: 'info' | 'warn') => void) | undefined): void {
        this.notifyHandler = notify;
        this.annotationController?.setNotify(notify);
    }

    /** Wire Work Hub agent/model session controls into the annotation popover footer. */
    setComposerSession(session: AnnotationComposerSessionControls | undefined): void {
        this.composerSession = session;
        this.annotationController?.setComposerSession(session);
    }

    /**
     * Lazily mounts annotate markers/toolbar over the preview frame slot.
     * Safe to call multiple times; later calls can supply a toolbar host if the first
     * construction happened before the workbench was parented under chrome.
     */
    ensureAnnotationController(frameSlot: HTMLElement, toolbarHost?: HTMLElement): QaapPreviewAnnotationController {
        if (this.annotationController) {
            if (toolbarHost) {
                this.annotationController.setToolbarHost(toolbarHost);
            }
            this.annotationController.setNotify(this.notifyHandler);
            this.annotationController.setComposerSession(this.composerSession);
            return this.annotationController;
        }
        this.annotationController = new QaapPreviewAnnotationController({
            frame: this.frame,
            frameSlot,
            toolbarHost,
            commands: this.commands,
            messageService: this.messageService,
            notify: (message, kind) => this.notifyHandler?.(message, kind),
            getScope: () => this.annotationScopeProvider?.() ?? this.defaultAnnotationScope(),
            startSelectPicker: () => this.startElementPicker(),
            injectBridge: () => this.injectInspectorBridge(),
            postBridgeMessage: message => this.postBridgeMessage(message),
            isBridgeMessage: event => this.isTrustedBridgeMessage(event),
            toDispose: this.toDispose,
            composerSession: this.composerSession,
        });
        return this.annotationController;
    }

    startAnnotateMode(): void {
        const slot = this.frame.parentElement;
        if (!slot) {
            this.messageService.warn(nls.localize(
                'qaap/preview/annotateUnavailable',
                'Annotate mode needs a same-origin preview frame.',
            ));
            return;
        }
        const toolbar = this.frame.closest('.theia-mini-browser, .qaap-agent-preview-embedded')
            ?.querySelector<HTMLElement>('.theia-mini-browser-workbench-controls');
        const controller = this.ensureAnnotationController(slot, toolbar ?? undefined);
        if (toolbar) {
            controller.setToolbarHost(toolbar);
        }
        controller.startAnnotateMode();
    }

    getInteractionMode(): PreviewInteractionMode {
        return this.annotationController?.getInteractionMode() ?? 'browse';
    }

    bindInspectorWindow(): void {
        try {
            const win = this.frame.contentWindow;
            const origin = this.previewOrigin();
            if (win && origin) {
                this.inspectorService.bind(win, origin, this.bridgeChannelId);
            }
        } catch {
            /* cross-origin */
        }
    }

    injectInspectorBridge(): void {
        try {
            const doc = this.frame.contentDocument;
            const parentOrigin = this.parentOrigin();
            if (!doc || !parentOrigin) {
                return;
            }
            const script = doc.createElement('script');
            script.textContent = buildElementBridgeScript({
                channelId: this.bridgeChannelId,
                parentOrigin,
            });
            doc.documentElement.appendChild(script);
            script.remove();
        } catch {
            /* cross-origin */
        }
    }

    onFrameLoad(): void {
        this.injectInspectorBridge();
        this.initializeRemoteBridge();
        this.bindInspectorWindow();
        this.annotationController?.onFrameLoad();
    }

    startElementPicker(): void {
        this.installPickerListener();
        try {
            const win = this.frame.contentWindow;
            if (!win) {
                this.notifyPickerUnavailable();
                return;
            }
            this.injectInspectorBridge();
            // Keep Select as the one-shot picker; only notify the resident bridge of the mode.
            try {
                this.postBridgeMessage({ type: ELEMENT_SET_MODE_TYPE, mode: 'select' });
            } catch {
                /* ignore */
            }
            this.annotationController?.noteSelectModeActivated();
            if (!this.postBridgeMessage({ type: ELEMENT_PICKER_START_TYPE, script: buildElementPickerScript() })) {
                this.notifyPickerUnavailable();
                return;
            }
            this.messageService.info(nls.localize(
                'qaap/preview/pickerActive',
                'Element picker active — click an element in the preview.',
            ));
        } catch {
            this.notifyPickerUnavailable();
        }
    }

    async openElementInspector(): Promise<void> {
        this.bindInspectorWindow();
        if (this.inlineInspector) {
            this.inlineInspector.toggle();
            return;
        }
        const revealId = ELEMENT_INSPECTOR_REVEAL_COMMAND_ID;
        if (this.commands.getCommand(revealId)) {
            try {
                await this.commands.executeCommand(revealId);
                return;
            } catch {
                /* unavailable */
            }
        }
        this.messageService.warn(nls.localize(
            'qaap/preview/inspectorUnavailable',
            'Element Inspector is not available. Open a same-origin preview and try again.',
        ));
    }

    /** @deprecated Use {@link openElementInspector} — kept for callers that still say toggle. */
    async toggleElementInspector(): Promise<void> {
        return this.openElementInspector();
    }

    protected notifyPickerUnavailable(): void {
        this.messageService.warn(nls.localize(
            'theia/mini-browser/pickerUnavailable',
            'The element picker bridge is not available for this preview. Reload it and try again.',
        ));
    }

    protected installPickerListener(): void {
        if (this.pickerListenerInstalled) {
            return;
        }
        this.pickerListenerInstalled = true;
        const handler = (event: MessageEvent): void => {
            if (!event.data || typeof event.data !== 'object') {
                return;
            }
            if (!this.isExpectedFrameMessage(event)) {
                return;
            }
            const data = event.data as { type?: string; channelId?: string; payload?: PickedElement };
            if (data.type === QAAP_PREVIEW_BRIDGE_READY_TYPE) {
                this.initializeRemoteBridge();
                return;
            }
            if (data.channelId !== this.bridgeChannelId) {
                return;
            }
            if (data.type === ELEMENT_PICKER_MESSAGE_TYPE && data.payload) {
                void this.handlePickedElement(data.payload);
            } else if (data.type === ELEMENT_REFRESH_RESPONSE_TYPE && data.payload) {
                this.inspectorService.refreshed(data.payload);
            } else if (data.type === ELEMENT_PICKER_CANCEL_TYPE) {
                // in-frame script cleans up
            }
        };
        window.addEventListener('message', handler);
        this.toDispose.push(Disposable.create(() => window.removeEventListener('message', handler)));
    }

    protected async handlePickedElement(element: PickedElement): Promise<void> {
        this.bindInspectorWindow();
        this.inspectorService.pick(element);
        const summary = this.formatElementForChat(element);
        try {
            await this.clipboard.writeText(summary);
        } catch {
            /* clipboard denied */
        }
        await this.openInlineInspector();
        this.messageService.info(nls.localize(
            'theia/mini-browser/elementCaptured',
            'Captured {0}. Details opened in the Element Inspector and copied to the clipboard.',
            element.tagName + (element.id ? '#' + element.id : '') + (element.classes.length ? '.' + element.classes.slice(0, 2).join('.') : ''),
        ));
    }

    protected async openInlineInspector(): Promise<void> {
        if (this.inlineInspector) {
            this.inlineInspector.open();
            return;
        }
        await this.revealInspector();
    }

    protected async revealInspector(): Promise<void> {
        if (!this.commands.getCommand(ELEMENT_INSPECTOR_REVEAL_COMMAND_ID)) {
            return;
        }
        try {
            await this.commands.executeCommand(ELEMENT_INSPECTOR_REVEAL_COMMAND_ID);
        } catch {
            /* ignore */
        }
    }

    protected formatElementForChat(element: PickedElement): string {
        const lines: string[] = [];
        lines.push('Selected DOM element from preview ' + element.pageUrl);
        lines.push('DOM Path: ' + element.domPath);
        const { top, left, width, height } = element.position;
        lines.push(`Position: top=${top}px, left=${left}px, width=${width}px, height=${height}px`);
        lines.push('HTML Element: ' + element.outerHTML);
        if (element.textPreview) {
            lines.push('Text: ' + element.textPreview);
        }
        return lines.join('\n');
    }

    protected defaultAnnotationScope(): PreviewAnnotationScope | undefined {
        const previewUrl = this.frame.src || '';
        if (!previewUrl) {
            return undefined;
        }
        let route = '/';
        try {
            route = new URL(previewUrl, window.location.href).pathname || '/';
        } catch {
            route = '/';
        }
        const narrow = typeof matchMedia === 'function'
            && matchMedia('(max-width: 767px), (pointer: coarse)').matches;
        return {
            previewId: previewUrl,
            workspaceId: 'workspace',
            threadId: 'default',
            previewUrl,
            route,
            viewportMode: narrow ? 'mobile' : 'desktop',
            viewportWidth: this.frame.clientWidth || window.innerWidth,
            viewportHeight: this.frame.clientHeight || window.innerHeight,
        };
    }

    protected parentOrigin(): string | undefined {
        return typeof window !== 'undefined' && window.location?.origin ? window.location.origin : undefined;
    }

    protected previewOrigin(): string | undefined {
        const raw = this.frame.src;
        if (!raw || raw === 'about:blank') {
            return this.parentOrigin();
        }
        try {
            const origin = new URL(raw, window.location.href).origin;
            return origin === 'null' ? undefined : origin;
        } catch {
            return undefined;
        }
    }

    protected isExpectedFrameMessage(event: Pick<MessageEvent, 'source' | 'origin'>): boolean {
        const expectedOrigin = this.previewOrigin();
        return !!this.frame.contentWindow
            && event.source === this.frame.contentWindow
            && !!expectedOrigin
            && event.origin === expectedOrigin;
    }

    protected isTrustedBridgeMessage(event: Pick<MessageEvent, 'data' | 'source' | 'origin'>): boolean {
        if (!this.isExpectedFrameMessage(event) || !event.data || typeof event.data !== 'object') {
            return false;
        }
        return (event.data as { channelId?: unknown }).channelId === this.bridgeChannelId;
    }

    protected postBridgeMessage(message: Record<string, unknown>): boolean {
        const target = this.frame.contentWindow;
        const origin = this.previewOrigin();
        if (!target || !origin) {
            return false;
        }
        target.postMessage({ ...message, channelId: this.bridgeChannelId }, origin);
        return true;
    }

    protected initializeRemoteBridge(): void {
        const target = this.frame.contentWindow;
        const previewOrigin = this.previewOrigin();
        const parentOrigin = this.parentOrigin();
        if (!target || !previewOrigin || !parentOrigin) {
            return;
        }
        target.postMessage({
            type: QAAP_PREVIEW_BRIDGE_INIT_TYPE,
            channelId: this.bridgeChannelId,
            script: buildElementBridgeScript({ channelId: this.bridgeChannelId, parentOrigin }),
        }, previewOrigin);
    }
}
