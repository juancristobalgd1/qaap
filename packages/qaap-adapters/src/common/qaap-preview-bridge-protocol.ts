// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const QAAP_PREVIEW_BRIDGE_READY_TYPE = 'qaap-preview:bridge-ready';
export const QAAP_PREVIEW_BRIDGE_INIT_TYPE = 'qaap-preview:bridge-init';

/**
 * Tiny bootstrap injected by the backend proxy into preview HTML. It never exposes DOM data: it
 * accepts the actual inspector bridge exactly once, and only from the configured Qaap parent.
 */
export function buildQaapPreviewBridgeLoader(parentOrigin: string): string {
    const origin = JSON.stringify(parentOrigin);
    const readyType = JSON.stringify(QAAP_PREVIEW_BRIDGE_READY_TYPE);
    const initType = JSON.stringify(QAAP_PREVIEW_BRIDGE_INIT_TYPE);
    return `<script data-qaap-preview-bridge-loader>(function(){
var parentOrigin=${origin};
if(!parentOrigin||window.parent===window){return;}
function init(event){
  if(event.source!==window.parent||event.origin!==parentOrigin){return;}
  var data=event.data;
  if(!data||data.type!==${initType}||typeof data.channelId!=='string'||typeof data.script!=='string'){return;}
  window.removeEventListener('message',init);
  var script=document.createElement('script');
  script.textContent=data.script;
  (document.documentElement||document.head||document.body).appendChild(script);
  script.remove();
}
window.addEventListener('message',init);
window.parent.postMessage({type:${readyType}},parentOrigin);
})();</script>`;
}

/**
 * The loader script for `html`, or `''` when the document is empty or already has one. Lets the
 * proxy insert the loader together with its other preview scripts in a single pass.
 */
export function buildQaapPreviewBridgeLoaderScript(html: string, parentOrigin: string): string {
    return !html || html.includes('data-qaap-preview-bridge-loader') ? '' : buildQaapPreviewBridgeLoader(parentOrigin);
}

export function injectQaapPreviewBridgeLoader(
    html: string,
    parentOrigin: string,
    placement: 'head' | 'body-end' = 'head',
): string {
    const loader = buildQaapPreviewBridgeLoaderScript(html, parentOrigin);
    if (!loader) {
        return html;
    }
    if (placement === 'body-end') {
        const bodyClose = /<\/body\s*>/i;
        if (bodyClose.test(html)) {
            return html.replace(bodyClose, `${loader}</body>`);
        }
        return `${html}${loader}`;
    }
    const headClose = /<\/head\s*>/i;
    if (headClose.test(html)) {
        return html.replace(headClose, `${loader}</head>`);
    }
    const bodyOpen = /<body(?:\s[^>]*)?>/i;
    if (bodyOpen.test(html)) {
        return html.replace(bodyOpen, match => `${match}${loader}`);
    }
    return `${loader}${html}`;
}
