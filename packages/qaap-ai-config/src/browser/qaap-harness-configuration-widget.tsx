// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core';
import { codicon, ReactWidget } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import {
    QAAP_HARNESS_DEFINITIONS,
    type QaapHarnessDefinition,
} from '@theia/qaap-mobile-shell/lib/common/qaap-builtin-agents';
import {
    isQaapHarnessEnabled,
    QAAP_DISABLED_HARNESSES_PREF,
    readDisabledHarnessIds,
    withQaapHarnessEnabled,
} from '@theia/qaap-mobile-shell/lib/common/qaap-harness-preferences';

interface HarnessAgentResponse {
    readonly agents?: readonly { readonly id?: string; readonly available?: boolean }[];
}

type HarnessAvailabilityState = 'loading' | 'ready' | 'unavailable';

/** Work Hub configuration for the agent runtimes supported by Qaap. */
@injectable()
export class QaapHarnessConfigurationWidget extends ReactWidget {

    static readonly ID = 'qaap-harness-configuration-widget';
    static readonly LABEL = nls.localize('qaap/aiConfiguration/harness', 'Harness');

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    protected availableHarnessIds = new Set<string>();
    protected availabilityState: HarnessAvailabilityState = 'loading';

    @postConstruct()
    protected init(): void {
        this.id = QaapHarnessConfigurationWidget.ID;
        this.title.label = QaapHarnessConfigurationWidget.LABEL;
        this.title.caption = QaapHarnessConfigurationWidget.LABEL;
        this.title.closable = false;
        this.addClass('ai-configuration-widget');
        this.addClass('qaap-ai-harness-configuration');
        this.toDispose.push(this.preferenceService.onPreferenceChanged(event => {
            if (event.preferenceName === QAAP_DISABLED_HARNESSES_PREF) {
                this.update();
            }
        }));
        this.update();
        void this.loadAvailability();
    }

    protected override render(): React.ReactNode {
        const disabledIds = readDisabledHarnessIds(this.preferenceService.get(QAAP_DISABLED_HARNESSES_PREF));
        return (
            <div className="qaap-harness-configuration-content">
                <div className="qaap-harness-section-header">
                    <div className="qaap-harness-heading-row">
                        <h3 className="section-header">
                            {nls.localize('qaap/aiConfiguration/harnesses', 'Supported runtimes')}
                        </h3>
                        <span className="qaap-harness-count">
                            {nls.localize(
                                'qaap/aiConfiguration/harnessCount',
                                '{0} runtimes',
                                QAAP_HARNESS_DEFINITIONS.length,
                            )}
                        </span>
                    </div>
                    <p className="qaap-harness-section-hint">
                        {nls.localize(
                            'qaap/aiConfiguration/harnessHint',
                            'Choose which runtimes appear in the Work Hub composer. Changes apply to new conversations.',
                        )}
                    </p>
                </div>
                <div className="qaap-harness-list" role="list">
                    {QAAP_HARNESS_DEFINITIONS.map(definition => this.renderHarnessCard(definition, disabledIds))}
                </div>
            </div>
        );
    }

    protected renderHarnessCard(
        definition: QaapHarnessDefinition,
        disabledIds: readonly string[],
    ): React.ReactNode {
        const enabled = isQaapHarnessEnabled(definition.id, disabledIds);
        const available = this.availableHarnessIds.has(definition.id);
        const status = this.renderAvailabilityStatus(available);
        return (
            <div
                key={definition.id}
                className={`qaap-harness-card${enabled ? '' : ' theia-mod-disabled'}${available ? '' : ' qaap-harness-card-unavailable'}`}
                role="listitem"
                data-harness-id={definition.id}
            >
                <div className="qaap-harness-card-icon" aria-hidden={true}>
                    <span className={codicon('terminal')} />
                </div>
                <div className="qaap-harness-card-body">
                    <div className="qaap-harness-card-title-row">
                        <span className="qaap-harness-card-name">{definition.label}</span>
                        <span className="qaap-harness-card-bin">{definition.bin}</span>
                    </div>
                    <p className="qaap-harness-card-description">
                        {this.harnessDescription(definition.id)}
                    </p>
                    <span className={`qaap-harness-card-status${available ? ' theia-mod-available' : ''}`}>
                        {status}
                    </span>
                </div>
                <button
                    type="button"
                    className={`qaap-harness-toggle${enabled ? ' theia-mod-on' : ''}`}
                    role="switch"
                    aria-checked={enabled}
                    aria-label={nls.localize(
                        'qaap/aiConfiguration/toggleHarness',
                        'Toggle {0} harness',
                        definition.label,
                    )}
                    title={enabled
                        ? nls.localize('qaap/aiConfiguration/disableHarness', 'Disable harness')
                        : nls.localize('qaap/aiConfiguration/enableHarness', 'Enable harness')}
                    onClick={() => void this.toggleHarness(definition.id, !enabled)}
                />
            </div>
        );
    }

    protected renderAvailabilityStatus(available: boolean): string {
        if (this.availabilityState === 'loading') {
            return nls.localize('qaap/aiConfiguration/harnessChecking', 'Checking availability…');
        }
        if (this.availabilityState === 'unavailable') {
            return nls.localize('qaap/aiConfiguration/harnessAvailabilityUnknown', 'Availability unavailable');
        }
        return available
            ? nls.localize('qaap/aiConfiguration/harnessAvailable', 'Available on this workspace')
            : nls.localize('qaap/aiConfiguration/harnessNotDetected', 'Not detected on this workspace');
    }

    protected harnessDescription(harnessId: string): string {
        switch (harnessId) {
            case 'qaiq':
                return nls.localize('qaap/aiConfiguration/harnessQaiq', 'Qaap native agent runtime.');
            case 'codex':
                return nls.localize('qaap/aiConfiguration/harnessCodex', 'OpenAI Codex CLI for code changes and repository tasks.');
            case 'claude':
                return nls.localize('qaap/aiConfiguration/harnessClaude', 'Anthropic Claude Code CLI with structured tool output.');
            case 'openclaude':
                return nls.localize('qaap/aiConfiguration/harnessOpenClaude', 'OpenClaude-compatible agent runtime.');
            case 'grok':
                return nls.localize('qaap/aiConfiguration/harnessGrok', 'Grok Build CLI for autonomous coding tasks.');
            case 'opencode':
                return nls.localize('qaap/aiConfiguration/harnessOpenCode', 'OpenCode CLI with JSON transcript support.');
            case 'goose':
                return nls.localize('qaap/aiConfiguration/harnessGoose', 'Goose agent runtime for repository automation.');
            case 'hermes':
                return nls.localize('qaap/aiConfiguration/harnessHermes', 'Hermes coding agent backed by OpenRouter.');
            case 'openclaw':
                return nls.localize('qaap/aiConfiguration/harnessOpenClaw', 'OpenClaw local agent runtime.');
            case 'cursor':
                return nls.localize('qaap/aiConfiguration/harnessCursor', 'Cursor Agent CLI for autonomous coding.');
            case 'antigravity':
                return nls.localize('qaap/aiConfiguration/harnessAntigravity', 'Antigravity CLI, including the Gemini CLI entry point.');
            case 'copilot':
                return nls.localize('qaap/aiConfiguration/harnessCopilot', 'GitHub Copilot CLI for assisted coding tasks.');
            case 'qwen':
                return nls.localize('qaap/aiConfiguration/harnessQwen', 'Qwen Code CLI for repository work.');
            case 'kimi':
                return nls.localize('qaap/aiConfiguration/harnessKimi', 'Kimi CLI for coding-agent tasks.');
            default:
                return nls.localize('qaap/aiConfiguration/harnessGeneric', 'Supported coding-agent runtime.');
        }
    }

    protected async toggleHarness(harnessId: string, enabled: boolean): Promise<void> {
        const disabledIds = readDisabledHarnessIds(this.preferenceService.get(QAAP_DISABLED_HARNESSES_PREF));
        await this.preferenceService.set(
            QAAP_DISABLED_HARNESSES_PREF,
            withQaapHarnessEnabled(disabledIds, harnessId, enabled),
            PreferenceScope.User,
        );
        this.update();
    }

    protected async loadAvailability(): Promise<void> {
        try {
            const response = await fetch('/qaap/api/agent-tasks/all', { credentials: 'same-origin' });
            if (!response.ok) {
                throw new Error(`Harness availability request failed: ${response.status}`);
            }
            const payload = await response.json() as HarnessAgentResponse;
            this.availableHarnessIds = new Set(
                (payload.agents ?? [])
                    .filter(agent => agent.available !== false && typeof agent.id === 'string')
                    .map(agent => agent.id!.trim().toLowerCase()),
            );
            this.availabilityState = 'ready';
        } catch {
            this.availabilityState = 'unavailable';
        }
        this.update();
    }
}
