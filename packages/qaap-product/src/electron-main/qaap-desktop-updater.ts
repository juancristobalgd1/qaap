// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { app, Notification, shell } from 'electron';
import { injectable } from '@theia/core/shared/inversify';
import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import {
    decideQaapDesktopUpdateMode,
    pickLatestDesktopReleaseTag,
    QAAP_DESKTOP_RELEASE_DOWNLOAD_BASE_URL,
    QAAP_DESKTOP_RELEASES_API_URL,
    QAAP_DESKTOP_RELEASES_URL,
    QAAP_DESKTOP_UPDATE_FIRST_CHECK_DELAY_MS,
    QAAP_DESKTOP_UPDATE_INTERVAL_MS,
    QaapDesktopUpdateDecision
} from './qaap-desktop-update-policy';

/** The part of `electron-updater`'s `AppUpdater` this class uses (the module is loaded lazily, only in an installed build). */
interface QaapAppUpdater {
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    logger: { info(message?: unknown): void; warn(message?: unknown): void; error(message?: unknown): void; debug?(message?: string): void } | null;
    on(event: 'update-available' | 'update-downloaded', listener: (info: { version: string }) => void): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
    setFeedURL(options: { provider: 'generic'; url: string }): void;
    checkForUpdates(): Promise<unknown>;
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

/**
 * Keeps an installed desktop build up to date from the GitHub Releases of the repository
 * (`publish` block of `examples/electron/electron-builder.yml`, embedded as `app-update.yml`).
 *
 * What it does depends on the platform, see {@link decideQaapDesktopUpdateMode}:
 * - auto-install (Windows, Linux AppImage, signed macOS): checks at start and every 6 hours, downloads in the
 *   background and shows a quiet system notification "Restart to update". Clicking it restarts into the new
 *   version; ignoring it still installs the update the next time the app quits.
 * - notify-only (unsigned macOS, Linux deb): checks the same way but downloads nothing; the notification
 *   "Update available — download" opens the releases page in the browser.
 * - disabled in a development run (app not packaged).
 * A failed check (offline, rate limit) is logged and retried at the next interval; it never reaches the user.
 */
@injectable()
export class QaapDesktopUpdater implements ElectronMainApplicationContribution {

    protected decision: QaapDesktopUpdateDecision | undefined;
    protected updater: QaapAppUpdater | undefined;
    protected firstCheckTimer: NodeJS.Timeout | undefined;
    protected intervalTimer: NodeJS.Timeout | undefined;
    protected notifiedVersion: string | undefined;
    /** Held so the notification is not garbage collected before the user clicks it. */
    protected notification: Notification | undefined;

    onStart(): void {
        const decision = decideQaapDesktopUpdateMode({
            isPackaged: app.isPackaged,
            platform: process.platform,
            env: process.env,
            signedBuild: this.isSignedBuild()
        });
        this.decision = decision;
        if (decision.mode === 'disabled') {
            console.info(`[qaap-updater] disabled: ${decision.reason}`);
            return;
        }
        console.info(`[qaap-updater] ${decision.mode}: ${decision.reason}`);
        this.firstCheckTimer = setTimeout(() => { this.check(); }, QAAP_DESKTOP_UPDATE_FIRST_CHECK_DELAY_MS);
        this.intervalTimer = setInterval(() => { this.check(); }, QAAP_DESKTOP_UPDATE_INTERVAL_MS);
        // Neither timer may keep the process alive on its own.
        this.firstCheckTimer.unref();
        this.intervalTimer.unref();
    }

    onStop(): void {
        if (this.firstCheckTimer) {
            clearTimeout(this.firstCheckTimer);
        }
        if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
        }
    }

    /** `qaapDesktopSigned` is written into the packaged app's package.json by the release build once it is signed. */
    protected isSignedBuild(): boolean {
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
            return manifest.qaapDesktopSigned === true;
        } catch {
            return false;
        }
    }

    protected async check(): Promise<void> {
        try {
            const tag = await this.resolveLatestDesktopTag();
            if (!tag) {
                console.info('[qaap-updater] no desktop release published yet');
                return;
            }
            const updater = this.ensureUpdater();
            // The feed (`latest*.yml`) lives in the release's own download folder. electron-updater's GitHub provider
            // would take the repository's newest release of any kind, and releases stay pre-releases while unsigned.
            updater.setFeedURL({ provider: 'generic', url: `${QAAP_DESKTOP_RELEASE_DOWNLOAD_BASE_URL}/${tag}` });
            await updater.checkForUpdates();
        } catch (error) {
            this.logFailure(error);
        }
    }

    protected async resolveLatestDesktopTag(): Promise<string | undefined> {
        const response = await fetch(QAAP_DESKTOP_RELEASES_API_URL, { headers: { Accept: 'application/vnd.github+json' } });
        if (!response.ok) {
            throw new Error(`GitHub releases answered ${response.status}`);
        }
        return pickLatestDesktopReleaseTag(await response.json() as Array<{ tag_name?: unknown; draft?: unknown }>);
    }

    protected ensureUpdater(): QaapAppUpdater {
        if (this.updater) {
            return this.updater;
        }
        // Loaded here, not at the top: a development run and the unit specs never touch the module.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { autoUpdater } = require('electron-updater') as { autoUpdater: QaapAppUpdater };
        const autoInstall = this.decision?.mode === 'auto-install';
        autoUpdater.logger = { info: message => console.info('[qaap-updater]', message), warn: message => console.warn('[qaap-updater]', message), error: message => console.error('[qaap-updater]', message) };
        autoUpdater.autoDownload = autoInstall;
        autoUpdater.autoInstallOnAppQuit = autoInstall;
        autoUpdater.on('error', error => this.logFailure(error));
        if (autoInstall) {
            autoUpdater.on('update-downloaded', info => this.offerRestart(autoUpdater, info.version));
        } else {
            autoUpdater.on('update-available', info => this.offerDownload(info.version));
        }
        this.updater = autoUpdater;
        return autoUpdater;
    }

    protected offerRestart(updater: QaapAppUpdater, version: string): void {
        if (!this.shouldNotify(version)) {
            return;
        }
        this.showNotification(
            `Qaap ${version} is ready`,
            'Restart to update',
            () => updater.quitAndInstall()
        );
    }

    protected offerDownload(version: string): void {
        if (!this.shouldNotify(version)) {
            return;
        }
        this.showNotification(
            `Qaap ${version} is available`,
            'Update available — download',
            () => { shell.openExternal(QAAP_DESKTOP_RELEASES_URL).catch(error => this.logFailure(error)); }
        );
    }

    /** One notification per version and session: the 6-hour checks must not nag. */
    protected shouldNotify(version: string): boolean {
        if (this.notifiedVersion === version) {
            return false;
        }
        this.notifiedVersion = version;
        return true;
    }

    protected showNotification(title: string, body: string, onClick: () => void): void {
        if (!Notification.isSupported()) {
            console.info(`[qaap-updater] ${title}: ${body} (notifications are not available on this system)`);
            return;
        }
        const notification = new Notification({ title, body, silent: true });
        notification.on('click', onClick);
        this.notification = notification;
        notification.show();
    }

    protected logFailure(error: unknown): void {
        console.warn(`[qaap-updater] update check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
