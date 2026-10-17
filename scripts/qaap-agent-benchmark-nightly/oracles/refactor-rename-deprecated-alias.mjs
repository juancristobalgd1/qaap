import { assert, oracle } from './_lib.mjs';

await oracle(process.argv[2], async ({ load, readSources }) => {
    const warnings = [];
    process.on('warning', warning => warnings.push(warning));
    const logger = await load('src/logger.js');
    const { startApp, stopApp } = await load('src/app.js');
    const { runJob } = await load('src/jobs.js');
    const lines = [];
    logger.setSink(line => lines.push(line));
    const settle = () => new Promise(resolve => setImmediate(resolve));

    assert.equal(typeof logger.log, 'function', 'the new name `log` is exported');
    assert.equal(logger.log('Info', 'hello'), '[INFO] hello');
    assert.deepEqual(lines, ['[INFO] hello']);

    // Internal callers use the new API: no deprecation noise and unchanged output.
    const app = startApp('demo');
    runJob('sync', () => 1);
    stopApp(app);
    await settle();
    assert.equal(warnings.length, 0, 'internal callers must not trigger the deprecation warning');
    assert.deepEqual(lines.slice(1), ['[INFO] starting demo', '[DEBUG] job sync started', '[DEBUG] job sync finished',
        '[INFO] stopping demo']);

    // The deprecated alias keeps working and warns exactly once.
    assert.equal(typeof logger.logMsg, 'function', 'logMsg stays as a deprecated alias');
    assert.equal(logger.logMsg('warn', 'old'), '[WARN] old');
    assert.equal(logger.logMsg('warn', 'older'), '[WARN] older');
    await settle();
    const deprecations = warnings.filter(warning => warning.name === 'DeprecationWarning');
    assert.equal(deprecations.length, 1, 'one DeprecationWarning for repeated use');
    assert.match(deprecations[0].message, /logMsg/);
    assert.match(deprecations[0].message, /log\(\)/);
    assert.equal(lines.at(-1), '[WARN] older');

    for (const { name, text } of readSources('src')) {
        if (name !== 'logger.js') {
            assert.ok(!/\blogMsg\b/.test(text), `${name} still uses the deprecated logMsg`);
        }
    }
});
