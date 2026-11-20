// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Desktop platforms with an installer link. Mirrors the browser detection in `landing/qaap-desktop-download.js`. */
export type QaapDesktopDownloadLinkPlatform = 'mac' | 'windows' | 'linux';

/** Environment variable that holds the installer URL of each platform. Unset means no invitation for it. */
export const QAAP_DESKTOP_DOWNLOAD_ENV: Readonly<Record<QaapDesktopDownloadLinkPlatform, string>> = {
    mac: 'QAAP_DESKTOP_DOWNLOAD_URL_MAC',
    windows: 'QAAP_DESKTOP_DOWNLOAD_URL_WIN',
    linux: 'QAAP_DESKTOP_DOWNLOAD_URL_LINUX',
};

/** Public path of the JSON document the landing page reads. */
export const QAAP_DESKTOP_DOWNLOAD_LINKS_PATH = '/qaap/desktop-downloads.json';

/**
 * Installer URLs per platform, read from the environment. Only absolute `https:` URLs without credentials
 * are accepted: anything else is dropped, so a typo never renders a broken or unsafe link.
 */
export function resolveQaapDesktopDownloadLinks(env: NodeJS.ProcessEnv = process.env): Partial<Record<QaapDesktopDownloadLinkPlatform, string>> {
    const links: Partial<Record<QaapDesktopDownloadLinkPlatform, string>> = {};
    for (const platform of Object.keys(QAAP_DESKTOP_DOWNLOAD_ENV) as QaapDesktopDownloadLinkPlatform[]) {
        const url = normalizeHttpsUrl(env[QAAP_DESKTOP_DOWNLOAD_ENV[platform]]);
        if (url) {
            links[platform] = url;
        }
    }
    return links;
}

function normalizeHttpsUrl(raw: string | undefined): string | undefined {
    const value = raw?.trim();
    if (!value) {
        return undefined;
    }
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password) {
            return undefined;
        }
        return url.toString();
    } catch {
        return undefined;
    }
}
