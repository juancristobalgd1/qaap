// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AIVariableResolutionRequest, AIVariableService } from '@theia/ai-core';
import { ImageContextVariable } from '@theia/ai-chat/lib/common/image-context-variable';
import { QAAP_BUILTIN_AGENT_DEFINITIONS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { applyComposerAttachmentsToPrompt } from '@theia/qaap-shared-core/lib/common/qaap-composer-attachment-prompt';
import {
    buildPreviewFeedbackAttachmentRequest,
    QaapAttachComposerContextArgs,
    resolvePreviewFeedbackVariable,
} from '@theia/qaap-shared-core/lib/common/qaap-preview-feedback-context';
import type { QaapAgentConversation, QaapAgentMessage } from '../common/qaap-agent-conversation';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';
import { buildTaskCreateRequest } from './qaap-agent-conversation-store-helpers2';
import { buildPromptExtracted } from './qaap-agent-conversation-store-live-status2';
import type { QaapAgentCommandBuildResult, QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { buildAgentCommandExtracted } from './qaap-agent-task-runner-streaming2';
import { applyTemplate, applyTemplateWithoutPrompt, removeAgentPromptTempDir } from './qaap-agent-task-runner-utils';

/**
 * Preview annotations travel: annotate Send → composer outbound (attachment preamble) → stored user message →
 * conversation prompt → harness command. Each harness then reads the prompt from argv, stdin or a prompt file.
 * These specs run the real functions of every hop and check that the annotation reaches what the CLI reads.
 */

/** CLIs that read no prompt from stdin in text mode: a prompt piped to them is never seen (agy 1.5.9). */
const STDIN_BLIND_BINS: ReadonlySet<string> = new Set(['agy']);

const COMMENT = 'quita este boton y muestra el modelo 3d directamente';
const SELECTOR = 'main#main-canvas > div.canvas-bg > button';

/**
 * Annotate Send args as `buildAnnotateChatAttachArgs` (qaap-adapters, browser-only) formats them; its own spec
 * covers that formatting, so a node spec takes the produced shape.
 */
const ANNOTATE_SEND_ARGS: QaapAttachComposerContextArgs = {
    chipTitle: 'Preview feedback · 1 annotations · / · Desktop',
    contextBody: [
        'Preview feedback annotations (compact context — not full DOM):',
        '',
        'Annotation 1:',
        `- Comment: ${COMMENT}`,
        '- Route: /',
        '- Viewport: desktop 479x666',
        `- Selector: ${SELECTOR}`,
        '- Position in element: x=0.491, y=0.857',
        '- Document position: x=0.500, y=0.400',
        '- Element: <button>',
        '- Text: Ver modelo 3D',
    ].join('\n'),
    dedupeKey: 'ws:t1:http://localhost:3001/:/:ann-1',
    submit: true,
};

/** The variable service the factory wires in: images resolve through it, preview feedback is pinned. */
const variableService = {
    resolveVariable: async (request: AIVariableResolutionRequest) => ImageContextVariable.isImageContextRequest(request)
        ? ImageContextVariable.resolve(request)
        : undefined,
} as unknown as AIVariableService;

/** Mirrors `applyComposerAttachmentsToDraft` from mobile-projects-panel-factory for a preview-feedback Send. */
async function buildAnnotateSendOutbound(withScreenshot: boolean): Promise<string> {
    const requests: AIVariableResolutionRequest[] = [buildPreviewFeedbackAttachmentRequest(ANNOTATE_SEND_ARGS)];
    if (withScreenshot) {
        requests.push(ImageContextVariable.createPathBasedRequest('.qaap/feedback/preview-screenshot.png', 'preview-screenshot.png'));
    }
    return applyComposerAttachmentsToPrompt(
        'Please address the attached preview feedback.',
        requests,
        variableService,
        undefined,
        { resolvePinnedRequest: async request => resolvePreviewFeedbackVariable(request) },
    );
}

function conversation(cwd: string, agentId: string, messages: QaapAgentMessage[]): QaapAgentConversation {
    return { id: 'conv-1', cwd, agentId, title: 'Preview feedback', status: 'streaming', createdAt: 1, updatedAt: 1, messages };
}

const storeContext = {
    stripLeadingAgentMention: (content: string) => content.trim(),
    appendTeamDelegation: (prompt: string) => prompt,
    contextPreambleWithCompaction: (preamble: string | undefined) => preamble ?? '',
} as unknown as QaapAgentConversationStoreContext;

function runnerContext(definition: { readonly id: string; readonly bin: string; readonly template: string }): QaapAgentTaskRunnerContext {
    return {
        resolveAgentId: () => definition.id,
        stripLeadingAgentMention: (value: string) => value.trim(),
        readAgentInstructions: () => undefined,
        readRepoMap: () => undefined,
        readRelevantFiles: () => undefined,
        readGitStatusSnapshot: () => undefined,
        readRepoMemory: () => undefined,
        readResearchLedger: () => undefined,
        readProjectInfo: () => undefined,
        assertQaiqConfigured: () => undefined,
        assertAgentModelAccess: () => undefined,
        resolveAgentSpawnIdentity: () => ({}),
        applyTemplate,
        applyTemplateWithoutPrompt,
        detectedAgents: new Map([[definition.id, definition]]),
        buildTemplateVars: () => ({}),
    } as unknown as QaapAgentTaskRunnerContext;
}

/** Everything the CLI actually reads: argv always, stdin unless the CLI ignores it, and a prompt file when given. */
function textTheCliReads(bin: string, built: QaapAgentCommandBuildResult): string {
    const parts = [built.command];
    if (built.stdinPrompt !== undefined && !STDIN_BLIND_BINS.has(bin)) {
        parts.push(built.stdinPrompt);
    }
    const promptFile = built.promptTempDir ? path.join(built.promptTempDir, 'prompt.txt') : undefined;
    if (promptFile && fs.existsSync(promptFile)) {
        parts.push(fs.readFileSync(promptFile, 'utf8'));
    }
    return parts.join('\n');
}

describe('preview annotation prompt delivery (annotate Send → harness)', () => {

    let cwd: string;

    beforeEach(() => {
        cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-annotate-delivery-'));
    });

    afterEach(() => {
        fs.rmSync(cwd, { recursive: true, force: true });
    });

    it('the composer outbound carries the annotation, not only the generic draft', async () => {
        const outbound = await buildAnnotateSendOutbound(true);
        expect(outbound).to.contain(COMMENT);
        expect(outbound).to.contain(SELECTOR);
        expect(outbound).to.contain('### previewFeedback:');
        expect(outbound).to.contain('Workspace image attached: .qaap/feedback/preview-screenshot.png');
        expect(outbound.trimEnd().endsWith('Please address the attached preview feedback.')).to.equal(true);
    });

    for (const followUp of [false, true]) {
        for (const definition of QAAP_BUILTIN_AGENT_DEFINITIONS) {
            it(`${definition.id} (${definition.bin}) reads the annotation on a ${followUp ? 'follow-up' : 'first'} turn`, async () => {
                const outbound = await buildAnnotateSendOutbound(true);
                const history: QaapAgentMessage[] = followUp
                    ? [
                        { id: 'u0', role: 'user', content: 'levanta la app', createdAt: 1 },
                        { id: 'a0', role: 'agent', content: 'The app is running on port 3001.', createdAt: 2 },
                    ]
                    : [];
                const user: QaapAgentMessage = { id: 'u1', role: 'user', content: outbound, createdAt: 3 };
                const conv = conversation(cwd, definition.id, [...history, user]);
                const request = buildTaskCreateRequest(conv, definition.id, undefined, user.id, {
                    stripLeadingAgentMention: content => content.trim(),
                    buildPrompt: (c, agentId) => buildPromptExtracted(storeContext, c, agentId),
                });
                expect(request.prompt, 'conversation prompt').to.contain(COMMENT);

                const built = buildAgentCommandExtracted(
                    runnerContext(definition),
                    request.prompt!,
                    definition.id,
                    true,
                    undefined,
                    cwd,
                    request.contextPreamble,
                    request.interactionModeId,
                    'full-access',
                    undefined,
                    request.userQuery,
                );
                try {
                    const read = textTheCliReads(definition.bin, built);
                    expect(read, `${definition.id} input`).to.contain(COMMENT);
                    expect(read, `${definition.id} input`).to.contain(SELECTOR);
                    expect(read, `${definition.id} input`).to.contain('preview-screenshot.png');
                    if (STDIN_BLIND_BINS.has(definition.bin)) {
                        // A `-` stdin marker on a stdin-blind CLI is the "your message was empty or just a dash" reply.
                        expect(built.command).not.to.match(/\s-p -(\s|$)/);
                        expect(built.stdinPrompt).to.equal(undefined);
                    }
                } finally {
                    removeAgentPromptTempDir(built.promptTempDir);
                }
            });
        }
    }

});
