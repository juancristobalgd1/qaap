// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { CommonCommands } from '@theia/core/lib/browser/common-commands';
import { injectable } from '@theia/core/shared/inversify';
import { QaapSupportedLocales } from '../common/qaap-supported-locales';

/**
 * While Qaap ships English only ({@link QaapSupportedLocales}), removes core's
 * "Configure Display Language" command: picking another language would only reload the app
 * back into English, because the login gate rewrites unsupported `localeId` values.
 *
 * Bound after `@theia/core`'s `CommonFrontendContribution`, so the command is registered by the
 * time this contribution runs.
 */
@injectable()
export class QaapDisplayLanguageCommandContribution implements CommandContribution {

    /** Display languages users may pick; tests override it. */
    protected readonly supportedLocales: readonly string[] = QaapSupportedLocales.LOCALES;

    registerCommands(registry: CommandRegistry): void {
        if (QaapSupportedLocales.isLocalizationEnabled(this.supportedLocales)) {
            return;
        }
        if (registry.getCommand(CommonCommands.CONFIGURE_DISPLAY_LANGUAGE.id)) {
            registry.unregisterCommand(CommonCommands.CONFIGURE_DISPLAY_LANGUAGE.id);
        }
    }
}
