// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import { isTranscriptTodoTool, parseTranscriptTodoChecklist, resolveTranscriptActivityStats } from './qaap-agent-transcript-segments';
import { extractDevPreviewUrlFromAgentText, messageRequestsDevPreview } from './qaap-transcript-preview-offer';
import {
    agentWebGenerationPassesQualityGate,
    buildWebGenerationAutoContinuePrompt,
    messageExplicitlyRequestsWebPage,
} from './qaap-agent-web-generation-quality-gate';
import { resolveAgentMessageSegments } from './qaap-transcript-trace-model';
import { normalizeInteractionModeId } from './qaap-qaiq-interaction-flags';

// Each heuristic matches English and Spanish forms — Qaap's user base writes prompts (and the
// agent, mirroring the user's language, writes outcomes) in both. English words keep the strict
// trailing `\b`; Spanish entries are verb stems with no trailing boundary so all conjugations
// match (`\b` is ASCII-only and misbehaves around accented characters and `ñ`).
const ACTIONABLE_TASK_ES = '\\b(?:arregl|corrig|correg|soluciona|implementa|constru|ejecuta|depura|revisa|refactoriza'
    + '|añad|agrega|crea|actualiza|instala|despliega|mejora|genera|prueba|haz\\b)';
const ACTIONABLE_TASK_RE = new RegExp(
    '\\b(?:fix|explore|implement|build|run|test|debug|review|refactor|add|create|update|install|deploy|figure\\s+out)\\b'
    + '|' + ACTIONABLE_TASK_ES, 'i');
const PLANNING_TEXT_RE = new RegExp(
    '\\b(?:let me|i will|i\'ll|i am going to|going to (?:start|explore|check|look|figure)|need to (?:explore|check|understand|figure)'
    + '|start by (?:exploring|looking|checking|understanding))\\b'
    + '|\\b(?:voy a|d[ée]jame|empezar[ée]|comenzar[ée]|empiezo por|primero (?:voy|necesito|tengo que)'
    + '|necesito (?:explorar|revisar|entender|comprobar|mirar))', 'i');
const TASK_OUTCOME_TEXT_RE = new RegExp(
    '\\b(?:done|completed|finished|ready on port|listening on|running (?:at|on)|installed|dependencies (?:are )?ready'
    + '|node_modules|here(?:\'s| is) the url|preview(?:\\s+is)?(?:\\s+)?ready|dev server)\\b'
    + '|\\b(?:listo|hecho|completad|terminad|finalizad|instalad|corriendo en|funcionando en|escuchando en'
    + '|servidor de desarrollo|aqu[íi] (?:est[áa]|tienes) la url)', 'i');
// Analytical tasks whose deliverable is written prose, not tool execution. Symmetric to the
// explore-only heuristic — a substantive review/analysis after reads is a complete answer.
const ANALYTICAL_TASK_RE = new RegExp(
    '\\b(?:review|explain|analy[sz]e|summari[sz]e|describe|document|audit|compare|investigate)\\b'
    + '|\\b(?:revisa|explica|expl[íi]came|analiza|resume|res[úu]meme|describe|documenta|audita|compara|investiga)', 'i');
const EXECUTION_TASK_RE = new RegExp(
    '\\b(?:build|run|install|fix|implement|deploy|start|create|add|refactor|update|figure\\s+out)\\b'
    + '|\\b(?:constru|ejecuta|instala|arregl|corrig|correg|soluciona|implementa|despliega|crea'
    + '|añad|agrega|actualiza|refactoriza|inicia|arranca|haz\\b)', 'i');

/**
 * Auto-continue only applies to the fully-autonomous `agent` contract. In `plan` mode the
 * agent deliberately stops after planning (the QAIQ CLI blocks Edit/Write/Bash), and
 * when the user opted into approving each step (`request-approval` / `autoApprove === false`) they
 * chose to stay in the loop — re-posting "Continue… use Bash" contradicts all of these. Missing
 * mode normalizes to `agent`, so legacy conversations keep auto-continuing.
 */
export function autoContinueAllowedForInteraction(options: {
    readonly interactionModeId?: string;
    readonly approvalPolicyId?: string;
    readonly autoApprove?: boolean;
}): boolean {
    if (normalizeInteractionModeId(options.interactionModeId) !== 'agent') {
        return false;
    }
    if (options.approvalPolicyId === 'request-approval' || options.autoApprove === false) {
        return false;
    }
    return true;
}

/** Analytical task ("review"/"explain"/…) whose deliverable is prose, not execution. */
function isAnalyticalTaskMessage(userContent: string | undefined): boolean {
    const text = userContent?.trim() ?? '';
    if (!text || messageRequestsDevPreview(text)) {
        return false;
    }
    return ANALYTICAL_TASK_RE.test(text) && !EXECUTION_TASK_RE.test(text);
}

/** User message that expects the agent to run tools, not stop after planning. */
export function isActionableAgentTaskMessage(text: string | undefined): boolean {
    if (!text?.trim()) {
        return false;
    }
    return messageRequestsDevPreview(text) || ACTIONABLE_TASK_RE.test(text);
}

function collectAgentVisibleText(agentMessage: QaapAgentMessageDTO): string {
    const parts: string[] = [];
    if (agentMessage.content?.trim()) {
        parts.push(agentMessage.content.trim());
    }
    for (const segment of resolveAgentMessageSegments(agentMessage)) {
        if ((segment.type === 'text' || segment.type === 'thinking') && segment.content?.trim()) {
            parts.push(segment.content.trim());
        }
    }
    return parts.join('\n');
}

function agentTextLooksLikePlanningOnly(text: string | undefined): boolean {
    const normalized = text?.trim();
    if (!normalized) {
        return false;
    }
    return PLANNING_TEXT_RE.test(normalized) && !TASK_OUTCOME_TEXT_RE.test(normalized);
}

function isExploreOnlyTaskMessage(userContent: string | undefined): boolean {
    const text = userContent?.trim() ?? '';
    if (!text || messageRequestsDevPreview(text)) {
        return false;
    }
    return /\bexplor(?:e|a|ar|emos)\b/i.test(text)
        && !EXECUTION_TASK_RE.test(text);
}

/** True when the latest TodoWrite checklist still has pending or in-progress items. */
export function agentMessageHasOpenTodos(agentMessage: QaapAgentMessageDTO | undefined): boolean {
    const segments = resolveAgentMessageSegments(agentMessage);
    if (!segments.length) {
        return false;
    }
    let latestTodoArgs: string | undefined;
    for (const segment of segments) {
        if (segment.type === 'tool' && segment.finished && isTranscriptTodoTool(segment.name) && segment.args) {
            latestTodoArgs = segment.args;
        }
    }
    if (!latestTodoArgs) {
        return false;
    }
    const checklist = parseTranscriptTodoChecklist(latestTodoArgs);
    return !!checklist?.some(item => item.status !== 'completed');
}

/** True when the agent produced a concrete outcome for the user request. */
export function agentMessageDeliversTaskOutcome(
    userContent: string | undefined,
    agentMessage: QaapAgentMessageDTO | undefined,
): boolean {
    if (!agentMessage || agentMessage.role !== 'agent') {
        return false;
    }
    if (agentMessageHasOpenTodos(agentMessage)) {
        return false;
    }
    if (!agentMessageDeliversBaseTaskOutcome(userContent, agentMessage)) {
        return false;
    }
    // Only judge web-generation quality when the user EXPLICITLY asked for a web page. Otherwise a
    // normal task (e.g. "add a formatDate function") in a Vite/React workspace gets mis-flagged
    // "incomplete" and auto-continued into a landing-page rewrite.
    if (messageExplicitlyRequestsWebPage(userContent)) {
        return agentWebGenerationPassesQualityGate(userContent, agentMessage);
    }
    return true;
}

function agentMessageDeliversBaseTaskOutcome(
    userContent: string | undefined,
    agentMessage: QaapAgentMessageDTO,
): boolean {
    const text = collectAgentVisibleText(agentMessage);
    const stats = resolveTranscriptActivityStats([...resolveAgentMessageSegments(agentMessage)]);
    if (messageRequestsDevPreview(userContent)) {
        if (extractDevPreviewUrlFromAgentText(text)) {
            return true;
        }
        if (TASK_OUTCOME_TEXT_RE.test(text)) {
            return true;
        }
        return stats.shells > 0;
    }
    if (stats.shells > 0 || stats.edits > 0) {
        return true;
    }
    if (!text) {
        return false;
    }
    if (isExploreOnlyTaskMessage(userContent)) {
        return !agentTextLooksLikePlanningOnly(text);
    }
    if (agentTextLooksLikePlanningOnly(text)) {
        return false;
    }
    if (stats.searches + stats.fileReads + stats.otherTools > 0 && stats.shells + stats.edits === 0) {
        // A read/search-only turn is usually an exploration stop — except for analytical tasks
        // ("review this code"), where a substantive written answer after reads IS the deliverable.
        if (isAnalyticalTaskMessage(userContent)) {
            return !!text.trim();
        }
        return false;
    }
    return !!text.trim();
}

/** True when the agent ended the turn without tools or a real answer. */
export function isIncompleteAgentTurn(
    userContent: string | undefined,
    agentMessage: QaapAgentMessageDTO | undefined,
): boolean {
    if (!isActionableAgentTaskMessage(userContent) || !agentMessage || agentMessage.role !== 'agent') {
        return false;
    }
    if (agentMessageDeliversTaskOutcome(userContent, agentMessage)) {
        return false;
    }
    // Actionable message + role agent + did not deliver an outcome: any produced segments (whether a
    // tool was cut off mid-run or the agent stopped after search/read/planning) mean the turn is
    // incomplete. An empty/ellipsis-only content with no segments is incomplete too.
    if (resolveAgentMessageSegments(agentMessage).length) {
        return true;
    }
    const content = agentMessage.content?.trim();
    // Some CLI adapters emit a final planning sentence without a structured segment. That is
    // still an incomplete actionable turn: requiring a tool segment here silently disables the
    // auto-continue path for exactly the search-only stop it is meant to recover.
    return !content || content === '…' || agentTextLooksLikePlanningOnly(content);
}

export function buildAgentAutoContinuePrompt(userContent?: string): string {
    // Fire the "replace the Vite/React starter with a landing page" continuation ONLY when the
    // user explicitly asked for a web page — never off an incidental "vite build" in a build error.
    if (messageExplicitlyRequestsWebPage(userContent)) {
        return buildWebGenerationAutoContinuePrompt(userContent);
    }
    if (messageRequestsDevPreview(userContent)) {
        return 'Continue this task now. Complete every remaining todo item, inspect package.json, install dependencies with one-shot Bash if needed, fix build issues, '
            + 'and confirm the dev server port for preview. Do not stop after search, read, or planning text.';
    }
    return 'Continue this task now. Complete every remaining todo item, use Read, Glob, or Grep to inspect the repo, then Bash for one-shot commands. '
        + 'Do not stop after planning, searching, or thinking — finish the user request and report concrete results.';
}

export function buildDevPreviewAutoContinueExhaustedReason(): string {
    return 'Dev preview did not become ready after multiple agent attempts. '
        + 'Qaap could not start or attach to the dev server — check that package.json exists in the workspace root or a detected subfolder, install dependencies, then use Run & Preview.';
}
