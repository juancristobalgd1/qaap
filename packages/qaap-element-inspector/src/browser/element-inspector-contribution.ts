// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { codicon } from '@theia/core/lib/browser';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { ElementInspectorService } from './element-inspector-service';
import { ElementInspectorWidget } from './element-inspector-widget';
import {
    buildElementCssSelector,
    formatElementAgentPrompt,
    formatElementGenerateVariantPrompt,
    guessElementComponentPath,
} from './qaap-element-inspector-dom-utils';

/** Keep in sync with `@theia/qaap-mobile-shell` {@link QAAP_WORK_HUB_SUBMIT_COMPOSER_PROMPT_COMMAND}. */
const QAAP_WORK_HUB_SUBMIT_COMPOSER_PROMPT_COMMAND = 'qaap.workHub.submitComposerPrompt';
/** Keep in sync with `@theia/qaap-mobile-shell` {@link QAAP_WORK_HUB_OPEN_PARALLEL_RUNS_COMMAND}. */
const QAAP_WORK_HUB_OPEN_PARALLEL_RUNS_COMMAND = 'qaap.workHub.openParallelRunsSheet';

export const ELEMENT_INSPECTOR_TOGGLE_COMMAND_ID = 'theia-mini-browser.element-inspector.toggle';
export const ELEMENT_INSPECTOR_REVEAL_COMMAND_ID = 'theia-mini-browser.element-inspector.reveal';
export const ELEMENT_INSPECTOR_COPY_SELECTOR_COMMAND_ID = 'qaap.element-inspector.copySelector';
export const ELEMENT_INSPECTOR_ASK_AGENT_COMMAND_ID = 'qaap.element-inspector.askAgent';
export const ELEMENT_INSPECTOR_GENERATE_VARIANT_COMMAND_ID = 'qaap.element-inspector.generateVariant';

export namespace ElementInspectorCommands {
    export const TOGGLE: Command = {
        id: ELEMENT_INSPECTOR_TOGGLE_COMMAND_ID,
        category: nls.localize('theia/mini-browser/category', 'Mini Browser'),
        label: nls.localize('theia/mini-browser/toggleElementInspector', 'Toggle Element Inspector'),
        iconClass: codicon('inspect')
    };
    export const REVEAL: Command = {
        id: ELEMENT_INSPECTOR_REVEAL_COMMAND_ID,
        category: nls.localize('theia/mini-browser/category', 'Mini Browser'),
        label: nls.localize('theia/mini-browser/revealElementInspector', 'Reveal Element Inspector')
    };
    export const COPY_SELECTOR: Command = {
        id: ELEMENT_INSPECTOR_COPY_SELECTOR_COMMAND_ID,
        category: nls.localize('theia/mini-browser/category', 'Mini Browser'),
        label: nls.localize('qaap/elementInspector/copySelector', 'Copy selector / component path'),
        iconClass: codicon('copy')
    };
    export const ASK_AGENT: Command = {
        id: ELEMENT_INSPECTOR_ASK_AGENT_COMMAND_ID,
        category: nls.localize('theia/mini-browser/category', 'Mini Browser'),
        label: nls.localize('qaap/elementInspector/askAgent', 'Ask agent about this element'),
        iconClass: codicon('comment-discussion')
    };
    export const GENERATE_VARIANT: Command = {
        id: ELEMENT_INSPECTOR_GENERATE_VARIANT_COMMAND_ID,
        category: nls.localize('theia/mini-browser/category', 'Mini Browser'),
        label: nls.localize('qaap/elementInspector/generateVariant', 'Generate UI variant in repo'),
        iconClass: codicon('sparkle')
    };
}

@injectable()
export class ElementInspectorContribution extends AbstractViewContribution<ElementInspectorWidget> {

    @inject(ElementInspectorService)
    protected readonly inspector: ElementInspectorService;

    @inject(ClipboardService)
    protected readonly clipboard: ClipboardService;

    @inject(MessageService)
    protected readonly messages: MessageService;

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    constructor() {
        super({
            widgetId: ElementInspectorWidget.ID,
            widgetName: ElementInspectorWidget.LABEL,
            defaultWidgetOptions: {
                /** Full editor tab (Cursor-style), not the right side panel. */
                area: 'main',
                mode: 'tab-after'
            },
            toggleCommandId: ELEMENT_INSPECTOR_TOGGLE_COMMAND_ID
        });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(ElementInspectorCommands.REVEAL, {
            execute: () => this.openView({ activate: true, reveal: true })
        });
        registry.registerCommand(ElementInspectorCommands.COPY_SELECTOR, {
            execute: () => this.copySelector(),
            isEnabled: () => !!this.inspector.state.picked,
        });
        registry.registerCommand(ElementInspectorCommands.ASK_AGENT, {
            execute: () => this.askAgentAboutElement(),
            isEnabled: () => !!this.inspector.state.picked,
        });
        registry.registerCommand(ElementInspectorCommands.GENERATE_VARIANT, {
            execute: () => this.generateVariantInRepo(),
            isEnabled: () => !!this.inspector.state.picked,
        });
    }

    protected async copySelector(): Promise<void> {
        const picked = this.inspector.state.picked;
        if (!picked) {
            return;
        }
        const selector = buildElementCssSelector(picked);
        const componentPath = guessElementComponentPath(picked);
        const text = componentPath && componentPath !== picked.domPath
            ? `${selector}\n${componentPath}`
            : selector;
        try {
            await this.clipboard.writeText(text);
            this.messages.info(nls.localize('qaap/elementInspector/copied', 'Copied to clipboard.'));
        } catch {
            this.messages.warn(nls.localize('qaap/elementInspector/copyFailed', 'Could not copy to clipboard.'));
        }
    }

    protected async askAgentAboutElement(): Promise<void> {
        const picked = this.inspector.state.picked;
        if (!picked) {
            return;
        }
        await this.submitPromptToComposerAgent(formatElementAgentPrompt(picked));
    }

    protected async generateVariantInRepo(): Promise<void> {
        const picked = this.inspector.state.picked;
        if (!picked) {
            return;
        }
        if (!this.commands.getCommand(QAAP_WORK_HUB_OPEN_PARALLEL_RUNS_COMMAND)) {
            this.messages.warn(nls.localize(
                'qaap/elementInspector/workHubUnavailable',
                'Work Hub agent submit is unavailable in this session.',
            ));
            return;
        }
        try {
            await this.commands.executeCommand(
                QAAP_WORK_HUB_OPEN_PARALLEL_RUNS_COMMAND,
                formatElementGenerateVariantPrompt(picked),
            );
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.messages.error(nls.localize(
                'qaap/elementInspector/askAgentFailed',
                'Could not ask the agent: {0}',
                detail,
            ));
        }
    }

    /**
     * Send the prompt to the sticky-composer / Work Hub agent currently selected for
     * the project — never to the legacy Theia Chat `@coder` agent.
     */
    protected async submitPromptToComposerAgent(prompt: string): Promise<void> {
        if (!this.commands.getCommand(QAAP_WORK_HUB_SUBMIT_COMPOSER_PROMPT_COMMAND)) {
            this.messages.warn(nls.localize(
                'qaap/elementInspector/workHubUnavailable',
                'Work Hub agent submit is unavailable in this session.',
            ));
            return;
        }
        try {
            await this.commands.executeCommand(QAAP_WORK_HUB_SUBMIT_COMPOSER_PROMPT_COMMAND, prompt);
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.messages.error(nls.localize(
                'qaap/elementInspector/askAgentFailed',
                'Could not ask the agent: {0}',
                detail,
            ));
            return;
        }
        await this.openView({ activate: false, reveal: true });
    }
}
