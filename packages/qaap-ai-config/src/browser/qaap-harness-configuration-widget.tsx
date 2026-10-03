// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core';
import { codicon, ReactWidget } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { MessageService } from '@theia/core/lib/common/message-service';
import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import {
    QAAP_HARNESS_DEFINITIONS,
    type QaapHarnessDefinition,
} from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { resolveAgentBrand } from '@theia/qaap-shared-core/lib/common/qaap-agent-branding';
import { requestAgentCliUpdate } from '@theia/qaap-agents-ui/lib/common/qaap-agent-cli-update';
import {
    isQaapHarnessEnabled,
    QAAP_DISABLED_HARNESSES_PREF,
    readDisabledHarnessIds,
    withQaapHarnessEnabled,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-preferences';
import {
    resolveHarnessCardAction,
    resolveHarnessCardStatus,
    type HarnessConnectionState,
    type HarnessAvailabilityState,
} from './qaap-harness-configuration-state';

interface HarnessStatus {
    readonly id?: string;
    readonly installed?: boolean;
    readonly enabled?: boolean;
    readonly connectionState?: HarnessConnectionState;
    readonly installSupported?: boolean;
    readonly version?: string;
}

interface HarnessAgentResponse {
    readonly harnesses?: readonly HarnessStatus[];
}

interface LoadedHarnessStatus {
    readonly installed: boolean;
    readonly enabled: boolean;
    readonly connectionState: HarnessConnectionState;
    readonly installSupported: boolean;
    readonly version?: string;
}

const MIN_INSTALL_FEEDBACK_MS = 900;

/** Work Hub configuration for the agent runtimes supported by Qaap. */
@injectable()
export class QaapHarnessConfigurationWidget extends ReactWidget {

    static readonly ID = 'qaap-harness-configuration-widget';
    static readonly LABEL = nls.localize('qaap/aiConfiguration/harness', 'Harness');

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    @inject(MessageService) @optional()
    protected readonly messageService: MessageService | undefined;

    protected harnessStatuses = new Map<string, LoadedHarnessStatus>();
    protected availabilityState: HarnessAvailabilityState = 'loading';
    protected readonly installingHarnessIds = new Set<string>();

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
        const harnessStatus = this.harnessStatuses.get(definition.id);
        const installed = harnessStatus?.installed === true;
        const connectionState = harnessStatus?.connectionState ?? 'unknown';
        const action = resolveHarnessCardAction(
            installed,
            this.availabilityState,
            harnessStatus?.installSupported === true,
        );
        const cardStatus = resolveHarnessCardStatus(installed, this.availabilityState, connectionState);
        const unavailable = action === 'install-unavailable' || action === 'availability-unknown';
        const status = action === 'install-unavailable'
            ? nls.localize(
                'qaap/aiConfiguration/harnessInstallUnavailable',
                'Not available on this server yet',
            )
            : this.renderAvailabilityStatus(cardStatus);
        const installing = this.installingHarnessIds.has(definition.id);
        const cardClasses = [
            'qaap-harness-card',
            enabled && !unavailable ? undefined : 'theia-mod-disabled',
            installed ? undefined : 'qaap-harness-card-unavailable',
            action === 'install-unavailable' ? 'qaap-harness-card-install-unavailable' : undefined,
            installing ? 'qaap-harness-card-installing' : undefined,
        ].filter((className): className is string => className !== undefined);
        return (
            <div
                key={definition.id}
                className={cardClasses.join(' ')}
                role="listitem"
                data-harness-id={definition.id}
            >
                <div className="qaap-harness-card-icon" aria-hidden={true}>
                    {this.renderHarnessBrand(definition.id)}
                </div>
                <div className="qaap-harness-card-body">
                    <div className="qaap-harness-card-title-row">
                        <span className="qaap-harness-card-name">{definition.label}</span>
                        <span className="qaap-harness-card-bin">{definition.bin}</span>
                    </div>
                    <span
                        className={`qaap-harness-card-status${cardStatus === 'available' ? ' theia-mod-available' : ''}${installing ? ' qaap-harness-status-installing' : ''}`}
                        aria-live={installing ? 'polite' : undefined}
                    >
                        {installing
                            ? nls.localize(
                                'qaap/aiConfiguration/harnessInstallingStatus',
                                'Installing in background…',
                            )
                            : status}
                    </span>
                    {installing && <div
                        className="qaap-harness-install-progress"
                        role="progressbar"
                        aria-label={nls.localize(
                            'qaap/aiConfiguration/harnessInstallProgress',
                            'Installing {0}',
                            definition.label,
                        )}
                    >
                        <span className="qaap-harness-install-progress-bar" />
                    </div>}
                </div>
                {installing
                    ? <button
                        type="button"
                        className="qaap-harness-install theia-mod-installing"
                        aria-label={nls.localize(
                            'qaap/aiConfiguration/installingHarness',
                            'Installing harness…',
                        )}
                        title={nls.localize(
                            'qaap/aiConfiguration/installingHarness',
                            'Installing harness…',
                        )}
                        aria-busy={true}
                        disabled={true}
                    >
                        <span className={codicon('loading')} aria-hidden={true} />
                    </button>
                    : action === 'toggle'
                    ? <button
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
                    : action === 'install'
                    ? <button
                        type="button"
                        className="qaap-harness-install"
                        aria-label={nls.localize(
                            'qaap/aiConfiguration/installHarness',
                            'Install {0} harness',
                            definition.label,
                        )}
                        title={nls.localize(
                            'qaap/aiConfiguration/installHarness',
                            'Install {0} harness',
                            definition.label,
                        )}
                        disabled={this.availabilityState !== 'ready'}
                        onClick={() => void this.installHarness(definition)}
                    >
                        <span className={codicon('download')} aria-hidden={true} />
                    </button>
                    : undefined}
            </div>
        );
    }

    protected renderHarnessBrand(harnessId: string): React.ReactNode {
        const brand = resolveAgentBrand(harnessId);
        if (!brand) {
            return <span className={codicon('terminal')} />;
        }
        const iconClass = `theia-qaap-agent-brand-icon theia-mod-md theia-mod-tone-${brand.tone}`;
        if (brand.svgLight && brand.svgDark) {
            return (
                <span className={`qaap-harness-brand-icon ${iconClass} theia-mod-theme-adaptive`}>
                    <span
                        className="theia-mod-agent-icon-for-light"
                        dangerouslySetInnerHTML={{ __html: brand.svgLight }}
                    />
                    <span
                        className="theia-mod-agent-icon-for-dark"
                        dangerouslySetInnerHTML={{ __html: brand.svgDark }}
                    />
                </span>
            );
        }
        return (
            <span
                className={`qaap-harness-brand-icon ${iconClass}`}
                dangerouslySetInnerHTML={{ __html: brand.svg }}
            />
        );
    }

    protected renderAvailabilityStatus(status: ReturnType<typeof resolveHarnessCardStatus>): string {
        switch (status) {
            case 'loading':
                return nls.localize('qaap/aiConfiguration/harnessChecking', 'Checking availability…');
            case 'availability-unknown':
                return nls.localize('qaap/aiConfiguration/harnessAvailabilityUnknown', 'Availability unavailable');
            case 'available':
                return nls.localize('qaap/aiConfiguration/harnessAvailable', 'Available');
            case 'installed-disconnected':
                return nls.localize(
                    'qaap/aiConfiguration/harnessInstalledNeedsSignIn',
                    'Installed · sign in required',
                );
            case 'installed-connection-unknown':
                return nls.localize(
                    'qaap/aiConfiguration/harnessInstalledSignInUnknown',
                    'Installed · sign-in status unknown',
                );
            case 'not-installed':
                return nls.localize('qaap/aiConfiguration/harnessNotInstalled', 'Not installed');
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

    protected async installHarness(definition: QaapHarnessDefinition): Promise<void> {
        if (this.installingHarnessIds.has(definition.id)) {
            return;
        }
        this.installingHarnessIds.add(definition.id);
        this.update();
        try {
            const [result] = await Promise.all([
                requestAgentCliUpdate(definition.id),
                new Promise<void>(resolve => setTimeout(resolve, MIN_INSTALL_FEEDBACK_MS)),
            ]);
            if (!result.ok) {
                throw new Error('Harness installation failed.');
            }
            const disabledIds = readDisabledHarnessIds(this.preferenceService.get(QAAP_DISABLED_HARNESSES_PREF));
            await this.preferenceService.set(
                QAAP_DISABLED_HARNESSES_PREF,
                withQaapHarnessEnabled(disabledIds, definition.id, false),
                PreferenceScope.User,
            );
            this.availabilityState = 'ready';
            this.messageService?.info(nls.localize(
                'qaap/aiConfiguration/harnessInstalled',
                '{0} installed. It is disabled until you enable it.',
                definition.label,
            ));
            await this.loadAvailability();
        } catch {
            this.messageService?.error(nls.localize(
                'qaap/aiConfiguration/installHarnessFailed',
                'Could not install {0}. Please try again later or contact your administrator.',
                definition.label,
            ));
        } finally {
            this.installingHarnessIds.delete(definition.id);
            this.update();
        }
    }

    protected async loadAvailability(): Promise<void> {
        try {
            const response = await fetch('/qaap/api/agent-tasks/harness-status', { credentials: 'same-origin' });
            if (!response.ok) {
                throw new Error(`Harness availability request failed: ${response.status}`);
            }
            const payload = await response.json() as HarnessAgentResponse;
            const harnessStatuses = new Map<string, LoadedHarnessStatus>();
            for (const harness of payload.harnesses ?? []) {
                if (typeof harness.id !== 'string') {
                    continue;
                }
                harnessStatuses.set(harness.id.trim().toLowerCase(), {
                    installed: harness.installed === true,
                    enabled: harness.enabled === true,
                    connectionState: harness.connectionState ?? 'unknown',
                    installSupported: harness.installSupported === true,
                    ...(harness.version ? { version: harness.version } : {}),
                });
            }
            this.harnessStatuses = harnessStatuses;
            this.availabilityState = 'ready';
        } catch {
            this.availabilityState = 'unavailable';
        }
        this.update();
    }
}
