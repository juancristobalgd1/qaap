// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Official Grok Build mark (black glyph on transparent) — shared by agent + LLM picker icons. */
const GROK_ICON_LIGHT_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA3UlEQVR4AaTRAQ6CQAwEwNOPiS9TXyb+zA5eTe/UxATC0pbubntwbDuvPQZLzF5+GWjeg5C4Rg4Rtlsf1m8GiIQI2OIlklNADvp4bTbwEnkN8rnjEBHUkTZiccNsUMVMNlJ/5ORevkI1MN3bh8eEFNtiMK4GzkiXRnIgtpljDGLNaqCeCcRgsj4MG84GyEgV80a1N/yFW+/UrzxvxMxxkjsYdH0bVsyXEW1HHGlj1Fz1CAicNeU2AbUINPV7vDcg0EQWsxZzquN8/Im6QYoZyE0iADnoDUgD7kPj3+IJAAD//xanXMYAAAAGSURBVAMAizwpIalkyRUAAAAASUVORK5CYII=';
/** White glyph for dark UI surfaces. */
const GROK_ICON_DARK_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAnklEQVR4nLVSCw7DIAh9ejJ3snEztpOx4GqHKDTZspeYVHifigI/onwrFJEWGsi7eTelZyeXQqbfxn6CiJB8wO67HUtm1Sru5E2/izMDBQe9U6wY9WrT7Xm9GIAa3wA8onS2zi6ZI151/MndTFuTsfvD6gyWwW2v6mJInHDGLVFmQBcB6RsgQ9Zh6dK6fVDLMYfgTN6Iull6/rD5b7wAnAr4bRhfc8gAAAAASUVORK5CYII=';

function grokIconSvg(dataUrl: string): string {
    return `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true"><image href="${dataUrl}" width="16" height="16" preserveAspectRatio="xMidYMid meet"/></svg>`;
}

export const GROK_BRAND_SVG_LIGHT = grokIconSvg(GROK_ICON_LIGHT_DATA_URL);
export const GROK_BRAND_SVG_DARK = grokIconSvg(GROK_ICON_DARK_DATA_URL);
