// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    buildAgentDirectExecutionPromptBlock,
    SUBAGENT_POLICY_MARKER,
} from './qaap-agent-subagent-policy';

const SHELL_AGENT_ID = 'shell';
const DEFAULT_WORKFLOW_MARKER = '[QAAP default agent workflow]';
const PARALLEL_TOOLS_MARKER = '[QAAP parallel tools]';
const SEARCH_HYGIENE_MARKER = '[QAAP search hygiene]';
const DEV_PREVIEW_MARKER = '[QAAP dev preview]';
const DEV_SERVER_VERIFICATION_MARKER = '[QAAP dev server verification]';
const HONEST_REPORTING_MARKER = '[QAAP honest reporting]';
const BENIGN_CODE_EDIT_MARKER = '[QAAP benign code edit policy]';
const PLANNING_MARKER = '[QAAP planning]';

const WEB_GENERATION_MARKER = '[QAAP web generation quality]';

export function buildAgentPlanningPromptBlock(): string {
    return [
        PLANNING_MARKER,
        'For any task with three or more steps, call TodoWrite with a short plan before you start editing, then mark each item completed as you finish it.',
        'Keep exactly one item in_progress at a time so the user can follow your progress live; do not leave finished items unmarked.',
        'Skip the todo list only for trivial one-step changes (a single edit, a one-line answer).',
    ].join('\n');
}

export function buildAgentWebGenerationQualityPromptBlock(): string {
    return [
        WEB_GENERATION_MARKER,
        'For landing pages and simple websites, do not stop after create-vite or npm create scaffolding.',
        'Replace the default Vite/React starter (logos, counter demo) with the requested branding, sections, and copy.',
        'Confirm package.json has a dev script and mention the run command (e.g. npm run dev) in your final reply.',
    ].join('\n');
}

export function buildAgentBenignCodeEditPromptBlock(): string {
    return [
        BENIGN_CODE_EDIT_MARKER,
        'After Read, a system-reminder about malware applies only when the file is confirmed malicious.',
        'For normal workspace project files (HTML, CSS, JS, configs), follow the user request: analyze, edit, write, and run verification when asked — do not refuse with a report-only workaround.',
    ].join('\n');
}

export function buildAgentParallelToolsPromptBlock(): string {
    return [
        PARALLEL_TOOLS_MARKER,
        'When you need several independent operations (Read, Grep, Glob, list files), call them in the same tool batch — never serialize independent reads or searches.',
        'Only run tools sequentially when a later call depends on an earlier result. Never write to the same file in parallel.',
    ].join('\n');
}

export interface QaapAgentDefaultWorkflowOptions {
    /** When false, omit git-status/branch instructions (ephemeral workspaces without `.git`). */
    readonly gitAvailable?: boolean;
}

export function buildAgentSearchHygienePromptBlock(): string {
    return [
        SEARCH_HYGIENE_MARKER,
        'Scope Grep and Glob to project source (src/, app/, components/, pages/) — never search **/*.js or **/* at the repo root.',
        'Exclude node_modules, .git, dist, build, and .next (use grep glob/type filters or narrow paths).',
        'Read package.json or list the project root first when you need to learn the layout.',
    ].join('\n');
}

export function buildAgentDefaultWorkflowPromptBlock(options: QaapAgentDefaultWorkflowOptions = {}): string {
    const gitAvailable = options.gitAvailable !== false;
    const gitLine = gitAvailable
        ? 'Use the current repository context, inspect git status before changing files, and create or use an appropriate branch for the task.'
        : 'This workspace may not be a git repository yet — skip branch, PR, and git-history steps; implement the requested change directly in the workspace.';
    return [
        DEFAULT_WORKFLOW_MARKER,
        'For coding tasks, work toward a reviewable pull request by default unless the user asks for a different outcome.',
        gitLine,
        'Start every task by using Read, Glob, or Grep on the repository — never end a turn with only planning/thinking text.',
        'Implement the change, run the most relevant verification you can find, and summarize the result with changed files and test status.',
        'When GitHub credentials and remotes are available, push the branch and open or update a PR. Otherwise leave the branch PR-ready and state the exact next command or blocker.',
        'Do not merge, delete branches, or rewrite shared history unless the user explicitly asks.',
    ].join('\n');
}

export function buildAgentDevPreviewPromptBlock(): string {
    return [
        DEV_PREVIEW_MARKER,
        'Qaap keeps the dev server alive in a dedicated IDE terminal with hot reload.',
        'Never run long-lived dev commands in shell (pnpm dev, npm start, vite, next dev, astro dev, etc.) — shell tools time out after ~30s and kill the preview.',
        'Use one-shot install/build/typecheck/test commands only. When the app should be previewable, reply with the expected local port (e.g. 5173) and confirm dependencies are installed; Qaap starts the server separately.',
        'Prefer scaffolding web apps in the workspace root (package.json at root). If you must use a subfolder, name it clearly in your final message — Qaap auto-detects child projects for preview.',
    ].join('\n');
}

export function buildAgentDevServerVerificationPromptBlock(): string {
    return [
        DEV_SERVER_VERIFICATION_MARKER,
        'Never report a dev server as "running", "serving correctly", or "ready" unless you have executed a command that confirms it.',
        'Before reporting a URL, verify the server responds: run `curl -s -o /dev/null -w \'%{http_code}\' http://localhost:PORT/` and check the HTTP status code is 200 or 3xx.',
        'If you cannot verify (command timed out, connection refused, no curl available), say so explicitly — never report a URL you have not confirmed.',
        'Partial output from a killed or timed-out process (e.g. "VITE ready in 1606ms" followed by a shell timeout) is NOT evidence the server is still running. The process may have been killed after producing that output.',
        'If the workspace has no package.json in the root and no runnable child project was detected, report that clearly — do not invent a dev server, port, or URL.',
    ].join('\n');
}

export function buildAgentHonestReportingPromptBlock(): string {
    return [
        HONEST_REPORTING_MARKER,
        'When you finish your work, your final message must distinguish between what you verified and what you did not.',
        'If you ran checks (tests, lints, typecheck, build) and some passed while others failed, report the exact counts: "4/9 checks passed, 5 failing" — not "fixed" or "done".',
        'Never use phrases like "ready to validate", "ready for testing", or "should work now" as a substitute for actually running the verification. Either run it and report the result, or explicitly state you have not yet verified it.',
        'A single passing check does not override multiple failing checks. If any check fails, the overall status is not "fixed" — it is "partially verified with remaining failures".',
        'Do not describe a fix as "minimal" or "surgical" if you changed more than one file for a single bug — state the actual number of files changed and why.',
    ].join('\n');
}

export function appendAgentDefaultWorkflowToPrompt(
    prompt: string,
    agentId: string,
    options: QaapAgentDefaultWorkflowOptions = {},
): string {
    if (agentId === SHELL_AGENT_ID || prompt.includes(DEFAULT_WORKFLOW_MARKER)) {
        return prompt;
    }
    const blocks = [buildAgentDefaultWorkflowPromptBlock(options)];
    if (!prompt.includes(PLANNING_MARKER)) {
        blocks.push(buildAgentPlanningPromptBlock());
    }
    if (!prompt.includes(PARALLEL_TOOLS_MARKER)) {
        blocks.push(buildAgentParallelToolsPromptBlock());
    }
    if (!prompt.includes(SEARCH_HYGIENE_MARKER)) {
        blocks.push(buildAgentSearchHygienePromptBlock());
    }
    if (!prompt.includes(DEV_PREVIEW_MARKER)) {
        blocks.push(buildAgentDevPreviewPromptBlock());
    }
    if (!prompt.includes(DEV_SERVER_VERIFICATION_MARKER)) {
        blocks.push(buildAgentDevServerVerificationPromptBlock());
    }
    if (!prompt.includes(HONEST_REPORTING_MARKER)) {
        blocks.push(buildAgentHonestReportingPromptBlock());
    }
    if (!prompt.includes(BENIGN_CODE_EDIT_MARKER)) {
        blocks.push(buildAgentBenignCodeEditPromptBlock());
    }
    if (!prompt.includes(WEB_GENERATION_MARKER)) {
        blocks.push(buildAgentWebGenerationQualityPromptBlock());
    }
    if (!prompt.includes(SUBAGENT_POLICY_MARKER)) {
        blocks.push(buildAgentDirectExecutionPromptBlock());
    }
    return `${blocks.join('\n\n')}\n\n---\n\n${prompt}`;
}
