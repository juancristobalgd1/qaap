'use strict';

const MOBILE_WORK_HUB_QUERY = '(max-width: 767px), (pointer: coarse)';

function escapeAttribute(value) {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function updateMeta(html, name, content) {
    const meta = `<meta name="${name}" content="${escapeAttribute(content)}">`;
    const pattern = new RegExp(`<meta\\b(?=[^>]*\\bname\\s*=\\s*(['\"])${name}\\1)[^>]*>`, 'i');
    if (pattern.test(html)) {
        return html.replace(pattern, meta);
    }
    return html.replace('</head>', `  ${meta}\n</head>`);
}

/**
 * Keep IDE entry assets out of the phone's unauthenticated document load.
 * Desktop writes each original link at the same parser position, preserving the
 * render-blocking stylesheet and modulepreload behavior. The login gate reads
 * the entry JS/CSS URLs from metadata after sign-in.
 */
function deferIdeAssetsOnPhones(html, buildVersion, entryAssets) {
    let patched = html;
    if (!patched.includes('data-qaap-desktop-asset')) {
        patched = patched.replace(/<link\b[^>]*>/gi, linkTag => {
            const href = linkTag.match(/\bhref\s*=\s*(["'])([^"']*)\1/i);
            if (!href) {
                return linkTag;
            }

            const hrefValue = href[2];
            const isBundleStylesheet = /(?:^|\/)bundle(?:-[A-Z0-9]+)?\.css(?:[?#]|$)/i.test(hrefValue);
            const rel = linkTag.match(/\brel\s*=\s*(["'])([^"']*)\1/i);
            const isBundleModulePreload = rel
                && rel[2].toLowerCase().split(/\s+/).includes('modulepreload')
                && /(?:^|\/)bundle(?:-[A-Z0-9]+)?\.js(?:[?#]|$)/i.test(hrefValue);
            if (!isBundleStylesheet && !isBundleModulePreload) {
                return linkTag;
            }

            const desktopLink = `<script data-qaap-desktop-asset="true">(function(){var q=${JSON.stringify(MOBILE_WORK_HUB_QUERY)};` +
                `if(!(window.matchMedia&&window.matchMedia(q).matches)){document.write(${JSON.stringify(linkTag)})}})();</script>`;
            return isBundleStylesheet
                ? `<meta name="qaap-bundle-css" content="${escapeAttribute(hrefValue)}">\n${desktopLink}`
                : desktopLink;
        });
    }

    const version = buildVersion ? `?qaap-build=${encodeURIComponent(buildVersion)}` : '';
    patched = updateMeta(patched, 'qaap-bundle-css', entryAssets?.stylesheet || `./bundle.css${version}`);
    patched = updateMeta(patched, 'qaap-bundle-js', entryAssets?.javascript || `./bundle.js${version}`);
    return patched;
}

function patchIndexForFreshAssets(html, buildVersion, entryAssets) {
    const version = buildVersion ? `?qaap-build=${encodeURIComponent(buildVersion)}` : '';
    let patched = html.replace(
        /\.\/bundle(?:-[A-Z0-9]+)?\.css(?:\?[^"'\s>]*)?/g,
        entryAssets?.stylesheet || `./bundle.css${version}`,
    ).replace(
        /\.\/bundle(?:-[A-Z0-9]+)?\.js(?:\?[^"'\s>]*)?/g,
        entryAssets?.javascript || `./bundle.js${version}`,
    ).replace(
        /\.\/qaap-login-gate\.js(?:\?[^"'\s>]*)?/g,
        `./qaap-login-gate.js?qaap-build=${buildVersion}`,
    );

    return deferIdeAssetsOnPhones(patched, buildVersion, entryAssets);
}

module.exports = { deferIdeAssetsOnPhones, patchIndexForFreshAssets };
