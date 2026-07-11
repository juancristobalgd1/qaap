// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    formatQaiqCoreToolsFlag,
    isBlockedHeadlessTool,
    isBlockedTheiaTool,
    parseQaiqCoreTools,
    resolveQaiqCoreToolNames,
} from './qaap-qaiq-tool-policy';

describe('qaap-qaiq-tool-policy', () => {

    it('always includes the read-only web tools in the core allowlist', () => {
        expect(formatQaiqCoreToolsFlag()).to.equal(
            '--tools Read,Write,Edit,Bash,Grep,Glob,NotebookEdit,TodoWrite,Agent,WebFetch,WebSearch',
        );
        expect(resolveQaiqCoreToolNames()).to.include.members(['WebFetch', 'WebSearch']);
    });

    it('keeps the read-only web tools even when shell is disabled', () => {
        expect(resolveQaiqCoreToolNames({ shell: false })).to.include.members(['WebFetch', 'WebSearch']);
    });

    it('parses --tools from a spawned command', () => {
        const tools = parseQaiqCoreTools('qaiq --tools Read,Write,Edit --print -p hi');
        expect(tools?.has('Read')).to.equal(true);
        expect(tools?.has('Agent')).to.equal(false);
    });

    it('omits Bash when shell is disabled in the core tool list', () => {
        expect(formatQaiqCoreToolsFlag({ shell: false })).to.equal(
            '--tools Read,Write,Edit,Grep,Glob,NotebookEdit,TodoWrite,Agent,WebFetch,WebSearch',
        );
    });

    it('blocks delegation and Theia Coder tools', () => {
        // Agent is no longer blocked — it's needed for the verification subagent.
        // Non-verification subagent types are blocked at the stdio control layer.
        expect(isBlockedHeadlessTool('Agent')).to.equal(false);
        expect(isBlockedHeadlessTool('Task')).to.equal(true);
        expect(isBlockedHeadlessTool('TaskCreate')).to.equal(true);
        expect(isBlockedTheiaTool('qaap_bootstrap_install')).to.equal(true);
        expect(isBlockedTheiaTool('getWorkspaceFileList')).to.equal(true);
        expect(isBlockedTheiaTool('mcp__theia__runTask')).to.equal(true);
        expect(isBlockedHeadlessTool('Read')).to.equal(false);
    });
});
