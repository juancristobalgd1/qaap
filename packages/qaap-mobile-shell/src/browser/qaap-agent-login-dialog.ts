// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentAuthLoginChallenge } from '../common/qaap-agent-auth-login';

export interface QaapAgentLoginDialogController {
    readonly root: HTMLElement;
    setChallenge(challenge: QaapAgentAuthLoginChallenge): void;
    setConnected(): void;
    setFailed(message?: string): void;
    dispose(): void;
}

export interface QaapAgentLoginDialogOptions {
    readonly agentLabel: string;
    readonly onClose: () => void;
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

export function createQaapAgentLoginDialog(
    options: QaapAgentLoginDialogOptions,
): QaapAgentLoginDialogController {
    let disposed = false;
    let currentCode: string | undefined;

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
    title.textContent = nls.localize(
        'qaap/mobileProjects/agentLoginDialogTitle',
        'Connect {0}',
        options.agentLabel,
    );
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
    subtitle.textContent = nls.localize(
        'qaap/mobileProjects/agentLoginDialogSubtitle',
        "Use your own subscription for this provider's models.",
    );

    const challengeHost = document.createElement('div');
    challengeHost.className = 'theia-mobile-agent-login-dialog-challenge';
    const waiting = document.createElement('div');
    waiting.className = 'theia-mobile-agent-login-dialog-waiting';
    waiting.append(createIcon('codicon-loading'), document.createTextNode(nls.localize(
        'qaap/mobileProjects/agentLoginDialogPreparing',
        'Preparing secure sign-in…',
    )));
    challengeHost.append(waiting);

    const status = document.createElement('div');
    status.className = 'theia-mobile-agent-login-dialog-status';
    const statusIcon = createIcon('codicon-loading');
    const statusText = document.createElement('span');
    statusText.textContent = nls.localize(
        'qaap/mobileProjects/agentLoginDialogWaiting',
        'Waiting for {0}',
        options.agentLabel,
    );
    status.append(statusIcon, statusText);

    const footer = document.createElement('footer');
    footer.className = 'theia-mobile-agent-login-dialog-footer';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'theia-mobile-agent-login-dialog-cancel';
    cancelButton.textContent = nls.localize('qaap/mobileProjects/agentLoginDialogCancel', 'Cancel');
    footer.append(cancelButton);

    content.append(subtitle, challengeHost, status);
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

    const setChallenge = (challenge: QaapAgentAuthLoginChallenge): void => {
        if (disposed) {
            return;
        }
        const signature = `${challenge.url ?? ''}|${challenge.userCode ?? ''}|${challenge.mode}`;
        if (signature === currentCode) {
            return;
        }
        currentCode = signature;
        challengeHost.replaceChildren();

        const first = createStep(
            '1',
            nls.localize(
                'qaap/mobileProjects/agentLoginDialogStepOne',
                'Open the {0} sign-in flow when prompted.',
                options.agentLabel,
            ),
        );
        challengeHost.append(first.root);

        if (challenge.userCode) {
            const second = createStep(
                '2',
                nls.localize('qaap/mobileProjects/agentLoginDialogStepTwo', 'Copy this code'),
            );
            const codeRow = document.createElement('div');
            codeRow.className = 'theia-mobile-agent-login-dialog-code-row';
            const code = document.createElement('code');
            code.textContent = challenge.userCode;
            const copyButton = document.createElement('button');
            copyButton.type = 'button';
            copyButton.className = 'theia-mobile-agent-login-dialog-copy codicon codicon-copy';
            const copyLabel = nls.localize('qaap/mobileProjects/agentLoginDialogCopy', 'Copy code');
            copyButton.title = copyLabel;
            copyButton.setAttribute('aria-label', copyLabel);
            copyButton.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(challenge.userCode!);
                    copyButton.classList.remove('codicon-copy');
                    copyButton.classList.add('codicon-check');
                    copyButton.title = nls.localize('qaap/mobileProjects/agentLoginDialogCopied', 'Copied');
                    copyButton.setAttribute('aria-label', copyButton.title);
                } catch {
                    // Clipboard access is optional; the code remains selectable.
                }
            });
            codeRow.append(code, copyButton);
            second.body.append(codeRow);
            challengeHost.append(second.root);
        }

        const third = createStep(
            challenge.userCode ? '3' : '2',
            nls.localize(
                'qaap/mobileProjects/agentLoginDialogStepThree',
                'Sign in and finish the verification in the browser.',
            ),
        );
        if (challenge.url) {
            const openButton = document.createElement('button');
            openButton.type = 'button';
            openButton.className = 'theia-mobile-agent-login-dialog-url';
            openButton.append(
                document.createTextNode(nls.localize(
                    'qaap/mobileProjects/agentLoginDialogVerificationPage',
                    'Verification page',
                )),
                createIcon('codicon-link-external'),
            );
            openButton.addEventListener('click', () => {
                window.open(challenge.url, '_blank', 'noopener,noreferrer');
            });
            third.body.append(openButton);
        }
        challengeHost.append(third.root);
    };

    const setConnected = (): void => {
        if (disposed) {
            return;
        }
        status.classList.add('theia-mod-success');
        statusIcon.classList.remove('codicon-loading');
        statusIcon.classList.add('codicon-check');
        statusText.textContent = nls.localize(
            'qaap/mobileProjects/agentLoginDialogConnected',
            '{0} connected',
            options.agentLabel,
        );
        cancelButton.textContent = nls.localize('qaap/mobileProjects/agentLoginDialogDone', 'Done');
    };

    const setFailed = (message?: string): void => {
        if (disposed) {
            return;
        }
        status.classList.add('theia-mod-error');
        statusIcon.classList.remove('codicon-loading');
        statusIcon.classList.add('codicon-error');
        statusText.textContent = message || nls.localize(
            'qaap/mobileProjects/agentLoginDialogFailed',
            'Could not start secure sign-in.',
        );
        cancelButton.textContent = nls.localize('qaap/mobileProjects/agentLoginDialogClose', 'Close');
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

    return { root, setChallenge, setConnected, setFailed, dispose };
}
