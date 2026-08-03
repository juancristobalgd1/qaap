#!/usr/bin/env python3
"""Remove unused import names from a TypeScript file based on TS6133 errors."""
import re
import sys

def main():
    file_path = sys.argv[1]
    # Remaining args are "line:col:name" triples
    unused = []
    for arg in sys.argv[2:]:
        parts = arg.split(':')
        if len(parts) >= 3:
            unused.append((int(parts[0]), ':'.join(parts[2:])))

    with open(file_path) as f:
        lines = f.readlines()

    # Group unused names by line number
    by_line = {}
    for line_num, name in unused:
        by_line.setdefault(line_num, []).append(name)

    # Process each line
    new_lines = []
    for i, line in enumerate(lines):
        line_num = i + 1
        if line_num not in by_line:
            new_lines.append(line)
            continue

        names_to_remove = set(by_line[line_num])
        stripped = line.rstrip('\n')

        # Try to remove each unused name from the line
        for name in names_to_remove:
            # Handle various patterns:
            # , name
            # name,
            # , name as alias
            # name as alias,
            # , type name
            # type name,
            # Just name (whole line)

            # Remove "name as alias" or "name" with optional leading/trailing comma
            # Pattern: (,\s*)?name(\s+as\s+\w+)?(\s*,)?
            patterns = [
                rf',\s*type\s+{re.escape(name)}\b',
                rf'\btype\s+{re.escape(name)}\s*,?\s*',
                rf',\s*{re.escape(name)}\s+as\s+\w+',
                rf'{re.escape(name)}\s+as\s+\w+\s*,?\s*',
                rf',\s*{re.escape(name)}\b',
                rf'\b{re.escape(name)}\s*,\s*',
                rf'\b{re.escape(name)}\b',
            ]
            for pattern in patterns:
                new_stripped = re.sub(pattern, '', stripped)
                if new_stripped != stripped:
                    stripped = new_stripped
                    break

        # Clean up: remove trailing commas, empty lines
        stripped = stripped.rstrip()
        if stripped.endswith(','):
            stripped = stripped[:-1]

        # Skip lines that are now empty or just whitespace
        if stripped.strip():
            new_lines.append(stripped + '\n')

    with open(file_path, 'w') as f:
        f.writelines(new_lines)

    print(f"Fixed {file_path}: removed {len(unused)} unused names")

if __name__ == '__main__':
    main()
