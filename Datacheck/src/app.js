import { analyzeCsv, makeReport } from './csv.js';

const MAX_BYTES = 5 * 1024 * 1024;
const $ = selector => document.querySelector(selector);
const $all = selector => Array.from(document.querySelectorAll(selector));
let result = null;
let currentFilename = '';
let activeFilter = 'all';

const input = $('#csvInput');
const dropZone = $('#dropZone');
const message = $('#message');

function alertMessage(text, kind = 'error') {
  message.hidden = false;
  message.className = `message ${kind}`;
  message.textContent = text;
}
function clearMessage() { message.hidden = true; message.textContent = ''; }
function fmt(num) { return new Intl.NumberFormat('es-PE').format(num); }
function percent(num) { return `${num.toFixed(1)} %`; }

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
    clearMessage();
    setFilter('all');
    renderSummary();
    renderColumns();
  } catch (error) {
    clearAnalysis();
    alertMessage(error instanceof Error ? error.message : 'No se pudo analizar el archivo.');
  }
}

function clearAnalysis() {
  result = null;
  currentFilename = '';
  input.value = '';
  activeFilter = 'all';
  $('#fileLabel').innerHTML = '<span class="status-dot"></span> Ningún archivo cargado';
  $('#resetBtn').hidden = true;
  $('#exportBtn').disabled = true;
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
  try { loadData(await file.text(), file.name); }
  catch { failLoad('No fue posible leer el archivo seleccionado.'); }
}

function renderSummary() {
  if (!result) return;
  $('#statRows').textContent = fmt(result.rows.length);
  $('#statCols').textContent = fmt(result.headers.length);
  $('#statBlanks').textContent = fmt(result.emptyCells);
  $('#statBlanksSub').textContent = `${percent(result.blankPercent)} del total de celdas`;
  $('#statDuplicates').textContent = fmt(result.duplicateRows);
  const hasProblems = result.emptyCells > 0 || result.duplicateRows > 0;
  const insight = $('#insight');
  insight.hidden = false;
  insight.classList.toggle('good', !hasProblems);
  $('#insightText').textContent = hasProblems
    ? `Se detectaron ${fmt(result.incompleteRows)} filas con valores vacíos y ${fmt(result.duplicateRows)} filas duplicadas. Revisa los filtros de la vista previa antes de utilizar estos datos.`
    : '¡Excelente! No se detectaron celdas vacías ni filas duplicadas en el archivo.';
}

function renderColumns() {
  const root = $('#columnsList');
  root.replaceChildren();
  for (const col of result.columns) {
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
    const fill = document.createElement('div');
    fill.className = 'progress-fill' + (col.percentage < 80 ? ' low' : col.percentage < 100 ? ' medium' : '');
    fill.style.width = `${col.percentage}%`;
    track.append(fill);
    const note = document.createElement('small');
    note.textContent = `${fmt(col.complete)} completos · ${fmt(col.empty)} vacíos`;
    item.append(line, track, note);
    root.append(item);
  }
}

function setFilter(next) {
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
  const selected = result.rows.filter(row => activeFilter === 'all' || (activeFilter === 'incomplete' ? row.incomplete : row.duplicate));
  $('#previewCount').textContent = `${fmt(selected.length)} registros`;
  const wrap = $('#tableWrap');
  wrap.replaceChildren();
  $('#previewHelp').hidden = false;
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
    tag.className = `row-tag ${row.duplicate ? 'duplicate' : row.incomplete ? 'incomplete' : 'ok'}`;
    tag.textContent = row.duplicate ? 'Duplicada' : row.incomplete ? 'Incompleta' : 'Correcta';
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
dropZone.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === dropZone) { e.preventDefault(); input.click(); } });
input.addEventListener('change', () => loadFile(input.files[0]));
for (const event of ['dragenter', 'dragover']) dropZone.addEventListener(event, e => { e.preventDefault(); dropZone.classList.add('dragover'); });
for (const event of ['dragleave', 'drop']) dropZone.addEventListener(event, e => { e.preventDefault(); dropZone.classList.remove('dragover'); });
dropZone.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));
$('#demoBtn').addEventListener('click', async () => {
  try {
    const response = await fetch('./datos_ejemplo.csv');
    if (!response.ok) throw new Error('No se pudo abrir el ejemplo.');
    loadData(await response.text(), 'datos_ejemplo.csv');
  } catch { failLoad('Abre el proyecto con un servidor local (por ejemplo, Live Server de VS Code) para cargar el ejemplo.'); }
});
$('#resetBtn').addEventListener('click', reset);
for (const button of $all('[data-filter]')) button.addEventListener('click', () => setFilter(button.dataset.filter));
$('#exportBtn').addEventListener('click', () => {
  if (!result) return;
  const output = makeReport(result, currentFilename);
  const blob = new Blob([output], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `informe_datacheck_${Date.now()}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});
