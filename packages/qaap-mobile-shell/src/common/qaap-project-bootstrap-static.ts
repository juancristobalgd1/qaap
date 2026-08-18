// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Static-site support for the project bootstrap pipeline.
 *
 * Plain front-end projects (a snake game, a landing page, an exported design) ship `index.html`
 * and some assets but no `package.json` / dev script, so the Node detector skips them entirely and
 * nothing auto-starts. This module lets the detector treat such folders as a runnable project by
 * synthesizing a zero-dependency dev command: a tiny static file server written inline with
 * `node -e`. Node is always present in a Theia host, so this needs no install and works offline
 * (unlike `npx serve`) and on images without Python.
 *
 * The server prints `http://127.0.0.1:<port>/` on startup, which the existing dev-output scanner in
 * {@link QaapProjectBootstrapService} picks up to open the in-IDE preview automatically.
 */

/** File name we look for to decide a folder is a servable static site. */
export const STATIC_INDEX_FILE = 'index.html';

/**
 * Directories probed (in order) for {@link STATIC_INDEX_FILE} when the workspace root itself does
 * not contain one. Covers the conventional output / source folders of static generators and
 * hand-written sites. `'.'` (root) is always tried first by the detector.
 */
export const STATIC_ROOT_CANDIDATE_DIRS: readonly string[] = [
    'public',
    'dist',
    'build',
    'out',
    'www',
    'site',
    'src',
    'app',
    'docs',
    'html',
    'static',
    'pages',
    'web',
    'frontend',
    'landing',
    'client',
];

/** Directories skipped when scanning first-level folders for a plain `index.html`. */
export const STATIC_ROOT_SCAN_SKIP = new Set(['node_modules', '.git', '.qaap']);

const STATIC_HTML_FILE_RE = /\.html?$/i;
const STATIC_FILE_ENTRY_RE = /\.[a-zA-Z0-9]+$/;

/** True when `name` is a servable HTML file (`index.html`, `home.htm`, …). */
export function isStaticHtmlFileName(name: string | undefined): boolean {
    const base = name?.trim().split(/[\\/]/).pop() ?? '';
    return !!base && !base.startsWith('.') && STATIC_HTML_FILE_RE.test(base);
}

/**
 * True when a shell command is the inline Qaap static server or a common one-shot static host
 * (`python -m http.server`, `npx serve`). Used so HTML-only sessions auto-open Preview the same
 * way Vite/`npm run dev` sessions do.
 */
export function isQaapStaticBootstrapCommand(command: string | undefined): boolean {
    const text = command?.trim();
    if (!text) {
        return false;
    }
    return /\bQAAP_STATIC_(?:ROOT|ENTRY)\b/.test(text)
        || /\bStatic dev server running at\b/.test(text)
        || /\bpython3?\s+-m\s+http\.server\b/i.test(text)
        || /\bnpx\s+(?:--yes\s+)?(?:serve|http-server|live-server)\b/i.test(text)
        || /\b(?:http-server|live-server)\b/i.test(text);
}

/** No-op install command for static sites (there is nothing to install). */
export const STATIC_INSTALL_COMMAND = 'echo "Static site: no dependencies to install."';

/**
 * Inline Node static file server. Reads the serve root from `QAAP_STATIC_ROOT` (relative to the
 * process cwd, which is the workspace root) and the port from `PORT` (set by the bootstrap port
 * wrapper). Deliberately written without single quotes so it can be embedded inside a
 * single-quoted `node -e '...'` argument.
 */
export const STATIC_SERVER_SCRIPT = [
    'const http=require("http"),fs=require("fs"),p=require("path");',
    'const root=p.resolve(process.env.QAAP_STATIC_ROOT||".");',
    'const entryRaw=process.env.QAAP_STATIC_ENTRY||"/";',
    'const entry=entryRaw.charAt(0)==="/" ? entryRaw : "/"+entryRaw;',
    'const entryDir=entry.replace(/\\/+$/,"")||"";',
    'const entryIsFile=/\\.[A-Za-z0-9]+$/.test(entryDir);',
    'const stripSeg=entryDir.split("/").filter(Boolean)[0];',
    'const port=Number(process.env.PORT)||8080;',
    'const T={".html":"text/html",".htm":"text/html",".js":"text/javascript",".mjs":"text/javascript",',
    '".css":"text/css",".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",',
    '".gif":"image/gif",".svg":"image/svg+xml",".ico":"image/x-icon",".webp":"image/webp",".avif":"image/avif",',
    '".woff":"font/woff",".woff2":"font/woff2",".ttf":"font/ttf",".otf":"font/otf",".map":"application/json",',
    '".wasm":"application/wasm",".mp3":"audio/mpeg",".wav":"audio/wav",".mp4":"video/mp4",".txt":"text/plain"};',
    'const send=(res,code,type,body)=>{res.writeHead(code,{"content-type":type});res.end(body);};',
    'http.createServer((req,res)=>{',
    'const u=decodeURIComponent((req.url||"/").split("?")[0]);',
    'if(entryDir && (u==="/"||u==="/index.html")){res.writeHead(302,{Location:entryIsFile?entryDir:entryDir+"/"});res.end();return;}',
    'const alts=[u];',
    'if(entryDir && (u==="/"||u==="/index.html")){alts.push(entryDir+"/",entryDir+"/index.html");}',
    'if(stripSeg && u.indexOf("/"+stripSeg+"/")===0){alts.push(u.slice(stripSeg.length+1));}',
    'const finishMiss=()=>{',
    'const ext=p.extname(u).toLowerCase();',
    'if(ext && ext!==".html" && ext!==".htm"){send(res,404,"text/plain","Not found");return;}',
    'fs.readFile(p.join(root,"index.html"),(e2,idx)=>{',
    'if(e2){send(res,404,"text/plain","Not found");}else{send(res,200,"text/html",idx);}});};',
    'const tryAt=(i)=>{',
    'if(i>=alts.length){finishMiss();return;}',
    'let f=p.normalize(p.join(root,alts[i]));',
    'if(f!==root&&!f.startsWith(root+p.sep)){tryAt(i+1);return;}',
    'fs.stat(f,(e,st)=>{',
    'if(!e&&st.isDirectory()){f=p.join(f,"index.html");}',
    'fs.readFile(f,(err,buf)=>{',
    'if(err){tryAt(i+1);return;}',
    'send(res,200,T[p.extname(f).toLowerCase()]||"application/octet-stream",buf);',
    '});});};',
    'tryAt(0);',
    '}).listen(port,"127.0.0.1",()=>console.log("Static dev server running at http://127.0.0.1:"+port+entry));',
].join('');

/**
 * Nested demo folders (e.g. `docs/demo`) reference repo-root assets such as `/lib/*.js`.
 * Chrooting the static server to that folder 404s those assets. Serve the workspace root
 * and open the nested path instead. Top-level output dirs (`public`, `dist`) stay chrooted.
 */
export function shouldServeNestedStaticFromWorkspaceRoot(relDir: string): boolean {
    return relDir.includes('/') || relDir.includes('\\');
}

/** Nested static entry from a synthesized `QAAP_STATIC_ENTRY=... node -e` serve command. */
export function staticEntryPathFromDevCommand(devCommand: string | undefined): string | undefined {
    const match = /QAAP_STATIC_ENTRY="(\/[^"]*)"/.exec(devCommand ?? '');
    const entry = match?.[1];
    if (!entry || entry === '/') {
        return undefined;
    }
    if (STATIC_FILE_ENTRY_RE.test(entry)) {
        return entry;
    }
    return entry.endsWith('/') ? entry : `${entry}/`;
}

/**
 * Extra lookup paths for nested demos. `docs/demo/worker.js` imports `../lib/marked.esm.js`,
 * which the browser requests as `/docs/lib/...`. If that file is missing, retry `/lib/...`
 * at the workspace root (where `build:esbuild` writes the library bundle).
 */
export function nestedStaticUrlFallbacks(urlPath: string, entryPath: string): string[] {
    const url = urlPath.charAt(0) === '/' ? urlPath : `/${urlPath}`;
    const entryDir = (entryPath || '/').replace(/\/+$/g, '');
    const stripSeg = entryDir.split('/').filter(Boolean)[0];
    const alts = [url];
    if (entryDir && (url === '/' || url === '/index.html')) {
        alts.push(`${entryDir}/`, `${entryDir}/index.html`);
    }
    if (stripSeg && url.startsWith(`/${stripSeg}/`)) {
        const stripped = url.slice(stripSeg.length + 1);
        if (!alts.includes(stripped)) {
            alts.push(stripped);
        }
    }
    return alts;
}

/**
 * Builds the shell command that serves `relDir` (relative to the workspace root) over HTTP.
 * The port is injected by the bootstrap port wrapper via the `PORT` env var.
 */
export function buildStaticServeCommand(relDir: string, entryFile?: string): string {
    const raw = relDir && relDir.length > 0 ? relDir : '.';
    const nested = shouldServeNestedStaticFromWorkspaceRoot(raw);
    const dir = nested ? '.' : raw;
    const fileEntry = entryFile?.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    const entry = fileEntry
        ? `/${fileEntry}`
        : nested
            ? `/${raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}/`
            : '/';
    const escapedDir = dir.replace(/"/g, '\\"');
    const escapedEntry = entry.replace(/"/g, '\\"');
    return `QAAP_STATIC_ROOT="${escapedDir}" QAAP_STATIC_ENTRY="${escapedEntry}" node -e '${STATIC_SERVER_SCRIPT}'`;
}

/**
 * Builds a minimal package.json that uses the inline Node static server for its `dev` script.
 * Useful when scaffolding a brand-new empty workspace so it is immediately runnable and previewable.
 */
export function buildStaticPackageJson(name: string): string {
    return JSON.stringify({
        name: name,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
            dev: buildStaticServeCommand('.'),
        },
    }, null, 2);
}

/**
 * Builds a minimal index.html for a brand-new empty workspace.
 */
export function buildStaticIndexHtml(title: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
        body { font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; padding: 2rem; color: #333; }
        main { max-width: 720px; margin: 0 auto; }
        h1 { font-weight: 600; }
    </style>
</head>
<body>
    <main>
        <h1>${escapeHtml(title)}</h1>
        <p>Your project is ready. Start building here.</p>
    </main>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
