import { readRecords, saveRecords } from './store.js';

/** Append `record` unless a record with the same id exists. Reports whether it was added. */
export function appendIfMissing(file, record, cb) {
    readRecords(file, (err, records) => {
        if (err) {
            return cb(err);
        }
        if (records.some(existing => existing.id === record.id)) {
            return cb(null, false);
        }
        records.push(record);
        return saveRecords(file, records, saveError => {
            if (saveError) {
                return cb(saveError);
            }
            return cb(null, true);
        });
    });
}
