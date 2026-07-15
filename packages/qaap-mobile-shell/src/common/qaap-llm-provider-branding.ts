// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentBrandTone } from './qaap-agent-branding';
import { LLM_PROVIDER_ICON_DATA_URLS } from './qaap-llm-provider-icon-assets';

export interface QaapLlmProviderBrand {
    readonly id: string;
    readonly label: string;
    readonly tone: QaapAgentBrandTone;
    readonly svg?: string;
    /** Theme-adaptive SVG pair (OpenRouter light/dark mark colors). */
    readonly svgLight?: string;
    readonly svgDark?: string;
    readonly imageUrl?: string;
    /** When set, the picker swaps light/dark PNGs with the active UI theme. */
    readonly imageUrlLight?: string;
    readonly imageUrlDark?: string;
}

let svgInstanceCounter = 0;

function uniquifySvgIds(svg: string): string {
    const suffix = String(++svgInstanceCounter);
    return svg
        .replace(/\bid="([^"]+)"/g, `id="$1-${suffix}"`)
        .replace(/url\(#([^)]+)\)/g, `url(#$1-${suffix})`)
        .replace(/xlink:href="#([^"]+)"/g, `xlink:href="#$1-${suffix}"`);
}

function monogramBrand(id: string, label: string, letter: string, bg: string, fg = '#fff'): QaapLlmProviderBrand {
    return {
        id,
        label,
        tone: 'brand',
        svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><rect width="24" height="24" rx="6" fill="${bg}"/><text x="12" y="16.5" text-anchor="middle" fill="${fg}" font-size="11" font-weight="700" font-family="system-ui,-apple-system,sans-serif">${letter}</text></svg>`,
    };
}

/** Letter(s) for monogram icons from org ids like `z-ai` → `Z`, `cohere` → `C`. */
function monogramLetterFromId(id: string): string {
    const letters = id.replace(/[^a-zA-Z0-9]+/g, '');
    if (!letters) {
        return '?';
    }
    if (letters.length <= 2) {
        return letters.toUpperCase();
    }
    return letters[0]!.toUpperCase();
}

function formatOrgBrandLabel(org: string): string {
    if (org === 'z-ai' || org === 'zai' || org === 'zhipu' || org === 'zhipuai') {
        return 'Z.ai';
    }
    if (org === 'bytedance' || org === 'byte-dance') {
        return 'ByteDance';
    }
    if (org === 'tencent') {
        return 'Tencent';
    }
    return org
        .split(/[-_]/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function pngBrand(
    id: string,
    label: string,
    tone: QaapAgentBrandTone,
    assetKey: string = id,
): QaapLlmProviderBrand {
    const imageUrl = LLM_PROVIDER_ICON_DATA_URLS[assetKey];
    if (imageUrl) {
        return { id, label, tone, imageUrl };
    }
    return monogramBrand(id, label, label.slice(0, 2).toUpperCase(), '#374151');
}

const SVG_QWEN = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><defs><linearGradient id="qwen__grad" x1="0%" x2="100%" y1="0%" y2="0%"><stop offset="0%" stop-color="#6336E7" stop-opacity=".84"/><stop offset="100%" stop-color="#6F69F7" stop-opacity=".84"/></linearGradient></defs><path fill="url(#qwen__grad)" fill-rule="nonzero" d="M12.604 1.34c.393.69.784 1.382 1.174 2.075a.18.18 0 00.157.091h5.552c.174 0 .322.11.446.327l1.454 2.57c.19.337.24.478.024.837-.26.43-.513.864-.76 1.3l-.367.658c-.106.196-.223.28-.04.512l2.652 4.637c.172.301.111.494-.043.77-.437.785-.882 1.564-1.335 2.34-.159.272-.352.375-.68.37-.777-.016-1.552-.01-2.327.016a.099.099 0 00-.081.05 575.097 575.097 0 01-2.705 4.74c-.169.293-.38.363-.725.364-.997.003-2.002.004-3.017.002a.537.537 0 01-.465-.271l-1.335-2.323a.09.09 0 00-.083-.049H4.982c-.285.03-.553-.001-.805-.092l-1.603-2.77a.543.543 0 01-.002-.54l1.207-2.12a.198.198 0 000-.197 550.951 550.951 0 01-1.875-3.272l-.79-1.395c-.16-.31-.173-.496.095-.965.465-.813.927-1.625 1.387-2.436.132-.234.304-.334.584-.335a338.3 338.3 0 012.589-.001.124.124 0 00.107-.063l2.806-4.895a.488.488 0 01.422-.246c.524-.001 1.053 0 1.583-.006L11.704 1c.341-.003.724.032.9.34zm-3.432.403a.06.06 0 00-.052.03L6.254 6.788a.157.157 0 01-.135.078H3.253c-.056 0-.07.025-.041.074l5.81 10.156c.025.042.013.062-.034.063l-2.795.015a.218.218 0 00-.2.116l-1.32 2.31c-.044.078-.021.118.068.118l5.716.008c.046 0 .08.02.104.061l1.403 2.454c.046.081.092.082.139 0l5.006-8.76.783-1.382a.055.055 0 01.096 0l1.424 2.53a.122.122 0 00.107.062l2.763-.02a.04.04 0 00.035-.02.041.041 0 000-.04l-2.9-5.086a.108.108 0 010-.113l.293-.507 1.12-1.977c.024-.041.012-.062-.035-.062H9.2c-.059 0-.073-.026-.043-.077l1.434-2.505a.107.107 0 000-.114L9.225 1.774a.06.06 0 00-.053-.031zm6.29 8.02c.046 0 .058.02.034.06l-.832 1.465-2.613 4.585a.056.056 0 01-.05.029.058.058 0 01-.05-.029L8.498 9.841c-.02-.034-.01-.052.028-.054l.216-.012 6.722-.012z"/></svg>`;

const SVG_OPENAI = `<svg fill="currentColor" fill-rule="evenodd" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"/></svg>`;

const SVG_BYTEDANCE = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><path d="M14.944 18.587l-1.704-.445V10.01l1.824-.462c1-.254 1.84-.461 1.88-.453.032 0 .056 2.235.056 4.972v4.973l-.176-.008c-.104 0-.952-.207-1.88-.446z" fill="#00C8D2" fill-rule="nonzero"/><path d="M7 16.542c0-2.736.024-4.98.064-4.98.032-.008.872.2 1.88.454l1.816.461-.016 4.05-.024 4.049-1.632.422c-.896.23-1.736.445-1.856.469L7 21.523v-4.98z" fill="#3C8CFF" fill-rule="nonzero"/><path d="M19.24 12.477c0-9.03.008-9.515.144-9.475.072.024.784.207 1.576.406.792.207 1.576.405 1.744.445l.296.08-.016 8.56-.024 8.568-1.624.414c-.888.23-1.728.437-1.856.47l-.24.055v-9.523z" fill="#78E6DC" fill-rule="nonzero"/><path d="M1 12.509c0-4.678.024-8.505.064-8.505.032 0 .872.207 1.872.454l1.824.461v7.582c0 4.16-.016 7.574-.032 7.574-.024 0-.872.215-1.88.47L1 21.013v-8.505z" fill="#325AB4" fill-rule="nonzero"/></svg>`;

const SVG_MINIMAX = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><defs><linearGradient id="minimax__grad" x1="0%" x2="100.182%" y1="50.057%" y2="50.057%"><stop offset="0%" stop-color="#E2167E"/><stop offset="100%" stop-color="#FE603C"/></linearGradient></defs><path d="M16.278 2c1.156 0 2.093.927 2.093 2.07v12.501a.74.74 0 00.744.709.74.74 0 00.743-.709V9.099a2.06 2.06 0 012.071-2.049A2.06 2.06 0 0124 9.1v6.561a.649.649 0 01-.652.645.649.649 0 01-.653-.645V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v7.472a2.037 2.037 0 01-2.048 2.026 2.037 2.037 0 01-2.048-2.026v-12.5a.785.785 0 00-.788-.753.785.785 0 00-.789.752l-.001 15.904A2.037 2.037 0 0113.441 22a2.037 2.037 0 01-2.048-2.026V18.04c0-.356.292-.645.652-.645.36 0 .652.289.652.645v1.934c0 .263.142.506.372.638.23.131.514.131.744 0a.734.734 0 00.372-.638V4.07c0-1.143.937-2.07 2.093-2.07zm-5.674 0c1.156 0 2.093.927 2.093 2.07v11.523a.648.648 0 01-.652.645.648.648 0 01-.652-.645V4.07a.785.785 0 00-.789-.78.785.785 0 00-.789.78v14.013a2.06 2.06 0 01-2.07 2.048 2.06 2.06 0 01-2.071-2.048V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v3.8a2.06 2.06 0 01-2.071 2.049A2.06 2.06 0 010 12.9v-1.378c0-.357.292-.646.652-.646.36 0 .653.29.653.646V12.9c0 .418.343.757.766.757s.766-.339.766-.757V9.099a2.06 2.06 0 012.07-2.048 2.06 2.06 0 012.071 2.048v8.984c0 .419.343.758.767.758.423 0 .766-.339.766-.758V4.07c0-1.143.937-2.07 2.093-2.07z" fill="url(#minimax__grad)" fill-rule="nonzero"/></svg>`;

const SVG_TENCENT = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><path fill="#0052D9" fill-rule="evenodd" d="M9.976 1L24 9.8l-10.587.015L10.723 23H5.489L8.18 9.8H3.244L1 5.4h8.077L9.976 1z"/></svg>`;

const SVG_MICROSOFT = `<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid"><path fill="#F1511B" d="M121.666 121.666H0V0h121.666z"/><path fill="#80CC28" d="M256 121.666H134.335V0H256z"/><path fill="#00ADEF" d="M121.663 256.002H0V134.336h121.663z"/><path fill="#FBBC09" d="M256 256.002H134.335V134.336H256z"/></svg>`;

const SVG_ZAI = `<svg viewBox="1.17 1.17 27.66 27.65" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><path fill="#2D2D2D" d="M24.51 28.51H5.49c-2.21 0-4-1.79-4-4V5.49c0-2.21 1.79-4 4-4h19.03c2.21 0 4 1.79 4 4v19.03c0 2.21-1.79 4-4 4z"/><path fill="#fff" d="M15.47 7.1l-1.3 1.85c-.2.29-.54.47-.9.47h-7.1V7.09h9.3z"/><path fill="#fff" d="M24.3 7.1 13.14 22.91H5.7L16.86 7.1z"/><path fill="#fff" d="M14.53 22.91l1.31-1.86c.2-.29.54-.47.9-.47h7.09v2.33h-9.3z"/></svg>`;

const SVG_NVIDIA = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><path fill="#74B71B" fill-rule="nonzero" d="M10.212 8.976V7.62c.127-.01.256-.017.388-.021 3.596-.117 5.957 3.184 5.957 3.184s-2.548 3.647-5.282 3.647a3.227 3.227 0 01-1.063-.175v-4.109c1.4.174 1.681.812 2.523 2.258l1.873-1.627a4.905 4.905 0 00-3.67-1.846 6.594 6.594 0 00-.729.044m0-4.476v2.025c.13-.01.259-.019.388-.024 5.002-.174 8.261 4.226 8.261 4.226s-3.743 4.69-7.643 4.69c-.338 0-.675-.031-1.007-.092v1.25c.278.038.558.057.838.057 3.629 0 6.253-1.91 8.794-4.169.421.347 2.146 1.193 2.501 1.564-2.416 2.083-8.048 3.763-11.24 3.763-.308 0-.603-.02-.894-.048V19.5H24v-15H10.21zm0 9.756v1.068c-3.356-.616-4.287-4.21-4.287-4.21a7.173 7.173 0 014.287-2.138v1.172h-.005a3.182 3.182 0 00-2.502 1.178s.615 2.276 2.507 2.931m-5.961-3.3c1.436-1.935 3.604-3.148 5.961-3.336V6.523C5.81 6.887 2 10.723 2 10.723s2.158 6.427 8.21 7.015v-1.166C5.77 16 4.25 10.958 4.25 10.958h-.002z"/></svg>`;

const SVG_OPENROUTER_LIGHT = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><path fill="#111111" fill-rule="evenodd" d="M18.654 3.87a5.087 5.087 0 110 10.174L23.7 19.09c.64.641.187 1.737-.72 1.737H8.48a8.479 8.479 0 010-16.958h10.175zM8.479 7.26a5.087 5.087 0 100 10.176 5.087 5.087 0 000-10.175z"/></svg>`;

const SVG_OPENROUTER_DARK = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><path fill="#C8FF00" fill-rule="evenodd" d="M18.654 3.87a5.087 5.087 0 110 10.174L23.7 19.09c.64.641.187 1.737-.72 1.737H8.48a8.479 8.479 0 010-16.958h10.175zM8.479 7.26a5.087 5.087 0 100 10.176 5.087 5.087 0 000-10.175z"/></svg>`;

const SVG_MISTRAL = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><path d="M3.428 3.4h3.429v3.428H3.428V3.4zm13.714 0h3.43v3.428h-3.43V3.4z" fill="gold"/><path d="M3.428 6.828h6.857v3.429H3.429V6.828zm10.286 0h6.857v3.429h-6.857V6.828z" fill="#FFAF00"/><path d="M3.428 10.258h17.144v3.428H3.428v-3.428z" fill="#FF8205"/><path d="M3.428 13.686h3.429v3.428H3.428v-3.428zm6.858 0h3.429v3.428h-3.429v-3.428zm6.856 0h3.43v3.428h-3.43v-3.428z" fill="#FA500F"/><path d="M0 17.114h10.286v3.429H0v-3.429zm13.714 0H24v3.429H13.714v-3.429z" fill="#E10500"/></svg>`;

const SVG_DEEPSEEK = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><path fill="#4D6BFE" d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 0 1-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 0 0-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 0 1-.465.137 9.597 9.597 0 0 0-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 0 0 1.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 0 1 1.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 0 1 .415-.287.302.302 0 0 1 .2.288.306.306 0 0 1-.31.307.303.303 0 0 1-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 0 1-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 0 1 .016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 0 1-.254-.078.253.253 0 0 1-.114-.358c.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z"/></svg>`;

/** LobeHub Meta (also covers Meta Llama / `meta-llama/*` slugs). Theme-aware via currentColor. */
const SVG_META = `<svg role="img" aria-hidden="true" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M6.897 4h-.024l-.031 2.615h.022c1.715 0 3.046 1.357 5.94 6.246l.175.297.012.02 1.62-2.438-.012-.019a48.763 48.763 0 00-1.098-1.716 28.01 28.01 0 00-1.175-1.629C10.413 4.932 8.812 4 6.896 4z" fill="url(#meta__g0)"></path><path d="M6.873 4C4.95 4.01 3.247 5.258 2.02 7.17a4.352 4.352 0 00-.01.017l2.254 1.231.011-.017c.718-1.083 1.61-1.774 2.568-1.785h.021L6.896 4h-.023z" fill="url(#meta__g1)"></path><path d="M2.019 7.17l-.011.017C1.2 8.447.598 9.995.274 11.664l-.005.022 2.534.6.004-.022c.27-1.467.786-2.828 1.456-3.845l.011-.017L2.02 7.17z" fill="url(#meta__g2)"></path><path d="M2.807 12.264l-2.533-.6-.005.022c-.177.918-.267 1.851-.269 2.786v.023l2.598.233v-.023a12.591 12.591 0 01.21-2.44z" fill="url(#meta__g3)"></path><path d="M2.677 15.537a5.462 5.462 0 01-.079-.813v-.022L0 14.468v.024a8.89 8.89 0 00.146 1.652l2.535-.585a4.106 4.106 0 01-.004-.022z" fill="url(#meta__g4)"></path><path d="M3.27 16.89c-.284-.31-.484-.756-.589-1.328l-.004-.021-2.535.585.004.021c.192 1.01.568 1.85 1.106 2.487l.014.017 2.018-1.745a2.106 2.106 0 01-.015-.016z" fill="url(#meta__g5)"></path><path d="M10.78 9.654c-1.528 2.35-2.454 3.825-2.454 3.825-2.035 3.2-2.739 3.917-3.871 3.917a1.545 1.545 0 01-1.186-.508l-2.017 1.744.014.017C2.01 19.518 3.058 20 4.356 20c1.963 0 3.374-.928 5.884-5.33l1.766-3.13a41.283 41.283 0 00-1.227-1.886z" fill="#0082FB"></path><path d="M13.502 5.946l-.016.016c-.4.43-.786.908-1.16 1.416.378.483.768 1.024 1.175 1.63.48-.743.928-1.345 1.367-1.807l.016-.016-1.382-1.24z" fill="url(#meta__g6)"></path><path d="M20.918 5.713C19.853 4.633 18.583 4 17.225 4c-1.432 0-2.637.787-3.723 1.944l-.016.016 1.382 1.24.016-.017c.715-.747 1.408-1.12 2.176-1.12.826 0 1.6.39 2.27 1.075l.015.016 1.589-1.425-.016-.016z" fill="#0082FB"></path><path d="M23.998 14.125c-.06-3.467-1.27-6.566-3.064-8.396l-.016-.016-1.588 1.424.015.016c1.35 1.392 2.277 3.98 2.361 6.971v.023h2.292v-.022z" fill="url(#meta__g7)"></path><path d="M23.998 14.15v-.023h-2.292v.022c.004.14.006.282.006.424 0 .815-.121 1.474-.368 1.95l-.011.022 1.708 1.782.013-.02c.62-.96.946-2.293.946-3.91 0-.083 0-.165-.002-.247z" fill="url(#meta__g8)"></path><path d="M21.344 16.52l-.011.02c-.214.402-.519.67-.917.787l.778 2.462a3.493 3.493 0 00.438-.182 3.558 3.558 0 001.366-1.218l.044-.065.012-.02-1.71-1.784z" fill="url(#meta__g9)"></path><path d="M19.92 17.393c-.262 0-.492-.039-.718-.14l-.798 2.522c.449.153.927.222 1.46.222.492 0 .943-.073 1.352-.215l-.78-2.462c-.167.05-.341.075-.517.073z" fill="url(#meta__g10)"></path><path d="M18.323 16.534l-.014-.017-1.836 1.914.016.017c.637.682 1.246 1.105 1.937 1.337l.797-2.52c-.291-.125-.573-.353-.9-.731z" fill="url(#meta__g11)"></path><path d="M18.309 16.515c-.55-.642-1.232-1.712-2.303-3.44l-1.396-2.336-.011-.02-1.62 2.438.012.02.989 1.668c.959 1.61 1.74 2.774 2.493 3.585l.016.016 1.834-1.914a2.353 2.353 0 01-.014-.017z" fill="url(#meta__g12)"></path><defs><linearGradient id="meta__g0" x1="75.897%" x2="26.312%" y1="89.199%" y2="12.194%"><stop offset=".06%" stop-color="#0867DF"></stop><stop offset="45.39%" stop-color="#0668E1"></stop><stop offset="85.91%" stop-color="#0064E0"></stop></linearGradient><linearGradient id="meta__g1" x1="21.67%" x2="97.068%" y1="75.874%" y2="23.985%"><stop offset="13.23%" stop-color="#0064DF"></stop><stop offset="99.88%" stop-color="#0064E0"></stop></linearGradient><linearGradient id="meta__g2" x1="38.263%" x2="60.895%" y1="89.127%" y2="16.131%"><stop offset="1.47%" stop-color="#0072EC"></stop><stop offset="68.81%" stop-color="#0064DF"></stop></linearGradient><linearGradient id="meta__g3" x1="47.032%" x2="52.15%" y1="90.19%" y2="15.745%"><stop offset="7.31%" stop-color="#007CF6"></stop><stop offset="99.43%" stop-color="#0072EC"></stop></linearGradient><linearGradient id="meta__g4" x1="52.155%" x2="47.591%" y1="58.301%" y2="37.004%"><stop offset="7.31%" stop-color="#007FF9"></stop><stop offset="100%" stop-color="#007CF6"></stop></linearGradient><linearGradient id="meta__g5" x1="37.689%" x2="61.961%" y1="12.502%" y2="63.624%"><stop offset="7.31%" stop-color="#007FF9"></stop><stop offset="100%" stop-color="#0082FB"></stop></linearGradient><linearGradient id="meta__g6" x1="34.808%" x2="62.313%" y1="68.859%" y2="23.174%"><stop offset="27.99%" stop-color="#007FF8"></stop><stop offset="91.41%" stop-color="#0082FB"></stop></linearGradient><linearGradient id="meta__g7" x1="43.762%" x2="57.602%" y1="6.235%" y2="98.514%"><stop offset="0%" stop-color="#0082FB"></stop><stop offset="99.95%" stop-color="#0081FA"></stop></linearGradient><linearGradient id="meta__g8" x1="60.055%" x2="39.88%" y1="4.661%" y2="69.077%"><stop offset="6.19%" stop-color="#0081FA"></stop><stop offset="100%" stop-color="#0080F9"></stop></linearGradient><linearGradient id="meta__g9" x1="30.282%" x2="61.081%" y1="59.32%" y2="33.244%"><stop offset="0%" stop-color="#027AF3"></stop><stop offset="100%" stop-color="#0080F9"></stop></linearGradient><linearGradient id="meta__g10" x1="20.433%" x2="82.112%" y1="50.001%" y2="50.001%"><stop offset="0%" stop-color="#0377EF"></stop><stop offset="99.94%" stop-color="#0279F1"></stop></linearGradient><linearGradient id="meta__g11" x1="40.303%" x2="72.394%" y1="35.298%" y2="57.811%"><stop offset=".19%" stop-color="#0471E9"></stop><stop offset="100%" stop-color="#0377EF"></stop></linearGradient><linearGradient id="meta__g12" x1="32.254%" x2="68.003%" y1="19.719%" y2="84.908%"><stop offset="27.65%" stop-color="#0867DF"></stop><stop offset="100%" stop-color="#0471E9"></stop></linearGradient></defs></svg>`;

const SVG_ALIBABA = `<svg role="img" aria-hidden="true" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M14.752 4.64h5.274C22.242 4.64 24 6.475 24 8.691V15.8a3.947 3.947 0 01-3.974 3.975h-5.274l1.299-1.835 3.822-1.222c.688-.23 1.146-.918 1.146-1.605v-5.81c0-.687-.458-1.375-1.146-1.605L16.05 6.475l-1.3-1.835zM2.98 15.111c0 .688.46 1.376 1.147 1.606l3.822 1.146 1.3 1.835H3.974A3.947 3.947 0 010 15.723V8.69c0-2.216 1.758-4.05 3.975-4.05h5.273L7.95 6.474 4.127 7.697c-.688.23-1.146.918-1.146 1.606v5.808z" fill="#FF6A00"></path><path d="M16.051 11.213H8.025v1.835h8.026v-1.835z" fill="#FF6A00"></path></svg>`;

const SVG_GEMMA = `<svg role="img" aria-hidden="true" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gemma__grad" x1="24.419%" x2="75.194%" y1="75.581%" y2="25.194%"><stop offset="0%" stop-color="#446EFF"></stop><stop offset="36.661%" stop-color="#2E96FF"></stop><stop offset="83.221%" stop-color="#B1C5FF"></stop></linearGradient></defs><path d="M12.34 5.953a8.233 8.233 0 01-.247-1.125V3.72a8.25 8.25 0 015.562 2.232H12.34zm-.69 0c.113-.373.199-.755.257-1.145V3.72a8.25 8.25 0 00-5.562 2.232h5.304zm-5.433.187h5.373a7.98 7.98 0 01-.267.696 8.41 8.41 0 01-1.76 2.65L6.216 6.14zm-.264-.187H2.977v.187h2.915a8.436 8.436 0 00-2.357 5.767H0v.186h3.535a8.436 8.436 0 002.357 5.767H2.977v.186h2.976v2.977h.187v-2.915a8.436 8.436 0 005.767 2.357V24h.186v-3.535a8.436 8.436 0 005.767-2.357v2.915h.186v-2.977h2.977v-.186h-2.915a8.436 8.436 0 002.357-5.767H24v-.186h-3.535a8.436 8.436 0 00-2.357-5.767h2.915v-.187h-2.977V2.977h-.186v2.915a8.436 8.436 0 00-5.767-2.357V0h-.186v3.535A8.436 8.436 0 006.14 5.892V2.977h-.187v2.976zm6.14 14.326a8.25 8.25 0 005.562-2.233H12.34c-.108.367-.19.743-.247 1.126v1.107zm-.186-1.087a8.015 8.015 0 00-.258-1.146H6.345a8.25 8.25 0 005.562 2.233v-1.087zm-8.186-7.285h1.107a8.23 8.23 0 001.125-.247V6.345a8.25 8.25 0 00-2.232 5.562zm1.087.186H3.72a8.25 8.25 0 002.232 5.562v-5.304a8.012 8.012 0 00-1.145-.258zm15.47-.186a8.25 8.25 0 00-2.232-5.562v5.315c.367.108.743.19 1.126.247h1.107zm-1.086.186c-.39.058-.772.144-1.146.258v5.304a8.25 8.25 0 002.233-5.562h-1.087zm-1.332 5.69V12.41a7.97 7.97 0 00-.696.267 8.409 8.409 0 00-2.65 1.76l3.346 3.346zm0-6.18v-5.45l-.012-.013h-5.451c.076.235.162.468.26.696a8.698 8.698 0 001.819 2.688 8.698 8.698 0 002.688 1.82c.228.097.46.183.696.259zM6.14 17.848V12.41c.235.078.468.167.696.267a8.403 8.403 0 012.688 1.799 8.404 8.404 0 011.799 2.688c.1.228.19.46.267.696H6.152l-.012-.012zm0-6.245V6.326l3.29 3.29a8.716 8.716 0 01-2.594 1.728 8.14 8.14 0 01-.696.259zm6.257 6.257h5.277l-3.29-3.29a8.716 8.716 0 00-1.728 2.594 8.135 8.135 0 00-.259.696zm-2.347-7.81a9.435 9.435 0 01-2.88 1.96 9.14 9.14 0 012.88 1.94 9.14 9.14 0 011.94 2.88 9.435 9.435 0 011.96-2.88 9.14 9.14 0 012.88-1.94 9.435 9.435 0 01-2.88-1.96 9.434 9.434 0 01-1.96-2.88 9.14 9.14 0 01-1.94 2.88z" fill="url(#gemma__grad)" fill-rule="evenodd"></path></svg>`;

/** LobeHub Cohere color mark. */
const SVG_COHERE = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M8.128 14.099c.592 0 1.77-.033 3.398-.703 1.897-.781 5.672-2.2 8.395-3.656 1.905-1.018 2.74-2.366 2.74-4.18A4.56 4.56 0 0018.1 1H7.549A6.55 6.55 0 001 7.55c0 3.617 2.745 6.549 7.128 6.549z" fill="#39594D"/><path fill-rule="evenodd" clip-rule="evenodd" d="M9.912 18.61a4.387 4.387 0 012.705-4.052l3.323-1.38c3.361-1.394 7.06 1.076 7.06 4.715a5.104 5.104 0 01-5.105 5.104l-3.597-.001a4.386 4.386 0 01-4.386-4.387z" fill="#D18EE2"/><path d="M4.776 14.962A3.775 3.775 0 001 18.738v.489a3.776 3.776 0 007.551 0v-.49a3.775 3.775 0 00-3.775-3.775z" fill="#FF7759"/></svg>`;


/** LobeHub Claude color mark (#D97757). */
const SVG_CLAUDE = `<svg preserveAspectRatio="xMidYMid" viewBox="0 0 256 257" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><path fill="#D97757" d="m50.228 170.321 50.357-28.257.843-2.463-.843-1.361h-2.462l-8.426-.518-28.775-.778-24.952-1.037-24.175-1.296-6.092-1.297L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.101 24.304 1.685 17.629 1.037 26.118 2.722h4.148l.583-1.685-1.426-1.037-1.101-1.037-25.147-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.758 7-7.713 9.397.649 2.398.648 9.527 7.323 20.35 15.75L94.817 91.9l3.889 3.24 1.555-1.102.195-.777-1.75-2.917-14.453-26.118-15.425-26.572-6.87-11.018-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0 82.05 1.426l4.472 3.888 6.61 15.101 10.694 23.786 16.591 32.34 4.861 9.592 2.592 8.879.973 2.722h1.685v-1.556l1.36-18.211 2.528-22.36 2.463-28.776.843-8.1 4.018-9.722 7.971-5.25 6.222 2.981 5.12 7.324-.713 4.73-3.046 19.768-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.036 7.778-8.749 9.073-9.657 5.833-4.601h11.018l8.1 12.055-3.628 12.443-11.342 14.388-9.398 12.184-13.48 18.147-8.426 14.518.778 1.166 2.01-.194 30.46-6.481 16.462-2.982 19.637-3.37 8.88 4.148.971 4.213-3.5 8.62-20.998 5.184-24.628 4.926-36.682 8.685-.454.324.519.648 16.526 1.555 7.065.389h17.304l32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.498-4.148-40.83-9.721-14-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.36 6.157-3.434 4.86-3.63-.518-23.526-17.693-9.073-7.972-20.545-17.304h-1.36v1.814l4.73 6.935 25.017 37.59 1.296 11.536-1.814 3.76-6.481 2.268-7.13-1.297-14.647-20.544-15.1-23.138-12.185-20.739-1.49.843-7.194 77.448-3.37 3.953-7.778 2.981-6.48-4.925-3.436-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.285 1.815-6.74-.13-.454-1.49.194-15.295 20.999-23.267 31.433-18.406 19.702-4.407 1.75-7.648-3.954.713-7.064 4.277-6.286 25.47-32.405 15.36-20.092 9.917-11.6-.065-1.686h-.583L44.07 198.125l-12.055 1.555-5.185-4.86.648-7.972 2.463-2.593 20.35-13.999-.064.065Z"/></svg>`;

/** LobeHub Codex color mark (section headers for Codex agent/provider). */
const SVG_CODEX = `<svg role="img" aria-hidden="true" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19.503 0H4.496A4.496 4.496 0 000 4.496v15.007A4.496 4.496 0 004.496 24h15.007A4.496 4.496 0 0024 19.503V4.496A4.496 4.496 0 0019.503 0z" fill="#fff"></path><path d="M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z" fill="url(#codex__grad)"></path><defs><linearGradient gradientUnits="userSpaceOnUse" id="codex__grad" x1="12" x2="12" y1="3" y2="21"><stop stop-color="#B1A7FF"></stop><stop offset=".5" stop-color="#7A9DFF"></stop><stop offset="1" stop-color="#3941FF"></stop></linearGradient></defs></svg>`;

/** Antigravity mark (shared with agent branding). */
const SVG_ANTIGRAVITY = `<svg viewBox="0 0 16 15" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><mask id="antigravity__mask0_111_52" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="15"><path d="M14.0777 13.984C14.945 14.6345 16.2458 14.2008 15.0533 13.0084C11.476 9.53949 12.2349 0 7.79033 0C3.34579 0 4.10461 9.53949 0.527295 13.0084C-0.773543 14.3092 0.635692 14.6345 1.50293 13.984C4.86344 11.7076 4.64663 7.69664 7.79033 7.69664C10.934 7.69664 10.7172 11.7076 14.0777 13.984Z" fill="black"/></mask><g mask="url(#antigravity__mask0_111_52)"><g filter="url(#antigravity__filter0_f_111_52)"><path d="M-0.658907 -3.2306C-0.922679 -0.906781 1.07986 1.22861 3.81388 1.53894C6.54791 1.84927 8.97811 0.217009 9.24188 -2.10681C9.50565 -4.43063 7.50312 -6.56602 4.76909 -6.87635C2.03506 -7.18667 -0.395135 -5.55442 -0.658907 -3.2306Z" fill="#FFE432"/></g><g filter="url(#antigravity__filter1_f_111_52)"><path d="M9.88233 4.36642C10.5673 7.31568 13.566 9.13902 16.5801 8.43896C19.5942 7.73891 21.4823 4.78056 20.7973 1.83131C20.1123 -1.11795 17.1136 -2.94128 14.0995 -2.24123C11.0854 -1.54118 9.19733 1.41717 9.88233 4.36642Z" fill="#FC413D"/></g><g filter="url(#antigravity__filter2_f_111_52)"><path d="M-8.05291 6.34512C-7.18736 9.38883 -3.28925 10.9473 0.653774 9.82598C4.5968 8.7047 7.09158 5.32829 6.22603 2.28458C5.36048 -0.759142 1.46236 -2.31758 -2.48066 -1.19629C-6.42368 -0.0750048 -8.91846 3.3014 -8.05291 6.34512Z" fill="#00B95C"/></g><g filter="url(#antigravity__filter3_f_111_52)"><path d="M-8.05291 6.34512C-7.18736 9.38883 -3.28925 10.9473 0.653774 9.82598C4.5968 8.7047 7.09158 5.32829 6.22603 2.28458C5.36048 -0.759142 1.46236 -2.31758 -2.48066 -1.19629C-6.42368 -0.0750048 -8.91846 3.3014 -8.05291 6.34512Z" fill="#00B95C"/></g><g filter="url(#antigravity__filter4_f_111_52)"><path d="M-4.92402 8.86746C-2.75421 11.0837 0.982691 10.9438 3.42257 8.55507C5.86246 6.1663 6.08139 2.43321 3.91158 0.216963C1.74177 -1.99928 -1.99513 -1.85942 -4.43501 0.529349C-6.87489 2.91812 -7.09383 6.65122 -4.92402 8.86746Z" fill="#00B95C"/></g><g filter="url(#antigravity__filter5_f_111_52)"><path d="M6.42819 17.2263C7.10197 20.1273 9.91278 21.953 12.7063 21.3042C15.4998 20.6553 17.2182 17.7777 16.5444 14.8767C15.8707 11.9757 13.0599 10.15 10.2663 10.7988C7.47281 11.4477 5.75441 14.3253 6.42819 17.2263Z" fill="#3186FF"/></g><g filter="url(#antigravity__filter6_f_111_52)"><path d="M1.66508 -5.94539C0.254213 -2.80254 1.7978 0.951609 5.11277 2.43973C8.42774 3.92785 12.2588 2.58642 13.6696 -0.556431C15.0805 -3.69928 13.5369 -7.45343 10.222 -8.94155C6.90699 -10.4297 3.07594 -9.08824 1.66508 -5.94539Z" fill="#FBBC04"/></g><g filter="url(#antigravity__filter7_f_111_52)"><path d="M-2.11428 24.3903C-5.52984 23.0496 0.307266 12.0177 1.75874 8.32038C3.21024 4.62304 7.15576 2.71272 10.5713 4.05357C13.9869 5.39442 18.0354 12.7796 16.5838 16.477C15.1323 20.1743 1.30129 25.7311 -2.11428 24.3903Z" fill="#3186FF"/></g><g filter="url(#antigravity__filter8_f_111_52)"><path d="M18.5814 10.6598C17.6669 11.727 15.2806 11.1828 13.2514 9.44417C11.2222 7.70556 10.3185 5.43097 11.2329 4.3637C12.1473 3.29646 14.5336 3.84069 16.5628 5.57928C18.592 7.31789 19.4958 9.59249 18.5814 10.6598Z" fill="#749BFF"/></g><g filter="url(#antigravity__filter9_f_111_52)"><path d="M11.7552 5.22715C15.5162 7.77124 19.8471 7.93838 21.4286 5.60045C23.0101 3.26253 21.2433 -0.695128 17.4823 -3.23922C13.7213 -5.78331 9.39044 -5.95044 7.80896 -3.61252C6.22747 -1.27459 7.99428 2.68306 11.7552 5.22715Z" fill="#FC413D"/></g><g filter="url(#antigravity__filter10_f_111_52)"><path d="M-0.592149 1.08896C-1.5239 3.33663 -1.21959 5.59799 0.0875457 6.13985C1.39468 6.68171 3.20966 5.29888 4.14141 3.05121C5.07316 0.803541 4.76885 -1.45782 3.46171 -1.99968C2.15458 -2.54154 0.339602 -1.15871 -0.592149 1.08896Z" fill="#FFEE48"/></g></g><defs><filter id="antigravity__filter0_f_111_52" x="-2.12817" y="-8.35998" width="12.8393" height="11.383" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur stdDeviation="0.722959" result="effect1_foregroundBlur_111_52"/></filter><filter id="antigravity__filter1_f_111_52" x="2.75168" y="-9.38089" width="25.1763" height="24.96" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur stdDeviation="3.49513" result="effect1_foregroundBlur_111_52"/></filter><filter id="antigravity__filter2_f_111_52" x="-14.1669" y="-7.50196" width="26.5068" height="23.6338" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur stdDeviation="2.97119" result="effect1_foregroundBlur_111_52"/></filter><filter id="antigravity__filter3_f_111_52" x="-14.1669" y="-7.50196" width="26.5068" height="23.6338" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur stdDeviation="2.97119" result="effect1_foregroundBlur_111_52"/></filter><filter id="antigravity__filter4_f_111_52" x="-12.3607" y="-7.29981" width="23.709" height="23.6846" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur stdDeviation="2.97119" result="effect1_foregroundBlur_111_52"/></filter><filter id="antigravity__filter5_f_111_52" x="0.634962" y="5.02095" width="21.7027" height="22.0616" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur stdDeviation="2.82351" result="effect1_foregroundBlur_111_52"/></filter><filter id="antigravity__filter6_f_111_52" x="-3.97547" y="-14.6666" width="23.2857" height="22.8313" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur stdDeviation="2.5589" result="effect1_foregroundBlur_111_52"/></filter><filter id="antigravity__filter7_f_111_52" x="-7.7407" y="-0.945408" width="29.1982" height="30.1105" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur stdDeviation="2.2852" result="effect1_foregroundBlur_111_52"/></filter><filter id="antigravity__filter8_f_111_52" x="6.78641" y="-0.27231" width="16.2415" height="15.5681" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur stdDeviation="2.04485" result="effect1_foregroundBlur_111_52"/></filter><filter id="antigravity__filter9_f_111_52" x="3.77526" y="-8.71693" width="21.687" height="19.4212" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur stdDeviation="1.72712" result="effect1_foregroundBlur_111_52"/></filter><filter id="antigravity__filter10_f_111_52" x="-5.40727" y="-6.39238" width="14.3639" height="16.9254" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur stdDeviation="2.1376" result="effect1_foregroundBlur_111_52"/></filter></defs></svg>`;

const SVG_GEMINI = `<svg viewBox="0 0 296 298" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><mask id="gemini__a" width="296" height="298" x="0" y="0" maskUnits="userSpaceOnUse" style="mask-type:alpha"><path fill="#3186FF" d="M141.201 4.886c2.282-6.17 11.042-6.071 13.184.148l5.985 17.37a184.004 184.004 0 0 0 111.257 113.049l19.304 6.997c6.143 2.227 6.156 10.91.02 13.155l-19.35 7.082a184.001 184.001 0 0 0-109.495 109.385l-7.573 20.629c-2.241 6.105-10.869 6.121-13.133.025l-7.908-21.296a184 184 0 0 0-109.02-108.658l-19.698-7.239c-6.102-2.243-6.118-10.867-.025-13.132l20.083-7.467A183.998 183.998 0 0 0 133.291 26.28l7.91-21.394Z"/></mask><g mask="url(#gemini__a)"><g filter="url(#gemini__b)"><ellipse cx="163" cy="149" fill="#3689FF" rx="196" ry="159"/></g><g filter="url(#gemini__c)"><ellipse cx="33.5" cy="142.5" fill="#F6C013" rx="68.5" ry="72.5"/></g><g filter="url(#gemini__d)"><ellipse cx="19.5" cy="148.5" fill="#F6C013" rx="68.5" ry="72.5"/></g><g filter="url(#gemini__e)"><path fill="#FA4340" d="M194 10.5C172 82.5 65.5 134.333 22.5 135L144-66l50 76.5Z"/></g><g filter="url(#gemini__f)"><path fill="#FA4340" d="M190.5-12.5C168.5 59.5 62 111.333 19 112L140.5-89l50 76.5Z"/></g><g filter="url(#gemini__g)"><path fill="#14BB69" d="M194.5 279.5C172.5 207.5 66 155.667 23 155l121.5 201 50-76.5Z"/></g><g filter="url(#gemini__h)"><path fill="#14BB69" d="M196.5 320.5C174.5 248.5 68 196.667 25 196l121.5 201 50-76.5Z"/></g></g><defs><filter id="gemini__b" width="464" height="390" x="-69" y="-46" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_69_17998" stdDeviation="18"/></filter><filter id="gemini__c" width="265" height="273" x="-99" y="6" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_69_17998" stdDeviation="32"/></filter><filter id="gemini__d" width="265" height="273" x="-113" y="12" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_69_17998" stdDeviation="32"/></filter><filter id="gemini__e" width="299.5" height="329" x="-41.5" y="-130" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_69_17998" stdDeviation="32"/></filter><filter id="gemini__f" width="299.5" height="329" x="-45" y="-153" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_69_17998" stdDeviation="32"/></filter><filter id="gemini__g" width="299.5" height="329" x="-41" y="91" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_69_17998" stdDeviation="32"/></filter><filter id="gemini__h" width="299.5" height="329" x="-39" y="132" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_69_17998" stdDeviation="32"/></filter></defs></svg>`;

const MODEL_PREFIX_BRAND_KEYS: Readonly<Record<string, string>> = {
    anthropic: 'anthropic',
    claude: 'claude',
    antigravity: 'antigravity',
    openai: 'openai',
    gpt: 'openai',
    google: 'google',
    gemini: 'gemini',
    gemma: 'gemma',
    alibaba: 'alibaba',
    alibabacloud: 'alibaba',
    tongyi: 'alibaba',
    qwen: 'qwen',
    deepseek: 'deepseek',
    nvidia: 'nvidia',
    meta: 'meta',
    'meta-llama': 'meta',
    llama: 'meta',
    mistralai: 'mistral',
    mistral: 'mistral',
    minimax: 'minimax',
    moonshotai: 'kimi',
    moonshot: 'kimi',
    cohere: 'cohere',
    huggingface: 'huggingface',
    ollama: 'ollama',
    microsoft: 'microsoft',
    phi: 'microsoft',
    'z-ai': 'z-ai',
    zai: 'z-ai',
    zhipu: 'z-ai',
    zhipuai: 'z-ai',
    glm: 'z-ai',
    tencent: 'tencent',
    bytedance: 'bytedance',
    'byte-dance': 'bytedance',
    unsloth: 'unsloth',
};

/**
 * Gateway wrappers whose leading `org/` is not the model brand
 * (e.g. OpenCode `opencode/claude-sonnet-5` → brand from `claude-sonnet-5`).
 * OpenRouter/HF keep `org/model` because the org *is* the brand.
 */
const GATEWAY_MODEL_PREFIXES: ReadonlySet<string> = new Set(['opencode']);


const VENDOR_BRAND_KEYS: Readonly<Record<string, string>> = {
    openai: 'openai',
    anthropic: 'anthropic',
    google: 'google',
    gemini: 'gemini',
    nvidia: 'nvidia',
    openrouter: 'openrouter',
    huggingface: 'huggingface',
    ollama: 'ollama',
    mistral: 'mistral',
    qwen: 'qwen',
    deepseek: 'deepseek',
    minimax: 'minimax',
    meta: 'meta',
    kimi: 'kimi',
    antigravity: 'antigravity',
    codex: 'codex',
    claude: 'claude',
};

const LLM_PROVIDER_BRAND_FACTORIES: Record<string, () => QaapLlmProviderBrand> = {
    openai: () => ({ id: 'openai', label: 'OpenAI', tone: 'light', svg: SVG_OPENAI }),
    anthropic: () => pngBrand('anthropic', 'Anthropic', 'light'),
    claude: () => ({ id: 'claude', label: 'Claude', tone: 'brand', svg: SVG_CLAUDE }),
    antigravity: () => ({ id: 'antigravity', label: 'Antigravity', tone: 'brand', svg: uniquifySvgIds(SVG_ANTIGRAVITY) }),
    codex: () => ({ id: 'codex', label: 'Codex', tone: 'brand', svg: uniquifySvgIds(SVG_CODEX) }),
    google: () => ({ id: 'google', label: 'Google', tone: 'light', svg: uniquifySvgIds(SVG_GEMINI) }),
    gemini: () => ({ id: 'gemini', label: 'Gemini', tone: 'light', svg: uniquifySvgIds(SVG_GEMINI) }),
    nvidia: () => ({ id: 'nvidia', label: 'NVIDIA', tone: 'brand', svg: SVG_NVIDIA }),
    qwen: () => ({ id: 'qwen', label: 'Qwen', tone: 'brand', svg: uniquifySvgIds(SVG_QWEN) }),
    deepseek: () => ({ id: 'deepseek', label: 'DeepSeek', tone: 'brand', svg: SVG_DEEPSEEK }),
    mistral: () => ({ id: 'mistral', label: 'Mistral', tone: 'brand', svg: SVG_MISTRAL }),
    minimax: () => ({ id: 'minimax', label: 'MiniMax', tone: 'brand', svg: uniquifySvgIds(SVG_MINIMAX) }),
    bytedance: () => ({ id: 'bytedance', label: 'ByteDance', tone: 'brand', svg: SVG_BYTEDANCE }),
    openrouter: () => ({ id: 'openrouter', label: 'OpenRouter', tone: 'brand', svgLight: SVG_OPENROUTER_LIGHT, svgDark: SVG_OPENROUTER_DARK }),
    huggingface: () => pngBrand('huggingface', 'Hugging Face', 'brand'),
    ollama: () => pngBrand('ollama', 'Ollama', 'light'),
    meta: () => ({ id: 'meta', label: 'Meta', tone: 'brand', svg: uniquifySvgIds(SVG_META) }),
    alibaba: () => ({ id: 'alibaba', label: 'Alibaba', tone: 'brand', svg: SVG_ALIBABA }),
    gemma: () => ({ id: 'gemma', label: 'Gemma', tone: 'brand', svg: uniquifySvgIds(SVG_GEMMA) }),
    microsoft: () => ({ id: 'microsoft', label: 'Microsoft', tone: 'brand', svg: SVG_MICROSOFT }),
    kimi: () => pngBrand('kimi', 'Kimi', 'light', 'moonshot'),
    cohere: () => ({ id: 'cohere', label: 'Cohere', tone: 'brand', svg: SVG_COHERE }),
    unsloth: () => pngBrand('unsloth', 'Unsloth', 'brand'),
    'z-ai': () => ({ id: 'z-ai', label: 'Z.ai', tone: 'brand', svg: SVG_ZAI }),
    tencent: () => ({ id: 'tencent', label: 'Tencent', tone: 'brand', svg: SVG_TENCENT }),
};

function normalizeToken(value: string | undefined): string {
    return value?.trim().toLowerCase() ?? '';
}

function brandKeyFromModelSlug(modelId: string): string | undefined {
    const trimmed = modelId.trim();
    if (!trimmed) {
        return undefined;
    }
    const slash = trimmed.indexOf('/');
    const prefix = slash > 0 ? trimmed.slice(0, slash) : trimmed;
    const normalized = prefix.toLowerCase();
    // Strip gateway wrappers and brand from the underlying model identity.
    if (slash > 0 && GATEWAY_MODEL_PREFIXES.has(normalized)) {
        return brandKeyFromModelSlug(trimmed.slice(slash + 1));
    }
    const lowerId = trimmed.toLowerCase();
    // Prefer model-family brands over gateway orgs (google/gemma-… → Gemma, anthropic/claude-… → Claude).
    if (lowerId.includes('gemma')) {
        return 'gemma';
    }
    if (lowerId.includes('claude')) {
        return 'claude';
    }
    // Bare GPT / ChatGPT / o-series ids (often under Codex sections) → OpenAI.
    if (lowerId.includes('gpt') || normalized === 'chatgpt' || /^o[1-9]([_-]|$)/.test(normalized)) {
        return 'openai';
    }
    if (MODEL_PREFIX_BRAND_KEYS[normalized]) {
        return MODEL_PREFIX_BRAND_KEYS[normalized];
    }
    if (normalized.includes('qwen')) {
        return 'qwen';
    }
    if (normalized.includes('deepseek')) {
        return 'deepseek';
    }
    if (normalized.includes('gemini') || normalized.includes('google')) {
        return 'gemini';
    }
    if (normalized.includes('glm') || normalized.includes('zhipu')) {
        return 'z-ai';
    }
    if (normalized.includes('anthropic')) {
        return 'anthropic';
    }
    if (normalized.includes('antigravity')) {
        return 'antigravity';
    }
    if (normalized.includes('llama') || normalized.includes('meta')) {
        return 'meta';
    }
    if (normalized.includes('mistral')) {
        return 'mistral';
    }
    if (normalized.includes('minimax')) {
        return 'minimax';
    }
    if (normalized.includes('bytedance') || normalized.includes('byte-dance')) {
        return 'bytedance';
    }
    if (normalized.includes('alibaba') || normalized.includes('tongyi')) {
        return 'alibaba';
    }
    if (normalized.includes('kimi') || normalized.includes('moonshot')) {
        return 'kimi';
    }
    if (normalized.includes('unsloth')) {
        return 'unsloth';
    }
    // OpenRouter-style `org/model`: use the owning org even without a curated icon.
    if (slash > 0) {
        return normalized;
    }
    return undefined;
}

/**
 * Resolve a stable brand id for LLM picker icons.
 * Prefer the model/org brand from the slug (e.g. HF `meta-llama/…` → Meta) and fall back to the BYOK vendor.
 */
export function resolveLlmProviderBrandKey(vendor: string | undefined, modelId?: string): string | undefined {
    const fromSlug = modelId ? brandKeyFromModelSlug(modelId) : undefined;
    if (fromSlug) {
        return fromSlug;
    }

    const normalizedVendor = normalizeToken(vendor);
    if (VENDOR_BRAND_KEYS[normalizedVendor]) {
        return VENDOR_BRAND_KEYS[normalizedVendor];
    }
    if (normalizedVendor === 'unknown') {
        return undefined;
    }
    return normalizedVendor || undefined;
}

export function resolveLlmProviderBrand(vendor: string | undefined, modelId?: string): QaapLlmProviderBrand | undefined {
    const brandKey = resolveLlmProviderBrandKey(vendor, modelId);
    if (!brandKey) {
        return undefined;
    }
    const factory = LLM_PROVIDER_BRAND_FACTORIES[brandKey];
    if (!factory) {
        return monogramBrand(brandKey, formatOrgBrandLabel(brandKey), monogramLetterFromId(brandKey), '#374151');
    }
    return factory();
}

/** DOM icon for QAIQ model picker rows and provider section headers. */
export function createLlmProviderIcon(
    vendor: string | undefined,
    modelId: string | undefined,
    size: 'sm' | 'md' = 'sm',
): HTMLElement | undefined {
    const brand = resolveLlmProviderBrand(vendor, modelId);
    if (!brand) {
        return undefined;
    }
    const host = document.createElement('span');
    host.className = `theia-qaap-agent-brand-icon theia-qaap-llm-provider-icon theia-mod-${size} theia-mod-tone-${brand.tone}`;
    host.setAttribute('aria-hidden', 'true');
    if (brand.svgLight && brand.svgDark) {
        host.classList.add('theia-mod-theme-adaptive');
        const lightHost = document.createElement('span');
        lightHost.className = 'theia-mod-llm-icon-for-light';
        lightHost.innerHTML = brand.svgLight;
        const darkHost = document.createElement('span');
        darkHost.className = 'theia-mod-llm-icon-for-dark';
        darkHost.innerHTML = brand.svgDark;
        host.append(lightHost, darkHost);
    } else if (brand.imageUrlLight && brand.imageUrlDark) {
        host.classList.add('theia-mod-theme-adaptive');
        const lightImg = document.createElement('img');
        lightImg.src = brand.imageUrlLight;
        lightImg.alt = '';
        lightImg.draggable = false;
        lightImg.className = 'theia-mod-llm-icon-for-light';
        const darkImg = document.createElement('img');
        darkImg.src = brand.imageUrlDark;
        darkImg.alt = '';
        darkImg.draggable = false;
        darkImg.className = 'theia-mod-llm-icon-for-dark';
        host.append(lightImg, darkImg);
    } else if (brand.imageUrl) {
        const img = document.createElement('img');
        img.src = brand.imageUrl;
        img.alt = '';
        img.draggable = false;
        host.append(img);
    } else if (brand.svg) {
        host.innerHTML = brand.svg;
    }
    return host;
}

export function appendLlmProviderIcon(
    parent: HTMLElement,
    vendor: string | undefined,
    modelId: string | undefined,
    size: 'sm' | 'md' = 'sm',
): HTMLElement | undefined {
    const icon = createLlmProviderIcon(vendor, modelId, size);
    if (icon) {
        parent.append(icon);
    }
    return icon;
}
