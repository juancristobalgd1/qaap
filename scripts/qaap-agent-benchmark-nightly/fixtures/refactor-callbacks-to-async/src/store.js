import fs from 'node:fs';

/** Read the JSON array stored in `file`; a missing file is an empty store. */
export function readRecords(file, cb) {
    fs.readFile(file, 'utf8', (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                return cb(null, []);
            }
            return cb(err);
        }
        let records;
        try {
            records = JSON.parse(data);
        } catch (parseError) {
            return cb(new Error(`Corrupt store ${file}: ${parseError.message}`));
        }
        return cb(null, records);
    });
}

/** Persist `records` as pretty JSON. */
export function saveRecords(file, records, cb) {
    fs.writeFile(file, `${JSON.stringify(records, null, 2)}\n`, err => cb(err ?? null));
}
