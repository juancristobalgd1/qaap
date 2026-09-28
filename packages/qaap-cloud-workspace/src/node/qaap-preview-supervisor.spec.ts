// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { buildQaapPreviewScriptCommand } from './qaap-preview-supervisor';

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
