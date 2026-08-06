// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import AdmZip = require('adm-zip');
import * as fs from 'fs/promises';
import { constants } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { gunzip as gunzipCallback } from 'zlib';
import * as tarStream from 'tar-stream';

const gunzip = promisify(gunzipCallback);

export type QaapArchiveType = 'tar' | 'tgz' | 'zip';
export type QaapArchiveEntryType = 'file' | 'directory' | 'link' | 'symlink';

export interface QaapArchiveEntry {
    data: Buffer;
    mode: number;
    mtime: Date;
    path: string;
    type: QaapArchiveEntryType;
    linkname?: string;
}

export interface QaapArchiveExtractOptions {
    archive?: QaapArchiveType;
    filter?: (entry: QaapArchiveEntry) => boolean;
}

type ArchiveInput = string | Buffer;

function isInside(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function normalizeArchivePath(entryPath: string): string {
    if (!entryPath || entryPath.includes('\0')) {
        throw new Error('Refusing an archive entry with an invalid path.');
    }
    const normalized = entryPath.replaceAll('\\', '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
        throw new Error(`Refusing an archive entry outside the output path: ${entryPath}`);
    }
    const parts = normalized.split('/').filter(part => part !== '' && part !== '.');
    if (parts.some(part => part === '..')) {
        throw new Error(`Refusing an archive entry outside the output path: ${entryPath}`);
    }
    return parts.join(path.sep);
}

function normalizeEntry(entry: QaapArchiveEntry): QaapArchiveEntry {
    const normalizedPath = normalizeArchivePath(entry.path);
    const type = entry.type;
    if ((type === 'link' || type === 'symlink') && !entry.linkname) {
        throw new Error(`Refusing an archive link without a target: ${entry.path}`);
    }
    if (entry.linkname) {
        const linkBase = type === 'link' ? '' : path.dirname(normalizedPath);
        const normalizedLink = normalizeArchivePath(path.join(linkBase, entry.linkname));
        if (!normalizedLink || !isInside('.', normalizedLink)) {
            throw new Error(`Refusing an archive link outside the output path: ${entry.path}`);
        }
    }
    return {
        ...entry,
        path: normalizedPath,
        mode: (entry.mode || (type === 'directory' ? 0o755 : 0o644)) & 0o777,
        mtime: entry.mtime instanceof Date && !Number.isNaN(entry.mtime.valueOf()) ? entry.mtime : new Date(0),
    };
}

async function readTar(buffer: Buffer): Promise<QaapArchiveEntry[]> {
    const parser = tarStream.extract();
    const entries: QaapArchiveEntry[] = [];
    const parsed = new Promise<void>((resolve, reject) => {
        parser.on('entry', (header, stream, next) => {
            const chunks: Buffer[] = [];
            stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
            stream.on('error', reject);
            stream.on('end', () => {
                const type = header.type;
                if (type === 'pax-header' || type === 'pax-global-header' || type === 'gnu-long-link-path' || type === 'gnu-long-path') {
                    next();
                    return;
                }
                if (type !== 'file' && type !== 'directory' && type !== 'link' && type !== 'symlink' && type !== 'contiguous-file') {
                    reject(new Error(`Refusing unsupported archive entry type: ${type ?? 'unknown'}`));
                    return;
                }
                entries.push({
                    data: Buffer.concat(chunks),
                    mode: header.mode ?? 0,
                    mtime: header.mtime ?? new Date(0),
                    path: header.name,
                    type: type === 'contiguous-file' ? 'file' : type,
                    linkname: header.linkname ?? undefined,
                });
                next();
            });
        });
        parser.on('finish', resolve);
        parser.on('error', reject);
    });
    parser.end(buffer);
    await parsed;
    return entries;
}

function readZip(buffer: Buffer): QaapArchiveEntry[] {
    const zip = new AdmZip(buffer);
    return zip.getEntries().map(entry => {
        const mode = entry.header.fileAttr;
        const isSymlink = (mode & 0xf000) === 0xa000;
        const data = entry.getData();
        return {
            data,
            mode,
            mtime: entry.header.time,
            path: entry.entryName,
            type: entry.isDirectory ? 'directory' : isSymlink ? 'symlink' : 'file',
            linkname: isSymlink ? data.toString('utf8') : undefined,
        };
    });
}

function detectArchiveType(input: Buffer): QaapArchiveType {
    if (input.length >= 4 && input[0] === 0x50 && input[1] === 0x4b && (input[2] === 0x03 || input[2] === 0x05 || input[2] === 0x07)) {
        return 'zip';
    }
    return input.length >= 2 && input[0] === 0x1f && input[1] === 0x8b ? 'tgz' : 'tar';
}

async function readEntries(input: ArchiveInput, options: QaapArchiveExtractOptions): Promise<QaapArchiveEntry[]> {
    const buffer = typeof input === 'string' ? await fs.readFile(input) : input;
    const archive = options.archive ?? detectArchiveType(buffer);
    if (archive === 'zip') {
        return readZip(buffer);
    }
    const tarBuffer = archive === 'tgz' || detectArchiveType(buffer) === 'tgz' ? await gunzip(buffer) : buffer;
    return readTar(tarBuffer);
}

async function ensureSafeDirectory(root: string, directory: string): Promise<void> {
    await fs.mkdir(directory, { recursive: true });
    const realDirectory = await fs.realpath(directory);
    if (!isInside(root, realDirectory)) {
        throw new Error(`Refusing to create a directory outside the output path: ${directory}`);
    }
}

async function ensureSafeLinkTarget(root: string, target: string): Promise<void> {
    const resolved = path.resolve(root, target);
    if (!isInside(root, resolved)) {
        throw new Error(`Refusing an archive link outside the output path: ${target}`);
    }
    try {
        const realTarget = await fs.realpath(resolved);
        if (!isInside(root, realTarget)) {
            throw new Error(`Refusing an archive link through an escaping symlink: ${target}`);
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
}

async function writeEntry(root: string, entry: QaapArchiveEntry): Promise<void> {
    const target = path.resolve(root, entry.path);
    if (!isInside(root, target)) {
        throw new Error(`Refusing to write outside the output path: ${entry.path}`);
    }
    if (entry.type === 'directory') {
        await ensureSafeDirectory(root, target);
        return;
    }

    await ensureSafeDirectory(root, path.dirname(target));
    if (entry.type === 'symlink' || entry.type === 'link') {
        const linkTarget = entry.type === 'link'
            ? path.resolve(root, entry.linkname!)
            : path.resolve(path.dirname(target), entry.linkname!);
        await ensureSafeLinkTarget(root, path.relative(root, linkTarget));
        try {
            await fs.lstat(target);
            throw new Error(`Refusing to replace an existing archive target: ${entry.path}`);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }
        if (entry.type === 'link') {
            await fs.link(linkTarget, target);
        } else {
            await fs.symlink(entry.linkname!, target);
        }
        return;
    }

    try {
        const existing = await fs.lstat(target);
        if (existing.isSymbolicLink()) {
            throw new Error(`Refusing to write through an existing symlink: ${entry.path}`);
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
    const noFollow = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
    const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollow, entry.mode);
    try {
        await handle.writeFile(entry.data);
    } finally {
        await handle.close();
    }
    await fs.chmod(target, entry.mode);
    await fs.utimes(target, entry.mtime, entry.mtime);
}

/** Extract ZIP, TAR, and TGZ archives after validating every path and link target. */
export async function extractArchive(
    input: ArchiveInput,
    output?: string,
    options: QaapArchiveExtractOptions = {},
): Promise<QaapArchiveEntry[]> {
    const entries = (await readEntries(input, options)).map(normalizeEntry);
    const filtered = typeof options.filter === 'function' ? entries.filter(options.filter) : entries;
    if (!output) {
        return filtered;
    }
    const root = path.resolve(output);
    await fs.mkdir(root, { recursive: true });
    const realRoot = await fs.realpath(root);
    for (const entry of filtered) {
        await writeEntry(realRoot, entry);
    }
    return filtered;
}
