const SPREADSHEET_FORMULA_PREFIX_PATTERN = /^\s*[=+\-@]/;

function neutralizeSpreadsheetFormula(value) {
  return SPREADSHEET_FORMULA_PREFIX_PATTERN.test(value) ? `'${value}` : value;
}

export function escapeCsvValue(value) {
  if (value == null) {
    return '';
  }

  const normalized = neutralizeSpreadsheetFormula(String(value));
  if (/[",\r\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  return normalized;
}

export function createCsvContent(headers, rows) {
  const lines = [
    headers.map((value) => escapeCsvValue(value)).join(','),
    ...rows.map((row) => row.map((value) => escapeCsvValue(value)).join(',')),
  ];

  return `\uFEFF${lines.join('\r\n')}`;
}
