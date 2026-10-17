import { countText } from './count.js';

/**
 * `wcl <file>` prints "<lines> <words> <chars> <file>".
 *
 * `io` is injected so the CLI is testable: `io.readFile(path)` returns the file text (or throws),
 * `io.stdout.write(text)` and `io.stderr.write(text)` receive the output. Returns the exit code.
 */
export function run(argv, io) {
    const args = argv.slice();
    if (args.length === 0) {
        io.stderr.write('Usage: wcl <file>\n');
        return 2;
    }
    const file = args[0];
    let text;
    try {
        text = io.readFile(file);
    } catch (error) {
        io.stderr.write(`wcl: ${file}: ${error.message}\n`);
        return 1;
    }
    const { lines, words, chars } = countText(text);
    io.stdout.write(`${lines} ${words} ${chars} ${file}\n`);
    return 0;
}
