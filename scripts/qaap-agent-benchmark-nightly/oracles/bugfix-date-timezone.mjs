import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assert, oracle } from './_lib.mjs';

const ZONES = ['UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata', 'Pacific/Kiritimati'];
const workspace = process.argv[2];
const zone = process.argv[3];

if (!zone) {
    // Parent: public tests once, then one child process per time zone (TZ is read at start-up).
    await oracle(workspace, async () => {
        for (const tz of ZONES) {
            const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), workspace, tz], {
                env: { ...process.env, TZ: tz },
                encoding: 'utf8',
            });
            if (child.status !== 0) {
                throw new Error(`time zone ${tz} failed:\n${child.stderr}`);
            }
        }
    }, { publicTestsEnv: { TZ: 'UTC' } });
} else {
    const { parseDate, toDateKey, addDays, daysBetween } = await import(
        pathToFileURL(path.join(workspace, 'src/dates.js')).href);
    // Every day of a leap year, including both DST transitions of the US and of New Zealand.
    let key = '2024-01-01';
    for (let index = 0; index < 366; index++) {
        assert.equal(toDateKey(parseDate(key)), key, `round trip of ${key} in ${zone}`);
        const next = addDays(key, 1);
        assert.equal(daysBetween(key, next), 1, `${key} -> ${next} is one day in ${zone}`);
        key = next;
    }
    assert.equal(key, '2025-01-01');
    assert.equal(addDays('2024-03-09', 1), '2024-03-10');
    assert.equal(addDays('2024-03-09', 2), '2024-03-11');
    assert.equal(addDays('2024-11-02', 2), '2024-11-04');
    assert.equal(addDays('2024-09-28', 1), '2024-09-29');
    assert.equal(daysBetween('2024-03-01', '2024-04-01'), 31);
    assert.equal(daysBetween('2024-04-01', '2024-03-01'), -31);
}
