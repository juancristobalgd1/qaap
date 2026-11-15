// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { existsSync } from 'fs-extra';
import { app } from 'electron';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { WindowSearchParams } from '@theia/core/lib/common/window';
import { ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application';
import { findQaapPackageFile } from '@theia/qaap-shared-core/lib/node/qaap-package-file';

/**
 * Raster icon of the product (`resources/media`). BrowserWindow and the macOS dock cannot use the
 * SVG logo the web frontend shows, so the native icon is this PNG.
 */
const QAAP_NATIVE_ICON = path.join('resources', 'media', 'qaap-icon-512.png');

@injectable()
export class QaapElectronMainApplication extends ElectronMainApplication {

    /**
     * Loads the window from the backend's own origin, like the browser does. Theia loads the frontend
     * from `file://` and only passes the backend `port`; the Qaap sign-in gate and its `/qaap/api/*`
     * calls, the `/login` and `/media` assets and the token cookie (set for `localhost:<port>`) all need
     * the page to share the backend origin.
     */
    protected override async createWindowUri(params: WindowSearchParams = {}): Promise<URI> {
        if (!('port' in params)) {
            params.port = (await this.backendPort).toString();
        }
        const query = Object.entries(params).map(([name, value]) => `${name}=${value}`).join('&');
        return new URI(`http://localhost:${params.port}/`).withQuery(query);
    }

    protected override resolveApplicationIconPath(): string | undefined {
        const ref = this.config.applicationIcon?.trim();
        // A raster icon named by the app (`IDE_APPLICATION_ICON`, PNG) wins; the web logo is an SVG.
        if (ref && !/^https?:\/\//i.test(ref) && !/\.svg$/i.test(ref)) {
            const candidate = path.isAbsolute(ref) ? ref : path.join(app.getAppPath(), ref.replace(/^\.\//, ''));
            if (existsSync(candidate)) {
                return candidate;
            }
        }
        return findQaapPackageFile('@theia/qaap-product', QAAP_NATIVE_ICON, { startDirectory: app.getAppPath() });
    }

    protected override async startContributions(): Promise<void> {
        await super.startContributions();
        this.applyDockIcon();
    }

    /** macOS shows the dock icon of the dev Electron binary unless the app sets its own. */
    protected applyDockIcon(): void {
        const icon = this.resolveApplicationIconPath();
        if (process.platform === 'darwin' && icon && app.dock) {
            app.dock.setIcon(icon);
        }
    }
}
