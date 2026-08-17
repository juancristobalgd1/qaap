// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageDTO, QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import { classifyTranscriptToolActivityKind } from './qaap-agent-transcript-segments';
import { resolveAgentMessageSegments } from './qaap-transcript-trace-model';

export interface WebGenerationQualityVerdict {
    readonly ok: boolean;
    readonly reason?: string;
}

const WEB_GENERATION_PROMPT_RE = /\b(?:landing(?:\s+page)?|p[aá]gina\s+(?:web|de\s+aterrizaje)|sitio\s+web|homepage|single[\s-]page(?:\s+site)?|marketing\s+(?:site|page)|website)\b/i;
const WEB_GENERATION_ACTION_RE = /\b(?:create|build|make|design|scaffold|generate)\b[\s\S]{0,80}\b(?:landing|website|web\s+app|react\s+app|vite|homepage)\b/i;
const WEB_GENERATION_STACK_RE = /\b(?:vite|react)\b[\s\S]{0,80}\b(?:landing|website|page|app)\b/i;

const SECTION_HINT_RE = /\b(?:hero|header|footer|nav(?:igation)?|contact(?:o)?|about|features?|products?|gallery|testimonial|pricing|cta|banner)\b/gi;

const SECTION_WORDS = new Set([
    'hero', 'header', 'footer', 'nav', 'navigation', 'contact', 'contacto', 'about',
    'feature', 'features', 'product', 'products', 'gallery', 'testimonial', 'pricing', 'cta', 'banner',
]);

const TOPIC_STOPWORDS = new Set([
    'create', 'build', 'make', 'design', 'scaffold', 'generate', 'using', 'with', 'from', 'into',
    'landing', 'page', 'website', 'homepage', 'single', 'site', 'vite', 'react', 'typescript',
    'javascript', 'project', 'app', 'application', 'local', 'simple', 'modern', 'responsive',
    'please', 'need', 'want', 'would', 'like', 'this', 'that', 'your', 'para', 'una', 'con',
]);

const VITE_REACT_STARTER_MARKERS: readonly RegExp[] = [
    /vite\s+logo/i,
    /react\s+logo/i,
    /\bcount\s+is\b/i,
    /edit\s+src\/app\.tsx/i,
    /click\s+on\s+the\s+vite\s+and\s+react\s+logos/i,
    /import\s+reactLogo/i,
    /from\s+['"].*react\.svg['"]/i,
];

const PLACEHOLDER_MARKERS: readonly RegExp[] = [
    /lorem\s+ipsum/i,
    /your\s+company(?:\s+name)?/i,
    /company\s+name/i,
    /insert\s+your/i,
    /placeholder/i,
];

const SCAFFOLD_SHELL_RE = /\b(?:npm\s+create|pnpm\s+create|yarn\s+create|bun\s+create|create-vite|create\s+vite)\b/i;
const RUN_PATH_RE = /\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:dev|start|preview|serve)\b/i;

/** User message that asks the agent to scaffold or customize a simple web page/app. */
export function messageRequestsWebGeneration(text: string | undefined): boolean {
    const normalized = text?.trim();
    if (!normalized) {
        return false;
    }
    return WEB_GENERATION_PROMPT_RE.test(normalized)
        || WEB_GENERATION_ACTION_RE.test(normalized)
        || WEB_GENERATION_STACK_RE.test(normalized);
}

/**
 * Stricter than {@link messageRequestsWebGeneration}: matches ONLY an explicit web-page noun
 * (landing page / website / homepage / sitio web …), never the loose "build … vite" action regex.
 *
 * Used to gate the "replace the Vite/React starter with a landing page" auto-continuation and its
 * quality gate. Without this, a build-error report that merely contains the command `vite build`
 * (e.g. an auto-verify failure fed back into the conversation) trips {@link WEB_GENERATION_ACTION_RE}
 * and derails an ordinary task (e.g. "add a formatDate function") into a full landing-page rewrite.
 */
export function messageExplicitlyRequestsWebPage(text: string | undefined): boolean {
    const normalized = text?.trim();
    return !!normalized && WEB_GENERATION_PROMPT_RE.test(normalized);
}

interface EditedArtifact {
    readonly path: string;
    readonly content: string;
}

function parseToolArgs(argsJson: string): Record<string, unknown> | undefined {
    try {
        const parsed = JSON.parse(argsJson) as unknown;
        return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
    } catch {
        return undefined;
    }
}

function readToolArgString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
    for (const key of keys) {
        const value = args[key];
        if (typeof value === 'string' && value.trim()) {
            return value;
        }
    }
    return undefined;
}

function isUiSourcePath(path: string): boolean {
    const normalized = path.replace(/\\/g, '/');
    return /\.(?:tsx|jsx|html|css|vue|svelte)$/i.test(normalized)
        || /(?:^|\/)App\.(?:tsx|jsx)$/i.test(normalized)
        || /(?:^|\/)index\.html$/i.test(normalized);
}

function collectEditedArtifacts(segments: readonly QaapAgentMessageSegmentDTO[]): EditedArtifact[] {
    const artifacts: EditedArtifact[] = [];
    for (const segment of segments) {
        if (segment.type !== 'tool' || !segment.finished || !segment.name) {
            continue;
        }
        if (classifyTranscriptToolActivityKind(segment.name) !== 'editing') {
            continue;
        }
        const args = parseToolArgs(segment.args);
        if (!args) {
            continue;
        }
        const path = readToolArgString(args, ['path', 'file_path', 'filePath', 'target_file', 'targetFile']);
        if (!path) {
            continue;
        }
        const content = readToolArgString(args, ['content', 'new_string', 'newString', 'newText', 'text', 'code'])
            ?? segment.result
            ?? '';
        if (!content.trim()) {
            continue;
        }
        artifacts.push({ path, content });
    }
    return artifacts;
}

function collectShellCommands(segments: readonly QaapAgentMessageSegmentDTO[]): string[] {
    const commands: string[] = [];
    for (const segment of segments) {
        if (segment.type !== 'tool' || !segment.finished || !segment.name) {
            continue;
        }
        if (classifyTranscriptToolActivityKind(segment.name) !== 'terminal') {
            continue;
        }
        const args = parseToolArgs(segment.args);
        const command = args ? readToolArgString(args, ['command', 'cmd']) : undefined;
        if (command?.trim()) {
            commands.push(command);
        }
    }
    return commands;
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

function extractRequestedSections(userContent: string): string[] {
    const matches = userContent.match(SECTION_HINT_RE) ?? [];
    return [...new Set(matches.map(match => match.toLowerCase()))];
}

function extractTopicKeywords(userContent: string): string[] {
    const words = userContent.toLowerCase().match(/\b[a-záéíóúñ]{3,}\b/g) ?? [];
    return [...new Set(words.filter(word => !TOPIC_STOPWORDS.has(word) && !SECTION_WORDS.has(word)))];
}

function contentMentionsTopic(content: string, keywords: readonly string[]): boolean {
    const lower = content.toLowerCase();
    return keywords.some(keyword => lower.includes(keyword));
}

function contentMentionsSections(content: string, sections: readonly string[]): boolean {
    const lower = content.toLowerCase();
    return sections.every(section => lower.includes(section));
}

function countPatternHits(content: string, patterns: readonly RegExp[]): number {
    let hits = 0;
    for (const pattern of patterns) {
        if (pattern.test(content)) {
            hits += 1;
        }
    }
    return hits;
}

function looksLikeStarterTemplate(uiContent: string): boolean {
    if (!uiContent.trim()) {
        return false;
    }
    const starterHits = countPatternHits(uiContent, VITE_REACT_STARTER_MARKERS);
    if (starterHits >= 2) {
        return true;
    }
    return starterHits >= 1 && uiContent.length < 900;
}

function hasKnownRunPath(shellCommands: readonly string[], agentText: string, artifacts: readonly EditedArtifact[]): boolean {
    if (RUN_PATH_RE.test(agentText)) {
        return true;
    }
    if (shellCommands.some(command => SCAFFOLD_SHELL_RE.test(command))) {
        return true;
    }
    return artifacts.some(artifact => /package\.json$/i.test(artifact.path.replace(/\\/g, '/')));
}

/** Lightweight transcript-only gate before accepting a web-generation turn as complete. */
export function evaluateWebGenerationQuality(
    userContent: string | undefined,
    agentMessage: QaapAgentMessageDTO | undefined,
): WebGenerationQualityVerdict {
    if (!messageRequestsWebGeneration(userContent) || !agentMessage || agentMessage.role !== 'agent') {
        return { ok: true };
    }

    const segments = resolveAgentMessageSegments(agentMessage);
    const artifacts = collectEditedArtifacts(segments);
    const uiArtifacts = artifacts.filter(artifact => isUiSourcePath(artifact.path));
    const uiContent = uiArtifacts.map(artifact => artifact.content).join('\n');
    const shellCommands = collectShellCommands(segments);
    const agentText = collectAgentVisibleText(agentMessage);
    const combinedOutput = `${uiContent}\n${agentText}`;

    const scaffoldOnly = shellCommands.some(command => SCAFFOLD_SHELL_RE.test(command)) && uiArtifacts.length === 0;
    if (scaffoldOnly) {
        return {
            ok: false,
            reason: 'The project was scaffolded but the landing page UI was not customized yet.',
        };
    }

    if (uiArtifacts.length === 0) {
        return {
            ok: false,
            reason: 'No landing page source files were edited yet (App.tsx, index.html, or CSS).',
        };
    }

    if (looksLikeStarterTemplate(uiContent)) {
        return {
            ok: false,
            reason: 'The UI still matches the default Vite/React starter instead of the requested landing page.',
        };
    }

    if (countPatternHits(uiContent, PLACEHOLDER_MARKERS) >= 2) {
        return {
            ok: false,
            reason: 'Placeholder copy is still present in the generated landing page.',
        };
    }

    const topicKeywords = extractTopicKeywords(userContent ?? '');
    if (topicKeywords.length > 0 && !contentMentionsTopic(combinedOutput, topicKeywords)) {
        return {
            ok: false,
            reason: `Generated content does not reflect the requested topic (${topicKeywords.slice(0, 3).join(', ')}).`,
        };
    }

    const requestedSections = extractRequestedSections(userContent ?? '');
    if (requestedSections.length > 0 && !contentMentionsSections(combinedOutput, requestedSections)) {
        return {
            ok: false,
            reason: `Requested sections are missing (${requestedSections.slice(0, 4).join(', ')}).`,
        };
    }

    if (!hasKnownRunPath(shellCommands, agentText, artifacts)) {
        return {
            ok: false,
            reason: 'Run path is unknown — add package.json scripts or confirm npm run dev for preview.',
        };
    }

    return { ok: true };
}

export function agentWebGenerationPassesQualityGate(
    userContent: string | undefined,
    agentMessage: QaapAgentMessageDTO | undefined,
): boolean {
    return evaluateWebGenerationQuality(userContent, agentMessage).ok;
}

export function buildWebGenerationAutoContinuePrompt(userContent?: string): string {
    const topic = extractTopicKeywords(userContent ?? '').slice(0, 3).join(', ');
    const sections = extractRequestedSections(userContent ?? '').slice(0, 4).join(', ');
    const topicHint = topic ? ` Topic: ${topic}.` : '';
    const sectionHint = sections ? ` Sections: ${sections}.` : '';
    return `Continue this task now. Replace the Vite/React starter with the requested landing page content.${topicHint}${sectionHint} `
        + 'Edit App.tsx/index.html/CSS with real branding, remove Vite/React logo boilerplate, add the requested sections, '
        + 'ensure package.json has a dev script, and summarize the run command for preview.';
}
