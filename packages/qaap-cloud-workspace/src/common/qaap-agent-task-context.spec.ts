// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    prependAgentTaskContextToPrompt,
    truncateProjectInfo,
    QAAP_TASK_CONTEXT_MARKER,
    QAAP_PROJECT_INFO_TRUNCATION_NOTICE,
    QAAP_REPO_CONTENT_BOUNDARY_NOTE,
} from './qaap-agent-task-context';

describe('prependAgentTaskContextToPrompt', () => {
    it('returns the prompt unchanged when no context is provided', () => {
        expect(prependAgentTaskContextToPrompt('Fix the bug')).to.equal('Fix the bug');
        expect(prependAgentTaskContextToPrompt('Fix the bug', '  ', '')).to.equal('Fix the bug');
    });

    it('prepends global context when present', () => {
        const result = prependAgentTaskContextToPrompt('Fix the bug', 'Qaap env context');
        expect(result).to.contain(QAAP_TASK_CONTEXT_MARKER);
        expect(result).to.contain('Qaap env context');
        expect(result.endsWith('Fix the bug')).to.equal(true);
    });

    it('prepends project info under a heading when present', () => {
        const result = prependAgentTaskContextToPrompt('Fix the bug', undefined, 'Uses Vite');
        expect(result).to.contain('# Project context');
        expect(result).to.contain('Uses Vite');
    });

    it('combines global context and project info in order', () => {
        const result = prependAgentTaskContextToPrompt('Do it', 'GLOBAL', 'PROJECT');
        expect(result.indexOf('GLOBAL')).to.be.lessThan(result.indexOf('PROJECT'));
        expect(result.indexOf('PROJECT')).to.be.lessThan(result.indexOf('Do it'));
    });

    it('is idempotent — does not stack context when the marker is already present', () => {
        const once = prependAgentTaskContextToPrompt('Do it', 'GLOBAL');
        const twice = prependAgentTaskContextToPrompt(once, 'GLOBAL');
        expect(twice).to.equal(once);
    });

    it('prepends repository agent instructions and repo map under headings', () => {
        const result = prependAgentTaskContextToPrompt('Do it', undefined, undefined, {
            agentInstructions: 'Use 4 spaces.',
            repoMap: 'src/\n  index.ts',
        });
        expect(result).to.contain('# Repository agent instructions');
        expect(result).to.contain('Use 4 spaces.');
        expect(result).to.contain('# Repository map');
        expect(result).to.contain('src/');
    });

    it('orders project info before agent instructions before repo map before the task', () => {
        const result = prependAgentTaskContextToPrompt('THE-TASK', undefined, 'PROJECT', {
            agentInstructions: 'RULES',
            repoMap: 'TREE',
        });
        expect(result.indexOf('PROJECT')).to.be.lessThan(result.indexOf('RULES'));
        expect(result.indexOf('RULES')).to.be.lessThan(result.indexOf('TREE'));
        expect(result.indexOf('TREE')).to.be.lessThan(result.indexOf('THE-TASK'));
    });

    it('adds no repo-context headings when the sources are empty', () => {
        const result = prependAgentTaskContextToPrompt('Do it', 'GLOBAL', undefined, { agentInstructions: '  ', repoMap: '' });
        expect(result).to.not.contain('# Repository');
    });

    it('prepends the instruction-source boundary note before any workspace-derived section', () => {
        const result = prependAgentTaskContextToPrompt('Do it', 'GLOBAL', undefined, { agentInstructions: 'RULES' });
        expect(result).to.contain(QAAP_REPO_CONTENT_BOUNDARY_NOTE);
        expect(result.indexOf('GLOBAL')).to.be.lessThan(result.indexOf(QAAP_REPO_CONTENT_BOUNDARY_NOTE));
        expect(result.indexOf(QAAP_REPO_CONTENT_BOUNDARY_NOTE)).to.be.lessThan(result.indexOf('RULES'));
    });

    it('omits the boundary note when only trusted global context is present', () => {
        const result = prependAgentTaskContextToPrompt('Do it', 'GLOBAL');
        expect(result).to.not.contain(QAAP_REPO_CONTENT_BOUNDARY_NOTE);
    });

    it('prepends the git status snapshot and repo memory under headings', () => {
        const result = prependAgentTaskContextToPrompt('Do it', undefined, undefined, {
            gitStatus: 'Branch: main\n\nWorking tree: clean',
            repoMemory: '- always run npm run compile first',
        });
        expect(result).to.contain('# Git status');
        expect(result).to.contain('Branch: main');
        expect(result).to.contain('# Repository memory (.qaap/memory.md)');
        expect(result).to.contain('always run npm run compile first');
    });

    it('orders memory before repo map before git status before the task', () => {
        const result = prependAgentTaskContextToPrompt('THE-TASK', undefined, undefined, {
            repoMemory: 'MEMORY',
            repoMap: 'TREE',
            gitStatus: 'GIT-SNAPSHOT',
        });
        expect(result.indexOf('MEMORY')).to.be.lessThan(result.indexOf('TREE'));
        expect(result.indexOf('TREE')).to.be.lessThan(result.indexOf('GIT-SNAPSHOT'));
        expect(result.indexOf('GIT-SNAPSHOT')).to.be.lessThan(result.indexOf('THE-TASK'));
    });
});

describe('truncateProjectInfo', () => {
    it('returns the text unchanged when within budget', () => {
        const text = 'line one\n\nline two';
        expect(truncateProjectInfo(text, 1000)).to.equal(text);
    });

    it('stays within the budget when truncating', () => {
        const text = Array.from({ length: 200 }, (_, i) => `paragraph ${i}`).join('\n\n');
        const result = truncateProjectInfo(text, 100);
        expect(result.length).to.be.at.most(100);
    });

    it('does not cut in the middle of a word', () => {
        // 30 ten-char words on separate lines; budget lands mid-word without boundary handling.
        const text = Array.from({ length: 30 }, () => 'abcdefghij').join('\n');
        const result = truncateProjectInfo(text, 45);
        const body = result.slice(0, -QAAP_PROJECT_INFO_TRUNCATION_NOTICE.length);
        // Every retained line is a whole 10-char word, so the body length is a multiple of 11 minus 1.
        expect(body.split('\n').every(line => line === 'abcdefghij')).to.equal(true);
    });

    it('appends a truncation notice so the agent knows content was dropped', () => {
        const text = 'first paragraph\n\nsecond paragraph\n\nthird paragraph';
        const result = truncateProjectInfo(text, 45);
        expect(result.endsWith(QAAP_PROJECT_INFO_TRUNCATION_NOTICE)).to.equal(true);
        expect(result).to.contain('first paragraph');
    });

    it('cuts at a line boundary', () => {
        const text = `alpha\nbeta\n${'g'.repeat(40)}`;
        const result = truncateProjectInfo(text, 40);
        const body = result.slice(0, -QAAP_PROJECT_INFO_TRUNCATION_NOTICE.length);
        expect(body).to.equal('alpha\nbeta');
    });
});
