import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from '../src/cli.js';

function makeIo(files = {}) {
    const io = {
        out: '',
        err: '',
        readFile: file => {
            if (!(file in files)) {
                throw new Error('no such file');
            }
            return files[file];
        },
        stdout: { write: text => { io.out += text; } },
        stderr: { write: text => { io.err += text; } },
    };
    return io;
}

test('counts a file', () => {
    const io = makeIo({ 'a.txt': 'hello world\nsecond line\n' });
    assert.equal(run(['a.txt'], io), 0);
    assert.equal(io.out, '2 4 24 a.txt\n');
});

test('reports a missing file', () => {
    const io = makeIo();
    assert.equal(run(['missing.txt'], io), 1);
    assert.match(io.err, /missing\.txt/);
});

test('prints usage without arguments', () => {
    const io = makeIo();
    assert.equal(run([], io), 2);
    assert.match(io.err, /Usage: wcl/);
});
