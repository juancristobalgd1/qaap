// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core';
import * as React from '@theia/core/shared/react';
import {
    checkQaapHarnessPathShape,
    QAAP_HARNESS_LABEL_MAX_LENGTH,
    QAAP_HARNESS_PATH_MAX_LENGTH,
    type QaapHarnessLaunchSettings,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-launch-settings';
import { resolveQaapBuiltinAgentSignOut } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { isQaapHarnessSignOutSupported } from '@theia/qaap-shared-core/lib/common/qaap-harness-sign-out';
import { QaapHarnessEnvSection, type QaapHarnessEnvSectionProps } from './qaap-harness-env-section';

/** Issue codes of `POST /qaap/api/agent-tasks/harness-settings/check` and the static shape check. */
export type QaapHarnessSettingsPathIssue =
    'not-absolute' | 'unsafe-characters' | 'too-long' | 'missing' | 'not-a-file' | 'not-executable' | 'not-a-directory';

export interface QaapHarnessSettingsPathIssues {
    readonly binaryPathIssue?: QaapHarnessSettingsPathIssue;
    readonly homeDirIssue?: QaapHarnessSettingsPathIssue;
}

export interface HarnessSignOutConfirmCopy {
    readonly title: string;
    readonly msg: string;
    readonly ok: string;
    readonly cancel: string;
}

/**
 * Fail-closed visibility gate for the Sign out button in Settings → Harness: only base harnesses
 * that currently have an active session (`connectionState === 'connected'`) and declare a supported
 * sign-out strategy (`signOut.kind !== 'none'`) show it.
 */
export function canSignOutHarnessRow(
    row: { readonly baseId: string; readonly isInstance: boolean },
    connectionState: string | undefined,
): boolean {
    if (row.isInstance || connectionState !== 'connected') {
        return false;
    }
    return isQaapHarnessSignOutSupported(resolveQaapBuiltinAgentSignOut(row.baseId));
}

/** Confirmation dialog copy for signing out of one harness from Settings → Harness. */
export function buildHarnessSignOutConfirmCopy(
    label: string,
    removesAllProviders: boolean,
): HarnessSignOutConfirmCopy {
    return {
        title: nls.localize('qaap/aiConfiguration/harnessSignOutConfirmTitle', 'Sign out of {0}', label),
        msg: removesAllProviders
            ? nls.localize(
                'qaap/aiConfiguration/harnessSignOutConfirmMsgAllProviders',
                'Sign out of {0}? This will remove all providers saved in this CLI. You will need to sign in again to use its Pro models.',
                label,
            )
            : nls.localize(
                'qaap/aiConfiguration/harnessSignOutConfirmMsg',
                'Sign out of {0}? You will need to sign in again to use its Pro models.',
                label,
            ),
        ok: nls.localize('qaap/aiConfiguration/harnessSignOut', 'Sign out'),
        cancel: nls.localizeByDefault('Cancel'),
    };
}

export interface QaapHarnessSettingsPanelProps {
    readonly harnessId: string;
    /** Name shown when the user has not set one (`Codex`, `Codex 2`). */
    readonly defaultLabel: string;
    /** Executable looked up on PATH when no binary path is set. */
    readonly defaultBin: string;
    /** `CODEX_HOME` / `CLAUDE_CONFIG_DIR`, or undefined when the harness has no configuration-folder variable. */
    readonly homeEnvVar: string | undefined;
    readonly settings: QaapHarnessLaunchSettings;
    /** Desktop app only: binary path and configuration folder fields are shown and applied. */
    readonly launchOverridesSupported: boolean;
    readonly isInstance: boolean;
    readonly checkPaths: (settings: QaapHarnessLaunchSettings) => Promise<QaapHarnessSettingsPathIssues>;
    readonly onSave: (settings: QaapHarnessLaunchSettings) => Promise<void>;
    readonly onReset: () => Promise<void>;
    readonly onDelete?: () => Promise<void>;
    /** Provided only when the harness is connected and supports sign-out (fail-closed). */
    readonly onSignOut?: () => Promise<void>;
    /** True for CLIs whose sign-out removes all saved providers (OpenCode, Pi). */
    readonly signOutRemovesAllProviders?: boolean;
    /** Environment variables (desktop app only, with {@link launchOverridesSupported}). */
    readonly env?: Omit<QaapHarnessEnvSectionProps, 'harnessId'>;
}

export function describeQaapHarnessSettingsPathIssue(issue: QaapHarnessSettingsPathIssue): string {
    switch (issue) {
        case 'not-absolute': return nls.localize('qaap/aiConfiguration/harnessPathNotAbsolute', 'Use an absolute path.');
        case 'unsafe-characters': return nls.localize('qaap/aiConfiguration/harnessPathUnsafe', 'The path contains characters that are not allowed.');
        case 'too-long': return nls.localize('qaap/aiConfiguration/harnessPathTooLong', 'The path is too long.');
        case 'missing': return nls.localize('qaap/aiConfiguration/harnessPathMissing', 'Nothing exists at this path.');
        case 'not-a-file': return nls.localize('qaap/aiConfiguration/harnessPathNotFile', 'This path is not a file.');
        case 'not-executable': return nls.localize('qaap/aiConfiguration/harnessPathNotExecutable', 'This file is not executable.');
        case 'not-a-directory': return nls.localize('qaap/aiConfiguration/harnessPathNotDirectory', 'This path is not a folder.');
    }
}

/** Settings of one harness (or harness instance), opened with the gear next to its switch. */
export function QaapHarnessSettingsPanel(props: QaapHarnessSettingsPanelProps): React.ReactElement {
    const [label, setLabel] = React.useState(props.settings.label ?? '');
    const [binaryPath, setBinaryPath] = React.useState(props.settings.binaryPath ?? '');
    const [homeDir, setHomeDir] = React.useState(props.settings.homeDir ?? '');
    const [issues, setIssues] = React.useState<QaapHarnessSettingsPathIssues>({});
    const [busy, setBusy] = React.useState(false);
    const idPrefix = `qaap-harness-settings-${props.harnessId.replace(/[^a-z0-9-]/gi, '-')}`;
    const showHome = props.launchOverridesSupported && !!props.homeEnvVar;

    const draft = (): QaapHarnessLaunchSettings => ({
        ...(label.trim() ? { label: label.trim() } : {}),
        // Outside the desktop app the stored paths are kept untouched (they are ignored there anyway).
        ...(props.launchOverridesSupported
            ? { ...(binaryPath.trim() ? { binaryPath: binaryPath.trim() } : {}) }
            : (props.settings.binaryPath ? { binaryPath: props.settings.binaryPath } : {})),
        ...(showHome
            ? { ...(homeDir.trim() ? { homeDir: homeDir.trim() } : {}) }
            : (props.settings.homeDir ? { homeDir: props.settings.homeDir } : {})),
    });

    const save = async (): Promise<void> => {
        const next = draft();
        const staticIssues: QaapHarnessSettingsPathIssues = {
            ...(props.launchOverridesSupported && next.binaryPath ? { binaryPathIssue: checkQaapHarnessPathShape(next.binaryPath) } : {}),
            ...(showHome && next.homeDir ? { homeDirIssue: checkQaapHarnessPathShape(next.homeDir) } : {}),
        };
        if (staticIssues.binaryPathIssue || staticIssues.homeDirIssue) {
            setIssues(staticIssues);
            return;
        }
        setBusy(true);
        try {
            const checked = props.launchOverridesSupported && (next.binaryPath || next.homeDir)
                ? await props.checkPaths({
                    ...(next.binaryPath ? { binaryPath: next.binaryPath } : {}),
                    ...(showHome && next.homeDir ? { homeDir: next.homeDir } : {}),
                })
                : {};
            setIssues(checked);
            if (!checked.binaryPathIssue && !checked.homeDirIssue) {
                await props.onSave(next);
            }
        } finally {
            setBusy(false);
        }
    };

    const reset = async (): Promise<void> => {
        setBusy(true);
        try {
            await props.onReset();
            setLabel('');
            setBinaryPath('');
            setHomeDir('');
            setIssues({});
        } finally {
            setBusy(false);
        }
    };

    const remove = async (): Promise<void> => {
        if (!props.onDelete) {
            return;
        }
        setBusy(true);
        try {
            await props.onDelete();
        } finally {
            setBusy(false);
        }
    };

    const signOut = async (): Promise<void> => {
        if (!props.onSignOut) {
            return;
        }
        setBusy(true);
        try {
            await props.onSignOut();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="qaap-harness-settings-panel" role="group" aria-label={nls.localize('qaap/aiConfiguration/harnessSettingsFor', '{0} settings', props.defaultLabel)}>
            <label className="qaap-harness-settings-field" htmlFor={`${idPrefix}-label`}>
                <span className="qaap-harness-settings-field-label">{nls.localize('qaap/aiConfiguration/harnessDisplayName', 'Display name')}</span>
                <input
                    id={`${idPrefix}-label`}
                    className="theia-input qaap-harness-settings-input"
                    type="text"
                    value={label}
                    maxLength={QAAP_HARNESS_LABEL_MAX_LENGTH}
                    placeholder={props.defaultLabel}
                    spellCheck={false}
                    onChange={event => setLabel(event.currentTarget.value)}
                />
            </label>
            {props.launchOverridesSupported && <label className="qaap-harness-settings-field" htmlFor={`${idPrefix}-bin`}>
                <span className="qaap-harness-settings-field-label">{nls.localize('qaap/aiConfiguration/harnessBinaryPath', 'Binary path')}</span>
                <input
                    id={`${idPrefix}-bin`}
                    className={`theia-input qaap-harness-settings-input qaap-harness-settings-mono${issues.binaryPathIssue ? ' theia-mod-error' : ''}`}
                    type="text"
                    value={binaryPath}
                    maxLength={QAAP_HARNESS_PATH_MAX_LENGTH}
                    placeholder={nls.localize('qaap/aiConfiguration/harnessBinaryPathPlaceholder', '{0} (from PATH)', props.defaultBin)}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    aria-invalid={!!issues.binaryPathIssue}
                    onChange={event => setBinaryPath(event.currentTarget.value)}
                />
                {issues.binaryPathIssue
                    ? <span className="qaap-harness-settings-error" role="alert">{describeQaapHarnessSettingsPathIssue(issues.binaryPathIssue)}</span>
                    : <span className="qaap-harness-settings-hint">{nls.localize('qaap/aiConfiguration/harnessBinaryPathHint', 'Absolute path of an executable file. Leave empty to use the one on PATH.')}</span>}
            </label>}
            {showHome && <label className="qaap-harness-settings-field" htmlFor={`${idPrefix}-home`}>
                <span className="qaap-harness-settings-field-label">{nls.localize('qaap/aiConfiguration/harnessHomeDir', 'Configuration folder')}</span>
                <input
                    id={`${idPrefix}-home`}
                    className={`theia-input qaap-harness-settings-input qaap-harness-settings-mono${issues.homeDirIssue ? ' theia-mod-error' : ''}`}
                    type="text"
                    value={homeDir}
                    maxLength={QAAP_HARNESS_PATH_MAX_LENGTH}
                    placeholder={nls.localize('qaap/aiConfiguration/harnessHomeDirPlaceholder', 'Default {0}', props.homeEnvVar ?? '')}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    aria-invalid={!!issues.homeDirIssue}
                    onChange={event => setHomeDir(event.currentTarget.value)}
                />
                {issues.homeDirIssue
                    ? <span className="qaap-harness-settings-error" role="alert">{describeQaapHarnessSettingsPathIssue(issues.homeDirIssue)}</span>
                    : <span className="qaap-harness-settings-hint">{nls.localize(
                        'qaap/aiConfiguration/harnessHomeDirHint',
                        'Sets {0} for this harness, for example to use another account. The folder must exist.',
                        props.homeEnvVar ?? '',
                    )}</span>}
            </label>}
            {props.launchOverridesSupported && props.env && <QaapHarnessEnvSection harnessId={props.harnessId} {...props.env} />}
            {!props.launchOverridesSupported && <p className="qaap-harness-settings-hint">
                {nls.localize(
                    'qaap/aiConfiguration/harnessLaunchOverridesDesktopOnly',
                    'Binary path, configuration folder and environment variables can be changed in the desktop app only.',
                )}
            </p>}
            {props.onSignOut && <div className="qaap-harness-session-section">
                <div className="qaap-harness-session-heading">
                    <span className="qaap-harness-session-title">
                        {nls.localize('qaap/aiConfiguration/harnessSessionTitle', 'Session')}
                    </span>
                    <span className="qaap-harness-settings-hint">
                        {props.signOutRemovesAllProviders
                            ? nls.localize(
                                'qaap/aiConfiguration/harnessSignOutHintAllProviders',
                                'Removes every provider sign-in saved in this CLI. API keys in Settings are kept.',
                            )
                            : nls.localize(
                                'qaap/aiConfiguration/harnessSignOutHint',
                                'Signs out of this harness session. You will need to sign in again to use its Pro models.',
                            )}
                    </span>
                </div>
                <div className="qaap-harness-session-actions">
                    <button
                        type="button"
                        className="theia-button secondary qaap-harness-settings-sign-out"
                        disabled={busy}
                        onClick={() => void signOut()}
                    >
                        {nls.localize('qaap/aiConfiguration/harnessSignOut', 'Sign out')}
                    </button>
                </div>
            </div>}
            <div className="qaap-harness-settings-actions">
                {props.isInstance
                    ? <button type="button" className="theia-button secondary qaap-harness-settings-delete" disabled={busy} onClick={() => void remove()}>
                        {nls.localize('qaap/aiConfiguration/harnessDeleteInstance', 'Delete harness')}
                    </button>
                    : <button type="button" className="theia-button secondary" disabled={busy} onClick={() => void reset()}>
                        {nls.localize('qaap/aiConfiguration/harnessRestoreDefaults', 'Restore defaults')}
                    </button>}
                <button type="button" className="theia-button main" disabled={busy} onClick={() => void save()}>
                    {nls.localizeByDefault('Save')}
                </button>
            </div>
        </div>
    );
}
