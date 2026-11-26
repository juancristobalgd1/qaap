// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';
import { postConversationMessage, type QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { isQaapAgentDrivenPreviewCached } from '@theia/qaap-shared-core/lib/browser/qaap-agent-preview-client';
import { resolveStoredAgentModelForSubmit } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import type { QaapBootstrapStateChange, QaapProjectBootstrapService } from '@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-service';
import {
    buildQaapPreviewFailureReport,
    createQaapPreviewHandoffHistory,
    decideQaapPreviewFailureHandoff,
    recordQaapPreviewFailureHandoff,
    type QaapPreviewFailureState,
} from '../common/qaap-preview-failure-handoff';

/** Returns the conversation a Work Hub panel has open, if any. */
export type QaapOpenConversationResolver = () => QaapAgentConversationSummaryDTO | undefined;

interface BootstrapHandoff {
    readonly resolvers: Set<QaapOpenConversationResolver>;
    readonly subscription: Disposable;
}

/** One hand-off per bootstrap service, shared by every Work Hub panel, so a failure is sent once. */
const handoffs = new WeakMap<QaapProjectBootstrapService, BootstrapHandoff>();
const history = createQaapPreviewHandoffHistory();

function previewFailureState(state: QaapBootstrapStateChange): QaapPreviewFailureState {
    const root = state.descriptor?.previewRootUri ?? state.descriptor?.rootUri;
    return {
        phase: state.phase,
        failureKind: state.failureKind,
        error: state.error,
        previewLogTail: state.previewLogTail,
        previewRunId: state.previewRunId,
        devCommand: state.descriptor?.devCommand,
        projectPath: root?.path.toString(),
    };
}

/** Sends a preview failure report to the conversation's agent (used by the user-pressed "Ask agent to fix" button and legacy auto-handoff). */
export async function sendQaapPreviewFailureToAgent(
    conversation: QaapAgentConversationSummaryDTO,
    state: QaapPreviewFailureState,
    options: { readonly agentDriven?: boolean } = {},
): Promise<void> {
    try {
        const agentModel = resolveStoredAgentModelForSubmit(conversation.agentId, conversation.cwd);
        await postConversationMessage(conversation.id, buildQaapPreviewFailureReport(state, options), { agentModel });
        MobileSnackbar.show(
            nls.localize('qaap/previewHandoff/sent', 'The app did not start. The agent is fixing it.'),
            { kind: 'default', duration: 2600 },
        );
    } catch (error) {
        MobileSnackbar.show(error instanceof Error ? error.message : String(error), { kind: 'warning' });
    }
}

function onStateChange(entry: BootstrapHandoff, state: QaapBootstrapStateChange): void {
    // Phase 3 (decision D5): in agent-driven preview mode, never auto-send a fix turn on failure;
    // the user triggers "Ask agent to fix" explicitly from the failure card/snackbar.
    if (isQaapAgentDrivenPreviewCached()) {
        return;
    }
    if (state.phase !== 'run-failed') {
        return;
    }
    const failure = previewFailureState(state);
    const now = Date.now();
    for (const resolve of entry.resolvers) {
        const conversation = resolve();
        const runKey = decideQaapPreviewFailureHandoff(failure, conversation, history, now);
        if (conversation && runKey) {
            recordQaapPreviewFailureHandoff(history, conversation.id, runKey, now);
            void sendQaapPreviewFailureToAgent(conversation, failure);
            return;
        }
    }
}

/**
 * When the preview of the project a task is open on fails because of the app itself (a compile error, a broken config,
 * a dev command that exits), sends the error to that task's agent so it continues and fixes it, instead of leaving the
 * task stopped on a failed preview. Bounded by {@link decideQaapPreviewFailureHandoff}. Disposing removes the panel.
 */
export function attachQaapPreviewFailureAgentHandoff(
    bootstrap: QaapProjectBootstrapService,
    resolveOpenConversation: QaapOpenConversationResolver,
): Disposable {
    let entry = handoffs.get(bootstrap);
    if (!entry) {
        const resolvers = new Set<QaapOpenConversationResolver>();
        const created: BootstrapHandoff = { resolvers, subscription: Disposable.NULL };
        const subscription = bootstrap.onStateChange(state => onStateChange(created, state));
        entry = { resolvers, subscription };
        handoffs.set(bootstrap, entry);
    }
    const current = entry;
    current.resolvers.add(resolveOpenConversation);
    return Disposable.create(() => {
        current.resolvers.delete(resolveOpenConversation);
        if (current.resolvers.size === 0) {
            current.subscription.dispose();
            handoffs.delete(bootstrap);
        }
    });
}
