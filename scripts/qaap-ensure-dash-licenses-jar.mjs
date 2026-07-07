#!/usr/bin/env node
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { get } from 'node:https';

const jarPath = resolve('node_modules/@eclipse-dash/nodejs-wrapper/download/dash-licenses.jar');
const jarUrl = 'https://repo.eclipse.org/content/repositories/dash-licenses/org/eclipse/dash/org.eclipse.dash.licenses/1.1.0/org.eclipse.dash.licenses-1.1.0.jar';
const minJarSize = 10 * 1024 * 1024;

function hasValidJar() {
    return existsSync(jarPath) && statSync(jarPath).size >= minJarSize;
}

function download(url, destination) {
    return new Promise((resolvePromise, reject) => {
        get(url, response => {
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Failed to download dash-licenses jar: HTTP ${response.statusCode}`));
                return;
            }
            mkdirSync(dirname(destination), { recursive: true });
            const file = createWriteStream(destination);
            response.pipe(file);
            file.on('finish', () => file.close(resolvePromise));
            file.on('error', reject);
        }).on('error', reject);
    });
}

if (!hasValidJar()) {
    const tempPath = `${jarPath}.tmp`;
    if (existsSync(tempPath)) {
        unlinkSync(tempPath);
    }
    await download(jarUrl, tempPath);
    if (statSync(tempPath).size < minJarSize) {
        unlinkSync(tempPath);
        throw new Error('Downloaded dash-licenses jar is too small');
    }
    renameSync(tempPath, jarPath);
}
