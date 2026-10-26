// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    materializeQaapPreviewLaunchPlan,
    parseQaapPreviewLaunchConfig,
    QAAP_PREVIEW_READY_TIMEOUT_MAX_MS,
    readyTimeoutProbeAttempts,
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

    it('applies a finite positive readyTimeoutMs and clamps it to the maximum', () => {
        const base = { runtime: 'custom', command: 'node', args: [], port: 3000 };
        const parsed = parseQaapPreviewLaunchConfig({ ...base, readyTimeoutMs: 180_000 });
        expect(parsed.ok && parsed.plan.readyTimeoutMs).to.equal(180_000);
        const clamped = parseQaapPreviewLaunchConfig({ ...base, readyTimeoutMs: 99_999_999 });
        expect(clamped.ok && clamped.plan.readyTimeoutMs).to.equal(QAAP_PREVIEW_READY_TIMEOUT_MAX_MS);
        expect(QAAP_PREVIEW_READY_TIMEOUT_MAX_MS).to.equal(600_000);
    });

    it('ignores readyTimeoutMs values that are not finite positive numbers', () => {
        const base = { runtime: 'custom', command: 'node', args: [], port: 3000 };
        for (const readyTimeoutMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, '120000', true]) {
            const parsed = parseQaapPreviewLaunchConfig({ ...base, readyTimeoutMs });
            expect(parsed.ok, String(readyTimeoutMs)).to.equal(true);
            expect(parsed.ok && 'readyTimeoutMs' in parsed.plan, String(readyTimeoutMs)).to.equal(false);
        }
        const absent = parseQaapPreviewLaunchConfig(base);
        expect(absent.ok && 'readyTimeoutMs' in absent.plan).to.equal(false);
    });

    it('converts the ready wait into probe attempts at the probe interval', () => {
        expect(readyTimeoutProbeAttempts(30_000, 500)).to.equal(61);
        expect(readyTimeoutProbeAttempts(180_000, 500)).to.equal(361);
        expect(readyTimeoutProbeAttempts(1, 500)).to.equal(1);
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
