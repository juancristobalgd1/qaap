// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * The CommonJS build of `perfect-scrollbar` assigns the class to `module.exports`. The deferred shim
 * imports it by this deep path so the `perfect-scrollbar` bundle alias does not resolve to itself.
 */
declare module 'perfect-scrollbar/dist/perfect-scrollbar.common.js' {
    import PerfectScrollbar from 'perfect-scrollbar';
    export = PerfectScrollbar;
}
