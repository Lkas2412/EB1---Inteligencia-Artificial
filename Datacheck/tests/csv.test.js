import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCsv, parseDelimited, detectDelimiter, csvCell, makeReport } from '../src/csv.js';

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

test('Resuelve encabezados repetidos', () => {
  const a = analyzeCsv('id,id,\n1,2,3');
  assert.deepEqual(a.headers, ['id', 'id (2)', 'Columna 3']);
});
