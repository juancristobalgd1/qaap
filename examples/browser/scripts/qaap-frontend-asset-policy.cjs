'use strict';

const MOBILE_WORK_HUB_QUERY = '(max-width: 767px), (pointer: coarse)';

function escapeAttribute(value) {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Keep the entry stylesheet out of the phone's unauthenticated document load.
 * Desktop writes the original link at the same parser position, preserving its
 * render-blocking behavior. The login gate reads the meta URL after sign-in.
 */
function deferBundleStylesheetOnPhones(html) {
    return html.replace(/<link\b[^>]*>/gi, linkTag => {
        const href = linkTag.match(/\bhref\s*=\s*(["'])([^"']*bundle\.css(?:\?[^"']*)?)\1/i);
        if (!href || !/(?:^|\/)bundle\.css(?:\?|$)/i.test(href[2])) {
            return linkTag;
        }

        const cssUrl = href[2];
        return `<meta name="qaap-bundle-css" content="${escapeAttribute(cssUrl)}">\n` +
            `<script>(function(){var q=${JSON.stringify(MOBILE_WORK_HUB_QUERY)};` +
            `if(!(window.matchMedia&&window.matchMedia(q).matches)){document.write(${JSON.stringify(linkTag)})}})();</script>`;
    });
}

function patchIndexForFreshAssets(html, buildVersion) {
    let patched = html.replace(
        /\.\/bundle\.css(?:\?[^"'\s>]*)?/g,
        `./bundle.css?qaap-build=${buildVersion}`,
    ).replace(
        /\.\/bundle\.js(?:\?[^"'\s>]*)?/g,
        `./bundle.js?qaap-build=${buildVersion}`,
    ).replace(
        /\.\/qaap-login-gate\.js(?:\?[^"'\s>]*)?/g,
        `./qaap-login-gate.js?qaap-build=${buildVersion}`,
    );

    // The login gate chooses when bundle.js starts. Any parser-discovered preload
    // bypasses that choice and downloads the full workbench before sign-in.
    patched = patched.replace(/<link\b[^>]*>/gi, linkTag => {
        const rel = linkTag.match(/\brel\s*=\s*(["'])([^"']*)\1/i);
        const href = linkTag.match(/\bhref\s*=\s*(["'])([^"']*)\1/i);
        const isModulePreload = rel && rel[2].toLowerCase().split(/\s+/).includes('modulepreload');
        const isBundle = href && /(?:^|\/)bundle\.js(?:\?|$)/i.test(href[2]);
        return isModulePreload && isBundle ? '' : linkTag;
    });

    return deferBundleStylesheetOnPhones(patched);
}

module.exports = { deferBundleStylesheetOnPhones, patchIndexForFreshAssets };
