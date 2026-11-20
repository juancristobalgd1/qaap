// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * What the desktop app does about updates on this platform:
 * - `disabled`: no network check at all (development run, or switched off by the operator).
 * - `auto-install`: check, download in the background and offer "Restart to update".
 * - `notify-only`: check and tell the user an update exists; the installer is downloaded from the release page.
 */
export type QaapDesktopUpdateMode = 'disabled' | 'auto-install' | 'notify-only';

export interface QaapDesktopUpdateContext {
    /** `app.isPackaged`: false for `npm run start:electron`, true for an installed build. */
    readonly isPackaged: boolean;
    /** `process.platform`. */
    readonly platform: NodeJS.Platform;
    /** `process.env`. */
    readonly env: NodeJS.ProcessEnv;
    /**
     * True when the build is code-signed (the `qaapDesktopSigned` flag the release build writes into the app's
     * package.json). Squirrel.Mac refuses to install an update into an unsigned app, so macOS only auto-installs
     * when this is true. Defaults to false: today's installers are unsigned.
     */
    readonly signedBuild?: boolean;
}

export interface QaapDesktopUpdateDecision {
    readonly mode: QaapDesktopUpdateMode;
    /** Short reason, written to the log. */
    readonly reason: string;
}

/** Environment switch: `0` / `false` / `off` turns update checks off (for example in managed fleets). */
export const QAAP_DESKTOP_AUTO_UPDATE_ENV = 'QAAP_DESKTOP_AUTO_UPDATE';

/** How often a running app looks for a new release. */
export const QAAP_DESKTOP_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** First check after start, late enough to stay out of the way of the window and backend start. */
export const QAAP_DESKTOP_UPDATE_FIRST_CHECK_DELAY_MS = 15 * 1000;

/** Releases page opened by "Update available — download" (the latest pre-release is not under `/latest`). */
export const QAAP_DESKTOP_RELEASES_URL = 'https://github.com/juancristobalgd1/qaap/releases';

/**
 * Decides the update behaviour for this process. Pure: everything it needs comes in through `context`.
 *
 * - Windows (NSIS) installs updates without a signature.
 * - Linux installs updates only for the AppImage (`APPIMAGE` is set by its runtime); a `.deb` is managed by the
 *   package manager, so it only notifies.
 * - macOS needs a signed app for in-place updates, so an unsigned build only notifies.
 */
export function decideQaapDesktopUpdateMode(context: QaapDesktopUpdateContext): QaapDesktopUpdateDecision {
    if (!context.isPackaged) {
        return { mode: 'disabled', reason: 'development run (app is not packaged)' };
    }
    const switchValue = context.env[QAAP_DESKTOP_AUTO_UPDATE_ENV]?.trim().toLowerCase();
    if (switchValue === '0' || switchValue === 'false' || switchValue === 'off') {
        return { mode: 'disabled', reason: `${QAAP_DESKTOP_AUTO_UPDATE_ENV} is off` };
    }
    switch (context.platform) {
        case 'win32':
            return { mode: 'auto-install', reason: 'Windows installer updates in place' };
        case 'darwin':
            return context.signedBuild
                ? { mode: 'auto-install', reason: 'signed macOS build' }
                : { mode: 'notify-only', reason: 'unsigned macOS build cannot install updates in place' };
        case 'linux':
            return context.env.APPIMAGE
                ? { mode: 'auto-install', reason: 'AppImage updates in place' }
                : { mode: 'notify-only', reason: 'only the AppImage updates in place' };
        default:
            return { mode: 'disabled', reason: `unsupported platform ${context.platform}` };
    }
}

/** Repository whose releases carry the installers. Keep in sync with the `publish` block of `examples/electron/electron-builder.yml`. */
export const QAAP_DESKTOP_RELEASES_API_URL = 'https://api.github.com/repos/juancristobalgd1/qaap/releases?per_page=50';

/** Base of the per-tag download folder that holds the installers and the electron-updater feed (`latest*.yml`). */
export const QAAP_DESKTOP_RELEASE_DOWNLOAD_BASE_URL = 'https://github.com/juancristobalgd1/qaap/releases/download';

const DESKTOP_TAG_PATTERN = /^desktop-v(\d+)\.(\d+)\.(\d+)$/;

/**
 * The newest desktop release tag (`desktop-vX.Y.Z`, highest version) among the repository's releases, skipping
 * drafts and every release that is not a desktop one (the repository also publishes other releases, so the
 * "latest release" shortcut of electron-updater's GitHub provider would pick the wrong one).
 */
export function pickLatestDesktopReleaseTag(releases: ReadonlyArray<{ readonly tag_name?: unknown; readonly draft?: unknown }>): string | undefined {
    let best: { tag: string; parts: number[] } | undefined;
    for (const release of releases) {
        const match = typeof release.tag_name === 'string' && !release.draft ? DESKTOP_TAG_PATTERN.exec(release.tag_name) : null;
        if (!match) {
            continue;
        }
        const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
        if (!best || compareVersionParts(parts, best.parts) > 0) {
            best = { tag: release.tag_name as string, parts };
        }
    }
    return best?.tag;
}

function compareVersionParts(a: number[], b: number[]): number {
    for (let index = 0; index < 3; index++) {
        if (a[index] !== b[index]) {
            return a[index] - b[index];
        }
    }
    return 0;
}
