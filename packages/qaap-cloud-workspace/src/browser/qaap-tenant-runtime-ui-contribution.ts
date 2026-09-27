// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { nls } from '@theia/core/lib/common/nls';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import {
    fetchQaapTenantRuntimeStatus,
    touchQaapTenantRuntime,
} from './qaap-cloud-workspace-client';

const ACTIVITY_THROTTLE_MS = 20_000;
const STATUS_POLL_MS = 15_000;

/** Browser-side activity signals and lightweight runtime-state feedback. */
@injectable()
export class QaapTenantRuntimeUiContribution implements FrontendApplicationContribution {

    @inject(WorkspaceService)
    protected readonly workspace: WorkspaceService;

    @inject(MessageService)
    protected readonly messages: MessageService;

    protected activityHandler: (() => void) | undefined;
    protected visibilityHandler: (() => void) | undefined;
    protected statusTimer: number | undefined;
    protected lastActivityAt = 0;
    protected lastState: string | undefined;

    onStart(): void {
        this.activityHandler = () => this.touch('user');
        this.visibilityHandler = () => {
            if (document.visibilityState === 'visible') {
                this.touch('user');
            }
        };
        for (const event of ['keydown', 'pointerdown', 'touchstart', 'wheel']) {
            window.addEventListener(event, this.activityHandler, { passive: true });
        }
        document.addEventListener('visibilitychange', this.visibilityHandler);
        this.workspace.onWorkspaceLocationChanged(() => {
            this.lastActivityAt = 0;
            this.touch('workspace');
            void this.refreshStatus();
        });
        void this.workspace.ready.then(() => {
            this.touch('workspace');
            void this.refreshStatus();
        });
        this.statusTimer = window.setInterval(() => { void this.refreshStatus(); }, STATUS_POLL_MS);
    }

    onStop(): void {
        if (this.activityHandler) {
            for (const event of ['keydown', 'pointerdown', 'touchstart', 'wheel']) {
                window.removeEventListener(event, this.activityHandler);
            }
        }
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
        }
        if (this.statusTimer !== undefined) {
            window.clearInterval(this.statusTimer);
        }
    }

    protected touch(reason: 'user' | 'workspace'): void {
        const now = Date.now();
        if (now - this.lastActivityAt < ACTIVITY_THROTTLE_MS) {
            return;
        }
        this.lastActivityAt = now;
        void touchQaapTenantRuntime(reason);
    }

    protected async refreshStatus(): Promise<void> {
        const status = await fetchQaapTenantRuntimeStatus();
        if (!status || status.state === this.lastState) {
            return;
        }
        const previous = this.lastState;
        this.lastState = status.state;
        if (status.state === 'starting' && previous !== 'starting') {
            this.messages.info(nls.localize(
                'qaap/tenantRuntime/starting',
                'Waking your workspace…',
            ));
        } else if (status.state === 'stopped' && previous !== 'stopped') {
            this.messages.info(nls.localize(
                'qaap/tenantRuntime/stopped',
                'Your workspace is sleeping to save resources. It will wake automatically when needed.',
            ));
        } else if (status.state === 'error' && previous !== 'error') {
            this.messages.warn(nls.localize(
                'qaap/tenantRuntime/error',
                'The workspace runtime needs attention before it can be used.',
            ));
        }
    }
}
