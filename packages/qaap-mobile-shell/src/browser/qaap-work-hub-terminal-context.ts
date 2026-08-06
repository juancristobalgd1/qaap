// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Compatibility re-export for Qaap mobile-shell consumers. The registry lives in
// qaap-adapters so ai-terminal can route Work Hub actions without a package cycle.
export {
    getQaapWorkHubTerminalContext,
    registerQaapWorkHubTerminalContext,
} from '@theia/qaap-adapters/lib/browser/qaap-work-hub-terminal-context';
export type { QaapWorkHubTerminalContext } from '@theia/qaap-adapters/lib/browser/qaap-work-hub-terminal-context';
