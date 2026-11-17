// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { type ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** Size and modification time of one log file. */
export interface QaapUsageFileStat {
    readonly file: string;
    readonly size: number;
    readonly mtimeMs: number;
}

/** Uid/gid the agent CLIs run as, when it differs from the backend's own. */
export interface QaapUsageAgentIdentity {
    readonly uid: number;
    readonly gid: number;
}

/**
 * How the usage scanner reaches the agent logs. Directly when they belong to this process; through a
 * helper running as the agent's uid when the agents run as another user (a root tenant backend has no
 * DAC_OVERRIDE, so it cannot enter the agent's 0700 directories by itself).
 */
export interface QaapUsageFileAccess {
    /** Recursively lists the regular files below `directory` whose base name matches. Missing directories yield nothing. */
    listFiles(directory: string, namePattern: RegExp): Promise<QaapUsageFileStat[]>;
    stat(file: string): Promise<QaapUsageFileStat | undefined>;
    /** Bytes `[start, end)` of `file`; shorter when the file is shorter. */
    readRange(file: string, start: number, end: number): Promise<Buffer>;
    readFile(file: string): Promise<Buffer>;
    /** Releases any helper process. Safe to call more than once. */
    release(): void;
}

/** Reads the logs with this process's own permissions. */
export class QaapUsageDirectFileAccess implements QaapUsageFileAccess {

    async listFiles(directory: string, namePattern: RegExp): Promise<QaapUsageFileStat[]> {
        const result: QaapUsageFileStat[] = [];
        const visit = async (current: string): Promise<void> => {
            let entries: fs.Dirent[];
            try {
                entries = await fs.promises.readdir(current, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    await visit(full);
                } else if (entry.isFile() && namePattern.test(entry.name)) {
                    const stat = await this.stat(full);
                    if (stat) {
                        result.push(stat);
                    }
                }
            }
        };
        await visit(directory);
        return result;
    }

    async stat(file: string): Promise<QaapUsageFileStat | undefined> {
        try {
            const stat = await fs.promises.stat(file);
            return { file, size: stat.size, mtimeMs: stat.mtimeMs };
        } catch {
            return undefined;
        }
    }

    async readRange(file: string, start: number, end: number): Promise<Buffer> {
        const handle = await fs.promises.open(file, 'r');
        try {
            const buffer = Buffer.alloc(Math.max(0, end - start));
            let filled = 0;
            while (filled < buffer.length) {
                const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, start + filled);
                if (bytesRead === 0) {
                    break;
                }
                filled += bytesRead;
            }
            return buffer.subarray(0, filled);
        } finally {
            await handle.close();
        }
    }

    readFile(file: string): Promise<Buffer> {
        return fs.promises.readFile(file);
    }

    release(): void {
        // Nothing to release.
    }
}

interface AgentHelperRequest {
    readonly op: 'list' | 'stat' | 'read';
    readonly file: string;
    readonly pattern?: string;
    readonly flags?: string;
    readonly start?: number;
    readonly end?: number;
}

interface AgentHelperResponse {
    readonly id: number;
    readonly ok: boolean;
    readonly error?: string;
    readonly files?: QaapUsageFileStat[];
    readonly stat?: QaapUsageFileStat | null;
    readonly data?: string;
}

/**
 * Reads the logs through one helper process that runs as the agent's uid/gid for the duration of a scan.
 * The helper only reads: it lists, stats and returns bytes of files the agent can already read itself, so
 * running it as the agent grants nothing the agent does not have. Requests and responses are JSON lines.
 */
export class QaapUsageAgentFileAccess implements QaapUsageFileAccess {

    /** Script run as the agent. Reads JSON request lines on stdin and answers one JSON line each, in order. */
    static readonly HELPER_SCRIPT = [
        "const fs=require('fs'),path=require('path'),rl=require('readline');",
        'const out=o=>process.stdout.write(JSON.stringify(o)+"\\n");',
        'const st=f=>{try{const s=fs.statSync(f);return s.isFile()?{file:f,size:s.size,mtimeMs:s.mtimeMs}:null;}catch(e){return null;}};',
        'const walk=(d,re,acc)=>{let es;try{es=fs.readdirSync(d,{withFileTypes:true});}catch(e){return;}',
        'for(const e of es){const f=path.join(d,e.name);if(e.isDirectory()){walk(f,re,acc);}else if(e.isFile()&&re.test(e.name)){const s=st(f);if(s){acc.push(s);}}}};',
        'const read=(f,a,b)=>{const fd=fs.openSync(f,"r");try{const buf=Buffer.alloc(Math.max(0,b-a));let n=0;',
        'while(n<buf.length){const r=fs.readSync(fd,buf,n,buf.length-n,a+n);if(r===0){break;}n+=r;}return buf.subarray(0,n).toString("base64");}finally{fs.closeSync(fd);}};',
        'rl.createInterface({input:process.stdin}).on("line",l=>{let q;try{q=JSON.parse(l);}catch(e){return;}',
        'try{if(q.op==="list"){const acc=[];walk(q.file,new RegExp(q.pattern,q.flags),acc);out({id:q.id,ok:true,files:acc});}',
        'else if(q.op==="stat"){out({id:q.id,ok:true,stat:st(q.file)});}',
        'else if(q.op==="read"){out({id:q.id,ok:true,data:read(q.file,q.start,q.end)});}',
        'else{out({id:q.id,ok:false,error:"unknown op"});}}catch(e){out({id:q.id,ok:false,error:String(e&&e.message||e)});}});',
    ].join('');

    /** Bytes per `read` request: large enough that a long log needs few round trips, small enough for one JSON line. */
    static readonly MAX_READ_BYTES = 4 * 1024 * 1024;

    protected child: ChildProcess | undefined;
    protected nextId = 1;
    protected buffered = '';
    protected readonly pending = new Map<number, { resolve: (response: AgentHelperResponse) => void; reject: (error: Error) => void }>();

    constructor(protected readonly identity: QaapUsageAgentIdentity) { }

    async listFiles(directory: string, namePattern: RegExp): Promise<QaapUsageFileStat[]> {
        const response = await this.request({ op: 'list', file: directory, pattern: namePattern.source, flags: namePattern.flags.replace(/[gy]/g, '') });
        return Array.isArray(response.files) ? response.files.filter(QaapUsageAgentFileAccess.isStat) : [];
    }

    async stat(file: string): Promise<QaapUsageFileStat | undefined> {
        const response = await this.request({ op: 'stat', file });
        return response.stat && QaapUsageAgentFileAccess.isStat(response.stat) ? response.stat : undefined;
    }

    async readRange(file: string, start: number, end: number): Promise<Buffer> {
        const parts: Buffer[] = [];
        let position = start;
        while (position < end) {
            const upTo = Math.min(end, position + QaapUsageAgentFileAccess.MAX_READ_BYTES);
            const response = await this.request({ op: 'read', file, start: position, end: upTo });
            const chunk = Buffer.from(response.data ?? '', 'base64');
            parts.push(chunk);
            const requested = upTo - position;
            position += chunk.length;
            if (chunk.length < requested) {
                // The file is shorter than asked for.
                break;
            }
        }
        return Buffer.concat(parts);
    }

    async readFile(file: string): Promise<Buffer> {
        const stat = await this.stat(file);
        if (!stat) {
            throw new Error(`${file} is not readable as the agent user`);
        }
        return this.readRange(file, 0, stat.size);
    }

    release(): void {
        const child = this.child;
        this.child = undefined;
        this.buffered = '';
        if (child) {
            child.stdin?.end();
            child.kill();
        }
        this.failPending(new Error('usage log helper released'));
    }

    protected async request(body: AgentHelperRequest): Promise<AgentHelperResponse> {
        const child = this.ensureChild();
        const id = this.nextId++;
        const response = await new Promise<AgentHelperResponse>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            child.stdin?.write(`${JSON.stringify({ ...body, id })}\n`);
        });
        if (!response.ok) {
            throw new Error(response.error ?? 'usage log helper failed');
        }
        return response;
    }

    protected ensureChild(): ChildProcess {
        if (this.child) {
            return this.child;
        }
        const child = this.spawnHelper();
        this.child = child;
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => this.onData(chunk));
        const onEnd = (): void => {
            if (this.child === child) {
                this.child = undefined;
                this.buffered = '';
            }
            this.failPending(new Error('usage log helper exited'));
        };
        child.on('exit', onEnd);
        child.on('error', onEnd);
        return child;
    }

    /** Spawns the helper as the agent identity. Overridable in tests. */
    protected spawnHelper(): ChildProcess {
        return spawn(process.execPath, ['-e', QaapUsageAgentFileAccess.HELPER_SCRIPT], {
            uid: this.identity.uid,
            gid: this.identity.gid,
            cwd: '/',
            env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
            stdio: ['pipe', 'pipe', 'ignore'],
        });
    }

    protected onData(chunk: string): void {
        this.buffered += chunk;
        let newline = this.buffered.indexOf('\n');
        while (newline !== -1) {
            const line = this.buffered.slice(0, newline);
            this.buffered = this.buffered.slice(newline + 1);
            newline = this.buffered.indexOf('\n');
            let response: AgentHelperResponse;
            try {
                response = JSON.parse(line) as AgentHelperResponse;
            } catch {
                continue;
            }
            const waiter = this.pending.get(response.id);
            if (waiter) {
                this.pending.delete(response.id);
                waiter.resolve(response);
            }
        }
    }

    protected failPending(error: Error): void {
        const waiters = [...this.pending.values()];
        this.pending.clear();
        for (const waiter of waiters) {
            waiter.reject(error);
        }
    }

    protected static isStat(value: unknown): value is QaapUsageFileStat {
        const candidate = value as QaapUsageFileStat | undefined;
        return !!candidate && typeof candidate.file === 'string' && typeof candidate.size === 'number' && typeof candidate.mtimeMs === 'number';
    }
}
