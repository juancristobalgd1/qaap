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
const BENIGN_CODE_EDIT_MARKER = '[QAAP benign code edit policy]';

const WEB_GENERATION_MARKER = '[QAAP web generation quality]';

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

export function buildAgentSearchHygienePromptBlock(): string {
    return [
        SEARCH_HYGIENE_MARKER,
        'Scope Grep and Glob to project source (src/, app/, components/, pages/) — never search **/*.js or **/* at the repo root.',
        'Exclude node_modules, .git, dist, build, and .next (use grep glob/type filters or narrow paths).',
        'Read package.json or list the project root first when you need to learn the layout.',
    ].join('\n');
}

export function buildAgentDefaultWorkflowPromptBlock(): string {
    return [
        DEFAULT_WORKFLOW_MARKER,
        'For coding tasks, work toward a reviewable pull request by default unless the user asks for a different outcome.',
        'Use the current repository context, inspect git status before changing files, and create or use an appropriate branch for the task.',
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

export function appendAgentDefaultWorkflowToPrompt(prompt: string, agentId: string): string {
    if (agentId === SHELL_AGENT_ID || prompt.includes(DEFAULT_WORKFLOW_MARKER)) {
        return prompt;
    }
    const blocks = [buildAgentDefaultWorkflowPromptBlock()];
    if (!prompt.includes(PARALLEL_TOOLS_MARKER)) {
        blocks.push(buildAgentParallelToolsPromptBlock());
    }
    if (!prompt.includes(SEARCH_HYGIENE_MARKER)) {
        blocks.push(buildAgentSearchHygienePromptBlock());
    }
    if (!prompt.includes(DEV_PREVIEW_MARKER)) {
        blocks.push(buildAgentDevPreviewPromptBlock());
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
