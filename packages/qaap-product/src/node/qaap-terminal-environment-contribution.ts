// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';

/**
 * npm adds this variable when the browser app is started with `npm --prefix`.
 * nvm rejects it, so it must not be inherited by integrated IDE terminals.
 */
@injectable()
export class QaapTerminalEnvironmentContribution implements BackendApplicationContribution {

    initialize(): void {
        delete process.env.npm_config_prefix;
    }
}
