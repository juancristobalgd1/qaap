// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * T3-inspired floating toast for agent CLI updates: provider logo + download badge,
 * title/subtitle, Later (dismiss for this version) and Update (install), and an X dismiss control.
 * Only one toast is mounted at a time; `pendingCount` groups the other outdated CLIs into the title.
 */

import { nls } from '@theia/core/lib/common/nls';
import { appendAgentBrandIcon } from '@theia/qaap-shared-core/lib/common/qaap-agent-branding';
import type { QaapAgentCliUpdateInfo } from '../common/qaap-agent-cli-update';

export interface QaapAgentCliUpdateToastHandlers {
    readonly onCancel: () => void;
    readonly onUpdate: () => void;
    readonly onDismiss: () => void;
}

export interface QaapAgentCliUpdateToastOptions {
    /** Outdated CLIs still waiting (including this one). Above 1 the title groups them. */
    readonly pendingCount?: number;
}

export interface QaapAgentCliUpdateToastController {
    readonly root: HTMLElement;
    setUpdating(updating: boolean): void;
    dispose(): void;
}

/** Mount (or replace) the agent-CLI update toast on `document.body`. */
export function showAgentCliUpdateToast(
    info: QaapAgentCliUpdateInfo,
    handlers: QaapAgentCliUpdateToastHandlers,
    options: QaapAgentCliUpdateToastOptions = {},
): QaapAgentCliUpdateToastController {
    document.querySelectorAll('.qaap-agent-cli-update-toast').forEach(node => node.remove());

    const root = document.createElement('div');
    root.className = 'qaap-agent-cli-update-toast';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.dataset.agentId = info.id;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'qaap-agent-cli-update-toast-close';
    close.title = nls.localize('qaap/agentCliUpdate/dismiss', 'Dismiss');
    close.setAttribute('aria-label', close.title);
    const closeIcon = document.createElement('span');
    closeIcon.className = 'codicon codicon-close';
    closeIcon.setAttribute('aria-hidden', 'true');
    close.append(closeIcon);
    close.addEventListener('click', () => handlers.onDismiss());
    root.append(close);

    const body = document.createElement('div');
    body.className = 'qaap-agent-cli-update-toast-body';

    const media = document.createElement('div');
    media.className = 'qaap-agent-cli-update-toast-media';
    const logo = document.createElement('span');
    logo.className = 'qaap-agent-cli-update-toast-logo';
    if (!appendAgentBrandIcon(logo, info.id, 'md')) {
        logo.classList.add('qaap-mod-fallback');
        logo.textContent = info.label.slice(0, 1).toUpperCase();
    }
    media.append(logo);
    const badge = document.createElement('span');
    badge.className = 'qaap-agent-cli-update-toast-badge';
    badge.setAttribute('aria-hidden', 'true');
    const badgeIcon = document.createElement('span');
    badgeIcon.className = 'codicon codicon-desktop-download';
    badge.append(badgeIcon);
    media.append(badge);
    body.append(media);

    const text = document.createElement('div');
    text.className = 'qaap-agent-cli-update-toast-text';
    const title = document.createElement('div');
    title.className = 'qaap-agent-cli-update-toast-title';
    const pendingCount = options.pendingCount ?? 1;
    title.textContent = pendingCount > 1
        ? nls.localize('qaap/agentCliUpdate/titleMany', '{0} CLI updates available', pendingCount)
        : nls.localize(
            'qaap/agentCliUpdate/title',
            'Update Available: {0} v{1}',
            info.label,
            info.latestVersion,
        );
    text.append(title);
    const subtitle = document.createElement('div');
    subtitle.className = 'qaap-agent-cli-update-toast-subtitle';
    subtitle.textContent = pendingCount > 1
        ? nls.localize(
            'qaap/agentCliUpdate/subtitleMany',
            'Starting with {0} v{1}. Later hides these notices for this version.',
            info.label,
            info.latestVersion,
        )
        : nls.localize(
            'qaap/agentCliUpdate/subtitle',
            'Install the update now, or choose Later to hide this notice for this version.',
        );
    text.append(subtitle);
    body.append(text);
    root.append(body);

    const actions = document.createElement('div');
    actions.className = 'qaap-agent-cli-update-toast-actions';

    // Non-destructive dismissal sits apart from the install action (left vs right).
    const laterBtn = document.createElement('button');
    laterBtn.type = 'button';
    laterBtn.className = 'qaap-agent-cli-update-toast-action qaap-mod-later';
    laterBtn.textContent = nls.localize('qaap/agentCliUpdate/later', 'Later');
    laterBtn.addEventListener('click', () => handlers.onCancel());
    actions.append(laterBtn);

    const updateBtn = document.createElement('button');
    updateBtn.type = 'button';
    updateBtn.className = 'qaap-agent-cli-update-toast-action qaap-mod-primary';
    updateBtn.textContent = nls.localize('qaap/agentCliUpdate/update', 'Update');
    updateBtn.addEventListener('click', () => handlers.onUpdate());
    actions.append(updateBtn);
    root.append(actions);

    document.body.append(root);
    // Updates remain available in settings; a passive boot notice must not cover
    // the conversation indefinitely. Keep it while the user is interacting.
    let dismissTimer: number | undefined;
    const clearDismiss = (): void => {
        if (dismissTimer !== undefined) {
            window.clearTimeout(dismissTimer);
            dismissTimer = undefined;
        }
    };
    const scheduleDismiss = (): void => {
        clearDismiss();
        if (!root.classList.contains('qaap-mod-updating') && !root.contains(document.activeElement)) {
            dismissTimer = window.setTimeout(() => handlers.onDismiss(), 8000);
        }
    };
    root.addEventListener('pointerenter', clearDismiss);
    root.addEventListener('pointerleave', scheduleDismiss);
    root.addEventListener('focusin', clearDismiss);
    root.addEventListener('focusout', scheduleDismiss);
    scheduleDismiss();

    // The toast is mounted at body level, while the composer is a separate
    // fixed layer. Track the composer's top edge so the notification never
    // obscures the primary input surface on desktop or when the viewport
    // changes height.
    const updatePosition = (): void => {
        const composer = document.querySelector<HTMLElement>('.theia-mobile-projects-sticky-composer:not([hidden])');
        const composerTop = composer?.getBoundingClientRect().top;
        const lift = composerTop === undefined
            ? 0
            : Math.max(0, window.innerHeight - composerTop + 12);
        root.style.setProperty('--qaap-agent-cli-update-toast-composer-lift', `${Math.round(lift)}px`);
    };
    updatePosition();
    window.addEventListener('resize', updatePosition, { passive: true });
    const composer = document.querySelector<HTMLElement>('.theia-mobile-projects-sticky-composer:not([hidden])');
    const resizeObserver = typeof ResizeObserver === 'undefined' || !composer
        ? undefined
        : new ResizeObserver(updatePosition);
    resizeObserver?.observe(composer!);

    return {
        root,
        setUpdating(updating: boolean): void {
            clearDismiss();
            root.classList.toggle('qaap-mod-updating', updating);
            updateBtn.disabled = updating;
            // Later stays enabled so the user can dismiss even while an update is in flight.
            updateBtn.textContent = updating
                ? nls.localize('qaap/agentCliUpdate/updating', 'Updating…')
                : nls.localize('qaap/agentCliUpdate/update', 'Update');
        },
        dispose(): void {
            clearDismiss();
            resizeObserver?.disconnect();
            window.removeEventListener('resize', updatePosition);
            root.remove();
        },
    };
}
