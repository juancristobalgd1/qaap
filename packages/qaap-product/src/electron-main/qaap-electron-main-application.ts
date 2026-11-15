// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { existsSync } from 'fs-extra';
import { app } from 'electron';
import * as path from 'path';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { WindowSearchParams } from '@theia/core/lib/common/window';
import { TheiaBrowserWindowOptions } from '@theia/core/lib/electron-main/theia-electron-window';
import { ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application';
import { isOSX } from '@theia/core/lib/common/os';
import { findQaapPackageFile } from '@theia/qaap-shared-core/lib/node/qaap-package-file';

/**
 * Raster icon of the product (`resources/media`). BrowserWindow and the macOS dock cannot use the
 * SVG logo the web frontend shows, so the native icon is this PNG.
 */
const QAAP_NATIVE_ICON = path.join('resources', 'media', 'qaap-icon-512.png');

/**
 * Name of the product in the macOS menu bar and the application menu ("About Qaap", "Quit Qaap").
 * Set before any window opens: macOS reads the app name when the menu is built.
 */
const QAAP_PRODUCT_NAME = 'Qaap';

/**
 * macOS title bar with the traffic lights drawn inside the Qaap top bar instead of a separate native
 * title strip. The frontend reserves the space to the right of the lights (see
 * `qaap-electron-macos-titlebar.css`). `y` puts the 12px lights' centre (y + 6) at the middle of the 52px Qaap bar.
 */
const QAAP_MACOS_TRAFFIC_LIGHT_POSITION = { x: 13, y: 21 };

/**
 * Smallest desktop window. The mobile layout takes over at 767px (`MOBILE_NARROW_VIEWPORT_MEDIA_QUERY`),
 * so the desktop Work Hub and IDE are kept above it with a margin; a restored smaller window grows to this.
 */
const QAAP_MIN_WINDOW_WIDTH = 960;
const QAAP_MIN_WINDOW_HEIGHT = 600;

@injectable()
export class QaapElectronMainApplication extends ElectronMainApplication {

    @postConstruct()
    protected initProductName(): void {
        app.setName(QAAP_PRODUCT_NAME);
    }

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

    /**
     * On macOS with the native frame the window keeps its frame but hides the title strip, so the
     * traffic lights sit inside the Qaap top bar. Other platforms and the custom frame are unchanged.
     */
    protected override getDefaultOptions(): TheiaBrowserWindowOptions {
        const options: TheiaBrowserWindowOptions = {
            ...super.getDefaultOptions(),
            minWidth: QAAP_MIN_WINDOW_WIDTH,
            minHeight: QAAP_MIN_WINDOW_HEIGHT
        };
        if (isOSX && this.useNativeWindowFrame) {
            return {
                ...options,
                titleBarStyle: 'hiddenInset',
                trafficLightPosition: QAAP_MACOS_TRAFFIC_LIGHT_POSITION
            };
        }
        return options;
    }

    /** Electron does not grow a restored window to `minWidth`, so a smaller saved size is raised here. */
    override async getLastWindowOptions(): Promise<TheiaBrowserWindowOptions> {
        return this.clampToMinimumSize(await super.getLastWindowOptions());
    }

    protected override getDefaultTheiaWindowOptions(): TheiaBrowserWindowOptions {
        return this.clampToMinimumSize(super.getDefaultTheiaWindowOptions());
    }

    protected clampToMinimumSize(options: TheiaBrowserWindowOptions): TheiaBrowserWindowOptions {
        return {
            ...options,
            width: Math.max(options.width ?? 0, QAAP_MIN_WINDOW_WIDTH),
            height: Math.max(options.height ?? 0, QAAP_MIN_WINDOW_HEIGHT)
        };
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
