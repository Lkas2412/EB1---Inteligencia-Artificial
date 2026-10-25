import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCsv, parseDelimited, detectDelimiter, csvCell, makeReport, makeCleanCsv, classifyCell } from '../src/csv.js';

test('Lee CSV con comas entre comillas y comillas escapadas', () => {
  const rows = parseDelimited('nombre,nota\n"Ana, María","Dijo ""hola"""');
  assert.deepEqual(rows, [['nombre', 'nota'], ['Ana, María', 'Dijo "hola"']]);
});

test('Detecta delimitador punto y coma', () => {
  const content = 'id;nombre;edad\n1;Ana;20\n2;Luis;22';
  assert.equal(detectDelimiter(content), ';');
  assert.equal(analyzeCsv(content).headers.length, 3);
});

test('Cuenta correctamente vacíos y duplicados', () => {
  const a = analyzeCsv('id,ciudad\n1,Lima\n2,\n1,Lima\n3,Arequipa');
  assert.equal(a.rows.length, 4);
  assert.equal(a.emptyCells, 1);
  assert.equal(a.incompleteRows, 1);
  assert.equal(a.duplicateRows, 1);
  assert.equal(a.columns[1].percentage, 75);
});

test('Acepta salto de línea y BOM dentro del formato', () => {
  const a = analyzeCsv('\uFEFFid,comentario\r\n1,"Línea 1\nLínea 2"\r\n2,listo');
  assert.equal(a.rows.length, 2);
  assert.equal(a.rows[0].cells[1], 'Línea 1\nLínea 2');
});

test('Rechaza archivo sin datos y comillas sin cerrar', () => {
  assert.throws(() => analyzeCsv(''), /vacío/);
  assert.throws(() => analyzeCsv('id,valor'), /al menos un registro/);
  assert.throws(() => parseDelimited('nombre\n"sin cerrar'), /comillas sin cerrar/);
  assert.throws(() => analyzeCsv('id,nombre\n1,"sin cerrar'), /comillas sin cerrar/);
  assert.throws(() => parseDelimited('id,nombre\n1,Ana" María'), /comillas en una posición inválida/);
});

test('Evita fórmulas en el CSV exportado y genera reporte', () => {
  assert.equal(csvCell('=2+2'), '"\'=2+2"');
  const report = makeReport(analyzeCsv('id,nombre\n1,Ana'), 'test.csv');
  assert.match(report, /Registros/);
  assert.match(report, /nombre/);
});

test('Neutraliza también celdas que empiezan con | o % (inyección CSV)', () => {
  assert.equal(csvCell('|2+2'), '"\'|2+2"');
  assert.equal(csvCell('%2+2'), '"\'%2+2"');
  assert.equal(csvCell('  =cmd'), '"\'  =cmd"');
  assert.equal(csvCell('texto'), '"texto"');
});

test('Detecta filas irregulares, espacios en bordes y valores únicos', () => {
  const a = analyzeCsv('id,nombre,ciudad\n1,Ana,Lima\n2, Luis ,Cusco\n3,Ana,Lima\n4,Solo\n5,Eva,Lima,extra');
  assert.equal(a.irregularRows, 2);
  assert.equal(a.rows[4].irregular, true);
  assert.equal(a.rows[0].irregular, false);
  assert.equal(a.paddedCells, 1);
  assert.equal(a.columns[1].padded, 1);
  assert.equal(a.columns[1].unique, 4);
  assert.equal(a.columns[2].unique, 2);
});

test('Calcula el puntaje de calidad', () => {
  assert.equal(analyzeCsv('id,nombre\n1,Ana\n2,Luis').qualityScore, 100);
  const conProblemas = analyzeCsv('id,ciudad\n1,Lima\n2,\n1,Lima\n3,Arequipa');
  // 12,5 % de celdas vacías (1 de 8) y 25 % de filas duplicadas (1 de 4)
  assert.equal(conProblemas.qualityScore, 63);
});

test('Genera el CSV limpio sin filas duplicadas', () => {
  const a = analyzeCsv('id;nombre\n1;Ana\n2;Luis\n1;Ana');
  const clean = makeCleanCsv(a);
  assert.match(clean, /"1";"Ana"/);
  assert.equal(clean.split('\r\n').length, 3); // encabezado + 2 filas únicas
  assert.equal((clean.match(/"1";"Ana"/g) || []).length, 1);
});

test('Cuenta pseudo-vacíos (N/A, sin dato, guiones) sin contarlos como vacíos', () => {
  const a = analyzeCsv('id,nota\n1,N/A\n2,sin dato\n3,ok\n4,-\n5,');
  assert.equal(a.placeholderCells, 3);
  assert.equal(a.columns[1].placeholder, 3);
  assert.equal(a.emptyCells, 1); // solo la fila 5 es vacía de verdad
});

test('Detecta casi duplicados que difieren en mayúsculas o espacios', () => {
  const a = analyzeCsv('id,nombre\n1,Ana Maria\n1,ana maria\n1,Ana  Maria\n1,ANA MARIA\n1,Ana Maria');
  assert.equal(a.duplicateRows, 1); // solo la última es duplicada exacta
  assert.equal(a.nearDuplicateRows, 3);
  assert.equal(a.rows[1].nearDuplicate, true);
  assert.equal(a.rows[4].nearDuplicate, false);
  assert.equal(a.rows[4].duplicate, true);
});

test('Reporta encabezados duplicados (también por mayúsculas) y vacíos', () => {
  const a = analyzeCsv('id,ID,,nombre, id \n1,2,3,4,5');
  assert.equal(a.duplicateHeaders, 2);
  assert.equal(a.emptyHeaders, 1);
});

test('Infiere el tipo de cada columna y marca las celdas que no coinciden', () => {
  const a = analyzeCsv([
    'monto,fecha,correo',
    '100,2026-01-05,ana@example.com',
    '250,2026-01-06,luis@example.com',
    'ERROR,2026-01-07,pedro@example.com',
    '300,31/02/2026,no-es-correo',
    '400,2026-01-08,eva@example.com'
  ].join('\n'));
  assert.equal(a.columns[0].type, 'numero');
  assert.equal(a.columns[0].typeMismatches, 1); // ERROR
  assert.equal(a.columns[1].type, 'fecha');
  assert.equal(a.columns[1].typeMismatches, 1); // 31/02/2026 no existe
  assert.equal(a.columns[2].type, 'correo');
  assert.equal(a.columns[2].typeMismatches, 1); // no-es-correo
  assert.equal(a.typeMismatchCells, 3);
  assert.equal(a.rows[2].typeMismatch, true);
  assert.equal(a.rows[3].typeMismatch, true);
  assert.equal(a.rows[0].typeMismatch, false);
  assert.equal(a.rows[4].typeMismatch, false);
});

test('El tipo ignora pseudo-vacíos y no marca columnas de texto ni mixtas', () => {
  const a = analyzeCsv('monto\n100\n200\nN/A\n300\n400');
  assert.equal(a.columns[0].type, 'numero');
  assert.equal(a.columns[0].typeMismatches, 0); // N/A es pseudo-vacío, no error de tipo
  assert.equal(a.placeholderCells, 1);
  const b = analyzeCsv('activo\ntrue\nfalse\ntrue\nsí\nfalse');
  assert.equal(b.columns[0].type, 'booleano');
  const c = analyzeCsv('dato\n123\nabc\n456\ndef');
  assert.equal(c.columns[0].type, 'mixto');
  assert.equal(c.columns[0].typeMismatches, 0);
  const d = analyzeCsv('ciudad\nLima\nCusco\nPiura');
  assert.equal(d.columns[0].type, 'texto');
  assert.equal(d.typeMismatchCells, 0);
});

test('Clasifica formatos numéricos y de fecha habituales', () => {
  assert.equal(classifyCell('1.234,56'), 'numero');
  assert.equal(classifyCell('1,234.56'), 'numero');
  assert.equal(classifyCell('-42'), 'numero');
  assert.equal(classifyCell('05/01/2026'), 'fecha');
  assert.equal(classifyCell('2026-13-01'), 'texto'); // mes imposible
  assert.equal(classifyCell('hola'), 'texto');
});

test('Resuelve encabezados repetidos', () => {
  const a = analyzeCsv('id,id,\n1,2,3');
  assert.deepEqual(a.headers, ['id', 'id (2)', 'Columna 3']);
});
