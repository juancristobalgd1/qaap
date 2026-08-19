// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { codicon, PanelLayout, Widget } from '@theia/core/lib/browser';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { ApplicationShell } from '@theia/core/lib/browser/shell';
import { MOBILE_ONE_COLUMN_LAYOUT_CLASS } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { MiniBrowser } from '@theia/mini-browser/lib/browser/mini-browser';
import { MiniBrowserOpenHandler, MiniBrowserCommands } from '@theia/mini-browser/lib/browser/mini-browser-open-handler';
import { MiniBrowserOpenerOptions } from '@theia/mini-browser/lib/browser/mini-browser-opener-options';
import { formatMiniBrowserNavigateError, normalizeMiniBrowserOpenUrl } from '@theia/mini-browser/lib/browser/mini-browser-url-utils';
import { isMiniBrowserPreviewPlaceholderUrl } from './qaap-mini-browser-defaults';
import { QaapMiniBrowser } from './qaap-mini-browser';
import {
    coerceQaapPreviewWidgetKey,
    isQaapPreviewWidgetUri,
    QaapPreviewWidgetKey,
    qaapPreviewWidgetUri,
} from './qaap-preview-widget-uri';

/**
 * Qaap mobile / URL preview behavior for mini-browser open handler.
 */
@injectable()
export class QaapMiniBrowserOpenHandler extends MiniBrowserOpenHandler {

    @inject(MessageService)
    protected readonly messages: MessageService;

    override async open(uri: URI, options?: MiniBrowserOpenerOptions): Promise<MiniBrowser> {
        const widget = await super.open(uri, options);
        if (isQaapPreviewWidgetUri(uri) && this.isMobileOneColumn()) {
            const area = this.shell.getAreaFor(widget);
            if (area === 'main') {
                await this.shell.activateWidget(widget.id);
            }
        }
        this.relayoutPreviewWidget(widget);
        return widget;
    }

    protected override async getOrCreateWidget(uri: URI, options?: MiniBrowserOpenerOptions): Promise<MiniBrowser> {
        const widget = await super.getOrCreateWidget(uri, options);
        const layout = widget.layout as PanelLayout;
        if (!layout.widgets.length || layout.widgets[0].isDisposed) {
            const props = await this.options(uri, options);
            widget.setProps(props);
        }
        return widget;
    }

    override registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands);
        // registerHandler prepends Qaap behavior (empty preview tab, no quick-input) over upstream handlers.
        commands.registerHandler(MiniBrowserCommands.PREVIEW.id, {
            execute: widget => this.preview(widget),
            isEnabled: widget => this.canPreviewWidget(widget),
            isVisible: widget => this.canPreviewWidget(widget)
        });
        commands.registerHandler(MiniBrowserCommands.OPEN_SOURCE.id, {
            execute: widget => this.openSource(widget),
            isEnabled: widget => !!this.getSourceUri(widget),
            isVisible: widget => !!this.getSourceUri(widget)
        });
        commands.registerHandler(MiniBrowserCommands.OPEN_URL.id, {
            execute: (...args: unknown[]) => this.openUrl(
                this.coerceUrlCommandArg(args),
                coerceQaapPreviewWidgetKey(args),
            )
        });
    }

    /** Mobile bottom bar: open toolbar + empty iframe without quick-input. */
    async openEmptyPreviewTab(): Promise<MiniBrowser | undefined> {
        return this.openEmptyPreview();
    }

    protected coerceUrlCommandArg(args: unknown[]): string | undefined {
        for (const arg of args) {
            if (typeof arg === 'string') {
                const t = normalizeMiniBrowserOpenUrl(arg);
                if (t) {
                    return t;
                }
            }
        }
        return undefined;
    }

    protected override async openUrl(urlFromCommand?: string, key?: QaapPreviewWidgetKey): Promise<void> {
        const url = urlFromCommand ? normalizeMiniBrowserOpenUrl(urlFromCommand) : '';
        if (!url) {
            await this.openEmptyPreview();
            return;
        }
        await this.openPreviewForProduct(url, key);
    }

    protected override async options(
        uri?: URI,
        options?: MiniBrowserOpenerOptions
    ): Promise<MiniBrowserOpenerOptions & { widgetOptions: ApplicationShell.WidgetOptions }> {
        if (isQaapPreviewWidgetUri(uri)) {
            let result = await this.defaultOptions();
            if (options) {
                result = { ...result, ...options };
            }
            if (isMiniBrowserPreviewPlaceholderUrl(result.startPage)) {
                const { startPage: _removed, ...withoutPlaceholder } = result;
                result = withoutPlaceholder;
            }
            return result;
        }
        return super.options(uri, options);
    }

    /** Opens preview with toolbar URL input; no quick-input prompt. */
    protected async openEmptyPreview(): Promise<MiniBrowser | undefined> {
        const area = this.previewArea();
        await this.closePreviewIfNeedsFreshAttach(area);
        const props: MiniBrowserOpenerOptions = {
            name: nls.localize(MiniBrowserCommands.PREVIEW_CATEGORY_KEY, MiniBrowserCommands.PREVIEW_CATEGORY),
            toolbar: 'show',
            widgetOptions: {
                area,
                mode: 'tab-after'
            },
            resetBackground: false,
            iconClass: codicon('preview'),
            openFor: 'preview'
        };
        return this.open(MiniBrowserOpenHandler.PREVIEW_URI, props);
    }

    /**
     * Opens the preview of a specific project in its own widget.
     *
     * Each project gets a dedicated preview tab keyed by {@link QaapPreviewWidgetKey}, so switching
     * project / conversation / section can never show another project's preview, and two projects
     * can be previewed side by side.
     */
    async openProjectPreview(startPage: string, key: QaapPreviewWidgetKey): Promise<MiniBrowser | undefined> {
        return this.openPreviewForProduct(startPage, key);
    }

    protected async openPreviewForProduct(startPage: string, key?: QaapPreviewWidgetKey): Promise<MiniBrowser | undefined> {
        const trimmed = normalizeMiniBrowserOpenUrl(startPage);
        if (!trimmed) {
            this.messages.warn(nls.localize('theia/mini-browser/emptyUrl', 'Please enter a URL.'));
            return undefined;
        }
        let mapped: string;
        try {
            mapped = await this.locationMapperService.map(trimmed);
        } catch (err) {
            this.messages.error(nls.localize(
                'theia/mini-browser/urlMapFailed',
                'Could not resolve that URL: {0}',
                formatMiniBrowserNavigateError(err)
            ));
            return undefined;
        }
        const props = await this.getOpenPreviewProps(mapped);
        const uri = qaapPreviewWidgetUri(key);
        console.info('[qaap-preview] open widget', {
            keyed: !!key,
            workspaceId: key?.workspaceId,
            projectId: key?.projectId,
            widgetUri: uri.toString(),
            startPage: mapped,
        });
        await this.closePreviewIfNeedsFreshAttach(props.widgetOptions?.area ?? this.previewArea(), uri);
        if (key) {
            await this.closeLegacyPreviewWidget();
        }
        return this.open(uri, props);
    }

    /**
     * Closes the identity-less preview tab once a project-scoped one takes over.
     *
     * Restored layouts (and the pre-fix single-tab flow) contain the legacy widget id; without this
     * the user would see a stale, unowned "Preview" tab next to the project ones.
     */
    protected async closeLegacyPreviewWidget(): Promise<void> {
        const legacy = await this.getWidget(MiniBrowserOpenHandler.PREVIEW_URI);
        if (legacy?.isAttached) {
            await this.shell.closeWidget(legacy.id, { save: false });
        }
    }

    /** Preview tabs are synthetic surfaces; they have no source document to open. */
    protected override getSourceUri(ref?: Widget): URI | undefined {
        const uri = super.getSourceUri(ref);
        return isQaapPreviewWidgetUri(uri) ? undefined : uri;
    }

    protected override async getOpenPreviewProps(startPage: string): Promise<MiniBrowserOpenerOptions> {
        let resetBackground = false;
        try {
            resetBackground = await this.resetBackground(new URI(startPage));
        } catch {
            resetBackground = startPage.startsWith('http://') || startPage.startsWith('https://');
        }
        return {
            name: nls.localize(MiniBrowserCommands.PREVIEW_CATEGORY_KEY, MiniBrowserCommands.PREVIEW_CATEGORY),
            startPage,
            toolbar: 'show',
            widgetOptions: {
                area: this.previewArea(),
                mode: 'tab-after'
            },
            resetBackground,
            iconClass: codicon('preview'),
            openFor: 'preview'
        };
    }

    protected previewArea(): ApplicationShell.Area {
        return this.isMobileOneColumn() ? 'main' : 'right';
    }

    protected async closePreviewIfNeedsFreshAttach(area: ApplicationShell.Area, uri: URI = MiniBrowserOpenHandler.PREVIEW_URI): Promise<void> {
        const existing = await this.getWidget(uri);
        if (!existing?.isAttached) {
            return;
        }
        const currentArea = this.shell.getAreaFor(existing);
        if (currentArea && currentArea !== area) {
            await this.shell.closeWidget(existing.id, { save: false });
        }
    }

    protected isMobileOneColumn(): boolean {
        if (typeof document === 'undefined') {
            return false;
        }
        const shellNode = document.getElementById('theia-app-shell');
        return !!shellNode?.classList.contains(MOBILE_ONE_COLUMN_LAYOUT_CLASS);
    }

    protected relayoutPreviewWidget(widget: MiniBrowser): void {
        if (widget instanceof QaapMiniBrowser) {
            widget.scheduleChromeRelayout();
        }
    }
}
