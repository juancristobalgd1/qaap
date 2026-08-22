#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
/**
 * CI guard: fail if tracked paths drift from upstream outside an allowlist.
 * Product code must live under `packages/qaap-*` (or documented seams in core).
 *
 * Usage:
 *   node scripts/qaap-drift-check.js
 *   QAAP_DIFF_BASE=upstream/master node scripts/qaap-drift-check.js
 *
 * Report only (always exit 0):
 *   QAAP_DRIFT_CHECK_REPORT=1 node scripts/qaap-drift-check.js
 *
 * Known historical drift (outside allowlist) is listed in qaap-drift-baseline.txt.
 * The check fails only when NEW paths drift outside the allowlist. Shrink the baseline
 * as paths are migrated into packages/qaap-*.
 */
'use strict';

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const baselinePath = path.join(__dirname, 'qaap-drift-baseline.txt');
const upstreamBasePath = path.join(__dirname, 'qaap-upstream-base.txt');

function sh(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', cwd: root, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
        return '';
    }
}

const reportOnly = process.env.QAAP_DRIFT_CHECK_REPORT === '1';
const writeBaseline = process.argv.includes('--write-baseline');

/** Read the reviewed upstream revision shared by local checks and CI. */
function loadPinnedUpstreamBase() {
    if (!fs.existsSync(upstreamBasePath)) {
        return undefined;
    }
    const entries = fs.readFileSync(upstreamBasePath, 'utf8')
        .split(/\r?\n/)
        .map(line => line.replace(/#.*$/, '').trim())
        .filter(Boolean);
    if (entries.length !== 1 || !/^[0-9a-f]{40}$/i.test(entries[0])) {
        console.error('[qaap-drift-check] scripts/qaap-upstream-base.txt must contain exactly one full commit SHA.');
        process.exit(2);
    }
    return entries[0];
}

/** Prefer an explicit override, then the reviewed base pinned in the repository. */
function resolveDiffBase() {
    if (process.env.QAAP_DIFF_BASE) {
        return process.env.QAAP_DIFF_BASE;
    }
    const pinnedBase = loadPinnedUpstreamBase();
    if (pinnedBase) {
        return pinnedBase;
    }
    const candidates = [
        'refs/heads/upstream/master',
        'refs/remotes/upstream/master',
        'upstream/master',
    ];
    for (const candidate of candidates) {
        if (sh(`git rev-parse --verify ${candidate}`)) {
            return candidate;
        }
    }
    return 'upstream/master';
}

const base = resolveDiffBase();

/** @type {RegExp[]} Paths allowed to differ from upstream (seams + explicit QAAP tooling). */
const ALLOWED = [
    /^packages\/qaap-/,
    /^scripts\/qaap-/,
    // ESLint 8 compatibility: @typescript-eslint 8 removed formatting rules that
    // were still referenced by the shared config and inline suppressions in these
    // upstream files. Keep the migration allowlisted until upstream adopts the same
    // rule names/configuration.
    /^configs\/errors\.eslintrc\.json$/,
    /^(?:packages\/core\/src\/browser\/common-frontend-contribution\.ts|packages\/core\/src\/browser\/components\/card\.tsx|packages\/core\/src\/common\/json-schema\.ts|packages\/editor\/src\/common\/editor-generated-preference-schema\.ts|packages\/plugin-ext\/src\/plugin\/file-system-ext-impl\.ts|packages\/process\/src\/node\/(?:raw-process|terminal-process)\.ts|packages\/terminal\/src\/node\/shell-process\.ts)$/,
    // Localization lint requires an explicit key for the remote MCP connect label.
    /^packages\/ai-mcp\/src\/browser\/mcp-configuration-widget\.tsx$/,
    // Localization lint recognizes this shared catalog label as a default string.
    /^packages\/ai-vercel-ai\/src\/common\/vercel-ai-preferences\.ts$/,
    // ESLint 8 compatibility and explicit keys for chat UI labels.
    /^(?:packages\/ai-chat-ui\/src\/browser\/chat-capabilities-panel\.tsx|packages\/ai-chat-ui\/src\/browser\/chat-input-widget\.tsx|packages\/ai-chat-ui\/src\/browser\/chat-response-renderer\/code-part-renderer\.tsx|packages\/ai-chat-ui\/src\/browser\/chat-tree-view\/chat-view-tree-widget\.tsx)$/,
    // Localization lint requires an explicit key for the history request label.
    /^packages\/ai-history\/src\/browser\/ai-history-exchange-card\.tsx$/,
    // Localization lint requires explicit keys for Claude Code renderer labels.
    /^(?:packages\/ai-claude-code\/src\/browser\/renderers\/(?:ls-tool-renderer|web-fetch-tool-renderer)\.tsx|packages\/ai-claude-code\/src\/browser\/renderers\/multiedit-tool-renderer\.tsx)$/,
    // Localization lint and serialized prompt templates require narrow ai-ide seams.
    /^(?:packages\/ai-ide\/src\/browser\/ai-configuration\/(?:agent-configuration-widget|token-usage-configuration-widget)\.tsx|packages\/ai-ide\/src\/browser\/architect-agent\.ts|packages\/ai-ide\/src\/browser\/user-interaction-tool-renderer\.tsx|packages\/ai-ide\/src\/common\/coder-replace-prompt-template\.ts)$/,
    // Qaap's terminal Ask AI dialog is shared by Work Hub and the classic IDE,
    // while the upstream stylesheet only contains the retired command mini-chat.
    /^packages\/ai-terminal\/src\/browser\/style\/ai-terminal\.css$/,
    // Localization lint requires a stable explicit key for this property label;
    // upstream's localizeByDefault call is not present in the generated catalog.
    /^packages\/property-view\/src\/browser\/resource-property-view\/resource-property-view-tree-widget\.tsx$/,
    /^packages\/scm-extra\/src\/browser\/history\/scm-history-constants\.ts$/,
    /^packages\/terminal-manager\/src\/browser\/(?:terminal-manager-frontend-view-contribution|terminal-manager-tree-widget)\.tsx?$/,
    // Documented core seams for product rebind / mobile helpers
    /^packages\/core\/src\/browser\/menu\/workbench-top-bar-factory\.ts$/,
    /^packages\/core\/src\/browser\/shell\/mobile-layout-state\.ts$/,
    /^packages\/core\/src\/browser\/shell\/index\.ts$/,
    /^packages\/core\/src\/browser\/menu\/browser-menu-module\.ts$/,
    /^packages\/core\/src\/browser\/menu\/browser-menu-plugin\.ts$/,
    /^packages\/core\/src\/browser\/window\/window-title-service\.ts$/,
    // Deliberate product choice (May 2026): keep the on-demand per-URI decoration
    // fetch from upstream PR #17508 so git decorations stay correct with >250
    // changes (upstream issue #17507, still open). Upstream reverted it (#17555)
    // for a perf feedback loop with the decorations-service per-URI emitter (our
    // core decorations-service seam is the other half). If explorer lag shows up
    // on large workspaces, this pair is the prime suspect; watch for upstream's
    // re-land and re-sync then.
    /^packages\/filesystem\/src\/browser\/file-tree\/file-tree-decorator-adapter\.ts$/,
    // Env accommodation: this dev/CI environment's Node emits a NO_COLOR/FORCE_COLOR
    // warning on stderr that breaks the upstream spec's exact-stderr asserts; the
    // fork spec filters it. Revisit when the env no longer emits the warning.
    /^packages\/process\/src\/node\/raw-process\.spec\.ts$/,
    // Test accommodation: the qaap agent runtime creates real git worktrees under
    // .worktrees/ (EnterWorktree), so the upstream spec's absolute-result asserts
    // need an excludePatterns filter or they match spurious files.
    /^packages\/file-search\/src\/node\/file-search-service-impl\.spec\.ts$/,
    // Bootstrap guard: QaapKeybindingRegistry can be empty while file-search registers its
    // provider; upstream's truthy empty-array check otherwise resolves undefined and aborts
    // QuickInput startup. Keep the minimal fix at this upstream seam until it is upstreamed.
    /^packages\/file-search\/src\/browser\/quick-file-open\.ts$/,
    // Regression coverage for the Qaap keybinding bootstrap seam above.
    /^packages\/file-search\/src\/browser\/quick-file-open\.spec\.ts$/,
    // Archive extraction seam: route plugin, VSIX, and remote-native archives through
    // @theia/qaap-archive so the unmaintained decompress package is removed from runtime.
    /^packages\/plugin-ext\/package\.json$/,
    /^packages\/plugin-ext\/src\/main\/node\/plugin-deployer-file-handler-context-impl\.ts$/,
    /^packages\/plugin-ext-headless\/package\.json$/,
    /^packages\/plugin-ext-vscode\/package\.json$/,
    /^packages\/plugin-ext-vscode\/src\/node\/plugin-vscode-utils\.ts$/,
    /^packages\/remote\/package\.json$/,
    /^packages\/remote\/src\/electron-node\/setup\/remote-native-dependency-service\.ts$/,
    // Fork extension: RemoteConnection.copy() accepts Buffer/ReadableStream in
    // addition to upstream's string path (used-by-design for container uploads;
    // SSH impl still string-only — tracked follow-up). Not in upstream.
    /^packages\/remote\/src\/electron-node\/remote-types\.ts$/,
    /^packages\/remote-wsl\/src\/electron-node\/remote-wsl-connection\.ts$/,
    // Re-fire onDidChangeDecorations after lazy decoration data resolves (event
    // truncation fix). DecorationProviderWrapper is not exported upstream, so a
    // qaap-* subclass is not possible without a bigger refactor. Keep this as a
    // documented core seam until the upstream API exposes a subclassable wrapper.
    /^packages\/core\/src\/browser\/decorations-service\.ts$/,
    // Generated i18n artifacts: nls catalogs are derived from localize() calls
    // across the whole repo, so they legitimately differ while any allowlisted
    // seam or qaap-* package contributes strings. Regenerated by
    // scripts/translation-update.js; never hand-edited.
    /^packages\/core\/i18n\//,
    /^packages\/core\/src\/common\/i18n\/nls\.metadata\.json$/,
    /^packages\/mini-browser\/src\/browser\/mini-browser-open-hook\.ts$/,
    /^packages\/mini-browser\/src\/browser\/mini-browser-opener-options\.ts$/,
    /^packages\/mini-browser\/src\/browser\/mini-browser-url-utils\.ts$/,
    /^packages\/mini-browser\/src\/browser\/location-mapper-service\.ts$/,
    /^packages\/mini-browser\/src\/browser\/mini-browser-open-handler\.ts$/,
    /^packages\/monaco\/src\/browser\/monaco-quick-input-layout\.ts$/,
    // Protected getBlinkAlertTitle hook (default uses applicationName like upstream).
    /^packages\/ai-core\/src\/browser\/window-blink-service\.ts$/,
    /^packages\/core\/src\/electron-main\/electron-main-application\.ts$/,
    /^packages\/mini-browser\/src\/browser\/mini-browser-content\.ts$/,
    /^packages\/monaco\/src\/browser\/monaco-frontend-module\.ts$/,
    /^packages\/monaco\/src\/browser\/monaco-quick-input-service\.ts$/,
    // WorkspaceTrustDialogFactory + getTrustDevelopmentHostLabel hooks for branding.
    /^packages\/workspace\/src\/browser\/workspace-trust-dialog\.tsx$/,
    /^packages\/workspace\/src\/browser\/workspace-trust-dialog-factory\.ts$/,
    /^packages\/workspace\/src\/browser\/workspace-trust-service\.ts$/,
    /^packages\/workspace\/src\/browser\/workspace-frontend-module\.ts$/,
    /^packages\/workspace\/src\/browser\/workspace-frontend-contribution\.ts$/,
    /^\.nvmrc$/,
    // QAAP Playwright harness seams (test-only; no upstream product code).
    /^examples\/playwright\/src\/tests\/qaap-mobile\.test\.ts$/,
    /^examples\/playwright\/src\/tests\/qaap-transcript-preview-flow\.ui-spec\.ts$/,
    // Upstream sample plugins removed in this fork — we ship our own plugin set.
    /^sample-plugins\//,
    // Fork-specific build tooling and dev scripts (not user-facing product code).
    /^dev-packages\/bundle-plugin\//,
    /^dev-packages\/localization-manager\//,
    /^dev-packages\/private-re-exports\//,
    /^scripts\/debug-.*\.mjs$/,
    /^scripts\/qaap-ensure-dash-licenses-jar\.mjs$/,
    /^scripts\/translation-update\.js$/,
    /^\.claude\/skills\/qaap-dev\.md$/,
    /^\.cursor\/rules\/mobile-touch-accessibility\.mdc$/,
    // Qaap package project references: upstream package tsconfigs must include
    // qaap-* dependencies so the TypeScript build graph resolves them.
    /^packages\/ai-terminal\/tsconfig\.json$/,
    /^packages\/plugin-ext-vscode\/tsconfig\.json$/,
    /^packages\/plugin-ext\/tsconfig\.json$/,
    /^packages\/remote\/tsconfig\.json$/,
    /^\.worktrees\/qaiq$/,
    /^qaiq$/,
    /^bom\.json$/,
    /^configs\/base\.tsconfig\.json$/,
    /^\.github\/workflows\/set-milestone-on-pr\.yml$/,
    /^\.github\/workflows\/generate-sbom\.yml$/,
    // ---- Product seams in upstream Theia AI packages -----------------------
    // Small tweaks in upstream Theia AI packages to match product behaviour
    // (model lists, branding strings, dropped-Theia-only test fixtures, minor
    // renderer/contribution adjustments). These are intentional fork edits and
    // not full-featured forks of the package; deeper feature changes are
    // tracked in qaap-drift-baseline.txt pending extraction.
    // ai-ide: LanguageModelOptionContribution seam + model alias UI hooks for product
    /^packages\/ai-ide\/src\/browser\/frontend-module\.ts$/,
    /^packages\/ai-ide\/src\/browser\/ai-configuration\/agent-configuration-widget\.tsx$/,
    /^packages\/ai-ide\/src\/browser\/ai-configuration\/language-model-renderer\.tsx$/,
    /^packages\/ai-ide\/src\/browser\/ai-configuration\/language-model-option-contribution\.tsx$/,
    /^packages\/ai-ide\/src\/browser\/ai-configuration\/model-aliases-configuration-widget\.tsx$/,
    // Protected parseListLaunchConfigurationArgs hook for empty tool-arg guard.
    /^packages\/ai-ide\/src\/browser\/workspace-launch-provider\.ts$/,
    // ---- Qaap AI product surface (permanent seams, July 2026 audit) --------
    // Single-root policy: AI workspace functions/search/task/launch scope to the
    // primary workspace root (deliberate vs upstream's multi-root investment).
    /^packages\/ai-ide\/src\/browser\/workspace-(functions|search-provider|task-provider|launch-provider)(\.spec)?\.tsx?$/,
    /^packages\/ai-ide\/src\/common\/workspace-(preferences|search-provider-util)\.ts$/,
    /^packages\/ai-ide\/src\/browser\/context-file-validation-service-impl(\.spec)?\.ts$/,
    /^packages\/ai-ide\/src\/browser\/(context-functions|file-changeset-functions)\.spec\.ts$/,
    /^packages\/ai-ide\/src\/browser\/github-repo-variable-contribution\.ts$/,
    /^packages\/ai-ide\/src\/browser\/(user-interaction-tool(\.spec)?|template-preference-contribution)\.ts$/,
    /^packages\/ai-ide\/tsconfig\.json$/,
    // PR-review agent redesign: delegation to GitHub/Explore sub-agents + task
    // integration instead of upstream's Capability Model; coder-replace prompt
    // diverged on both sides (autonomy/reasoning rules rewritten differently).
    /^packages\/ai-ide\/src\/browser\/review\/pr-review-(prompt-template|capability-contribution)\.ts$/,
    /^packages\/ai-ide\/src\/common\/coder-replace-prompt-template\.ts$/,
    // Agents pin the fork's QAIQ-routed model aliases (default/code|universal),
    // not upstream's default/fast; coder-agent uses the fork's chat navigation
    // command instead of upstream's AI_CHAT_HOME.
    /^packages\/ai-ide\/src\/browser\/(app-tester-chat-agent|explore-agent|github-chat-agent|project-info-agent|coder-agent)\.ts$/,
    /^packages\/ai-ide\/src\/common\/(command-chat-agents|orchestrator-chat-agent)\.ts$/,
    // Welcome-screen session cards: fork's Card architecture (responsive grid,
    // working spinner, hover tooltip); parity pass vs upstream items pending.
    /^packages\/ai-ide\/src\/browser\/chat-sessions-welcome-message-provider(\.spec\.ts|\.tsx)$/,
    /^packages\/ai-ide\/src\/browser\/chat-session-card-action-contribution\.ts$/,
    // Chat navigation product UX (back/forward + new chat window replacing
    // upstream's Home/overview) and the Codex-style execution timeline consumer.
    /^packages\/ai-chat-ui\/src\/browser\/(ai-chat-navigation-service|ai-chat-ui-contribution|chat-view-commands|chat-focus-contribution)\.ts$/,
    /^packages\/ai-chat-ui\/src\/browser\/(ai-chat-ui-frontend-module|chat-view-widget-toolbar-contribution|chat-view-widget)\.tsx?$/,
    /^packages\/ai-chat-ui\/src\/browser\/chat-tree-view\/chat-view-tree-widget\.tsx$/,
    /^packages\/ai-chat-ui\/src\/browser\/style\/index\.css$/,
    /^packages\/ai-chat-ui\/src\/browser\/chat-response-renderer\/toolcall-part-renderer\.tsx$/,
    // Token-usage indicator: fork keeps CHAT_CONTEXT_WINDOW_SIZE_FALLBACK shape
    // consumed by qaap-mobile-shell context-usage indicator/panel.
    /^packages\/ai-chat-ui\/src\/browser\/chat-token-usage-indicator-util(\.spec)?\.ts$/,
    // ai-chat: fork carries configurable tool-confirmation timeout (chat-model,
    // response-model/tool-call specs, tool-request-service) and is ahead of
    // upstream on deserializer interrupted handling, session naming alias, and
    // async workspace-relative variables; request-parser mock bridges the two.
    /^packages\/ai-chat\/src\/common\/(chat-model|chat-request-parser|chat-content-deserializer|chat-session-naming-service)(\.spec)?\.ts$/,
    /^packages\/ai-chat\/src\/common\/(chat-response-model|tool-call-response-content)\.spec\.ts$/,
    /^packages\/ai-chat\/src\/browser\/(ai-chat-frontend-module|chat-tool-request-service|change-set-variable|context-file-validation-service|file-chat-variable-contribution)\.ts$/,
    // Variable descriptions tuned for agents (relative-path guidance).
    /^packages\/ai-core\/src\/browser\/theia-variable-contribution\.ts$/,
    // Claude Code agent: "Analyze before acting" system-prompt block,
    // AskUserQuestion normalization (LLM sometimes omits header), and the
    // fork's chat navigation command instead of AI_CHAT_HOME.
    /^packages\/ai-claude-code\/src\/browser\/claude-code-chat-agent\.ts$/,
    // OpenAI custom-model preferences describe the fork's provider ecosystem
    // (OpenRouter/NVIDIA/HuggingFace, consumed by qaap-ai-openrouter/-nvidia)
    // and add required:['model','url'] + nullable reasoning opt-out.
    /^packages\/ai-openai\/src\/common\/openai-preferences\.ts$/,
    // Shell-execution seam: cwd+workspaceRoot travel to the backend where
    // QaapShellExecutionServerImpl (qaap-ai-config) overrides resolveCwd/execute
    // (basename fallback + ENOENT rewrite); renderer keeps the Canceled i18n key.
    /^packages\/ai-terminal\/src\/(browser\/(shell-execution-tool|shell-execution-tool-renderer)\.tsx?|common\/shell-execution-server\.ts|node\/shell-execution-server-impl\.ts)$/,
    // Context-menu target seam: Ask AI must resolve the embedded Work Hub terminal
    // from the menu anchor instead of requiring an active ApplicationShell widget.
    /^packages\/ai-terminal\/src\/browser\/ai-terminal-contribution\.ts$/,
    // Work Hub terminal actions use the shared Qaap adapter context without making
    // the upstream ai-terminal package depend on the mobile shell implementation.
    /^packages\/ai-terminal\/package\.json$/,
    // ai-ide drops @theia/file-search (single-root policy: the multi-root search
    // provider that needed it is replaced by the fork's primary-root provider).
    /^packages\/ai-ide\/package\.json$/,
    // Security-only dependency floors (August 2026): patched Electron, Undici,
    // MCP SDK, body-parser and js-yaml releases. No product behavior lives in
    // these manifests; generated re-export docs mirror the Electron floor. Remove
    // each seam once the pinned upstream base catches up.
    /^dev-packages\/request\/package\.json$/,
    /^packages\/(ai-core|ai-google|ai-mcp|ai-mcp-server|core|dev-container|electron|filesystem|scanoss)\/package\.json$/,
    /^packages\/(core|electron)\/README\.md$/,
    // Security migration seams (August 2026): AI SDK 7 changes the provider,
    // message/tool stream and usage contracts; proxy-agent 0.44 centralizes
    // dynamic proxy/certificate settings. Keep their focused regression specs.
    /^packages\/ai-vercel-ai\/(package\.json|src\/node\/vercel-ai-language-model(?:-factory|\.spec)?\.ts)$/,
    /^packages\/plugin-ext\/(package\.json|src\/hosted\/node\/plugin-host-proxy(?:\.spec)?\.ts)$/,
    // task integrates the fork-local @theia/terminal-manager (task terminals are
    // routed to the dedicated Tasks page in tree mode).
    /^packages\/task\/(package\.json|tsconfig\.json)$/,
    // Fork-authored spec document (agent trace Cursor-parity), not upstream content.
    /^doc\/agent-trace-cursor-parity-spec\.md$/,
    // ---- Qaap product tooling / editor config (not upstream Theia) --------
    /^\.cursor\/rules\/work-hub-reload-default\.mdc$/,
    /^\.tool-ui\/agent\.json$/,
    /^scripts\/extract-sessions-sidebar\.py$/,
    /^scripts\/extract-sticky-composer-batch\.py$/,
    /^scripts\/wire-mobile-projects-orphans\.py$/,
    // Fork-local agent guidance and post-task preview workflow (not upstream product code).
    /^AGENTS\.md$/,
    /^\.cursor\/rules\/post-task-build-preview\.mdc$/,
    // ---- Misc product seams in upstream Theia packages ---------------------
    /^packages\/ai-chat-ui\/src\/browser\/chat-input-product-chrome\.ts$/,
    /^packages\/ai-chat-ui\/src\/browser\/chat-input-widget\.tsx$/,
    // Codex-style execution event timeline model + renderer + tests (co-located with chat-view-tree-widget consumer).
    /^packages\/ai-chat-ui\/src\/browser\/chat-tree-view\/execution-event-model\.ts$/,
    /^packages\/ai-chat-ui\/src\/browser\/chat-tree-view\/execution-event-model\.spec\.ts$/,
    /^packages\/ai-chat-ui\/src\/browser\/chat-tree-view\/execution-event-renderer\.tsx$/,
    // Defensive lineNumber resolve when editor cursor is unavailable.
    /^packages\/editor\/src\/browser\/editor-variable-contribution\.ts$/,
    // Lint-only localization metadata alignment for the Browse button.
    /^packages\/preferences\/src\/browser\/views\/components\/preference-file-input\.ts$/,
    // Treat legacy Canceled errors as unresolved variables instead of console noise.
    /^packages\/variable-resolver\/src\/browser\/variable-resolver-service\.ts$/,
    // Protected MCP delegate reregistration + resource URI hooks for product layer.
    /^packages\/ai-mcp-server\/src\/node\/mcp-frontend-contribution-manager\.ts$/,
    // MCP registry UI bridge + search filters are product-facing registry UX seams
    // currently co-located with upstream ai-registry until the registry shell moves
    // behind a qaap-* package boundary.
    /^packages\/ai-registry\/src\/browser\/mcp\/mcp-registry-ui-bridge-impl(\.spec)?\.ts$/,
    /^packages\/ai-registry\/src\/common\/registry-search-filter(\.spec)?\.ts$/,
    /^packages\/ai-terminal\/src\/browser\/shell-command-permission-service\.ts$/,
    /^packages\/mini-browser\/src\/browser\/mini-browser-url-utils\.spec\.ts$/,
    /^packages\/scm\/src\/browser\/scm-tree-widget\.tsx$/,
    // Optional PluginViewWelcomePolicy DI seam for cloud IDE (no Open Folder welcome).
    /^packages\/plugin-ext\/src\/main\/browser\/view\/plugin-view-registry\.ts$/,
    /^packages\/plugin-ext\/src\/main\/browser\/view\/plugin-view-welcome-policy\.ts$/,
    /^packages\/plugin-ext\/src\/main\/browser\/webview\/webview-resource-cache\.ts$/,
    /^packages\/preview\/src\/browser\/preview-contribution\.ts$/,
    // Upstream Theia spec files removed or gutted in the fork.
    /^packages\/ai-code-completion\/src\/browser\/code-completion-agent\.spec\.ts$/,
    // Protected AnthropicModel hooks for product history pruning + rolling cache.
    /^packages\/ai-anthropic\/src\/node\/anthropic-language-model\.ts$/,
    // ---- Fork lags upstream Theia (NOT product-code drift) ----------------
    // These files show the fork on a SIMPLER/OLDER version than upstream — i.e.
    // upstream Theia later added features (graceful shutdown, ESM plugin loader,
    // trust-aware preference reader, external-path allowlists) that this fork
    // has not picked up. There is no Qaap product code to extract here; the
    // proper resolution is a per-file decision to either (a) cherry-pick the
    // upstream additions back in, or (b) keep the simplification intentionally.
    // Reviewed against the pinned upstream base: these paths intentionally retain
    // fork-only product/deployment policy and are re-evaluated when that base moves.
    /^package\.json$/,
    /^package-lock\.json$/,
    /^README\.md$/,
    /^CLAUDE\.md$/,
    // Product security policy: Qaap reporting channel + multi-tenant deployment
    // security model prepended above the upstream Eclipse Theia policy.
    /^SECURITY\.md$/,
    /^doc\/qaap-.*\.(md|html)$/,
    /^\.github\/workflows\/qaap-.*\.yml$/,
    // Fork CI matrix (Node heap, test hooks) — not upstream Theia workflow content.
    /^\.github\/workflows\/ci-cd\.yml$/,
    // Fork CI decisions: Node 24.x matrix (upstream is 22.x) with upstream's
    // Playwright browser-cache step re-applied on top.
    /^\.github\/workflows\/playwright\.yml$/,
    /^\.github\/workflows\/production-smoke-test\.yml$/,
    // Fork deploys gh-pages via peaceiris/actions-gh-pages (direct push) instead of
    // upstream's pages environment — this repo has no github-pages environment.
    /^\.github\/workflows\/publish-api-doc-gh-pages\.yml$/,
    /^\.prompts\//,
    /^\.theia\//,
    /^\.dockerignore$/,
    /^Dockerfile$/,
    /^docker-compose\.yml$/,
    // Bundled SearXNG (free, no-API-key web search for @qaiq) deploy config — fork infra, not upstream Theia.
    /^deploy\//,
    /^vercel\.json$/,
    /^\.env\.docker\.example$/,
    /^\.gitignore$/,
    /^\.vscode\//,
    /^CHANGELOG\.md$/,
    /^doc\/Migration\.md$/,
    /^doc\/Publishing\.md$/,
    /^dev-packages\/application-manager\//,
    /^dev-packages\/application-package\//,
    // Fork-authored QA issue reports and multi-tenancy audit — not upstream Theia content.
    /^docs\/qa\/issues\/.*\.md$/,
    /^MULTI_TENANCY_AUDIT\.md$/,
    // Fork-specific git attributes (line-ending rules for generated icon assets).
    /^\.gitattributes$/,
    // Fork-local packages with no upstream counterpart (do not rename to qaap-* prefix).
    /^packages\/ai-copilot\//,
    /^packages\/terminal-manager\//,
];

/**
 * @param {string} p
 */
function isAllowed(p) {
    return ALLOWED.some(re => re.test(p));
}

/** @returns {Set<string>} */
function loadBaseline() {
    if (!fs.existsSync(baselinePath)) {
        return new Set();
    }
    const lines = fs.readFileSync(baselinePath, 'utf8').split('\n');
    /** @type {Set<string>} */
    const set = new Set();
    for (const line of lines) {
        const t = line.replace(/#.*$/, '').trim();
        if (t) {
            set.add(t);
        }
    }
    return set;
}

if (!sh(`git rev-parse --verify ${base}`)) {
    console.error(`[qaap-drift-check] Base ref "${base}" not found. Fetch upstream or set QAAP_DIFF_BASE.`);
    process.exit(2);
}

/** @type {string[]} */
const files = sh(`git diff --name-only ${base} --`).split('\n').filter(Boolean);

/** @type {string[]} */
const violations = files.filter(f => !isAllowed(f));
const baseline = loadBaseline();
/** @type {string[]} */
const newDrift = violations.filter(f => !baseline.has(f));
/** @type {string[]} */
const resolvedBaseline = [...baseline].filter(f => !violations.includes(f));

console.log(`[qaap-drift-check] Base: ${base}`);
console.log(`[qaap-drift-check] Changed paths: ${files.length}`);
console.log(`[qaap-drift-check] Outside allowlist: ${violations.length}`);
console.log(`[qaap-drift-check] Baseline entries: ${baseline.size}`);
console.log(`[qaap-drift-check] New drift (not in baseline): ${newDrift.length}`);

if (violations.length && reportOnly) {
    console.error('\nDrift outside allowlist (baseline + new):\n');
    for (const f of violations.sort()) {
        console.error(`  ${f}`);
    }
}

if (newDrift.length) {
    console.error('\nNew unexpected drift (move to packages/qaap-* or add a documented seam):\n');
    for (const f of newDrift.sort()) {
        console.error(`  ${f}`);
    }
    console.error('\nAllowlist: scripts/qaap-drift-check.js ALLOWED');
    console.error('Baseline: scripts/qaap-drift-baseline.txt (remove paths after migration)');
    if (writeBaseline && violations.length) {
        const header = [
            '# Known upstream drift outside packages/qaap-* (historical). Shrink as migrations land.',
            `# Generated against ${base}; paths must match \`git diff --name-only ${base}\`.`,
            '#',
            '# Empty new-drift set: CI passes while paths are migrated into packages/qaap-* or ALLOWED.',
            '# Regenerate: node scripts/qaap-drift-check.js --write-baseline',
            '',
        ].join('\n');
        fs.writeFileSync(baselinePath, `${header}${violations.sort().join('\n')}\n`);
        console.error(`\n[qaap-drift-check] Wrote ${violations.length} path(s) to ${path.relative(root, baselinePath)}`);
        process.exit(0);
    }
    if (!reportOnly) {
        process.exit(1);
    }
} else if (!reportOnly) {
    console.log('[qaap-drift-check] OK — no new upstream drift outside allowlist.');
    if (resolvedBaseline.length) {
        console.log(`[qaap-drift-check] ${resolvedBaseline.length} baseline path(s) no longer differ — consider trimming qaap-drift-baseline.txt`);
    }
}
