// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MOBILE_ONE_COLUMN_LAYOUT_CLASS } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { QaapMiniBrowserOpenHandler } from '@theia/qaap-adapters/lib/browser/qaap-mini-browser-open-handler';
import { QAAP_AGENT_TASK_API_PATH } from '../common/qaap-agent-task';

interface BrowserPreviewMessage {
    readonly type?: string;
    readonly browserUrls?: readonly { readonly taskId: string; readonly url: string }[];
    readonly taskId?: string;
    readonly url?: string;
}

@injectable()
export class QaapAgentBrowserPreviewContribution implements FrontendApplicationContribution {

    @inject(QaapMiniBrowserOpenHandler)
    protected readonly miniBrowser: QaapMiniBrowserOpenHandler;

    protected socket: WebSocket | undefined;
    protected reconnectTimer: number | undefined;
    protected modeObserver: MutationObserver | undefined;
    protected latest: { taskId: string; url: string } | undefined;
    protected readonly shown = new Map<string, string>();

    onStart(): void {
        this.connect();
        const shell = document.getElementById('theia-app-shell');
        if (shell) {
            this.modeObserver = new MutationObserver(() => this.showLatest());
            this.modeObserver.observe(shell, { attributes: true, attributeFilter: ['class'] });
        }
    }

    onStop(): void {
        this.modeObserver?.disconnect();
        this.socket?.close();
        if (this.reconnectTimer !== undefined) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }

    protected connect(): void {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}${QAAP_AGENT_TASK_API_PATH}/browser-preview/ws`;
        const socket = new WebSocket(url);
        this.socket = socket;
        socket.addEventListener('message', event => this.handleMessage(event.data));
        socket.addEventListener('close', () => {
            if (this.socket === socket) {
                this.socket = undefined;
                this.reconnectTimer = window.setTimeout(() => this.connect(), 1500);
            }
        });
        socket.addEventListener('error', () => socket.close());
    }

    protected handleMessage(raw: unknown): void {
        let message: BrowserPreviewMessage;
        try {
            message = JSON.parse(String(raw)) as BrowserPreviewMessage;
        } catch {
            return;
        }
        if (message.type === 'browser-preview-snapshot') {
            for (const item of message.browserUrls ?? []) {
                this.receive(item.taskId, item.url);
            }
        } else if (message.type === 'browser-url') {
            this.receive(message.taskId ?? '', message.url ?? '');
        }
    }

    protected receive(taskId: string, url: string): void {
        if (!taskId || !isHttpUrl(url)) {
            return;
        }
        this.latest = { taskId, url };
        this.showLatest();
    }

    protected showLatest(): void {
        const current = this.latest;
        if (!current) {
            return;
        }
        const mode = document.getElementById('theia-app-shell')?.classList.contains(MOBILE_ONE_COLUMN_LAYOUT_CLASS)
            ? 'work-hub' : 'ide';
        if (this.shown.get(mode) === `${current.taskId}\n${current.url}`) {
            return;
        }
        this.shown.set(mode, `${current.taskId}\n${current.url}`);
        void this.miniBrowser.openAgentBrowserPreview(current.url, current.taskId, mode).catch(error => {
            console.warn('[qaap-browser-preview] could not open the agent browser URL', error);
        });
    }
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
    } catch {
        return false;
    }
}
