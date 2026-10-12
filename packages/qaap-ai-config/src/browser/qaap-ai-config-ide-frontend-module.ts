// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { LaunchListProvider } from '@theia/ai-ide/lib/browser/workspace-launch-provider';
import { QaapLaunchListProvider } from './qaap-launch-list-provider';

/**
 * IDE-only half of the AI configuration bindings: desktop loads it right after
 * `qaap-ai-config-frontend-module`; the `bundle-mobile` entry excludes it (launch configurations
 * come from `@theia/debug`).
 */
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(QaapLaunchListProvider).toSelf().inSingletonScope();
    rebind(LaunchListProvider).toService(QaapLaunchListProvider);
});
