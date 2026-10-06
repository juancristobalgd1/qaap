'use strict';

const MOBILE_WORK_HUB_QUERY = '(max-width: 767px), (pointer: coarse)';

function escapeAttribute(value) {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Keep IDE entry assets out of the phone's unauthenticated document load.
 * Desktop writes each original link at the same parser position, preserving the
 * render-blocking stylesheet and modulepreload behavior. The login gate reads
 * the stylesheet URL from metadata after sign-in.
 */
function deferIdeAssetsOnPhones(html) {
    return html.replace(/<link\b[^>]*>/gi, linkTag => {
        const href = linkTag.match(/\bhref\s*=\s*(["'])([^"']*)\1/i);
        if (!href) {
            return linkTag;
        }

        const hrefValue = href[2];
        const isBundleStylesheet = /(?:^|\/)bundle\.css(?:[?#]|$)/i.test(hrefValue);
        const rel = linkTag.match(/\brel\s*=\s*(["'])([^"']*)\1/i);
        const isBundleModulePreload = rel
            && rel[2].toLowerCase().split(/\s+/).includes('modulepreload')
            && /(?:^|\/)bundle\.js(?:[?#]|$)/i.test(hrefValue);
        if (!isBundleStylesheet && !isBundleModulePreload) {
            return linkTag;
        }

        const desktopLink = `<script>(function(){var q=${JSON.stringify(MOBILE_WORK_HUB_QUERY)};` +
            `if(!(window.matchMedia&&window.matchMedia(q).matches)){document.write(${JSON.stringify(linkTag)})}})();</script>`;
        return isBundleStylesheet
            ? `<meta name="qaap-bundle-css" content="${escapeAttribute(hrefValue)}">\n${desktopLink}`
            : desktopLink;
    });
}

/**
 * Idempotent: the Docker build runs copy-frontend-static twice and src-gen/frontend/index.html
 * is patched in place, so a second pass sees the first pass's desktop links escaped inside a
 * document.write() string. A query never consumes a backslash, otherwise `\"` loses its escape
 * and the inline script fails with "missing ) after argument list".
 */
function patchIndexForFreshAssets(html, buildVersion) {
    let patched = html.replace(
        /\.\/bundle\.css(?:\?[^"'\\\s>]*)?/g,
        `./bundle.css?qaap-build=${buildVersion}`,
    ).replace(
        /\.\/bundle\.js(?:\?[^"'\\\s>]*)?/g,
        `./bundle.js?qaap-build=${buildVersion}`,
    ).replace(
        /\.\/qaap-login-gate\.js(?:\?[^"'\\\s>]*)?/g,
        `./qaap-login-gate.js?qaap-build=${buildVersion}`,
    );

    return deferIdeAssetsOnPhones(patched);
}

module.exports = { deferIdeAssetsOnPhones, patchIndexForFreshAssets };
