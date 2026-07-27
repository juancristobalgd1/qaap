import * as fs from 'fs';
import * as path from 'path';

const workspace = path.resolve(process.argv[2]);
const promptFile = path.resolve(process.argv[3]);
const prompt = fs.readFileSync(promptFile, 'utf8');

if (!/42/.test(prompt)) {
    process.stderr.write('Prompt did not contain the expected target.\n');
    process.exit(1);
}

fs.writeFileSync(path.join(workspace, 'answer.js'), 'export const answer = 42;\n');
process.stdout.write(`${JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: 'Updated answer.js and completed the task.',
    costUsd: 0.001,
    totalTokens: 100,
})}\n`);
