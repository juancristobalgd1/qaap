import { assert, oracle } from './_lib.mjs';

await oracle(process.argv[2], async ({ load }) => {
    const { parseCsv, toCsv } = await load('src/csv.js');

    assert.equal(toCsv([['Smith, John', 'x']]), '"Smith, John",x\n');
    assert.equal(toCsv([['say "hi"']]), '"say ""hi"""\n');
    assert.equal(toCsv([['line1\nline2', 'b']]), '"line1\nline2",b\n');
    assert.equal(toCsv([['plain', '']]), 'plain,\n');

    assert.deepEqual(parseCsv('a,"b,c"\r\n"x""y",\n'), [['a', 'b,c'], ['x"y', '']]);
    assert.deepEqual(parseCsv('"multi\nline",z\n'), [['multi\nline', 'z']]);
    assert.deepEqual(parseCsv('a,b\r\nc,d'), [['a', 'b'], ['c', 'd']], 'CRLF and a missing final newline');
    assert.deepEqual(parseCsv(',,\n'), [['', '', '']]);
    assert.deepEqual(parseCsv('a\n\nb\n'), [['a'], ['b']], 'blank lines are ignored');

    const rows = [['id', 'note'], ['1', 'He said, "wow"'], ['2', 'two\nlines'], ['3', ''], ['4', ' padded ']];
    assert.deepEqual(parseCsv(toCsv(rows)), rows, 'round trip');
});
