// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    materializeQaapPreviewLaunchPlan,
    parseQaapPreviewLaunchConfig,
    renderQaapPreviewLaunchCommand,
} from './qaap-preview-launch-plan';

describe('Qaap preview launch plan', () => {
    it('parses an argv-shaped Python preview and materializes its allocated port', () => {
        const parsed = parseQaapPreviewLaunchConfig({
            version: 1,
            runtime: 'python',
            name: 'Docs',
            cwd: 'services/docs',
            command: 'python3',
            args: ['-m', 'http.server', '{{PORT}}'],
            port: 8000,
        });
        expect(parsed.ok).to.equal(true);
        if (!parsed.ok) {
            return;
        }
        expect(materializeQaapPreviewLaunchPlan(parsed.plan, 8001)).to.deep.equal({
            command: 'python3', args: ['-m', 'http.server', '8001'],
        });
        expect(renderQaapPreviewLaunchCommand(parsed.plan)).to.equal(
            "'python3' '-m' 'http.server' '{{PORT}}'",
        );
    });

    it('rejects cwd traversal and shell-shaped executable tokens', () => {
        expect(parseQaapPreviewLaunchConfig({
            runtime: 'custom', cwd: '../outside', command: 'python3', args: [], port: 8000,
        }).ok).to.equal(false);
        expect(parseQaapPreviewLaunchConfig({
            runtime: 'custom', command: 'python3;touch /tmp/pwned', args: [], port: 8000,
        }).ok).to.equal(false);
        expect(parseQaapPreviewLaunchConfig({
            runtime: 'custom', command: 'python3', args: ['ok\nmalicious'], port: 8000,
        }).ok).to.equal(false);
    });
});
