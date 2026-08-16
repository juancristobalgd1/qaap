// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    clearPreferAgentsSurface,
    clearPreferDesktopIde,
    hasWorkspaceRouteInUrl,
    markPreferAgentsSurface,
    markPreferDesktopIde,
    peekPreferAgentsSurface,
    peekPreferDesktopIde,
    shouldInstallWorkHubBootGuard,
} from '../common/qaap-mobile-work-surface-preference';

export {
    clearPreferAgentsSurface,
    clearPreferDesktopIde,
    hasWorkspaceRouteInUrl,
    markPreferAgentsSurface,
    markPreferDesktopIde,
    peekPreferAgentsSurface,
    peekPreferDesktopIde,
    resolveWorkSurfaceBootIntent,
    shouldInstallWorkHubBootGuard,
    QAAP_HUB_PENDING_ACTION_KEY,
    QAAP_MOBILE_PREFER_AGENTS_SURFACE_KEY,
    QAAP_MOBILE_PREFER_DESKTOP_IDE_KEY,
    type WorkSurfaceBootIntent,
} from '../common/qaap-mobile-work-surface-preference';

/** Set before navigating to a workspace from the mobile Projects panel. */
export const QAAP_MOBILE_PROJECTS_OPEN_README_KEY = 'qaap.mobileProjects.openReadmeOnReady';

/** Keep the projects sheet closed after a workspace reload (clone / open). */
export const QAAP_MOBILE_PROJECTS_DISMISS_PANEL_KEY = 'qaap.mobileProjects.dismissPanel';

/** User is currently on the mobile Projects home. Reload should restore Projects, not workspace. */
export const QAAP_MOBILE_PROJECTS_HOME_VISIBLE_KEY = 'qaap.mobileProjects.homeVisible';

/** @deprecated Landing state is in-memory only; reloads should return mobile users to Projects. */
export const QAAP_MOBILE_PROJECTS_LEFT_LANDING_KEY = 'qaap.mobileProjects.leftLanding';

/** Dispatched synchronously so the sheet can close before `workspaceService.open` reloads the page. */
export const QAAP_MOBILE_PROJECTS_DISMISS_PANEL_EVENT = 'qaap-mobile-projects-dismiss-panel';

/** After GitHub OAuth, open the repository picker (or auto-open a single repo). */
export const QAAP_AUTH_OPEN_FIRST_REPO_EVENT = 'qaap-auth-open-first-repo';

const QAAP_MOBILE_WORK_HUB_BOOT_CLASS = 'theia-mobile-workhub-boot';

/** One-shot gate so `consumeMobileProjectsPanelDismiss()` fires its idempotent cleanup once per page load. */
let mobileProjectsPanelDismissConsumed = false;

/**
 * Whether an IDE side sheet (Explorer/Chat file browser) is INTENTIONALLY open in the Work Hub.
 * This is the only thing that may reveal `#theia-left-content-panel` while Work Hub is the surface.
 * It cannot be inferred from the panel's expanded state: the Theia layout restorer also leaves that
 * panel expanded on reload — which is precisely the leak this guards against.
 */
let mobileWorkHubSideSheetOpenInternal = false;

/** Internal accessor for the mobileWorkHubSideSheetOpen state. Read-only exports provide control over visibility and mutation. */
export function getMobileWorkHubSideSheetOpen(): boolean {
    return mobileWorkHubSideSheetOpenInternal;
}

/**
 * Set mobileWorkHubSideSheetOpen state.
 * Internal-only to prevent direct mutation of the exported variable.
 */
function setMobileWorkHubSideSheetOpenInternal(open: boolean): void {
    mobileWorkHubSideSheetOpenInternal = open;
}

/** Record an explicit side-sheet open/close so {@link recomputeMobileWorkHubHideIdeSidePanels} honors it. */
export function setMobileWorkHubSideSheetOpen(open: boolean): void {
    setMobileWorkHubSideSheetOpenInternal(open);
    recomputeMobileWorkHubHideIdeSidePanels();
}

/**
 * Recompute the hide-IDE-side-panels class from the single invariant that governs it: restored IDE
 * side panels stay hidden across EVERY Work Hub surface (landing, tasks, chat, transcript, and the
 * desktop-width hub), on every viewport, and are revealed only when the classic IDE is open
 * (`desktop-ide`) or the user explicitly opened a side sheet.
 */
export function recomputeMobileWorkHubHideIdeSidePanels(): void {
    const mobileWorkHubSideSheetOpen = getMobileWorkHubSideSheetOpen();
    setMobileWorkHubHideIdeSidePanels(!peekPreferDesktopIde() && !mobileWorkHubSideSheetOpen);
}

export function markMobileProjectsLeftLanding(): void {
    /* Intentionally no-op. The shell keeps this state in memory for the current runtime only. */
}

export function hasMobileProjectsLeftLanding(): boolean {
    return false;
}

export function markMobileProjectsPanelDismiss(): void {
    if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(QAAP_MOBILE_PROJECTS_DISMISS_PANEL_KEY, '1');
        sessionStorage.removeItem(QAAP_MOBILE_PROJECTS_HOME_VISIBLE_KEY);
        if (!peekPreferDesktopIde()) {
            clearPreferDesktopIde();
            markPreferAgentsSurface();
        }
        mobileProjectsPanelDismissConsumed = false;
        markMobileProjectsLeftLanding();
    }
}

export function peekMobileProjectsPanelDismiss(): boolean {
    if (typeof sessionStorage === 'undefined') {
        return false;
    }
    return isFreshMobileProjectsPanelDismiss(sessionStorage.getItem(QAAP_MOBILE_PROJECTS_DISMISS_PANEL_KEY));
}

/**
 * Fires the idempotent post-reload cleanup at most once per page load. The dismiss flag itself
 * persists in sessionStorage so future reloads keep skipping the landing — it is cleared only
 * when the user explicitly returns to the Work Hub via `markMobileProjectsHomeVisible()`.
 */
export function consumeMobileProjectsPanelDismiss(): boolean {
    if (mobileProjectsPanelDismissConsumed) {
        return false;
    }
    if (!peekMobileProjectsPanelDismiss()) {
        return false;
    }
    mobileProjectsPanelDismissConsumed = true;
    return true;
}

export function requestMobileProjectsPanelDismiss(): void {
    markMobileProjectsPanelDismiss();
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(QAAP_MOBILE_PROJECTS_DISMISS_PANEL_EVENT));
    }
}

/** True when the user already chose to enter a workspace (survives reload via sessionStorage). */
export function shouldSkipMobileProjectsLanding(): boolean {
    return peekMobileProjectsPanelDismiss() && !peekMobileProjectsHomeVisible();
}

/**
 * Keep the Agents / Work Hub surface after reload and viewport resize until the user explicitly
 * opens the classic IDE ({@link markPreferDesktopIde}).
 */
export function shouldPreferWorkHubAgentsLayout(): boolean {
    if (peekPreferDesktopIde()) {
        return false;
    }
    return peekPreferAgentsSurface() || shouldSkipMobileProjectsLanding();
}

/**
 * Mobile sessions with a workspace already targeted should boot straight into the Agents
 * execution shell (inline agentic chat), not the IDE main area or the project-list landing.
 */
export function shouldBootstrapMobileAgentsChat(): boolean {
    if (peekPreferDesktopIde()) {
        return false;
    }
    if (hasWorkspaceRouteInUrl()) {
        return true;
    }
    if (peekMobileProjectsHomeVisible()) {
        return false;
    }
    return shouldPreferWorkHubAgentsLayout();
}

function isFreshMobileProjectsPanelDismiss(raw: string | null): boolean {
    return raw === '1';
}

export function markMobileProjectsHomeVisible(): void {
    if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(QAAP_MOBILE_PROJECTS_HOME_VISIBLE_KEY, '1');
        sessionStorage.removeItem(QAAP_MOBILE_PROJECTS_DISMISS_PANEL_KEY);
        clearPreferAgentsSurface();
    }
    installMobileWorkHubBootGuard();
}

export function clearMobileProjectsHomeVisible(): void {
    if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(QAAP_MOBILE_PROJECTS_HOME_VISIBLE_KEY);
    }
}

export function peekMobileProjectsHomeVisible(): boolean {
    return typeof sessionStorage !== 'undefined'
        && sessionStorage.getItem(QAAP_MOBILE_PROJECTS_HOME_VISIBLE_KEY) === '1';
}

/** Hide the IDE shell until Work Hub or Agents chat is mounted (also runs from qaap-login-gate.js). */
export function installMobileWorkHubBootGuard(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
        return;
    }
    // `homeVisible` is intentionally NOT a skip: the Work Hub Home is a hub surface, so the guard
    // must keep the IDE hidden on reload until the home mounts (applyLandingChrome releases it).
    // A `pending` boot intent (Work Hub action mid-flight) also skips the guard — same as an
    // explicit IDE preference — so it never flashes the guard on top of an in-flight navigation.
    if (!shouldInstallWorkHubBootGuard()) {
        return;
    }
    // Work Hub is the default surface on every viewport. The guard is lifted once the
    // Work Hub/Agents shell has mounted; the classic IDE skips it via `preferDesktopIde`.
    document.documentElement.classList.add(QAAP_MOBILE_WORK_HUB_BOOT_CLASS);
    // Keep restored Explorer/side panels hidden from the first bundle tick — qaap-login-gate.js
    // pre-hides via inline CSS, but this invariant must survive after the boot guard lifts.
    recomputeMobileWorkHubHideIdeSidePanels();
}

export function clearMobileWorkHubBootGuard(): void {
    if (typeof document !== 'undefined') {
        document.documentElement.classList.remove(QAAP_MOBILE_WORK_HUB_BOOT_CLASS);
    }
}

/** Work Hub landing list (all projects collapsed): show bottom navigation like the hub mock. */
export const QAAP_MOBILE_LANDING_HUB_LIST_BODY_CLASS = 'theia-mobile-mod-landing-hub-list';

export const QAAP_MOBILE_LANDING_HUB_LIST_CHANGED_EVENT = 'qaap-mobile-landing-hub-list-changed';

export function setMobileLandingHubListChrome(visible: boolean): void {
    if (typeof document === 'undefined') {
        return;
    }
    const alreadyVisible = document.body.classList.contains(QAAP_MOBILE_LANDING_HUB_LIST_BODY_CLASS);
    if (alreadyVisible === visible) {
        return;
    }
    document.body.classList.toggle(QAAP_MOBILE_LANDING_HUB_LIST_BODY_CLASS, visible);
    window.dispatchEvent(new CustomEvent(QAAP_MOBILE_LANDING_HUB_LIST_CHANGED_EVENT, { detail: { visible } }));
}

/**
 * Work Hub primary surface (Agents landing, hub list, empty workspace chat): navigation lives in
 * the sessions sidebar — hide the legacy bottom activity bar and status strip.
 */
export const QAAP_MOBILE_WORKHUB_HIDE_BOTTOM_CHROME_BODY_CLASS = 'theia-mobile-mod-workhub-no-bottom-chrome';

export function setMobileWorkHubHideBottomChrome(hidden: boolean): void {
    if (typeof document === 'undefined') {
        return;
    }
    document.body.classList.toggle(QAAP_MOBILE_WORKHUB_HIDE_BOTTOM_CHROME_BODY_CLASS, hidden);
}

/** Tasks/Chat hub header with composer surface toggle — hide duplicate account control in top bars. */
export const QAAP_MOBILE_WORKHUB_COMPOSER_HEADER_BODY_CLASS = 'theia-mobile-mod-workhub-composer-header';

/**
 * While Work Hub is primary, keep restored IDE side/bottom panels hidden until the user opens
 * an explicit side sheet (Explorer, Chat, etc.).
 */
export const QAAP_MOBILE_WORKHUB_HIDE_IDE_SIDE_PANELS_BODY_CLASS = 'theia-mobile-mod-workhub-hide-ide-side-panels';

export function setMobileWorkHubHideIdeSidePanels(hidden: boolean): void {
    if (typeof document === 'undefined') {
        return;
    }
    document.body.classList.toggle(QAAP_MOBILE_WORKHUB_HIDE_IDE_SIDE_PANELS_BODY_CLASS, hidden);
}

/**
 * Kept for the surface-transition call sites. Hiding no longer depends on the composer/transcript
 * chrome being present — it is the Work-Hub-wide invariant in {@link recomputeMobileWorkHubHideIdeSidePanels}.
 */
export function syncMobileWorkHubHideIdeSidePanelsFromComposerHeader(): void {
    recomputeMobileWorkHubHideIdeSidePanels();
}

export function setMobileWorkHubComposerHeaderChrome(visible: boolean): void {
    if (typeof document === 'undefined') {
        return;
    }
    document.body.classList.toggle(QAAP_MOBILE_WORKHUB_COMPOSER_HEADER_BODY_CLASS, visible);
    recomputeMobileWorkHubHideIdeSidePanels();
}

/** Full-screen agent transcript: hide hub landing chrome and hub bottom bar. */
export const QAAP_MOBILE_ACTIVE_TRANSCRIPT_BODY_CLASS = 'theia-mobile-mod-active-transcript';

export function setMobileActiveTranscriptChrome(active: boolean): void {
    if (typeof document === 'undefined') {
        return;
    }
    document.body.classList.toggle(QAAP_MOBILE_ACTIVE_TRANSCRIPT_BODY_CLASS, active);
    syncMobileWorkHubHideIdeSidePanelsFromComposerHeader();
}

export function markMobileProjectReadmeForOpen(): void {
    if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(QAAP_MOBILE_PROJECTS_OPEN_README_KEY, '1');
    }
}

/** Check the README-open request without consuming it; survives premature workspace events. */
export function peekMobileProjectReadmeOpenRequest(): boolean {
    if (typeof sessionStorage === 'undefined') {
        return false;
    }
    return sessionStorage.getItem(QAAP_MOBILE_PROJECTS_OPEN_README_KEY) === '1';
}

export function consumeMobileProjectReadmeOpenRequest(): boolean {
    if (typeof sessionStorage === 'undefined') {
        return false;
    }
    if (sessionStorage.getItem(QAAP_MOBILE_PROJECTS_OPEN_README_KEY) !== '1') {
        return false;
    }
    sessionStorage.removeItem(QAAP_MOBILE_PROJECTS_OPEN_README_KEY);
    return true;
}

export function clearMobileProjectReadmeOpenRequest(): void {
    if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(QAAP_MOBILE_PROJECTS_OPEN_README_KEY);
    }
}

// Runs at module load so the guard installs from the first bundle tick. Must stay below every
// body-class constant above: in the bundled CommonJS output those exports are plain assignments
// executed in source order, and calling this earlier toggles a class that is still `undefined`.
installMobileWorkHubBootGuard();
