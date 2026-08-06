// *****************************************************************************
// Copyright (C) 2024 EclipseSource GmbH.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ENABLE_AI_CONTEXT_KEY } from '@theia/ai-core/lib/browser';
import { Command, CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core';
import { ApplicationShell, codicon, KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalMenus } from '@theia/terminal/lib/browser/terminal-frontend-contribution';
import { TerminalWidgetImpl } from '@theia/terminal/lib/browser/terminal-widget-impl';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { TerminalPreferences } from '@theia/terminal/lib/common/terminal-preferences';
import { AiTerminalAgent } from './ai-terminal-agent';
import { AICommandHandlerFactory } from '@theia/ai-core/lib/browser/ai-command-handler-factory';
import { AgentService } from '@theia/ai-core';
import { nls } from '@theia/core/lib/common/nls';
import { TerminalBlock } from '@theia/terminal/lib/browser/base/terminal-widget';
import { AIChatContribution } from '@theia/ai-chat-ui/lib/browser/ai-chat-ui-contribution';
import { getQaapWorkHubTerminalContext } from '@theia/qaap-adapters/lib/browser/qaap-work-hub-terminal-context';

const AI_TERMINAL_COMMAND = Command.toLocalizedCommand({
    id: 'ai-terminal:open',
    label: 'Ask AI',
    iconClass: codicon('sparkle')
}, 'theia/ai/terminal/askAi');

const TERMINAL_CONTEXT_LIMIT = 8000;

@injectable()
export class AiTerminalCommandContribution implements CommandContribution, MenuContribution, KeybindingContribution {

    @inject(TerminalService)
    protected terminalService: TerminalService;

    @inject(AiTerminalAgent)
    protected terminalAgent: AiTerminalAgent;

    @inject(AICommandHandlerFactory)
    protected commandHandlerFactory: AICommandHandlerFactory;

    @inject(AgentService)
    private readonly agentService: AgentService;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(TerminalPreferences)
    protected readonly terminalPreferences: TerminalPreferences;

    @inject(AIChatContribution)
    protected readonly aiChatContribution: AIChatContribution;

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({
            command: AI_TERMINAL_COMMAND.id,
            keybinding: 'ctrlcmd+i',
            when: `terminalFocus && ${ENABLE_AI_CONTEXT_KEY}`
        });
    }
    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction([...TerminalMenus.TERMINAL_CONTEXT_MENU, '_5'], {
            when: ENABLE_AI_CONTEXT_KEY,
            commandId: AI_TERMINAL_COMMAND.id,
            icon: AI_TERMINAL_COMMAND.iconClass
        });
    }
    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(AI_TERMINAL_COMMAND, this.commandHandlerFactory({
            execute: (...args: unknown[]) => {
                const currentTerminal = this.getTerminalFromCommandArgs(...args);
                const workHubContext = currentTerminal && getQaapWorkHubTerminalContext(currentTerminal);
                if (workHubContext) {
                    this.openTerminalAskAiDialog(currentTerminal, question => workHubContext.askAi(question));
                    return;
                }
                if (currentTerminal instanceof TerminalWidgetImpl && currentTerminal.kind === 'user') {
                    this.openTerminalAskAiDialog(
                        currentTerminal,
                        question => this.prepareQaapChatComposer(currentTerminal, question, true),
                    );
                }
            },
            isEnabled: (...args: unknown[]) => {
                const currentTerminal = this.getTerminalFromCommandArgs(...args);
                const workHubContext = currentTerminal && getQaapWorkHubTerminalContext(currentTerminal);
                // Work Hub terminals are user-facing chat terminals. Classic IDE terminals
                // retain the upstream user-terminal restriction below.
                return this.agentService.isEnabled(this.terminalAgent.id)
                    && (!!workHubContext || currentTerminal?.kind === 'user');
            }
        }));
    }

    /** Opens the terminal-local question dialog. Chat navigation starts only after its Send action. */
    protected openTerminalAskAiDialog(
        terminal: TerminalWidget,
        onSubmit: (question: string) => Promise<void>,
    ): void {
        new TerminalAskAiDialog(terminal, onSubmit);
    }

    /** Places the terminal context and the question in the product chat composer. */
    protected async prepareQaapChatComposer(
        terminal: TerminalWidgetImpl,
        question: string,
        submit: boolean,
    ): Promise<void> {
        const terminalContext = this.getRecentTerminalContext(terminal);
        const chatWidget = await this.aiChatContribution.openView({ activate: true });
        const input = await this.waitForQaapChatComposer(chatWidget.node);
        if (!input) {
            throw new Error('The Qaap chat composer did not become available.');
        }

        const nextDraft = this.createTerminalPrompt(terminalContext, question);
        if (nextDraft) {
            input.value = nextDraft;
            // Use the composer's own event path so its draft state and Send enablement stay
            // in sync before the dialog's Send action submits the chat request.
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        input.focus({ preventScroll: true });
        input.setSelectionRange(input.value.length, input.value.length);
        if (submit) {
            await this.submitQaapChatComposer(chatWidget.node);
        }
    }

    protected createTerminalPrompt(terminalContext: string, question: string): string {
        const trimmedQuestion = question.trim();
        if (!terminalContext.trim()) {
            return trimmedQuestion;
        }
        const contextMarker = nls.localize(
            'theia/ai/terminal/contextHeader',
            '### Terminal context',
        );
        const questionMarker = nls.localize('theia/ai/terminal/contextQuestion', 'Question:');
        return [
            contextMarker,
            '',
            '```text',
            terminalContext.trim(),
            '```',
            '',
            questionMarker,
            ` ${trimmedQuestion}`,
        ].join('\n');
    }

    protected async submitQaapChatComposer(root: HTMLElement): Promise<void> {
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
            const sendButton = root.querySelector<HTMLButtonElement>(
                '.theia-mobile-projects-sticky-composer-send',
            );
            if (sendButton?.isConnected && !sendButton.disabled) {
                sendButton.click();
                return;
            }
            await new Promise<void>(resolve => window.setTimeout(resolve, 50));
        }
    }

    protected async waitForQaapChatComposer(root: HTMLElement): Promise<HTMLTextAreaElement | undefined> {
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
            const input = root.querySelector<HTMLTextAreaElement>(
                '.theia-mobile-projects-sticky-composer-input',
            );
            if (input?.isConnected && !input.disabled) {
                return input;
            }
            await new Promise<void>(resolve => window.setTimeout(resolve, 50));
        }
        return undefined;
    }

    protected getRecentTerminalContext(terminal: TerminalWidgetImpl): string {
        const characterLimit = TERMINAL_CONTEXT_LIMIT;
        if (this.terminalPreferences['terminal.integrated.enableCommandHistory'] ?? false) {
            const commandHistory = terminal.commandHistoryState?.commandHistory ?? [];
            return this.extractContextFromTerminalOutput(commandHistory, characterLimit).join('\n').trim();
        }

        const bufferLength = terminal.buffer.length;
        return terminal.buffer.getLines(
            Math.max(0, bufferLength - 100),
            bufferLength,
        ).join('\n').trim();
    }

    protected extractContextFromTerminalOutput(commandBlocks: TerminalBlock[], characterLimit: number): string[] {
        const context: string[] = [];
        let currentCharacters = 0;

        for (let i = commandBlocks.length - 1; i >= 0; i--) {
            const block = commandBlocks[i];
            const blockCharacters = block.command.length + block.output.length;

            if (currentCharacters + blockCharacters <= characterLimit) {
                context.push(`${block.command}\n${block.output}`);
                currentCharacters += blockCharacters;
            } else {
                const remainingCharacters = characterLimit - currentCharacters;
                if (block.command.length <= remainingCharacters) {
                    const outputLimit = remainingCharacters - block.command.length;
                    const trimmedOutput = block.output.substring(0, outputLimit);
                    context.push(`${block.command}\n${trimmedOutput}`);
                } else {
                    const trimmedCommand = block.command.substring(0, remainingCharacters);
                    context.push(trimmedCommand);
                }
                break;
            }
        }

        return context.reverse();
    }

    protected getTerminalFromCommandArgs(...args: unknown[]): TerminalWidget | undefined {
        const anchor = args.find(arg => typeof MouseEvent !== 'undefined' && arg instanceof MouseEvent);
        const target = anchor instanceof MouseEvent ? anchor.target : undefined;
        if (target instanceof Node) {
            const terminal = this.terminalService.all.find(candidate => candidate.node.contains(target));
            if (terminal) {
                return terminal;
            }
        }

        return this.shell.currentWidget instanceof TerminalWidgetImpl
            ? this.shell.currentWidget
            : this.terminalService.currentTerminal;
    }
}

class TerminalAskAiDialog {

    protected readonly dialog: HTMLDivElement;
    protected readonly input: HTMLTextAreaElement;
    protected readonly sendButton: HTMLButtonElement;
    protected submitting = false;

    constructor(
        protected readonly terminalWidget: TerminalWidget,
        protected readonly onSubmit: (question: string) => Promise<void>,
    ) {
        this.dialog = document.createElement('div');
        this.dialog.className = 'qaap-terminal-ask-ai-dialog';
        this.dialog.setAttribute('role', 'dialog');
        this.dialog.setAttribute(
            'aria-label',
            nls.localize('theia/ai/terminal/askAiDialogLabel', 'Ask AI about this terminal'),
        );

        const header = document.createElement('div');
        header.className = 'qaap-terminal-ask-ai-dialog-header';
        const title = document.createElement('strong');
        title.textContent = nls.localize('theia/ai/terminal/askAiDialogTitle', 'Ask AI');
        header.appendChild(title);

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'qaap-terminal-ask-ai-dialog-close codicon codicon-close';
        closeButton.title = nls.localizeByDefault('Close');
        closeButton.setAttribute('aria-label', nls.localizeByDefault('Close'));
        closeButton.onclick = () => this.dispose();
        header.appendChild(closeButton);
        this.dialog.appendChild(header);

        this.input = document.createElement('textarea');
        this.input.className = 'theia-input qaap-terminal-ask-ai-dialog-input';
        this.input.placeholder = nls.localize(
            'theia/ai/terminal/askAiDialogPlaceholder',
            'What would you like to ask about this terminal?',
        );
        this.input.rows = 3;
        this.input.onkeydown = event => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void this.submit();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                this.dispose();
            }
        };
        this.dialog.appendChild(this.input);

        const footer = document.createElement('div');
        footer.className = 'qaap-terminal-ask-ai-dialog-footer';
        this.sendButton = document.createElement('button');
        this.sendButton.type = 'button';
        this.sendButton.className = 'theia-button primary qaap-terminal-ask-ai-dialog-send';
        this.sendButton.textContent = nls.localizeByDefault('Send');
        this.sendButton.onclick = () => { void this.submit(); };
        footer.appendChild(this.sendButton);
        this.dialog.appendChild(footer);

        terminalWidget.node.appendChild(this.dialog);
        this.input.focus({ preventScroll: true });
    }

    protected async submit(): Promise<void> {
        const question = this.input.value.trim();
        if (!question || this.submitting) {
            return;
        }

        this.submitting = true;
        this.input.disabled = true;
        this.sendButton.disabled = true;
        try {
            await this.onSubmit(question);
            this.dispose();
        } catch (error) {
            this.submitting = false;
            this.input.disabled = false;
            this.sendButton.disabled = false;
            console.error('[ai-terminal] failed to submit terminal question', error);
        }
    }

    protected dispose(): void {
        this.dialog.remove();
    }
}
