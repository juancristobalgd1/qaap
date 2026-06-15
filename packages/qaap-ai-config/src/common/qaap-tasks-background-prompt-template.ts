/* eslint-disable @typescript-eslint/tslint/config */
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { BasePromptFragment } from '@theia/ai-core/lib/common';
import { QAAP_TASKS_BACKGROUND_CONTEXT_PROMPT_ID } from '@theia/qaap-mobile-shell/lib/common/qaap-tasks-background-prompt-ids';

/**
 * GLOBAL context prepended to every Qaap cloud background-agent prompt (QAIQ, Aider, Codex, …).
 *
 * Keep this short and cross-project: it carries facts true for ALL Qaap workspaces. Per-project
 * details come from the workspace `project-info` artifact, which the QAIQ bridge appends right
 * after this block. This is NOT a behavioral system prompt — the CLI agent has its own — it is
 * platform context plus a few operating rules that only hold in the cloud sandbox.
 *
 * Plain text (no `{{variables}}`) so it resolves cleanly regardless of editor/chat context.
 * Editable by the user in AI Configuration → Prompt Fragments under its id.
 */
const QAAP_TASKS_BACKGROUND_CONTEXT_TEMPLATE = `# Qaap environment context

You are running inside a **Qaap cloud workspace** — an ephemeral, per-project sandbox that holds this repository. Paths are relative to the workspace root; do not assume any path from another project or machine.

Qaap auto-detects web projects and can start an in-IDE preview (static \`index.html\` on port 8080, or Node dev scripts on their usual ports).

This is cross-project context. Project-specific details (stack, build/test commands, conventions) follow below when a project-info artifact is present.

## Operating rules

**Stack constraints.** When the user asks for HTML/CSS vanilla, sin frameworks, sin dependencias, or no bundler: create only \`index.html\` plus optional \`.css\` / \`.js\` files. Do NOT add \`package.json\`, \`npm install\`, Vite, or other toolchains unless they explicitly request a framework.

**Incremental edits.** On follow-up turns, change only what the user asked for. Do not regenerate or delete unrelated files. Preserve layout and styling unless asked to refactor.

**Preview.** When the user asks to run, launch, open, or show a preview: after writing files, stop. Qaap bootstrap installs (if needed) and starts the dev server. Static sites need no npm. State the expected port in your final message (8080 static, 5173 Vite, 3000 Next). Avoid leaving a long-lived \`npm run dev\` shell running when Qaap can bootstrap the preview.

**Error recovery.** If the user reports broken HTML/CSS, wrong port, or failed install: read the error, apply a minimal fix, explain what changed, and retry once. Do not rebuild the project from scratch.`;

export function getQaapTasksBackgroundContextFragment(): BasePromptFragment {
    return {
        id: QAAP_TASKS_BACKGROUND_CONTEXT_PROMPT_ID,
        template: QAAP_TASKS_BACKGROUND_CONTEXT_TEMPLATE,
    };
}
