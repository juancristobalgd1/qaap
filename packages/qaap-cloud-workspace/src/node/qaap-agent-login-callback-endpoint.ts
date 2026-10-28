// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import {
    QAAP_AGENT_LOGIN_CALLBACK_CHANNEL,
    QAAP_AGENT_LOGIN_CALLBACK_PATH,
    isQaapAgentLoginCallbackNonce,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-login-callback';

/**
 * Landing page for a bridged agent sign-in redirect (see `qaap-agent-login-callback.ts`). It holds
 * no state and no secret: the page broadcasts its own query to the login dialog of the same
 * origin, which forwards it to the CLI waiting in the workspace terminal. The provider's redirect
 * is a top-level GET, so the `SameSite=Lax` session cookie is attached and the route stays
 * signed-in only.
 */
@injectable()
export class QaapAgentLoginCallbackEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(`${QAAP_AGENT_LOGIN_CALLBACK_PATH}/:nonce`, (req, res) => this.handle(req, res));
    }

    protected handle(req: Request, res: Response): void {
        if (this.auth.authenticate(req).kind === 'unauthorized') {
            res.status(401).type('text').send('Sign in to Qaap, then paste this page address into the sign-in dialog.');
            return;
        }
        const nonce = req.params.nonce;
        if (!isQaapAgentLoginCallbackNonce(nonce)) {
            res.status(404).end();
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'");
        res.type('html').send(this.renderPage(nonce));
    }

    protected renderPage(nonce: string): string {
        // The nonce matched a strict [A-Za-z0-9-] pattern, so JSON is safe inside the script.
        const payload = JSON.stringify({ channel: QAAP_AGENT_LOGIN_CALLBACK_CHANNEL, nonce });
        return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Qaap sign-in</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 15px/1.5 system-ui, sans-serif; background: Canvas; color: CanvasText; }
main { max-width: 420px; padding: 24px; text-align: center; }
h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
p { margin: 0; opacity: 0.75; }
</style>
</head>
<body>
<main>
<h1 id="title">Finishing sign-in…</h1>
<p id="detail">Return to Qaap to continue.</p>
</main>
<script>
(function () {
    var config = ${payload};
    var title = document.getElementById('title');
    var detail = document.getElementById('detail');
    try {
        var channel = new BroadcastChannel(config.channel);
        channel.postMessage({ nonce: config.nonce, search: window.location.search });
        channel.close();
        title.textContent = 'Signed in';
        detail.textContent = 'You can close this tab and return to Qaap.';
        setTimeout(function () { window.close(); }, 800);
    } catch (error) {
        title.textContent = 'Could not reach Qaap';
        detail.textContent = 'Copy this page address and paste it into the Qaap sign-in dialog.';
    }
})();
</script>
</body>
</html>
`;
    }
}
