// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as React from '@theia/core/shared/react';
import { HoverService } from '@theia/core/lib/browser';
import { nls } from '@theia/core/lib/common/nls';
import {
    qaapGithubMcpConnectionNeedsAction,
    QaapGithubMcpConnectionSnapshot,
    QaapGithubMcpConnectionState
} from '@theia/qaap-shared-core/lib/browser/qaap-github-mcp-connection-state';

export const QAAP_GITHUB_MCP_CONNECT_CHIP_CLASS = 'qaap-github-mcp-connect-chip';

/** Label and tooltip of the chip for a snapshot, or `undefined` when no chip is shown. */
export function qaapGithubMcpConnectChipText(snapshot: QaapGithubMcpConnectionSnapshot): { label: string; tooltip: string } | undefined {
    if (!qaapGithubMcpConnectionNeedsAction(snapshot.kind)) {
        return undefined;
    }
    switch (snapshot.kind) {
        case 'untrusted':
            return {
                label: nls.localize('qaap/githubMcpChip/trust', 'Trust workspace for GitHub'),
                tooltip: nls.localize('qaap/githubMcpChip/trustTooltip', 'GitHub tools stay off in an untrusted workspace. Trust this workspace to use them.'),
            };
        case 'auth-required':
            return {
                label: nls.localize('qaap/githubMcpChip/reconnect', 'Reconnect GitHub'),
                tooltip: snapshot.desktop
                    ? nls.localize('qaap/githubMcpChip/reconnectTooltipDesktop', 'GitHub rejected the token. Connect GitHub again, or run `gh auth login`.')
                    : nls.localize('qaap/githubMcpChip/reconnectTooltip', 'GitHub rejected the token. Connect GitHub again.'),
            };
        default:
            return {
                label: nls.localize('qaap/githubMcpChip/connect', 'Connect GitHub'),
                tooltip: snapshot.desktop
                    ? nls.localize('qaap/githubMcpChip/connectTooltipDesktop', 'Connect GitHub to use GitHub tools, or run `gh auth login`.')
                    : nls.localize('qaap/githubMcpChip/connectTooltip', 'Connect GitHub to use GitHub tools.'),
            };
    }
}

/**
 * "Connect GitHub" chip of the chat input. Shown only while the managed GitHub MCP server needs a user action
 * (no credential, a refused token, an untrusted workspace); it follows the connection state as it changes.
 */
export const QaapGithubMcpConnectChip: React.FunctionComponent<{
    state: QaapGithubMcpConnectionState;
    hoverService: HoverService;
}> = ({ state, hoverService }) => {
    const [snapshot, setSnapshot] = React.useState(state.snapshot);
    React.useEffect(() => {
        setSnapshot(state.snapshot);
        const listener = state.onDidChange(next => setSnapshot(next));
        return () => listener.dispose();
    }, [state]);
    const text = qaapGithubMcpConnectChipText(snapshot);
    if (!text) {
        return null; // eslint-disable-line no-null/no-null
    }
    return (
        <button
            type="button"
            className={`${QAAP_GITHUB_MCP_CONNECT_CHIP_CLASS} ${QAAP_GITHUB_MCP_CONNECT_CHIP_CLASS}--${snapshot.kind}`}
            aria-label={text.tooltip}
            onClick={() => state.connect()}
            onMouseEnter={event => hoverService.requestHover({ content: text.tooltip, target: event.currentTarget, position: 'top' })}
        >
            <span className={`codicon ${snapshot.kind === 'untrusted' ? 'codicon-shield' : 'codicon-github'}`} aria-hidden="true" />
            <span>{text.label}</span>
        </button>
    );
};
