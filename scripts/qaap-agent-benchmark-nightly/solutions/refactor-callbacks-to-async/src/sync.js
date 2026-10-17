import { readRecords, saveRecords } from './store.js';

export async function appendIfMissing(file, record) {
    const records = await readRecords(file);
    if (records.some(existing => existing.id === record.id)) {
        return false;
    }
    records.push(record);
    await saveRecords(file, records);
    return true;
}
