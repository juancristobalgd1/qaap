// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as http from 'http';
import { injectable } from '@theia/core/shared/inversify';
import { ElectronTokenValidator } from '@theia/core/lib/electron-node/token/electron-token-validator';
import { QAAP_TOOL_GATE_API_PATH } from '@theia/qaap-shared-core/lib/common/qaap-tool-gate-protocol';
import { QAAP_AGENT_DELEGATION_API_PATH, QAAP_AGENT_DELEGATION_ROUTES } from '../common/qaap-agent-delegation-protocol';

/**
 * The tool-gate routes, matched on the raw path (no normalization, so `..` or encoded segments never
 * match). They are called by the agent's own harness plugin (Pi, OpenCode, Codex hook), a separate
 * process without the window's cookie, and authenticate with the per-task gate token instead.
 */
const QAAP_TOOL_GATE_ELECTRON_ROUTES: ReadonlySet<string> = new Set([
    ...['health', 'arm', 'evaluate'].map(route => `${QAAP_TOOL_GATE_API_PATH}/${route}`),
    // Agent delegation: called by the MCP shim of a parent turn's harness, authenticated by its delegation token
    // (the endpoint answers 404 while the flag is off and 401 without a live token).
    ...Object.values(QAAP_AGENT_DELEGATION_ROUTES).map(route => `${QAAP_AGENT_DELEGATION_API_PATH}${route}`),
]);

/**
 * On the desktop app the Electron backend refuses every HTTP request without the window's security
 * cookie. The tool gate is reached from agent processes, so that refusal turned every gated tool call
 * into "The Qaap safety gate returned an unusable answer (HTTP 403)". Only the gate's own routes skip
 * the cookie; the gate endpoint still requires a live per-task token (401 otherwise). WebSocket
 * upgrades keep the cookie check.
 */
@injectable()
export class QaapToolGateElectronTokenValidator extends ElectronTokenValidator {

    override allowWsUpgrade(request: http.IncomingMessage): boolean {
        return super.allowRequest(request);
    }

    override allowRequest(request: http.IncomingMessage): boolean {
        return this.isToolGateRequest(request) || super.allowRequest(request);
    }

    protected isToolGateRequest(request: http.IncomingMessage): boolean {
        const method = request.method?.toUpperCase();
        if (method !== 'GET' && method !== 'POST') {
            return false;
        }
        const url = request.url ?? '';
        const queryStart = url.indexOf('?');
        const path = queryStart >= 0 ? url.slice(0, queryStart) : url;
        return QAAP_TOOL_GATE_ELECTRON_ROUTES.has(path);
    }
}
