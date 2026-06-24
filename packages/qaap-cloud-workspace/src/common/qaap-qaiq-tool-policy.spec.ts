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

    it('formats core coding tools without network by default', () => {
        expect(formatQaiqCoreToolsFlag()).to.equal(
            '--tools Read,Write,Edit,Bash,Grep,Glob,NotebookEdit,TodoWrite',
        );
        expect(resolveQaiqCoreToolNames()).to.not.include('WebSearch');
    });

    it('adds network tools when network is enabled', () => {
        expect(resolveQaiqCoreToolNames({ network: true })).to.include.members(['WebFetch', 'WebSearch']);
    });

    it('parses --tools from a spawned command', () => {
        const tools = parseQaiqCoreTools('qaiq --tools Read,Write,Edit --print -p hi');
        expect(tools?.has('Read')).to.equal(true);
        expect(tools?.has('Agent')).to.equal(false);
    });

    it('omits Bash when shell is disabled in the core tool list', () => {
        expect(formatQaiqCoreToolsFlag({ shell: false })).to.equal(
            '--tools Read,Write,Edit,Grep,Glob,NotebookEdit,TodoWrite',
        );
    });

    it('blocks delegation and Theia Coder tools', () => {
        expect(isBlockedHeadlessTool('Agent')).to.equal(true);
        expect(isBlockedHeadlessTool('TaskCreate')).to.equal(true);
        expect(isBlockedTheiaTool('qaap_bootstrap_install')).to.equal(true);
        expect(isBlockedTheiaTool('getWorkspaceFileList')).to.equal(true);
        expect(isBlockedTheiaTool('mcp__theia__runTask')).to.equal(true);
        expect(isBlockedHeadlessTool('Read')).to.equal(false);
    });
});
