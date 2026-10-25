import { analyzeCsv, makeReport, makeCleanCsv, decodeCsvData, validateSchema, generateSchema } from './csv.js';

const MAX_BYTES = 5 * 1024 * 1024;
const $ = selector => document.querySelector(selector);
const $all = selector => Array.from(document.querySelectorAll(selector));
let result = null;
let currentFilename = '';
let currentEncoding = 'utf-8';
let schema = null;
let schemaRowRefs = [];
let activeFilter = 'all';
// Token de generación: cada carga o limpieza lo incrementa y las
// escrituras asíncronas pendientes (animación, lecturas de archivo)
// abortan si su generación ya no es la vigente.
let loadGeneration = 0;

const input = $('#csvInput');
const dropZone = $('#dropZone');
const message = $('#message');

/* ---------- Tema claro / oscuro ---------- */
const THEME_KEY = 'datacheck-theme';

function storedTheme() {
  try { return window.localStorage.getItem(THEME_KEY); } catch { return null; }
}

function applyTheme(theme) {
  if (document.documentElement) document.documentElement.dataset.theme = theme;
  const toggle = $('#themeToggle');
  if (toggle) {
    toggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    toggle.setAttribute('aria-label', theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
  }
}

function initTheme() {
  const saved = storedTheme();
  const systemDark = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved === 'dark' || saved === 'light' ? saved : systemDark ? 'dark' : 'light');
  // Sin preferencia guardada, la página sigue los cambios de tema del sistema.
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', event => { if (!storedTheme()) applyTheme(event.matches ? 'dark' : 'light'); });
    }
  }
  const toggle = $('#themeToggle');
  if (toggle) toggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { window.localStorage.setItem(THEME_KEY, next); } catch { /* sin persistencia disponible */ }
    applyTheme(next);
  });
}
initTheme();

function alertMessage(text, kind = 'error') {
  message.hidden = false;
  message.className = `message ${kind}`;
  message.textContent = text;
}
function clearMessage() { message.hidden = true; message.textContent = ''; }
function fmt(num) { return new Intl.NumberFormat('es-PE').format(num); }
function percent(num) { return `${num.toFixed(1)} %`; }

/** Ejecuta fn en el próximo frame; sin rAF (tests, navegadores viejos) usa un timer. */
function nextFrame(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
  else setTimeout(fn, 0);
}

/** Cuenta de 0 al valor con easing; sin rAF o con valor 0 escribe el número final al instante. */
function animateNumber(el, value) {
  const target = Math.round(value);
  const generation = loadGeneration;
  const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof requestAnimationFrame !== 'function' || reduced || target === 0) {
    el.textContent = fmt(target);
    return;
  }
  const duration = 650;
  const start = performance.now();
  // Red de seguridad: si rAF se pausa (pestaña en segundo plano), el número
  // final se escribe igual al cumplirse la duración de la animación.
  const settle = setTimeout(() => {
    if (generation === loadGeneration) el.textContent = fmt(target);
  }, duration + 60);
  const tick = now => {
    // Si hubo otra carga o una limpieza, esta animación quedó huérfana:
    // no debe resucitar el número sobre la pantalla ya limpia.
    if (generation !== loadGeneration) return;
    // Clamp a [0,1]: el timestamp de rAF y performance.now() pueden diferir
    // levemente y un t negativo mostraría valores como "-0" o "-1".
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    el.textContent = fmt(Math.round(target * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(tick);
    else clearTimeout(settle);
  };
  requestAnimationFrame(tick);
}

function loadData(text, name) {
  try {
    const analysis = analyzeCsv(text);
    result = analysis;
    currentFilename = name;
    activeFilter = 'all';
    $('#fileLabel').innerHTML = '<span class="status-dot loaded"></span>';
    $('#fileLabel').append(document.createTextNode(` ${name} · ${fmt(analysis.rows.length)} registros`));
    $('#resetBtn').hidden = false;
    $('#exportBtn').disabled = false;
    const cleanBtn = $('#cleanBtn');
    if (cleanBtn) cleanBtn.disabled = false;
    clearMessage();
    const sortEl = $('#sortSelect');
    if (sortEl) sortEl.value = 'original'; // misma política que el filtro: cada carga arranca igual
    setFilter('all');
    renderSummary();
    renderColumns();
    const schemaPanel = $('#schemaPanel');
    if (schemaPanel) {
      schemaPanel.hidden = false;
      buildSchemaEditor();
      // El esquema se conserva entre cargas: si hay uno, se aplica solo.
      if (schema) applySchemaValidation();
    }
  } catch (error) {
    clearAnalysis();
    alertMessage(error instanceof Error ? error.message : 'No se pudo analizar el archivo.');
  }
}

function clearAnalysis() {
  loadGeneration++;
  result = null;
  currentEncoding = 'utf-8';
  const schemaPanelOff = $('#schemaPanel');
  if (schemaPanelOff) schemaPanelOff.hidden = true;
  const schemaFilterOff = $('#schemaFilter');
  if (schemaFilterOff) schemaFilterOff.hidden = true;
  const schemaSummaryOff = $('#schemaSummary');
  if (schemaSummaryOff) schemaSummaryOff.hidden = true;
  currentFilename = '';
  input.value = '';
  activeFilter = 'all';
  $('#fileLabel').innerHTML = '<span class="status-dot"></span> Ningún archivo cargado';
  $('#resetBtn').hidden = true;
  $('#exportBtn').disabled = true;
  const cleanBtn = $('#cleanBtn');
  if (cleanBtn) cleanBtn.disabled = true;
  const sortSelect = $('#sortSelect');
  if (sortSelect) sortSelect.value = 'original';
  const insightIcon = $('#insightIcon');
  if (insightIcon) insightIcon.textContent = 'i';
  for (const id of ['statRows', 'statCols', 'statBlanks', 'statDuplicates']) $(`#${id}`).textContent = '—';
  $('#statBlanksSub').textContent = 'Pendiente de análisis';
  $('#insight').hidden = true;
  $('#columnsList').innerHTML = '<p class="empty-state">Importa un archivo para visualizar el porcentaje de datos completos por columna.</p>';
  $('#tableWrap').innerHTML = '<p class="empty-state">Aquí podrás revisar una muestra de los registros del archivo.</p>';
  $('#previewCount').textContent = 'Sin datos';
  $('#previewHelp').hidden = true;
  for (const button of $all('[data-filter]')) {
    const selected = button.dataset.filter === 'all';
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}

function failLoad(text) {
  clearAnalysis();
  alertMessage(text);
}

async function loadFile(file) {
  if (!file) return;
  if (!/\.csv$/i.test(file.name)) return failLoad('Selecciona un archivo con extensión .csv.');
  if (file.size > MAX_BYTES) return failLoad('El archivo supera los 5 MB permitidos.');
  const generation = ++loadGeneration;
  try {
    let text;
    if (typeof file.arrayBuffer === 'function') {
      // Decodificación consciente: UTF-8 estricto y, si no lo es,
      // Windows-1252 (Excel) — con aviso, no con caracteres rotos.
      const decoded = decodeCsvData(await file.arrayBuffer());
      text = decoded.text;
      currentEncoding = decoded.encoding;
    } else {
      text = await file.text();
      currentEncoding = 'utf-8';
    }
    // Si mientras se leía llegó otra carga o una limpieza, este resultado
    // quedó viejo: se descarta en vez de pisar el estado actual.
    if (generation !== loadGeneration) return;
    loadData(text, file.name);
  } catch { if (generation === loadGeneration) failLoad('No fue posible leer el archivo seleccionado.'); }
}

const fmtDec = value => value.toLocaleString('es', { maximumFractionDigits: 2 });

function renderSummary() {
  if (!result) return;
  animateNumber($('#statRows'), result.rows.length);
  animateNumber($('#statCols'), result.headers.length);
  animateNumber($('#statBlanks'), result.emptyCells);
  $('#statBlanksSub').textContent = `${percent(result.blankPercent)} del total de celdas`;
  animateNumber($('#statDuplicates'), result.duplicateRows);
  const irregularRows = result.irregularRows ?? 0;
  const paddedCells = result.paddedCells ?? 0;
  const placeholderCells = result.placeholderCells ?? 0;
  const nearDuplicateRows = result.nearDuplicateRows ?? 0;
  const headerIssues = (result.duplicateHeaders ?? 0) + (result.emptyHeaders ?? 0);
  const typeMismatchCells = result.typeMismatchCells ?? 0;
  const outlierCells = result.outlierCells ?? 0;
  const mojibakeCells = result.mojibakeCells ?? 0;
  const keyCollisions = result.keyCollisions ?? [];
  const hasProblems = result.emptyCells > 0 || result.duplicateRows > 0 || irregularRows > 0
    || placeholderCells > 0 || nearDuplicateRows > 0 || headerIssues > 0 || typeMismatchCells > 0 || outlierCells > 0
    || mojibakeCells > 0 || keyCollisions.length > 0;
  const insight = $('#insight');
  insight.hidden = false;
  insight.classList.toggle('good', !hasProblems);
  const icon = $('#insightIcon');
  if (icon) {
    icon.textContent = result.qualityScore;
    icon.title = 'Puntaje de calidad (0 a 100)';
  }
  const main = [];
  if (result.incompleteRows > 0) main.push(`${fmt(result.incompleteRows)} filas con valores vacíos`);
  if (result.duplicateRows > 0) main.push(`${fmt(result.duplicateRows)} filas duplicadas`);
  const extras = [];
  if (irregularRows > 0) extras.push(`${fmt(irregularRows)} filas con más o menos columnas que el encabezado`);
  if (nearDuplicateRows > 0) extras.push(`${fmt(nearDuplicateRows)} filas casi duplicadas (difieren solo en mayúsculas o espacios)`);
  if (placeholderCells > 0) extras.push(`${fmt(placeholderCells)} celdas con pseudo-vacíos como «N/A» o «sin dato»`);
  if (paddedCells > 0) extras.push(`${fmt(paddedCells)} celdas con espacios al inicio o al final`);
  if (result.duplicateHeaders > 0) extras.push(`${fmt(result.duplicateHeaders)} encabezados duplicados (renombrados automáticamente)`);
  if (result.emptyHeaders > 0) extras.push(`${fmt(result.emptyHeaders)} encabezados vacíos (renombrados automáticamente)`);
  if (typeMismatchCells > 0) extras.push(`${fmt(typeMismatchCells)} celdas que no coinciden con el tipo de su columna`);
  if (outlierCells > 0) extras.push(`${fmt(outlierCells)} valores atípicos en columnas numéricas (fuera del rango habitual)`);
  if (keyCollisions.length) extras.push(`valores repetidos en columnas que parecen identificadores: ${keyCollisions.map(k => `${k.name} (${fmt(k.values)})`).join(', ')}`);
  if (mojibakeCells > 0) extras.push(`${fmt(mojibakeCells)} celdas con texto posiblemente dañado por codificación (secuencias como «Ã±» en vez de «ñ»)`);
  const mainText = main.length ? ` Se detectaron ${main.join(' y ')}.` : '';
  const extraText = extras.length ? ` Además: ${extras.join('; ')}.` : '';
  const encodingNote = currentEncoding === 'windows-1252'
    ? ' El archivo venía en codificación Windows-1252 (típico de Excel) y se interpretó correctamente.'
    : '';
  $('#insightText').textContent = hasProblems
    ? `Puntaje de calidad: ${result.qualityScore}/100.${mainText}${extraText}${encodingNote} Revisa los filtros de la vista previa antes de utilizar estos datos.`
    : `¡Excelente! Puntaje de calidad: ${result.qualityScore}/100. No se detectaron celdas vacías ni filas duplicadas en el archivo.${encodingNote}`;
}

function renderColumns() {
  const root = $('#columnsList');
  root.replaceChildren();
  const sortSelect = $('#sortSelect');
  const columns = sortSelect && sortSelect.value === 'worst'
    ? [...result.columns].sort((a, b) => a.percentage - b.percentage)
    : result.columns;
  for (const col of columns) {
    const item = document.createElement('div');
    item.className = 'column-item';
    const line = document.createElement('div');
    line.className = 'column-line';
    const name = document.createElement('strong');
    name.textContent = col.name;
    name.title = col.name;
    const rate = document.createElement('span');
    rate.textContent = percent(col.percentage);
    line.append(name, rate);
    const track = document.createElement('div');
    track.className = 'progress-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuenow', String(Math.round(col.percentage)));
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-label', `Completitud de ${col.name}`);
    const fill = document.createElement('div');
    fill.className = 'progress-fill' + (col.percentage < 80 ? ' low' : col.percentage < 100 ? ' medium' : '');
    fill.style.width = '0%';
    nextFrame(() => { fill.style.width = `${col.percentage}%`; });
    track.append(fill);
    const note = document.createElement('small');
    const details = [col.typeLabel ?? 'Texto', `${fmt(col.complete)} completos`, `${fmt(col.empty)} vacíos`, `${fmt(col.unique ?? 0)} únicos`];
    if (col.typeMismatches) details.push(`${fmt(col.typeMismatches)} de otro tipo`);
    if (col.padded) details.push(`${fmt(col.padded)} con espacios en los bordes`);
    if (col.placeholder) details.push(`${fmt(col.placeholder)} pseudo-vacíos`);
    if (col.stats && col.type === 'numero') details.push(`media ${fmtDec(col.stats.mean)}`, `mediana ${fmtDec(col.stats.median)}`, `mín ${fmtDec(col.stats.min)}`, `máx ${fmtDec(col.stats.max)}`);
    if (col.stats && col.type === 'fecha') details.push(`desde ${col.stats.min} hasta ${col.stats.max}`);
    if (col.outliers) details.push(`${fmt(col.outliers)} atípicos`);
    if (col.keyDuplicates) details.push(`${fmt(col.keyDuplicates)} repetidos en posible clave`);
    note.textContent = details.join(' · ');
    item.append(line, track, note);
    if (col.topValues?.length) {
      const top = document.createElement('small');
      top.className = 'column-top';
      top.textContent = `Frecuentes: ${col.topValues.map(t => `${t.value} ×${fmt(t.count)}`).join(' · ')}`;
      top.title = top.textContent;
      item.append(top);
    }
    root.append(item);
  }
}

function setFilter(next) {
  if (!result) return;
  activeFilter = next;
  for (const button of $all('[data-filter]')) {
    const selected = button.dataset.filter === next;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  renderPreview();
}

function renderPreview() {
  if (!result) return;
  const selected = result.rows.filter(row => {
    if (activeFilter === 'incomplete') return row.incomplete;
    if (activeFilter === 'duplicates') return row.duplicate;
    if (activeFilter === 'schema') return row.schemaViolation;
    return true;
  });
  $('#previewCount').textContent = `${fmt(selected.length)} registros`;
  const wrap = $('#tableWrap');
  wrap.replaceChildren();
  $('#previewHelp').hidden = selected.length === 0;
  if (!selected.length) {
    const noRows = document.createElement('p');
    noRows.className = 'empty-state';
    noRows.textContent = 'No hay registros para el filtro seleccionado.';
    wrap.append(noRows);
    return;
  }
  const table = document.createElement('table');
  table.className = 'data-table';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const label of ['#', ...result.headers, 'Validación']) {
    const th = document.createElement('th');
    th.textContent = label;
    headerRow.append(th);
  }
  thead.append(headerRow);
  const tbody = document.createElement('tbody');
  for (const row of selected.slice(0, 10)) {
    const tr = document.createElement('tr');
    const rowNumber = document.createElement('td');
    rowNumber.className = 'row-number';
    rowNumber.textContent = row.number;
    tr.append(rowNumber);
    for (const cell of row.cells) {
      const td = document.createElement('td');
      if (cell === '') { td.className = 'cell-empty'; td.textContent = 'Vacío'; }
      else { td.textContent = cell; td.title = cell; }
      tr.append(td);
    }
    const status = document.createElement('td');
    const tag = document.createElement('span');
    tag.className = `row-tag ${row.duplicate ? 'duplicate' : row.irregular ? 'irregular' : row.nearDuplicate ? 'near' : row.schemaViolation ? 'schema' : row.typeMismatch ? 'type' : row.outlier ? 'outlier' : row.incomplete ? 'incomplete' : 'ok'}`;
    tag.textContent = row.duplicate ? 'Duplicada' : row.irregular ? 'Irregular' : row.nearDuplicate ? 'Casi duplicada' : row.schemaViolation ? 'Esquema' : row.typeMismatch ? 'Tipo distinto' : row.outlier ? 'Atípico' : row.incomplete ? 'Incompleta' : 'Correcta';
    status.append(tag);
    tr.append(status);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
}

function reset() {
  clearAnalysis();
  clearMessage();
}

$('#selectBtn').addEventListener('click', e => { e.stopPropagation(); input.click(); });
dropZone.addEventListener('click', e => { if (e.target !== $('#selectBtn')) input.click(); });
input.addEventListener('change', () => {
  const file = input.files[0];
  // Limpiar el valor permite volver a elegir el mismo archivo: sin esto el
  // navegador no vuelve a disparar "change" y la recarga queda sin respuesta.
  input.value = '';
  loadFile(file);
});
for (const event of ['dragenter', 'dragover']) dropZone.addEventListener(event, e => { e.preventDefault(); dropZone.classList.add('dragover'); });
// dragleave burbujea desde los hijos de la zona: solo se apaga el resaltado
// cuando el puntero sale de verdad (si no, el fondo parpadea al arrastrar).
dropZone.addEventListener('dragleave', e => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('dragover'); });
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); });
dropZone.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));
$('#demoBtn').addEventListener('click', async () => {
  const generation = ++loadGeneration;
  try {
    const response = await fetch('./datos_ejemplo.csv');
    if (!response.ok) throw new Error('No se pudo abrir el ejemplo.');
    const decoded = decodeCsvData(await response.arrayBuffer());
    if (generation !== loadGeneration) return;
    currentEncoding = decoded.encoding;
    loadData(decoded.text, 'datos_ejemplo.csv');
  } catch { if (generation === loadGeneration) failLoad('Abre el proyecto con un servidor local (por ejemplo, Live Server de VS Code) para cargar el ejemplo.'); }
});
$('#resetBtn').addEventListener('click', reset);
for (const button of $all('[data-filter]')) button.addEventListener('click', () => setFilter(button.dataset.filter));
function downloadCsv(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

$('#exportBtn').addEventListener('click', () => {
  if (!result) return;
  downloadCsv(makeReport(result, currentFilename), `informe_datacheck_${Date.now()}.csv`);
});

const cleanBtn = $('#cleanBtn');
if (cleanBtn) cleanBtn.addEventListener('click', () => {
  if (!result) return;
  downloadCsv(makeCleanCsv(result), `datacheck_sin_duplicados_${Date.now()}.csv`);
});

/* ---------- Esquema definido por el usuario ---------- */
const SCHEMA_TYPES = [['cualquiera', 'Cualquiera'], ['numero', 'Número'], ['fecha', 'Fecha'], ['correo', 'Correo'], ['booleano', 'Booleano'], ['texto', 'Texto']];

function buildSchemaEditor() {
  const body = $('#schemaBody');
  if (!body || !result) return;
  body.replaceChildren();
  schemaRowRefs = [];
  for (const col of result.columns) {
    const rule = schema?.columns?.[col.name] ?? {};
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    nameTd.textContent = col.name;
    nameTd.title = col.name;
    const typeSel = document.createElement('select');
    for (const [value, label] of SCHEMA_TYPES) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      typeSel.append(opt);
    }
    typeSel.value = rule.type ?? 'cualquiera';
    const typeTd = document.createElement('td');
    typeTd.append(typeSel);
    const mkCheck = checked => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!checked;
      const td = document.createElement('td');
      td.append(input);
      return [td, input];
    };
    const [reqTd, reqInput] = mkCheck(rule.required);
    const [uniqTd, uniqInput] = mkCheck(rule.unique);
    const mkText = value => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value ?? '';
      const td = document.createElement('td');
      td.append(input);
      return [td, input];
    };
    const [patTd, patInput] = mkText(rule.pattern);
    const [minTd, minInput] = mkText(rule.min);
    const [maxTd, maxInput] = mkText(rule.max);
    const [valsTd, valsInput] = mkText(rule.values?.join(', '));
    const resultTd = document.createElement('td');
    resultTd.className = 'schema-result';
    resultTd.textContent = '—';
    tr.append(nameTd, typeTd, reqTd, uniqTd, patTd, minTd, maxTd, valsTd, resultTd);
    body.append(tr);
    schemaRowRefs.push({ name: col.name, type: typeSel, required: reqInput, unique: uniqInput, pattern: patInput, min: minInput, max: maxInput, values: valsInput, resultCell: resultTd });
  }
}

function readSchemaFromEditor() {
  const columns = {};
  for (const ref of schemaRowRefs) {
    const rule = {};
    if (ref.type.value !== 'cualquiera') rule.type = ref.type.value;
    if (ref.required.checked) rule.required = true;
    if (ref.unique.checked) rule.unique = true;
    const pattern = ref.pattern.value.trim();
    if (pattern) rule.pattern = pattern;
    for (const key of ['min', 'max']) {
      const raw = ref[key].value.trim();
      if (raw) { const n = Number(raw.replace(',', '.')); if (!Number.isNaN(n)) rule[key] = n; }
    }
    const values = ref.values.value.split(',').map(v => v.trim()).filter(Boolean);
    if (values.length) rule.values = values;
    if (Object.keys(rule).length) columns[ref.name] = rule;
  }
  // Las reglas de columnas que este archivo no tiene se conservan (p. ej.
  // un esquema cargado pensado para otro archivo): así la validación las
  // reporta como «columna ausente» en vez de perderlas en silencio.
  if (schema?.columns && result) {
    for (const [name, rule] of Object.entries(schema.columns)) {
      if (!(name in columns) && !result.headers.includes(name)) columns[name] = rule;
    }
  }
  return { version: 1, columns };
}

function applySchemaValidation() {
  if (!result) return;
  schema = readSchemaFromEditor();
  const summary = $('#schemaSummary');
  const filterBtn = $('#schemaFilter');
  if (!Object.keys(schema.columns).length) {
    result.rows.forEach(row => { row.schemaViolation = false; });
    for (const ref of schemaRowRefs) { ref.resultCell.textContent = '—'; ref.resultCell.classList.remove('ok'); }
    if (filterBtn) filterBtn.hidden = true;
    if (summary) { summary.hidden = false; summary.textContent = 'Todavía no definiste reglas: completa al menos una fila (o pulsa «Generar desde este archivo») y vuelve a validar.'; }
    if (activeFilter === 'schema') setFilter('all'); else renderPreview();
    return;
  }
  const res = validateSchema(result, schema);
  result.rows.forEach((row, i) => { row.schemaViolation = res.rowViolations.has(i); });
  const counts = new Map(res.perColumn.map(c => [c.name, c.missing ? 'ausente' : c.count]));
  for (const ref of schemaRowRefs) {
    const c = counts.get(ref.name);
    ref.resultCell.textContent = c === undefined ? '✓' : String(c);
    ref.resultCell.classList.toggle('ok', c === undefined);
  }
  if (filterBtn) filterBtn.hidden = false;
  if (summary) {
    summary.hidden = false;
    summary.textContent = res.errors.length
      ? `⚠ ${res.errors.join(' ')}`
      : res.total === 0
        ? '✓ Sin violaciones: el archivo cumple el esquema.'
        : `${fmt(res.total)} violaciones en ${fmt(res.perColumn.length)} columnas: ${res.perColumn.map(c => `${c.name} (${c.missing ? 'columna ausente' : fmt(c.count)})`).join(', ')}. Filtra la vista previa por «Esquema» para ver las filas.`;
  }
  renderPreview();
}

const schemaValidateBtn = $('#schemaValidate');
if (schemaValidateBtn) schemaValidateBtn.addEventListener('click', applySchemaValidation);
const schemaGenerateBtn = $('#schemaGenerate');
if (schemaGenerateBtn) schemaGenerateBtn.addEventListener('click', () => {
  if (!result) return;
  schema = generateSchema(result);
  buildSchemaEditor();
  applySchemaValidation();
});
const schemaDownloadBtn = $('#schemaDownload');
if (schemaDownloadBtn) schemaDownloadBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(readSchemaFromEditor(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'esquema-datacheck.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
});
const schemaFileInput = $('#schemaFile');
const schemaLoadBtn = $('#schemaLoadBtn');
if (schemaLoadBtn && schemaFileInput) schemaLoadBtn.addEventListener('click', () => schemaFileInput.click());
if (schemaFileInput) schemaFileInput.addEventListener('change', async () => {
  const file = schemaFileInput.files[0];
  schemaFileInput.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== 'object' || !parsed.columns || typeof parsed.columns !== 'object') throw new Error('formato');
    schema = { version: 1, columns: parsed.columns };
    buildSchemaEditor();
    applySchemaValidation();
  } catch { alertMessage('El archivo de esquema no es un JSON válido con la estructura esperada ({ "columns": { … } }).'); }
});
const schemaClearBtn = $('#schemaClear');
if (schemaClearBtn) schemaClearBtn.addEventListener('click', () => {
  schema = null;
  buildSchemaEditor();
  if (result) result.rows.forEach(row => { row.schemaViolation = false; });
  const filterBtn = $('#schemaFilter');
  if (filterBtn) filterBtn.hidden = true;
  const summary = $('#schemaSummary');
  if (summary) summary.hidden = true;
  if (activeFilter === 'schema') setFilter('all'); else renderPreview();
});

const sortSelect = $('#sortSelect');
if (sortSelect) sortSelect.addEventListener('change', () => { if (result) renderColumns(); });
