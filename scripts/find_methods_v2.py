#!/usr/bin/env python3
"""Find method boundaries in a TypeScript class, handling multi-line signatures with type annotations."""
import re
import sys

RESERVED = {
    'if', 'for', 'while', 'switch', 'return', 'throw', 'const', 'let', 'var',
    'do', 'try', 'catch', 'finally', 'else', 'case', 'break', 'continue',
    'new', 'await', 'yield', 'super', 'this', 'class', 'interface', 'type',
    'enum', 'import', 'export', 'from', 'as', 'default', 'namespace',
    'function', 'extends', 'implements', 'readonly', 'static', 'abstract',
}

def skip_strings_and_comments(text, start, end_char):
    """Scan text from start position, skipping strings and comments. Return position of end_char or -1."""
    i = start
    in_str = None
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == '\\':
                i += 2
                continue
            if ch == in_str:
                in_str = None
            i += 1
            continue
        if ch == "'" or ch == '"' or ch == '`':
            in_str = ch
        elif ch == '/' and i+1 < len(text) and text[i+1] == '/':
            # Line comment - skip to end of line
            while i < len(text) and text[i] != '\n':
                i += 1
            continue
        elif ch == '/' and i+1 < len(text) and text[i+1] == '*':
            # Block comment
            i += 2
            while i < len(text) - 1 and not (text[i] == '*' and text[i+1] == '/'):
                i += 1
            i += 2
            continue
        elif ch == end_char:
            return i
        i += 1
    return -1

def find_matching_brace(lines, start_line, start_col):
    """Find the matching } for a { at (start_line, start_col), tracking depth."""
    depth = 0
    in_str = None  # persists across lines ONLY for backtick strings
    in_block_comment = False  # persists across lines for /* ... */
    for i in range(start_line, len(lines)):
        text = lines[i]
        col_offset = start_col if i == start_line else 0
        j = col_offset
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
                break  # rest is line comment
            elif ch == '/' and j+1 < len(text) and text[j+1] == '*':
                in_block_comment = True
                j += 2
                continue
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return i, j
            j += 1
    return -1, -1

def find_methods(lines, class_start):
    """Find all methods by looking for method signatures and tracking braces properly."""
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

        # Match method pattern
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

        # Find JSDoc before method
        jsdoc_start = i
        for k in range(i-1, -1, -1):
            kline = lines[k].rstrip('\n').strip()
            if kline == '' or kline.startswith('//'):
                continue
            if kline.startswith('/**') or kline.startswith('*'):
                jsdoc_start = k
            else:
                break

        start = i

        # Find the opening brace of the method body
        # First, find the closing ) of the parameter list
        # Then find the { after it
        # We need to track paren depth, handling nested parens, generics, strings, comments

        # Collect all text from start line until we find the opening { of the body
        paren_depth = 0
        angle_depth = 0
        brace_depth = 0
        found_open_paren = False
        found_close_paren = False
        seen_return_colon = False  # track ':' after close paren
        seen_return_type_word = False  # track alphanumeric chars in return type
        body_brace_line = -1
        body_brace_col = -1
        in_str = None  # persists across lines ONLY for backtick strings
        in_block_comment = False  # persists across lines for /* ... */

        for k in range(i, min(i + 50, len(lines))):
            text = lines[k]
            col_start = 0 if k > i else 0
            j = col_start
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
                    if found_close_paren and seen_return_colon:
                        seen_return_type_word = True
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
                        # Could be body brace or return type object literal
                        if seen_return_colon and not seen_return_type_word:
                            # Return type is { ... } - this is the type, not body
                            brace_depth += 1
                        else:
                            body_brace_line = k
                            body_brace_col = j
                            break
                    else:
                        brace_depth += 1
                elif ch == '}' and found_close_paren and brace_depth > 0:
                    brace_depth -= 1
                elif found_close_paren and seen_return_colon and ch.isalpha():
                    seen_return_type_word = True
                j += 1
            if body_brace_line != -1:
                break

        if body_brace_line == -1:
            i += 1
            continue

        # Find the matching closing brace
        end_line, end_col = find_matching_brace(lines, body_brace_line, body_brace_col)
        if end_line == -1:
            i += 1
            continue

        size = end_line - start + 1
        methods.append({
            'name': name,
            'modifiers': method_match.group(1).strip(),
            'start': start,
            'end': end_line,
            'jsdoc_start': jsdoc_start if jsdoc_start < start else start,
            'size': size,
        })
        i = end_line + 1

    return methods

def main():
    file_path = sys.argv[1]
    class_name = sys.argv[2]

    with open(file_path) as f:
        lines = f.readlines()

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

    total = 0
    extractable = 0
    for m in methods:
        total += m['size']
        if m['size'] > 4:
            extractable += m['size']
            print(f"  {m['name']}: L{m['start']+1}-{m['end']+1} ({m['size']} lines) [{m['modifiers']}]")

    print(f"\n{len(methods)} methods total, {total} lines")
    print(f"{sum(1 for m in methods if m['size'] > 4)} methods extractable, {extractable} lines")
    print(f"File: {len(lines)} lines, class body: {len(lines) - class_start} lines")

if __name__ == '__main__':
    main()
