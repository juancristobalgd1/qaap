export function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    let touched = false;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (quoted) {
            if (char === '"') {
                if (text[index + 1] === '"') {
                    field += '"';
                    index++;
                } else {
                    quoted = false;
                }
            } else {
                field += char;
            }
            continue;
        }
        if (char === '"') {
            quoted = true;
            touched = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
            touched = true;
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[index + 1] === '\n') {
                index++;
            }
            if (touched || field.length > 0) {
                row.push(field);
                rows.push(row);
            }
            row = [];
            field = '';
            touched = false;
        } else {
            field += char;
            touched = true;
        }
    }
    if (touched || field.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

function quote(field) {
    return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

export function toCsv(rows) {
    return `${rows.map(row => row.map(quote).join(',')).join('\n')}\n`;
}
