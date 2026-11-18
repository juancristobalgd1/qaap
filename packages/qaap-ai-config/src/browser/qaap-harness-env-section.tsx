// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core';
import { codicon } from '@theia/core/lib/browser';
import * as React from '@theia/core/shared/react';
import {
    checkQaapHarnessEnvName,
    QAAP_HARNESS_ENV_MAX_VARIABLES,
    QAAP_HARNESS_ENV_VALUE_MAX_LENGTH,
    type QaapHarnessEnvNameIssue,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-launch-settings';

/** A variable as the backend reports it: the name and whether a value is stored, never the value. */
export interface QaapHarnessEnvVariableStatus {
    readonly name: string;
    readonly hasValue: boolean;
}

export interface QaapHarnessEnvSectionProps {
    readonly harnessId: string;
    readonly load: () => Promise<readonly QaapHarnessEnvVariableStatus[]>;
    /** Stores the value in the backend secret store and records the name; rejects with a user message. */
    readonly setVariable: (name: string, value: string) => Promise<void>;
    readonly deleteVariable: (name: string) => Promise<void>;
}

export function describeQaapHarnessEnvNameIssue(issue: QaapHarnessEnvNameIssue): string {
    return issue === 'denied'
        ? nls.localize('qaap/aiConfiguration/harnessEnvNameDenied', 'Qaap manages this variable; it cannot be set here.')
        : nls.localize('qaap/aiConfiguration/harnessEnvNameInvalid', 'Use capital letters, digits and underscores, starting with a letter or underscore.');
}

interface EnvEditorProps {
    readonly idPrefix: string;
    /** Fixed name when replacing a stored value; undefined for "Add variable". */
    readonly fixedName?: string;
    readonly takenNames: readonly string[];
    readonly onSubmit: (name: string, value: string) => Promise<void>;
    readonly onCancel: () => void;
}

/** Name + secret value editor. The value input is a password field with a show toggle while editing. */
function QaapHarnessEnvEditor(props: EnvEditorProps): React.ReactElement {
    const [name, setName] = React.useState(props.fixedName ?? '');
    const [value, setValue] = React.useState('');
    const [reveal, setReveal] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>(undefined);
    const [busy, setBusy] = React.useState(false);

    const submit = async (): Promise<void> => {
        const trimmedName = name.trim();
        const issue = checkQaapHarnessEnvName(trimmedName);
        if (issue) {
            setError(describeQaapHarnessEnvNameIssue(issue));
            return;
        }
        if (!props.fixedName && props.takenNames.includes(trimmedName)) {
            setError(nls.localize('qaap/aiConfiguration/harnessEnvNameTaken', 'This variable is already set. Use Replace to change its value.'));
            return;
        }
        if (!value) {
            setError(nls.localize('qaap/aiConfiguration/harnessEnvValueRequired', 'Enter a value.'));
            return;
        }
        setBusy(true);
        try {
            await props.onSubmit(trimmedName, value);
        } catch (failure) {
            setError(failure instanceof Error && failure.message
                ? failure.message
                : nls.localize('qaap/aiConfiguration/harnessEnvSaveFailed', 'The variable could not be saved.'));
            setBusy(false);
        }
    };

    return (
        <div className="qaap-harness-env-editor">
            <div className="qaap-harness-env-editor-row">
                {props.fixedName
                    ? <span className="qaap-harness-env-name">{props.fixedName}</span>
                    : <input
                        id={`${props.idPrefix}-env-name`}
                        className="theia-input qaap-harness-settings-input qaap-harness-settings-mono qaap-harness-env-name-input"
                        type="text"
                        value={name}
                        maxLength={128}
                        placeholder={nls.localize('qaap/aiConfiguration/harnessEnvNamePlaceholder', 'NAME')}
                        aria-label={nls.localize('qaap/aiConfiguration/harnessEnvName', 'Variable name')}
                        spellCheck={false}
                        autoCapitalize="characters"
                        autoCorrect="off"
                        autoComplete="off"
                        onChange={event => { setName(event.currentTarget.value.toUpperCase()); setError(undefined); }}
                    />}
                <span className="qaap-harness-env-equals" aria-hidden={true}>=</span>
                <input
                    id={`${props.idPrefix}-env-value`}
                    className="theia-input qaap-harness-settings-input qaap-harness-settings-mono qaap-harness-env-value-input"
                    type={reveal ? 'text' : 'password'}
                    value={value}
                    maxLength={QAAP_HARNESS_ENV_VALUE_MAX_LENGTH}
                    placeholder={nls.localize('qaap/aiConfiguration/harnessEnvValuePlaceholder', 'value')}
                    aria-label={nls.localize('qaap/aiConfiguration/harnessEnvValue', 'Variable value')}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="new-password"
                    onChange={event => { setValue(event.currentTarget.value); setError(undefined); }}
                />
                <button
                    type="button"
                    className="qaap-harness-settings-button"
                    aria-label={reveal
                        ? nls.localize('qaap/aiConfiguration/harnessEnvHideValue', 'Hide value')
                        : nls.localize('qaap/aiConfiguration/harnessEnvShowValue', 'Show value')}
                    title={reveal
                        ? nls.localize('qaap/aiConfiguration/harnessEnvHideValue', 'Hide value')
                        : nls.localize('qaap/aiConfiguration/harnessEnvShowValue', 'Show value')}
                    aria-pressed={reveal}
                    onClick={() => setReveal(!reveal)}
                >
                    <span className={codicon(reveal ? 'eye-closed' : 'eye')} aria-hidden={true} />
                </button>
            </div>
            {error && <span className="qaap-harness-settings-error" role="alert">{error}</span>}
            <div className="qaap-harness-settings-actions">
                <button type="button" className="theia-button secondary" disabled={busy} onClick={props.onCancel}>
                    {nls.localizeByDefault('Cancel')}
                </button>
                <button type="button" className="theia-button main" disabled={busy} onClick={() => void submit()}>
                    {nls.localizeByDefault('Save')}
                </button>
            </div>
        </div>
    );
}

/** "Environment" section of the harness settings panel (desktop app only). */
export function QaapHarnessEnvSection(props: QaapHarnessEnvSectionProps): React.ReactElement {
    const [variables, setVariables] = React.useState<readonly QaapHarnessEnvVariableStatus[] | undefined>(undefined);
    const [loadFailed, setLoadFailed] = React.useState(false);
    /** Name being replaced, `''` for "Add variable", undefined when no editor is open. */
    const [editing, setEditing] = React.useState<string | undefined>(undefined);
    const [deleteError, setDeleteError] = React.useState(false);
    const idPrefix = `qaap-harness-env-${props.harnessId.replace(/[^a-z0-9-]/gi, '-')}`;

    // The host passes a fresh callback on every render; the list is reloaded per harness, not per render.
    const loadRef = React.useRef(props.load);
    loadRef.current = props.load;
    const reload = React.useCallback(async (): Promise<void> => {
        try {
            setVariables(await loadRef.current());
            setLoadFailed(false);
        } catch {
            setLoadFailed(true);
        }
    }, [props.harnessId]);

    React.useEffect(() => {
        void reload();
    }, [reload]);

    const submit = async (name: string, value: string): Promise<void> => {
        await props.setVariable(name, value);
        setEditing(undefined);
        await reload();
    };

    const remove = async (name: string): Promise<void> => {
        try {
            await props.deleteVariable(name);
            setDeleteError(false);
        } catch {
            setDeleteError(true);
        }
        await reload();
    };

    const names = (variables ?? []).map(variable => variable.name);
    const full = names.length >= QAAP_HARNESS_ENV_MAX_VARIABLES;
    return (
        <div className="qaap-harness-env-section" role="group" aria-labelledby={`${idPrefix}-title`}>
            <div className="qaap-harness-env-heading">
                <span id={`${idPrefix}-title`} className="qaap-harness-env-title">
                    {nls.localize('qaap/aiConfiguration/harnessEnvironment', 'Environment')}
                </span>
                <span className="qaap-harness-settings-field-label">{nls.localize('qaap/aiConfiguration/harnessEnvVariables', 'Variables')}</span>
                <span className="qaap-harness-settings-hint">
                    {nls.localize('qaap/aiConfiguration/harnessEnvHint', 'API keys, base URLs, and other per-instance CLI settings.')}
                </span>
            </div>
            {loadFailed && <span className="qaap-harness-settings-error" role="alert">
                {nls.localize('qaap/aiConfiguration/harnessEnvLoadFailed', 'Could not load the variables.')}
            </span>}
            {deleteError && <span className="qaap-harness-settings-error" role="alert">
                {nls.localize('qaap/aiConfiguration/harnessEnvDeleteFailed', 'The variable could not be deleted.')}
            </span>}
            {(variables ?? []).length > 0 && <ul className="qaap-harness-env-list">
                {(variables ?? []).map(variable => editing === variable.name
                    ? <li key={variable.name}>
                        <QaapHarnessEnvEditor
                            idPrefix={`${idPrefix}-${variable.name}`}
                            fixedName={variable.name}
                            takenNames={names}
                            onSubmit={submit}
                            onCancel={() => setEditing(undefined)}
                        />
                    </li>
                    : <li key={variable.name} className="qaap-harness-env-row" data-env-name={variable.name}>
                        <span className="qaap-harness-env-name">{variable.name}</span>
                        <span className="qaap-harness-env-equals" aria-hidden={true}>=</span>
                        <span className={`qaap-harness-env-masked${variable.hasValue ? '' : ' theia-mod-missing'}`}>
                            {variable.hasValue ? '••••••••' : nls.localize('qaap/aiConfiguration/harnessEnvNoValue', 'No value stored')}
                        </span>
                        <button type="button" className="theia-button secondary qaap-harness-env-replace" onClick={() => setEditing(variable.name)}>
                            {nls.localize('qaap/aiConfiguration/harnessEnvReplace', 'Replace')}
                        </button>
                        <button
                            type="button"
                            className="qaap-harness-settings-button"
                            aria-label={nls.localize('qaap/aiConfiguration/harnessEnvDelete', 'Delete {0}', variable.name)}
                            title={nls.localize('qaap/aiConfiguration/harnessEnvDelete', 'Delete {0}', variable.name)}
                            onClick={() => void remove(variable.name)}
                        >
                            <span className={codicon('trash')} aria-hidden={true} />
                        </button>
                    </li>)}
            </ul>}
            {editing === ''
                ? <QaapHarnessEnvEditor idPrefix={`${idPrefix}-new`} takenNames={names} onSubmit={submit} onCancel={() => setEditing(undefined)} />
                : <button
                    type="button"
                    className="qaap-harness-add-button qaap-harness-env-add"
                    disabled={variables === undefined || full}
                    onClick={() => setEditing('')}
                >
                    <span className={codicon('add')} aria-hidden={true} />
                    {nls.localize('qaap/aiConfiguration/harnessEnvAdd', 'Add variable')}
                </button>}
        </div>
    );
}
