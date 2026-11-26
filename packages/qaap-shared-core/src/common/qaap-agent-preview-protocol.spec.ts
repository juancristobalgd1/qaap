// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isQaapAgentPreviewToolCall,
    isQaapAgentPreviewToolsEnabled,
    isQaapPreviewServiceEnabled,
    parseQaapPreviewLogsRequest,
    parseQaapPreviewSnapshotRequest,
    parseQaapPreviewStartRequest,
    parseQaapPreviewStatusRequest,
    parseQaapPreviewStopRequest,
    qaapAgentPreviewMcpOperation,
} from './qaap-agent-preview-protocol';

const SERVER = 'qaaq_0123456789abcdef';

describe('qaap-agent-preview-protocol', () => {
    describe('switches', () => {
        it('keeps both off by default; the agent tools imply the service', () => {
            expect(isQaapAgentPreviewToolsEnabled({})).to.equal(false);
            expect(isQaapPreviewServiceEnabled({})).to.equal(false);
            expect(isQaapPreviewServiceEnabled({ QAAP_PREVIEW_SERVICE: 'on' })).to.equal(true);
            expect(isQaapAgentPreviewToolsEnabled({ QAAP_AGENT_PREVIEW_TOOLS: '1' })).to.equal(true);
            expect(isQaapPreviewServiceEnabled({ QAAP_AGENT_PREVIEW_TOOLS: 'true' })).to.equal(true);
            expect(isQaapAgentPreviewToolsEnabled({ QAAP_AGENT_PREVIEW_TOOLS: '0' })).to.equal(false);
        });
    });

    describe('tool names', () => {
        it('matches the preview tools of exactly the task\'s server, in every harness spelling', () => {
            expect(qaapAgentPreviewMcpOperation(`mcp__${SERVER}__preview_start`, SERVER)).to.equal('start');
            expect(qaapAgentPreviewMcpOperation(`${SERVER}_preview_snapshot`, SERVER)).to.equal('snapshot');
            expect(isQaapAgentPreviewToolCall(`mcp__${SERVER}__preview_logs`, SERVER)).to.equal(true);
        });

        it('rejects other servers, delegation tools and lookalikes', () => {
            expect(isQaapAgentPreviewToolCall('mcp__qaaq_ffffffffffffffff__preview_start', SERVER)).to.equal(false);
            expect(isQaapAgentPreviewToolCall(`mcp__${SERVER}__qaaq_delegate`, SERVER)).to.equal(false);
            expect(isQaapAgentPreviewToolCall('mcp__qaaq__preview_start', 'qaaq')).to.equal(false);
            expect(isQaapAgentPreviewToolCall(`mcp__${SERVER}__preview_start`, undefined)).to.equal(false);
            expect(isQaapAgentPreviewToolCall(`mcp__${SERVER}__preview_startx`, SERVER)).to.equal(false);
        });
    });

    describe('parseQaapPreviewStartRequest', () => {
        it('accepts an empty body and a full valid one', () => {
            expect(parseQaapPreviewStartRequest(undefined)).to.deep.equal({ ok: true, value: {} });
            const parsed = parseQaapPreviewStartRequest({
                cwd: 'apps/web', argv: ['node', 'server.js', '--port', '{{PORT}}'], port: 5173,
                readyPath: '/health', timeoutSec: 120, env: { VITE_API_URL: 'http://x' }, restart: true,
            });
            expect(parsed.ok).to.equal(true);
        });

        it('rejects shell strings, script+argv, bad ports and unknown fields', () => {
            expect(parseQaapPreviewStartRequest({ argv: ['npm run dev'] }).ok).to.equal(false);
            expect(parseQaapPreviewStartRequest({ argv: [] }).ok).to.equal(false);
            expect(parseQaapPreviewStartRequest({ argv: ['node', 'a\nb'] }).ok).to.equal(false);
            expect(parseQaapPreviewStartRequest({ script: 'dev', argv: ['node'] }).ok).to.equal(false);
            expect(parseQaapPreviewStartRequest({ script: 'dev && rm -rf /' }).ok).to.equal(false);
            expect(parseQaapPreviewStartRequest({ port: 80 }).ok).to.equal(false);
            expect(parseQaapPreviewStartRequest({ timeoutSec: 1000 }).ok).to.equal(false);
            expect(parseQaapPreviewStartRequest({ readyPath: 'health' }).ok).to.equal(false);
            expect(parseQaapPreviewStartRequest({ readyPath: '//evil.example' }).ok).to.equal(false);
            expect(parseQaapPreviewStartRequest({ command: 'npm run dev' }).ok).to.equal(false);
        });

        it('refuses env that is Qaap\'s, changes what runs, or looks like a secret', () => {
            for (const key of ['QAAP_TASK_TOKEN', 'PATH', 'NODE_OPTIONS', 'LD_PRELOAD', 'PORT', 'OPENAI_API_KEY', 'GITHUB_TOKEN', 'DB_PASSWORD']) {
                expect(parseQaapPreviewStartRequest({ env: { [key]: 'x' } }).ok, key).to.equal(false);
            }
            expect(parseQaapPreviewStartRequest({ env: { NODE_ENV: 'development', API_URL: 'http://x' } }).ok).to.equal(true);
        });
    });

    describe('other requests', () => {
        it('bounds status waits, log reads and snapshots', () => {
            expect(parseQaapPreviewStatusRequest({ waitSec: 30 })).to.deep.equal({ ok: true, value: { waitSec: 30 } });
            expect(parseQaapPreviewStatusRequest({ waitSec: 999 }).ok).to.equal(false);
            expect(parseQaapPreviewLogsRequest({ lines: 50, stream: 'stderr', grep: 'error' }).ok).to.equal(true);
            expect(parseQaapPreviewLogsRequest({ lines: 5000 }).ok).to.equal(false);
            expect(parseQaapPreviewLogsRequest({ stream: 'both' }).ok).to.equal(false);
            expect(parseQaapPreviewStopRequest({}).ok).to.equal(true);
            expect(parseQaapPreviewStopRequest({ force: true }).ok).to.equal(false);
            expect(parseQaapPreviewSnapshotRequest({ path: '/todos', screenshot: true, viewport: 'mobile', waitMs: 1000 }).ok).to.equal(true);
            expect(parseQaapPreviewSnapshotRequest({ path: 'https://evil.example/' }).ok).to.equal(false);
            expect(parseQaapPreviewSnapshotRequest({ viewport: 'tablet' }).ok).to.equal(false);
        });
    });
});
