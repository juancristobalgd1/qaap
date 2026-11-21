// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core';

export type QaapEmptyWelcomeHintId = 'openProject' | 'connectGithub';

export interface QaapEmptyWelcomeHintActions {
    readonly openProject: () => void;
    readonly connectGithub: () => void;
}

/** Hints for the empty chat. "Connect GitHub" only appears while no account is signed in. "Open a project" only appears when no project is open yet. */
export function resolveEmptyWelcomeHintIds(signedIn: boolean, hasOpenProject = false): readonly QaapEmptyWelcomeHintId[] {
    // No "Start a task": the empty composer below already starts a new task.
    const hints: QaapEmptyWelcomeHintId[] = [];
    if (!hasOpenProject) {
        hints.push('openProject');
    }
    if (!signedIn) {
        hints.push('connectGithub');
    }
    return hints;
}

function emptyWelcomeHintLabel(id: QaapEmptyWelcomeHintId): string {
    switch (id) {
        case 'openProject':
            return nls.localize('qaap/welcomeHints/openProject', 'Open a project');
        case 'connectGithub':
            return nls.localize('qaap/welcomeHints/connectGithub', 'Connect GitHub');
    }
}

/** Builds the hint row; each chip runs an existing Work Hub action, nothing new is reloaded. */
export function createQaapEmptyWelcomeHints(signedIn: boolean, actions: QaapEmptyWelcomeHintActions, hasOpenProject = false): HTMLElement | undefined {
    const hintIds = resolveEmptyWelcomeHintIds(signedIn, hasOpenProject);
    if (hintIds.length === 0) {
        return undefined;
    }
    const group = document.createElement('div');
    group.className = 'theia-mobile-agent-transcript-empty-hints';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', nls.localize('qaap/welcomeHints/aria', 'Getting started'));
    for (const id of hintIds) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-mobile-agent-transcript-empty-hint';
        button.setAttribute('data-welcome-hint', id);
        button.textContent = emptyWelcomeHintLabel(id);
        button.addEventListener('click', () => actions[id]());
        group.append(button);
    }
    return group;
}
