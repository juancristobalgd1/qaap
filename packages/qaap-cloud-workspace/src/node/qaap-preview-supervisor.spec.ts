// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildQaapPreviewProcessEnv, buildQaapPreviewScriptCommand, QaapPreviewSupervisor } from './qaap-preview-supervisor';

describe('buildQaapPreviewScriptCommand', () => {
    it('runs Windows package-manager shims through cmd.exe', () => {
        const command = buildQaapPreviewScriptCommand('pnpm', 'dev', 'win32');

        expect(command.command.toLowerCase()).to.match(/(?:cmd\.exe|\\cmd)$/);
        expect(command.args).to.deep.equal(['/d', '/s', '/c', 'pnpm run dev']);
    });

    it('keeps POSIX package-manager startup as shell-free argv', () => {
        expect(buildQaapPreviewScriptCommand('pnpm', 'dev', 'linux')).to.deep.equal({
            command: 'pnpm',
            args: ['run', 'dev'],
        });
    });
});

describe('buildQaapPreviewProcessEnv', () => {
    it('pins the supervised dev server to its reserved port like the frontend bootstrap', () => {
        const env = buildQaapPreviewProcessEnv({ PATH: '/bin', NODE_OPTIONS: '--max-old-space-size=512' }, 5174);

        expect(env.PATH).to.equal('/bin');
        expect(env.PORT).to.equal('5174');
        expect(env.QAAP_PREVIEW_PORT).to.equal('5174');
        expect(env.BROWSER).to.equal('none');
        const [kept, preload] = env.NODE_OPTIONS!.split(' ');
        expect(kept).to.equal('--max-old-space-size=512');
        const source = Buffer.from(preload.replace('--import=data:text/javascript;base64,', ''), 'base64').toString('utf8');
        expect(source).to.contain('QAAP_PREVIEW_PORT');
        expect(source).to.contain('--strictPort');
    });
});

describe('QaapPreviewSupervisor shutdown', () => {
    class TestSupervisor extends QaapPreviewSupervisor {
        addLiveChild(key: string): string[] {
            const signals: string[] = [];
            const child = { exitCode: null, kill: (signal: string) => { signals.push(signal); return true; } };
            this.records.set(key, { key, child } as never);
            return signals;
        }
        cleanup(): void {
            this.registerCleanup();
        }
    }

    it('leaves SIGINT/SIGTERM to Theia graceful shutdown instead of exiting the process', () => {
        const before = { sigint: process.listenerCount('SIGINT'), sigterm: process.listenerCount('SIGTERM') };
        const exitListeners = process.listeners('exit');
        const supervisor = new TestSupervisor();
        supervisor.cleanup();
        try {
            expect(process.listenerCount('SIGINT')).to.equal(before.sigint);
            expect(process.listenerCount('SIGTERM')).to.equal(before.sigterm);
        } finally {
            for (const listener of process.listeners('exit')) {
                if (!exitListeners.includes(listener)) {
                    process.removeListener('exit', listener);
                }
            }
        }
    });

    it('kills live dev servers from onStop', () => {
        const supervisor = new TestSupervisor();
        const signals = supervisor.addLiveChild('preview-a');
        supervisor.onStop();
        expect(signals).to.deep.equal(['SIGTERM']);
    });
});
