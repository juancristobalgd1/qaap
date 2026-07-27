import * as fs from 'fs';
import * as path from 'path';

const workspace = path.resolve(process.argv[2] ?? '.');
const answerPath = path.join(workspace, 'answer.js');
const source = fs.existsSync(answerPath) ? fs.readFileSync(answerPath, 'utf8') : '';

if (!/export\s+const\s+answer\s*=\s*42\s*;?/.test(source)) {
    process.stderr.write('Expected answer.js to export answer = 42.\n');
    process.exitCode = 1;
}
