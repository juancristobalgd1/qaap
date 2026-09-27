'use strict';
// Name-based seed classification of qaap-mobile-shell files into target packages.
// First matching rule wins. Specs/ui-specs follow their subject's basename.
const RULES = [
    ['mechanics', /^(long-press-context-menu|mobile-editor-gesture-contribution|mobile-haptics|mobile-horizontal-touch-scroll|mobile-keyboard-helper|mobile-panel-resize-drag|mobile-sheet-gestures|mobile-side-sheet-collapse|mobile-snackbar|mobile-touch-scroll-contribution|mobile-vertical-touch-scroll|qaap-mobile-app-preferences|qaap-mobile-app-tester-contribution|qaap-mobile-layout-utils|qaap-mobile-swipe-to-delete|qaap-prefers-reduced-motion|qaap-mobile-touch-scroll)$/],
    ['diff-review', /(diff-review|diff-summary|diff-hub|work-hub-diff-service|^qaap-git-review|pull-request-panel|pull-request-detail|^qaap-commit-message-ai|^qaap-commit-feedback|^qaap-verify-commit|^qaap-scm-changes-icon)/],
    ['agents-ui', /(^qaap-agent-ui|^qaap-agent-login|^qaap-agent-picker|^qaap-agent-cli-update|agents-hub-inline|^qaap-agents-hub-landing|^qaap-agent-setup-phrases|^qaap-agent-auth-login|^qaap-builtin-agents|^qaap-agent-branding|^qaap-grok-brand-mark|^qaap-hosted-agent-auth-policy|^qaap-agent-setup-animations)/],
    ['composer', /(sticky-composer|^qaap-composer-|composer-header|agent-task-composer|^qaap-chat-mic|^qaap-mobile-composer|context-attach-menu|mcp-attach-menu|^model-capability|^qaap-chat-input-|chat-input-widget|^qaap-delivery-mode-strip|^qaap-project-composer-draft|^qaap-conversation-composer-state|^qaap-quoted-text-context|^qaap-mcp-plugin|^qaap-work-hub-composer-prompt|^qaap-preview-annotation-composer|^qaap-chat-select-dropdown)/],
    ['transcript', /(transcript|^qaap-execution-event|^mobile-execution-|^qaap-lobehub|^qaap-markdown-part-renderer|^qaap-qaiq-.*renderer|^qaap-chat-view-tree|^qaap-chat-view-stream|^qaap-thinking-orb|^qaap-activity-tool-icon-motion|^qaap-chat-markdown|^qaap-turn-settle|^qaap-slow-turn-hint|^mobile-turn-provenance|^mobile-process-accordion|^mobile-closing-error-card|^qaap-shared-elapsed-ticker|^qaap-tool-umbrella|^qaap-failed-duplicate-collapse|^qaap-sync-stream-response|^qaap-chat-ui-perf|^qaap-chat-context-usage)/],
    ['work-hub', /(^mobile-one-column-shell|^mobile-shell-|^mobile-projects-|^mobile-work-hub|^qaap-work-hub|^qaap-work-mission|^mobile-work-mission|^qaap-workbench|^qaap-project-bootstrap|frontend-module$|backend-module$|^mobile-onboarding|^mobile-open-repository|^qaap-project-switcher|^qaap-watermark|^qaap-empty-workbench|^qaap-shell-layout-restore|^qaap-ide-preferences|^qaap-catalog-card|^mobile-workbench|^mobile-theme-chrome|^mobile-connection-status|^mobile-chat-session-restore|^qaap-account-avatar|^qaap-billing-return|^qaap-sessions-sidebar|^qaap-hub-project-eligibility|^mobile-work-hub-catalog|^qaap-desktop-)/],
];
function subjectBase(file) {
    const b = file.split('/').pop();
    return b.replace(/\.(dispose\.)?(ui-spec|spec|slow-spec)\.tsx?$/, '').replace(/\.(d\.ts|tsx?|css|js)$/, '');
}
function seed(file) {
    const b = subjectBase(file);
    for (const [pkg, re] of RULES) { if (re.test(b)) { return pkg; } }
    return 'shared-core';
}
module.exports = { seed, subjectBase, RULES };
