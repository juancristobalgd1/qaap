// @ts-check
'use strict';

/**
 * Frontend packages (as listed in examples/browser/src-gen/frontend/index.js) that are IDE-only
 * and must NOT be loaded by the lightweight "mobile" frontend entry.
 * @type {string[]}
 */
const QAAP_MOBILE_EXCLUDED_FRONTEND_PACKAGES = [
    '@theia/outline-view', // IDE outline panel
    '@theia/markers', // problems view, editor-bound markers
    '@theia/output', // output channels panel
    '@theia/file-search', // quick file open, editor-bound
    '@theia/navigator', // file explorer tree
    '@theia/editor-preview', // preview editor tabs
    '@theia/ai-code-completion', // inline code completion in Monaco
    '@theia/ai-editor', // AI features inside editors
    '@theia/terminal', // xterm.js terminal
    '@theia/ai-terminal', // AI terminal assistant
    '@theia/console', // debug/REPL console
    '@theia/terminal-manager', // multi-terminal manager UI
    '@theia/task', // task runner UI
    '@theia/test', // test explorer
    '@theia/debug', // debugger UI
    '@theia/scm', // source-control view
    '@theia/scm-extra', // SCM history/blame extras
    '@theia/search-in-workspace', // global search view
    '@theia/bulk-edit', // refactor preview
    '@theia/callhierarchy', // call hierarchy view
    '@theia/typehierarchy', // type hierarchy view
    '@theia/notebook', // notebook editors
    '@theia/timeline', // file timeline view
    '@theia/plugin-ext', // VS Code plugin host
    '@theia/plugin-ext-vscode', // VS Code extension compatibility
    '@theia/plugin-dev', // plugin development tooling
    '@theia/plugin-metrics', // plugin metrics
    '@theia/vsx-registry', // Open VSX extension store
    '@theia/scanoss', // SCANOSS license scanning
    '@theia/ai-scanoss', // AI SCANOSS integration
    '@theia/toolbar', // IDE toolbar
    '@theia/api-samples', // sample contributions
    '@theia/collaboration', // live-share collaboration
    '@theia/keymaps', // keybinding editor
    '@theia/getting-started', // IDE welcome page
    '@theia/memory-inspector', // debug memory view
    '@theia/preview', // markdown preview
    '@theia/property-view', // property view panel
    '@theia/secondary-window', // detachable windows
    '@theia/monaco', // Monaco editor integration (heavy)
    '@theia/editor', // text editor framework
    '@theia/ai-ide' // IDE-specific AI agents
];

/**
 * npm packages the mobile module graph must never reach (bundle-size / decoupling guard).
 * @type {string[]}
 */
const QAAP_MOBILE_FORBIDDEN_PACKAGES = [
    '@theia/monaco-editor-core', // Monaco editor core
    'monaco-editor-core', // Monaco editor core (unscoped name)
    '@xterm/xterm', // terminal emulator
    'xterm', // legacy terminal emulator name
    'vscode-oniguruma', // TextMate regex engine (wasm)
    'vscode-textmate', // TextMate grammars
    '@theia/debug',
    '@theia/plugin-ext',
    '@theia/plugin-ext-vscode',
    '@theia/terminal',
    '@theia/getting-started',
    '@theia/keymaps',
    '@theia/navigator',
    '@theia/scm'
];

module.exports = { QAAP_MOBILE_EXCLUDED_FRONTEND_PACKAGES, QAAP_MOBILE_FORBIDDEN_PACKAGES };
