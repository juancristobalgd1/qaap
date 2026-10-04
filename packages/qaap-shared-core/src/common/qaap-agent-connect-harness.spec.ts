// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { extractAgentAuthLoginChallenge, isAgentLoginSuccessOutput, type QaapAgentAuthLoginChallenge } from './qaap-agent-auth-login';
import { QAAP_HARNESS_DEFINITIONS } from './qaap-builtin-agents';
import {
    buildAgentLoginShellCommand,
    parseAgentLoginExitMarker,
    stripAgentLoginShellEcho,
} from './qaap-agent-connect-plan';
import { resolveAgentConnectionFlow, type QaapAgentConnectionFlow } from './qaap-agent-tui-command';
import { rememberQaapHostedRuntime } from './qaap-hosted-agent-auth-policy';

/**
 * Output of each login command, captured under a PTY (`script -qfc`) from the CLI version the
 * image installs (Oct 2026), with terminal control sequences stripped the way the dialog does.
 */
const CAPTURED_LOGIN_OUTPUT: Readonly<Record<string, string>> = {
    // @openai/codex 0.144.5 — `codex login --device-auth`
    codex: [
        'Welcome to Codex [v0.144.5]',
        'Follow these steps to sign in with ChatGPT using device code authorization:',
        '1. Open this link in your browser and sign in to your account',
        '   https://auth.openai.com/codex/device',
        '2. Enter this one-time code (expires in 15 minutes)',
        '   CZ6N-DCWVI',
        'Continue only if you started this login in Codex. If a website or another person gave you this code, cancel.',
    ].join('\n'),
    // @anthropic-ai/claude-code 2.1.261 — `claude auth login`
    claude: [
        'Opening browser to sign in…',
        'If the browser didn\'t open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e'
        + '&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback'
        + '&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code+user%3Amcp_servers+user%3Afile_upload'
        + '&code_challenge=6OJCj2tSJat13o5058vEGjcqQdpIBJuPdUws5g65KcY&code_challenge_method=S256&state=BoVBE4FvBpYunpQwo9mk20p4XdWpbkntdEZ_BjLLfPQ',
        'Paste code here if prompted >',
    ].join('\n'),
    // Grok 1.0.46 (x.ai/cli/install.sh) — `grok login --device-auth`
    grok: [
        'To sign in, open this URL in your browser:',
        '  https://accounts.x.ai/oauth2/device?user_code=S3DF-WCAM',
        '  (Could not open browser automatically — open the URL above manually.)',
        'Confirm this code in your browser:',
        '  S3DF-WCAM',
        'Only continue with a code you requested. Don\'t share it with anyone.',
        'Waiting for authorization...',
    ].join('\n'),
    // @github/copilot 1.0.91 — `copilot login --device-code`
    copilot: [
        'To authenticate, visit https://github.com/login/device and enter code 3AA4-2306',
        'Waiting for authorization...',
        'Failed to open browser. Please visit https://github.com/login/device and enter the code 3AA4-2306 manually.',
    ].join('\n'),
    // opencode-ai 1.18.28 — `opencode auth login -p openai -m 'ChatGPT Pro/Plus (headless)'`
    opencode: [
        '┌  Add credential',
        '│',
        '●  Go to: https://auth.openai.com/codex/device',
        '│',
        '●  Enter code: CYSI-G0C2B',
        '│',
        '◒  Waiting for authorization',
    ].join('\n'),
    // cursor-agent 2026.10.01-e373342 — `NO_OPEN_BROWSER=1 cursor-agent login`
    cursor: [
        'Starting login process...',
        'Authenticating with Cursor...',
        'Waiting for browser authentication...',
        'Open a browser and navigate to this link: https://cursor.com/loginDeepControl?challenge=vPXos56J_0ebtIhdBWOZMoGz182KSi81qWOTReXsA-0'
        + '&uuid=c3f765db-62db-4432-99e6-a169b16cecba&mode=login&redirectTarget=cli&supportsSelectedTeamLogin=true',
        'Press q to show a QR code to log in from another device.',
    ].join('\n'),
    // @gitlawb/openclaude 0.31.0 — `openclaude auth login` (banner trimmed)
    openclaude: [
        'openclaude v0.31.0',
        'Opening browser to sign in…',
        'If the browser didn\'t open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e'
        + '&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback',
        'Paste code here if prompted >',
    ].join('\n'),
    // hermes-agent 0.19.0 — `hermes auth add nous --type oauth --no-browser`
    hermes: [
        'Starting Hermes login via Nous Portal...',
        'Portal: https://portal.nousresearch.com',
        'To continue:',
        '  1. Open: https://portal.nousresearch.com/manage-subscription?user_code=WLL7-R8DW',
        '  2. If prompted, enter code: WLL7-R8DW',
        'Waiting for approval (polling every 1s)...',
    ].join('\n'),
    // @google/gemini-cli 0.62.0 — the Antigravity Connect command (`oauth-personal` + `NO_BROWSER=true gemini`)
    antigravity: [
        'Please visit the following URL to authorize the application:',
        'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fcodeassist.google.com%2Fauthcode&access_type=offline'
        + '&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcloud-platform&response_type=code',
        'Enter the authorization code:',
    ].join('\n'),
};

/** What the dialog must offer for each captured output. */
const EXPECTED_CHALLENGES: Readonly<Record<string, Omit<QaapAgentAuthLoginChallenge, 'mode'> & { readonly urlPrefix: string }>> = {
    codex: { urlPrefix: 'https://auth.openai.com/codex/device', userCode: 'CZ6N-DCWVI' },
    claude: { urlPrefix: 'https://claude.com/cai/oauth/authorize?code=true', codeEntry: true },
    grok: { urlPrefix: 'https://accounts.x.ai/oauth2/device?user_code=S3DF-WCAM', userCode: 'S3DF-WCAM' },
    copilot: { urlPrefix: 'https://github.com/login/device', userCode: '3AA4-2306' },
    opencode: { urlPrefix: 'https://auth.openai.com/codex/device', userCode: 'CYSI-G0C2B' },
    cursor: { urlPrefix: 'https://cursor.com/loginDeepControl?challenge=' },
    openclaude: { urlPrefix: 'https://claude.com/cai/oauth/authorize?code=true', codeEntry: true },
    hermes: { urlPrefix: 'https://portal.nousresearch.com/manage-subscription?user_code=WLL7-R8DW', userCode: 'WLL7-R8DW' },
    antigravity: { urlPrefix: 'https://accounts.google.com/o/oauth2/v2/auth?', codeEntry: true },
};

/**
 * The connect path of every registered harness. A new harness fails the guard below until it
 * gets an entry here (and, for a CLI login, a captured output above).
 */
const EXPECTED_CONNECT_PATHS: Readonly<Record<string, QaapAgentConnectionFlow['kind']>> = {
    qaiq: 'settings-api-key',
    codex: 'cli-login',
    claude: 'cli-login',
    openclaude: 'cli-login',
    grok: 'cli-login',
    opencode: 'cli-login',
    hermes: 'cli-login',
    openclaw: 'tenant-terminal',
    cursor: 'cli-login',
    antigravity: 'cli-login',
    copilot: 'cli-login',
    qwen: 'tenant-terminal',
    kimi: 'tenant-terminal',
};

describe('harness connect paths', () => {
    afterEach(() => rememberQaapHostedRuntime(false));

    it('gives every registered harness a defined connect path', () => {
        for (const harness of QAAP_HARNESS_DEFINITIONS) {
            const expected = EXPECTED_CONNECT_PATHS[harness.id];
            expect(expected, `${harness.id} has no connect path: add it to EXPECTED_CONNECT_PATHS`).to.not.equal(undefined);
            expect(resolveAgentConnectionFlow(harness.id).kind, harness.id).to.equal(expected);
        }
    });

    it('backs every CLI login with real captured output that yields a link or a code', () => {
        for (const harness of QAAP_HARNESS_DEFINITIONS) {
            if (resolveAgentConnectionFlow(harness.id).kind !== 'cli-login') {
                continue;
            }
            const output = CAPTURED_LOGIN_OUTPUT[harness.id];
            expect(output, `${harness.id} runs a CLI login without a captured output in CAPTURED_LOGIN_OUTPUT`).to.be.a('string');
            const challenge = extractAgentAuthLoginChallenge(output, { preferMode: 'session', agentId: harness.id });
            expect(challenge?.url ?? challenge?.userCode, harness.id).to.be.a('string');
        }
    });

    it('signs the Gemini alias in with Google like Antigravity: only QAIQ uses an API key', () => {
        expect(resolveAgentConnectionFlow('gemini')).to.deep.equal(resolveAgentConnectionFlow('antigravity'));
        expect(resolveAgentConnectionFlow('gemini').kind).to.equal('cli-login');
    });

    it('keeps Cursor behind the hosted-runtime policy with explicit instructions', () => {
        rememberQaapHostedRuntime(true);
        expect(resolveAgentConnectionFlow('cursor').kind).to.equal('hosted-restricted');
    });
});

describe('harness login commands', () => {
    const commands: Readonly<Record<string, string>> = {
        codex: 'codex login --device-auth',
        claude: 'claude auth login',
        grok: 'grok login --device-auth',
        copilot: 'copilot login --device-code',
        opencode: 'opencode auth login -p openai -m \'ChatGPT Pro/Plus (headless)\'',
        cursor: process.platform === 'win32'
            ? '$env:NO_OPEN_BROWSER=\'1\'; cursor-agent login'
            : 'NO_OPEN_BROWSER=1 cursor-agent login',
        openclaude: 'openclaude auth login',
        hermes: 'hermes auth add nous --type oauth --no-browser',
    };
    for (const [agentId, command] of Object.entries(commands)) {
        it(`runs the verified headless login for ${agentId}`, () => {
            expect(resolveAgentConnectionFlow(agentId)).to.deep.equal({ kind: 'cli-login', command });
        });
    }
});

describe('harness login challenge parsing (captured output)', () => {
    for (const [agentId, expected] of Object.entries(EXPECTED_CHALLENGES)) {
        it(`extracts what the ${agentId} dialog needs`, () => {
            const challenge = extractAgentAuthLoginChallenge(CAPTURED_LOGIN_OUTPUT[agentId], { preferMode: 'session', agentId });
            expect(challenge?.mode).to.equal('session');
            expect(challenge?.url?.startsWith(expected.urlPrefix), `${agentId}: ${challenge?.url}`).to.equal(true);
            expect(challenge?.userCode).to.equal(expected.userCode);
            expect(!!challenge?.codeEntry, `${agentId} codeEntry`).to.equal(!!expected.codeEntry);
            expect(isAgentLoginSuccessOutput(CAPTURED_LOGIN_OUTPUT[agentId]), `${agentId} is not connected yet`).to.equal(false);
        });
    }

    it('asks for the pasted code on the Gemini CLI NO_BROWSER prompt', () => {
        const challenge = extractAgentAuthLoginChallenge([
            'Please visit the following URL to authorize the application:',
            'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fcodeassist.google.com%2Fauthcode&access_type=offline&response_type=code',
            'Enter the authorization code:',
        ].join('\n'), { preferMode: 'session', agentId: 'gemini' });
        expect(challenge?.url?.startsWith('https://accounts.google.com/o/oauth2/v2/auth')).to.equal(true);
        expect(challenge?.codeEntry).to.equal(true);
    });

    it('never trusts a login host for a different harness', () => {
        expect(extractAgentAuthLoginChallenge(CAPTURED_LOGIN_OUTPUT.grok, { agentId: 'claude' })?.url).to.equal(undefined);
        expect(extractAgentAuthLoginChallenge(CAPTURED_LOGIN_OUTPUT.claude, { agentId: 'codex' })?.url).to.equal(undefined);
        expect(extractAgentAuthLoginChallenge('visit https://claude.com.evil.example/cai/oauth/authorize', { agentId: 'claude' })?.url)
            .to.equal(undefined);
    });

    it('recognizes completed logins but not waiting prompts', () => {
        expect(isAgentLoginSuccessOutput('Login successful.')).to.equal(true);
        expect(isAgentLoginSuccessOutput('Successfully logged in')).to.equal(true);
        expect(isAgentLoginSuccessOutput('Signed in as octocat')).to.equal(true);
        expect(isAgentLoginSuccessOutput('Waiting for authorization...')).to.equal(false);
        expect(isAgentLoginSuccessOutput('Not logged in. Please run /login')).to.equal(false);
    });
});

describe('Connect terminal wrapper', () => {
    it('widens the PTY, prepends the per-user install and prints an exit marker', () => {
        const command = buildAgentLoginShellCommand('grok login --device-auth', { cliBinDirectory: '/data/qaap-cli/bin' });
        expect(command).to.equal(
            'stty cols 500 rows 50 2>/dev/null; PATH=\'/data/qaap-cli/bin\':"$PATH"; export PATH; grok login --device-auth; echo "QAAP_LOGIN_EXIT:$?"',
        );
    });

    it('reads the exit code only from the real marker, never from the echoed command', () => {
        const echoed = 'grok login --device-auth; echo "QAAP_LOGIN_EXIT:$?"';
        expect(parseAgentLoginExitMarker(echoed)).to.equal(undefined);
        expect(parseAgentLoginExitMarker(`${echoed}\nboom\nQAAP_LOGIN_EXIT:7`)).to.equal(7);
        expect(stripAgentLoginShellEcho(`${echoed}\nboom\nQAAP_LOGIN_EXIT:7`)).to.equal('boom');
    });
});
