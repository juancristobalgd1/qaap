// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const QAAP_MOBILE_PREFER_DESKTOP_IDE_KEY = 'qaap.mobileProjects.preferDesktopIde';

/** Kept for compatibility with builds that wrote this explicit IDE marker. */
export const QAAP_MOBILE_EXPLICIT_DESKTOP_IDE_KEY = 'qaap.mobileProjects.explicitDesktopIde';

/** User is on the Agents / Work Hub workspace surface (not the project list landing). */
export const QAAP_MOBILE_PREFER_AGENTS_SURFACE_KEY = 'qaap.mobileProjects.preferAgentsSurface';

let preferDesktopIdeThisRuntime = false;

/** Body class while the user is in mobile desktop-IDE mode (Open IDE). */
export const QAAP_MOBILE_DESKTOP_IDE_BODY_CLASS = 'theia-mobile-mod-desktop-ide';

function syncDesktopIdeBodyClass(): void {
    if (typeof document === 'undefined') {
        return;
    }
    document.body.classList.toggle(QAAP_MOBILE_DESKTOP_IDE_BODY_CLASS, preferDesktopIdeThisRuntime);
}

function readPersistedPreferDesktopIde(): boolean {
    if (typeof sessionStorage === 'undefined') {
        return false;
    }
    return sessionStorage.getItem(QAAP_MOBILE_PREFER_DESKTOP_IDE_KEY) === '1'
        || sessionStorage.getItem(QAAP_MOBILE_EXPLICIT_DESKTOP_IDE_KEY) === '1';
}

function writePersistedPreferDesktopIde(active: boolean): void {
    if (typeof sessionStorage === 'undefined') {
        return;
    }
    if (active) {
        sessionStorage.setItem(QAAP_MOBILE_PREFER_DESKTOP_IDE_KEY, '1');
        sessionStorage.setItem(QAAP_MOBILE_EXPLICIT_DESKTOP_IDE_KEY, '1');
        sessionStorage.removeItem(QAAP_MOBILE_PREFER_AGENTS_SURFACE_KEY);
    } else {
        sessionStorage.removeItem(QAAP_MOBILE_PREFER_DESKTOP_IDE_KEY);
        sessionStorage.removeItem(QAAP_MOBILE_EXPLICIT_DESKTOP_IDE_KEY);
    }
}

/** Persists explicit desktop IDE choice for reload/F5 within the same browser session. */
export function markPreferDesktopIde(): void {
    preferDesktopIdeThisRuntime = true;
    writePersistedPreferDesktopIde(true);
    syncDesktopIdeBodyClass();
}

export function clearPreferDesktopIde(): void {
    preferDesktopIdeThisRuntime = false;
    writePersistedPreferDesktopIde(false);
    syncDesktopIdeBodyClass();
}

/** Hydrates session-scoped IDE preference after reload. */
export function peekPreferDesktopIde(): boolean {
    if (typeof sessionStorage !== 'undefined') {
        preferDesktopIdeThisRuntime = preferDesktopIdeThisRuntime || readPersistedPreferDesktopIde();
        syncDesktopIdeBodyClass();
    }
    return preferDesktopIdeThisRuntime;
}

export function markPreferAgentsSurface(): void {
    if (typeof sessionStorage !== 'undefined') {
        if (peekPreferDesktopIde()) {
            return;
        }
        sessionStorage.setItem(QAAP_MOBILE_PREFER_AGENTS_SURFACE_KEY, '1');
    }
}

export function clearPreferAgentsSurface(): void {
    if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(QAAP_MOBILE_PREFER_AGENTS_SURFACE_KEY);
    }
}

export function peekPreferAgentsSurface(): boolean {
    return typeof sessionStorage !== 'undefined'
        && sessionStorage.getItem(QAAP_MOBILE_PREFER_AGENTS_SURFACE_KEY) === '1';
}

/** True when the URL already targets a workspace (available before WorkspaceService is ready). */
export function hasWorkspaceRouteInUrl(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, '').trim());
    return hash.length > 0 && hash !== '/';
}
