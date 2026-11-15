// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapGithubDeviceSignInDialog, type QaapGithubDeviceSignInApi } from './qaap-github-device-sign-in-dialog';
import type { QaapGithubDevicePollResult, QaapGithubDeviceStart } from '@theia/qaap-adapters/lib/browser/qaap-github-device-client';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

describe('QaapGithubDeviceSignInDialog', () => {
    useSuiteJSDOM();

    const START: QaapGithubDeviceStart = {
        flowId: 'flow-1',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        interval: 5,
        expiresIn: 900,
    };

    function harness(api: Partial<QaapGithubDeviceSignInApi>): {
        dialog: QaapGithubDeviceSignInDialog;
        opened: string[];
        signedIn: number[];
        polls: string[];
        text(): string;
        button(label: string): HTMLButtonElement;
        pollOnce(): Promise<void>;
    } {
        const opened: string[] = [];
        const signedIn: number[] = [];
        const polls: string[] = [];
        const dialog = new QaapGithubDeviceSignInDialog({
            api: {
                start: api.start ?? (async () => START),
                poll: api.poll ?? (async (flowId: string) => { polls.push(flowId); return { status: 'pending', interval: 5 }; }),
            },
            openExternal: url => { opened.push(url); },
            onSignedIn: () => { signedIn.push(1); },
        });
        document.body.append(dialog.node);
        const buttonByLabel = (label: string): HTMLButtonElement => {
            const found = Array.from(dialog.node.querySelectorAll('button')).find(b => b.textContent === label);
            if (!found) {
                throw new Error(`no button "${label}"`);
            }
            return found;
        };
        return {
            dialog,
            opened,
            signedIn,
            polls,
            text: () => dialog.node.textContent ?? '',
            button: buttonByLabel,
            // Runs one poll without waiting for the server interval (the timer is not under test here).
            pollOnce: async () => {
                const generation = (dialog as unknown as { generation: number }).generation;
                await (dialog as unknown as { poll(generation: number): Promise<void> }).poll(generation);
            },
        };
    }

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('shows the user code and opens the verification page, never a device code', async () => {
        const h = harness({});
        await h.dialog.open();
        expect(h.dialog.isOpen).to.equal(true);
        expect(h.text()).to.include('ABCD-1234');
        expect(h.text()).to.include('Waiting for authorization');
        h.button('Open GitHub').click();
        expect(h.opened).to.deep.equal(['https://github.com/login/device']);
        h.dialog.close();
    });

    it('keeps polling with the flow id while GitHub is pending', async () => {
        const h = harness({});
        await h.dialog.open();
        await h.pollOnce();
        expect(h.polls).to.deep.equal(['flow-1']);
        expect(h.signedIn).to.have.length(0);
        h.dialog.close();
    });

    it('closes and reloads once on success', async () => {
        const h = harness({ poll: async () => ({ status: 'complete', user: { login: 'octo', name: 'Octo', avatarUrl: '' } }) });
        await h.dialog.open();
        await h.pollOnce();
        expect(h.dialog.isOpen).to.equal(false);
        expect(h.signedIn).to.deep.equal([1]);
    });

    it('offers a retry when the user denies access', async () => {
        const h = harness({ poll: async (): Promise<QaapGithubDevicePollResult> => ({ status: 'denied' }) });
        await h.dialog.open();
        await h.pollOnce();
        expect(h.dialog.isOpen).to.equal(true);
        expect(h.text()).to.include('GitHub sign-in was cancelled');
        expect(h.button('Try again').hidden).to.equal(false);
        expect(h.signedIn).to.have.length(0);
        h.dialog.close();
    });

    it('reports an expired code', async () => {
        const h = harness({ poll: async (): Promise<QaapGithubDevicePollResult> => ({ status: 'expired' }) });
        await h.dialog.open();
        await h.pollOnce();
        expect(h.text()).to.include('The code expired');
        h.dialog.close();
    });

    it('shows the start error and no code when GitHub is not configured', async () => {
        const h = harness({ start: async () => { throw new Error('GitHub sign-in isn\'t configured: set QAAP_GITHUB_CLIENT_ID'); } });
        await h.dialog.open();
        expect(h.text()).to.include('set QAAP_GITHUB_CLIENT_ID');
        expect(h.text()).to.not.include('Waiting for authorization');
        h.dialog.close();
    });

    it('ignores a poll answer that arrives after cancel', async () => {
        let release: (value: QaapGithubDevicePollResult) => void = () => undefined;
        const h = harness({ poll: () => new Promise<QaapGithubDevicePollResult>(resolve => { release = resolve; }) });
        await h.dialog.open();
        const pending = h.pollOnce();
        h.dialog.close();
        release({ status: 'complete', user: { login: 'octo', name: 'Octo', avatarUrl: '' } });
        await pending;
        expect(h.signedIn).to.have.length(0);
        expect(h.dialog.isOpen).to.equal(false);
    });
});
