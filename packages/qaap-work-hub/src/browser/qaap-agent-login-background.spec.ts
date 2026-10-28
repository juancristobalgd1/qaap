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

const PI_AUTH_URL = 'https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1%3A41237%2Foauth%2Fcallback%2F3f9c2a1e-0d7b-4a52-9b8e-1c2d3e4f5a6b'
    + '&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256';
const PI_REDIRECT_URL = 'http://127.0.0.1:41237/oauth/callback/3f9c2a1e-0d7b-4a52-9b8e-1c2d3e4f5a6b?code=abc123';

function piLink(target: string, text: string): string {
    return `\x1b]8;;${target}\x07${text}\x1b]8;;\x07`;
}

/** Pi 1.4 in the hidden (80-column) terminal: escape sequences, OSC-8 links and a hard-wrapped URL. */
const PI_SCREENS = {
    header: '\x1b[?25l\r\n \x1b[38;5;75mπ\x1b[39m  \x1b[2mv1.4.0\x1b[22m\r\n ctrl+c interrupt · / commands · ! bash · ctrl+o more\r\n',
    autocomplete: '\x1b[2K\r > /login openrouter\r\n   \x1b[7mopenrouter\x1b[27m  OpenRouter\r\n',
    completed: '\x1b[2K\r > /login openrouter \r\n',
    picker: '\x1b[2K\r Select authentication method for OpenRouter:\r\n \x1b[36m→ Sign in with OpenRouter\x1b[39m\r\n   Sign in with an API key\r\n',
    login: [
        '\x1b[2J\x1b[H',
        ...PI_AUTH_URL.match(/.{1,78}/g)!.map(row => ` ${piLink(PI_AUTH_URL, row)}`),
        ` \x1b[2m${piLink(PI_AUTH_URL, 'Ctrl+click to open')}\x1b[22m • ctrl+o to copy`,
        '',
        ' Complete sign-in in your browser. If the browser is on another machine, paste the final redirect URL here.',
        '',
        ' Complete sign-in in your browser, or paste the authorization code / redirect URL here:',
        ' > ',
        ' (esc to cancel)',
        '',
    ].join('\r\n'),
};

/** Answers keystrokes the way Pi's TUI does; `afterCode` is what it prints once a code is pasted. */
function createPiTerminal(options: { readonly silent?: boolean; readonly afterCode?: string } = {}): FakeLoginTerminal {
    let enters = 0;
    return new FakeLoginTerminal((self, text) => {
        if (text.includes('pi --tui-mode regular')) {
            self.print(`${text.replace(/\r$/, '')}\r\n`);
            if (!options.silent) {
                setTimeout(() => self.print(PI_SCREENS.header), 900);
            }
        } else if (options.silent) {
            return;
        } else if (text === '/login openrouter') {
            self.print(PI_SCREENS.autocomplete);
        } else if (text === '\r') {
            enters++;
            self.print(enters === 1 ? PI_SCREENS.completed : enters === 2 ? PI_SCREENS.picker : PI_SCREENS.login);
        } else if (text.endsWith('\r') && options.afterCode) {
            self.print(`\r\n${options.afterCode}\r\n`);
        }
    });
}

describe('Pi Connect dialog: `/login` driven in the hidden terminal', () => {

    useSuiteJSDOM();
    useSuiteAnimationFrameStub();

    let clock: sinon.SinonFakeTimers;
    let restoreWindowTimers: (() => void) | undefined;
    let originalFetch: typeof globalThis.fetch | undefined;
    let originalPlatform: PropertyDescriptor | undefined;
    let piConnected: boolean;
    let probes: number;
    let openedUrls: string[];
    let restoreWindowOpen: (() => void) | undefined;

    beforeEach(() => {
        originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        clock = sinon.useFakeTimers({ now: 1_000_000, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
        const timerNames = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const;
        const previous = timerNames.map(name => [name, window[name]] as const);
        for (const name of timerNames) {
            (window as unknown as Record<string, unknown>)[name] = (globalThis as unknown as Record<string, unknown>)[name];
        }
        restoreWindowTimers = () => previous.forEach(([name, timer]) => (window as unknown as Record<string, unknown>)[name] = timer);
        originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => ({
            ok: true,
            json: async () => ({ harnesses: [{ id: 'pi', installed: true, enabled: true }] }),
        } as unknown as Response)) as typeof globalThis.fetch;
        piConnected = false;
        probes = 0;
        openedUrls = [];
        const originalOpen = window.open;
        window.open = ((url?: string | URL) => {
            openedUrls.push(String(url));
            return null;
        }) as typeof window.open;
        restoreWindowOpen = () => window.open = originalOpen;
    });

    afterEach(() => {
        if (originalPlatform) {
            Object.defineProperty(process, 'platform', originalPlatform);
        }
        for (const dialog of Array.from(document.querySelectorAll<HTMLButtonElement>('.theia-mobile-agent-login-dialog-close'))) {
            dialog.click();
        }
        globalThis.fetch = originalFetch!;
        restoreWindowOpen?.();
        restoreWindowTimers?.();
        clock.restore();
    });

    const connect = (terminal: FakeLoginTerminal): void => {
        const project = { id: 'project-1', name: 'repo' };
        const ctx = {
            transcriptController: { state: { transcriptOpenProject: project } },
            projectsService: { getProjectCwd: () => TENANT_CWD },
            preparedCwdByProjectId: new Map<string, string>(),
            createTranscriptTerminalViewServices: () => ({
                resolveCwd: (cwd: string) => cwd,
                createTerminal: async () => terminal,
            }),
            transcriptSurfacesUi: { launchAgentTuiInTranscriptTerminal: async () => undefined },
            // The harness probe (`/all?refresh=1` re-reads ~/.pi/agent/auth.json server-side).
            stickyComposerAgentsUi: {
                refreshStickyComposerAgents: async () => {
                    probes++;
                    return true;
                },
                isAgentConnected: (agentId: string) => agentId === 'pi' && piConnected,
            },
        } as unknown as MobileProjectsPanelContext;
        openAgentSignInTerminalExtracted(ctx, 'pi');
    };

    const waitForChallenge = async (): Promise<void> => {
        for (let elapsed = 0; elapsed < 20_000 && !document.querySelector('.theia-mobile-agent-login-dialog-url'); elapsed += 100) {
            await clock.tickAsync(100);
        }
    };

    const submitPaste = (value: string): void => {
        const input = document.querySelector<HTMLInputElement>('.theia-mobile-agent-login-dialog-code-input')!;
        input.value = value;
        document.querySelector('.theia-mobile-agent-login-dialog-code-form')!
            .dispatchEvent(new window.Event('submit', { cancelable: true }));
    };

    it('types `/login openrouter` and Enter through Pi\'s menus, shows the whole link and a paste field, then connects on the probe', async () => {
        const terminal = createPiTerminal();
        connect(terminal);
        await waitForChallenge();

        expect(terminal.sent[0]).to.contain('pi --tui-mode regular --no-session --no-approve');
        expect(terminal.sent[0]).to.contain('stty cols 500');
        expect(terminal.sent.slice(1), 'Pi is driven by keystrokes, never by guessing a login command').to.deep.equal(['/login openrouter', '\r', '\r', '\r']);
        dialogButton('Verification page')!.click();
        expect(openedUrls, 'the URL the TUI wrapped across rows is opened whole').to.deep.equal([PI_AUTH_URL]);
        const input = document.querySelector<HTMLInputElement>('.theia-mobile-agent-login-dialog-code-input')!;
        expect(input.getAttribute('aria-label')).to.equal('Redirect URL or code');
        expect(dialogButton('Open terminal'), 'the visible terminal stays as a fallback').to.not.equal(undefined);

        // The status probe already said "not connected" before Pi started: a later "connected" proves this login.
        await clock.tickAsync(3_000);
        expect(dialogSpinning()).to.equal(true);
        submitPaste(` ${PI_REDIRECT_URL} `);
        expect(terminal.sent[terminal.sent.length - 1]).to.equal(`${PI_REDIRECT_URL}\r`);
        expect(dialogStatus()).to.contain('Verifying the code with Pi');

        piConnected = true;
        await clock.tickAsync(3_000);
        expect(dialogStatus()).to.equal('Pi connected');
        expect(terminal.isDisposed, 'the hidden Pi process is closed once connected').to.equal(true);
        expect(probes).to.be.greaterThan(1);
    });

    it('does not take an already-connected Pi for this sign-in: Pi\'s own `Logged in to` line completes it', async () => {
        piConnected = true;
        const terminal = createPiTerminal({ afterCode: '\x1b[32m Logged in to OpenRouter\x1b[39m' });
        connect(terminal);
        await waitForChallenge();
        await clock.tickAsync(6_000);
        expect(dialogSpinning(), 'still waiting for the user, although the probe says connected').to.equal(true);
        expect(terminal.isDisposed).to.equal(false);

        submitPaste('abc123');
        await clock.tickAsync(10);
        expect(dialogStatus()).to.equal('Pi connected');
        expect(terminal.isDisposed).to.equal(true);
    });

    it('reports a code Pi rejected with its output and closes the hidden terminal', async () => {
        const terminal = createPiTerminal({ afterCode: ' Error: Failed to login to OpenRouter: invalid authorization code' });
        connect(terminal);
        await waitForChallenge();
        submitPaste('wrong');
        await clock.tickAsync(10);
        expect(dialogSpinning()).to.equal(false);
        expect(dialogStatus()).to.contain('could not complete the sign-in');
        expect(document.querySelector('.theia-mobile-agent-login-dialog-output')?.textContent).to.contain('invalid authorization code');
        expect(dialogButton('Retry')).to.not.equal(undefined);
        expect(terminal.isDisposed).to.equal(true);
    });

    it('never leaves Pi running when the dialog is closed mid-sign-in', async () => {
        const terminal = createPiTerminal();
        connect(terminal);
        await waitForChallenge();
        expect(terminal.isDisposed).to.equal(false);
        document.querySelector<HTMLButtonElement>('.theia-mobile-agent-login-dialog-close')!.click();
        expect(terminal.isDisposed).to.equal(true);
        const sentBefore = terminal.sent.length;
        await clock.tickAsync(5_000);
        expect(terminal.sent.length, 'nothing is typed after close').to.equal(sentBefore);
    });

    it('closes the hidden Pi terminal when the page unloads, before the terminal could be kept for a restore', async () => {
        const terminal = createPiTerminal();
        connect(terminal);
        await waitForChallenge();
        window.dispatchEvent(new window.Event('beforeunload'));
        expect(terminal.isDisposed).to.equal(true);
        expect(document.querySelectorAll('.theia-mobile-agent-login-dialog')).to.have.length(0);
    });

    it('gives up with Pi\'s output after 30 seconds without a link, and closes the hidden terminal', async () => {
        // Pi starts but never draws anything: the readiness fallback still types `/login`, the
        // menus never appear, so the method-picker Enter is never sent.
        const terminal = createPiTerminal({ silent: true });
        connect(terminal);
        const startedAt = Date.now();
        while (dialogSpinning() && Date.now() - startedAt <= 40_000) {
            await clock.tickAsync(500);
        }
        expect(dialogStatus()).to.contain('did not show a sign-in link within 30 seconds');
        expect(terminal.sent.filter(text => text === '\r').length, 'the method picker never showed, so its Enter was never typed')
            .to.be.below(3);
        expect(terminal.isDisposed).to.equal(true);
        expect(Date.now() - startedAt).to.be.at.least(29_000);
    });
});
