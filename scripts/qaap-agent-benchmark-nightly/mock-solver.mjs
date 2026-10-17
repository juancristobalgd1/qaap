// Deterministic stand-in for an agent, used by `qaap-agent-benchmark-nightly.mjs --self-test`:
// it "solves" a task by overlaying the reference solution shipped in solutions/<taskId>/.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(process.argv[2]);
const taskId = process.argv[3];
const solution = path.join(here, 'solutions', taskId);

if (!taskId || !fs.existsSync(solution)) {
    process.stderr.write(`No reference solution for task "${taskId}".\n`);
    process.exit(1);
}
fs.cpSync(solution, workspace, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: `Applied the reference solution for ${taskId}.`,
    costUsd: 0.01,
    totalTokens: 100,
})}\n`);
