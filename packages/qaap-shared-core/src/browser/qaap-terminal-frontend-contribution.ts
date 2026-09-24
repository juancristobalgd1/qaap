// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CommandRegistry } from '@theia/core/lib/common/command';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { TerminalFrontendContribution } from '@theia/terminal/lib/browser/terminal-frontend-contribution';
import { TerminalCommands } from '@theia/terminal/lib/browser/terminal-frontend-contribution';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { shouldDeferTerminalLayoutInit } from './qaap-defer-terminal-layout-init';
import { getQaapWorkHubTerminalContext, type QaapWorkHubTerminalContext } from '@theia/qaap-adapters/lib/browser/qaap-work-hub-terminal-context';

export { shouldDeferTerminalLayoutInit } from './qaap-defer-terminal-layout-init';

@injectable()
export class QaapTerminalFrontendContribution extends TerminalFrontendContribution {

    @inject(ClipboardService)
    protected readonly qaapClipboardService: ClipboardService;

    override registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands);

        // The stock handlers resolve the active ApplicationShell widget. Work Hub terminals are
        // real TerminalWidgets mounted inside the transcript surface, so the context-menu anchor
        // is the authoritative target for these actions.
        commands.registerHandler(TerminalCommands.NEW_ACTIVE_WORKSPACE.id, {
            isEnabled: (...args: unknown[]): boolean => !!this.getWorkHubTerminalContext(...args),
            execute: (...args: unknown[]): Promise<void> | undefined =>
                this.getWorkHubTerminalContext(...args)?.createNewTerminal(),
        });
        commands.registerHandler(TerminalCommands.TERMINAL_CLEAR.id, this.createTerminalCommandHandler(
            terminal => terminal.clearOutput(),
        ));
        commands.registerHandler(TerminalCommands.KILL_TERMINAL.id, {
            isEnabled: (...args: unknown[]): boolean => !!this.getTerminalFromCommandArgs(...args),
            execute: (...args: unknown[]): void => {
                const context = this.getWorkHubTerminalContext(...args);
                if (context) {
                    void context.closeTerminal();
                    return;
                }
                this.getTerminalFromCommandArgs(...args)?.close();
            },
        });
        commands.registerHandler(TerminalCommands.SELECT_ALL.id, this.createTerminalCommandHandler(
            terminal => terminal.selectAll(),
        ));
        commands.registerHandler(TerminalCommands.PASTE_TERMINAL.id, {
            isEnabled: (...args: unknown[]): boolean => {
                const terminal = this.getTerminalFromCommandArgs(...args);
                return !!terminal && this.terminalPreferences['terminal.enablePaste'];
            },
            execute: async (...args: unknown[]): Promise<void> => {
                const terminal = this.getTerminalFromCommandArgs(...args);
                if (!terminal || !this.terminalPreferences['terminal.enablePaste']) {
                    return;
                }
                const text = await this.qaapClipboardService.readText();
                if (text) {
                    terminal.paste(text);
                }
            },
        });
        commands.registerHandler(TerminalCommands.COPY_TERMINAL_SELECTION.id, {
            isEnabled: (...args: unknown[]): boolean => {
                const terminal = this.getTerminalFromCommandArgs(...args);
                return !!terminal
                    && terminal.hasSelection()
                    && this.terminalPreferences['terminal.enableCopy'];
            },
            execute: (...args: unknown[]): void => {
                const terminal = this.getTerminalFromCommandArgs(...args);
                if (terminal && terminal.hasSelection() && this.terminalPreferences['terminal.enableCopy']) {
                    this.copyHandler.syncCopy(terminal.getSelection());
                }
            },
        });
    }

    override async initializeLayout(): Promise<void> {
        if (shouldDeferTerminalLayoutInit()) {
            return;
        }
        await super.initializeLayout();
    }

    protected createTerminalCommandHandler(execute: (terminal: TerminalWidget) => void): {
        isEnabled: (...args: unknown[]) => boolean;
        execute: (...args: unknown[]) => void;
    } {
        return {
            isEnabled: (...args: unknown[]): boolean => !!this.getTerminalFromCommandArgs(...args),
            execute: (...args: unknown[]): void => {
                const terminal = this.getTerminalFromCommandArgs(...args);
                if (terminal) {
                    execute(terminal);
                }
            },
        };
    }

    protected getWorkHubTerminalContext(...args: unknown[]): QaapWorkHubTerminalContext | undefined {
        const terminal = this.getTerminalFromCommandArgs(...args);
        return terminal ? getQaapWorkHubTerminalContext(terminal) : undefined;
    }

    protected getTerminalFromCommandArgs(...args: unknown[]): TerminalWidget | undefined {
        const widget = args.find((arg): arg is TerminalWidget => arg instanceof TerminalWidget);
        if (widget) {
            return widget;
        }

        const anchor = args.find(arg => typeof MouseEvent !== 'undefined' && arg instanceof MouseEvent);
        const target = anchor instanceof MouseEvent ? anchor.target : undefined;
        if (target instanceof Node) {
            const terminal = this.all.find(candidate => candidate.node.contains(target));
            if (terminal) {
                return terminal;
            }
        }

        return this.shell.activeWidget instanceof TerminalWidget
            ? this.shell.activeWidget
            : this.currentTerminal;
    }
}
