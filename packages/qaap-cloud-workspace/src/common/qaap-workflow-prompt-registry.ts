// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Resolves a node's `promptRef` into the text an agent turn actually receives (ADR-001).
 *
 * Refs are an allowlist, not free-form text: a workflow definition can travel from a template, an
 * import or (later) a model-authored graph, so letting `promptRef` be an arbitrary prompt would
 * turn workflow authoring into prompt injection with the run's own credentials and cwd.
 */

import {
    buildAgentReviewPrompt,
    buildAgentReviewVerdictInstruction,
    DEFAULT_REVIEW_DIFF_CAP_CHARS,
    redactAgentReviewVerdictMarkers,
} from './qaap-agent-review';
import {
    QAAP_WORKFLOW_PLAN_ARTIFACT,
    QAAP_WORKFLOW_PLAN_REVIEW_ARTIFACT,
    QAAP_WORKFLOW_REVIEW_DIFF_ARTIFACT,
    QAAP_WORKFLOW_REVIEW_LENSES,
    QAAP_WORKFLOW_REVIEW_VERDICT_ARTIFACT,
    QAAP_WORKFLOW_STRUCTURE_ARTIFACT,
    QAAP_WORKFLOW_VERIFICATION_ARTIFACT,
    QAAP_WORKFLOW_VERIFY_FAILURE_ARTIFACT,
} from './qaap-workflow-ir';

export interface QaapWorkflowPromptContext {
    /** Values captured when the run started, e.g. `{ task: 'fix the login bug' }`. */
    readonly inputs: Readonly<Record<string, string>>;
    /** Binding keys emitted by earlier nodes, e.g. `review.passed`. */
    readonly bindings: Readonly<Record<string, string>>;
    /** Text earlier deterministic nodes produced, e.g. the captured diff under `review.diff`. */
    readonly artifacts?: Readonly<Record<string, string>>;
}

export type QaapWorkflowPromptTemplate = (context: QaapWorkflowPromptContext) => string;

/**
 * How this run knows the goal is met. Named so the turn can run the very same check itself instead
 * of guessing, which is the whole difference between a goal and a wish.
 */
function goalCheckLine(context: QaapWorkflowPromptContext): string {
    const script = context.inputs.checkScript?.trim();
    return script
        ? `Success is decided mechanically by \`npm run ${script}\` exiting 0. Nothing else counts as done.`
        : 'Success is decided mechanically by this repository\'s own verification scripts (typecheck, build, test, lint) exiting 0.';
}

export class QaapWorkflowPromptError extends Error { }

/** What each review lens is asked to look for. Keyed by the lens' `promptRef`. */
interface QaapWorkflowReviewLensBody {
    /** Named in the synthesis prompt too, so the decider knows which question each report answers. */
    readonly title: string;
    readonly questions: readonly string[];
}

const REVIEW_LENS_BODIES: Readonly<Record<string, QaapWorkflowReviewLensBody>> = {
    'review-lens-correctness': {
        title: 'Correctness',
        questions: [
            '- Bugs the change introduces: wrong conditions, off-by-one, unhandled errors, wrong types at the boundary.',
            '- Edge cases and inputs it stops handling (empty, missing, concurrent, very large).',
            '- Callers, tests or callers-of-callers this breaks, including ones not in the diff.',
            '- State that is now written twice, never written, or written in the wrong order.',
        ],
    },
    'review-lens-safety': {
        title: 'Safety and side effects',
        questions: [
            '- Anything destructive or irreversible: deleted data, overwritten files, force pushes, dropped tables.',
            '- Security: injection, missing validation, secrets or tokens in code or logs, broken tenant isolation, widened permissions.',
            '- Blast radius: shared/global state, configuration or dependency changes that reach code the task never mentioned.',
            '- Resource behaviour that only shows up in production: unbounded loops or growth, leaked processes, missing timeouts.',
        ],
    },
    'review-lens-intent': {
        title: 'Does this do what was asked',
        questions: [
            '- Does the change actually satisfy the task, or only the easy part of it?',
            '- Scope creep: changes the task never asked for.',
            '- Faked completion: tests weakened, skipped or asserting nothing; guards deleted to make something pass; stubs left behind.',
            '- Anything claimed as done that the diff does not contain.',
        ],
    },
};

/** The diff as prompts inline it: capped, and with an explicit empty branch. */
function inlineDiff(context: QaapWorkflowPromptContext): string {
    const diff = context.artifacts?.[QAAP_WORKFLOW_REVIEW_DIFF_ARTIFACT] ?? '';
    const capped = diff.length > DEFAULT_REVIEW_DIFF_CAP_CHARS
        ? `${diff.slice(0, DEFAULT_REVIEW_DIFF_CAP_CHARS)}\n…(diff truncated)`
        : diff;
    return capped || '(empty diff — inspect the working tree yourself)';
}

/**
 * What the failing check printed, as a fix turn receives it — or the instruction to go and get it
 * when the capture is missing.
 *
 * The failure is repository output, not agent text, and it still goes through the marker redaction:
 * a test that prints a verdict marker would otherwise reach a turn whose own output the graph reads
 * back.
 */
function verificationFailureSection(context: QaapWorkflowPromptContext): readonly string[] {
    const failure = quoteAgentText(context.artifacts?.[QAAP_WORKFLOW_VERIFY_FAILURE_ARTIFACT]);
    return failure
        ? ['', 'This is what the check printed when it failed — fix THIS, and do not go looking for something else to fix:', '', failure]
        : ['', 'The failing output was not captured. Run the check yourself first, then fix exactly what it reports.'];
}

/** Agent-written text on its way into a verdict-bearing prompt: never carries a live marker. */
function quoteAgentText(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? redactAgentReviewVerdictMarkers(trimmed) : undefined;
}

const READ_ONLY_RULES: readonly string[] = [
    'You may run read-only commands to inspect the repository. Do NOT edit any file, do NOT commit, do NOT fix anything — you only judge.',
    'Do not start an application, dev server, watcher, or any other long-lived process. Use bounded read-only checks instead.',
];

const REQUIRED_INPUT_MISSING = (ref: string, key: string): string =>
    `Workflow prompt "${ref}" requires input "${key}".`;

function requireInput(ref: string, context: QaapWorkflowPromptContext, key: string): string {
    const value = context.inputs[key]?.trim();
    if (!value) {
        throw new QaapWorkflowPromptError(REQUIRED_INPUT_MISSING(ref, key));
    }
    return value;
}

/** Allowlisted prompt templates addressable from a workflow definition. */
export class QaapWorkflowPromptRegistry {

    protected readonly templates = new Map<string, QaapWorkflowPromptTemplate>();

    constructor() {
        this.registerBuiltins();
    }

    register(ref: string, template: QaapWorkflowPromptTemplate): void {
        if (this.templates.has(ref)) {
            throw new QaapWorkflowPromptError(`Duplicate workflow prompt ref: ${ref}`);
        }
        this.templates.set(ref, template);
    }

    has(ref: string): boolean {
        return this.templates.has(ref);
    }

    resolve(ref: string, context: QaapWorkflowPromptContext): string {
        const template = this.templates.get(ref);
        if (!template) {
            throw new QaapWorkflowPromptError(`Unknown workflow prompt ref: ${ref}`);
        }
        return template(context);
    }

    protected registerBuiltins(): void {
        this.register('user-task', context => requireInput('user-task', context, 'task'));

        // Two read-only explorers with DIFFERENT lenses, so the fan-out buys coverage instead of
        // the same answer twice: one maps where the change belongs, the other how it is verified.
        this.register('explore-structure', context => [
            'Explore this repository READ-ONLY. Do not edit, create or delete any file.',
            'Report, in at most 15 lines: the files and functions a change for the task below would touch, with paths;',
            'the conventions that change must follow; and anything that looks like a trap (duplicated logic, callers that would break).',
            '',
            `Task: ${requireInput('explore-structure', context, 'task')}`,
        ].join('\n'));

        this.register('explore-verification', context => [
            'Explore this repository READ-ONLY. Do not edit, create or delete any file.',
            'Report, in at most 15 lines: the exact commands that verify a change here (scripts, test runner, lint),',
            'which existing tests cover the area of the task below, and what a new test for it would have to assert.',
            '',
            `Task: ${requireInput('explore-verification', context, 'task')}`,
        ].join('\n'));

        // The implement turn is the whole point of the fan-out: it starts already knowing the map.
        this.register('implement-with-findings', context => {
            const structure = context.artifacts?.[QAAP_WORKFLOW_STRUCTURE_ARTIFACT]?.trim();
            const verification = context.artifacts?.[QAAP_WORKFLOW_VERIFICATION_ARTIFACT]?.trim();
            const findings = [
                structure && `Where the change belongs (from a read-only explorer):\n${structure}`,
                verification && `How this repository is verified (from a read-only explorer):\n${verification}`,
            ].filter(Boolean);
            return [
                requireInput('implement-with-findings', context, 'task'),
                ...(findings.length > 0
                    ? [
                        '',
                        '---',
                        'Two explorers already read this repository for you. Treat their notes as leads to confirm, not as facts:',
                        '',
                        ...findings,
                    ]
                    : []),
            ].join('\n');
        });

        // Plan mode. The plan turn touches nothing, so a person decides BEFORE any edit exists.
        this.register('plan-task', context => [
            'Explore this repository READ-ONLY and propose a plan. Do not edit, create or delete any file.',
            'A person reads this plan and decides whether the work goes ahead, so write it for them:',
            '- what you will change, file by file, with paths;',
            '- how you will verify it (the exact command);',
            '- what you will deliberately NOT do, and anything you are unsure about.',
            'Keep it under 20 lines. No preamble.',
            '',
            `Task: ${requireInput('plan-task', context, 'task')}`,
        ].join('\n'));

        this.register('implement-approved-plan', context => {
            const plan = context.artifacts?.[QAAP_WORKFLOW_PLAN_ARTIFACT]?.trim();
            return [
                requireInput('implement-approved-plan', context, 'task'),
                ...(plan
                    ? [
                        '',
                        '---',
                        'A person has APPROVED this plan. Follow it. If you find it is wrong, say so and stop rather than',
                        'silently doing something else — the approval was for this plan, not for the task in general.',
                        '',
                        plan,
                    ]
                    : []),
            ].join('\n');
        });

        // Goal runs. The difference from `user-task` is the contract: the turn is told what "done"
        // means MECHANICALLY, and that a machine — not its own judgement — will decide.
        this.register('goal-task', context => [
            `Goal: ${requireInput('goal-task', context, 'task')}`,
            '',
            goalCheckLine(context),
            'Do not stop at a plan or a partial change: the run only finishes when that check passes.',
            'If you believe the goal is already met, run the check and say what it printed.',
        ].join('\n'));

        this.register('fix-goal', context => [
            'The goal is NOT met yet: its success check failed after the previous turn.',
            '',
            `Goal: ${requireInput('fix-goal', context, 'task')}`,
            goalCheckLine(context),
            '',
            'Fix the cause rather than the symptom, and change as little as possible.',
            ...verificationFailureSection(context),
        ].join('\n'));

        this.register('fix-verification', context => [
            'The previous turn left the workspace failing its own verification.',
            'Fix it, changing as little as possible.',
            '',
            `Original task: ${requireInput('fix-verification', context, 'task')}`,
            ...verificationFailureSection(context),
        ].join('\n'));

        // The turn that answers a rejection. It gets the objections AND the diff it wrote, because
        // "fix what the reviewer said" is unanswerable without both: the objections name file:line
        // in a change the turn no longer has in front of it.
        this.register('fix-review', context => {
            const verdict = quoteAgentText(context.artifacts?.[QAAP_WORKFLOW_REVIEW_VERDICT_ARTIFACT]);
            return [
                'An independent reviewer REJECTED the change you just made. It is still in the working tree:'
                + ' repair it in place, do not start over, and do not undo work the reviewer did not object to.',
                '',
                `Original task: ${requireInput('fix-review', context, 'task')}`,
                '',
                'What the reviewer said:',
                verdict ?? '(the verdict was not captured — re-read the diff below and fix what is actually wrong with it)',
                '',
                'Address every objection, or state plainly why one of them is mistaken. The same review runs again on the'
                + ' result, so unrelated edits only widen what has to be judged a second time.',
                '',
                'The change you wrote, as the reviewer saw it:',
                inlineDiff(context),
            ].join('\n');
        });

        // Reuse the runner's reviewer prompt so the @@QAAP:VERDICT@@ contract lives in exactly one
        // place. A judge node declares requireSentinel, and without this instruction a faithful
        // reviewer writes prose, emits no marker, and every review lands inconclusive — observed
        // live with the claude backend. The diff comes from the `git-diff` node's artifact; when it
        // is missing the prompt's empty-diff branch tells the reviewer to inspect the tree itself.
        this.register('adversarial-review', context => buildAgentReviewPrompt({
            originalCommand: requireInput('adversarial-review', context, 'task'),
            diff: context.artifacts?.[QAAP_WORKFLOW_REVIEW_DIFF_ARTIFACT] ?? '',
        }));

        this.registerReviewLenses();
        this.registerPlanGate();
    }

    /**
     * Multi-lens review. Each lens asks its OWN question of the same diff and answers with findings
     * only — the verdict belongs to the synthesis turn, which is the one node that sees all three.
     */
    protected registerReviewLenses(): void {
        for (const lens of QAAP_WORKFLOW_REVIEW_LENSES) {
            const body = REVIEW_LENS_BODIES[lens.promptRef];
            if (!body) {
                throw new QaapWorkflowPromptError(`Review lens "${lens.promptRef}" has no prompt body.`);
            }
            this.register(lens.promptRef, context => [
                `You are one of ${QAAP_WORKFLOW_REVIEW_LENSES.length} independent reviewers reading the SAME change through DIFFERENT lenses.`,
                `Your lens is: ${body.title}. Stay inside it — the other lenses cover the rest, and duplicating them buys nothing.`,
                'Another agent just finished a task in this repository and its uncommitted changes are still in the working tree.',
                `The task that produced the changes was started with: ${requireInput(lens.promptRef, context, 'task')}`,
                '',
                'Look for:',
                ...body.questions,
                ...READ_ONLY_RULES,
                '',
                'Report at most 10 lines. One finding per line, as: SEVERITY | file:line | what is wrong and why it matters.',
                'SEVERITY is blocker, major or minor. If your lens finds nothing, answer exactly: no findings.',
                'Do NOT give a verdict and do NOT emit any review marker. A separate step weighs all lenses and decides;',
                'a verdict from you would be a third of the picture presented as the whole answer.',
                '',
                'Unified diff of the uncommitted changes:',
                inlineDiff(context),
            ].join('\n'));
        }

        // The one node that decides. It sees every lens, so it is also the only one that can tell
        // agreement from "nobody was looking".
        this.register('synthesize-review', context => {
            const reports = QAAP_WORKFLOW_REVIEW_LENSES.map(lens => {
                const body = REVIEW_LENS_BODIES[lens.promptRef];
                const report = quoteAgentText(context.artifacts?.[lens.artifactKey]);
                return [
                    `### Lens: ${body?.title ?? lens.nodeId}`,
                    report ?? '(this lens produced no report — that reviewer did not run)',
                ].join('\n');
            });
            return [
                'You are the reviewer of record. Independent reviewers just read the SAME uncommitted change,'
                + ' each through a different lens, and their reports are below. You decide, once.',
                `The task that produced the changes was started with: ${requireInput('synthesize-review', context, 'task')}`,
                '',
                'How to weigh them:',
                '- Confirm a finding yourself before it decides anything: the lenses can be wrong, and you are the one on record.',
                '- One substantiated blocker is enough to fail, even if the other lenses were happy — they were not looking for it.',
                '- The lenses disagree because they asked different questions. Do not average them and do not count votes.',
                '- A lens reporting nothing means it found nothing under ITS lens, not that the change is good.',
                '- A missing report means that reviewer never ran. Say so in your reason instead of reading it as agreement.',
                ...READ_ONLY_RULES,
                '',
                buildAgentReviewVerdictInstruction(),
                '',
                'Lens reports:',
                ...reports,
                '',
                'Unified diff of the uncommitted changes:',
                inlineDiff(context),
            ].join('\n');
        });
    }

    /**
     * Plan gate. Same read-only plan as `plan-task`, but the reader is a judge rather than a person:
     * it must be checkable, and a rejected plan comes back here with the objections attached.
     */
    protected registerPlanGate(): void {
        this.register('plan-under-review', context => {
            const objections = quoteAgentText(context.artifacts?.[QAAP_WORKFLOW_PLAN_REVIEW_ARTIFACT]);
            const previous = quoteAgentText(context.artifacts?.[QAAP_WORKFLOW_PLAN_ARTIFACT]);
            return [
                'Explore this repository READ-ONLY and propose a plan. Do not edit, create or delete any file.',
                'An independent reviewer decides whether this plan is worth implementing, so make it checkable:',
                '- what you will change, file by file, with real paths that exist (or the exact path you will create);',
                '- how you will verify it — the exact command;',
                '- what you will deliberately NOT do, and what you are unsure about.',
                'Keep it under 20 lines. No preamble. Do not emit any review marker: you are the one being reviewed.',
                '',
                `Task: ${requireInput('plan-under-review', context, 'task')}`,
                ...(objections
                    ? [
                        '',
                        '---',
                        'Your previous plan was REJECTED. Address these objections; do not restate the same plan with new wording:',
                        '',
                        objections,
                        ...(previous ? ['', 'The plan that was rejected:', '', previous] : []),
                    ]
                    : []),
            ].join('\n');
        });

        this.register('plan-review', context => {
            const plan = quoteAgentText(context.artifacts?.[QAAP_WORKFLOW_PLAN_ARTIFACT]);
            return [
                'You are an INDEPENDENT senior reviewer. Another agent proposed the plan below and NOTHING has been'
                + ' implemented yet — you are the gate before any file is touched.',
                `The task it is planning for: ${requireInput('plan-review', context, 'task')}`,
                '',
                'Judge the plan, not its prose:',
                '- Would it actually solve the task, or only the part that is easy to write down?',
                '- Are the files, paths and symbols it names real? Check them.',
                '- Is the verification concrete enough to tell success from failure?',
                '- Does it reach further than the task asked, or do anything destructive or irreversible?',
                '- What has it missed that this repository makes obvious?',
                'Fail it only for something that would make the implementation wrong, unsafe or unverifiable —'
                + ' not for style, and not for what you would have written instead. Rejecting a workable plan costs a whole extra turn.',
                ...READ_ONLY_RULES,
                '',
                buildAgentReviewVerdictInstruction(),
                'Before that line, list the objections that must be fixed, one per line: the plan turn gets them verbatim.',
                '',
                'The proposed plan:',
                plan ?? '(no plan was captured — fail it and say the plan never arrived)',
            ].join('\n');
        });

        this.register('implement-reviewed-plan', context => {
            const plan = quoteAgentText(context.artifacts?.[QAAP_WORKFLOW_PLAN_ARTIFACT]);
            return [
                requireInput('implement-reviewed-plan', context, 'task'),
                ...(plan
                    ? [
                        '',
                        '---',
                        'An independent reviewer ACCEPTED this plan. Follow it. If you find it is wrong once you are inside the code,',
                        'say so and stop rather than silently doing something else — what passed review was this plan, not the task in general.',
                        '',
                        plan,
                    ]
                    : []),
            ].join('\n');
        });
    }
}
