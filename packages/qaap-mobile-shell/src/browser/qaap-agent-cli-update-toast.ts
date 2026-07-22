// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * T3-inspired floating toast for agent CLI updates: provider logo + download badge,
 * title/subtitle, Settings (outline) + Update (primary), and an X dismiss control.
 */

import { nls } from '@theia/core/lib/common/nls';
import { appendAgentBrandIcon } from '../common/qaap-agent-branding';
import type { QaapAgentCliUpdateInfo } from '../common/qaap-agent-cli-update';

export interface QaapAgentCliUpdateToastHandlers {
    readonly onSettings: () => void;
    readonly onUpdate: () => void;
    readonly onDismiss: () => void;
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
    title.textContent = nls.localize(
        'qaap/agentCliUpdate/title',
        'Update Available: {0} v{1}',
        info.label,
        info.latestVersion,
    );
    text.append(title);
    const subtitle = document.createElement('div');
    subtitle.className = 'qaap-agent-cli-update-toast-subtitle';
    subtitle.textContent = nls.localize(
        'qaap/agentCliUpdate/subtitle',
        'Install the update now or review provider settings.',
    );
    text.append(subtitle);
    body.append(text);
    root.append(body);

    const actions = document.createElement('div');
    actions.className = 'qaap-agent-cli-update-toast-actions';

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'qaap-agent-cli-update-toast-action';
    settingsBtn.textContent = nls.localize('qaap/agentCliUpdate/settings', 'Settings');
    settingsBtn.addEventListener('click', () => handlers.onSettings());
    actions.append(settingsBtn);

    const updateBtn = document.createElement('button');
    updateBtn.type = 'button';
    updateBtn.className = 'qaap-agent-cli-update-toast-action qaap-mod-primary';
    updateBtn.textContent = nls.localize('qaap/agentCliUpdate/update', 'Update');
    updateBtn.addEventListener('click', () => handlers.onUpdate());
    actions.append(updateBtn);
    root.append(actions);

    document.body.append(root);

    return {
        root,
        setUpdating(updating: boolean): void {
            root.classList.toggle('qaap-mod-updating', updating);
            updateBtn.disabled = updating;
            settingsBtn.disabled = updating;
            updateBtn.textContent = updating
                ? nls.localize('qaap/agentCliUpdate/updating', 'Updating…')
                : nls.localize('qaap/agentCliUpdate/update', 'Update');
        },
        dispose(): void {
            root.remove();
        },
    };
}
