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

module.exports = { deferBundleStylesheetOnPhones };
