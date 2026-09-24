// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── File icon helper ────────────────────────────────────────────────────────
//
// Single source of truth for mapping a file path/name to a codicon class.
// Consolidates the three duplicate `transcriptFileIconClass` implementations
// that previously lived in:
//   - qaap-transcript-files-view.ts
//   - mobile-projects-transcript-messages-artifacts-ui.ts
//   - mobile-projects-transcript-messages-tool-ui.ts
//
// The mapping is O(1) via a Record lookup — no regex, no array scan.
// Special filenames (package.json, README.md, .env) get dedicated icons.

/** Result of resolving a file icon. */
export interface FileIconInfo {
    /** Codicon class, e.g. `codicon-file-code`. */
    readonly icon: string;
    /** Accessible label for screen readers, e.g. `TypeScript file`. */
    readonly label: string;
}

const DEFAULT_ICON: FileIconInfo = {
    icon: 'codicon-file',
    label: 'File',
};

// ─── Special filenames (checked before extension) ────────────────────────────

const SPECIAL_FILENAMES: Readonly<Record<string, FileIconInfo>> = {
    'package.json': { icon: 'codicon-json', label: 'npm package' },
    'package-lock.json': { icon: 'codicon-json', label: 'npm lock file' },
    'tsconfig.json': { icon: 'codicon-json', label: 'TypeScript config' },
    'readme.md': { icon: 'codicon-markdown', label: 'README' },
    '.env': { icon: 'codicon-settings-gear', label: 'Environment file' },
    '.env.local': { icon: 'codicon-settings-gear', label: 'Environment file' },
    '.env.production': { icon: 'codicon-settings-gear', label: 'Environment file' },
    '.env.development': { icon: 'codicon-settings-gear', label: 'Environment file' },
    '.gitignore': { icon: 'codicon-settings-gear', label: 'Git ignore' },
    '.eslintrc': { icon: 'codicon-settings-gear', label: 'ESLint config' },
    '.eslintrc.json': { icon: 'codicon-settings-gear', label: 'ESLint config' },
    '.prettierrc': { icon: 'codicon-settings-gear', label: 'Prettier config' },
    'dockerfile': { icon: 'codicon-file-code', label: 'Dockerfile' },
    'makefile': { icon: 'codicon-file-code', label: 'Makefile' },
};

// ─── Extension → icon mapping ────────────────────────────────────────────────

const EXTENSION_MAP: Readonly<Record<string, FileIconInfo>> = {
    // Code
    js: { icon: 'codicon-file-code', label: 'JavaScript file' },
    jsx: { icon: 'codicon-file-code', label: 'JavaScript file' },
    mjs: { icon: 'codicon-file-code', label: 'JavaScript file' },
    cjs: { icon: 'codicon-file-code', label: 'JavaScript file' },
    ts: { icon: 'codicon-file-code', label: 'TypeScript file' },
    tsx: { icon: 'codicon-file-code', label: 'TypeScript file' },
    py: { icon: 'codicon-file-code', label: 'Python file' },
    rb: { icon: 'codicon-file-code', label: 'Ruby file' },
    go: { icon: 'codicon-file-code', label: 'Go file' },
    rs: { icon: 'codicon-file-code', label: 'Rust file' },
    java: { icon: 'codicon-file-code', label: 'Java file' },
    c: { icon: 'codicon-file-code', label: 'C file' },
    cpp: { icon: 'codicon-file-code', label: 'C++ file' },
    cc: { icon: 'codicon-file-code', label: 'C++ file' },
    h: { icon: 'codicon-file-code', label: 'Header file' },
    hpp: { icon: 'codicon-file-code', label: 'Header file' },
    cs: { icon: 'codicon-file-code', label: 'C# file' },
    php: { icon: 'codicon-file-code', label: 'PHP file' },
    sh: { icon: 'codicon-file-code', label: 'Shell script' },
    bash: { icon: 'codicon-file-code', label: 'Shell script' },
    zsh: { icon: 'codicon-file-code', label: 'Shell script' },
    swift: { icon: 'codicon-file-code', label: 'Swift file' },
    kt: { icon: 'codicon-file-code', label: 'Kotlin file' },
    scala: { icon: 'codicon-file-code', label: 'Scala file' },
    lua: { icon: 'codicon-file-code', label: 'Lua file' },
    r: { icon: 'codicon-file-code', label: 'R file' },
    dart: { icon: 'codicon-file-code', label: 'Dart file' },

    // Config / data
    json: { icon: 'codicon-json', label: 'JSON file' },
    jsonc: { icon: 'codicon-json', label: 'JSON file' },
    yaml: { icon: 'codicon-settings-gear', label: 'YAML file' },
    yml: { icon: 'codicon-settings-gear', label: 'YAML file' },
    toml: { icon: 'codicon-settings-gear', label: 'TOML file' },
    xml: { icon: 'codicon-settings-gear', label: 'XML file' },
    ini: { icon: 'codicon-settings-gear', label: 'INI file' },
    env: { icon: 'codicon-settings-gear', label: 'Environment file' },
    properties: { icon: 'codicon-settings-gear', label: 'Properties file' },
    conf: { icon: 'codicon-settings-gear', label: 'Config file' },
    config: { icon: 'codicon-settings-gear', label: 'Config file' },

    // Markdown / text
    md: { icon: 'codicon-markdown', label: 'Markdown file' },
    mdx: { icon: 'codicon-markdown', label: 'Markdown file' },
    markdown: { icon: 'codicon-markdown', label: 'Markdown file' },
    txt: { icon: 'codicon-file-text', label: 'Text file' },
    rst: { icon: 'codicon-file-text', label: 'reStructuredText' },

    // Styling / markup
    css: { icon: 'codicon-symbol-color', label: 'CSS file' },
    scss: { icon: 'codicon-symbol-color', label: 'SCSS file' },
    sass: { icon: 'codicon-symbol-color', label: 'Sass file' },
    less: { icon: 'codicon-symbol-color', label: 'Less file' },
    html: { icon: 'codicon-symbol-color', label: 'HTML file' },
    htm: { icon: 'codicon-symbol-color', label: 'HTML file' },
    svg: { icon: 'codicon-file-media', label: 'SVG file' },
    vue: { icon: 'codicon-symbol-color', label: 'Vue file' },
    svelte: { icon: 'codicon-symbol-color', label: 'Svelte file' },

    // Images / media
    png: { icon: 'codicon-file-media', label: 'PNG image' },
    jpg: { icon: 'codicon-file-media', label: 'JPEG image' },
    jpeg: { icon: 'codicon-file-media', label: 'JPEG image' },
    gif: { icon: 'codicon-file-media', label: 'GIF image' },
    webp: { icon: 'codicon-file-media', label: 'WebP image' },
    ico: { icon: 'codicon-file-media', label: 'Icon file' },
    bmp: { icon: 'codicon-file-media', label: 'BMP image' },
    mp3: { icon: 'codicon-file-media', label: 'Audio file' },
    mp4: { icon: 'codicon-file-media', label: 'Video file' },
    webm: { icon: 'codicon-file-media', label: 'Video file' },
    mov: { icon: 'codicon-file-media', label: 'Video file' },

    // Documents
    pdf: { icon: 'codicon-file-pdf', label: 'PDF document' },

    // Archives
    zip: { icon: 'codicon-file-zip', label: 'ZIP archive' },
    tar: { icon: 'codicon-file-zip', label: 'Archive' },
    gz: { icon: 'codicon-file-zip', label: 'Gzip archive' },
    '7z': { icon: 'codicon-file-zip', label: '7z archive' },
    rar: { icon: 'codicon-file-zip', label: 'RAR archive' },

    // Binary
    bin: { icon: 'codicon-file-binary', label: 'Binary file' },
    exe: { icon: 'codicon-file-binary', label: 'Executable' },
    dll: { icon: 'codicon-file-binary', label: 'DLL' },
    so: { icon: 'codicon-file-binary', label: 'Shared library' },
    dylib: { icon: 'codicon-file-binary', label: 'Shared library' },
    wasm: { icon: 'codicon-file-binary', label: 'WebAssembly' },
};

/**
 * Resolve a file icon (codicon class + accessible label) from a file path or
 * filename. Special filenames like `package.json` and `README.md` are checked
 * first, then the extension. Falls back to a generic file icon.
 *
 * This is the single shared helper — all timeline/tool/diff components should
 * call this instead of duplicating the extension mapping.
 *
 * @param pathOrName A full path (e.g. `src/components/Canvas.tsx`) or just a
 *   filename (e.g. `Canvas.tsx`).
 * @returns The resolved {@link FileIconInfo}. Never undefined.
 */
export function getFileIcon(pathOrName: string): FileIconInfo {
    if (!pathOrName) {
        return DEFAULT_ICON;
    }
    const base = pathOrName.slice(pathOrName.lastIndexOf('/') + 1);
    // Check special filenames first (case-insensitive)
    const lowerBase = base.toLowerCase();
    const special = SPECIAL_FILENAMES[lowerBase];
    if (special) {
        return special;
    }
    // Then check extension
    const dotIndex = base.lastIndexOf('.');
    if (dotIndex <= 0) {
        // No extension, or hidden file like `.gitignore` (handled above)
        return DEFAULT_ICON;
    }
    const ext = base.slice(dotIndex + 1).toLowerCase();
    return EXTENSION_MAP[ext] ?? DEFAULT_ICON;
}

/**
 * Convenience: return just the codicon class for a file path/name.
 * Kept for backward compatibility with callers that only need the class.
 */
export function getFileIconClass(pathOrName: string): string {
    return getFileIcon(pathOrName).icon;
}
