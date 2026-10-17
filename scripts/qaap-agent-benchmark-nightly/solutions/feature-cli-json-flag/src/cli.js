import { countText } from './count.js';

const USAGE = 'Usage: wcl [--json] <file>\n';

export function run(argv, io) {
    let json = false;
    const positional = [];
    for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
            io.stdout.write(USAGE);
            return 0;
        }
        if (arg === '--json') {
            json = true;
        } else if (arg.startsWith('-') && arg.length > 1) {
            io.stderr.write(`wcl: unknown option: ${arg}\n`);
            return 2;
        } else {
            positional.push(arg);
        }
    }
    if (positional.length === 0) {
        io.stderr.write(USAGE);
        return 2;
    }
    const file = positional[0];
    let text;
    try {
        text = io.readFile(file);
    } catch (error) {
        io.stderr.write(`wcl: ${file}: ${error.message}\n`);
        return 1;
    }
    const { lines, words, chars } = countText(text);
    io.stdout.write(json
        ? `${JSON.stringify({ lines, words, chars, file })}\n`
        : `${lines} ${words} ${chars} ${file}\n`);
    return 0;
}
