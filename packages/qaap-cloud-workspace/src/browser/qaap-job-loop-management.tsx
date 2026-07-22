// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import * as React from '@theia/core/shared/react';
import {
    isValidCronExpression,
    normalizeRoutineTimezone,
} from '@theia/qaap-mobile-shell/lib/common/qaap-work-hub-cron';
import { QaapJobLoopTemplate } from '../common/qaap-job-loop-template';
import { QaapCreateJobLoopTriggerBody, QaapJobLoopTrigger, QaapJobLoopTriggerType, QaapUpdateJobLoopTriggerBody } from '../common/qaap-job-loop-trigger';

const MAX_TITLE_LENGTH = 120;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 10_080;

type QaapJobLoopManagementAction<T> = (value: T) => void | Promise<void>;

export interface QaapJobLoopTriggerDraft {
    readonly templateId: string;
    readonly title: string;
    readonly type: QaapJobLoopTriggerType;
    readonly intervalMinutes: string;
    readonly cronExpression: string;
    readonly timezone: string;
    readonly oneShot: boolean;
}

export interface QaapJobLoopManagementValidation {
    readonly errors: Readonly<Record<string, string>>;
    readonly valid: boolean;
}

/** Creates the local, non-secret form state for one new trigger. */
export function createQaapJobLoopTriggerDraft(templateId = ''): QaapJobLoopTriggerDraft {
    return {
        templateId,
        title: '',
        type: 'interval',
        intervalMinutes: '5',
        cronExpression: '',
        timezone: '',
        oneShot: false,
    };
}

export function qaapJobLoopTriggerToDraft(trigger: QaapJobLoopTrigger): QaapJobLoopTriggerDraft {
    return {
        templateId: trigger.templateId,
        title: trigger.title,
        type: trigger.type,
        intervalMinutes: String(trigger.intervalMinutes ?? MIN_INTERVAL_MINUTES),
        cronExpression: trigger.cronExpression ?? '',
        timezone: trigger.timezone ?? '',
        oneShot: trigger.oneShot === true,
    };
}

export function validateQaapJobLoopTriggerDraft(draft: QaapJobLoopTriggerDraft): QaapJobLoopManagementValidation {
    const errors: Record<string, string> = {};
    if (!draft.templateId.trim()) {
        errors.template = nls.localize('qaap/jobLoopManagement/triggerTemplateRequired', 'Choose a template for this trigger.');
    }
    if (!draft.title.trim()) {
        errors.title = nls.localize('qaap/jobLoopManagement/triggerTitleRequired', 'A trigger name is required.');
    } else if (draft.title.trim().length > MAX_TITLE_LENGTH) {
        errors.title = nls.localize('qaap/jobLoopManagement/triggerTitleLength', 'A trigger name must contain at most 120 characters.');
    }
    if (draft.type === 'interval') {
        const interval = Number(draft.intervalMinutes);
        if (!Number.isSafeInteger(interval) || interval < MIN_INTERVAL_MINUTES || interval > MAX_INTERVAL_MINUTES) {
            errors.interval = nls.localize('qaap/jobLoopManagement/intervalRange', 'Interval must be a whole number from 5 to 10,080 minutes.');
        }
    } else if (draft.type === 'cron') {
        if (!isValidCronExpression(draft.cronExpression.trim())) {
            errors.cron = nls.localize('qaap/jobLoopManagement/cronInvalid', 'Enter a valid five-field cron expression.');
        }
        const timezone = draft.timezone.trim();
        if (timezone && normalizeRoutineTimezone(timezone) !== timezone) {
            errors.timezone = nls.localize('qaap/jobLoopManagement/timezoneInvalid', 'Enter a valid IANA timezone, such as UTC or Europe/Madrid.');
        }
    }
    return { errors, valid: Object.keys(errors).length === 0 };
}

export function qaapJobLoopTriggerDraftToRequest(draft: QaapJobLoopTriggerDraft): QaapCreateJobLoopTriggerBody {
    return {
        templateId: draft.templateId.trim(),
        title: draft.title.trim(),
        type: draft.type,
        ...(draft.type === 'interval' ? { intervalMinutes: Number(draft.intervalMinutes) } : {}),
        ...(draft.type === 'cron' ? {
            cronExpression: draft.cronExpression.trim(),
            timezone: draft.timezone.trim() || undefined,
            oneShot: draft.oneShot,
        } : {}),
    };
}

export interface QaapJobLoopManagementProps {
    /** The reusable loop definitions currently visible to the signed-in user. */
    readonly templates: readonly QaapJobLoopTemplate[];
    /** The durable schedules currently visible to the signed-in user. */
    readonly triggers: readonly QaapJobLoopTrigger[];
    readonly busy?: boolean;
    readonly error?: string;
    readonly selectedTemplateId?: string;
    /** A webhook credential supplied immediately after creation. It is never persisted here. */
    readonly webhookSecret?: string;
    readonly webhookUrl?: string;
    readonly onSelectTemplate?: QaapJobLoopManagementAction<QaapJobLoopTemplate>;
    readonly onEditTemplate?: QaapJobLoopManagementAction<QaapJobLoopTemplate>;
    readonly onRunTemplate?: QaapJobLoopManagementAction<QaapJobLoopTemplate>;
    readonly onExportTemplate?: QaapJobLoopManagementAction<QaapJobLoopTemplate>;
    /** Opens the parent-owned import flow; imported data is never retained by this component. */
    readonly onImportTemplate?: () => void | Promise<void>;
    readonly onDeleteTemplate?: QaapJobLoopManagementAction<QaapJobLoopTemplate>;
    readonly onCreateTrigger?: QaapJobLoopManagementAction<QaapCreateJobLoopTriggerBody>;
    readonly onUpdateTrigger?: (trigger: QaapJobLoopTrigger, patch: QaapUpdateJobLoopTriggerBody) => void | Promise<void>;
    readonly onSetTriggerEnabled?: (trigger: QaapJobLoopTrigger, enabled: boolean) => void | Promise<void>;
    readonly onFireTrigger?: QaapJobLoopManagementAction<QaapJobLoopTrigger>;
    readonly onDeleteTrigger?: QaapJobLoopManagementAction<QaapJobLoopTrigger>;
    /** The parent clears its one-time secret after the user has acknowledged it. */
    readonly onDismissWebhookSecret?: () => void;
}

/**
 * Standalone, accessible management surface. The parent owns server state and all secrets.
 */
export function QaapJobLoopManagement(props: QaapJobLoopManagementProps): React.ReactNode {
    const [triggerDraft, setTriggerDraft] = React.useState<QaapJobLoopTriggerDraft>(() => createQaapJobLoopTriggerDraft());
    const [triggerSubmitted, setTriggerSubmitted] = React.useState(false);
    const [editingTriggerId, setEditingTriggerId] = React.useState<string>();
    const selectedTemplateId = props.templates.some(template => template.id === props.selectedTemplateId)
        ? props.selectedTemplateId
        : props.templates[0]?.id;
    const effectiveTriggerDraft = triggerDraft.templateId || !selectedTemplateId
        ? triggerDraft
        : { ...triggerDraft, templateId: selectedTemplateId };
    const triggerValidation = validateQaapJobLoopTriggerDraft(effectiveTriggerDraft);

    const updateTrigger = (patch: Partial<QaapJobLoopTriggerDraft>): void => {
        setTriggerDraft(current => ({ ...current, ...patch }));
    };
    const submitTrigger = (event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        setTriggerSubmitted(true);
        const editingTrigger = props.triggers.find(trigger => trigger.id === editingTriggerId);
        if (!triggerValidation.valid || props.busy || (editingTrigger ? !props.onUpdateTrigger : !props.onCreateTrigger)) {
            return;
        }
        const request = qaapJobLoopTriggerDraftToRequest(effectiveTriggerDraft);
        void (async () => {
            if (editingTrigger) {
                await props.onUpdateTrigger!(editingTrigger, request);
            } else {
                await props.onCreateTrigger!(request);
            }
            setEditingTriggerId(undefined);
            setTriggerSubmitted(false);
            setTriggerDraft(createQaapJobLoopTriggerDraft());
        })().catch(() => undefined);
    };
    const editTrigger = (trigger: QaapJobLoopTrigger): void => {
        setEditingTriggerId(trigger.id);
        setTriggerSubmitted(false);
        setTriggerDraft(qaapJobLoopTriggerToDraft(trigger));
    };
    const cancelTriggerEdit = (): void => {
        setEditingTriggerId(undefined);
        setTriggerSubmitted(false);
        setTriggerDraft(createQaapJobLoopTriggerDraft());
    };
    const editingTrigger = props.triggers.find(trigger => trigger.id === editingTriggerId);
    const canSubmitTrigger = Boolean(editingTrigger ? props.onUpdateTrigger : props.onCreateTrigger);

    return <section className='qaap-job-loop-management' aria-label={nls.localize('qaap/jobLoopManagement/label', 'Job loop templates and triggers')}>
        <header className='qaap-job-loop-management-header'>
            <h2>{nls.localize('qaap/jobLoopManagement/title', 'Templates and triggers')}</h2>
        </header>
        {props.error && <div className='qaap-job-loop-management-alert' role='alert'>{props.error}</div>}
        {props.webhookSecret && <WebhookSecret secret={props.webhookSecret} url={props.webhookUrl} onDismiss={props.onDismissWebhookSecret} />}
        <section className='qaap-job-loop-management-templates' aria-labelledby='qaap-job-loop-management-templates-heading'>
            <div className='qaap-job-loop-management-section-heading'><h3 id='qaap-job-loop-management-templates-heading'>{nls.localize('qaap/jobLoopManagement/templates', 'Templates')}</h3>
                {props.onImportTemplate && <button type='button' disabled={props.busy} onClick={() => invoke<void>(props.onImportTemplate!, undefined)}>{nls.localize('qaap/jobLoopManagement/importTemplate', 'Import template')}</button>}
            </div>
            {props.templates.length === 0
                ? <p className='qaap-job-loop-management-empty'>{nls.localize('qaap/jobLoopManagement/noTemplates', 'No saved templates yet.')}</p>
                : <ul className='qaap-job-loop-management-template-list'>
                    {props.templates.map(template => <TemplateCard key={template.id} template={template} selected={template.id === props.selectedTemplateId} busy={Boolean(props.busy)} onSelect={props.onSelectTemplate} onEdit={props.onEditTemplate} onRun={props.onRunTemplate} onExport={props.onExportTemplate} onDelete={props.onDeleteTemplate} />)}
                </ul>}
        </section>
        <section className='qaap-job-loop-management-triggers' aria-labelledby='qaap-job-loop-management-triggers-heading'>
            <h3 id='qaap-job-loop-management-triggers-heading'>{nls.localize('qaap/jobLoopManagement/triggers', 'Triggers')}</h3>
            <form className='qaap-job-loop-management-trigger-form' onSubmit={submitTrigger} noValidate>
                <fieldset disabled={props.busy || !canSubmitTrigger || props.templates.length === 0}>
                    <legend>{editingTrigger ? nls.localize('qaap/jobLoopManagement/editTrigger', 'Edit trigger') : nls.localize('qaap/jobLoopManagement/createTrigger', 'Create trigger')}</legend>
                    {props.templates.length === 0 && <p className='qaap-job-loop-management-help'>{nls.localize('qaap/jobLoopManagement/triggerNeedsTemplate', 'Save a template before creating a trigger.')}</p>}
                    <ManagementField label={nls.localize('qaap/jobLoopManagement/triggerTemplate', 'Template')} error={triggerSubmitted ? triggerValidation.errors.template : undefined}>
                        <select value={effectiveTriggerDraft.templateId} onChange={event => updateTrigger({ templateId: event.currentTarget.value })}>
                            {props.templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
                        </select>
                    </ManagementField>
                    <ManagementField label={nls.localize('qaap/jobLoopManagement/triggerName', 'Trigger name')} error={triggerSubmitted ? triggerValidation.errors.title : undefined}>
                        <input value={triggerDraft.title} maxLength={MAX_TITLE_LENGTH} onChange={event => updateTrigger({ title: event.currentTarget.value })} />
                    </ManagementField>
                    <ManagementField label={nls.localize('qaap/jobLoopManagement/triggerType', 'Trigger type')}>
                        <select disabled={Boolean(editingTrigger)} value={triggerDraft.type} onChange={event => updateTrigger({ type: event.currentTarget.value as QaapJobLoopTriggerType })}>
                            <option value='interval'>{nls.localize('qaap/jobLoopManagement/interval', 'Interval')}</option>
                            <option value='cron'>{nls.localize('qaap/jobLoopManagement/cron', 'Cron schedule')}</option>
                            <option value='webhook'>{nls.localize('qaap/jobLoopManagement/webhook', 'Webhook')}</option>
                        </select>
                    </ManagementField>
                    {triggerDraft.type === 'interval'
                        ? <ManagementField label={nls.localize('qaap/jobLoopManagement/intervalMinutes', 'Interval (minutes)')} error={triggerSubmitted ? triggerValidation.errors.interval : undefined}>
                            <input type='number' min={MIN_INTERVAL_MINUTES} max={MAX_INTERVAL_MINUTES} step='1' value={triggerDraft.intervalMinutes} onChange={event => updateTrigger({ intervalMinutes: event.currentTarget.value })} />
                        </ManagementField>
                        : triggerDraft.type === 'cron'
                            ? <fieldset className='qaap-job-loop-management-cron-fields'>
                                <legend>{nls.localize('qaap/jobLoopManagement/cronSchedule', 'Cron schedule')}</legend>
                                <ManagementField label={nls.localize('qaap/jobLoopManagement/cronExpression', 'Cron expression')} error={triggerSubmitted ? triggerValidation.errors.cron : undefined}>
                                    <input value={triggerDraft.cronExpression} onChange={event => updateTrigger({ cronExpression: event.currentTarget.value })} />
                                </ManagementField>
                                <ManagementField label={nls.localize('qaap/jobLoopManagement/timezone', 'Timezone (optional)')} error={triggerSubmitted ? triggerValidation.errors.timezone : undefined}>
                                    <input value={triggerDraft.timezone} onChange={event => updateTrigger({ timezone: event.currentTarget.value })} />
                                </ManagementField>
                                <label className='qaap-job-loop-management-checkbox'><input type='checkbox' checked={triggerDraft.oneShot} onChange={event => updateTrigger({ oneShot: event.currentTarget.checked })} />{nls.localize('qaap/jobLoopManagement/oneShot', 'Disable after the first successful run')}</label>
                            </fieldset>
                            : <p className='qaap-job-loop-management-help'>{nls.localize('qaap/jobLoopManagement/webhookHelp', 'A secret will be shown once after this webhook is created.')}</p>}
                    <button type='submit'>{editingTrigger ? nls.localize('qaap/jobLoopManagement/saveTriggerChanges', 'Save trigger changes') : nls.localize('qaap/jobLoopManagement/saveTrigger', 'Create trigger')}</button>
                    {editingTrigger && <button type='button' onClick={cancelTriggerEdit}>{nls.localize('qaap/jobLoopManagement/cancelTriggerEdit', 'Cancel')}</button>}
                </fieldset>
            </form>
            {props.triggers.length === 0
                ? <p className='qaap-job-loop-management-empty'>{nls.localize('qaap/jobLoopManagement/noTriggers', 'No triggers yet.')}</p>
                : <ul className='qaap-job-loop-management-trigger-list'>{props.triggers.map(trigger => <TriggerCard key={trigger.id} trigger={trigger} busy={Boolean(props.busy)} onEdit={props.onUpdateTrigger ? editTrigger : undefined} onSetEnabled={props.onSetTriggerEnabled} onFire={props.onFireTrigger} onDelete={props.onDeleteTrigger} />)}</ul>}
        </section>
    </section>;
}

function TemplateCard(props: { readonly template: QaapJobLoopTemplate; readonly selected: boolean; readonly busy: boolean; readonly onSelect?: QaapJobLoopManagementAction<QaapJobLoopTemplate>; readonly onEdit?: QaapJobLoopManagementAction<QaapJobLoopTemplate>; readonly onRun?: QaapJobLoopManagementAction<QaapJobLoopTemplate>; readonly onExport?: QaapJobLoopManagementAction<QaapJobLoopTemplate>; readonly onDelete?: QaapJobLoopManagementAction<QaapJobLoopTemplate> }): React.ReactNode {
    const { template } = props;
    return <li className='qaap-job-loop-management-template'>
        <div><h4>{template.name}</h4>{template.description && <p>{template.description}</p>}</div>
        <div className='qaap-job-loop-management-actions'>
            <button type='button' aria-pressed={props.selected} disabled={props.busy || !props.onSelect} onClick={() => props.onSelect && invoke(props.onSelect, template)}>{nls.localize('qaap/jobLoopManagement/selectTemplate', 'Select')}</button>
            <button type='button' disabled={props.busy || !props.onEdit} onClick={() => props.onEdit && invoke(props.onEdit, template)}>{nls.localize('qaap/jobLoopManagement/editTemplate', 'Edit')}</button>
            <button type='button' disabled={props.busy || !props.onRun} onClick={() => props.onRun && invoke(props.onRun, template)}>{nls.localize('qaap/jobLoopManagement/runTemplate', 'Run')}</button>
            <button type='button' disabled={props.busy || !props.onExport} onClick={() => props.onExport && invoke(props.onExport, template)}>{nls.localize('qaap/jobLoopManagement/exportTemplate', 'Export')}</button>
            <button type='button' disabled={props.busy || !props.onDelete} onClick={() => props.onDelete && invoke(props.onDelete, template)}>{nls.localize('qaap/jobLoopManagement/deleteTemplate', 'Delete')}</button>
        </div>
    </li>;
}

function TriggerCard(props: { readonly trigger: QaapJobLoopTrigger; readonly busy: boolean; readonly onEdit?: QaapJobLoopManagementAction<QaapJobLoopTrigger>; readonly onSetEnabled?: (trigger: QaapJobLoopTrigger, enabled: boolean) => void | Promise<void>; readonly onFire?: QaapJobLoopManagementAction<QaapJobLoopTrigger>; readonly onDelete?: QaapJobLoopManagementAction<QaapJobLoopTrigger> }): React.ReactNode {
    const { trigger } = props;
    return <li className='qaap-job-loop-management-trigger'>
        <div><h4>{trigger.title}</h4><p>{triggerSummary(trigger)}</p></div>
        <div className='qaap-job-loop-management-actions'>
            <button type='button' disabled={props.busy || !props.onEdit} onClick={() => props.onEdit && invoke(props.onEdit, trigger)}>{nls.localize('qaap/jobLoopManagement/editTriggerAction', 'Edit')}</button>
            <button type='button' disabled={props.busy || !props.onSetEnabled} onClick={() => props.onSetEnabled && invoke(() => props.onSetEnabled!(trigger, !trigger.enabled), undefined)}>{trigger.enabled ? nls.localize('qaap/jobLoopManagement/disableTrigger', 'Disable') : nls.localize('qaap/jobLoopManagement/enableTrigger', 'Enable')}</button>
            <button type='button' disabled={props.busy || !props.onFire} onClick={() => props.onFire && invoke(props.onFire, trigger)}>{nls.localize('qaap/jobLoopManagement/fireTrigger', 'Run now')}</button>
            <button type='button' disabled={props.busy || !props.onDelete} onClick={() => props.onDelete && invoke(props.onDelete, trigger)}>{nls.localize('qaap/jobLoopManagement/deleteTrigger', 'Delete')}</button>
        </div>
    </li>;
}

function WebhookSecret(props: { readonly secret: string; readonly url?: string; readonly onDismiss?: () => void }): React.ReactNode {
    return <div className='qaap-job-loop-management-webhook-secret' role='alert'>
        <p>{nls.localize('qaap/jobLoopManagement/webhookSecretWarning', 'Copy this webhook secret now. It will not be shown again.')}</p>
        {props.url && <><span>{nls.localize('qaap/jobLoopManagement/webhookUrl', 'Webhook URL')}</span><code>{props.url}</code></>}
        <span>{nls.localize('qaap/jobLoopManagement/webhookSecret', 'Webhook secret')}</span>
        <code>{props.secret}</code>
        {props.onDismiss && <button type='button' onClick={props.onDismiss}>{nls.localize('qaap/jobLoopManagement/webhookSecretDismiss', 'I copied the secret')}</button>}
    </div>;
}

function ManagementField(props: { readonly label: string; readonly error?: string; readonly children: React.ReactNode }): React.ReactNode {
    const id = React.useId();
    return <div className='qaap-job-loop-management-field'>
        <label htmlFor={id}>{props.label}</label>
        {React.cloneElement(props.children as React.ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>, {
            id,
            'aria-invalid': Boolean(props.error),
            'aria-describedby': props.error ? `${id}-error` : undefined,
        })}
        {props.error && <span id={`${id}-error`} className='qaap-job-loop-management-error'>{props.error}</span>}
    </div>;
}

function triggerSummary(trigger: QaapJobLoopTrigger): string {
    let schedule: string;
    if (trigger.type === 'interval') {
        schedule = nls.localize('qaap/jobLoopManagement/intervalSummary', 'Interval: {0} minutes', String(trigger.intervalMinutes ?? MIN_INTERVAL_MINUTES));
    } else if (trigger.type === 'cron') {
        schedule = nls.localize('qaap/jobLoopManagement/cronSummary', 'Cron: {0}', trigger.cronExpression ?? '');
    } else {
        schedule = nls.localize('qaap/jobLoopManagement/webhookSummary', 'Webhook');
    }
    const state = !trigger.enabled
        ? nls.localize('qaap/jobLoopManagement/disabledState', 'disabled')
        : trigger.lastRunState === 'running'
            ? nls.localize('qaap/jobLoopManagement/runningState', 'running')
            : trigger.lastRunState === 'completed'
                ? nls.localize('qaap/jobLoopManagement/completedState', 'last run completed')
                : trigger.lastRunState === 'failed'
                    ? nls.localize('qaap/jobLoopManagement/failedState', 'last run failed')
                    : nls.localize('qaap/jobLoopManagement/readyState', 'ready');
    return nls.localize('qaap/jobLoopManagement/triggerSummary', '{0} · {1}', schedule, state);
}

function invoke<T>(action: QaapJobLoopManagementAction<T>, value: T): void {
    void Promise.resolve(action(value)).catch(() => undefined);
}
