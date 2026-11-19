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
import { QaapAgentCliUpdateTracker } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-cli-update-tracker';
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
    type HarnessLastTurn,
    type HarnessLastTurnFailureKind,
    parseHarnessLastTurn,
    resolveHarnessLastTurnAge,
    resolveHarnessSettingsRows,
    type HarnessSettingsRow,
} from './qaap-harness-configuration-state';
import {
    nextQaapHarnessInstanceId,
    QAAP_HARNESS_INSTANCES_PREF,
    QAAP_HARNESS_SETTINGS_PREF,
    readQaapHarnessInstances,
    readQaapHarnessSettingsFor,
    resolveQaapHarnessDisplayLabel,
    resolveQaapHarnessHomeEnvVar,
    withQaapHarnessSettings,
    type QaapHarnessInstance,
    type QaapHarnessLaunchSettings,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-launch-settings';
import type { QaapHarnessEnvVariableStatus } from './qaap-harness-env-section';
import {
    QaapHarnessSettingsPanel,
    type QaapHarnessSettingsPathIssues,
} from './qaap-harness-settings-panel';

interface HarnessStatus {
    readonly id?: string;
    readonly installed?: boolean;
    readonly enabled?: boolean;
    readonly connectionState?: HarnessConnectionState;
    readonly installSupported?: boolean;
    readonly installPackageAvailable?: boolean;
    readonly version?: string;
    readonly lastTurn?: unknown;
}

interface HarnessAgentResponse {
    readonly harnesses?: readonly HarnessStatus[];
    readonly launchOverridesSupported?: boolean;
}

const QAAP_HARNESS_SETTINGS_CHECK_PATH = '/qaap/api/agent-tasks/harness-settings/check';
const QAAP_HARNESS_ENV_PATH = '/qaap/api/agent-tasks/harness-settings/env';
const HARNESS_PREFERENCE_NAMES = new Set([QAAP_DISABLED_HARNESSES_PREF, QAAP_HARNESS_SETTINGS_PREF, QAAP_HARNESS_INSTANCES_PREF]);

interface LoadedHarnessStatus {
    readonly installed: boolean;
    readonly enabled: boolean;
    readonly connectionState: HarnessConnectionState;
    readonly installSupported: boolean;
    readonly installPackageAvailable: boolean;
    readonly version?: string;
    readonly lastTurn?: HarnessLastTurn;
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
    /** Harness updates started from the update notice or chip; drives the row's busy state. */
    @inject(QaapAgentCliUpdateTracker)
    protected readonly updateTracker: QaapAgentCliUpdateTracker;
    protected readonly installingHarnessIds = new Set<string>();
    /** Desktop app only (reported by the backend): binary path and configuration folder are editable. */
    protected launchOverridesSupported = false;
    /** Harness whose settings panel (gear) is open. */
    protected expandedHarnessId: string | undefined;
    /** Base harness picked in the "Add harness" form, or undefined while the form is closed. */
    protected addHarnessBaseId: string | undefined;

    @postConstruct()
    protected init(): void {
        this.id = QaapHarnessConfigurationWidget.ID;
        this.title.label = QaapHarnessConfigurationWidget.LABEL;
        this.title.caption = QaapHarnessConfigurationWidget.LABEL;
        this.title.closable = false;
        this.addClass('ai-configuration-widget');
        this.addClass('qaap-ai-harness-configuration');
        this.toDispose.push(this.preferenceService.onPreferenceChanged(event => {
            if (HARNESS_PREFERENCE_NAMES.has(event.preferenceName)) {
                this.update();
            }
        }));
        this.toDispose.push(this.updateTracker.onDidChange(() => this.update()));
        this.update();
        void this.loadAvailability();
    }

    protected override render(): React.ReactNode {
        const disabledIds = readDisabledHarnessIds(this.preferenceService.get(QAAP_DISABLED_HARNESSES_PREF));
        const rows = this.resolveRows();
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
                                rows.length,
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
                    {rows.map(row => this.renderHarnessCard(row, disabledIds))}
                </div>
                {this.renderAddHarness()}
            </div>
        );
    }

    protected readInstances(): QaapHarnessInstance[] {
        return readQaapHarnessInstances(
            this.preferenceService.get(QAAP_HARNESS_INSTANCES_PREF),
            QAAP_HARNESS_DEFINITIONS.map(definition => definition.id),
        );
    }

    protected resolveRows(): HarnessSettingsRow[] {
        const settings = this.preferenceService.get(QAAP_HARNESS_SETTINGS_PREF);
        return resolveHarnessSettingsRows(
            QAAP_HARNESS_DEFINITIONS,
            this.readInstances(),
            (harnessId, baseLabel) => resolveQaapHarnessDisplayLabel(settings, harnessId, baseLabel),
        );
    }

    protected renderHarnessCard(
        row: HarnessSettingsRow,
        disabledIds: readonly string[],
    ): React.ReactNode {
        const definition = { id: row.id, label: row.label, bin: row.bin };
        const enabled = isQaapHarnessEnabled(row.id, disabledIds);
        const harnessStatus = this.harnessStatuses.get(row.baseId);
        const installed = harnessStatus?.installed === true;
        const connectionState = harnessStatus?.connectionState ?? 'unknown';
        const baseAction = resolveHarnessCardAction(
            installed,
            this.availabilityState,
            harnessStatus?.installSupported === true,
            harnessStatus?.installPackageAvailable !== false,
        );
        // An instance installs nothing of its own: it runs its base harness's CLI.
        const action = row.isInstance && baseAction === 'install' ? 'availability-unknown' : baseAction;
        const expanded = this.expandedHarnessId === row.id;
        const cardStatus = resolveHarnessCardStatus(installed, this.availabilityState, connectionState);
        const installUnavailable = action === 'install-unavailable' || action === 'install-no-package';
        const unavailable = installUnavailable || action === 'availability-unknown';
        const status = row.isInstance && !installed && this.availabilityState === 'ready'
            ? nls.localize('qaap/aiConfiguration/harnessInstanceNeedsBase', 'Install {0} to use this harness', row.baseLabel)
            : action === 'install-no-package'
            ? nls.localize(
                'qaap/aiConfiguration/harnessInstallNoPackage',
                'No installable package for this server yet',
            )
            : action === 'install-unavailable'
                ? nls.localize(
                    'qaap/aiConfiguration/harnessInstallUnavailable',
                    'Installation is not enabled on this server',
                )
                : this.renderAvailabilityStatus(cardStatus);
        const installing = this.installingHarnessIds.has(definition.id);
        const updating = this.updateTracker.isUpdating(definition.id);
        const busy = installing || updating;
        const busyStatusText = updating && !installing
            ? nls.localize('qaap/aiConfiguration/harnessUpdatingStatus', 'Updating in background…')
            : nls.localize('qaap/aiConfiguration/harnessInstallingStatus', 'Installing in background…');
        const busyLabel = updating && !installing
            ? nls.localize('qaap/aiConfiguration/updatingHarness', 'Updating harness…')
            : nls.localize('qaap/aiConfiguration/installingHarness', 'Installing harness…');
        const cardClasses = [
            'qaap-harness-card',
            enabled && !unavailable ? undefined : 'theia-mod-disabled',
            installed ? undefined : 'qaap-harness-card-unavailable',
            installUnavailable ? 'qaap-harness-card-install-unavailable' : undefined,
            busy ? 'qaap-harness-card-installing' : undefined,
            expanded ? 'qaap-harness-card-expanded' : undefined,
        ].filter((className): className is string => className !== undefined);
        return (
            <div
                key={definition.id}
                className={cardClasses.join(' ')}
                role="listitem"
                data-harness-id={definition.id}
            >
                <div className="qaap-harness-card-icon" aria-hidden={true}>
                    {this.renderHarnessBrand(row.baseId)}
                </div>
                <div className="qaap-harness-card-body">
                    <div className="qaap-harness-card-title-row">
                        <span className="qaap-harness-card-name">{definition.label}</span>
                        <span className="qaap-harness-card-bin">{row.isInstance ? row.id : definition.bin}</span>
                    </div>
                    <span
                        className={`qaap-harness-card-status${cardStatus === 'available' ? ' theia-mod-available' : ''}${busy ? ' qaap-harness-status-installing' : ''}`}
                        aria-live={busy ? 'polite' : undefined}
                    >
                        {busy ? busyStatusText : status}
                    </span>
                    {!busy && installed && harnessStatus?.lastTurn && this.renderLastTurn(harnessStatus.lastTurn)}
                    {busy && <div
                        className="qaap-harness-install-progress"
                        role="progressbar"
                        aria-label={updating && !installing
                            ? nls.localize('qaap/aiConfiguration/harnessUpdateProgress', 'Updating {0}', definition.label)
                            : nls.localize('qaap/aiConfiguration/harnessInstallProgress', 'Installing {0}', definition.label)}
                    >
                        <span className="qaap-harness-install-progress-bar" />
                    </div>}
                </div>
                <div className="qaap-harness-card-actions">
                    {this.renderSettingsButton(row, expanded)}
                    {busy
                        ? <button
                            type="button"
                            className="qaap-harness-install theia-mod-installing"
                            aria-label={busyLabel}
                            title={busyLabel}
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
                {expanded && this.renderSettingsPanel(row)}
            </div>
        );
    }

    protected renderSettingsButton(row: HarnessSettingsRow, expanded: boolean): React.ReactNode {
        const label = nls.localize('qaap/aiConfiguration/harnessSettings', '{0} settings', row.label);
        return (
            <button
                type="button"
                className={`qaap-harness-settings-button${expanded ? ' theia-mod-active' : ''}`}
                aria-label={label}
                title={label}
                aria-expanded={expanded}
                data-harness-id={row.id}
                onClick={this.onSettingsButtonClick}
            >
                <span className={codicon('settings-gear')} aria-hidden={true} />
            </button>
        );
    }

    protected onSettingsButtonClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
        const harnessId = event.currentTarget.dataset.harnessId;
        this.expandedHarnessId = this.expandedHarnessId === harnessId ? undefined : harnessId;
        this.update();
    };

    protected renderSettingsPanel(row: HarnessSettingsRow): React.ReactNode {
        const settings = readQaapHarnessSettingsFor(this.preferenceService.get(QAAP_HARNESS_SETTINGS_PREF), row.id);
        return (
            <QaapHarnessSettingsPanel
                key={`${row.id}:${this.launchOverridesSupported ? 'desktop' : 'web'}`}
                harnessId={row.id}
                defaultLabel={resolveQaapHarnessDisplayLabel(undefined, row.id, row.baseLabel)}
                defaultBin={row.bin}
                homeEnvVar={resolveQaapHarnessHomeEnvVar(row.baseId)}
                settings={settings}
                launchOverridesSupported={this.launchOverridesSupported}
                isInstance={row.isInstance}
                checkPaths={this.checkHarnessPaths}
                onSave={next => this.saveHarnessSettings(row.id, next)}
                onReset={() => this.resetHarnessSettings(row.id)}
                onDelete={row.isInstance ? () => this.deleteHarnessInstance(row.id) : undefined}
                env={this.launchOverridesSupported ? {
                    load: () => this.loadHarnessEnv(row.id),
                    setVariable: (name, value) => this.setHarnessEnv(row.id, name, value),
                    deleteVariable: name => this.deleteHarnessEnv(row.id, name),
                } : undefined}
            />
        );
    }

    protected renderAddHarness(): React.ReactNode {
        if (this.addHarnessBaseId === undefined) {
            return (
                <button type="button" className="qaap-harness-add-button" onClick={this.openAddHarness}>
                    <span className={codicon('add')} aria-hidden={true} />
                    {nls.localize('qaap/aiConfiguration/addHarness', 'Add harness')}
                </button>
            );
        }
        const instances = this.readInstances();
        const canAdd = nextQaapHarnessInstanceId(this.addHarnessBaseId, instances) !== undefined;
        return (
            <div className="qaap-harness-add-form" role="group" aria-label={nls.localize('qaap/aiConfiguration/addHarness', 'Add harness')}>
                <label className="qaap-harness-settings-field" htmlFor="qaap-harness-add-base">
                    <span className="qaap-harness-settings-field-label">
                        {nls.localize('qaap/aiConfiguration/addHarnessBase', 'Harness')}
                    </span>
                    <select
                        id="qaap-harness-add-base"
                        className="theia-select qaap-harness-settings-input"
                        value={this.addHarnessBaseId}
                        onChange={this.onAddHarnessBaseChange}
                    >
                        {QAAP_HARNESS_DEFINITIONS.map(definition => (
                            <option key={definition.id} value={definition.id}>{definition.label}</option>
                        ))}
                    </select>
                    <span className={canAdd ? 'qaap-harness-settings-hint' : 'qaap-harness-settings-error'}>
                        {canAdd
                            ? nls.localize(
                                'qaap/aiConfiguration/addHarnessHint',
                                'Adds another copy of this harness with its own name, binary and configuration folder, for example a second account.',
                            )
                            : nls.localize('qaap/aiConfiguration/addHarnessLimit', 'This harness already has the maximum number of copies.')}
                    </span>
                </label>
                <div className="qaap-harness-settings-actions">
                    <button type="button" className="theia-button secondary" onClick={this.closeAddHarness}>
                        {nls.localizeByDefault('Cancel')}
                    </button>
                    <button type="button" className="theia-button main" disabled={!canAdd} onClick={this.confirmAddHarness}>
                        {nls.localizeByDefault('Add')}
                    </button>
                </div>
            </div>
        );
    }

    protected openAddHarness = (): void => {
        this.addHarnessBaseId = QAAP_HARNESS_DEFINITIONS[0]?.id;
        this.update();
    };

    protected closeAddHarness = (): void => {
        this.addHarnessBaseId = undefined;
        this.update();
    };

    protected onAddHarnessBaseChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
        this.addHarnessBaseId = event.currentTarget.value;
        this.update();
    };

    protected confirmAddHarness = (): void => {
        const baseId = this.addHarnessBaseId;
        if (baseId) {
            void this.addHarnessInstance(baseId);
        }
    };

    protected async addHarnessInstance(baseId: string): Promise<void> {
        const instances = this.readInstances();
        const id = nextQaapHarnessInstanceId(baseId, instances);
        if (!id) {
            return;
        }
        await this.preferenceService.set(
            QAAP_HARNESS_INSTANCES_PREF,
            [...instances, { id, baseId }],
            PreferenceScope.User,
        );
        this.addHarnessBaseId = undefined;
        this.expandedHarnessId = id;
        this.update();
    }

    protected async deleteHarnessInstance(instanceId: string): Promise<void> {
        const instances = this.readInstances().filter(instance => instance.id !== instanceId);
        await this.preferenceService.set(QAAP_HARNESS_INSTANCES_PREF, instances, PreferenceScope.User);
        await this.resetHarnessSettings(instanceId);
        const disabledIds = readDisabledHarnessIds(this.preferenceService.get(QAAP_DISABLED_HARNESSES_PREF));
        if (!isQaapHarnessEnabled(instanceId, disabledIds)) {
            await this.preferenceService.set(
                QAAP_DISABLED_HARNESSES_PREF,
                withQaapHarnessEnabled(disabledIds, instanceId, true),
                PreferenceScope.User,
            );
        }
        if (this.expandedHarnessId === instanceId) {
            this.expandedHarnessId = undefined;
        }
        this.update();
    }

    /**
     * Saves the panel fields. The variable names are owned by the Environment section, so a save keeps
     * the stored ones; `undefined` removes the whole entry (see {@link resetHarnessSettings}).
     */
    protected async saveHarnessSettings(harnessId: string, settings: QaapHarnessLaunchSettings | undefined): Promise<void> {
        const current = this.preferenceService.get(QAAP_HARNESS_SETTINGS_PREF);
        const envNames = readQaapHarnessSettingsFor(current, harnessId).envNames;
        const next = settings && envNames?.length ? { ...settings, envNames } : settings;
        await this.preferenceService.set(
            QAAP_HARNESS_SETTINGS_PREF,
            withQaapHarnessSettings(current, harnessId, next),
            PreferenceScope.User,
        );
        this.update();
    }

    /** Restore defaults / Delete harness: the stored variable values go too, then the settings entry. */
    protected async resetHarnessSettings(harnessId: string): Promise<void> {
        const envNames = readQaapHarnessSettingsFor(this.preferenceService.get(QAAP_HARNESS_SETTINGS_PREF), harnessId).envNames ?? [];
        if (this.launchOverridesSupported || envNames.length > 0) {
            try {
                await this.postHarnessEnv('/delete', { harnessId });
            } catch {
                if (this.launchOverridesSupported) {
                    this.messageService?.error(nls.localize(
                        'qaap/aiConfiguration/harnessEnvClearFailed',
                        'Could not delete the stored variable values of this harness.',
                    ));
                    return;
                }
                // Outside the desktop app no value can be stored for this harness: only the names remain.
            }
        }
        await this.saveHarnessSettings(harnessId, undefined);
    }

    protected async postHarnessEnv(suffix: '' | '/delete', body: Record<string, string>): Promise<void> {
        const response = await fetch(`${QAAP_HARNESS_ENV_PATH}${suffix}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            let message: string | undefined;
            try {
                message = ((await response.json()) as { error?: unknown }).error as string | undefined;
            } catch {
                message = undefined;
            }
            throw new Error(typeof message === 'string' ? message : `Harness variable request failed: ${response.status}`);
        }
    }

    protected async loadHarnessEnv(harnessId: string): Promise<readonly QaapHarnessEnvVariableStatus[]> {
        const response = await fetch(`${QAAP_HARNESS_ENV_PATH}?harnessId=${encodeURIComponent(harnessId)}`, { credentials: 'same-origin' });
        if (!response.ok) {
            throw new Error(`Harness variables request failed: ${response.status}`);
        }
        const payload = await response.json() as { variables?: QaapHarnessEnvVariableStatus[] };
        return (payload.variables ?? []).filter(variable => typeof variable?.name === 'string')
            .map(variable => ({ name: variable.name, hasValue: variable.hasValue === true }));
    }

    /** The value goes to the backend secret store only; the preferences record the name. */
    protected async setHarnessEnv(harnessId: string, name: string, value: string): Promise<void> {
        await this.postHarnessEnv('', { harnessId, name, value });
        await this.writeHarnessEnvNames(harnessId, names => names.includes(name) ? names : [...names, name]);
    }

    protected async deleteHarnessEnv(harnessId: string, name: string): Promise<void> {
        await this.postHarnessEnv('/delete', { harnessId, name });
        await this.writeHarnessEnvNames(harnessId, names => names.filter(existing => existing !== name));
    }

    protected async writeHarnessEnvNames(harnessId: string, change: (names: readonly string[]) => readonly string[]): Promise<void> {
        const current = this.preferenceService.get(QAAP_HARNESS_SETTINGS_PREF);
        const settings = readQaapHarnessSettingsFor(current, harnessId);
        const envNames = change(settings.envNames ?? []);
        const { envNames: _previous, ...rest } = settings;
        await this.preferenceService.set(
            QAAP_HARNESS_SETTINGS_PREF,
            withQaapHarnessSettings(current, harnessId, envNames.length > 0 ? { ...rest, envNames } : rest),
            PreferenceScope.User,
        );
    }

    /** Server-side check of the paths (desktop backend only); a failed request blocks the save. */
    protected checkHarnessPaths = async (settings: QaapHarnessLaunchSettings): Promise<QaapHarnessSettingsPathIssues> => {
        try {
            const response = await fetch(QAAP_HARNESS_SETTINGS_CHECK_PATH, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            if (!response.ok) {
                throw new Error(`Harness settings check failed: ${response.status}`);
            }
            return await response.json() as QaapHarnessSettingsPathIssues;
        } catch {
            this.messageService?.error(nls.localize(
                'qaap/aiConfiguration/harnessSettingsCheckFailed',
                'Could not check the harness paths. The settings were not saved.',
            ));
            return { ...(settings.binaryPath ? { binaryPathIssue: 'missing' } : {}), ...(settings.homeDir ? { homeDirIssue: 'missing' } : {}) };
        }
    };

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
        let failureReason: string | undefined;
        try {
            const [result] = await Promise.all([
                requestAgentCliUpdate(definition.id),
                new Promise<void>(resolve => setTimeout(resolve, MIN_INSTALL_FEEDBACK_MS)),
            ]);
            if (!result.ok) {
                failureReason = result.message?.trim() || undefined;
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
            this.messageService?.error(failureReason
                ? nls.localize('qaap/aiConfiguration/installHarnessFailedReason', 'Could not install {0}: {1}', definition.label, failureReason)
                : nls.localize(
                    'qaap/aiConfiguration/installHarnessFailed',
                    'Could not install {0}. Please try again later or contact your administrator.',
                    definition.label,
                ));
        } finally {
            this.installingHarnessIds.delete(definition.id);
            this.update();
        }
    }

    /** "Last turn: OK · 5 min ago" / "Last turn failed: signed out · 2 h ago" under the card status. */
    protected renderLastTurn(lastTurn: HarnessLastTurn): React.ReactNode {
        const failed = lastTurn.outcome === 'failed';
        const summary = failed
            ? nls.localize('qaap/aiConfiguration/harnessLastTurnFailed', 'Last turn failed: {0}', this.describeLastTurnFailure(lastTurn.kind ?? 'exit_code'))
            : nls.localize('qaap/aiConfiguration/harnessLastTurnOk', 'Last turn: OK');
        return (
            <span
                className={`qaap-harness-card-last-turn${failed ? ' theia-mod-failed' : ''}`}
                data-last-turn-outcome={lastTurn.outcome}
                title={new Date(lastTurn.at).toLocaleString(nls.locale ?? nls.defaultLocale)}
            >
                {summary} · {this.describeLastTurnAge(lastTurn.at)}
            </span>
        );
    }

    protected describeLastTurnFailure(kind: HarnessLastTurnFailureKind): string {
        switch (kind) {
            case 'auth': return nls.localize('qaap/aiConfiguration/harnessLastTurnAuth', 'signed out');
            case 'quota': return nls.localize('qaap/aiConfiguration/harnessLastTurnQuota', 'quota exhausted');
            case 'rate_limit': return nls.localize('qaap/aiConfiguration/harnessLastTurnRateLimit', 'rate limited');
            case 'model_unavailable': return nls.localize('qaap/aiConfiguration/harnessLastTurnModel', 'model unavailable');
            case 'tool_unsupported': return nls.localize('qaap/aiConfiguration/harnessLastTurnTools', 'model cannot use tools');
            case 'cli_missing': return nls.localize('qaap/aiConfiguration/harnessLastTurnCliMissing', 'CLI not found');
            case 'timeout': return nls.localize('qaap/aiConfiguration/harnessLastTurnTimeout', 'timed out');
            case 'network': return nls.localize('qaap/aiConfiguration/harnessLastTurnNetwork', 'network error');
            default: return nls.localize('qaap/aiConfiguration/harnessLastTurnExitCode', 'exited with an error');
        }
    }

    protected describeLastTurnAge(at: number): string {
        const age = resolveHarnessLastTurnAge(at, Date.now());
        switch (age.unit) {
            case 'now': return nls.localize('qaap/aiConfiguration/harnessLastTurnJustNow', 'just now');
            case 'minutes': return nls.localizeByDefault('{0} min ago', age.value);
            case 'hours': return nls.localize('qaap/aiConfiguration/harnessLastTurnHoursAgo', '{0} h ago', age.value);
            default: return nls.localize('qaap/aiConfiguration/harnessLastTurnDaysAgo', '{0} d ago', age.value);
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
                const lastTurn = parseHarnessLastTurn(harness.lastTurn);
                harnessStatuses.set(harness.id.trim().toLowerCase(), {
                    installed: harness.installed === true,
                    enabled: harness.enabled === true,
                    connectionState: harness.connectionState ?? 'unknown',
                    installSupported: harness.installSupported === true,
                    installPackageAvailable: harness.installPackageAvailable !== false,
                    ...(harness.version ? { version: harness.version } : {}),
                    ...(lastTurn ? { lastTurn } : {}),
                });
            }
            this.harnessStatuses = harnessStatuses;
            this.launchOverridesSupported = payload.launchOverridesSupported === true;
            this.availabilityState = 'ready';
        } catch {
            this.availabilityState = 'unavailable';
        }
        this.update();
    }
}
