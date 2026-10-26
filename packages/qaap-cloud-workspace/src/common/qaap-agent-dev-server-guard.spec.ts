// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildDevServerShellDenyMessage, findQaiqDevServerGuardDenial, isLongLivedDevServerShellCommand } from './qaap-agent-dev-server-guard';
import type { QaapQaiqPendingControlRequest } from './qaap-qaiq-stdio-approvals';

describe('qaap-agent-dev-server-guard', () => {

    it('blocks long-lived dev server commands, including background variants', () => {
        const blocked = [
            'pnpm dev',
            'npm run dev',
            'npm start',
            'yarn serve',
            'bun run preview',
            'nohup pnpm dev > /tmp/vite.log 2>&1 &',
            'cd packages/app && pnpm dev',
            'npx vite',
            'npx next dev -p 3001',
            'vite --port 5175',
            'pnpm install && pnpm dev',
        ];
        for (const command of blocked) {
            expect(isLongLivedDevServerShellCommand(command), command).to.equal(true);
        }
    });

    it('allows one-shot commands that merely look like dev tooling', () => {
        const allowed = [
            'pnpm install',
            'pnpm build',
            'npm run build',
            'npx vite build',
            'npx next build',
            'pnpm run typecheck',
            'npm test',
            'vite --version',
            'echo what is next',
            'git status',
            'tail -20 /tmp/vite.log',
        ];
        for (const command of allowed) {
            expect(isLongLivedDevServerShellCommand(command), command).to.equal(false);
        }
    });

    it('blocks the Qaap restart/start scripts by any path and dev scripts invoked by other package managers', () => {
        const blocked = [
            'node scripts/qaap-restart-browser.mjs',
            './scripts/qaap-restart-browser.mjs --build',
            'node /abs/repo/scripts/qaap-restart-browser.mjs',
            'node scripts/qaap-start-browser.mjs',
            'npm run start:browser',
            'npm run start:browser-only',
            'npm run qaap:local:browser:restart',
            'npx start:browser',
            'pnpm start:browser',
            'yarn start:electron',
            'npm --prefix examples/browser run start:browser',
            'npm run build:browser && npm run start:browser',
            'pnpm build && pnpm dev',
        ];
        for (const command of blocked) {
            expect(isLongLivedDevServerShellCommand(command), command).to.equal(true);
        }
    });

    it('blocks detached server launches (nohup, setsid, disown, subshell background)', () => {
        const blocked = [
            'setsid node server.js --serve',
            'node app.js dev & disown',
            '(npm run dev) &',
            '( vite preview ) &',
            'nohup node server.js start > /tmp/s.log 2>&1 &',
        ];
        for (const command of blocked) {
            expect(isLongLivedDevServerShellCommand(command), command).to.equal(true);
        }
    });

    it('allows the verification and one-shot commands that must keep working', () => {
        const allowed = [
            'npm run compile',
            'npm test',
            'node scripts/qaap-drift-check.js',
            'node scripts/qaap-package-graph-check.js',
            'npm run build:browser',
            'npm run build:browser && npm run lint',
            'tail -f /tmp/build.log &',
            'nohup tail -f /tmp/build.log &',
            'cat scripts/qaap-restart-browser.mjs',
        ];
        for (const command of allowed) {
            expect(isLongLivedDevServerShellCommand(command), command).to.equal(false);
        }
    });

    it('denies shell control requests launching dev servers, with actionable guidance', () => {
        const denial = findQaiqDevServerGuardDenial({
            requestId: 'r1',
            toolName: 'Bash',
            toolInput: { command: 'nohup pnpm dev &' },
        });
        expect(denial).to.be.a('string');
        expect(denial).to.contain('the Preview tab reports the real one');
    });

    it('lets non-shell tools and one-shot shell commands through', () => {
        expect(findQaiqDevServerGuardDenial({
            requestId: 'r2',
            toolName: 'Edit',
            toolInput: { command: 'pnpm dev' },
        })).to.equal(undefined);
        expect(findQaiqDevServerGuardDenial({
            requestId: 'r3',
            toolName: 'Bash',
            toolInput: { command: 'pnpm build' },
        })).to.equal(undefined);
    });
});

describe('buildDevServerShellDenyMessage', () => {
    it('does not promise a preview Qaap may not be able to start', () => {
        const message = buildDevServerShellDenyMessage();
        expect(message).to.not.include('will start the server and open the preview automatically');
        expect(message).to.include('.qaap/preview.json');
        expect(message).to.not.include('localhost');
    });

    it('does not prime the agent with an example port to report', () => {
        expect(buildDevServerShellDenyMessage()).to.not.match(/5173/);
    });

    it('tells the agent the reserved port Qaap owns instead of asking it to guess one', () => {
        const message = buildDevServerShellDenyMessage({ reservedPort: 5174 });
        expect(message).to.include('port 5174');
        expect(message).to.include('do not report any other port');
        expect(message).to.not.match(/5173/);
        expect(message).to.not.include('state the expected');
    });
});

describe('findQaiqDevServerGuardDenial with a reserved preview port', () => {
    const request: QaapQaiqPendingControlRequest = {
        requestId: 'r1',
        toolUseId: 't1',
        toolName: 'Bash',
        toolInput: { command: 'npm run dev -- --host 0.0.0.0 --port 5173' },
    };

    it('passes the reserved port into the deny message sent back to the agent', () => {
        const denial = findQaiqDevServerGuardDenial(request, { reservedPort: 5174 });
        expect(denial).to.include('port 5174');
        expect(denial).to.not.match(/port 5173/);
    });

    it('keeps the generic deny message when no port is known', () => {
        expect(findQaiqDevServerGuardDenial(request)).to.equal(buildDevServerShellDenyMessage());
    });
});
