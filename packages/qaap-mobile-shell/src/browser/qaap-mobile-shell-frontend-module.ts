// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// mobile-workbench.css was split into boot-critical and lazy partials
// (cascade order preserved). Boot-critical partials load statically;
// surface-specific partials lazy-load on activation to reduce initial CSS
// payload on mobile. Open-repo styles are boot-critical: the drawer opens
// from landing/FAB and its previous home (pr-review) is not imported.
import '../../src/browser/style/mobile-workbench-base.css';
import '../../src/browser/style/mobile-workbench-projects.css';
import '../../src/browser/style/mobile-workbench-open-repo.css';
import '../../src/browser/style/mobile-workbench-work-hub.css';
import '../../src/browser/style/mobile-workbench-chrome.css';
import '../../src/browser/style/mobile-workbench-ide-chrome.css';
import '../../src/browser/style/qaap-catalog-card-tap-feedback.css';
import '../../src/browser/style/qaap-mobile-touch-scroll.css';
import '../../src/browser/style/qaap-empty-workbench-brand.css';
import '../../src/browser/style/qaap-project-bootstrap.css';
import '../../src/browser/style/qaap-agent-cli-update-toast.css';
import '../../src/browser/style/qaap-chat-mic.css';
import '../../src/browser/style/qaap-composer-prompt-improve.css';
import '../../src/browser/style/qaap-chat-select-dropdown.css';
import '../../src/browser/style/qaap-diff-review.css';
import '../../src/browser/style/qaap-work-mission-control.css';
import '../../src/browser/style/qaap-work-hub-sessions-sidebar.css';
import '../../src/browser/style/qaap-transcript-timeline-premium.css';
import '../../src/browser/style/qaap-transcript-lobehub.css';
import '../../src/browser/style/qaap-agent-setup-animations.css';
import '../../src/browser/style/qaap-transcript-live-status.css';
import '@theia/ai-claude-code/src/browser/style/claude-code-tool-renderers.css';

import { ChatResponsePartRenderer } from '@theia/ai-chat-ui/lib/browser/chat-response-part-renderer';

import { AgentNotificationService } from '@theia/ai-core/lib/browser/agent-notification-service';
import { bindToolProvider } from '@theia/ai-core/lib/common';
import { AIVariableContribution } from '@theia/ai-core/lib/common/variable-service';
import { ContainerModule } from '@theia/core/shared/inversify';
import { PreferenceContribution } from '@theia/core/lib/common/preferences/preference-schema';
import { QaapChatPreferencesContribution } from './qaap-chat-preferences-contribution';
import { WidgetFactory } from '@theia/core/lib/browser/widget-manager';
import { SCM_WIDGET_FACTORY_ID } from '@theia/scm/lib/browser/scm-contribution';
import { ScmContribution } from '@theia/scm/lib/browser/scm-contribution';
import { ScmWidget } from '@theia/scm/lib/browser/scm-widget';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import { ChatViewTreeWidget } from '@theia/ai-chat-ui/lib/browser/chat-tree-view/chat-view-tree-widget';
import { createQaapChatViewTreeWidget } from './qaap-chat-view-tree-container';
import { ChatViewWidget } from '@theia/ai-chat-ui/lib/browser/chat-view-widget';
import {
    QaapBootstrapInstallTool,
    QaapBootstrapOpenPreviewTool,
    QaapBootstrapRunDevTool,
    QaapBootstrapStatusTool,
} from './qaap-bootstrap-tool-providers';
import { QaapAgUiFrontendToolService } from './qaap-ag-ui-frontend-tool-service';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { CommandContribution } from '@theia/core/lib/common/command';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { QuickCommandService } from '@theia/core/lib/browser/quick-input/quick-command-service';
import { MenuContribution } from '@theia/core/lib/common/menu';
import { ShellLayoutTransformer } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import { QaapKeybindingRegistry } from './qaap-keybinding-registry';
import { QaapQuickCommandService } from './qaap-quick-command-service';
import { QaapBuildFreshnessContribution } from './qaap-build-freshness-contribution';
import { QaapAgentCliUpdateContribution } from './qaap-agent-cli-update-contribution';
import { MobileOneColumnShellContribution } from './mobile-one-column-shell-contribution';
import { QaapShellLayoutRestoreContribution } from './qaap-shell-layout-restore-contribution';
import { MobileOnboardingTutorialContribution } from './mobile-onboarding-tutorial-contribution';
import { MobileThemeChromeContribution } from './mobile-theme-chrome-contribution';
import { QaapAppearanceModeService } from './qaap-appearance-mode-service';
import { MobileEditorGestureContribution } from './mobile-editor-gesture-contribution';
import { QaapEmptyWorkbenchBrandingContribution } from './qaap-empty-workbench-branding-contribution';
import { QaapWatermarkCommandsContribution } from './qaap-watermark-commands-contribution';
import { LongPressContextMenuContribution } from './long-press-context-menu';
import { MobileProjectsActiveTasks } from './mobile-projects-active-tasks';
import { MobileProjectsConversations } from './mobile-projects-conversations';
import { MobileWorkHubInboxStream } from './mobile-work-hub-inbox-stream';
import { MobileProjectsConversationFlags } from './mobile-projects-conversation-flags';
import {
    MobileProjectAIChatInputWidget,
    MobileProjectChatViewWidget,
    MobileProjectChatViewWidgetFactory,
} from './mobile-project-ai-chat-input-widget';
import { MobileProjectsService } from './mobile-projects-service';
import { MobileProjectsReadmeContribution } from './mobile-projects-readme-contribution';
import { QaapProjectSwitcherContribution } from './qaap-project-switcher-contribution';
import { QaapProjectSwitcherService } from './qaap-project-switcher-service';
import { QaapProjectBootstrapDetector } from './qaap-project-bootstrap-detector';
import { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { QaapProjectBootstrapContribution } from './qaap-project-bootstrap-contribution';
import { QaapProjectSkillRoots } from '@theia/qaap-adapters/lib/common/qaap-project-skill-roots';
import { QaapWorkHubProjectSkillRoots } from './qaap-work-hub-project-skill-roots';
import { QaapPreviewPortClaimService } from '@theia/qaap-adapters/lib/browser/qaap-preview-port-claim-service';
import { QaapWorkspacePreviewPortClaimService } from './qaap-preview-port-claim-service';
import { MobileTouchScrollContribution } from './mobile-touch-scroll-contribution';
import { QaapBootstrapVariableContribution } from './qaap-bootstrap-variable-contribution';
import { createQaapScmWidgetContainer } from './qaap-scm-tree-widget';
import { QaapSelectComponentOverlayContribution } from './qaap-select-component-overlay-contribution';
import { QaapChatMicTranscribeContribution } from './qaap-chat-mic-transcribe-contribution';
import { QaapChatInputCodexLayoutContribution } from './qaap-chat-input-codex-contribution';
import { QaapChatInputProductContribution } from './qaap-chat-input-product-contribution';
import { MobileConnectionStatusContribution } from './mobile-connection-status-contribution';
import { MobileChatSessionRestoreContribution } from './mobile-chat-session-restore-contribution';
import { QaapQaiqChatAgentContribution } from './qaap-qaiq-chat-agent-contribution';
import { QaapBackgroundContextProvider } from './qaap-background-context-provider';
import { QaapQaiqBashToolRenderer } from './qaap-qaiq-bash-tool-renderer';
import { QaapQaiqGenericToolRenderer } from './qaap-qaiq-generic-tool-renderer';
import { QaapMarkdownPartRenderer } from './qaap-markdown-part-renderer';
import { QaapLobehubToolRenderer } from './qaap-lobehub-tool-renderer';
import { QaapLobehubThinkingRenderer } from './qaap-lobehub-thinking-renderer';
import { QaapDesktopTerminalLayoutContribution } from './qaap-desktop-terminal-layout-contribution';
import { TerminalFrontendContribution } from '@theia/terminal/lib/browser/terminal-frontend-contribution';
import { QaapTerminalFrontendContribution } from './qaap-terminal-frontend-contribution';
import { XtermLinkFactory } from '@theia/terminal/lib/browser/terminal-link-provider';
import { createQaapXtermLinkFactory } from './qaap-xterm-link-adapter';
import { QaapCommitMessageAi } from './qaap-commit-message-ai';
import { QaapComposerPromptImprover } from './qaap-composer-prompt-improver';
import { QaapComposerEditorContextContribution } from './qaap-composer-editor-context-contribution';
import { QaapWorkHubComposerPromptContribution } from './qaap-work-hub-composer-prompt-contribution';
import { QaapWorkHubComposerPromptService } from './qaap-work-hub-composer-prompt-service';
import { QaapComposerEditorContextService } from './qaap-composer-editor-context-service';
import { QaapStickyComposerPromptHistoryContribution } from './qaap-sticky-composer-prompt-history';
import { QaapDiffReviewWidget } from './qaap-diff-review-widget';
import { QaapDiffReviewContribution } from './qaap-diff-review-contribution';
import { QaapWorkHubDiffService } from './qaap-work-hub-diff-service';
import { QaapPushNotificationContribution } from './qaap-push-notification-contribution';
import { QaapAgentCompletionContribution } from './qaap-agent-completion-contribution';
import { QaapMobileAgentNotificationService } from './qaap-mobile-agent-notification-service';
import { QaapAgentDevPreviewAutopilotContribution } from './qaap-agent-dev-preview-autopilot-contribution';
import { QaapTranscriptImageLightboxContribution } from './qaap-transcript-image-lightbox';
import { QaapTurnSettleNotifyContribution } from './qaap-turn-settle-notify-contribution';
import { QaapAgentFinishedToastContribution } from './qaap-agent-finished-toast-contribution';
import { QaapMobileAppTesterContribution } from './qaap-mobile-app-tester-contribution';
import { QaapCopilotOwnerBinding } from './qaap-copilot-owner-binding';
import { QaapUserAiSettingsSyncContribution } from './qaap-user-ai-settings-sync';
import { QaapMobileAppPreferenceContribution } from './qaap-mobile-app-preferences';
import { CopilotAuthService } from '@theia/ai-copilot/src/common/copilot-auth-service';
import { AIChatContribution } from '@theia/ai-chat-ui/lib/browser/ai-chat-ui-contribution';
import { OutlineViewContribution } from '@theia/outline-view/lib/browser/outline-view-contribution';
import { DebugFrontendContribution } from '@theia/memory-inspector/lib/browser/memory-inspector-frontend-contribution';
import { FileNavigatorWidget } from '@theia/navigator/lib/browser/navigator-widget';
import { FileNavigatorContribution } from '@theia/navigator/lib/browser/navigator-contribution';
import { NavigatorTabBarDecorator } from '@theia/navigator/lib/browser/navigator-tab-bar-decorator';
import { QaapAiChatMobileContribution } from './qaap-ai-chat-mobile-contribution';
import { QaapWorkHubChatViewWidget } from './qaap-work-hub-chat-view-widget';
import { WorkHubShellAIChatInputWidget } from './work-hub-shell-ai-chat-input-widget';
import { QaapOutlineMobileContribution } from './qaap-outline-mobile-contribution';
import { QaapMemoryInspectorMobileContribution } from './qaap-memory-inspector-mobile-contribution';
import { QaapScmContribution } from './qaap-scm-contribution';
import { QaapScmKeybindingContribution } from './qaap-scm-keybinding-contribution';
import { QaapCoreKeybindingContribution } from './qaap-core-keybinding-contribution';
import { QaapFileNavigatorContribution } from './qaap-file-navigator-contribution';
import { QaapNavigatorTabBarDecorator } from './qaap-navigator-tab-bar-decorator';
import { createQaapFileNavigatorWidget } from './qaap-navigator-widget-factory';
import { QaapVsxExtensionsMobileContribution } from './qaap-vsx-extensions-mobile-contribution';
import { PreferenceLayoutProvider } from '@theia/preferences/lib/browser/util/preference-layout';
import { QaapPreferenceLayoutProvider } from './qaap-preference-layout-provider';
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    // In Work Hub mode, let native browser editing shortcuts (Cmd+V, Cmd+C,
    // Cmd+X, etc.) pass through to the focused element instead of being
    // intercepted by the Theia keybinding system. In the classic IDE
    // (preferDesktopIde), the upstream KeybindingRegistry runs unchanged.
    // The registry is shared by the application and every widget. Keeping the
    // Qaap override singleton preserves contributions registered during startup.
    rebind(KeybindingRegistry).to(QaapKeybindingRegistry).inSingletonScope();
    // Work Hub command palette shows hub-relevant commands only; IDE keeps the full list.
    rebind(QuickCommandService).to(QaapQuickCommandService).inSingletonScope();
    // AI Features Settings: prioritize Qaap BYOK providers; omit Theia leftover groups.
    rebind(PreferenceLayoutProvider).to(QaapPreferenceLayoutProvider).inSingletonScope();
    rebind(ChatViewTreeWidget).toDynamicValue(ctx =>
        createQaapChatViewTreeWidget(ctx.container)
    );
    bind(MobileProjectsActiveTasks).toSelf().inSingletonScope();
    bind(MobileProjectsConversations).toSelf().inSingletonScope();
    bind(MobileWorkHubInboxStream).toSelf().inSingletonScope();
    bind(MobileProjectsConversationFlags).toSelf().inSingletonScope();
    // Transient binding so each `getOrCreateWidget` call (with a unique options.id) gets a fresh
    // instance — the workspace Agent AI view already mounts an AIChatInputWidget with a fixed
    // resource URI, and a second one would collide unless this subclass mints its own URI.
    bind(MobileProjectAIChatInputWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(({ container }) => ({
        id: 'mobile-projects-chat-input',
        createWidget: () => container.get(MobileProjectAIChatInputWidget),
    })).inSingletonScope();
    bind(MobileProjectChatViewWidgetFactory).toFactory(ctx => (id: string) => {
        const child = ctx.container.createChild();
        child.bind(AIChatInputWidget).to(MobileProjectAIChatInputWidget);
        child.bind(ChatViewTreeWidget).toDynamicValue(treeCtx =>
            createQaapChatViewTreeWidget(treeCtx.container)
        );
        child.bind(ChatViewWidget).to(MobileProjectChatViewWidget);
        child.bind(MobileProjectChatViewWidget).toSelf();
        const widget = child.get(MobileProjectChatViewWidget);
        widget.id = `mobile-projects-chat-view-${id}`;
        widget.node.classList.add('theia-mobile-projects-real-agent-view');
        return widget;
    });
    bind(WidgetFactory).toDynamicValue(({ container }) => ({
        id: SCM_WIDGET_FACTORY_ID,
        createWidget: () => createQaapScmWidgetContainer(container).get(ScmWidget)
    })).inSingletonScope();
    bind(QaapScmContribution).toSelf().inSingletonScope();
    rebind(ScmContribution).toService(QaapScmContribution);
    bind(QaapScmKeybindingContribution).toSelf().inSingletonScope();
    bind(KeybindingContribution).toService(QaapScmKeybindingContribution);
    bind(QaapCoreKeybindingContribution).toSelf().inSingletonScope();
    bind(KeybindingContribution).toService(QaapCoreKeybindingContribution);
    bind(MobileProjectsService).toSelf().inSingletonScope();
    bind(QaapProjectSwitcherService).toSelf().inSingletonScope();
    bind(QaapProjectSwitcherContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapProjectSwitcherContribution);
    bind(CommandContribution).toService(QaapProjectSwitcherContribution);
    bind(MobileProjectsReadmeContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(MobileProjectsReadmeContribution);
    bind(MobileOneColumnShellContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(MobileOneColumnShellContribution);
    bind(QaapBuildFreshnessContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapBuildFreshnessContribution);
    bind(QaapAgentCliUpdateContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapAgentCliUpdateContribution);
    bind(CommandContribution).toService(MobileOneColumnShellContribution);
    bind(QaapShellLayoutRestoreContribution).toSelf().inSingletonScope();
    bind(ShellLayoutTransformer).toService(QaapShellLayoutRestoreContribution);
    bind(QaapDesktopTerminalLayoutContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapDesktopTerminalLayoutContribution);
    bind(QaapTerminalFrontendContribution).toSelf().inSingletonScope();
    rebind(TerminalFrontendContribution).toService(QaapTerminalFrontendContribution);
    // Terminal link taps must open reliably on touch devices (Qaap is mobile-first);
    // subclass XtermLinkAdapter via a replacement factory. Seam for packages/terminal.
    rebind(XtermLinkFactory).toFactory(createQaapXtermLinkFactory);
    bind(MobileOnboardingTutorialContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(MobileOnboardingTutorialContribution);
    bind(CommandContribution).toService(MobileOnboardingTutorialContribution);
    bind(MobileThemeChromeContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(MobileThemeChromeContribution);
    bind(QaapAppearanceModeService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapAppearanceModeService);
    bind(MobileEditorGestureContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(MobileEditorGestureContribution);

    bind(QaapWatermarkCommandsContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(QaapWatermarkCommandsContribution);
    bind(KeybindingContribution).toService(QaapWatermarkCommandsContribution);

    bind(QaapEmptyWorkbenchBrandingContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapEmptyWorkbenchBrandingContribution);

    bind(LongPressContextMenuContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(LongPressContextMenuContribution);

    bind(QaapProjectBootstrapDetector).toSelf().inSingletonScope();
    bind(QaapProjectBootstrapService).toSelf().inSingletonScope();
    rebind(QaapPreviewPortClaimService).to(QaapWorkspacePreviewPortClaimService).inSingletonScope();
    bind(MobileTouchScrollContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(MobileTouchScrollContribution);
    bind(QaapSelectComponentOverlayContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapSelectComponentOverlayContribution);
    bind(QaapChatMicTranscribeContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapChatMicTranscribeContribution);
    bind(QaapStickyComposerPromptHistoryContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapStickyComposerPromptHistoryContribution);
    bind(QaapComposerEditorContextService).toSelf().inSingletonScope();
    bind(QaapComposerEditorContextContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(QaapComposerEditorContextContribution);
    bind(MenuContribution).toService(QaapComposerEditorContextContribution);
    bind(KeybindingContribution).toService(QaapComposerEditorContextContribution);
    bind(QaapWorkHubComposerPromptService).toSelf().inSingletonScope();
    bind(QaapWorkHubComposerPromptContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(QaapWorkHubComposerPromptContribution);
    bind(QaapChatInputCodexLayoutContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapChatInputCodexLayoutContribution);
    bind(QaapChatInputProductContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapChatInputProductContribution);
    bind(QaapChatPreferencesContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapChatPreferencesContribution);
    bind(MobileConnectionStatusContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(MobileConnectionStatusContribution);
    bind(MobileChatSessionRestoreContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(MobileChatSessionRestoreContribution);
    bind(QaapBackgroundContextProvider).toSelf().inSingletonScope();
    bind(QaapQaiqChatAgentContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapQaiqChatAgentContribution);

    bind(QaapQaiqBashToolRenderer).toSelf().inSingletonScope();
    bind(ChatResponsePartRenderer).toService(QaapQaiqBashToolRenderer);
    bind(QaapQaiqGenericToolRenderer).toSelf().inSingletonScope();
    bind(ChatResponsePartRenderer).toService(QaapQaiqGenericToolRenderer);

    bind(QaapMarkdownPartRenderer).toSelf().inSingletonScope();
    bind(ChatResponsePartRenderer).toService(QaapMarkdownPartRenderer);

    // LobeHub-style inline trace renderers (priority 11): override the upstream
    // generic toolcall (10) and thinking (10) renderers for plain content;
    // QAIQ renderers (13) keep Claude Code tools.
    bind(QaapLobehubToolRenderer).toSelf().inSingletonScope();
    bind(ChatResponsePartRenderer).toService(QaapLobehubToolRenderer);
    bind(QaapLobehubThinkingRenderer).toSelf().inSingletonScope();
    bind(ChatResponsePartRenderer).toService(QaapLobehubThinkingRenderer);

    bind(QaapProjectBootstrapContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapProjectBootstrapContribution);

    bind(QaapWorkHubProjectSkillRoots).toSelf().inSingletonScope();
    bind(QaapProjectSkillRoots).toService(QaapWorkHubProjectSkillRoots);

    bindToolProvider(QaapBootstrapStatusTool, bind);
    bindToolProvider(QaapBootstrapInstallTool, bind);
    bindToolProvider(QaapBootstrapRunDevTool, bind);
    bindToolProvider(QaapBootstrapOpenPreviewTool, bind);

    bind(QaapAgUiFrontendToolService).toSelf().inSingletonScope();

    bind(QaapBootstrapVariableContribution).toSelf().inSingletonScope();
    bind(AIVariableContribution).toService(QaapBootstrapVariableContribution);

    bind(QaapCommitMessageAi).toSelf().inSingletonScope();
    bind(QaapComposerPromptImprover).toSelf().inSingletonScope();
    bind(QaapWorkHubDiffService).toSelf().inSingletonScope();
    bind(QaapDiffReviewWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(({ container }) => ({
        id: QaapDiffReviewWidget.ID,
        createWidget: () => container.get(QaapDiffReviewWidget),
    })).inSingletonScope();
    bind(QaapDiffReviewContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapDiffReviewContribution);

    bind(QaapAiChatMobileContribution).toSelf().inSingletonScope();
    rebind(AIChatContribution).toService(QaapAiChatMobileContribution);
    bind(ShellLayoutTransformer).toService(QaapAiChatMobileContribution);
    // Child container so Work Hub's inherited input widget does not claim the
    // singleton `ai-chat:/input.aichatviewlanguage` resource used by Monaco / IDE chat.
    bind(WorkHubShellAIChatInputWidget).toSelf();
    rebind(ChatViewWidget).toDynamicValue(ctx => {
        const child = ctx.container.createChild();
        child.bind(AIChatInputWidget).to(WorkHubShellAIChatInputWidget);
        child.bind(QaapWorkHubChatViewWidget).toSelf();
        return child.get(QaapWorkHubChatViewWidget);
    });

    bind(QaapOutlineMobileContribution).toSelf().inSingletonScope();
    rebind(OutlineViewContribution).toService(QaapOutlineMobileContribution);
    bind(ShellLayoutTransformer).toService(QaapOutlineMobileContribution);

    bind(QaapMemoryInspectorMobileContribution).toSelf().inSingletonScope();
    rebind(DebugFrontendContribution).toService(QaapMemoryInspectorMobileContribution);
    bind(ShellLayoutTransformer).toService(QaapMemoryInspectorMobileContribution);

    rebind(FileNavigatorWidget).toDynamicValue(ctx => createQaapFileNavigatorWidget(ctx.container));
    bind(QaapFileNavigatorContribution).toSelf().inSingletonScope();
    rebind(FileNavigatorContribution).toService(QaapFileNavigatorContribution);

    bind(QaapNavigatorTabBarDecorator).toSelf().inSingletonScope();
    rebind(NavigatorTabBarDecorator).toService(QaapNavigatorTabBarDecorator);

    bind(QaapVsxExtensionsMobileContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapVsxExtensionsMobileContribution);

    bind(QaapMobileAppPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapMobileAppPreferenceContribution);

    bind(QaapPushNotificationContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapPushNotificationContribution);

    // Suppress the upstream AgentNotificationService on mobile: its onActivate opens the classic-IDE
    // chat panel. The Qaap notification pipeline (turn-settle + push) owns mobile notifications and
    // routes activation to the Work Hub conversation instead. Desktop behavior is preserved.
    rebind(AgentNotificationService).to(QaapMobileAgentNotificationService).inSingletonScope();

    bind(QaapAgentCompletionContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapAgentCompletionContribution);
    bind(QaapAgentDevPreviewAutopilotContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapAgentDevPreviewAutopilotContribution);
    bind(QaapTranscriptImageLightboxContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapTranscriptImageLightboxContribution);
    bind(QaapTurnSettleNotifyContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapTurnSettleNotifyContribution);
    bind(QaapAgentFinishedToastContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapAgentFinishedToastContribution);

    bind(QaapMobileAppTesterContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapMobileAppTesterContribution);

    bind(QaapCopilotOwnerBinding).toDynamicValue(ctx => {
        const binding = new QaapCopilotOwnerBinding();
        binding.setAuthServiceResolver(() => ctx.container.isBound(CopilotAuthService)
            ? ctx.container.getAsync<CopilotAuthService>(CopilotAuthService)
            : Promise.resolve(undefined));
        return binding;
    }).inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapCopilotOwnerBinding);
    bind(QaapUserAiSettingsSyncContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapUserAiSettingsSyncContribution);
});
