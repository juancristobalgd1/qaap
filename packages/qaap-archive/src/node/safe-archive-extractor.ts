// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import AdmZip = require('adm-zip');
import * as fs from 'fs/promises';
import { constants } from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { createGunzip } from 'zlib';
import * as tarStream from 'tar-stream';

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
    limits?: Partial<QaapArchiveLimits>;
}

export interface QaapArchiveLimits {
    /** Maximum number of archive entries, including directories and metadata entries. */
    maxEntries: number;
    /** Maximum uncompressed size of one entry. */
    maxEntryBytes: number;
    /** Maximum aggregate uncompressed size of archive entries. */
    maxTotalBytes: number;
    /** Maximum uncompressed-to-compressed ratio. */
    maxCompressionRatio: number;
    /** Maximum size of the compressed archive input. */
    maxArchiveBytes: number;
}

const MIB = 1024 * 1024;

/** Conservative defaults for untrusted VSIX, ZIP, TAR, and TGZ input. */
export const DEFAULT_QAAP_ARCHIVE_LIMITS: QaapArchiveLimits = {
    maxEntries: 10_000,
    maxEntryBytes: 256 * MIB,
    maxTotalBytes: 1024 * MIB,
    maxCompressionRatio: 200,
    maxArchiveBytes: 512 * MIB,
};

type ArchiveInput = string | Buffer;

interface ArchiveLimitState {
    entries: number;
    reservedUncompressedBytes: number;
    observedUncompressedBytes: number;
}

type ArchiveEntryConsumer = (entry: QaapArchiveEntry) => Promise<void> | void;

function resolveLimits(options: QaapArchiveExtractOptions): QaapArchiveLimits {
    const limits = { ...DEFAULT_QAAP_ARCHIVE_LIMITS, ...options.limits };
    for (const [name, value] of Object.entries(limits)) {
        if (name === 'maxCompressionRatio') {
            if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
                throw new Error(`Invalid archive limit ${name}: ${value}`);
            }
        } else if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
            throw new Error(`Invalid archive limit ${name}: ${value}`);
        }
    }
    return limits;
}

function checkCompressionRatio(uncompressedBytes: number, compressedBytes: number, limits: QaapArchiveLimits): void {
    const ratio = uncompressedBytes / Math.max(1, compressedBytes);
    if (ratio > limits.maxCompressionRatio) {
        throw new Error(
            `Refusing an archive with an excessive compression ratio (${ratio.toFixed(1)} > ${limits.maxCompressionRatio}).`,
        );
    }
}

function reserveEntry(
    state: ArchiveLimitState,
    limits: QaapArchiveLimits,
    entryPath: string,
    uncompressedBytes: number,
    compressedBytes?: number,
): void {
    if (state.entries >= limits.maxEntries) {
        throw new Error(`Refusing an archive with more than ${limits.maxEntries} entries.`);
    }
    state.entries++;
    if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes < 0) {
        throw new Error(`Refusing archive entry with an invalid size: ${entryPath}`);
    }
    if (uncompressedBytes > limits.maxEntryBytes) {
        throw new Error(`Refusing archive entry larger than ${limits.maxEntryBytes} bytes: ${entryPath}`);
    }
    const nextTotal = state.reservedUncompressedBytes + uncompressedBytes;
    if (!Number.isSafeInteger(nextTotal) || nextTotal > limits.maxTotalBytes) {
        throw new Error(`Refusing an archive larger than ${limits.maxTotalBytes} uncompressed bytes.`);
    }
    state.reservedUncompressedBytes = nextTotal;
    if (compressedBytes !== undefined) {
        if (!Number.isSafeInteger(compressedBytes) || compressedBytes < 0) {
            throw new Error(`Refusing archive entry with an invalid compressed size: ${entryPath}`);
        }
        checkCompressionRatio(uncompressedBytes, compressedBytes, limits);
    }
}

function observeEntryData(
    state: ArchiveLimitState,
    limits: QaapArchiveLimits,
    entryPath: string,
    entryBytes: number,
    chunkBytes: number,
): number {
    const nextEntryBytes = entryBytes + chunkBytes;
    if (!Number.isSafeInteger(nextEntryBytes) || nextEntryBytes > limits.maxEntryBytes) {
        throw new Error(`Refusing archive entry larger than ${limits.maxEntryBytes} bytes: ${entryPath}`);
    }
    const nextTotal = state.observedUncompressedBytes + chunkBytes;
    if (!Number.isSafeInteger(nextTotal) || nextTotal > limits.maxTotalBytes) {
        throw new Error(`Refusing an archive larger than ${limits.maxTotalBytes} uncompressed bytes.`);
    }
    state.observedUncompressedBytes = nextTotal;
    return nextEntryBytes;
}

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

async function readTar(
    input: Readable,
    compressedBytes: number,
    limits: QaapArchiveLimits,
    consume: ArchiveEntryConsumer,
): Promise<void> {
    const parser = tarStream.extract();
    const state: ArchiveLimitState = {
        entries: 0,
        reservedUncompressedBytes: 0,
        observedUncompressedBytes: 0,
    };
    let archiveBytes = 0;
    let settled = false;
    const parsed = new Promise<void>((resolve, reject) => {
        const fail = (error: unknown): void => {
            if (settled) {
                return;
            }
            settled = true;
            parser.destroy();
            input.destroy();
            reject(error instanceof Error ? error : new Error(String(error)));
        };
        parser.on('entry', (header, stream, next) => {
            const chunks: Buffer[] = [];
            const type = header.type;
            const skipData = type === 'pax-header'
                || type === 'pax-global-header'
                || type === 'gnu-long-link-path'
                || type === 'gnu-long-path';
            let entryBytes = 0;
            try {
                reserveEntry(state, limits, header.name, Number(header.size ?? 0));
            } catch (error) {
                fail(error);
                return;
            }
            stream.on('data', chunk => {
                if (settled) {
                    return;
                }
                try {
                    const value = Buffer.from(chunk);
                    entryBytes = observeEntryData(state, limits, header.name, entryBytes, value.length);
                    if (!skipData) {
                        chunks.push(value);
                    }
                } catch (error) {
                    fail(error);
                }
            });
            stream.on('error', fail);
            stream.on('end', () => {
                if (settled || skipData) {
                    next();
                    return;
                }
                if (type !== 'file' && type !== 'directory' && type !== 'link' && type !== 'symlink' && type !== 'contiguous-file') {
                    fail(new Error(`Refusing unsupported archive entry type: ${type ?? 'unknown'}`));
                    return;
                }
                void (async () => {
                    try {
                        await consume(normalizeEntry({
                            data: Buffer.concat(chunks),
                            mode: header.mode ?? 0,
                            mtime: header.mtime ?? new Date(0),
                            path: header.name,
                            type: type === 'contiguous-file' ? 'file' : type,
                            linkname: header.linkname ?? undefined,
                        }));
                        if (!settled) {
                            next();
                        }
                    } catch (error) {
                        fail(error);
                    }
                })();
            });
        });
        parser.on('finish', () => {
            if (!settled) {
                settled = true;
                resolve();
            }
        });
        parser.on('error', fail);
        input.on('data', chunk => {
            if (settled) {
                return;
            }
            archiveBytes += Buffer.byteLength(chunk);
            try {
                checkCompressionRatio(archiveBytes, compressedBytes, limits);
            } catch (error) {
                fail(error);
            }
        });
        input.on('error', fail);
    });
    input.pipe(parser);
    await parsed;
}

async function readZip(
    buffer: Buffer,
    limits: QaapArchiveLimits,
    consume: ArchiveEntryConsumer,
): Promise<void> {
    const zip = new AdmZip(buffer);
    const state: ArchiveLimitState = {
        entries: 0,
        reservedUncompressedBytes: 0,
        observedUncompressedBytes: 0,
    };
    for (const entry of zip.getEntries()) {
        const mode = entry.header.fileAttr;
        const isSymlink = (mode & 0xf000) === 0xa000;
        const declaredSize = Number(entry.header.size ?? 0);
        const compressedSize = Number(entry.header.compressedSize ?? 0);
        reserveEntry(state, limits, entry.entryName, declaredSize, compressedSize);
        checkCompressionRatio(state.reservedUncompressedBytes, buffer.length, limits);
        const data = entry.isDirectory ? Buffer.alloc(0) : entry.getData();
        if (data.length > limits.maxEntryBytes) {
            throw new Error(`Refusing archive entry larger than ${limits.maxEntryBytes} bytes: ${entry.entryName}`);
        }
        state.observedUncompressedBytes += data.length;
        if (state.observedUncompressedBytes > limits.maxTotalBytes) {
            throw new Error(`Refusing an archive larger than ${limits.maxTotalBytes} uncompressed bytes.`);
        }
        await consume(normalizeEntry({
            data,
            mode,
            mtime: entry.header.time,
            path: entry.entryName,
            type: entry.isDirectory ? 'directory' : isSymlink ? 'symlink' : 'file',
            linkname: isSymlink ? data.toString('utf8') : undefined,
        }));
    }
}

function detectArchiveType(input: Buffer): QaapArchiveType {
    if (input.length >= 4 && input[0] === 0x50 && input[1] === 0x4b && (input[2] === 0x03 || input[2] === 0x05 || input[2] === 0x07)) {
        return 'zip';
    }
    return input.length >= 2 && input[0] === 0x1f && input[1] === 0x8b ? 'tgz' : 'tar';
}

async function readEntries(
    input: ArchiveInput,
    options: QaapArchiveExtractOptions,
    consume: ArchiveEntryConsumer,
): Promise<void> {
    const limits = resolveLimits(options);
    if (typeof input === 'string') {
        const stat = await fs.stat(input);
        if (stat.size > limits.maxArchiveBytes) {
            throw new Error(`Refusing an archive larger than ${limits.maxArchiveBytes} compressed bytes.`);
        }
    }
    const buffer = typeof input === 'string' ? await fs.readFile(input) : input;
    if (buffer.length > limits.maxArchiveBytes) {
        throw new Error(`Refusing an archive larger than ${limits.maxArchiveBytes} compressed bytes.`);
    }
    const archive = options.archive ?? detectArchiveType(buffer);
    if (archive === 'zip') {
        await readZip(buffer, limits, consume);
        return;
    }
    const source = Readable.from(buffer);
    const tarInput = archive === 'tgz' || detectArchiveType(buffer) === 'tgz'
        ? source.pipe(createGunzip())
        : source;
    await readTar(tarInput, buffer.length, limits, consume);
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
    const filtered: QaapArchiveEntry[] = [];
    let realRoot: string | undefined;
    if (output) {
        const root = path.resolve(output);
        await fs.mkdir(root, { recursive: true });
        realRoot = await fs.realpath(root);
    }
    await readEntries(input, options, async entry => {
        if (typeof options.filter === 'function' && !options.filter(entry)) {
            return;
        }
        filtered.push(entry);
        if (realRoot) {
            await writeEntry(realRoot, entry);
        }
    });
    return filtered;
}
