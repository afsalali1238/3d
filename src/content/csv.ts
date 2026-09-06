/**
 * RFC 4180 CSV parser.
 *
 * Hand-rolled rather than a dependency because this runs at build time only
 * and the failure messages need to be readable by a physiotherapist, not a
 * developer. It handles the things a real spreadsheet export contains:
 * quoted fields, embedded commas, embedded newlines, escaped quotes (""),
 * CRLF, and a UTF-8 BOM (Excel adds one).
 */

export type CsvRow = {
  /** 1-based line number in the source file, for error messages */
  line: number;
  cells: Record<string, string>;
};

export type CsvTable = {
  headers: string[];
  rows: CsvRow[];
};

export class CsvError extends Error {
  constructor(
    message: string,
    readonly file: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'CsvError';
  }
}

/** Split raw CSV text into a grid, tracking the line each record started on. */
function parseGrid(text: string): Array<{ line: number; fields: string[] }> {
  // strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const out: Array<{ line: number; fields: string[] }> = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let started = false;

  const endField = () => {
    fields.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    // ignore completely blank lines
    if (!(fields.length === 1 && fields[0].trim() === '')) {
      out.push({ line: recordLine, fields });
    }
    fields = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!started) {
      recordLine = line;
      started = true;
    }

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }

    if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === ',') {
      endField();
    } else if (c === '\r') {
      // handled by the \n that follows
    } else if (c === '\n') {
      endRecord();
      line++;
    } else {
      field += c;
    }
  }

  if (started || field !== '' || fields.length > 0) endRecord();
  return out;
}

/**
 * Parse CSV into named rows.
 * @param file  path, used only in error messages
 */
export function parseCsv(file: string, text: string): CsvTable {
  const grid = parseGrid(text);
  if (grid.length === 0) return { headers: [], rows: [] };

  const headers = grid[0].fields.map((h) => h.trim());

  const dupes = headers.filter((h, i) => h !== '' && headers.indexOf(h) !== i);
  if (dupes.length) {
    throw new CsvError(`duplicate column heading(s): ${[...new Set(dupes)].join(', ')}`, file, 1);
  }

  const rows: CsvRow[] = [];
  for (const rec of grid.slice(1)) {
    if (rec.fields.length > headers.length) {
      throw new CsvError(
        `this row has ${rec.fields.length} values but there are only ${headers.length} columns. ` +
          `If a value contains a comma, wrap it in "double quotes".`,
        file,
        rec.line,
      );
    }
    const cells: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) cells[h] = (rec.fields[i] ?? '').trim();
    });
    rows.push({ line: rec.line, cells });
  }

  return { headers, rows };
}

/** Serialise a value back to a CSV cell, quoting only when necessary. */
export function toCsvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(headers: string[], rows: Array<Record<string, string>>): string {
  const lines = [headers.map(toCsvCell).join(',')];
  for (const r of rows) lines.push(headers.map((h) => toCsvCell(r[h] ?? '')).join(','));
  return lines.join('\n') + '\n';
}
