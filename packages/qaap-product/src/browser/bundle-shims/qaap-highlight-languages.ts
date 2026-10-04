// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/// <reference types="highlight.js" />
// The reference loads the package's ambient `highlight.js/lib/*` module declarations.

import hljs = require('highlight.js/lib/core');
import bash = require('highlight.js/lib/languages/bash');
import c = require('highlight.js/lib/languages/c');
import cpp = require('highlight.js/lib/languages/cpp');
import csharp = require('highlight.js/lib/languages/csharp');
import css = require('highlight.js/lib/languages/css');
import diff = require('highlight.js/lib/languages/diff');
import dockerfile = require('highlight.js/lib/languages/dockerfile');
import go = require('highlight.js/lib/languages/go');
import ini = require('highlight.js/lib/languages/ini');
import java = require('highlight.js/lib/languages/java');
import javascript = require('highlight.js/lib/languages/javascript');
import json = require('highlight.js/lib/languages/json');
import kotlin = require('highlight.js/lib/languages/kotlin');
import less = require('highlight.js/lib/languages/less');
import lua = require('highlight.js/lib/languages/lua');
import makefile = require('highlight.js/lib/languages/makefile');
import markdown = require('highlight.js/lib/languages/markdown');
import objectivec = require('highlight.js/lib/languages/objectivec');
import perl = require('highlight.js/lib/languages/perl');
import php = require('highlight.js/lib/languages/php');
import phpTemplate = require('highlight.js/lib/languages/php-template');
import plaintext = require('highlight.js/lib/languages/plaintext');
import python = require('highlight.js/lib/languages/python');
import pythonRepl = require('highlight.js/lib/languages/python-repl');
import r = require('highlight.js/lib/languages/r');
import ruby = require('highlight.js/lib/languages/ruby');
import rust = require('highlight.js/lib/languages/rust');
import scss = require('highlight.js/lib/languages/scss');
import shell = require('highlight.js/lib/languages/shell');
import sql = require('highlight.js/lib/languages/sql');
import swift = require('highlight.js/lib/languages/swift');
import typescript = require('highlight.js/lib/languages/typescript');
import vbnet = require('highlight.js/lib/languages/vbnet');
import xml = require('highlight.js/lib/languages/xml');
import yaml = require('highlight.js/lib/languages/yaml');

type QaapHighlightLanguage = Parameters<typeof hljs.registerLanguage>[1];

/**
 * The `highlight.js` 10 typings declare a default export for each language file, but the CommonJS files assign the
 * language function to `module.exports`, which is what `import = require` returns at runtime.
 */
type QaapHighlightLanguageModule = QaapHighlightLanguage | { default: QaapHighlightLanguage };

function languageOf(languageModule: QaapHighlightLanguageModule): QaapHighlightLanguage {
    return typeof languageModule === 'function' ? languageModule : languageModule.default;
}

/**
 * The common languages registered by `qaap-highlight-common` (the startup-size `highlight.js` shim),
 * keyed by their `highlight.js/lib/languages/*` file name.
 */
export const QAAP_HIGHLIGHT_LANGUAGES: ReadonlyArray<[string, QaapHighlightLanguage]> = [
    ['bash', languageOf(bash)],
    ['c', languageOf(c)],
    ['cpp', languageOf(cpp)],
    ['csharp', languageOf(csharp)],
    ['css', languageOf(css)],
    ['diff', languageOf(diff)],
    ['dockerfile', languageOf(dockerfile)],
    ['go', languageOf(go)],
    ['ini', languageOf(ini)],
    ['java', languageOf(java)],
    ['javascript', languageOf(javascript)],
    ['json', languageOf(json)],
    ['kotlin', languageOf(kotlin)],
    ['less', languageOf(less)],
    ['lua', languageOf(lua)],
    ['makefile', languageOf(makefile)],
    ['markdown', languageOf(markdown)],
    ['objectivec', languageOf(objectivec)],
    ['perl', languageOf(perl)],
    ['php', languageOf(php)],
    ['php-template', languageOf(phpTemplate)],
    ['plaintext', languageOf(plaintext)],
    ['python', languageOf(python)],
    ['python-repl', languageOf(pythonRepl)],
    ['r', languageOf(r)],
    ['ruby', languageOf(ruby)],
    ['rust', languageOf(rust)],
    ['scss', languageOf(scss)],
    ['shell', languageOf(shell)],
    ['sql', languageOf(sql)],
    ['swift', languageOf(swift)],
    ['typescript', languageOf(typescript)],
    ['vbnet', languageOf(vbnet)],
    ['xml', languageOf(xml)],
    ['yaml', languageOf(yaml)],
];
