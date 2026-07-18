// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { AnnotationComposerSessionControls } from '@theia/qaap-adapters/lib/browser/qaap-preview-annotation-popover';
import { formatQaiqModelSelectionLabel } from '../common/qaap-qaiq-model-catalog';
import type { QaapCreateAgentTaskQaiqModel } from '../common/qaap-agent-task-client';
import { populateAgentToolbarButton } from './qaap-agent-ui';

export interface AnnotationComposerSessionDeps {
    readonly resolveAgentId: () => string;
    readonly resolveAgentLabel: () => string;
    readonly resolveAgentModel: () => QaapCreateAgentTaskQaiqModel | undefined;
    readonly onOpenAgentSheet: (anchor: HTMLButtonElement, onSelectionApplied: () => void) => void;
    readonly agentLocked?: boolean;
}

/**
 * Compact sticky-composer agent/model chip for the Cursor-style annotation popover footer.
 * Opens the same transcript agent sheet (with model drill-down) used by Work Hub.
 */
export function createAnnotationComposerSessionControls(
    deps: AnnotationComposerSessionDeps,
): AnnotationComposerSessionControls {
    return {
        attach: host => {
            const agentBtn = document.createElement('button');
            agentBtn.type = 'button';
            agentBtn.className = 'theia-mobile-projects-sticky-composer-agent theia-mod-field-agent';
            agentBtn.setAttribute('aria-haspopup', 'dialog');

            const refresh = (): void => {
                const agentId = deps.resolveAgentId();
                const agentLabel = deps.resolveAgentLabel();
                const agentModel = deps.resolveAgentModel();
                const modelLabel = agentModel ? formatQaiqModelSelectionLabel(agentModel) : undefined;
                agentBtn.title = modelLabel
                    ? nls.localize(
                        'qaap/mobileProjects/stickyComposerAgentWithModel',
                        'Agent: {0}, model: {1}',
                        agentLabel,
                        modelLabel,
                    )
                    : nls.localize('qaap/mobileProjects/stickyComposerAgent', 'Agent: {0}', agentLabel);
                agentBtn.setAttribute('aria-label', agentBtn.title);
                populateAgentToolbarButton(agentBtn, {
                    agentId,
                    label: agentLabel,
                    agentModel,
                });
                if (deps.agentLocked) {
                    agentBtn.classList.add('theia-mod-locked');
                    agentBtn.disabled = true;
                } else {
                    agentBtn.classList.remove('theia-mod-locked');
                    agentBtn.disabled = false;
                }
            };

            refresh();
            agentBtn.addEventListener('click', (ev: MouseEvent) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (deps.agentLocked || agentBtn.disabled) {
                    return;
                }
                deps.onOpenAgentSheet(agentBtn, refresh);
            });
            host.replaceChildren(agentBtn);
            return {
                dispose: () => {
                    host.replaceChildren();
                },
            };
        },
    };
}
