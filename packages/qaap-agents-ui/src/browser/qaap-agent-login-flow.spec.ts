// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import {
    QAAP_AGENT_LOGIN_CHALLENGE_TIMEOUT_MS,
    QAAP_AGENT_LOGIN_CODE_TIMEOUT_MS,
    QAAP_AGENT_LOGIN_INSTALL_TIMEOUT_MS,
    QAAP_AGENT_LOGIN_PREPARE_TIMEOUT_MS,
    QAAP_AGENT_LOGIN_PROMPT_GRACE_MS,
    extractAgentLoginHyperlinkTargets,
    QaapAgentLoginFlow,
    type QaapAgentLoginFlowState,
} from '../common/qaap-agent-login-flow';
import { createQaapAgentLoginDialog, type QaapAgentLoginDialogController } from './qaap-agent-login-dialog';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

const CLAUDE_OUTPUT = [
    'claude auth login; echo "QAAP_LOGIN_EXIT:$?"',
    'If the browser didn\'t open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&state=abc',
    'Paste code here if prompted >',
].join('\n');

const GROK_OUTPUT = [
    'To sign in, open this URL in your browser:',
    '  https://accounts.x.ai/oauth2/device?user_code=S3DF-WCAM',
    'Confirm this code in your browser:',
    '  S3DF-WCAM',
    'Waiting for authorization...',
].join('\n');

/** Gemini CLI 0.62 (Antigravity) folder-trust dialog, Ink box drawing stripped to text. */
const GEMINI_TRUST_DIALOG_OUTPUT = [
    'node -e \'…\' && NO_BROWSER=true GEMINI_CLI_TRUST_WORKSPACE=true gemini; echo "QAAP_LOGIN_EXIT:$?"',
    '╭──────────────────────────────────────────────────────────────╮',
    '│ Do you trust this folder?                                     │',
    '│ Trusting a folder allows Gemini CLI to load its local configurations, including custom commands, hooks, MCP servers, agent skills, and settings. │',
    '│ ● 1. Trust folder (repo)                                      │',
    '│   2. Trust parent folder (workspace)                          │',
    '│   3. Don\'t trust                                              │',
    '╰──────────────────────────────────────────────────────────────╯',
].join('\n');

const GEMINI_LINK_OUTPUT = [
    'Please visit the following URL to authorize the application:',
    'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fcodeassist.google.com%2Fauthcode&access_type=offline'
    + '&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcloud-platform&response_type=code',
    'Enter the authorization code:',
].join('\n');

function createFlow(agentId: string): { flow: QaapAgentLoginFlow; states: QaapAgentLoginFlowState[] } {
    const states: QaapAgentLoginFlowState[] = [];
    const flow = new QaapAgentLoginFlow({ agentId, onDidChange: state => states.push(state) });
    return { flow, states };
}

const PI_AUTH_URL = 'https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1%3A41237%2Foauth%2Fcallback%2F3f9c2a1e-0d7b-4a52-9b8e-1c2d3e4f5a6b'
    + '&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256';

/**
 * Pi 1.4 `/login openrouter` as the hidden 80-column terminal receives it: the URL row is an
 * OSC-8 hyperlink that the TUI hard-wraps (each row repeats the full target), the click hint is a
 * second link to the same URL, then the paste-back prompt.
 */
function piRawLoginOutput(): string {
    const link = (target: string, text: string): string => `\x1b]8;;${target}\x07${text}\x1b]8;;\x07`;
    const rows = PI_AUTH_URL.match(/.{1,78}/g)!;
    return [
        '\x1b[2K\x1b[1G Select authentication method for OpenRouter:',
        ...rows.map(row => ` \x1b[38;5;75m${link(PI_AUTH_URL, row)}\x1b[39m`),
        ` \x1b[2m${link(PI_AUTH_URL, 'Cmd+click to open')}\x1b[22m • ctrl+o to copy`,
        '',
        ' Complete sign-in in your browser. If the browser is on another machine, paste the final redirect URL here.',
        '',
        ' Complete sign-in in your browser, or paste the authorization code / redirect URL here:',
        ' > ',
        ' (esc to cancel)',
    ].join('\r\n');
}

describe('QaapAgentLoginFlow', () => {

    it('finds Pi\'s whole OpenRouter link from its OSC-8 hyperlinks although the TUI wrapped it', () => {
        expect(extractAgentLoginHyperlinkTargets(piRawLoginOutput())).to.deep.equal([PI_AUTH_URL]);
        const { flow } = createFlow('pi');
        flow.restart(0);
        flow.commandStarted(0);
        const raw = piRawLoginOutput();
        // Chunk boundaries fall inside escape sequences, as real PTY reads do.
        for (let offset = 0; offset < raw.length; offset += 37) {
            flow.appendRawOutput(raw.slice(offset, offset + 37));
        }
        const state = flow.state;
        expect(state.phase).to.equal('challenge');
        if (state.phase === 'challenge') {
            expect(state.challenge.url).to.equal(PI_AUTH_URL);
            expect(state.challenge.codeEntry).to.equal(true);
            expect(state.challenge.acceptsRedirectUrl).to.equal(true);
        }
        flow.codeSubmitted(1_000);
        flow.appendRawOutput('\r\n \x1b[32mLogged in to OpenRouter\x1b[39m\r\n');
        expect(flow.state.phase).to.equal('connected');
    });

    it('fails a Pi sign-in the TUI rejected, with its output, although Pi keeps running', () => {
        const { flow } = createFlow('pi');
        flow.restart(0);
        flow.commandStarted(0);
        flow.appendRawOutput(piRawLoginOutput());
        flow.codeSubmitted(1_000);
        flow.appendRawOutput('\r\n Error: Failed to login to OpenRouter: invalid authorization code\r\n');
        const state = flow.state;
        expect(state.phase).to.equal('failed');
        if (state.phase === 'failed') {
            expect(state.reason).to.equal('rejected');
            expect(state.tail.join('\n')).to.contain('invalid authorization code');
        }
    });

    it('gives a driven TUI login its own link deadline and reports it', () => {
        const states: QaapAgentLoginFlowState[] = [];
        const flow = new QaapAgentLoginFlow({ agentId: 'pi', challengeTimeoutMs: 30_000, onDidChange: state => states.push(state) });
        flow.restart(0);
        flow.commandStarted(0);
        flow.tick(QAAP_AGENT_LOGIN_CHALLENGE_TIMEOUT_MS);
        expect(flow.state.phase).to.equal('waiting');
        flow.tick(30_000);
        const state = flow.state;
        expect(state.phase === 'failed' && state.reason).to.equal('timeout');
        expect(state.phase === 'failed' && state.timeoutMs).to.equal(30_000);
    });

    it('shows the link and asks for the pasted code when the CLI prompts for it', () => {
        const { flow } = createFlow('claude');
        flow.restart(0);
        flow.commandStarted(0);
        flow.appendOutput(CLAUDE_OUTPUT);
        const state = flow.state;
        expect(state.phase).to.equal('challenge');
        if (state.phase === 'challenge') {
            expect(state.challenge.url?.startsWith('https://claude.com/cai/oauth/authorize')).to.equal(true);
            expect(state.challenge.codeEntry).to.equal(true);
        }
        flow.codeSubmitted(1000);
        expect(flow.state.phase).to.equal('code-submitted');
        flow.appendOutput('\nLogin successful.\n');
        expect(flow.state.phase).to.equal('connected');
    });

    it('shows a device link and code without a paste field', () => {
        const { flow } = createFlow('grok');
        flow.restart(0);
        flow.commandStarted(0);
        flow.appendOutput(GROK_OUTPUT);
        const state = flow.state;
        expect(state.phase).to.equal('challenge');
        if (state.phase === 'challenge') {
            expect(state.challenge.userCode).to.equal('S3DF-WCAM');
            expect(!!state.challenge.codeEntry).to.equal(false);
        }
        flow.appendOutput('\nQAAP_LOGIN_EXIT:0\n');
        expect(flow.state.phase).to.equal('connected');
    });

    it('settles immediately on the Settings API-key path', () => {
        const { flow } = createFlow('hermes');
        flow.requireSettingsApiKey();
        expect(flow.state.phase).to.equal('settings-api-key');
        expect(flow.isSettled).to.equal(true);
    });

    it('times out a silent CLI with its last output', () => {
        const { flow } = createFlow('copilot');
        flow.restart(0);
        flow.commandStarted(0);
        flow.appendOutput('copilot login --device-code; echo "QAAP_LOGIN_EXIT:$?"\nError: something hangs\n');
        flow.tick(QAAP_AGENT_LOGIN_CHALLENGE_TIMEOUT_MS - 1);
        expect(flow.state.phase).to.equal('waiting');
        flow.tick(QAAP_AGENT_LOGIN_CHALLENGE_TIMEOUT_MS);
        expect(flow.state).to.deep.equal({ phase: 'failed', reason: 'timeout', tail: ['Error: something hangs'] });
    });

    it('times out a pasted code the CLI never confirms', () => {
        const { flow } = createFlow('claude');
        flow.commandStarted(0);
        flow.appendOutput(CLAUDE_OUTPUT);
        flow.codeSubmitted(10_000);
        flow.tick(10_000 + QAAP_AGENT_LOGIN_CODE_TIMEOUT_MS);
        expect(flow.state.phase).to.equal('failed');
    });

    it('reports a CLI exit with its exit code and output', () => {
        const { flow } = createFlow('opencode');
        flow.commandStarted(0);
        flow.appendOutput('opencode: command not found\nQAAP_LOGIN_EXIT:127\n');
        expect(flow.state).to.deep.equal({ phase: 'failed', reason: 'exited', exitCode: 127, tail: ['opencode: command not found'] });
        flow.appendOutput('Login successful.');
        expect(flow.state.phase, 'a settled attempt ignores late output').to.equal('failed');
    });

    it('never spins forever while preparing or installing', () => {
        const { flow } = createFlow('codex');
        flow.restart(0);
        flow.tick(QAAP_AGENT_LOGIN_PREPARE_TIMEOUT_MS);
        expect(flow.state).to.deep.equal({ phase: 'failed', reason: 'prepare-timeout', tail: [] });
        flow.startInstall(0);
        flow.tick(QAAP_AGENT_LOGIN_INSTALL_TIMEOUT_MS - 1);
        expect(flow.state.phase).to.equal('installing');
        flow.tick(QAAP_AGENT_LOGIN_INSTALL_TIMEOUT_MS);
        expect(flow.state).to.deep.equal({ phase: 'failed', reason: 'install-failed', tail: [] });
    });

    it('says which question a CLI stopped at instead of spinning until the link deadline', () => {
        const { flow } = createFlow('antigravity');
        flow.restart(0);
        flow.commandStarted(0);
        flow.appendOutput(GEMINI_TRUST_DIALOG_OUTPUT, 1_000);
        flow.tick(1_000 + QAAP_AGENT_LOGIN_PROMPT_GRACE_MS - 1);
        expect(flow.state.phase, 'a link may still follow the question').to.equal('waiting');
        flow.tick(1_000 + QAAP_AGENT_LOGIN_PROMPT_GRACE_MS);
        const state = flow.state;
        expect(state.phase).to.equal('failed');
        if (state.phase === 'failed') {
            expect(state.reason).to.equal('waiting-for-input');
            expect(state.prompt).to.match(/^Trusting a folder allows Gemini CLI/);
            expect(state.tail.join('\n')).to.include('Do you trust this folder?');
        }
        expect(1_000 + QAAP_AGENT_LOGIN_PROMPT_GRACE_MS).to.be.at.most(QAAP_AGENT_LOGIN_CHALLENGE_TIMEOUT_MS);
    });

    it('shows the link when it follows a question within the grace period', () => {
        const { flow } = createFlow('antigravity');
        flow.commandStarted(0);
        flow.appendOutput(GEMINI_TRUST_DIALOG_OUTPUT, 0);
        flow.appendOutput(`\n${GEMINI_LINK_OUTPUT}`, 500);
        flow.tick(QAAP_AGENT_LOGIN_PROMPT_GRACE_MS);
        const state = flow.state;
        expect(state.phase).to.equal('challenge');
        if (state.phase === 'challenge') {
            expect(state.challenge.url?.startsWith('https://accounts.google.com/o/oauth2/v2/auth')).to.equal(true);
            expect(state.challenge.codeEntry).to.equal(true);
        }
    });

    it('expects every sign-in link within 15 seconds', () => {
        expect(QAAP_AGENT_LOGIN_CHALLENGE_TIMEOUT_MS).to.be.at.most(15_000);
    });

    it('starts each attempt without the previous attempt\'s question', () => {
        const { flow } = createFlow('antigravity');
        flow.commandStarted(0);
        flow.appendOutput(GEMINI_TRUST_DIALOG_OUTPUT, 0);
        flow.restart(100);
        flow.commandStarted(200);
        flow.tick(200 + QAAP_AGENT_LOGIN_PROMPT_GRACE_MS);
        expect(flow.state.phase).to.equal('waiting');
    });

    it('reports why the sign-in terminal could not start', () => {
        const { flow } = createFlow('antigravity');
        flow.restart(0);
        flow.terminalUnavailable('Host is not attached.');
        expect(flow.state).to.deep.equal({ phase: 'failed', reason: 'terminal-unavailable', tail: ['Host is not attached.'] });
    });

    it('ignores the echoed command line: a flag name is not a challenge', () => {
        const { flow } = createFlow('codex');
        flow.commandStarted(0);
        flow.appendOutput('codex login --device-auth; echo "QAAP_LOGIN_EXIT:$?"\n');
        expect(flow.state.phase).to.equal('waiting');
    });
});

describe('createQaapAgentLoginDialog', () => {

    useSuiteJSDOM();

    let dialog: QaapAgentLoginDialogController | undefined;
    afterEach(() => {
        dialog?.dispose();
        dialog = undefined;
    });

    const open = (handlers: { onSubmitCode?: (code: string) => void; onRetry?: () => void; onOpenSettings?: () => void; onInstall?: () => void } = {}) => {
        dialog = createQaapAgentLoginDialog({ agentId: 'claude', agentLabel: 'Claude Code', onClose: () => undefined, ...handlers });
        return dialog;
    };
    const openPi = (handlers: { onSubmitCode?: (code: string) => void; onRetry?: () => void; onOpenTerminal?: () => void } = {}) => {
        dialog = createQaapAgentLoginDialog({ agentId: 'pi', agentLabel: 'Pi', onClose: () => undefined, openTerminalHint: 'run pi', ...handlers });
        return dialog;
    };
    const buttonLabels = (root: HTMLElement): string[] => Array.from(root.querySelectorAll('button')).map(button => button.textContent ?? '');

    it('renders the link and sends the pasted code', () => {
        const submitted: string[] = [];
        const controller = open({ onSubmitCode: code => submitted.push(code) });
        controller.render({
            phase: 'challenge',
            challenge: { mode: 'session', url: 'https://claude.com/cai/oauth/authorize?code=true', codeEntry: true },
        });
        expect(controller.root.querySelectorAll('.theia-mobile-agent-login-dialog-url').length).to.equal(1);
        const input = controller.root.querySelector<HTMLInputElement>('.theia-mobile-agent-login-dialog-code-input')!;
        input.value = ' abc#123 ';
        const view = controller.root.ownerDocument.defaultView!;
        controller.root.querySelector('form')!.dispatchEvent(new view.Event('submit', { cancelable: true }));
        expect(submitted).to.deep.equal(['abc#123']);
    });

    it('asks Pi users for the redirect URL or code and keeps Open terminal as a fallback', () => {
        const submitted: string[] = [];
        let terminals = 0;
        const controller = openPi({ onSubmitCode: code => submitted.push(code), onOpenTerminal: () => terminals++ });
        controller.render({ phase: 'waiting', startedAt: 0 });
        expect(buttonLabels(controller.root).filter(label => label === 'Open terminal')).to.have.length(1);
        controller.render({
            phase: 'challenge',
            challenge: { mode: 'session', url: 'https://openrouter.ai/auth?callback_url=x', codeEntry: true, acceptsRedirectUrl: true },
        });
        expect(controller.root.querySelector('.theia-mobile-agent-login-dialog-subtitle')?.textContent).to.contain('OpenRouter');
        expect(controller.root.querySelector('.theia-mobile-agent-login-dialog-url')?.textContent).to.contain('Verification page');
        expect(controller.root.textContent).to.contain('redirect URL');
        expect(controller.root.querySelector('.theia-mobile-agent-login-dialog-step-hint')?.textContent).to.contain('127.0.0.1');
        const input = controller.root.querySelector<HTMLInputElement>('.theia-mobile-agent-login-dialog-code-input')!;
        expect(input.getAttribute('aria-label')).to.equal('Redirect URL or code');
        input.value = ' http://127.0.0.1:41237/oauth/callback/abc?code=xyz ';
        const view = controller.root.ownerDocument.defaultView!;
        controller.root.querySelector('form')!.dispatchEvent(new view.Event('submit', { cancelable: true }));
        expect(submitted).to.deep.equal(['http://127.0.0.1:41237/oauth/callback/abc?code=xyz']);
        const fallback = Array.from(controller.root.querySelectorAll<HTMLButtonElement>('.theia-mobile-agent-login-dialog-secondary'));
        expect(fallback.map(button => button.textContent)).to.deep.equal(['Open terminal']);
        expect(fallback[0].title).to.equal('run pi');
        fallback[0].click();
        expect(terminals).to.equal(1);
        controller.render({ phase: 'failed', reason: 'rejected', tail: ['Failed to login to OpenRouter: bad code'] });
        expect(controller.root.querySelector('.theia-mobile-agent-login-dialog-status')?.textContent).to.contain('could not complete the sign-in');
        expect(buttonLabels(controller.root)).to.include.members(['Open terminal']);
    });

    it('never shows a terminal fallback for a CLI login without one', () => {
        const controller = open({ onSubmitCode: () => undefined });
        controller.render({
            phase: 'challenge',
            challenge: { mode: 'session', url: 'https://claude.com/cai/oauth/authorize?code=true', codeEntry: true },
        });
        expect(buttonLabels(controller.root)).to.not.include('Open terminal');
        expect(controller.root.querySelector<HTMLInputElement>('.theia-mobile-agent-login-dialog-code-input')!.getAttribute('aria-label'))
            .to.equal('Authorization code');
    });

    it('offers the Settings button with no spinner', () => {
        const controller = open({ onOpenSettings: () => undefined });
        controller.render({ phase: 'settings-api-key' });
        expect(buttonLabels(controller.root)).to.include('Add API key in Settings');
        expect(controller.root.querySelector<HTMLElement>('.theia-mobile-agent-login-dialog-status')!.hidden).to.equal(true);
    });

    it('offers Install for a missing harness', () => {
        const controller = open({ onInstall: () => undefined });
        controller.render({ phase: 'install-required', canInstall: true });
        expect(buttonLabels(controller.root)).to.include('Install Claude Code');
    });

    it('shows the last output and Retry after a timeout or exit', () => {
        let retries = 0;
        const controller = open({ onRetry: () => retries++ });
        controller.render({ phase: 'failed', reason: 'timeout', tail: ['Error: no network'] });
        expect(controller.root.querySelector('.theia-mobile-agent-login-dialog-output')?.textContent).to.equal('Error: no network');
        const retry = Array.from(controller.root.querySelectorAll('button')).find(button => button.textContent === 'Retry')!;
        retry.click();
        expect(retries).to.equal(1);
        controller.render({ phase: 'failed', reason: 'exited', exitCode: 1, tail: ['denied'] });
        expect(controller.root.querySelector('.theia-mobile-agent-login-dialog-status')?.textContent).to.contain('exit code 1');
    });

    it('names the question a stuck CLI asked, with no spinner', () => {
        const controller = open({ onRetry: () => undefined });
        controller.render({
            phase: 'failed',
            reason: 'waiting-for-input',
            prompt: 'Do you trust this folder?',
            tail: ['Do you trust this folder?'],
        });
        const status = controller.root.querySelector<HTMLElement>('.theia-mobile-agent-login-dialog-status')!;
        expect(status.textContent).to.contain('stopped to ask a question');
        expect(status.textContent).to.contain('"Do you trust this folder?"');
        expect(status.querySelector('.codicon-loading')).to.equal(null);
        expect(buttonLabels(controller.root)).to.include('Retry');
    });

    it('never answers a failed Retry with the generic unavailable message', () => {
        const controller = open({ onRetry: () => undefined });
        const status = (): string => controller.root.querySelector('.theia-mobile-agent-login-dialog-status')?.textContent ?? '';
        controller.render({ phase: 'failed', reason: 'prepare-timeout', tail: [] });
        expect(status()).to.contain('did not start within 15 seconds');
        controller.render({ phase: 'failed', reason: 'terminal-unavailable', tail: ['Host is not attached.'] });
        expect(status()).to.contain('Could not open a terminal in this workspace');
        expect(controller.root.querySelector('.theia-mobile-agent-login-dialog-output')?.textContent).to.equal('Host is not attached.');
        expect(status()).to.not.contain('Secure sign-in is not available');
    });
});
