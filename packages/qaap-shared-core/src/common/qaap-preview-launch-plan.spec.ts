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

    it('renders Windows custom launches through an encoded argv-safe PowerShell call', () => {
        const plan = {
            version: 1 as const,
            runtime: 'custom' as const,
            cwd: '.',
            command: 'node',
            args: ['node_modules/next/dist/bin/next', 'dev', '--message', 'a & b', '{{PORT}}'],
            port: 3000,
        };
        const rendered = renderQaapPreviewLaunchCommand(plan, 'win32');
        const encodedCommand = rendered.match(/^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$/)?.[1];
        expect(encodedCommand).to.be.a('string');
        const script = Buffer.from(encodedCommand!, 'base64').toString('utf16le');
        const encodedPayload = script.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)?.[1];
        expect(encodedPayload).to.be.a('string');
        expect(JSON.parse(Buffer.from(encodedPayload!, 'base64').toString('utf8'))).to.deep.equal({
            command: 'node',
            args: ['node_modules/next/dist/bin/next', 'dev', '--message', 'a & b', '{{PORT}}'],
        });
        expect(script).to.include(".Replace('{{PORT}}', $port)");
        expect(script).to.include('& $plan.command @argv');
        expect(rendered).not.to.include('a & b');
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
