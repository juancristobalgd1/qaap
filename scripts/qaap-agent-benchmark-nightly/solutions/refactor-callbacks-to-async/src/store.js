import fs from 'node:fs/promises';

export async function readRecords(file) {
    let data;
    try {
        data = await fs.readFile(file, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    try {
        return JSON.parse(data);
    } catch (parseError) {
        throw new Error(`Corrupt store ${file}: ${parseError.message}`);
    }
}

export async function saveRecords(file, records) {
    await fs.writeFile(file, `${JSON.stringify(records, null, 2)}\n`);
}
