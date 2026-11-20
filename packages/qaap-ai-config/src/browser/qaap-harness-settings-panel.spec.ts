// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM, enableReactActEnvironment } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();
const disableImportReactAct = enableReactActEnvironment();

import { expect } from 'chai';
import * as React from '@theia/core/shared/react';
import { createRoot, type Root } from '@theia/core/shared/react-dom/client';
import {
    QAAP_AGENT_SIGNED_OUT_EVENT,
    QAAP_HARNESS_SIGN_OUT_ROUTE,
    type QaapAgentSignedOutDetail,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-sign-out';
import {
    fetchAgentModelsForAgent,
    fetchAgentTaskListAll,
    invalidateAgentModelsCache,
    invalidateAgentTaskListAllCache,
    QAAP_AGENT_TASK_API_PATH,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import {
    buildHarnessSignOutConfirmCopy,
    canSignOutHarnessRow,
    QaapHarnessSettingsPanel,
    type HarnessSignOutConfirmCopy,
} from './qaap-harness-settings-panel';
import { QaapHarnessConfigurationWidget } from './qaap-harness-configuration-widget';
import type { HarnessSettingsRow } from './qaap-harness-configuration-state';

disableImportReactAct();
disableImportJSDOM();

const act = React.act;

class TestHarnessConfigurationWidget extends QaapHarnessConfigurationWidget {
    public confirmResult = true;
    public readonly confirmedCopies: HarnessSignOutConfirmCopy[] = [];
    public availabilityLoads = 0;

    protected override async confirmSignOut(copy: HarnessSignOutConfirmCopy): Promise<boolean> {
        this.confirmedCopies.push(copy);
        return this.confirmResult;
    }

    protected override async loadAvailability(): Promise<void> {
        this.availabilityLoads++;
    }

    public triggerSignOut(row: HarnessSettingsRow, removesAllProviders: boolean): Promise<void> {
        return this.signOutHarness(row, removesAllProviders);
    }
}

describe('QaapHarnessSettingsPanel sign-out', () => {
    let disableJSDOM: (() => void) | undefined;
    let disableReactAct: (() => void) | undefined;
    let host: HTMLDivElement | undefined;
    let root: Root | undefined;
    let originalFetch: typeof globalThis.fetch | undefined;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
        disableReactAct = enableReactActEnvironment();
        originalFetch = globalThis.fetch;
        invalidateAgentTaskListAllCache();
        invalidateAgentModelsCache();
    });

    afterEach(() => {
        if (root) {
            act(() => {
                root?.unmount();
            });
            root = undefined;
        }
        host?.remove();
        host = undefined;
        if (originalFetch !== undefined) {
            globalThis.fetch = originalFetch;
        }
        invalidateAgentTaskListAllCache();
        invalidateAgentModelsCache();
        disableReactAct?.();
        disableReactAct = undefined;
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    describe('canSignOutHarnessRow', () => {
        it('shows Sign out only when connected and supported by the harness declaration', () => {
            for (const id of ['codex', 'claude', 'opencode', 'pi', 'cursor', 'copilot', 'grok']) {
                expect(canSignOutHarnessRow({ baseId: id, isInstance: false }, 'connected'), id).to.equal(true);
            }
            // Disconnected / unknown / missing states stay hidden.
            expect(canSignOutHarnessRow({ baseId: 'codex', isInstance: false }, 'disconnected')).to.equal(false);
            expect(canSignOutHarnessRow({ baseId: 'codex', isInstance: false }, 'unknown')).to.equal(false);
            expect(canSignOutHarnessRow({ baseId: 'codex', isInstance: false }, undefined)).to.equal(false);
            // Antigravity declares signOut.kind === 'none' (fail-closed even when connected).
            expect(canSignOutHarnessRow({ baseId: 'antigravity', isInstance: false }, 'connected')).to.equal(false);
            // Extra instances do not sign out base credentials.
            expect(canSignOutHarnessRow({ baseId: 'codex', isInstance: true }, 'connected')).to.equal(false);
            // Unknown harness id fails closed.
            expect(canSignOutHarnessRow({ baseId: 'unknown-harness', isInstance: false }, 'connected')).to.equal(false);
        });
    });

    describe('buildHarnessSignOutConfirmCopy', () => {
        it('uses the standard Pro-models confirmation copy for single-provider harnesses', () => {
            const copy = buildHarnessSignOutConfirmCopy('Codex', false);
            expect(copy.msg).to.equal('Sign out of Codex? You will need to sign in again to use its Pro models.');
            expect(copy.ok).to.equal('Sign out');
        });

        it('explicitly warns that all saved providers are removed for opencode and pi', () => {
            const opencodeCopy = buildHarnessSignOutConfirmCopy('OpenCode', true);
            expect(opencodeCopy.msg).to.include('OpenCode');
            expect(opencodeCopy.msg).to.include('all providers');
            expect(opencodeCopy.msg).to.include('Pro models');

            const piCopy = buildHarnessSignOutConfirmCopy('Pi', true);
            expect(piCopy.msg).to.include('Pi');
            expect(piCopy.msg).to.include('all providers');
        });
    });

    describe('rendered panel visibility', () => {
        function renderPanel(options: { onSignOut?: () => Promise<void>; signOutRemovesAllProviders?: boolean }): HTMLDivElement {
            host = document.createElement('div');
            document.body.appendChild(host);
            root = createRoot(host);
            act(() => {
                root!.render(React.createElement(QaapHarnessSettingsPanel, {
                    harnessId: 'codex',
                    defaultLabel: 'Codex',
                    defaultBin: 'codex',
                    homeEnvVar: 'CODEX_HOME',
                    settings: {},
                    launchOverridesSupported: false,
                    isInstance: false,
                    checkPaths: async () => ({}),
                    onSave: async () => undefined,
                    onReset: async () => undefined,
                    onSignOut: options.onSignOut,
                    signOutRemovesAllProviders: options.signOutRemovesAllProviders,
                }));
            });
            return host;
        }

        it('hides the Sign out button when onSignOut is omitted (disconnected or unsupported)', () => {
            const container = renderPanel({});
            expect(container.querySelector('.qaap-harness-settings-sign-out')).to.equal(null);
        });

        it('renders and invokes the Sign out button when onSignOut is provided', async () => {
            let clicked = 0;
            const container = renderPanel({ onSignOut: async () => { clicked++; } });
            const button = container.querySelector<HTMLButtonElement>('.qaap-harness-settings-sign-out');
            expect(button).to.not.equal(null);
            expect(button!.textContent).to.equal('Sign out');
            await act(async () => {
                button!.click();
            });
            expect(clicked).to.equal(1);
        });
    });

    describe('QaapHarnessConfigurationWidget.signOutHarness', () => {
        const opencodeRow: HarnessSettingsRow = {
            id: 'opencode',
            baseId: 'opencode',
            label: 'OpenCode',
            baseLabel: 'OpenCode',
            bin: 'opencode',
            isInstance: false,
        };

        it('does nothing when the user cancels the confirmation dialog', async () => {
            let fetchCalls = 0;
            globalThis.fetch = (async () => {
                fetchCalls++;
                return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }) as typeof globalThis.fetch;

            const events: QaapAgentSignedOutDetail[] = [];
            const listener = (event: Event): void => {
                events.push((event as CustomEvent<QaapAgentSignedOutDetail>).detail);
            };
            window.addEventListener(QAAP_AGENT_SIGNED_OUT_EVENT, listener);
            try {
                const widget = new TestHarnessConfigurationWidget();
                widget.confirmResult = false;
                await widget.triggerSignOut(opencodeRow, true);
                expect(widget.confirmedCopies).to.have.length(1);
                expect(widget.confirmedCopies[0].msg).to.include('all providers');
                expect(fetchCalls).to.equal(0);
                expect(events).to.deep.equal([]);
                expect(widget.availabilityLoads).to.equal(0);
            } finally {
                window.removeEventListener(QAAP_AGENT_SIGNED_OUT_EVENT, listener);
            }
        });

        it('calls backend sign-out, invalidates agent/model caches, dispatches signed-out event and reloads availability', async () => {
            let listAllCalls = 0;
            let modelCalls = 0;
            const signOutBodies: unknown[] = [];

            globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = String(input);
                if (url.startsWith(`${QAAP_AGENT_TASK_API_PATH}/all`)) {
                    listAllCalls++;
                    return new Response(JSON.stringify({
                        agents: [{ id: 'opencode', label: 'OpenCode', available: true, connectionState: 'connected' }],
                        agentConfigured: true,
                        qaiqInstalled: false,
                        qaiqModels: [],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (url.startsWith(`${QAAP_AGENT_TASK_API_PATH}/agent-models`)) {
                    modelCalls++;
                    return new Response(JSON.stringify({
                        models: [{ provider: 'openai', vendor: 'opencode', modelId: 'opencode/beam-free', label: 'Beam Free' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (url === `${QAAP_AGENT_TASK_API_PATH}/${QAAP_HARNESS_SIGN_OUT_ROUTE}`) {
                    signOutBodies.push(JSON.parse(String(init?.body ?? '{}')));
                    return new Response(JSON.stringify({
                        ok: true,
                        harnessId: 'opencode',
                        connectionState: 'disconnected',
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                throw new Error(`Unexpected fetch: ${url}`);
            }) as typeof globalThis.fetch;

            // Warm both caches before signing out.
            await fetchAgentTaskListAll();
            await fetchAgentModelsForAgent('opencode');
            expect(listAllCalls).to.equal(1);
            expect(modelCalls).to.equal(1);

            const events: QaapAgentSignedOutDetail[] = [];
            const listener = (event: Event): void => {
                events.push((event as CustomEvent<QaapAgentSignedOutDetail>).detail);
            };
            window.addEventListener(QAAP_AGENT_SIGNED_OUT_EVENT, listener);
            try {
                const widget = new TestHarnessConfigurationWidget();
                widget.confirmResult = true;
                await widget.triggerSignOut(opencodeRow, true);

                expect(signOutBodies).to.deep.equal([{ harnessId: 'opencode' }]);
                expect(events).to.deep.equal([{ agentId: 'opencode' }]);
                expect(widget.availabilityLoads).to.equal(1);

                // Both caches must have been invalidated so the next reads hit the backend again.
                await fetchAgentTaskListAll();
                await fetchAgentModelsForAgent('opencode');
                expect(listAllCalls).to.equal(2);
                expect(modelCalls).to.equal(2);
            } finally {
                window.removeEventListener(QAAP_AGENT_SIGNED_OUT_EVENT, listener);
            }
        });
    });
});
