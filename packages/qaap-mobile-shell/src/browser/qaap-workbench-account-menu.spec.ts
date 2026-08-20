// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    buildQaapAccountMenuEntries,
    dismissQaapAccountMenu,
    openQaapAccountMenu,
    QAAP_WORK_HUB_OVERVIEW_COMMAND,
    QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND,
    qaapAccountMenuAppearanceFromService,
} from './qaap-workbench-account-menu';
import type { QaapAppearanceMode } from '../common/qaap-appearance-mode';

describe('buildQaapAccountMenuEntries', () => {
    describe('signed-in menu', () => {
        let entries: ReturnType<typeof buildQaapAccountMenuEntries>;

        before(() => {
            entries = buildQaapAccountMenuEntries(true);
        });

        it('does not include Work Hub overview', () => {
            const found = entries.some(e => e.commandId === QAAP_WORK_HUB_OVERVIEW_COMMAND);
            expect(found).to.equal(false);
        });

        it('does not include Open IDE', () => {
            const found = entries.some(e => e.commandId === QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND);
            expect(found).to.equal(false);
        });

        it('includes Command Palette as first action', () => {
            const actions = entries.filter(e => e.kind === 'action');
            expect(actions[0].commandId).to.equal('workbench.action.showCommands');
        });

        it('includes Settings', () => {
            const found = entries.some(e => e.kind === 'action' && e.label === 'Settings');
            expect(found).to.equal(true);
        });

        it('includes Billing when openBilling is provided', () => {
            const withBilling = buildQaapAccountMenuEntries(true, {
                openBilling: () => undefined,
            });
            const found = withBilling.some(e => e.kind === 'action' && e.label === 'Billing');
            expect(found).to.equal(true);
        });

        it('opens Settings via run when openSettings is provided', () => {
            let opened = false;
            const withSheet = buildQaapAccountMenuEntries(true, {
                openSettings: () => { opened = true; },
            });
            const settings = withSheet.find(e => e.kind === 'action' && e.label === 'Settings');
            expect(settings?.run).to.be.a('function');
            expect(settings?.commandId).to.equal(undefined);
            void settings?.run?.();
            expect(opened).to.equal(true);
        });

        it('separators only appear between non-empty groups', () => {
            // No consecutive separators
            for (let i = 0; i < entries.length - 1; i++) {
                if (entries[i].kind === 'separator') {
                    expect(entries[i + 1].kind).to.not.equal('separator',
                        'Found two consecutive separators');
                }
            }
            // First entry is not a separator
            expect(entries[0].kind).to.not.equal('separator', 'First entry should not be a separator');
            // Last entry is not a separator
            expect(entries[entries.length - 1].kind).to.not.equal('separator', 'Last entry should not be a separator');
        });

        it('preserves order: Command Palette → Settings → Extensions → Keyboard Shortcuts → Sign Out', () => {
            const actions = entries.filter(e => e.kind === 'action').map(e => e.label);
            expect(actions).to.deep.equal([
                'Command Palette…',
                'Settings',
                'Extensions',
                'Keyboard Shortcuts',
                'Sign Out',
            ]);
        });

        it('places Billing after Settings when provided', () => {
            const withBilling = buildQaapAccountMenuEntries(true, {
                openSettings: () => undefined,
                openBilling: () => undefined,
            });
            const actions = withBilling.filter(e => e.kind === 'action').map(e => e.label);
            expect(actions).to.deep.equal([
                'Command Palette…',
                'Settings',
                'Billing',
                'Extensions',
                'Keyboard Shortcuts',
                'Sign Out',
            ]);
        });
    });

    describe('signed-out menu', () => {
        let entries: ReturnType<typeof buildQaapAccountMenuEntries>;

        before(() => {
            entries = buildQaapAccountMenuEntries(false);
        });

        it('does not include Work Hub overview', () => {
            const found = entries.some(e => e.commandId === QAAP_WORK_HUB_OVERVIEW_COMMAND);
            expect(found).to.equal(false);
        });

        it('does not include Open IDE in signed-out menu', () => {
            const found = entries.some(e => e.commandId === QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND);
            expect(found).to.equal(false);
        });
    });
});

describe('account menu appearance switch', () => {

    let disableJSDOM: (() => void) | undefined;
    let previousRequestAnimationFrame: typeof requestAnimationFrame | undefined;
    let previousCancelAnimationFrame: typeof cancelAnimationFrame | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
        previousRequestAnimationFrame = globalThis.requestAnimationFrame;
        previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
        const raf = (callback: FrameRequestCallback): number => {
            callback(0);
            return 1;
        };
        (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = raf;
        window.requestAnimationFrame = raf;
        const caf = (): void => undefined;
        (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = caf;
        window.cancelAnimationFrame = caf;
    });

    after(() => {
        dismissQaapAccountMenu();
        if (previousRequestAnimationFrame) {
            globalThis.requestAnimationFrame = previousRequestAnimationFrame;
            window.requestAnimationFrame = previousRequestAnimationFrame;
        } else {
            delete (globalThis as Partial<typeof globalThis>).requestAnimationFrame;
        }
        if (previousCancelAnimationFrame) {
            globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
            window.cancelAnimationFrame = previousCancelAnimationFrame;
        } else {
            delete (globalThis as Partial<typeof globalThis>).cancelAnimationFrame;
        }
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    afterEach(() => {
        dismissQaapAccountMenu();
        document.body.innerHTML = '';
    });

    it('mounts the appearance switch in the avatar menu and keeps it out of the sidebar', () => {
        let mode: QaapAppearanceMode = 'dark';
        const anchor = document.createElement('button');
        document.body.append(anchor);
        const commands = {
            getCommand: (id: string) => ({ id }),
            isEnabled: () => true,
            executeCommand: async () => undefined,
        } as unknown as CommandRegistry;

        openQaapAccountMenu(anchor, commands, buildQaapAccountMenuEntries(true), undefined, {
            appearance: qaapAccountMenuAppearanceFromService({
                getMode: () => mode,
                setMode: next => { mode = next; },
                onDidChangeMode: () => Disposable.NULL,
            }),
        });

        const menu = document.querySelector('.theia-qaap-account-menu');
        const switchRoot = menu?.querySelector('.theia-qaap-appearance-mode-switch');
        expect(menu).to.not.equal(null);
        expect(switchRoot).to.not.equal(null);
        const light = switchRoot!.querySelector<HTMLButtonElement>('[data-mode="light"]');
        expect(light).to.not.equal(null);
        light!.click();
        expect(mode).to.equal('light');
        expect(document.querySelector('.theia-qaap-account-menu')).to.not.equal(null);
    });
});
