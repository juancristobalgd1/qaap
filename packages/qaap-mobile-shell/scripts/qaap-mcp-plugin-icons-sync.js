// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

const fs = require('fs');
const path = require('path');

const resourcesDir = path.join(__dirname, '../resources/mcp-plugins');
const outFile = path.join(__dirname, '../src/common/qaap-mcp-plugin-icon-assets.ts');

const checkOnly = process.argv.includes('--check');

/** Maps installed MCP server slug to bundled icon asset basename. */
const SLUG_TO_ASSET_KEY = {
    'brave-search': 'brave',
};

function resolveAssetKey(fileName) {
    return fileName.slice(0, -4);
}

function escapeTsString(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, '');
}

function minifySvg(svg) {
    return svg
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\s+/g, ' ')
        .replace(/>\s+</g, '><')
        .trim();
}

function buildIconAssetsSource() {
    const svgs = {};
    for (const fileName of fs.readdirSync(resourcesDir).sort()) {
        if (!fileName.endsWith('.svg')) {
            continue;
        }
        const assetKey = resolveAssetKey(fileName);
        const raw = fs.readFileSync(path.join(resourcesDir, fileName), 'utf8');
        svgs[assetKey] = minifySvg(raw);
    }

    const slugToAssetKey = {};
    for (const assetKey of Object.keys(svgs)) {
        slugToAssetKey[assetKey] = assetKey;
    }
    for (const [slug, assetKey] of Object.entries(SLUG_TO_ASSET_KEY)) {
        if (svgs[assetKey]) {
            slugToAssetKey[slug] = assetKey;
        }
    }

    const svgLines = Object.entries(svgs).map(([key, value]) => `    '${key}': '${escapeTsString(value)}',`);
    const slugLines = Object.entries(slugToAssetKey).map(([slug, assetKey]) => `    '${slug}': '${assetKey}',`);

    return {
        source: `// Auto-generated from resources/mcp-plugins/*.svg — re-run: npm run sync:mcp-plugin-icons --prefix packages/qaap-mobile-shell

export const MCP_PLUGIN_ICON_SVGS: Readonly<Record<string, string>> = {
${svgLines.join('\n')}
};

export const MCP_PLUGIN_ICON_SLUG_TO_ASSET_KEY: Readonly<Record<string, string>> = {
${slugLines.join('\n')}
};
`,
        iconCount: Object.keys(svgs).length,
    };
}

const { source, iconCount } = buildIconAssetsSource();

if (checkOnly) {
    const existing = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    if (existing !== source) {
        console.error(`MCP plugin icon assets out of sync: ${path.relative(process.cwd(), outFile)}`);
        console.error('Run: npm run sync:mcp-plugin-icons --prefix packages/qaap-mobile-shell');
        process.exit(1);
    }
    console.log(`MCP plugin icon assets in sync (${iconCount} icons)`);
    process.exit(0);
}

fs.writeFileSync(outFile, source);
console.log(`Wrote ${iconCount} MCP plugin icons to ${path.relative(process.cwd(), outFile)}`);
