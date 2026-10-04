// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentAuthLoginChallenge } from '@theia/qaap-shared-core/lib/common/qaap-agent-auth-login';
import {
    localizeAddApiKeyInSettingsCta,
    localizeAgentSettingsApiKeyLoginMessage,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-auth-login';
import type { QaapAgentLoginFlowState } from '../common/qaap-agent-login-flow';
import { resolveAgentLoginDialogSubtitle } from './qaap-agent-login-instructions';

export interface QaapAgentLoginDialogController {
    readonly root: HTMLElement;
    render(state: QaapAgentLoginFlowState): void;
    dispose(): void;
}

export interface QaapAgentLoginDialogOptions {
    readonly agentId: string;
    readonly agentLabel: string;
    readonly onClose: () => void;
    /** Sends a pasted authorization code to the CLI's stdin. */
    readonly onSubmitCode?: (code: string) => void;
    readonly onRetry?: () => void;
    readonly onInstall?: () => void;
    readonly onOpenSettings?: () => void;
}

function createIcon(className: string): HTMLElement {
    const icon = document.createElement('span');
    icon.className = `codicon ${className}`;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

function createStep(number: string, title: string): { readonly root: HTMLElement; readonly body: HTMLElement } {
    const root = document.createElement('div');
    root.className = 'theia-mobile-agent-login-dialog-step';

    const marker = document.createElement('span');
    marker.className = 'theia-mobile-agent-login-dialog-step-number';
    marker.textContent = number;

    const body = document.createElement('div');
    body.className = 'theia-mobile-agent-login-dialog-step-body';
    const heading = document.createElement('div');
    heading.className = 'theia-mobile-agent-login-dialog-step-title';
    heading.textContent = title;
    body.append(heading);
    root.append(marker, body);
    return { root, body };
}

function createButton(className: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
}

function localizeFailure(state: Extract<QaapAgentLoginFlowState, { phase: 'failed' }>, agentLabel: string): string {
    if (state.message) {
        return state.message;
    }
    switch (state.reason) {
        case 'timeout':
            return nls.localize(
                'qaap/mobileProjects/agentLoginDialogTimedOut',
                '{0} did not show a sign-in link. Its last output is below.',
                agentLabel,
            );
        case 'exited':
            return nls.localize(
                'qaap/mobileProjects/agentLoginDialogExited',
                'The {0} sign-in process ended before it connected (exit code {1}).',
                agentLabel,
                String(state.exitCode ?? ''),
            );
        case 'install-failed':
            return nls.localize(
                'qaap/mobileProjects/agentLoginDialogInstallFailed',
                'Could not install {0}.',
                agentLabel,
            );
        default:
            return nls.localize(
                'qaap/mobileProjects/agentLoginDialogUnavailable',
                'Secure sign-in is not available for this workspace.',
            );
    }
}

export function createQaapAgentLoginDialog(
    options: QaapAgentLoginDialogOptions,
): QaapAgentLoginDialogController {
    let disposed = false;
    let renderedSignature: string | undefined;
    const agentLabel = options.agentLabel;

    const root = document.createElement('div');
    root.className = 'theia-mobile-agent-login-dialog-overlay';

    const panel = document.createElement('section');
    panel.className = 'theia-mobile-agent-login-dialog';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'qaap-agent-login-dialog-title');

    const header = document.createElement('header');
    header.className = 'theia-mobile-agent-login-dialog-header';
    const title = document.createElement('h2');
    title.id = 'qaap-agent-login-dialog-title';
    title.textContent = nls.localize('qaap/mobileProjects/agentLoginDialogTitle', 'Connect {0}', agentLabel);
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'theia-mobile-agent-login-dialog-close codicon codicon-close';
    closeButton.title = nls.localize('qaap/mobileProjects/agentLoginDialogClose', 'Close');
    closeButton.setAttribute('aria-label', closeButton.title);
    header.append(title, closeButton);

    const content = document.createElement('div');
    content.className = 'theia-mobile-agent-login-dialog-content';
    const subtitle = document.createElement('p');
    subtitle.className = 'theia-mobile-agent-login-dialog-subtitle';
    subtitle.textContent = resolveAgentLoginDialogSubtitle(options.agentId);
    const body = document.createElement('div');
    body.className = 'theia-mobile-agent-login-dialog-challenge';

    const status = document.createElement('div');
    status.className = 'theia-mobile-agent-login-dialog-status';
    status.setAttribute('role', 'status');
    const statusIcon = createIcon('codicon-loading');
    const statusText = document.createElement('span');
    status.append(statusIcon, statusText);

    const footer = document.createElement('footer');
    footer.className = 'theia-mobile-agent-login-dialog-footer';
    const actions = document.createElement('div');
    actions.className = 'theia-mobile-agent-login-dialog-actions';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'theia-mobile-agent-login-dialog-cancel';
    footer.append(actions, cancelButton);

    content.append(subtitle, body, status);
    panel.append(header, content, footer);
    root.append(panel);
    document.body.append(root);

    const close = (): void => {
        if (!disposed) {
            options.onClose();
        }
    };
    closeButton.addEventListener('click', close);
    cancelButton.addEventListener('click', close);
    root.addEventListener('click', event => {
        if (event.target === root) {
            close();
        }
    });

    const setStatus = (kind: 'busy' | 'success' | 'error' | 'none', text = ''): void => {
        status.hidden = kind === 'none';
        status.classList.toggle('theia-mod-success', kind === 'success');
        status.classList.toggle('theia-mod-error', kind === 'error');
        statusIcon.className = `codicon ${kind === 'success' ? 'codicon-check' : kind === 'error' ? 'codicon-error' : 'codicon-loading'}`;
        statusText.textContent = text;
    };

    const renderMessage = (text: string): void => {
        const message = document.createElement('p');
        message.className = 'theia-mobile-agent-login-dialog-message';
        message.textContent = text;
        body.append(message);
    };

    const renderChallenge = (challenge: QaapAgentAuthLoginChallenge, submitted: boolean): void => {
        let step = 0;
        const nextStep = (text: string) => createStep(String(++step), text);
        if (challenge.url) {
            const open = nextStep(nls.localize(
                'qaap/mobileProjects/agentLoginDialogStepOpen',
                'Open the {0} sign-in page and approve access.',
                agentLabel,
            ));
            const openButton = document.createElement('button');
            openButton.type = 'button';
            openButton.className = 'theia-mobile-agent-login-dialog-url';
            openButton.append(
                document.createTextNode(nls.localize('qaap/mobileProjects/agentLoginDialogVerificationPage', 'Verification page')),
                createIcon('codicon-link-external'),
            );
            const url = challenge.url;
            openButton.addEventListener('click', () => {
                window.open(url, '_blank', 'noopener,noreferrer');
            });
            open.body.append(openButton);
            body.append(open.root);
        }
        if (challenge.userCode) {
            const copy = nextStep(nls.localize('qaap/mobileProjects/agentLoginDialogStepTwo', 'Copy this code'));
            const codeRow = document.createElement('div');
            codeRow.className = 'theia-mobile-agent-login-dialog-code-row';
            const code = document.createElement('code');
            code.textContent = challenge.userCode;
            const copyButton = document.createElement('button');
            copyButton.type = 'button';
            copyButton.className = 'theia-mobile-agent-login-dialog-copy codicon codicon-copy';
            copyButton.title = nls.localize('qaap/mobileProjects/agentLoginDialogCopy', 'Copy code');
            copyButton.setAttribute('aria-label', copyButton.title);
            const userCode = challenge.userCode;
            copyButton.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(userCode);
                    copyButton.classList.replace('codicon-copy', 'codicon-check');
                    copyButton.title = nls.localize('qaap/mobileProjects/agentLoginDialogCopied', 'Copied');
                    copyButton.setAttribute('aria-label', copyButton.title);
                } catch {
                    // Clipboard access is optional; the code remains selectable.
                }
            });
            codeRow.append(code, copyButton);
            copy.body.append(codeRow);
            body.append(copy.root);
        }
        if (challenge.codeEntry) {
            const paste = nextStep(nls.localize(
                'qaap/mobileProjects/agentLoginDialogStepPaste',
                'Paste the code the sign-in page shows you',
            ));
            const form = document.createElement('form');
            form.className = 'theia-mobile-agent-login-dialog-code-form';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'theia-input theia-mobile-agent-login-dialog-code-input';
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.setAttribute('autocapitalize', 'off');
            input.setAttribute('aria-label', nls.localize('qaap/mobileProjects/agentLoginDialogCodeInput', 'Authorization code'));
            input.placeholder = input.getAttribute('aria-label') ?? '';
            input.disabled = submitted;
            const submit = document.createElement('button');
            submit.type = 'submit';
            submit.className = 'theia-button main theia-mobile-agent-login-dialog-code-submit';
            submit.textContent = nls.localize('qaap/mobileProjects/agentLoginDialogSubmitCode', 'Submit code');
            submit.disabled = submitted;
            form.addEventListener('submit', event => {
                event.preventDefault();
                const value = input.value.trim();
                if (value && options.onSubmitCode) {
                    options.onSubmitCode(value);
                }
            });
            form.append(input, submit);
            paste.body.append(form);
            body.append(paste.root);
        } else {
            body.append(nextStep(nls.localize(
                'qaap/mobileProjects/agentLoginDialogStepThree',
                'Sign in and finish the verification in the browser.',
            )).root);
        }
    };

    const render = (state: QaapAgentLoginFlowState): void => {
        if (disposed) {
            return;
        }
        // Re-rendering an unchanged challenge would wipe a half-typed code.
        const signature = JSON.stringify(state.phase === 'waiting' ? { phase: state.phase } : state);
        if (signature === renderedSignature) {
            return;
        }
        renderedSignature = signature;
        body.replaceChildren();
        actions.replaceChildren();
        cancelButton.textContent = nls.localize('qaap/mobileProjects/agentLoginDialogCancel', 'Cancel');
        switch (state.phase) {
            case 'preparing':
                setStatus('busy', nls.localize('qaap/mobileProjects/agentLoginDialogPreparing', 'Preparing secure sign-in…'));
                break;
            case 'waiting':
                setStatus('busy', nls.localize('qaap/mobileProjects/agentLoginDialogWaiting', 'Waiting for {0}', agentLabel));
                break;
            case 'installing':
                setStatus('busy', nls.localize('qaap/mobileProjects/agentLoginDialogInstalling', 'Installing {0}…', agentLabel));
                break;
            case 'install-required':
                renderMessage(state.message ?? nls.localize(
                    'qaap/mobileProjects/agentLoginDialogNotInstalled',
                    '{0} is not installed on this workspace yet. Install it first, then sign in.',
                    agentLabel,
                ));
                if (state.canInstall && options.onInstall) {
                    actions.append(createButton(
                        'theia-button main theia-mobile-agent-login-dialog-primary',
                        nls.localize('qaap/mobileProjects/agentLoginDialogInstall', 'Install {0}', agentLabel),
                        options.onInstall,
                    ));
                }
                setStatus('none');
                cancelButton.textContent = nls.localize('qaap/mobileProjects/agentLoginDialogClose', 'Close');
                break;
            case 'settings-api-key':
                renderMessage(localizeAgentSettingsApiKeyLoginMessage(agentLabel));
                if (options.onOpenSettings) {
                    actions.append(createButton(
                        'theia-button main theia-mobile-agent-login-dialog-primary',
                        localizeAddApiKeyInSettingsCta(),
                        options.onOpenSettings,
                    ));
                }
                setStatus('none');
                cancelButton.textContent = nls.localize('qaap/mobileProjects/agentLoginDialogClose', 'Close');
                break;
            case 'manual':
                renderMessage(state.message);
                setStatus('none');
                cancelButton.textContent = nls.localize('qaap/mobileProjects/agentLoginDialogClose', 'Close');
                break;
            case 'challenge':
                renderChallenge(state.challenge, false);
                setStatus('busy', nls.localize('qaap/mobileProjects/agentLoginDialogWaiting', 'Waiting for {0}', agentLabel));
                break;
            case 'code-submitted':
                renderChallenge(state.challenge, true);
                setStatus('busy', nls.localize('qaap/mobileProjects/agentLoginDialogVerifyingCode', 'Verifying the code with {0}…', agentLabel));
                break;
            case 'connected':
                setStatus('success', nls.localize('qaap/mobileProjects/agentLoginDialogConnected', '{0} connected', agentLabel));
                cancelButton.textContent = nls.localize('qaap/mobileProjects/agentLoginDialogDone', 'Done');
                break;
            case 'failed': {
                setStatus('error', localizeFailure(state, agentLabel));
                if (state.tail.length) {
                    const tail = document.createElement('pre');
                    tail.className = 'theia-mobile-agent-login-dialog-output';
                    tail.textContent = state.tail.join('\n');
                    body.append(tail);
                }
                if (state.reason === 'install-failed' && options.onInstall) {
                    actions.append(createButton(
                        'theia-button main theia-mobile-agent-login-dialog-primary',
                        nls.localize('qaap/mobileProjects/agentLoginDialogRetry', 'Retry'),
                        options.onInstall,
                    ));
                } else if (options.onRetry) {
                    actions.append(createButton(
                        'theia-button main theia-mobile-agent-login-dialog-primary',
                        nls.localize('qaap/mobileProjects/agentLoginDialogRetry', 'Retry'),
                        options.onRetry,
                    ));
                }
                cancelButton.textContent = nls.localize('qaap/mobileProjects/agentLoginDialogClose', 'Close');
                break;
            }
        }
    };

    const dispose = (): void => {
        if (disposed) {
            return;
        }
        disposed = true;
        closeButton.removeEventListener('click', close);
        cancelButton.removeEventListener('click', close);
        root.remove();
    };

    render({ phase: 'preparing' });
    return { root, render, dispose };
}
