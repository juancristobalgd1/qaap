import { assert, oracle } from './_lib.mjs';

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

await oracle(process.argv[2], async ({ load }) => {
    const { run } = await load('src/cli.js');
    const files = { 'a.txt': 'hello world\nsecond line\n' };

    let io = makeIo(files);
    assert.equal(run(['--json', 'a.txt'], io), 0);
    assert.deepEqual(JSON.parse(io.out), { lines: 2, words: 4, chars: 24, file: 'a.txt' });
    assert.equal(io.out.endsWith('\n'), true, 'one JSON document per line');
    assert.equal(io.err, '');

    io = makeIo(files);
    assert.equal(run(['a.txt', '--json'], io), 0, 'the flag may follow the file');
    assert.deepEqual(JSON.parse(io.out), { lines: 2, words: 4, chars: 24, file: 'a.txt' });

    io = makeIo(files);
    assert.equal(run(['a.txt'], io), 0);
    assert.equal(io.out, '2 4 24 a.txt\n', 'plain output is unchanged');

    io = makeIo(files);
    assert.equal(run(['--help'], io), 0);
    assert.match(io.out, /^Usage: wcl \[--json\] <file>/);
    assert.equal(io.err, '');

    io = makeIo(files);
    assert.equal(run(['-h'], io), 0);
    assert.match(io.out, /Usage: wcl/);

    io = makeIo(files);
    assert.equal(run(['--bogus', 'a.txt'], io), 2);
    assert.equal(io.err, 'wcl: unknown option: --bogus\n');
    assert.equal(io.out, '');

    io = makeIo(files);
    assert.equal(run(['--json'], io), 2, 'a file is still required');
    assert.match(io.err, /Usage: wcl/);

    io = makeIo(files);
    assert.equal(run(['--json', 'missing.txt'], io), 1);
    assert.match(io.err, /missing\.txt/);
    assert.equal(io.out, '', 'no JSON on failure');
});
