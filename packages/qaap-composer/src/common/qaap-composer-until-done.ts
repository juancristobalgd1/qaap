// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Composer submits send the prompt to the harness as written, in the agent mode. Qaap adds no goal
 * loop on submit: `/goal <objective>` is the agent's own command and reaches it as plain text.
 */
export const QAAP_COMPOSER_SUBMIT_MODE_ID = 'agent';
