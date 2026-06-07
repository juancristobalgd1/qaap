// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AgentService } from '@theia/ai-core/lib/common/agent-service';
import { PromptService } from '@theia/ai-core/lib/common/prompt-service';
import { ChatAgentService } from '@theia/ai-chat/lib/common/chat-agent-service';

/**
 * Removes the upstream Theia in-IDE agents (and their capability/command prompt fragments) that the
 * Qaap cloud product does not ship.
 *
 * Qaap is a cloud coding product whose heavy lifting — reviewing code, testing the app, working with
 * GitHub — is done by the background CLI agents (QAIQ, Codex, Claude Code, OpenCode), which already
 * have those abilities natively. The equivalent in-IDE Theia agents (`AppTester`, `code-reviewer`,
 * `GitHub`) and the local-IDE/sample agents (`Architect`, `Command`, `CreateSkill`,
 * `AskAndContinueSample`) are therefore redundant and only add noise to the chat agent picker and to
 * AI Configuration → Prompt Fragments.
 *
 * What QAAP keeps: `Coder` (the chat default), the programmatic infrastructure agents
 * (code completion, chat-session naming/summary), `ProjectInfo`, `Universal`, `explore`, and the
 * `shell-execution` capability.
 *
 * Removal is done at runtime through the public APIs (drift-safe — upstream `ai-ide` files are not
 * edited):
 *   - Agents are unregistered from BOTH {@link AgentService} (core registry + the prompt fragments
 *     shown in AI Configuration) and {@link ChatAgentService} (the chat agent picker, which keeps
 *     its own list). Re-applied on every registry change so a late registration is still removed.
 *   - The associated capability/slash-command prompt fragments are removed from {@link PromptService}
 *     after all contributions have registered (in {@link onDidInitializeLayout}), so the dropped
 *     agents leave no orphaned "delegate to X" capability toggles or `/gh-ticket` commands behind.
 *
 * To re-ship something, drop its id from {@link unshippedAgentIds} / {@link unshippedFragmentIds}.
 */
@injectable()
export class QaapUnshippedAgentsContribution implements FrontendApplicationContribution {

    @inject(AgentService)
    protected readonly agentService: AgentService;

    @inject(ChatAgentService)
    protected readonly chatAgentService: ChatAgentService;

    @inject(PromptService)
    protected readonly promptService: PromptService;

    /** Upstream Theia agent ids that Qaap's cloud product does not ship. */
    protected readonly unshippedAgentIds: ReadonlySet<string> = new Set<string>([
        // Local-IDE-oriented / sample agents:
        'Architect',            // standalone planning agent — Coder already plans inline
        'Command',              // executes IDE commands via chat — local-IDE-centric
        'CreateSkill',          // niche skill-authoring agent
        'AskAndContinueSample', // Theia API sample/demo agent
        // Redundant with the background CLI agents (QAIQ/Codex/Claude Code/OpenCode review,
        // test and work with GitHub natively):
        'AppTester',            // browser E2E verification
        'code-reviewer',        // in-chat code review
        'GitHub'                // GitHub / PR / ticket integration
    ]);

    /**
     * Capability and slash-command prompt fragments contributed by the removed agents' capability/
     * command contributions. Removing them takes the matching toggles out of the chat capabilities
     * picker and the `/…` command list, so nothing tries to delegate to an absent agent.
     */
    protected readonly unshippedFragmentIds: readonly string[] = [
        'apptester',         // AppTester capability
        'code-review-mode',  // Code Reviewer capability
        'github',            // GitHub capability
        'address-gh-review', // /address-gh-review slash command
        'analyze-gh-ticket', // /analyze-gh-ticket slash command
        'fix-gh-ticket'      // /fix-gh-ticket slash command
    ];

    /** Guards against re-entrancy: unregister fires the change events we listen to. */
    protected sweeping = false;

    onStart(): void {
        this.sweepUnshippedAgents();
        this.agentService.onDidChangeAgents(() => this.sweepUnshippedAgents());
        this.chatAgentService.onDidChangeAgents(() => this.sweepUnshippedAgents());
    }

    onDidInitializeLayout(): void {
        // Runs after every contribution's onStart, so the capability/command fragments have been
        // registered and can now be removed. Also re-sweep agents for late registrations.
        this.sweepUnshippedAgents();
        for (const fragmentId of this.unshippedFragmentIds) {
            this.promptService.removePromptFragment(fragmentId);
        }
    }

    protected sweepUnshippedAgents(): void {
        if (this.sweeping) {
            return;
        }
        this.sweeping = true;
        try {
            for (const id of this.unshippedAgentIds) {
                if (this.chatAgentService.getAllAgents().some(agent => agent.id === id)) {
                    this.chatAgentService.unregisterChatAgent(id);
                }
                if (this.agentService.getAllAgents().some(agent => agent.id === id)) {
                    this.agentService.unregisterAgent(id);
                }
            }
        } finally {
            this.sweeping = false;
        }
    }
}
