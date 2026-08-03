#!/usr/bin/env python3
"""Remove unused imports from TypeScript files."""
import re
import sys
import os
from pathlib import Path

def remove_unused_imports(file_path):
    with open(file_path) as f:
        content = f.read()
    lines = content.split('\n')

    # Parse imports: collect (start_line, end_line, import_text, imported_names)
    imports = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.lstrip()
        if not stripped.startswith('import '):
            i += 1
            continue

        # Find the end of the import (line ending with ; or containing 'from')
        start = i
        end = i
        # Check if it's a single-line import
        if re.search(r"from\s+['\"]", line) and line.rstrip().endswith(';'):
            end = i
        else:
            # Multi-line import: find the line with 'from' and ';'
            for j in range(i, min(i+20, len(lines))):
                if "from '" in lines[j] or 'from "' in lines[j]:
                    if lines[j].rstrip().endswith(';'):
                        end = j
                        break
                    # Might continue to next line
                    for k in range(j, min(j+5, len(lines))):
                        if lines[k].rstrip().endswith(';'):
                            end = k
                            break
                    break

        import_text = '\n'.join(lines[start:end+1])

        # Extract imported names
        # Handle: import { name1, name2, type Name3 } from '...'
        # Handle: import name from '...'
        # Handle: import * as name from '...'
        names = []
        brace_match = re.search(r'\{([^}]+)\}', import_text)
        if brace_match:
            for part in brace_match.group(1).split(','):
                part = part.strip()
                # Handle "type Name" and "Name as Alias"
                part = re.sub(r'^type\s+', '', part)
                if ' as ' in part:
                    part = part.split(' as ')[-1].strip()
                if part:
                    names.append(part)
        else:
            default_match = re.match(r'import\s+(\w+)', import_text)
            if default_match:
                names.append(default_match.group(1))
            namespace_match = re.match(r'import\s+\*\s+as\s+(\w+)', import_text)
            if namespace_match:
                names.append(namespace_match.group(1))

        imports.append({
            'start': start,
            'end': end,
            'text': import_text,
            'names': names,
        })
        i = end + 1

    # Check which names are used in the rest of the file (outside imports)
    non_import_lines = []
    for i, line in enumerate(lines):
        in_import = False
        for imp in imports:
            if imp['start'] <= i <= imp['end']:
                in_import = True
                break
        if not in_import:
            non_import_lines.append(line)

    body_text = '\n'.join(non_import_lines)

    # For each import, check if any of its names are used
    used_imports = []
    unused_imports = []
    for imp in imports:
        is_used = False
        for name in imp['names']:
            # Check if the name appears as a word in the body (not inside a string)
            # Simple heuristic: look for the name as a whole word
            pattern = r'\b' + re.escape(name) + r'\b'
            if re.search(pattern, body_text):
                is_used = True
                break
        if is_used:
            used_imports.append(imp)
        else:
            unused_imports.append(imp)

    if not unused_imports:
        return False  # no changes

    # Remove unused import lines
    lines_to_remove = set()
    for imp in unused_imports:
        for i in range(imp['start'], imp['end'] + 1):
            lines_to_remove.add(i)

    new_lines = [line for i, line in enumerate(lines) if i not in lines_to_remove]

    with open(file_path, 'w') as f:
        f.write('\n'.join(new_lines))

    return True

def main():
    if len(sys.argv) < 2:
        print("Usage: clean-imports.py <file1.ts> [file2.ts ...]")
        sys.exit(1)

    for file_path in sys.argv[1:]:
        changed = remove_unused_imports(file_path)
        if changed:
            print(f"  Cleaned: {file_path}")
        else:
            print(f"  No changes: {file_path}")

if __name__ == '__main__':
    main()
