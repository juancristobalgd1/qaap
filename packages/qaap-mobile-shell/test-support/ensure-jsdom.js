// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Mocha root hooks: re-ensure the shared JSDOM environment before every test.
 *
 * Theia's `enableJSDOM()` is process-global and idempotent, and most spec files enable it at
 * module level (load time). A minority of suites tear it down in `after(() => disableJSDOM())`,
 * which deletes the globals for every suite that was loaded earlier but executes afterwards
 * (~46 order-dependent `document is not defined` failures). Re-ensuring here is a no-op while
 * the environment is alive and recreates it after a teardown — per-suite after-hooks keep
 * their semantics without breaking neighbours.
 */

const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');

exports.mochaHooks = {
    beforeEach() {
        enableJSDOM();
    },
};
