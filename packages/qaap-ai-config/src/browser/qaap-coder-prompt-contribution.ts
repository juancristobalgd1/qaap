// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { BasePromptFragment, PromptService } from '@theia/ai-core/lib/common';
import {
    CODER_SYSTEM_PROMPT_ID,
    getCoderAgentModeNextPromptTemplate,
    getCoderAgentModePromptTemplate,
    getCoderPromptTemplateEdit,
    getCoderPromptTemplateEditNext,
} from '@theia/ai-ide/lib/common/coder-replace-prompt-template';
import {
    QAAP_BOOTSTRAP_INSTALL_TOOL_ID,
    QAAP_BOOTSTRAP_OPEN_PREVIEW_TOOL_ID,
    QAAP_BOOTSTRAP_RUN_DEV_TOOL_ID,
    QAAP_BOOTSTRAP_STATUS_TOOL_ID,
} from '@theia/qaap-mobile-shell/lib/browser/qaap-bootstrap-tools-common';
import { QAAP_PICK_ELEMENT_TOOL_ID } from '@theia/qaap-adapters/lib/browser/qaap-element-picker-tools-common';
import { QAAP_BOOTSTRAP_VARIABLE } from '@theia/qaap-mobile-shell/lib/browser/qaap-bootstrap-variable-contribution';
import { QAAP_CODER_ANALYZE_THINK_FRAGMENT_ID, QAAP_CODER_DEV_WORKFLOW_FRAGMENT_ID } from '../common/qaap-coder-prompt-ids';
import { QAAP_CODER_PLAN_MODE_FRAGMENT_ID } from '../common/qaap-plan-prompt-ids';

const WORKFLOW_APPEND = `\n\n{{prompt:${QAAP_CODER_DEV_WORKFLOW_FRAGMENT_ID}}}\n`;
const PLAN_APPEND = `\n\n{{prompt:${QAAP_CODER_PLAN_MODE_FRAGMENT_ID}}}\n`;
const ANALYZE_THINK_PREPEND = `{{prompt:${QAAP_CODER_ANALYZE_THINK_FRAGMENT_ID}}}\n\n`;

const QAAP_CODER_PLAN_MODE_TEMPLATE = `## Qaap plan mode (visible before multi-file edits)

When the user asks for a non-trivial change (3+ files, refactors, or new features):

1. **Plan first** — Reply with a short markdown plan: goal, files to touch, risks, and test/preview steps. Do **not** edit files until the user confirms or says "go".
2. **Scope cap** — If the plan would touch more than ~8 files, split into phases and ask which phase to run first.
3. **After approval** — Execute one phase at a time; re-check \`qaap_bootstrap_status\` before claiming preview is ready.`;

const QAAP_CODER_ANALYZE_THINK_TEMPLATE = `## Qaap analyze before acting

Before invoking any tool, editing any file, or running any command:

1. **Analyze the request** — Read the user's message carefully and determine what they are actually asking for. Distinguish greetings, questions, and explicit tasks.
2. **Think before acting** — Decide whether the request is clear enough to proceed safely. Do not assume intent.
3. **Greetings and unclear input** — If the user only greets you (e.g. "hola", "hello", "hi") or asks a vague question without a concrete task, respond with a greeting and ask what they need. Do NOT read files, edit files, run commands, or perform any work until the user gives you a clear task.
4. **If unclear or incomplete** — Ask the user for clarification instead of guessing or performing unnecessary work.
5. **If clear and actionable** — Proceed with the minimal appropriate action and explain what you are doing.`;

const QAAP_CODER_DEV_WORKFLOW_TEMPLATE = `## Qaap dev preview (web UI workspaces)

When you change UI code (components, styles, pages, layout):

Live bootstrap context is also available as **#${QAAP_BOOTSTRAP_VARIABLE.name}** in prompts.

1. **~{${QAAP_BOOTSTRAP_STATUS_TOOL_ID}}** — inspect phase, \`needsInstall\`, \`previewUrl\`, terminal failures, and errors before acting.
2. If \`needsInstall\` is true or dependencies changed, run **~{${QAAP_BOOTSTRAP_INSTALL_TOOL_ID}}** and wait until phase is \`ready-to-run\` (install may chain into dev automatically).
3. **~{${QAAP_BOOTSTRAP_RUN_DEV_TOOL_ID}}** — start or restart the dev server when install is not required.
4. **~{${QAAP_BOOTSTRAP_OPEN_PREVIEW_TOOL_ID}}** — open or focus the in-IDE preview tab once a URL is available.
5. **~{${QAAP_PICK_ELEMENT_TOOL_ID}}** — activate the DOM picker in the preview to anchor visual edits (returns element path and HTML).

After each UI edit cycle, **re-run dev and open preview** so changes are visible. Do not assume hot reload fixed everything without checking \`qaap_bootstrap_status\`.`;

@injectable()
export class QaapCoderPromptContribution implements FrontendApplicationContribution {

    @inject(PromptService)
    protected readonly promptService: PromptService;

    onStart(): void {
        // Coder variants are registered by AgentService during its onStart; patch on the next tick.
        queueMicrotask(() => this.registerQaapCoderWorkflow());
    }

    protected registerQaapCoderWorkflow(): void {
        this.promptService.addBuiltInPromptFragment({
            id: QAAP_CODER_DEV_WORKFLOW_FRAGMENT_ID,
            template: QAAP_CODER_DEV_WORKFLOW_TEMPLATE,
        });
        this.promptService.addBuiltInPromptFragment({
            id: QAAP_CODER_PLAN_MODE_FRAGMENT_ID,
            template: QAAP_CODER_PLAN_MODE_TEMPLATE,
        });
        this.promptService.addBuiltInPromptFragment({
            id: QAAP_CODER_ANALYZE_THINK_FRAGMENT_ID,
            template: QAAP_CODER_ANALYZE_THINK_TEMPLATE,
        });

        const variants: BasePromptFragment[] = [
            getCoderAgentModePromptTemplate(),
            getCoderAgentModeNextPromptTemplate(),
            getCoderPromptTemplateEdit(),
            getCoderPromptTemplateEditNext(),
        ];
        for (const variant of variants) {
            const patched: BasePromptFragment = {
                ...variant,
                template: ANALYZE_THINK_PREPEND + variant.template + WORKFLOW_APPEND + PLAN_APPEND,
            };
            const isDefault = variant.id === getCoderAgentModePromptTemplate().id;
            this.promptService.addBuiltInPromptFragment(patched, CODER_SYSTEM_PROMPT_ID, isDefault);
        }
    }
}
