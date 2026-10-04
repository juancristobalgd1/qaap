// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

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
 * The common languages registered by `qaap-highlight-common` (the startup-size `highlight.js` shim),
 * keyed by their `highlight.js/lib/languages/*` file name.
 */
export const QAAP_HIGHLIGHT_LANGUAGES: ReadonlyArray<[string, QaapHighlightLanguage]> = [
    ['bash', bash],
    ['c', c],
    ['cpp', cpp],
    ['csharp', csharp],
    ['css', css],
    ['diff', diff],
    ['dockerfile', dockerfile],
    ['go', go],
    ['ini', ini],
    ['java', java],
    ['javascript', javascript],
    ['json', json],
    ['kotlin', kotlin],
    ['less', less],
    ['lua', lua],
    ['makefile', makefile],
    ['markdown', markdown],
    ['objectivec', objectivec],
    ['perl', perl],
    ['php', php],
    ['php-template', phpTemplate],
    ['plaintext', plaintext],
    ['python', python],
    ['python-repl', pythonRepl],
    ['r', r],
    ['ruby', ruby],
    ['rust', rust],
    ['scss', scss],
    ['shell', shell],
    ['sql', sql],
    ['swift', swift],
    ['typescript', typescript],
    ['vbnet', vbnet],
    ['xml', xml],
    ['yaml', yaml],
];
