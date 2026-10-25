/** Lógica pura de validación CSV. No necesita servicios ni librerías externas. */

export function parseDelimited(source, delimiter = ',') {
  const input = String(source).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  const appendRow = () => {
    row.push(cell);
    if (row.some(value => value.trim() !== '')) rows.push(row);
    row = [];
    cell = '';
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += char;
    } else if (char === '"' && cell.trim() === '') {
      quoted = true;
    } else if (char === '"') {
      throw new Error('El CSV contiene comillas en una posición inválida. Encierra el valor entre comillas dobles e inténtalo nuevamente.');
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      appendRow();
    } else cell += char;
  }
  if (quoted) throw new Error('El CSV contiene comillas sin cerrar. Corrige el archivo e inténtalo nuevamente.');
  if (cell !== '' || row.length) appendRow();
  return rows;
}

/** Elige el separador con más columnas y filas uniformes. */
export function detectDelimiter(source) {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestScore = -Infinity;
  for (const delimiter of candidates) {
    let rows;
    try { rows = parseDelimited(source, delimiter).slice(0, 25); }
    catch { continue; }
    if (!rows.length) continue;
    const widths = rows.map(row => row.length);
    const columns = widths[0];
    const consistent = widths.filter(width => width === columns).length / widths.length;
    const score = (columns > 1 ? 10 + columns : 0) + consistent * 7;
    if (score > bestScore) { bestScore = score; best = delimiter; }
  }
  return best;
}

function uniqueHeaders(original, count) {
  const seen = new Set();
  return Array.from({ length: count }, (_, i) => {
    const base = (original[i] || '').trim() || `Columna ${i + 1}`;
    let label = base;
    let suffix = 2;
    while (seen.has(label.toLowerCase())) label = `${base} (${suffix++})`;
    seen.add(label.toLowerCase());
    return label;
  });
}

export function analyzeCsv(source) {
  if (!String(source).trim()) throw new Error('El archivo está vacío.');
  const delimiter = detectDelimiter(source);
  const parsed = parseDelimited(source, delimiter);
  if (parsed.length < 2) throw new Error('El archivo debe incluir encabezados y al menos un registro.');
  const count = Math.max(...parsed.map(row => row.length));
  if (count > 200) throw new Error('El archivo tiene más de 200 columnas. Usa un archivo más pequeño.');
  const headers = uniqueHeaders(parsed[0], count);
  const headerWidth = parsed[0].length;
  const keys = new Set();
  let emptyCells = 0;
  let duplicateRows = 0;
  let irregularRows = 0;
  let paddedCells = 0;
  const colEmpty = new Array(count).fill(0);
  const colPadded = new Array(count).fill(0);
  const colUnique = Array.from({ length: count }, () => new Set());
  const rows = parsed.slice(1).map((values, index) => {
    const raw = headers.map((_, j) => values[j] ?? '');
    const cells = raw.map(value => value.trim());
    let blanks = 0;
    cells.forEach((value, j) => {
      if (value === '') { blanks++; colEmpty[j]++; }
      else {
        colUnique[j].add(value);
        if (raw[j] !== value) { colPadded[j]++; paddedCells++; }
      }
    });
    emptyCells += blanks;
    // Fila irregular: su cantidad de celdas difiere de la del encabezado
    // (antes se rellenaba/recortaba en silencio y el problema quedaba oculto).
    const irregular = values.length !== headerWidth;
    if (irregular) irregularRows++;
    const fingerprint = JSON.stringify(cells);
    const isDuplicate = keys.has(fingerprint);
    if (isDuplicate) duplicateRows++;
    keys.add(fingerprint);
    return { number: index + 1, cells, incomplete: blanks > 0, duplicate: isDuplicate, irregular };
  });
  if (rows.length > 20000) throw new Error('Se admiten hasta 20 000 registros por archivo.');
  const columns = headers.map((name, colIndex) => {
    const empty = colEmpty[colIndex];
    return {
      name, empty, complete: rows.length - empty,
      percentage: rows.length ? (rows.length - empty) / rows.length * 100 : 0,
      unique: colUnique[colIndex].size,
      padded: colPadded[colIndex]
    };
  });
  const blankPercent = rows.length ? emptyCells / (rows.length * headers.length) * 100 : 0;
  const duplicatePercent = rows.length ? duplicateRows / rows.length * 100 : 0;
  return {
    delimiter, headers, rows, columns, emptyCells, duplicateRows,
    irregularRows, paddedCells,
    incompleteRows: rows.filter(row => row.incomplete).length,
    blankPercent,
    duplicatePercent,
    /** Puntaje global 0–100: penaliza el % de celdas vacías y el % de filas duplicadas. */
    qualityScore: Math.max(0, Math.round(100 - blankPercent - duplicatePercent))
  };
}

/** Evita inyección de fórmulas al abrir el CSV exportado en una hoja de cálculo. */
export function csvCell(value) {
  let text = String(value ?? '');
  // OWASP (CSV Injection): también neutralizar celdas que comienzan con | o %
  // (vectores DDE/fórmula en algunas hojas de cálculo), no solo =, +, - y @.
  if (/^[\s]*[=+@%|-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * Genera un CSV con los datos originales pero sin filas duplicadas
 * (conserva la primera aparición de cada fila). Usa el delimitador
 * detectado en el archivo de origen y celdas protegidas con csvCell.
 */
export function makeCleanCsv(analysis) {
  const kept = analysis.rows.filter(row => !row.duplicate);
  const lines = [analysis.headers, ...kept.map(row => row.cells)];
  return '\uFEFF' + lines.map(line => line.map(csvCell).join(analysis.delimiter)).join('\r\n');
}

export function makeReport(analysis, filename) {
  const records = [
    ['Tipo', 'Campo / indicador', 'Valor', 'Porcentaje'],
    ['General', 'Archivo', filename, ''],
    ['General', 'Registros', analysis.rows.length, ''],
    ['General', 'Columnas', analysis.headers.length, ''],
    ['General', 'Celdas vacías', analysis.emptyCells, analysis.blankPercent.toFixed(2) + '%'],
    ['General', 'Filas duplicadas', analysis.duplicateRows, ''],
    ['General', 'Filas con vacíos', analysis.incompleteRows, ''],
    ['General', 'Filas con columnas de más/menos', analysis.irregularRows ?? 0, ''],
    ['General', 'Celdas con espacios al inicio/final', analysis.paddedCells ?? 0, ''],
    ['General', 'Puntaje de calidad', analysis.qualityScore + ' / 100', ''],
    ...analysis.columns.map(col => ['Columna', col.name, `${col.empty} vacíos · ${col.unique ?? 0} únicos`, col.percentage.toFixed(2) + '% completo'])
  ];
  return '\uFEFF' + records.map(record => record.map(csvCell).join(',')).join('\r\n');
}
