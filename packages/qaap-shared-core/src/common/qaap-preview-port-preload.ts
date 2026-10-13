// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// npm lifecycle scripts can contain their own `PORT=8080` assignment, which overrides a plain
// `PORT=8081 npm run dev` prefix. Every supported Qaap runtime uses Node 22+, so preload a tiny,
// dependency-free module before application code runs. Framework CLIs need a targeted argv patch:
// forcing PORT in *every* child poisoned multi-process scripts such as `concurrently "vite" "node
// bridge.js"` — the bridge inherited the preview port while Vite's config still selected :8080.
// The targeted preload reaches a nested Vite/Next/Astro/Remix executable without touching sibling
// services. Generic/CRA scripts keep the legacy PORT restore for inline `PORT=… node …` commands.
// `theia start` ignores PORT and defaults to :3000 (often hardcoded deeper in the script, e.g. qaap's
// own start:browser), so its `--port` value is replaced by the allocated preview port.
const FORCE_NODE_PREVIEW_PORT_SOURCE = [
    'const p=process.env.QAAP_PREVIEW_PORT,a=process.argv,'
        + "e=(a[1]||'').replaceAll('\\\\','/').split('/').pop()||''",
    'if(p){process.env.PORT=p;'
        + "if(/^(theia|theia\\.js)$/.test(e)&&a[2]==='start'){let s=false;"
        + "for(let i=3;i<a.length;i++){if(a[i]==='--port'&&i+1<a.length){a[i+1]=p;s=true}"
        + "else if(String(a[i]).startsWith('--port=')){a[i]='--port='+p;s=true}}"
        + "if(!s){a.push('--port',p)}}}",
].join(';');
const FORCE_FRAMEWORK_PREVIEW_PORT_SOURCE = [
    'const p=process.env.QAAP_PREVIEW_PORT,a=process.argv,'
        + "e=(a[1]||'').replaceAll('\\\\','/').split('/').pop()||'',"
        + "hasPort=a.some(v=>v==='--port'||v==='-p'||v.startsWith('--port=')),"
        + "hasStrict=a.some(v=>v==='--strictPort'||v.startsWith('--strictPort=')),"
        + "hasHost=a.some(v=>v==='--host'||v.startsWith('--host=')),"
        + 'isVite=/^(vite|vite\\.js|astro|astro\\.js)$/.test(e)',
    'if(p){if(isVite){'
        + "for(let i=a.length-1;i>=2;i--){if(a[i]==='--open'||String(a[i]).startsWith('--open='))a.splice(i,1)}"
        + 'if(!hasPort){a.push(\'--port\',p)}if(!hasStrict){a.push(\'--strictPort\')}'
        + 'if(!hasHost){a.push(\'--host\',\'127.0.0.1\')}'
        + '}else if(!hasPort){if(/^(next|next\\.js)$/.test(e)){a.push(\'-p\',p)}'
        + 'else if(/^(remix|remix\\.js)$/.test(e)){a.push(\'--port\',p)}}}',
].join(';');

/**
 * `NODE_OPTIONS` flag preloading the port patch: every Node process reading `QAAP_PREVIEW_PORT`
 * then binds that port. `framework` selects the targeted Vite/Astro/Next/Remix argv patch;
 * otherwise the generic `PORT`/`theia start` restore.
 */
export function qaapPreviewPortNodeImportFlag(framework: boolean): string {
    const source = framework ? FORCE_FRAMEWORK_PREVIEW_PORT_SOURCE : FORCE_NODE_PREVIEW_PORT_SOURCE;
    return `--import=data:text/javascript;base64,${btoa(source)}`;
}
