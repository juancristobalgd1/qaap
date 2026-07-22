// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import * as React from '@theia/core/shared/react';
import {
    QAAP_JOB_LOOP_CONDITION_OPERATORS,
    QaapCreateJobLoopRequest,
    QaapJobLoopConditionOperator,
} from '../common/qaap-job-loop';
import { QaapCreateJobLoopTemplateRequest, QaapJobLoopTemplateDefinition } from '../common/qaap-job-loop-template';
import { isValidQaapJsonPointer, resolveQaapJsonPointer } from '../common/qaap-json-pointer';
import { QaapJobFunctionDescriptor, QaapJobKind } from '../common/qaap-job';

const MAX_NODES = 128;
const MAX_ITERATIONS = 100;
const MAX_JOBS = 512;

export interface QaapJobLoopDraftNode {
    readonly id: string;
    readonly key: string;
    readonly title: string;
    readonly cwd: string;
    readonly kind: QaapJobKind;
    readonly command: string;
    readonly functionId: string;
    readonly input: string;
    readonly dependsOn: readonly string[];
    readonly bindings: readonly QaapJobLoopDraftBinding[];
}

export interface QaapJobLoopDraftBinding {
    readonly id: string;
    readonly nodeKey: string;
    readonly source: 'result' | 'job';
    readonly pointer: string;
    readonly targetPointer: string;
}

export interface QaapJobLoopDraft {
    readonly title: string;
    readonly templateDescription: string;
    readonly cwd: string;
    readonly maxIterations: string;
    readonly maxDurationMinutes: string;
    readonly nodes: readonly QaapJobLoopDraftNode[];
    readonly conditionNodeKey: string;
    readonly conditionSource: 'result' | 'job';
    readonly conditionPointer: string;
    readonly conditionOperator: QaapJobLoopConditionOperator;
    readonly conditionExpected: string;
    readonly idempotencyKey?: string;
}

export interface QaapJobLoopDraftValidation {
    readonly errors: Readonly<Record<string, string>>;
    readonly valid: boolean;
}

export function createQaapJobLoopDraft(cwd = ''): QaapJobLoopDraft {
    const node = createNode('step-1', cwd);
    return {
        title: '', templateDescription: '', cwd, maxIterations: '10', maxDurationMinutes: '60', nodes: [node],
        conditionNodeKey: node.key, conditionSource: 'result', conditionPointer: '',
        conditionOperator: 'truthy', conditionExpected: '',
    };
}

export function validateQaapJobLoopDraft(draft: QaapJobLoopDraft): QaapJobLoopDraftValidation {
    const errors: Record<string, string> = {};
    const keys = new Set<string>();
    const nodeByKey = new Map<string, QaapJobLoopDraftNode>();
    const iterations = Number(draft.maxIterations);
    const duration = Number(draft.maxDurationMinutes);
    if (draft.nodes.length < 1 || draft.nodes.length > MAX_NODES) errors.nodes = nls.localize('qaap/jobLoops/builder/nodeCount', 'Add between 1 and 128 nodes.');
    if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) errors.iterations = nls.localize('qaap/jobLoops/builder/iterationsError', 'Iterations must be a whole number from 1 to 100.');
    if (!Number.isFinite(duration) || duration * 60_000 < 1_000 || duration * 60_000 > 7 * 24 * 60 * 60_000) errors.duration = nls.localize('qaap/jobLoops/builder/durationError', 'Duration must be from 1 second to 7 days.');
    if (Number.isSafeInteger(iterations) && draft.nodes.length * iterations > MAX_JOBS) errors.budget = nls.localize('qaap/jobLoops/builder/jobBudgetError', 'This graph exceeds the client job budget of 512 jobs.');
    for (const node of draft.nodes) {
        const key = node.key.trim();
        if (!key) errors[`node-${node.id}-key`] = nls.localize('qaap/jobLoops/builder/keyRequired', 'A node key is required.');
        else if (keys.has(key)) errors[`node-${node.id}-key`] = nls.localize('qaap/jobLoops/builder/keyUnique', 'Node keys must be unique.');
        keys.add(key); nodeByKey.set(key, node);
        if (!node.cwd.trim()) errors[`node-${node.id}-cwd`] = nls.localize('qaap/jobLoops/builder/cwdRequired', 'A workspace path is required.');
        if (node.kind === 'command' && !node.command.trim()) errors[`node-${node.id}-command`] = nls.localize('qaap/jobLoops/builder/commandRequired', 'A command is required.');
        if (node.kind === 'function') {
            if (!node.functionId) errors[`node-${node.id}-function`] = nls.localize('qaap/jobLoops/builder/functionRequired', 'Choose a function.');
            if (!parseJson(node.input).ok) errors[`node-${node.id}-input`] = nls.localize('qaap/jobLoops/builder/inputJson', 'Function input must be valid JSON.');
        }
    }
    for (const node of draft.nodes) {
        const key = node.key.trim();
        for (const dependency of node.dependsOn) {
            if (dependency === key || !nodeByKey.has(dependency)) errors[`node-${node.id}-dependsOn`] = nls.localize('qaap/jobLoops/builder/dependencyError', 'Dependencies must reference another node.');
        }
        if (node.kind === 'function') {
            const input = parseJson(node.input).value;
            const targets = new Set<string>();
            for (const binding of node.bindings) {
                if (!nodeByKey.has(binding.nodeKey) || !isValidQaapJsonPointer(binding.pointer)
                    || !isValidQaapJsonPointer(binding.targetPointer) || targets.has(binding.targetPointer)
                    || (binding.targetPointer !== '' && !resolveQaapJsonPointer(input, binding.targetPointer).found)) {
                    errors[`node-${node.id}-binding-${binding.id}`] = nls.localize('qaap/jobLoops/builder/bindingError', 'Use a valid source and an existing, unique JSON input target.');
                }
                targets.add(binding.targetPointer);
            }
        }
    }
    if (hasCycle(draft.nodes)) errors.graph = nls.localize('qaap/jobLoops/builder/cycle', 'Dependencies must not form a cycle.');
    if (!nodeByKey.has(draft.conditionNodeKey)) errors.conditionNode = nls.localize('qaap/jobLoops/builder/conditionNode', 'Choose a condition node.');
    if (!isValidQaapJsonPointer(draft.conditionPointer)) errors.conditionPointer = nls.localize('qaap/jobLoops/builder/pointer', 'Use an RFC 6901 JSON Pointer.');
    const unary = draft.conditionOperator === 'truthy' || draft.conditionOperator === 'falsy';
    const expected = parseJson(draft.conditionExpected);
    if (!unary && !expected.ok) errors.conditionExpected = nls.localize('qaap/jobLoops/builder/expectedJson', 'Expected value must be valid JSON.');
    if (!unary && isNumericOperator(draft.conditionOperator) && (!expected.ok || typeof expected.value !== 'number' || !Number.isFinite(expected.value))) errors.conditionExpected = nls.localize('qaap/jobLoops/builder/numericExpected', 'This operator requires a finite JSON number.');
    return { errors, valid: Object.keys(errors).length === 0 };
}

export function qaapJobLoopDraftToRequest(draft: QaapJobLoopDraft): QaapCreateJobLoopRequest {
    const unary = draft.conditionOperator === 'truthy' || draft.conditionOperator === 'falsy';
    const expected = parseJson(draft.conditionExpected).value;
    return {
        title: draft.title.trim() || undefined,
        graph: { nodes: draft.nodes.map(node => ({
            key: node.key.trim(), dependsOn: node.dependsOn,
            request: node.kind === 'command'
                ? { kind: 'command', title: node.title.trim() || undefined, cwd: node.cwd.trim(), command: node.command.trim() }
                : { kind: 'function', title: node.title.trim() || undefined, cwd: node.cwd.trim(), functionId: node.functionId, input: parseJson(node.input).value },
            ...(node.kind === 'function' && node.bindings.length > 0 ? { bindings: node.bindings.map(binding => ({ from: { nodeKey: binding.nodeKey, source: binding.source, pointer: binding.pointer }, targetPointer: binding.targetPointer })) } : {}),
        })) },
        until: { nodeKey: draft.conditionNodeKey, source: draft.conditionSource, pointer: draft.conditionPointer, operator: draft.conditionOperator, ...(!unary ? { expected } : {}) },
        maxIterations: Number(draft.maxIterations), maxDurationMs: Math.round(Number(draft.maxDurationMinutes) * 60_000), idempotencyKey: draft.idempotencyKey,
    };
}

export function qaapJobLoopDraftToTemplateRequest(draft: QaapJobLoopDraft): QaapCreateJobLoopTemplateRequest {
    const { idempotencyKey: _idempotencyKey, ...definition } = qaapJobLoopDraftToRequest({
        ...draft,
        idempotencyKey: undefined,
    });
    return {
        name: draft.title.trim(),
        description: draft.templateDescription.trim() || undefined,
        definition,
    };
}

/** Opens a stored definition in the same controlled draft model used for new loops. */
export function qaapJobLoopDefinitionToDraft(
    definition: QaapJobLoopTemplateDefinition,
    name = definition.title ?? '',
    description = '',
): QaapJobLoopDraft {
    const nodes: QaapJobLoopDraftNode[] = definition.graph.nodes.map(node => ({
        id: crypto.randomUUID(),
        key: node.key,
        title: node.request.title ?? '',
        cwd: node.request.cwd,
        kind: node.request.kind === 'function' ? 'function' : 'command',
        command: node.request.kind === 'function' ? '' : node.request.command,
        functionId: node.request.kind === 'function' ? node.request.functionId : '',
        input: node.request.kind === 'function' ? JSON.stringify(node.request.input ?? {}, undefined, 2) : '{}',
        dependsOn: [...(node.dependsOn ?? [])],
        bindings: (node.bindings ?? []).map(binding => ({
            id: crypto.randomUUID(),
            nodeKey: binding.from.nodeKey,
            source: binding.from.source ?? 'result',
            pointer: binding.from.pointer ?? '',
            targetPointer: binding.targetPointer,
        })),
    }));
    return {
        title: name,
        templateDescription: description,
        cwd: nodes[0]?.cwd ?? '',
        maxIterations: String(definition.maxIterations ?? 10),
        maxDurationMinutes: String((definition.maxDurationMs ?? 60 * 60_000) / 60_000),
        nodes,
        conditionNodeKey: definition.until.nodeKey,
        conditionSource: definition.until.source ?? 'result',
        conditionPointer: definition.until.pointer ?? '',
        conditionOperator: definition.until.operator,
        conditionExpected: definition.until.expected === undefined ? '' : JSON.stringify(definition.until.expected),
    };
}

export interface QaapJobLoopBuilderProps {
    readonly draft: QaapJobLoopDraft;
    readonly functions: readonly QaapJobFunctionDescriptor[];
    readonly busy: boolean;
    readonly savingTemplate?: boolean;
    readonly error?: string;
    readonly onChange: (draft: QaapJobLoopDraft) => void;
    readonly onCreate: (request: QaapCreateJobLoopRequest) => Promise<void>;
    readonly onSaveTemplate?: (request: QaapCreateJobLoopTemplateRequest) => Promise<void>;
    readonly onClose: () => void;
}

export function QaapJobLoopBuilder(props: QaapJobLoopBuilderProps): React.ReactNode {
    const validation = validateQaapJobLoopDraft(props.draft);
    const [submitted, setSubmitted] = React.useState(false);
    const [saveSubmitted, setSaveSubmitted] = React.useState(false);
    const update = (patch: Partial<QaapJobLoopDraft>): void => props.onChange({ ...props.draft, ...patch, idempotencyKey: undefined });
    const changeNode = (id: string, patch: Partial<QaapJobLoopDraftNode>): void => update({ nodes: props.draft.nodes.map(node => node.id === id ? { ...node, ...patch } : node) });
    const changeDefaultCwd = (cwd: string): void => update({
        cwd,
        nodes: props.draft.nodes.map(node => node.cwd === props.draft.cwd ? { ...node, cwd } : node),
    });
    const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault(); setSubmitted(true);
        if (!validation.valid || props.busy) return;
        const idempotencyKey = props.draft.idempotencyKey ?? crypto.randomUUID();
        const requestDraft = { ...props.draft, idempotencyKey };
        props.onChange(requestDraft);
        await props.onCreate(qaapJobLoopDraftToRequest(requestDraft));
    };
    const saveTemplate = async (): Promise<void> => {
        setSubmitted(true);
        setSaveSubmitted(true);
        const name = props.draft.title.trim();
        if (!validation.valid || !name || props.busy || props.savingTemplate || !props.onSaveTemplate) {
            return;
        }
        await props.onSaveTemplate(qaapJobLoopDraftToTemplateRequest(props.draft));
    };
    const show = (name: string): string | undefined => submitted ? validation.errors[name] : undefined;
    return <form className='qaap-job-loop-builder' onSubmit={event => void submit(event)} noValidate>
        <div className='qaap-job-loop-builder-head'><h2>{nls.localize('qaap/jobLoops/builder/title', 'Create job loop')}</h2><button type='button' onClick={props.onClose}>{nls.localize('qaap/jobLoops/builder/close', 'Close')}</button></div>
        {(props.error || (submitted && !validation.valid)) && <div className='qaap-job-loop-builder-alert' role='alert'>{props.error ?? nls.localize('qaap/jobLoops/builder/fixErrors', 'Fix the highlighted fields before creating the loop.')}</div>}
        <fieldset><legend>{nls.localize('qaap/jobLoops/builder/basics', 'Loop basics')}</legend>
            <Field
                label={nls.localize('qaap/jobLoops/builder/loopName', 'Name')}
                error={saveSubmitted && !props.draft.title.trim()
                    ? nls.localize('qaap/jobLoops/builder/templateNameRequired', 'Enter a name before saving this graph as a template.')
                    : undefined}
            >
                <input value={props.draft.title} onChange={e => update({ title: e.currentTarget.value })} />
            </Field>
            <Field label={nls.localize('qaap/jobLoops/builder/templateDescription', 'Template description (optional)')}>
                <input maxLength={4096} value={props.draft.templateDescription} onChange={e => update({ templateDescription: e.currentTarget.value })} />
            </Field>
            <Field label={nls.localize('qaap/jobLoops/builder/defaultCwd', 'Default workspace path')}><input value={props.draft.cwd} onChange={e => changeDefaultCwd(e.currentTarget.value)} /></Field>
            <Field label={nls.localize('qaap/jobLoops/builder/iterations', 'Maximum iterations')} error={show('iterations')}><input type='number' min='1' max='100' value={props.draft.maxIterations} onChange={e => update({ maxIterations: e.currentTarget.value })} /></Field>
            <Field label={nls.localize('qaap/jobLoops/builder/duration', 'Maximum duration (minutes)')} error={show('duration')}><input type='number' min='0.017' max='10080' value={props.draft.maxDurationMinutes} onChange={e => update({ maxDurationMinutes: e.currentTarget.value })} /></Field>
            {show('budget') && <p className='qaap-job-loop-builder-error'>{show('budget')}</p>}
        </fieldset>
        <fieldset><legend>{nls.localize('qaap/jobLoops/builder/nodes', 'Graph nodes')}</legend>{show('nodes') && <p className='qaap-job-loop-builder-error'>{show('nodes')}</p>}{show('graph') && <p className='qaap-job-loop-builder-error'>{show('graph')}</p>}
            {props.draft.nodes.map(node => <NodeCard key={node.id} node={node} nodes={props.draft.nodes} functions={props.functions} error={show} onChange={changeNode} onRemove={() => update({ nodes: props.draft.nodes.filter(candidate => candidate.id !== node.id) })} />)}
            <button type='button' disabled={props.draft.nodes.length >= MAX_NODES} onClick={() => { const node = createNode(`step-${props.draft.nodes.length + 1}`, props.draft.cwd); update({ nodes: [...props.draft.nodes, node] }); }}>{nls.localize('qaap/jobLoops/builder/addNode', 'Add node')}</button>
        </fieldset>
        <fieldset><legend>{nls.localize('qaap/jobLoops/builder/condition', 'Stop condition')}</legend>
            <Field label={nls.localize('qaap/jobLoops/builder/conditionNode', 'Node')} error={show('conditionNode')}><select value={props.draft.conditionNodeKey} onChange={e => update({ conditionNodeKey: e.currentTarget.value })}>{props.draft.nodes.map(node => <option key={node.id} value={node.key}>{node.key || nls.localize('qaap/jobLoops/builder/unnamedNode', 'Unnamed node')}</option>)}</select></Field>
            <Field label={nls.localize('qaap/jobLoops/builder/source', 'Source')}><select value={props.draft.conditionSource} onChange={e => update({ conditionSource: e.currentTarget.value as 'result' | 'job' })}><option value='result'>{nls.localize('qaap/jobLoops/builder/resultSource', 'Result')}</option><option value='job'>{nls.localize('qaap/jobLoops/builder/jobSource', 'Job state')}</option></select></Field>
            <Field label={nls.localize('qaap/jobLoops/builder/sourcePointer', 'Source JSON Pointer')} error={show('conditionPointer')}><input value={props.draft.conditionPointer} onChange={e => update({ conditionPointer: e.currentTarget.value })} placeholder='/' /></Field>
            <Field label={nls.localize('qaap/jobLoops/builder/operator', 'Operator')}><select value={props.draft.conditionOperator} onChange={e => update({ conditionOperator: e.currentTarget.value as QaapJobLoopConditionOperator })}>{QAAP_JOB_LOOP_CONDITION_OPERATORS.map(operator => <option key={operator} value={operator}>{conditionOperatorLabel(operator)}</option>)}</select></Field>
            {!['truthy', 'falsy'].includes(props.draft.conditionOperator) && <Field label={nls.localize('qaap/jobLoops/builder/expected', 'Expected JSON value')} error={show('conditionExpected')}><input value={props.draft.conditionExpected} onChange={e => update({ conditionExpected: e.currentTarget.value })} placeholder='true, 10, or "text"' /></Field>}
        </fieldset>
        <div className='qaap-job-loop-builder-actions'>
            {props.onSaveTemplate && <button type='button' disabled={props.busy || props.savingTemplate} onClick={() => void saveTemplate()}>
                {props.savingTemplate
                    ? nls.localize('qaap/jobLoops/builder/savingTemplate', 'Saving…')
                    : nls.localize('qaap/jobLoops/builder/saveTemplate', 'Save template')}
            </button>}
            <button type='submit' disabled={props.busy || props.savingTemplate}>{props.busy ? nls.localize('qaap/jobLoops/builder/creating', 'Creating…') : nls.localize('qaap/jobLoops/builder/create', 'Create loop')}</button>
        </div>
    </form>;
}

function NodeCard(props: { readonly node: QaapJobLoopDraftNode; readonly nodes: readonly QaapJobLoopDraftNode[]; readonly functions: readonly QaapJobFunctionDescriptor[]; readonly error: (name: string) => string | undefined; readonly onChange: (id: string, patch: Partial<QaapJobLoopDraftNode>) => void; readonly onRemove: () => void }): React.ReactNode {
    const { node, nodes, functions, error, onChange } = props;
    return <section className='qaap-job-loop-builder-node'><div className='qaap-job-loop-builder-node-head'><h3>{node.key || nls.localize('qaap/jobLoops/builder/unnamedNode', 'Unnamed node')}</h3><button type='button' onClick={props.onRemove}>{nls.localize('qaap/jobLoops/builder/removeNode', 'Remove')}</button></div>
        <Field label={nls.localize('qaap/jobLoops/builder/nodeKey', 'Key')} error={error(`node-${node.id}-key`)}><input value={node.key} onChange={e => onChange(node.id, { key: e.currentTarget.value })} /></Field>
        <Field label={nls.localize('qaap/jobLoops/builder/nodeTitle', 'Title')}><input value={node.title} onChange={e => onChange(node.id, { title: e.currentTarget.value })} /></Field>
        <Field label={nls.localize('qaap/jobLoops/builder/nodeCwd', 'Workspace path')} error={error(`node-${node.id}-cwd`)}><input value={node.cwd} onChange={e => onChange(node.id, { cwd: e.currentTarget.value })} /></Field>
        <Field label={nls.localize('qaap/jobLoops/builder/kind', 'Kind')}><select value={node.kind} onChange={e => onChange(node.id, { kind: e.currentTarget.value as QaapJobKind })}><option value='command'>{nls.localize('qaap/jobLoops/builder/commandKind', 'Command')}</option><option value='function'>{nls.localize('qaap/jobLoops/builder/functionKind', 'Typed function')}</option></select></Field>
        {node.kind === 'command' ? <Field label={nls.localize('qaap/jobLoops/builder/command', 'Command')} error={error(`node-${node.id}-command`)}><input value={node.command} onChange={e => onChange(node.id, { command: e.currentTarget.value })} /></Field> : <>
            <Field label={nls.localize('qaap/jobLoops/builder/function', 'Function')} error={error(`node-${node.id}-function`)}><select value={node.functionId} onChange={e => onChange(node.id, { functionId: e.currentTarget.value })}><option value=''>{nls.localize('qaap/jobLoops/builder/selectFunction', 'Select a function…')}</option>{functions.map(fn => <option key={fn.id} value={fn.id}>{fn.label}</option>)}</select></Field>
            <Field label={nls.localize('qaap/jobLoops/builder/input', 'Input JSON')} error={error(`node-${node.id}-input`)}><textarea value={node.input} onChange={e => onChange(node.id, { input: e.currentTarget.value })} rows={3} /></Field>
            <BindingsEditor node={node} nodes={nodes} error={error} onChange={onChange} />
        </>}
        <fieldset className='qaap-job-loop-builder-dependencies'><legend>{nls.localize('qaap/jobLoops/builder/dependencies', 'Runs after')}</legend>{nodes.filter(candidate => candidate.id !== node.id).map(candidate => <label key={candidate.id}><input type='checkbox' checked={node.dependsOn.includes(candidate.key)} onChange={e => onChange(node.id, { dependsOn: e.currentTarget.checked ? [...node.dependsOn, candidate.key] : node.dependsOn.filter(key => key !== candidate.key) })} />{candidate.key || nls.localize('qaap/jobLoops/builder/unnamedNode', 'Unnamed node')}</label>)}{error(`node-${node.id}-dependsOn`) && <p className='qaap-job-loop-builder-error'>{error(`node-${node.id}-dependsOn`)}</p>}</fieldset>
    </section>;
}

function Field(props: { readonly label: string; readonly error?: string; readonly children: React.ReactNode }): React.ReactNode {
    const id = React.useId();
    return <div className='qaap-job-loop-builder-field'><label htmlFor={id}>{props.label}</label>{React.cloneElement(props.children as React.ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>, { id, 'aria-invalid': Boolean(props.error), 'aria-describedby': props.error ? `${id}-error` : undefined })}{props.error && <span id={`${id}-error`} className='qaap-job-loop-builder-error'>{props.error}</span>}</div>;
}

function BindingsEditor(props: { readonly node: QaapJobLoopDraftNode; readonly nodes: readonly QaapJobLoopDraftNode[]; readonly error: (name: string) => string | undefined; readonly onChange: (id: string, patch: Partial<QaapJobLoopDraftNode>) => void }): React.ReactNode {
    const update = (id: string, patch: Partial<QaapJobLoopDraftBinding>): void => props.onChange(props.node.id, { bindings: props.node.bindings.map(binding => binding.id === id ? { ...binding, ...patch } : binding) });
    return <fieldset className='qaap-job-loop-builder-bindings'><legend>{nls.localize('qaap/jobLoops/builder/bindings', 'Previous-round bindings')}</legend>
        {props.node.bindings.map(binding => <div key={binding.id} className='qaap-job-loop-builder-binding'>
            <select aria-label={nls.localize('qaap/jobLoops/builder/bindingNode', 'Source node')} value={binding.nodeKey} onChange={e => update(binding.id, { nodeKey: e.currentTarget.value })}>{props.nodes.map(node => <option key={node.id} value={node.key}>{node.key}</option>)}</select>
            <select aria-label={nls.localize('qaap/jobLoops/builder/bindingSource', 'Source type')} value={binding.source} onChange={e => update(binding.id, { source: e.currentTarget.value as 'result' | 'job' })}><option value='result'>{nls.localize('qaap/jobLoops/builder/resultSource', 'Result')}</option><option value='job'>{nls.localize('qaap/jobLoops/builder/jobSource', 'Job state')}</option></select>
            <input aria-label={nls.localize('qaap/jobLoops/builder/bindingPointer', 'Source JSON Pointer')} value={binding.pointer} placeholder='/' onChange={e => update(binding.id, { pointer: e.currentTarget.value })} />
            <input aria-label={nls.localize('qaap/jobLoops/builder/bindingTarget', 'Input JSON Pointer')} value={binding.targetPointer} placeholder='/' onChange={e => update(binding.id, { targetPointer: e.currentTarget.value })} />
            <button type='button' onClick={() => props.onChange(props.node.id, { bindings: props.node.bindings.filter(candidate => candidate.id !== binding.id) })}>{nls.localize('qaap/jobLoops/builder/removeBinding', 'Remove binding')}</button>
            {props.error(`node-${props.node.id}-binding-${binding.id}`) && <p className='qaap-job-loop-builder-error'>{props.error(`node-${props.node.id}-binding-${binding.id}`)}</p>}
        </div>)}
        <button type='button' disabled={props.node.bindings.length >= 32} onClick={() => props.onChange(props.node.id, { bindings: [...props.node.bindings, { id: crypto.randomUUID(), nodeKey: props.nodes[0]?.key ?? '', source: 'result', pointer: '', targetPointer: '' }] })}>{nls.localize('qaap/jobLoops/builder/addBinding', 'Add binding')}</button>
    </fieldset>;
}

function createNode(key: string, cwd: string): QaapJobLoopDraftNode { return { id: crypto.randomUUID(), key, title: '', cwd, kind: 'command', command: '', functionId: '', input: '{}', dependsOn: [], bindings: [] }; }
function parseJson(value: string): { readonly ok: boolean; readonly value?: unknown } { try { return { ok: true, value: JSON.parse(value) }; } catch { return { ok: false }; } }
function isNumericOperator(operator: QaapJobLoopConditionOperator): boolean { return operator === 'greater_than' || operator === 'greater_or_equal' || operator === 'less_than' || operator === 'less_or_equal'; }
function hasCycle(nodes: readonly QaapJobLoopDraftNode[]): boolean { const map = new Map(nodes.map(node => [node.key.trim(), node.dependsOn])); const seen = new Set<string>(); const active = new Set<string>(); const visit = (key: string): boolean => { if (active.has(key)) return true; if (seen.has(key)) return false; seen.add(key); active.add(key); for (const dependency of map.get(key) ?? []) if (map.has(dependency) && visit(dependency)) return true; active.delete(key); return false; }; return [...map.keys()].some(visit); }
function conditionOperatorLabel(operator: QaapJobLoopConditionOperator): string {
    switch (operator) {
        case 'equals': return nls.localize('qaap/jobLoops/builder/operatorEquals', 'Equals');
        case 'not_equals': return nls.localize('qaap/jobLoops/builder/operatorNotEquals', 'Does not equal');
        case 'greater_than': return nls.localize('qaap/jobLoops/builder/operatorGreater', 'Greater than');
        case 'greater_or_equal': return nls.localize('qaap/jobLoops/builder/operatorGreaterEqual', 'Greater than or equal');
        case 'less_than': return nls.localize('qaap/jobLoops/builder/operatorLess', 'Less than');
        case 'less_or_equal': return nls.localize('qaap/jobLoops/builder/operatorLessEqual', 'Less than or equal');
        case 'truthy': return nls.localize('qaap/jobLoops/builder/operatorTruthy', 'Truthy');
        case 'falsy': return nls.localize('qaap/jobLoops/builder/operatorFalsy', 'Falsy');
    }
}
