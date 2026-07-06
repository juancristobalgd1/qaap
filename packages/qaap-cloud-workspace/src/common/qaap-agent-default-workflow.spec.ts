// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    appendAgentDefaultWorkflowToPrompt,
    buildAgentDefaultWorkflowPromptBlock,
    buildAgentDevServerVerificationPromptBlock,
    buildAgentHonestReportingPromptBlock,
    buildAgentPlanningPromptBlock,
} from './qaap-agent-default-workflow';

describe('buildAgentDefaultWorkflowPromptBlock', () => {
    it('frames coding work toward PR by default', () => {
        const block = buildAgentDefaultWorkflowPromptBlock();
        expect(block).to.include('reviewable pull request');
        expect(block).to.include('branch');
        expect(block).to.include('verification');
    });
});

describe('appendAgentDefaultWorkflowToPrompt', () => {
    it('prepends the default workflow for agent prompts', () => {
        const result = appendAgentDefaultWorkflowToPrompt('Fix the bug', 'qaiq');
        expect(result).to.include('[QAAP default agent workflow]');
        expect(result).to.include('[QAAP parallel tools]');
        expect(result).to.include('[QAAP dev preview]');
        expect(result).to.include('[QAAP dev server verification]');
        expect(result).to.include('curl -s -o /dev/null');
        expect(result).to.include('[QAAP honest reporting]');
        expect(result).to.include('4/9 checks passed');
        expect(result).to.include('[QAAP benign code edit policy]');
        expect(result).to.include('[QAAP direct execution policy]');
        expect(result).to.include('[QAAP planning]');
        expect(result).to.include('QAIQ is a Claude Code / OpenClaude CLI');
        expect(result).to.include('not the in-browser Theia Coder agent');
        expect(result).to.include('do not refuse with a report-only workaround');
        expect(result).to.include('Fix the bug');
    });

    it('leaves shell commands unchanged', () => {
        expect(appendAgentDefaultWorkflowToPrompt('npm test', 'shell')).to.equal('npm test');
    });

    it('does not duplicate the workflow block', () => {
        const once = appendAgentDefaultWorkflowToPrompt('Fix the bug', 'codex');
        const twice = appendAgentDefaultWorkflowToPrompt(once, 'codex');
        expect(twice).to.equal(once);
    });

    it('omits git workflow steps when git is unavailable', () => {
        const block = buildAgentDefaultWorkflowPromptBlock({ gitAvailable: false });
        expect(block).to.include('not be a git repository');
        expect(block).not.to.include('inspect git status');
    });
});

describe('buildAgentPlanningPromptBlock', () => {
    it('tells the agent to use TodoWrite for multi-step tasks', () => {
        const block = buildAgentPlanningPromptBlock();
        expect(block).to.include('[QAAP planning]');
        expect(block).to.include('TodoWrite');
        expect(block).to.include('three or more steps');
        expect(block).to.include('one item in_progress at a time');
    });
});

describe('buildAgentDevServerVerificationPromptBlock', () => {
    it('requires curl verification before reporting a URL', () => {
        const block = buildAgentDevServerVerificationPromptBlock();
        expect(block).to.include('[QAAP dev server verification]');
        expect(block).to.include('curl -s -o /dev/null');
        expect(block).to.include('never report a URL you have not confirmed');
        expect(block).to.include('Partial output from a killed or timed-out process');
        expect(block).to.include('no package.json in the root');
    });
});

describe('buildAgentHonestReportingPromptBlock', () => {
    it('requires exact check counts and forbids "ready to validate"', () => {
        const block = buildAgentHonestReportingPromptBlock();
        expect(block).to.include('[QAAP honest reporting]');
        expect(block).to.include('4/9 checks passed');
        expect(block).to.include('ready to validate');
        expect(block).to.include('partially verified with remaining failures');
        expect(block).to.include('actual number of files changed');
    });
});
