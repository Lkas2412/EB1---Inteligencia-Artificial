/** Lógica pura de validación CSV. No necesita servicios ni librerías externas. */

export function parseDelimited(source, delimiter = ',') {
  const input = String(source).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  const appendRow = () => {
    row.push(cell);
    // Se omiten solo las líneas físicamente en blanco (una única celda
    // vacía). Una fila con delimitadores y todas las celdas vacías (`,,`)
    // es un registro con campos vacíos: se conserva, para que el análisis
    // lo cuente como incompleto en vez de hacerlo desaparecer.
    if (row.length > 1 || row.some(value => value.trim() !== '')) rows.push(row);
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

/**
 * Decodifica los bytes de un archivo CSV: UTF-8 estricto y, si no es
 * válido, Windows-1252 (la codificación típica de Excel en Windows).
 * Devuelve también la codificación usada y si había BOM, para poder
 * avisar al usuario en vez de mostrar caracteres rotos sin explicación.
 */
export function decodeCsvData(buffer) {
  const bytes = new Uint8Array(buffer);
  const bom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
  const view = bom ? bytes.subarray(3) : bytes;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(view), encoding: 'utf-8', bom };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(view), encoding: 'windows-1252', bom };
  }
}

/** Secuencias típicas de texto dañado por doble codificación (mojibake). */
const MOJIBAKE_RE = /Ã[\u0080-\u00BF]|â€|�/;

/** Valores que suelen significar "sin dato" aunque la celda no esté vacía. */
const PLACEHOLDER_VALUES = new Set([
  'n/a', 'na', 'n.a.', 'null', 'none', 'unknown', 'desconocido', 'sin dato',
  'sin datos', 's/d', 'no aplica', 'no disponible', 'ninguno', '-', '--', '.'
]);

const TYPE_LABELS = {
  numero: 'Número', fecha: 'Fecha', correo: 'Correo', booleano: 'Booleano',
  texto: 'Texto', mixto: 'Mixto', vacio: 'Sin datos'
};

function isNumberValue(value) {
  return /^[+-]?\d+$/.test(value)                       // entero
    || /^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(value)    // 1.234 / 1.234,56
    || /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)    // 1,234 / 1,234.56
    || /^[+-]?\d+[.,]\d+$/.test(value);                 // 1234,56 / 1234.56
}

function isDateValue(value) {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value)
    || /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(value);
  if (!match) return false;
  let year, month, day;
  if (match[1].length === 4) { year = +match[1]; month = +match[2]; day = +match[3]; }
  else { day = +match[1]; month = +match[2]; year = +match[3]; }
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Verificación real: 31/02 se convierte en 3/03 y no coincide → no es fecha.
  // setUTCFullYear usa el año tal cual; Date.UTC mapearía 0–99 a 1900+año.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Convierte un valor ya clasificado como número a Number (formatos es/en). */
function parseNumberValue(value) {
  let text = value;
  if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replaceAll('.', '').replace(',', '.'); // 1.234 / 1.234,56
  else if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replaceAll(',', '');              // 1,234 / 1,234.56
  else if (/^[+-]?\d+[.,]\d+$/.test(text)) text = text.replace(',', '.');                               // 1234,56 / 1234.56
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Milisegundos UTC de una fecha ya validada por isDateValue (para rangos). */
function dateTimeValue(value) {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value)
    || /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(value);
  if (!match) return null;
  let year, month, day;
  if (match[1].length === 4) { year = +match[1]; month = +match[2]; day = +match[3]; }
  else { day = +match[1]; month = +match[2]; year = +match[3]; }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

/** Clasifica una celda no vacía en un tipo simple. Heurística barata y sin librerías. */
export function classifyCell(value) {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return 'correo';
  if (isDateValue(value)) return 'fecha';
  if (isNumberValue(value)) return 'numero';
  if (/^(true|false|verdadero|falso|sí|si|no|yes)$/i.test(value)) return 'booleano';
  return 'texto';
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
  if (parsed.length - 1 > 20000) throw new Error('Se admiten hasta 20 000 registros por archivo.');
  // Ancho máximo con un bucle: Math.max(...parsed) revienta la pila
  // (RangeError) en archivos con cientos de miles de filas chicas.
  let count = 0;
  for (const row of parsed) if (row.length > count) count = row.length;
  if (count > 200) throw new Error('El archivo tiene más de 200 columnas. Usa un archivo más pequeño.');
  const headers = uniqueHeaders(parsed[0], count);
  const headerWidth = parsed[0].length;
  // Avisos de encabezado: un encabezado cuenta como duplicado si su
  // etiqueta final difiere del texto original (fue renombrado), incluidos
  // los choques contra las etiquetas «Columna N» de los vacíos.
  let duplicateHeaders = 0;
  let emptyHeaders = 0;
  parsed[0].forEach((cell, i) => {
    const base = (cell || '').trim();
    if (base === '') emptyHeaders++;
    else if (headers[i] !== base) duplicateHeaders++;
  });
  const keys = new Set();
  const normKeys = new Set();
  let emptyCells = 0;
  let duplicateRows = 0;
  let nearDuplicateRows = 0;
  let irregularRows = 0;
  let paddedCells = 0;
  let placeholderCells = 0;
  let mojibakeCells = 0;
  const colEmpty = new Array(count).fill(0);
  const colPadded = new Array(count).fill(0);
  const colPlaceholder = new Array(count).fill(0);
  const colUnique = Array.from({ length: count }, () => new Set());
  const colTypeCounts = Array.from({ length: count }, () => ({}));
  const colNums = Array.from({ length: count }, () => []);
  const colDates = Array.from({ length: count }, () => []);
  const colFreq = Array.from({ length: count }, () => new Map());
  const typesByRow = [];
  const rows = parsed.slice(1).map((values, index) => {
    const raw = headers.map((_, j) => values[j] ?? '');
    const cells = raw.map(value => value.trim());
    let blanks = 0;
    const rowTypes = new Array(count).fill(null);
    cells.forEach((value, j) => {
      if (value === '') { blanks++; colEmpty[j]++; }
      else {
        colUnique[j].add(value);
        if (raw[j] !== value) { colPadded[j]++; paddedCells++; }
        if (MOJIBAKE_RE.test(value)) mojibakeCells++;
        if (PLACEHOLDER_VALUES.has(value.toLowerCase())) { colPlaceholder[j]++; placeholderCells++; }
        else {
          // Los pseudo-vacíos no participan del tipo: ya se reportan aparte.
          const type = classifyCell(value);
          rowTypes[j] = type;
          colTypeCounts[j][type] = (colTypeCounts[j][type] || 0) + 1;
          colFreq[j].set(value, (colFreq[j].get(value) || 0) + 1);
          if (type === 'numero') { const n = parseNumberValue(value); if (n !== null) colNums[j].push({ row: index, v: n }); }
          else if (type === 'fecha') { const t = dateTimeValue(value); if (t !== null) colDates[j].push({ row: index, t, text: value }); }
        }
      }
    });
    typesByRow.push(rowTypes);
    emptyCells += blanks;
    // Fila irregular: su cantidad de celdas difiere de la del encabezado
    // (antes se rellenaba/recortaba en silencio y el problema quedaba oculto).
    const irregular = values.length !== headerWidth;
    if (irregular) irregularRows++;
    const fingerprint = JSON.stringify(cells);
    const isDuplicate = keys.has(fingerprint);
    if (isDuplicate) duplicateRows++;
    keys.add(fingerprint);
    // Casi duplicada: coincide con una fila previa solo tras normalizar
    // (minúsculas y espacios internos colapsados), sin ser duplicada exacta.
    const normFingerprint = JSON.stringify(cells.map(value => value.toLowerCase().replace(/\s+/g, ' ')));
    const isNearDuplicate = !isDuplicate && normKeys.has(normFingerprint);
    if (isNearDuplicate) nearDuplicateRows++;
    normKeys.add(normFingerprint);
    return { number: index + 1, cells, incomplete: blanks > 0, duplicate: isDuplicate, irregular, nearDuplicate: isNearDuplicate };
  });
  // Tipo de columna: el dominante si cubre al menos el 80 % de las celdas
  // clasificadas. En columnas de texto o mixtas no se marcan diferencias.
  let typeMismatchCells = 0;
  const colTypes = colTypeCounts.map(counts => {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((n, [, c]) => n + c, 0);
    if (!total) return { type: 'vacio', mismatches: 0 };
    const [topType, topCount] = entries[0];
    if (topCount / total < 0.8) return { type: 'mixto', mismatches: 0 };
    if (topType === 'texto') return { type: 'texto', mismatches: 0 };
    const mismatches = total - topCount;
    typeMismatchCells += mismatches;
    return { type: topType, mismatches };
  });
  rows.forEach((row, i) => {
    row.typeMismatch = typesByRow[i].some((type, j) => type !== null
      && colTypes[j].mismatches > 0 && type !== colTypes[j].type);
  });
  // Perfil estadístico por columna: descriptivas en las numéricas (con
  // atípicos por rango intercuartílico, que no se contamina con el propio
  // atípico como le pasa al desvío), rango en las de fecha y frecuentes.
  const quantile = (sorted, q) => {
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
  };
  let outlierCells = 0;
  const outlierRows = new Set();
  const colStats = headers.map((_, j) => {
    let stats = null;
    if (colTypes[j].type === 'numero' && colNums[j].length) {
      const sorted = colNums[j].map(e => e.v).sort((a, b) => a - b);
      const n = sorted.length;
      const mean = sorted.reduce((a, b) => a + b, 0) / n;
      const std = Math.sqrt(sorted.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
      const q1 = quantile(sorted, 0.25);
      const q3 = quantile(sorted, 0.75);
      const iqr = q3 - q1;
      let outliers = 0;
      if (iqr > 0) {
        const low = q1 - 1.5 * iqr;
        const high = q3 + 1.5 * iqr;
        for (const e of colNums[j]) if (e.v < low || e.v > high) { outliers++; outlierRows.add(e.row); }
      }
      outlierCells += outliers;
      // Histograma de 10 rangos para dibujar la distribución en el detalle.
      let histogram = null;
      if (sorted[n - 1] > sorted[0]) {
        const bins = new Array(10).fill(0);
        const width = (sorted[n - 1] - sorted[0]) / 10;
        for (const v of sorted) bins[Math.min(9, Math.floor((v - sorted[0]) / width))]++;
        histogram = bins;
      }
      stats = { min: sorted[0], max: sorted[n - 1], mean, median: quantile(sorted, 0.5), std, outliers, histogram };
    } else if (colTypes[j].type === 'fecha' && colDates[j].length) {
      let min = colDates[j][0];
      let max = colDates[j][0];
      for (const e of colDates[j]) { if (e.t < min.t) min = e; if (e.t > max.t) max = e; }
      stats = { min: min.text, max: max.text };
    }
    const topValues = [...colFreq[j].entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, c]) => ({ value, count: c }));
    return { stats, topValues };
  });
  rows.forEach((row, i) => { row.outlier = outlierRows.has(i); });
  // Colisiones de clave: una columna casi única (>= 90 % de valores
  // distintos) con algún valor repetido parece un identificador con
  // duplicados — el duplicado peligroso, porque la fila entera no se
  // repite: el mismo ID trae datos distintos y rompe cruces e importes.
  const keyCollisions = [];
  headers.forEach((_, j) => {
    const total = [...colFreq[j].values()].reduce((a, b) => a + b, 0);
    if (total < 5) return;
    const repeated = [...colFreq[j].values()].filter(c => c >= 2);
    if (repeated.length && colFreq[j].size / total >= 0.9) {
      keyCollisions.push({ name: headers[j], colIndex: j, values: repeated.length, extraRows: repeated.reduce((a, c) => a + c - 1, 0) });
    }
  });
  const keyDupByCol = new Map(keyCollisions.map(k => [k.colIndex, k.values]));
  const columns = headers.map((name, colIndex) => {
    const empty = colEmpty[colIndex];
    return {
      name, empty, complete: rows.length - empty,
      percentage: rows.length ? (rows.length - empty) / rows.length * 100 : 0,
      unique: colUnique[colIndex].size,
      padded: colPadded[colIndex],
      placeholder: colPlaceholder[colIndex],
      type: colTypes[colIndex].type,
      typeLabel: TYPE_LABELS[colTypes[colIndex].type],
      typeMismatches: colTypes[colIndex].mismatches,
      stats: colStats[colIndex].stats,
      topValues: colStats[colIndex].topValues,
      outliers: colStats[colIndex].stats?.outliers ?? 0,
      keyDuplicates: keyDupByCol.get(colIndex) ?? 0
    };
  });
  const blankPercent = rows.length ? emptyCells / (rows.length * headers.length) * 100 : 0;
  const duplicatePercent = rows.length ? duplicateRows / rows.length * 100 : 0;
  return {
    delimiter, headers, rows, columns, emptyCells, duplicateRows,
    irregularRows, paddedCells, placeholderCells, nearDuplicateRows,
    duplicateHeaders, emptyHeaders, typeMismatchCells, outlierCells, mojibakeCells, keyCollisions,
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
 * Genera un CSV sin filas duplicadas (conserva la primera aparición de
 * cada fila). Exporta los valores ya analizados —recortados y al ancho
 * completo de columnas—, no el texto crudo del archivo, con el
 * delimitador detectado en el origen y celdas protegidas con csvCell.
 */
/** Normaliza una fecha válida a ISO (AAAA-MM-DD); si no es fecha, la deja igual. */
function toIsoDate(value) {
  const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(value);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return value;
}

/**
 * Genera el CSV limpio. Sin opciones: solo fuera las filas duplicadas
 * exactas (comportamiento histórico). Opciones de corrección guiada:
 * - `removeEmptyRows`: quita los registros con todas las celdas vacías.
 * - `placeholdersToEmpty`: convierte pseudo-vacíos («N/A», «null»…) en vacío.
 * - `datesToIso`: normaliza las fechas a AAAA-MM-DD.
 * - `removeNearDuplicates`: también quita las casi duplicadas.
 */
export function makeCleanCsv(analysis, options = {}) {
  let kept = analysis.rows.filter(row => !row.duplicate);
  if (options.removeNearDuplicates) kept = kept.filter(row => !row.nearDuplicate);
  if (options.removeEmptyRows) kept = kept.filter(row => row.cells.some(cell => cell !== ''));
  const lines = [analysis.headers, ...kept.map(row => row.cells.map(value => {
    let v = value;
    if (options.placeholdersToEmpty && PLACEHOLDER_VALUES.has(v.toLowerCase())) v = '';
    if (options.datesToIso && v !== '' && classifyCell(v) === 'fecha') v = toIsoDate(v);
    return v;
  }))];
  return '\uFEFF' + lines.map(line => line.map(csvCell).join(analysis.delimiter)).join('\r\n');
}

/**
 * Valida el análisis contra un esquema definido por el usuario:
 * `{ columns: { nombre: { type, required, unique, pattern, min, max, values } } }`.
 * Las reglas se aplican por nombre de columna (las etiquetas ya únicas del
 * análisis). Devuelve el total de violaciones, el detalle por columna, el
 * conjunto de filas afectadas y los errores del propio esquema (p. ej. un
 * patrón regex inválido), sin lanzar excepciones por datos del usuario.
 */
export function validateSchema(analysis, schema) {
  const rules = schema?.columns ?? {};
  const perColumn = [];
  const rowViolations = new Set();
  const errors = [];
  let total = 0;
  for (const [name, rule] of Object.entries(rules)) {
    const j = analysis.headers.indexOf(name);
    if (j === -1) { perColumn.push({ name, count: 1, missing: true }); total += 1; continue; }
    let regex = null;
    if (rule.pattern) {
      try { regex = new RegExp(rule.pattern); }
      catch { errors.push(`Patrón inválido en la columna «${name}»: ${rule.pattern}`); }
    }
    const seen = new Set();
    let count = 0;
    analysis.rows.forEach((row, i) => {
      const value = row.cells[j];
      let bad = false;
      if (value === '') { if (rule.required) bad = true; }
      else {
        if (rule.type && rule.type !== 'cualquiera' && classifyCell(value) !== rule.type) bad = true;
        if (rule.unique) { if (seen.has(value)) bad = true; seen.add(value); }
        if (regex && !regex.test(value)) bad = true;
        if (rule.values?.length && !rule.values.includes(value)) bad = true;
        if (rule.min !== undefined && rule.min !== null && rule.min !== '') { const n = parseNumberValue(value); if (n === null || n < Number(rule.min)) bad = true; }
        if (rule.max !== undefined && rule.max !== null && rule.max !== '') { const n = parseNumberValue(value); if (n === null || n > Number(rule.max)) bad = true; }
      }
      if (bad) { count++; rowViolations.add(i); }
    });
    if (count) perColumn.push({ name, count });
    total += count;
  }
  return { total, perColumn, rowViolations, errors };
}

/**
 * Genera un esquema inicial desde el propio archivo: tipo detectado,
 * requerida si la columna no tiene vacíos y única si hoy no se repite
 * ningún valor. Pensado para «este archivo está bien: úsalo de plantilla».
 */
export function generateSchema(analysis) {
  const columns = {};
  for (const col of analysis.columns) {
    const rule = {};
    if (col.type && !['texto', 'vacio', 'mixto'].includes(col.type)) rule.type = col.type;
    if (col.empty === 0 && analysis.rows.length) rule.required = true;
    const classified = analysis.rows.length - col.empty - (col.placeholder ?? 0);
    if (classified > 0 && col.unique === classified) rule.unique = true;
    if (Object.keys(rule).length) columns[col.name] = rule;
  }
  return { version: 1, columns };
}

/**
 * Reconcilia dos análisis por una columna clave (estilo csv-diff):
 * filas agregadas, eliminadas y modificadas (celda a celda, solo en las
 * columnas compartidas), más las columnas que aparecen o desaparecen.
 * Las filas con clave vacía o clave repetida (se conserva la primera) no
 * se pueden reconciliar: se cuentan en `ignoredBase`/`ignoredOther`.
 */
export function diffAnalyses(base, other, keyName) {
  const keyIndexB = base.headers.indexOf(keyName);
  const keyIndexO = other.headers.indexOf(keyName);
  if (keyIndexB === -1 || keyIndexO === -1) return null;
  const indexByKey = (analysis, keyIndex) => {
    const map = new Map();
    let ignored = 0;
    for (const row of analysis.rows) {
      const key = row.cells[keyIndex];
      if (key === '' || map.has(key)) { ignored++; continue; }
      map.set(key, row);
    }
    return { map, ignored };
  };
  const { map: baseMap, ignored: ignoredBase } = indexByKey(base, keyIndexB);
  const { map: otherMap, ignored: ignoredOther } = indexByKey(other, keyIndexO);
  const sharedColumns = base.headers.filter(h => other.headers.includes(h));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, row] of otherMap) if (!baseMap.has(key)) added.push({ key, row });
  for (const [key, row] of baseMap) {
    const otherRow = otherMap.get(key);
    if (!otherRow) { removed.push({ key, row }); continue; }
    const changes = [];
    for (const col of sharedColumns) {
      const from = row.cells[base.headers.indexOf(col)];
      const to = otherRow.cells[other.headers.indexOf(col)];
      if (from !== to) changes.push({ column: col, from, to });
    }
    if (changes.length) changed.push({ key, changes });
  }
  return {
    keyName, added, removed, changed,
    addedColumns: other.headers.filter(h => !base.headers.includes(h)),
    removedColumns: base.headers.filter(h => !other.headers.includes(h)),
    ignoredBase, ignoredOther,
    baseRows: base.rows.length, otherRows: other.rows.length
  };
}

/** Informe de la comparación en CSV: agregadas, eliminadas y cambios celda a celda. */
export function makeDiffReport(diff) {
  const records = [
    ['Tipo', 'Clave', 'Columna', 'Antes', 'Después'],
    ['Resumen', diff.keyName, '', `${diff.baseRows} filas (archivo base)`, `${diff.otherRows} filas (otro archivo)`],
    ...diff.added.map(e => ['Agregada', e.key, '', '', '']),
    ...diff.removed.map(e => ['Eliminada', e.key, '', '', '']),
    ...diff.changed.flatMap(e => e.changes.map(c => ['Modificada', e.key, c.column, c.from, c.to])),
    ...diff.addedColumns.map(c => ['Columna agregada', '', c, '', '']),
    ...diff.removedColumns.map(c => ['Columna eliminada', '', c, '', ''])
  ];
  return '\uFEFF' + records.map(r => r.map(csvCell).join(',')).join('\r\n');
}

export function makeReport(analysis, filename) {
  const num = v => String(Number(v.toFixed(2)));
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
    ['General', 'Celdas con pseudo-vacíos (N/A, null, sin dato…)', analysis.placeholderCells ?? 0, ''],
    ['General', 'Filas casi duplicadas (difieren en mayúsculas/espacios)', analysis.nearDuplicateRows ?? 0, ''],
    ['General', 'Encabezados duplicados (renombrados)', analysis.duplicateHeaders ?? 0, ''],
    ['General', 'Encabezados vacíos (renombrados)', analysis.emptyHeaders ?? 0, ''],
    ['General', 'Celdas que no coinciden con el tipo de su columna', analysis.typeMismatchCells ?? 0, ''],
    ['General', 'Valores atípicos (fuera del rango intercuartílico)', analysis.outlierCells ?? 0, ''],
    ['General', 'Celdas con posible daño de codificación (mojibake)', analysis.mojibakeCells ?? 0, ''],
    ['General', 'Columnas que parecen clave con valores repetidos', (analysis.keyCollisions ?? []).length, ''],
    ['General', 'Puntaje de calidad', analysis.qualityScore + ' / 100', ''],
    ...analysis.columns.map(col => ['Columna', col.name, `${col.typeLabel ?? 'Texto'} · ${col.empty} vacíos · ${col.unique ?? 0} únicos${col.typeMismatches ? ` · ${col.typeMismatches} de otro tipo` : ''}${col.stats && col.type === 'numero' ? ` · media ${num(col.stats.mean)} · mediana ${num(col.stats.median)} · mín ${num(col.stats.min)} · máx ${num(col.stats.max)}` : ''}${col.stats && col.type === 'fecha' ? ` · rango ${col.stats.min} a ${col.stats.max}` : ''}${col.outliers ? ` · ${col.outliers} atípicos` : ''}${col.keyDuplicates ? ` · ${col.keyDuplicates} repetidos en posible clave` : ''}`, col.percentage.toFixed(2) + '% completo'])
  ];
  return '\uFEFF' + records.map(record => record.map(csvCell).join(',')).join('\r\n');
}
