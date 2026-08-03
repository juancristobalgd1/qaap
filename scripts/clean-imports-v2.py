#!/usr/bin/env python3
"""Clean unused imports from a TypeScript file by rewriting the import section."""
import re
import sys

def parse_imports(lines):
    """Parse import statements, returning list of (start, end, module, names)."""
    imports = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.lstrip()
        if not stripped.startswith('import '):
            i += 1
            continue

        start = i
        # Find the end of the import (line with 'from' and ';')
        end = i
        text = ''
        for j in range(i, min(i + 30, len(lines))):
            text += lines[j]
            if "from '" in lines[j] or 'from "' in lines[j]:
                # Check if line ends with ;
                combined = ''.join(lines[i:j+1])
                if combined.rstrip().endswith(';'):
                    end = j
                    break
                # Check next line for ;
                if j + 1 < len(lines) and lines[j+1].strip().endswith(';'):
                    end = j + 1
                    break
                end = j
                break
            elif lines[j].rstrip().endswith(';') and j > i:
                end = j
                break

        import_text = ''.join(lines[start:end+1])

        # Extract module path
        module_match = re.search(r"from\s+['\"]([^'\"]+)['\"]", import_text)
        module = module_match.group(1) if module_match else None

        # Extract imported names with their full text
        names = []
        # Handle: import { name1, name2 as alias, type Name3 } from '...'
        brace_match = re.search(r'\{([^}]+)\}', import_text, re.DOTALL)
        if brace_match:
            for part in brace_match.group(1).split(','):
                part = part.strip()
                if not part:
                    continue
                # Extract the local name (after 'as' if present)
                local_name = part
                if ' as ' in part:
                    local_name = part.split(' as ')[-1].strip()
                # Remove 'type ' prefix
                local_name = re.sub(r'^type\s+', '', local_name)
                names.append({
                    'text': part,
                    'local': local_name,
                    'is_type': part.startswith('type '),
                })
        else:
            # Default import or namespace import
            default_match = re.match(r'import\s+(\w+)', import_text)
            if default_match:
                names.append({
                    'text': default_match.group(1),
                    'local': default_match.group(1),
                    'is_type': False,
                })
            ns_match = re.match(r'import\s+\*\s+as\s+(\w+)', import_text)
            if ns_match:
                names.append({
                    'text': f'* as {ns_match.group(1)}',
                    'local': ns_match.group(1),
                    'is_type': False,
                })

        imports.append({
            'start': start,
            'end': end,
            'module': module,
            'names': names,
            'text': import_text,
        })
        i = end + 1

    return imports

def main():
    file_path = sys.argv[1]

    with open(file_path) as f:
        content = f.read()
    lines = content.split('\n')

    # Find where imports end (first non-import, non-empty, non-comment line)
    imports = parse_imports(lines)

    # Find the class body start
    class_start = None
    for i, line in enumerate(lines):
        if 'export class ' in line or 'export abstract class ' in line:
            class_start = i
            break

    if class_start is None:
        print("Could not find class declaration")
        sys.exit(1)

    # Get the body text (everything after imports)
    body_text = '\n'.join(lines[class_start:])

    # For each import, check which names are used in the body
    new_import_lines = []
    removed_count = 0

    for imp in imports:
        used_names = []
        for name_info in imp['names']:
            name = name_info['local']
            # Check if name is used in body (as a whole word)
            pattern = r'\b' + re.escape(name) + r'\b'
            if re.search(pattern, body_text):
                used_names.append(name_info)
            else:
                removed_count += 1

        if not used_names:
            # Skip entire import
            continue

        if len(used_names) == len(imp['names']):
            # Keep entire import as-is
            new_import_lines.append(imp['text'].rstrip())
            continue

        # Rebuild import with only used names
        if imp['module']:
            # Check if it's a brace import
            if imp['names'] and imp['names'][0]['text'].startswith('*'):
                # Namespace import
                new_import_lines.append(f"import * as {used_names[0]['local']} from '{imp['module']}';")
            elif len(used_names) == 1 and not used_names[0]['text'].startswith('{'):
                # Single name without braces
                new_import_lines.append(f"import {used_names[0]['text']} from '{imp['module']}';")
            else:
                # Brace import
                name_strs = [n['text'] for n in used_names]
                if len(name_strs) == 1:
                    new_import_lines.append(f"import {{ {name_strs[0]} }} from '{imp['module']}';")
                else:
                    # Multi-line format for many names
                    new_import_lines.append(f"import {{")
                    for n in name_strs:
                        new_import_lines.append(f"    {n},")
                    new_import_lines.append(f"}} from '{imp['module']}';")

    # Rebuild the file
    # Keep everything before the first import
    pre_import_lines = []
    first_import_start = imports[0]['start'] if imports else 0
    for i in range(first_import_start):
        pre_import_lines.append(lines[i])

    # Keep everything after the last import
    last_import_end = imports[-1]['end'] if imports else 0
    post_import_lines = []
    for i in range(last_import_end + 1, len(lines)):
        post_import_lines.append(lines[i])

    # Assemble
    new_content = '\n'.join(pre_import_lines)
    if new_content and not new_content.endswith('\n'):
        new_content += '\n'
    new_content += '\n'.join(new_import_lines)
    new_content += '\n'
    new_content += '\n'.join(post_import_lines)

    with open(file_path, 'w') as f:
        f.write(new_content)

    print(f"Cleaned {file_path}: removed {removed_count} unused names")

if __name__ == '__main__':
    main()
