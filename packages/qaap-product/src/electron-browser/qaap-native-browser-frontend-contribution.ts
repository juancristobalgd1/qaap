// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import {
    QaapNativeBrowserService,
    type QaapNativeBrowserBounds,
    type QaapNativeBrowserClient,
    type QaapNativeBrowserStateEvent,
} from '@theia/qaap-adapters/lib/common/qaap-native-browser-protocol';
import {
    registerQaapNativeBrowserBridge,
    type QaapNativeBrowserBridge,
} from '@theia/qaap-adapters/lib/browser/qaap-native-browser-bridge';

/**
 * Dispatcher receiving `QaapNativeBrowserStateEvent` callbacks from Electron main and fanning them
 * out to the subscribed embedded preview chrome instances in this renderer window.
 */
@injectable()
export class QaapNativeBrowserClientDispatcher implements QaapNativeBrowserClient {

    protected readonly listeners = new Map<string, Set<(event: QaapNativeBrowserStateEvent) => void>>();

    onStateChanged(event: QaapNativeBrowserStateEvent): void {
        const set = this.listeners.get(event.viewId);
        if (!set) {
            return;
        }
        for (const listener of [...set]) {
            try {
                listener(event);
            } catch {
                // Keep delivering to remaining listeners.
            }
        }
    }

    subscribe(viewId: string, listener: (event: QaapNativeBrowserStateEvent) => void): Disposable {
        let set = this.listeners.get(viewId);
        if (!set) {
            set = new Set();
            this.listeners.set(viewId, set);
        }
        set.add(listener);
        return {
            dispose: () => {
                set?.delete(listener);
                if (set && set.size === 0) {
                    this.listeners.delete(viewId);
                }
            },
        };
    }
}

/**
 * Registers the Electron native `WebContentsView` browser bridge for this Desktop renderer window.
 * Loaded only in Electron (`frontendElectron` module), never in web/mobile builds.
 */
@injectable()
export class QaapNativeBrowserFrontendContribution implements FrontendApplicationContribution {

    @inject(QaapNativeBrowserService)
    protected readonly service: QaapNativeBrowserService;

    @inject(QaapNativeBrowserClientDispatcher)
    protected readonly dispatcher: QaapNativeBrowserClientDispatcher;

    protected readonly disposables = new DisposableCollection();

    protected resolveOwnerWebContentsId(): number | undefined {
        const meta = (window as unknown as { electronTheiaCore?: { WindowMetadata?: { webcontentId?: string | number } } })
            .electronTheiaCore?.WindowMetadata?.webcontentId;
        if (meta === undefined || meta === null) {
            return undefined;
        }
        const parsed = Number(meta);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    }

    @postConstruct()
    protected init(): void {
        const ownerWebContentsId = this.resolveOwnerWebContentsId();
        const shellOrigin = typeof window !== 'undefined' ? window.location.origin : undefined;

        const bridge: QaapNativeBrowserBridge = {
            ensureView: (viewId: string, url?: string) => this.service.ensureView({
                viewId,
                ownerWebContentsId,
                url,
                shellOrigin,
            }),
            navigate: (viewId: string, url: string, options?: { readonly hard?: boolean }) =>
                this.service.navigate(viewId, url, options),
            setBounds: (viewId: string, bounds: QaapNativeBrowserBounds, visible: boolean) =>
                this.service.setBounds(viewId, bounds, visible),
            goBack: (viewId: string) => this.service.goBack(viewId),
            goForward: (viewId: string) => this.service.goForward(viewId),
            reload: (viewId: string, hard?: boolean) => this.service.reload(viewId, hard),
            focus: (viewId: string) => this.service.focus(viewId),
            openDevTools: (viewId: string) => this.service.openDevTools(viewId),
            destroyView: (viewId: string) => this.service.destroyView(viewId),
            subscribe: (viewId: string, listener: (event: QaapNativeBrowserStateEvent) => void) =>
                this.dispatcher.subscribe(viewId, listener),
        };

        this.disposables.push(registerQaapNativeBrowserBridge(bridge));

        const onBeforeUnload = (): void => {
            void this.service.destroyAllForOwner(ownerWebContentsId);
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        this.disposables.push({ dispose: () => window.removeEventListener('beforeunload', onBeforeUnload) });
    }

    onStop(): void {
        void this.service.destroyAllForOwner(this.resolveOwnerWebContentsId());
        this.disposables.dispose();
    }
}
