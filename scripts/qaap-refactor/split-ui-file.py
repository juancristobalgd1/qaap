#!/usr/bin/env python3
"""Split a large TypeScript class file by extracting methods to new files."""
import re
import sys
import os
from pathlib import Path

# Reserved words that are NOT method names
RESERVED = {
    'if', 'for', 'while', 'switch', 'return', 'throw', 'const', 'let', 'var',
    'do', 'try', 'catch', 'finally', 'else', 'case', 'break', 'continue',
    'new', 'await', 'yield', 'super', 'this', 'class', 'interface', 'type',
    'enum', 'import', 'export', 'from', 'as', 'default', 'namespace',
    'function', 'extends', 'implements', 'get', 'set',  # get/set handled separately
    'readonly', 'static', 'public', 'protected', 'private', 'abstract',
}

def find_methods(lines, class_start_line):
    """Find all method boundaries in the class body (indentation = 4 spaces)."""
    methods = []
    i = class_start_line
    while i < len(lines):
        line = lines[i]
        stripped = line.lstrip()
        indent = len(line) - len(stripped)

        # Only match at class body level (exactly 4 spaces)
        if indent != 4 or not stripped:
            i += 1
            continue

        # Skip comments
        if stripped.startswith('//') or stripped.startswith('*') or stripped.startswith('/*'):
            i += 1
            continue

        # Skip field declarations (end with ; not {)
        if stripped.endswith(';') and '{' not in stripped:
            i += 1
            continue

        # Match method pattern: (modifiers)? name(
        # Modifiers: public, protected, private, async, static, override
        method_pattern = r'^((?:public |protected |private |async |override )*)(\w+)\s*\('
        match = re.match(method_pattern, stripped)

        if not match:
            # Also match methods without modifiers (public by default)
            simple_match = re.match(r'^(\w+)\s*\(', stripped)
            if simple_match and simple_match.group(1) not in RESERVED:
                match = simple_match
                modifiers = ''
            else:
                i += 1
                continue
        else:
            modifiers = match.group(1).strip()
            name = match.group(2)
            if name in RESERVED:
                i += 1
                continue

        if 'match' not in dir() or not match:
            i += 1
            continue

        name = match.group(2) if match.lastindex >= 2 else match.group(1)

        # Skip constructor (keep it in the class)
        if name == 'constructor':
            i += 1
            continue

        start = i

        # Find the end of the method by tracking brace depth
        j = i
        brace_depth = 0
        found_open_brace = False
        while j < len(lines):
            for ch_idx, ch in enumerate(lines[j]):
                # Skip strings and comments
                if ch == '/' and ch_idx + 1 < len(lines[j]) and lines[j][ch_idx+1] == '/':
                    break  # rest of line is comment
                if ch == '/' and ch_idx + 1 < len(lines[j]) and lines[j][ch_idx+1] == '*':
                    # Block comment start - skip to end
                    pass
                if ch == '{':
                    brace_depth += 1
                    found_open_brace = True
                elif ch == '}':
                    brace_depth -= 1
                    if found_open_brace and brace_depth == 0:
                        break
            if found_open_brace and brace_depth == 0:
                break
            j += 1

        end = j
        method_lines = lines[start:end+1]

        # Check if it's a thin wrapper (body is 1-3 lines)
        body_size = end - start + 1

        methods.append({
            'name': name,
            'modifiers': modifiers,
            'start': start,
            'end': end,
            'size': body_size,
            'lines': method_lines,
        })
        i = end + 1

    return methods

def parse_signature(method_lines):
    """Parse method signature to extract modifiers, name, params, return type, is_async."""
    # Collect signature lines until we find the opening brace
    sig_text = ''
    for line in method_lines:
        sig_text += line + '\n'
        if '{' in line:
            break

    sig_text = sig_text.strip()

    # Extract async
    is_async = 'async ' in sig_text.split('(')[0]

    # Extract modifiers
    modifier_match = re.match(r'^((?:public |protected |private |override )*)', sig_text)
    modifiers = modifier_match.group(1).strip() if modifier_match else ''

    # Find the method name
    name_match = re.search(r'(\w+)\s*\(', sig_text)
    if not name_match:
        return None
    name = name_match.group(1)

    # Find params (between first ( and matching ))
    paren_start = sig_text.find('(')
    if paren_start == -1:
        return None

    depth = 0
    paren_end = -1
    for i in range(paren_start, len(sig_text)):
        if sig_text[i] == '(':
            depth += 1
        elif sig_text[i] == ')':
            depth -= 1
            if depth == 0:
                paren_end = i
                break

    if paren_end == -1:
        return None

    params_str = sig_text[paren_start+1:paren_end].strip()

    # Return type (between ) and {)
    after_paren = sig_text[paren_end+1:]
    brace_pos = after_paren.find('{')
    return_type = after_paren[:brace_pos].strip() if brace_pos != -1 else after_paren.strip()
    if return_type.startswith(':'):
        return_type = return_type[1:].strip()
    elif return_type.startswith(': '):
        return_type = return_type[2:].strip()
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
    """Split parameter string by commas, respecting nested parens/brackets/braces."""
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
    """Extract parameter names from params string."""
    if not params_str.strip():
        return []
    names = []
    for p in split_params(params_str):
        p = p.strip()
        if not p:
            continue
        # Handle rest params
        p = p.lstrip('.')
        # Handle readonly
        p = p.replace('readonly ', '')
        # Extract name (before : or ?)
        name_match = re.match(r'(\w+)(\?)?:', p)
        if name_match:
            names.append(name_match.group(1))
        else:
            # Destructured or other pattern
            names.append(p.split(':')[0].strip().replace('...', ''))
    return names

def create_wrapper(sig, method_lines):
    """Create a thin wrapper that delegates to the extracted function."""
    name = sig['name']
    modifiers = sig['modifiers']
    is_async = sig['is_async']
    params_str = sig['params_str']
    return_type = sig['return_type']
    param_names = get_param_names(params_str)

    modifier_str = (modifiers + ' ') if modifiers else ''
    async_str = 'async ' if is_async else ''

    # Build wrapper
    lines = []
    sig_line = f"    {modifier_str}{async_str}{name}({params_str})"
    if return_type:
        sig_line += f": {return_type}"
    lines.append(sig_line + " {")

    call_args = ', '.join(['this'] + param_names) if param_names else 'this'
    if return_type and return_type != 'void':
        lines.append(f"        return {name}Extracted({call_args});")
    elif is_async:
        lines.append(f"        return {name}Extracted({call_args});")
    else:
        lines.append(f"        {name}Extracted({call_args});")

    lines.append("    }")
    return '\n'.join(lines)

def transform_to_function(method_lines, class_name):
    """Transform a method into an exported function with ctx as first param."""
    sig = parse_signature(method_lines)
    if not sig:
        return None

    name = sig['name']
    is_async = sig['is_async']
    params_str = sig['params_str']
    return_type = sig['return_type']

    # Build new params: ctx: ClassName, original params
    new_params = f"ctx: {class_name}"
    if params_str:
        new_params += f", {params_str}"

    async_str = 'async ' if is_async else ''
    new_sig = f"export {async_str}function {name}Extracted({new_params})"
    if return_type:
        new_sig += f": {return_type}"
    new_sig += " {"

    # Extract body (everything after the signature, before the closing brace)
    body_lines = []
    found_open_brace = False
    brace_depth = 0
    for line in method_lines:
        if not found_open_brace:
            for ch in line:
                if ch == '{':
                    brace_depth += 1
                    found_open_brace = True
                elif ch == '}':
                    brace_depth -= 1
            if found_open_brace:
                # Check if there's code after the brace on the same line
                brace_pos = line.find('{')
                after_brace = line[brace_pos+1:]
                if after_brace.strip():
                    body_lines.append(after_brace)
            continue

        body_lines.append(line)

    # Remove the last line if it's just the closing brace
    if body_lines and body_lines[-1].strip() == '}':
        body_lines = body_lines[:-1]

    # Replace this. with ctx.
    transformed_body = []
    for line in body_lines:
        new_line = line.replace('this.', 'ctx.')
        transformed_body.append(new_line)

    result = new_sig + '\n'
    if transformed_body:
        result += '\n'.join(transformed_body)
    result += '\n}'

    return result

def main():
    if len(sys.argv) < 4:
        print("Usage: split-ui-file.py <file.ts> <class_name> <output_prefix>")
        sys.exit(1)

    file_path = sys.argv[1]
    class_name = sys.argv[2]
    output_prefix = sys.argv[3]

    with open(file_path, 'r') as f:
        content = f.read()
    lines = content.split('\n')

    # Find class declaration
    class_line = -1
    for i, line in enumerate(lines):
        if f'class {class_name}' in line and 'export' in line:
            class_line = i
            break
    if class_line == -1:
        for i, line in enumerate(lines):
            if f'class {class_name}' in line:
                class_line = i
                break

    if class_line == -1:
        print(f"Class {class_name} not found in {file_path}")
        sys.exit(1)

    # Find the opening brace of the class
    class_brace = -1
    for i in range(class_line, len(lines)):
        if '{' in lines[i]:
            class_brace = i
            break

    # Find methods
    methods = find_methods(lines, class_brace + 1)

    print(f"Found {len(methods)} methods")
    total_method_lines = 0
    for m in methods:
        size = m['size']
        total_method_lines += size
        marker = " [thin wrapper]" if size <= 4 else ""
        print(f"  {m['name']}: lines {m['start']+1}-{m['end']+1} ({size} lines){marker}")

    # Filter out thin wrappers (already delegating to helpers)
    methods_to_extract = [m for m in methods if m['size'] > 4]

    print(f"\n{len(methods_to_extract)} methods to extract ({total_method_lines} total lines)")

    # Group methods into files of ~400-500 lines
    groups = []
    current_group = []
    current_size = 0

    for m in methods_to_extract:
        size = m['size']
        if current_size + size > 450 and current_group:
            groups.append(current_group)
            current_group = []
            current_size = 0
        current_group.append(m)
        current_size += size

    if current_group:
        groups.append(current_group)

    print(f"\nSplit into {len(groups)} files:")
    base_name = Path(file_path).stem
    suffixes = ['render', 'streaming', 'timeline', 'activity', 'tool-pills',
                'live-status', 'thought-brief', 'diff', 'misc', 'misc2', 'misc3']

    for gi, group in enumerate(groups):
        suffix = suffixes[gi] if gi < len(suffixes) else f'misc{gi}'
        total = sum(m['size'] for m in group)
        print(f"  {base_name}-{suffix}.ts: {len(group)} methods, {total} lines")

    # Generate new files
    for gi, group in enumerate(groups):
        suffix = suffixes[gi] if gi < len(suffixes) else f'misc{gi}'
        new_filename = f"{base_name}-{suffix}.ts"
        new_path = os.path.join(os.path.dirname(file_path), new_filename)

        functions = []
        for m in group:
            func = transform_to_function(m['lines'], class_name)
            if func:
                functions.append(func)

        with open(new_path, 'w') as f:
            f.write(f"// Extracted from {base_name}.ts\n")
            f.write(f"// Auto-generated by split-ui-file.py — do not edit manually.\n\n")
            f.write(f"import type {{ {class_name} }} from './{base_name}';\n\n")
            for func in functions:
                f.write(func)
                f.write("\n\n")

        print(f"  Wrote {new_path}")

    # Generate wrappers for the main file
    new_lines = lines.copy()
    replacements = {}

    for group in groups:
        for m in group:
            sig = parse_signature(m['lines'])
            if not sig:
                print(f"  WARNING: Could not parse signature for {m['name']}")
                continue
            wrapper = create_wrapper(sig, m['lines'])
            if wrapper:
                replacements[m['start']] = (m['end'], wrapper)

    # Apply replacements from bottom to top
    for start in sorted(replacements.keys(), reverse=True):
        end, wrapper = replacements[start]
        new_lines = new_lines[:start] + wrapper.split('\n') + new_lines[end+1:]

    with open(file_path, 'w') as f:
        f.write('\n'.join(new_lines))

    print(f"\nMain file updated: {file_path}")
    print(f"New line count: {len(new_lines)} (was {len(lines)})")

if __name__ == '__main__':
    main()
