#!/usr/bin/env python3
"""Extract specific methods from a TypeScript class using pre-computed line ranges.
Unlike extract-methods.py, this uses find-methods-v2 logic for correct boundaries.
"""
import re
import sys
import os
from pathlib import Path

# Import find_methods from find-methods-v2
sys.path.insert(0, os.path.dirname(__file__))
from find_methods_v2 import find_methods, find_matching_brace

RESERVED = {
    'if', 'for', 'while', 'switch', 'return', 'throw', 'const', 'let', 'var',
    'do', 'try', 'catch', 'finally', 'else', 'case', 'break', 'continue',
    'new', 'await', 'yield', 'super', 'this', 'class', 'interface', 'type',
    'enum', 'import', 'export', 'from', 'as', 'default', 'namespace',
    'function', 'extends', 'implements', 'readonly', 'static', 'abstract',
}

def find_body_brace(lines, start):
    """Find the line and column of the method body's opening brace."""
    paren_depth = 0
    angle_depth = 0
    brace_depth = 0
    found_open_paren = False
    found_close_paren = False
    seen_return_colon = False
    seen_return_type_word = False
    in_str = None  # persists across lines ONLY for backtick strings
    in_block_comment = False  # persists across lines for /* ... */
    for k in range(start, min(start + 50, len(lines))):
        text = lines[k]
        j = 0
        # Reset in_str for single/double quotes (can't span lines)
        if in_str and in_str != '`':
            in_str = None
        while j < len(text):
            ch = text[j]
            if in_block_comment:
                if ch == '*' and j+1 < len(text) and text[j+1] == '/':
                    in_block_comment = False
                    j += 2
                    continue
                j += 1
                continue
            if in_str:
                if ch == '\\':
                    j += 2
                    continue
                if ch == in_str:
                    in_str = None
                j += 1
                continue
            if ch == "'" or ch == '"' or ch == '`':
                in_str = ch
            elif ch == '/' and j+1 < len(text) and text[j+1] == '/':
                break
            elif ch == '/' and j+1 < len(text) and text[j+1] == '*':
                in_block_comment = True
                j += 2
                continue
            elif ch == '(':
                paren_depth += 1
                found_open_paren = True
            elif ch == ')':
                paren_depth -= 1
                if paren_depth == 0:
                    found_close_paren = True
            elif ch == '<' and found_open_paren and angle_depth >= 0:
                angle_depth += 1
                if found_close_paren:
                    seen_return_type_word = True
            elif ch == '>' and found_open_paren and angle_depth > 0:
                angle_depth -= 1
            elif ch == ':' and found_close_paren and not seen_return_colon:
                seen_return_colon = True
            elif ch == '{' and paren_depth == 0 and angle_depth == 0:
                if found_close_paren and brace_depth == 0:
                    if seen_return_colon and not seen_return_type_word:
                        brace_depth += 1
                    else:
                        return k, j
                else:
                    brace_depth += 1
            elif ch == '}' and found_close_paren and brace_depth > 0:
                brace_depth -= 1
            elif found_close_paren and seen_return_colon and ch.isalpha():
                seen_return_type_word = True
            j += 1
    return -1, -1

def extract_signature(lines, start, body_brace_line, body_brace_col):
    """Extract the full signature text (from start to body brace)."""
    sig = ''
    for k in range(start, body_brace_line + 1):
        text = lines[k].rstrip('\n')
        if k == body_brace_line:
            text = text[:body_brace_col]
        sig += text + '\n'
    return sig.strip()

def parse_signature(sig_text):
    """Parse signature to extract modifiers, name, params, return type, is_async."""
    # Extract async
    is_async = bool(re.search(r'\basync\b', sig_text))

    # Extract modifiers
    modifier_match = re.match(r'^((?:public |protected |private |override )*)', sig_text)
    modifiers = modifier_match.group(1).strip() if modifier_match else ''

    # Find method name
    name_match = re.search(r'(\w+)\s*(?:\(|<)', sig_text)
    if not name_match:
        return None
    name = name_match.group(1)

    # Find params
    paren_start = sig_text.find('(')
    if paren_start == -1:
        return None

    depth = 0
    paren_end = -1
    for idx in range(paren_start, len(sig_text)):
        if sig_text[idx] == '(':
            depth += 1
        elif sig_text[idx] == ')':
            depth -= 1
            if depth == 0:
                paren_end = idx
                break
    if paren_end == -1:
        return None

    params_str = sig_text[paren_start+1:paren_end].strip()

    # Return type
    after_paren = sig_text[paren_end+1:].strip()
    if after_paren.startswith(':'):
        return_type = after_paren[1:].strip()
    else:
        return_type = ''

    return {
        'name': name,
        'modifiers': modifiers,
        'is_async': is_async,
        'params_str': params_str,
        'return_type': return_type,
    }

def split_params(params_str):
    if not params_str.strip():
        return []
    parts = []
    depth = 0
    current = []
    for ch in params_str:
        if ch in '([{<':
            depth += 1
            current.append(ch)
        elif ch in ')]}>':
            depth -= 1
            current.append(ch)
        elif ch == ',' and depth == 0:
            parts.append(''.join(current))
            current = []
        else:
            current.append(ch)
    if current:
        parts.append(''.join(current))
    return parts

def get_param_names(params_str):
    if not params_str.strip():
        return []
    names = []
    for p in split_params(params_str):
        p = p.strip()
        if not p:
            continue
        p = p.lstrip('.')
        p = p.replace('readonly ', '')
        name_match = re.match(r'(\w+)(\?)?:', p)
        if name_match:
            names.append(name_match.group(1))
        else:
            names.append(p.split(':')[0].strip().replace('...', ''))
    return names

def create_wrapper(parsed):
    name = parsed['name']
    modifiers = parsed['modifiers']
    is_async = parsed['is_async']
    params_str = parsed['params_str']
    return_type = parsed['return_type']
    param_names = get_param_names(params_str)

    mod_str = (modifiers + ' ') if modifiers else ''
    async_str = 'async ' if is_async else ''

    sig = f"    {mod_str}{async_str}{name}({params_str})"
    if return_type:
        sig += f": {return_type}"
    sig += " {"

    call_args = ', '.join(['this'] + param_names) if param_names else 'this'
    if return_type and return_type != 'void':
        body = f"        return {name}Extracted({call_args});"
    elif is_async:
        body = f"        return {name}Extracted({call_args});"
    else:
        body = f"        {name}Extracted({call_args});"

    return f"{sig}\n{body}\n    }}"

def create_function(parsed, body_lines, class_name):
    name = parsed['name']
    is_async = parsed['is_async']
    params_str = parsed['params_str']
    return_type = parsed['return_type']

    new_params = f"ctx: any"
    if params_str:
        new_params += f", {params_str}"

    async_str = 'async ' if is_async else ''
    sig = f"export {async_str}function {name}Extracted({new_params})"
    if return_type:
        sig += f": {return_type}"
    sig += " {"

    body = '\n'.join(body_lines)
    body = body.replace('this.', 'ctx.')

    return f"{sig}\n{body}\n}}"

def main():
    if len(sys.argv) < 4:
        print("Usage: extract-remaining.py <file.ts> <class_name> <output_prefix>")
        sys.exit(1)

    file_path = sys.argv[1]
    class_name = sys.argv[2]
    output_prefix = sys.argv[3]

    with open(file_path) as f:
        lines = f.readlines()

    # Find class
    class_start = None
    for i, line in enumerate(lines):
        if f'class {class_name}' in line:
            for j in range(i, len(lines)):
                if '{' in lines[j]:
                    class_start = j + 1
                    break
            break

    if class_start is None:
        print(f"Class {class_name} not found")
        sys.exit(1)

    methods = find_methods(lines, class_start)

    # Filter to methods > 4 lines that haven't been extracted yet
    # (i.e., they don't have "Extracted" in their body)
    to_extract = []
    for m in methods:
        if m['size'] <= 4:
            continue
        # Check if already a thin wrapper
        method_text = ''.join(lines[m['start']:m['end']+1])
        if 'Extracted(' in method_text:
            continue
        to_extract.append(m)

    print(f"Found {len(methods)} methods, {len(to_extract)} to extract")

    if not to_extract:
        print("Nothing to extract")
        return

    # Group into files of ~400 lines
    groups = []
    current = []
    current_size = 0
    for m in to_extract:
        size = m['size']
        if current_size + size > 400 and current:
            groups.append(current)
            current = []
            current_size = 0
        current.append(m)
        current_size += size
    if current:
        groups.append(current)

    suffixes = ['render2', 'streaming2', 'timeline2', 'activity2', 'tool-pills2',
                'live-status2', 'thought-brief2', 'diff2', 'misc', 'misc2', 'misc3']

    base_name = Path(file_path).stem
    dir_name = os.path.dirname(file_path)

    # Collect import lines from main file
    import_lines = []
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith('import '):
            import_lines.append(line)

    print(f"Split into {len(groups)} files")

    # Create new files
    for gi, group in enumerate(groups):
        suffix = suffixes[gi] if gi < len(suffixes) else f'misc{gi}'
        new_path = os.path.join(dir_name, f"{base_name}-{suffix}.ts")

        with open(new_path, 'w') as f:
            f.write(f"// @ts-nocheck\n")
            f.write(f"// Extracted from {base_name}.ts\n\n")
            # Copy all imports from main file
            for imp in import_lines:
                f.write(imp if imp.endswith('\n') else imp + '\n')
            f.write('\n')

            for m in group:
                # Find body brace
                body_brace_line, body_brace_col = find_body_brace(lines, m['start'])
                if body_brace_line == -1:
                    print(f"  WARNING: could not find body brace for {m['name']}")
                    continue

                # Extract signature
                sig_text = extract_signature(lines, m['start'], body_brace_line, body_brace_col)
                parsed = parse_signature(sig_text)
                if not parsed:
                    print(f"  WARNING: could not parse signature for {m['name']}")
                    continue

                # Extract body lines (after body brace, before closing brace at m['end'])
                body_lines = []
                # Content after brace on the same line
                after_brace = lines[body_brace_line][body_brace_col+1:]
                if after_brace.strip():
                    body_lines.append(after_brace.rstrip('\n'))
                # Lines between body brace and closing brace (exclusive of closing brace)
                for k in range(body_brace_line + 1, m['end']):
                    body_lines.append(lines[k].rstrip('\n'))

                func = create_function(parsed, body_lines, class_name)
                f.write(func + "\n\n")

        total = sum(m['size'] for m in group)
        print(f"  {base_name}-{suffix}.ts: {len(group)} methods, {total} lines")

    # Replace methods in main file with wrappers
    replacements = []
    for group in groups:
        for m in group:
            body_brace_line, body_brace_col = find_body_brace(lines, m['start'])
            if body_brace_line == -1:
                continue
            sig_text = extract_signature(lines, m['start'], body_brace_line, body_brace_col)
            parsed = parse_signature(sig_text)
            if not parsed:
                continue
            wrapper = create_wrapper(parsed)
            jsdoc_start = m['jsdoc_start']
            replacements.append((jsdoc_start, m['end'], wrapper))

    # Apply replacements from bottom to top
    new_lines = lines[:]
    for start, end, wrapper in sorted(replacements, key=lambda x: -x[0]):
        new_lines = new_lines[:start] + [wl + '\n' for wl in wrapper.split('\n')] + new_lines[end+1:]

    with open(file_path, 'w') as f:
        f.writelines(new_lines)

    print(f"\nMain file: {len(lines)} -> {len(new_lines)} lines")

if __name__ == '__main__':
    main()
