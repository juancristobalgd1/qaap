#!/usr/bin/env python3
"""Find method boundaries in a TypeScript class by tracking brace depth."""
import re
import sys

def find_methods(lines, class_start):
    """Find all methods by tracking brace depth at class body level."""
    methods = []
    i = class_start
    brace_depth = 0  # depth relative to class body

    while i < len(lines):
        line = lines[i]
        raw = line.rstrip('\n')
        stripped = raw.lstrip()
        indent = len(raw) - len(stripped)

        # Track braces, skipping strings and comments
        in_string = None
        j = 0
        while j < len(stripped):
            ch = stripped[j]
            if in_string:
                if ch == '\\':
                    j += 2
                    continue
                if ch == in_string:
                    in_string = None
                j += 1
                continue
            if ch == "'" or ch == '"' or ch == '`':
                in_string = ch
            elif ch == '/' and j+1 < len(stripped) and stripped[j+1] == '/':
                break  # rest is comment
            elif ch == '{':
                brace_depth += 1
            elif ch == '}':
                brace_depth -= 1
            j += 1

        # At class body level (brace_depth was 0 at start of line, and we're at 4-space indent)
        if indent == 4 and stripped:
            # Check if this looks like a method declaration
            # Skip comments, closing braces, JSDoc
            if stripped.startswith('//') or stripped.startswith('*') or stripped.startswith('/*'):
                i += 1
                continue
            if stripped == '}' or stripped.startswith('})'):
                i += 1
                continue

            # Check for method pattern: optional modifiers + name + (
            # But NOT control flow keywords
            method_match = re.match(
                r'^((?:public |protected |private |async |override )*)'
                r'(\w+)\s*(?:\(|<)',
                stripped
            )
            if method_match:
                name = method_match.group(2)
                if name in {'if', 'for', 'while', 'switch', 'return', 'throw',
                            'const', 'let', 'var', 'do', 'try', 'catch', 'finally',
                            'else', 'case', 'break', 'continue', 'new', 'await',
                            'yield', 'super', 'this', 'class', 'interface', 'type',
                            'enum', 'import', 'export', 'from', 'as', 'default',
                            'namespace', 'function', 'extends', 'implements',
                            'readonly', 'static', 'abstract', 'constructor'}:
                    i += 1
                    continue

                # Also match methods without modifiers
                start = i
                # Find the end: scan forward until brace_depth returns to 0
                # (relative to where we started seeing the method body)
                end = i
                found_body = False
                temp_depth = 0
                for k in range(i, len(lines)):
                    kline = lines[k].rstrip('\n')
                    kstripped = kline.lstrip()
                    # Track braces in this line
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
                        if ch == "'" or ch == '"' or ch == '`':
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
                    'size': size,
                })
                i = end + 1
                continue

        i += 1

    return methods

def main():
    file_path = sys.argv[1]
    class_name = sys.argv[2]

    with open(file_path) as f:
        lines = f.readlines()

    # Find class
    class_start = None
    for i, line in enumerate(lines):
        if f'class {class_name}' in line:
            # Find opening brace
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
        else:
            pass  # skip thin wrappers in output

    print(f"\n{len(methods)} methods total, {total} lines")
    print(f"{sum(1 for m in methods if m['size'] > 4)} methods extractable, {extractable} lines")
    print(f"File: {len(lines)} lines, class body: {len(lines) - class_start} lines")

if __name__ == '__main__':
    main()
