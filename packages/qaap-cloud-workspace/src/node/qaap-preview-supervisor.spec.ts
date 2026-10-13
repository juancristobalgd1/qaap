// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildQaapPreviewProcessEnv, buildQaapPreviewScriptCommand } from './qaap-preview-supervisor';

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
