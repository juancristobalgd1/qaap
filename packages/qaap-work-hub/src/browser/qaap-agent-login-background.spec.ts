// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import * as sinon from 'sinon';
import { Emitter } from '@theia/core/lib/common/event';
import { Widget } from '@theia/core/shared/@lumino/widgets';
import { QAAP_AGENT_LOGIN_CHALLENGE_TIMEOUT_MS, QAAP_AGENT_LOGIN_PREPARE_TIMEOUT_MS } from '@theia/qaap-agents-ui/lib/common/qaap-agent-login-flow';
import type { MobileProjectsPanelContext } from './mobile-projects-panel-context';
import { openAgentSignInTerminalExtracted } from './mobile-projects-panel-timeline';
import { useSuiteAnimationFrameStub, useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

const TENANT_CWD = '/srv/tenants/fo/repo';

/** What Gemini CLI 0.62 (Antigravity) printed in production before this fix: no link, only a question. */
const GEMINI_TRUST_DIALOG = [
    '╭──────────────────────────────────────────────╮',
    '│ Do you trust this folder?                    │',
    '│ Trusting a folder allows Gemini CLI to load its local configurations, including custom commands, hooks, MCP servers, agent skills, and settings. │',
    '│ ● 1. Trust folder (repo)                     │',
    '╰──────────────────────────────────────────────╯',
    '',
].join('\r\n');

const GEMINI_LINK = [
    'Please visit the following URL to authorize the application:',
    '',
    'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fcodeassist.google.com%2Fauthcode&response_type=code',
    '',
    'Enter the authorization code: ',
].join('\r\n');

/** A hidden Connect terminal: a real Lumino widget so the staging/attach path runs for real. */
class FakeLoginTerminal extends Widget {
    readonly sent: string[] = [];
    readonly exitStatus = undefined;
    protected readonly outputEmitter = new Emitter<string>();
    readonly onOutput = this.outputEmitter.event;

    constructor(protected readonly respond: (terminal: FakeLoginTerminal, text: string) => void) {
        super();
    }

    async start(): Promise<number> {
        return 1;
    }

    sendText(text: string): void {
        this.sent.push(text);
        this.respond(this, text);
    }

    print(output: string): void {
        this.outputEmitter.fire(output);
    }
}

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
}

function defer<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => resolve = done);
    return { promise, resolve };
}

function dialogStatus(): string {
    return document.querySelector('.theia-mobile-agent-login-dialog-status')?.textContent ?? '';
}

function dialogSpinning(): boolean {
    const status = document.querySelector<HTMLElement>('.theia-mobile-agent-login-dialog-status');
    return !!status && !status.hidden && !!status.querySelector('.codicon-loading');
}

function dialogButton(label: string): HTMLButtonElement | undefined {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('.theia-mobile-agent-login-dialog button'))
        .find(button => button.textContent === label);
}

describe('Antigravity Connect dialog in a tenant workspace', () => {

    useSuiteJSDOM();
    useSuiteAnimationFrameStub();

    let clock: sinon.SinonFakeTimers;
    let restoreWindowTimers: (() => void) | undefined;
    let originalFetch: typeof globalThis.fetch | undefined;
    let harnessStatus: () => Promise<Response>;
    let originalPlatform: PropertyDescriptor | undefined;

    beforeEach(() => {
        // Tenant workspaces run a Linux shell whatever OS runs the tests: pin the platform so the
        // POSIX sign-in command is the one under test on Windows and macOS CI too.
        originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        clock = sinon.useFakeTimers({ now: 1_000_000, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
        // jsdom's window has its own timers: route them through the same fake clock.
        const timerNames = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const;
        const previous = timerNames.map(name => [name, window[name]] as const);
        for (const name of timerNames) {
            (window as unknown as Record<string, unknown>)[name] = (globalThis as unknown as Record<string, unknown>)[name];
        }
        restoreWindowTimers = () => previous.forEach(([name, timer]) => (window as unknown as Record<string, unknown>)[name] = timer);
        originalFetch = globalThis.fetch;
        harnessStatus = async () => ({
            ok: true,
            json: async () => ({ harnesses: [{ id: 'antigravity', installed: true, enabled: true }] }),
        } as unknown as Response);
        globalThis.fetch = (() => harnessStatus()) as typeof globalThis.fetch;
    });

    afterEach(() => {
        if (originalPlatform) {
            Object.defineProperty(process, 'platform', originalPlatform);
        }
        for (const dialog of Array.from(document.querySelectorAll<HTMLButtonElement>('.theia-mobile-agent-login-dialog-close'))) {
            dialog.click();
        }
        globalThis.fetch = originalFetch!;
        restoreWindowTimers?.();
        clock.restore();
    });

    const connect = (createTerminal: () => Promise<FakeLoginTerminal>): void => {
        const project = { id: 'project-1', name: 'repo' };
        const ctx = {
            transcriptController: { state: { transcriptOpenProject: project } },
            projectsService: { getProjectCwd: () => TENANT_CWD },
            preparedCwdByProjectId: new Map<string, string>(),
            createTranscriptTerminalViewServices: () => ({
                resolveCwd: (cwd: string) => cwd,
                createTerminal,
            }),
        } as unknown as MobileProjectsPanelContext;
        openAgentSignInTerminalExtracted(ctx, 'antigravity');
    };

    it('turns a CLI stuck at the folder-trust question into an explicit error within 15 s, then Retry shows the link even if the status probe fails', async () => {
        const terminals: FakeLoginTerminal[] = [];
        connect(async () => {
            // First run: the CLI as it behaved in production. Retry: the CLI honours the trust rule.
            const terminal = new FakeLoginTerminal((self, text) => self.print(terminals.length === 1 ? GEMINI_TRUST_DIALOG : `${text}\r\n${GEMINI_LINK}`));
            terminals.push(terminal);
            return terminal;
        });

        const startedAt = Date.now();
        await clock.tickAsync(500);
        expect(terminals).to.have.length(1);
        const command = terminals[0].sent[0];
        expect(command, 'the agent trusts only its workspace, through Gemini CLI\'s own mechanisms').to.contain('"TRUST_FOLDER"');
        expect(command).to.contain('GEMINI_CLI_TRUST_WORKSPACE=true gemini');
        expect(command, 'folder trust is never switched off globally').to.not.contain('folderTrust');

        while (dialogSpinning() && Date.now() - startedAt <= QAAP_AGENT_LOGIN_CHALLENGE_TIMEOUT_MS) {
            await clock.tickAsync(250);
        }
        expect(dialogSpinning(), 'no spinner once the CLI waits for input').to.equal(false);
        expect(dialogStatus()).to.contain('Antigravity');
        expect(dialogStatus()).to.contain('stopped to ask a question');
        expect(dialogStatus()).to.contain('Trusting a folder allows Gemini CLI');
        expect(Date.now() - startedAt, 'the user learns what happened within the link deadline').to.be.below(QAAP_AGENT_LOGIN_CHALLENGE_TIMEOUT_MS);

        // Retry while the advisory harness-status probe fails: the sign-in must still run.
        harnessStatus = () => Promise.reject(new TypeError('Failed to fetch'));
        dialogButton('Retry')!.click();
        await clock.tickAsync(500);

        expect(terminals, 'Retry opens a new sign-in terminal').to.have.length(2);
        expect(dialogStatus()).to.not.contain('Secure sign-in is not available');
        expect(document.querySelector('.theia-mobile-agent-login-dialog-url')?.textContent).to.contain('Verification page');
        expect(document.querySelector('.theia-mobile-agent-login-dialog-code-input'), 'the pasted Google code goes back to the CLI').to.not.equal(null);
    });

    it('keeps a Retry working when the abandoned attempt\'s terminal arrives late', async () => {
        const pending: Array<Deferred<FakeLoginTerminal>> = [];
        connect(() => {
            const deferred = defer<FakeLoginTerminal>();
            pending.push(deferred);
            return deferred.promise;
        });

        // The first terminal never comes up in time: the dialog says so instead of spinning.
        await clock.tickAsync(QAAP_AGENT_LOGIN_PREPARE_TIMEOUT_MS + 1_000);
        expect(dialogSpinning()).to.equal(false);
        expect(dialogStatus()).to.contain('did not start within 15 seconds');

        dialogButton('Retry')!.click();
        await clock.tickAsync(100);
        expect(pending).to.have.length(2);

        // The first attempt's terminal resolves only now, while the Retry's is still starting.
        const late = new FakeLoginTerminal(() => undefined);
        pending[0].resolve(late);
        await clock.tickAsync(10);
        expect(late.isDisposed, 'the abandoned terminal is closed').to.equal(true);

        const retried = new FakeLoginTerminal((self, text) => self.print(`${text}\r\n${GEMINI_LINK}`));
        pending[1].resolve(retried);
        await clock.tickAsync(500);

        expect(late.sent, 'the abandoned terminal never runs the login').to.deep.equal([]);
        expect(retried.sent).to.have.length(1);
        expect(dialogStatus()).to.not.contain('Secure sign-in is not available');
        expect(dialogStatus()).to.not.contain('Could not open a terminal');
        expect(document.querySelector('.theia-mobile-agent-login-dialog-url')?.textContent).to.contain('Verification page');
    });
});
