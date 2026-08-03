#!/usr/bin/env python3
"""Extract methods from a TypeScript class to new files, replacing with thin wrappers."""
import re
import sys
import os
from pathlib import Path

RESERVED = {
    'if', 'for', 'while', 'switch', 'return', 'throw', 'const', 'let', 'var',
    'do', 'try', 'catch', 'finally', 'else', 'case', 'break', 'continue',
    'new', 'await', 'yield', 'super', 'this', 'class', 'interface', 'type',
    'enum', 'import', 'export', 'from', 'as', 'default', 'namespace',
    'function', 'extends', 'implements', 'readonly', 'static', 'abstract',
}

def find_methods(lines, class_start):
    """Find all methods by tracking brace depth at class body level."""
    methods = []
    i = class_start
    while i < len(lines):
        line = lines[i].rstrip('\n')
        stripped = line.lstrip()
        indent = len(line) - len(stripped)

        if indent != 4 or not stripped or stripped.startswith('//') or stripped.startswith('*') or stripped.startswith('/*'):
            i += 1
            continue

        if stripped == '}' or stripped.startswith('})'):
            i += 1
            continue

        method_match = re.match(
            r'^((?:public |protected |private |async |override )*)'
            r'(\w+)\s*(?:\(|<)',
            stripped
        )
        if not method_match:
            i += 1
            continue

        name = method_match.group(2)
        if name in RESERVED or name == 'constructor':
            i += 1
            continue

        # Find JSDoc comment before method
        jsdoc_start = i
        for k in range(i-1, -1, -1):
            kline = lines[k].rstrip('\n').strip()
            if kline == '' or kline.startswith('//'):
                continue
            if kline.startswith('/**') or kline.startswith('*'):
                jsdoc_start = k
            else:
                break

        # Find method end by tracking braces
        start = i
        temp_depth = 0
        found_body = False
        end = i
        for k in range(i, len(lines)):
            kstripped = lines[k].lstrip()
            in_str = None
            m = 0
            while m < len(kstripped):
                ch = kstripped[m]
                if in_str:
                    if ch == '\\':
                        m += 2
                        continue
                    if ch == in_str:
                        in_str = None
                    m += 1
                    continue
                if ch in '"\'`':
                    in_str = ch
                elif ch == '/' and m+1 < len(kstripped) and kstripped[m+1] == '/':
                    break
                elif ch == '{':
                    temp_depth += 1
                    found_body = True
                elif ch == '}':
                    temp_depth -= 1
                    if found_body and temp_depth == 0:
                        end = k
                        break
                m += 1
            if found_body and temp_depth == 0:
                end = k
                break

        size = end - start + 1
        methods.append({
            'name': name,
            'modifiers': method_match.group(1).strip(),
            'start': start,
            'end': end,
            'jsdoc_start': jsdoc_start if jsdoc_start < start else start,
            'size': size,
        })
        i = end + 1

    return methods

def extract_full_signature(method_lines):
    """Extract the complete signature text from method lines."""
    sig = ''
    for line in method_lines:
        sig += line.rstrip('\n') + ' '
        if '{' in line:
            # Check if brace is in a string
            in_str = None
            for ch in line:
                if in_str:
                    if ch == '\\':
                        continue
                    if ch == in_str:
                        in_str = None
                elif ch in '"\'`':
                    in_str = ch
                elif ch == '{':
                    return sig.strip()
            return sig.strip()
    return sig.strip()

def parse_method(method_lines):
    """Parse method to get name, modifiers, params, return type, is_async, body."""
    full_sig = extract_full_signature(method_lines)

    # Extract async
    is_async = bool(re.match(r'^.*async ', full_sig))

    # Extract modifiers
    modifier_match = re.match(r'^((?:public |protected |private |override )*)', full_sig)
    modifiers = modifier_match.group(1).strip() if modifier_match else ''

    # Find method name
    name_match = re.search(r'(\w+)\s*(?:\(|<)', full_sig)
    if not name_match:
        return None
    name = name_match.group(1)

    # Find params
    paren_start = full_sig.find('(')
    if paren_start == -1:
        return None

    depth = 0
    paren_end = -1
    for idx in range(paren_start, len(full_sig)):
        if full_sig[idx] == '(':
            depth += 1
        elif full_sig[idx] == ')':
            depth -= 1
            if depth == 0:
                paren_end = idx
                break
    if paren_end == -1:
        return None

    params_str = full_sig[paren_start+1:paren_end].strip()

    # Return type
    after_paren = full_sig[paren_end+1:]
    brace_pos = -1
    in_str = None
    for idx, ch in enumerate(after_paren):
        if in_str:
            if ch == '\\':
                continue
            if ch == in_str:
                in_str = None
        elif ch in '"\'`':
            in_str = ch
        elif ch == '{':
            brace_pos = idx
            break
    return_type = after_paren[:brace_pos].strip() if brace_pos != -1 else after_paren.strip()
    if return_type.startswith(':'):
        return_type = return_type[1:].strip()
    else:
        return_type = ''

    # Extract body lines (after the line with opening brace)
    body_lines = []
    found_open_brace_line = False
    for line in method_lines:
        if not found_open_brace_line:
            # Check if this line has the opening brace
            in_str = None
            for ch in line:
                if in_str:
                    if ch == '\\':
                        continue
                    if ch == in_str:
                        in_str = None
                elif ch in '"\'`':
                    in_str = ch
                elif ch == '{':
                    found_open_brace_line = True
                    break
            if found_open_brace_line:
                # Get content after the brace
                brace_idx = line.find('{')
                after = line[brace_idx+1:]
                if after.strip():
                    body_lines.append(after)
            continue
        body_lines.append(line)

    # Remove closing brace (last line that is just })
    if body_lines and body_lines[-1].strip() == '}':
        body_lines = body_lines[:-1]
    elif body_lines:
        # The closing brace might be on the same line as the last statement
        last = body_lines[-1].rstrip()
        if last.endswith('}'):
            body_lines[-1] = last[:-1]

    return {
        'name': name,
        'modifiers': modifiers,
        'is_async': is_async,
        'params_str': params_str,
        'return_type': return_type,
        'body_lines': body_lines,
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
    """Create a thin wrapper."""
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

def create_function(parsed, class_name):
    """Create an exported function with ctx as first param."""
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

    body = '\n'.join(parsed['body_lines'])
    body = body.replace('this.', 'ctx.')

    return f"{sig}\n{body}\n}}"

def main():
    if len(sys.argv) < 4:
        print("Usage: extract-methods.py <file.ts> <class_name> <output_prefix>")
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

    # Filter to methods > 4 lines (skip thin wrappers)
    to_extract = [m for m in methods if m['size'] > 4]

    print(f"Found {len(methods)} methods, {len(to_extract)} to extract")

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

    suffixes = ['render', 'streaming', 'timeline', 'activity', 'tool-pills',
                'live-status', 'thought-brief', 'diff', 'misc', 'misc2', 'misc3',
                'misc4', 'misc5', 'misc6', 'misc7', 'misc8']

    base_name = Path(file_path).stem
    dir_name = os.path.dirname(file_path)

    # Collect all import lines from the main file
    import_lines = []
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith('import '):
            import_lines.append(line)
        elif stripped.startswith("} from '") or stripped.startswith("} from \""):
            # Continuation of multi-line import
            if import_lines:
                import_lines[-1] = import_lines[-1].rstrip('\n') + line
            else:
                import_lines.append(line)

    print(f"Split into {len(groups)} files")

    # Create new files
    for gi, group in enumerate(groups):
        suffix = suffixes[gi] if gi < len(suffixes) else f'misc{gi}'
        new_path = os.path.join(dir_name, f"{base_name}-{suffix}.ts")

        with open(new_path, 'w') as f:
            f.write(f"// Extracted from {base_name}.ts\n")
            f.write(f"// Auto-generated — do not edit manually.\n\n")
            # Copy all imports from main file
            for imp in import_lines:
                f.write(imp if imp.endswith('\n') else imp + '\n')
            f.write('\n')

            for m in group:
                method_lines = lines[m['start']:m['end']+1]
                parsed = parse_method(method_lines)
                if not parsed:
                    print(f"  WARNING: could not parse {m['name']}")
                    continue
                func = create_function(parsed, class_name)
                f.write(func + "\n\n")

        total = sum(m['size'] for m in group)
        print(f"  {base_name}-{suffix}.ts: {len(group)} methods, {total} lines")

    # Replace methods in main file with wrappers
    # Build a list of (start, end, replacement) for all methods
    replacements = []
    for group in groups:
        for m in group:
            method_lines = lines[m['start']:m['end']+1]
            parsed = parse_method(method_lines)
            if not parsed:
                continue
            wrapper = create_wrapper(parsed)
            # Include JSDoc in the replacement range
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
