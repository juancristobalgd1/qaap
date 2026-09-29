// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, named } from '@theia/core/shared/inversify';
import { ContributionProvider } from '@theia/core/lib/common/contribution-provider';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';

export const QaapWidgetStylesheetContribution = Symbol('QaapWidgetStylesheetContribution');

/**
 * Stylesheets that only style widgets of the given factories. They stay out of `bundle.css`
 * (`?qaap-lazy` imports) and are attached before the first such widget is created.
 */
export interface QaapWidgetStylesheetContribution {
    readonly factoryIds: readonly string[];
    /** Attach the stylesheets, typically `QaapLazyStylesheets.load(...)` over `?qaap-lazy` imports. */
    loadStylesheets(): Promise<void>;
}

/**
 * Holds widget creation (`WidgetManager.onWillCreateWidget`, which also covers layout restore)
 * until the widget's lazy stylesheets have loaded, so no widget is ever shown unstyled.
 */
@injectable()
export class QaapLazyWidgetStylesheets implements FrontendApplicationContribution {

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ContributionProvider) @named(QaapWidgetStylesheetContribution)
    protected readonly contributions: ContributionProvider<QaapWidgetStylesheetContribution>;

    protected readonly loading = new Map<QaapWidgetStylesheetContribution, Promise<void>>();

    initialize(): void {
        const byFactoryId = new Map<string, QaapWidgetStylesheetContribution[]>();
        for (const contribution of this.contributions.getContributions()) {
            for (const factoryId of contribution.factoryIds) {
                const list = byFactoryId.get(factoryId) ?? [];
                list.push(contribution);
                byFactoryId.set(factoryId, list);
            }
        }
        this.widgetManager.onWillCreateWidget(event => {
            const contributions = byFactoryId.get(event.factoryId);
            if (contributions) {
                event.waitUntil(Promise.all(contributions.map(contribution => this.load(contribution))));
            }
        });
    }

    protected load(contribution: QaapWidgetStylesheetContribution): Promise<void> {
        let loading = this.loading.get(contribution);
        if (!loading) {
            loading = contribution.loadStylesheets();
            this.loading.set(contribution, loading);
        }
        return loading;
    }
}
