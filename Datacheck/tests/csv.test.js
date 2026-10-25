import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCsv, parseDelimited, detectDelimiter, csvCell, makeReport, makeCleanCsv, classifyCell, decodeCsvData, validateSchema, generateSchema, diffAnalyses, makeDiffReport } from '../src/csv.js';

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

test('Calcula estadísticas por columna y detecta atípicos por IQR', () => {
  const a = analyzeCsv('monto\n' + ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '1000'].join('\n'));
  const col = a.columns[0];
  assert.equal(col.type, 'numero');
  assert.equal(col.stats.min, 10);
  assert.equal(col.stats.max, 1000);
  assert.ok(Math.abs(col.stats.mean - 1145 / 11) < 0.01);
  assert.equal(col.stats.median, 15);
  assert.equal(col.outliers, 1);
  assert.equal(a.outlierCells, 1);
  assert.equal(a.rows[10].outlier, true);
  assert.equal(a.rows[0].outlier, false);
});

test('Una columna numérica constante no marca atípicos', () => {
  const a = analyzeCsv('x\n5\n5\n5\n5');
  assert.equal(a.columns[0].outliers, 0);
  assert.equal(a.outlierCells, 0);
});

test('Reporta el rango de fechas y los valores frecuentes', () => {
  const a = analyzeCsv('ciudad,fecha\nLima,2026-03-01\nCusco,2026-01-15\nLima,2026-02-10\nLima,2026-01-20');
  const [ciudad, fecha] = a.columns;
  assert.deepEqual(ciudad.topValues, [{ value: 'Lima', count: 3 }]);
  assert.equal(fecha.type, 'fecha');
  assert.equal(fecha.stats.min, '2026-01-15');
  assert.equal(fecha.stats.max, '2026-03-01');
});

test('Detecta valores repetidos en una columna que parece clave', () => {
  const ids = Array.from({ length: 19 }, (_, i) => `ID-${i + 1}`);
  const a = analyzeCsv('id,ciudad\n' + [...ids, 'ID-1'].map((id, i) => `${id},Ciudad${i % 3}`).join('\n'));
  // 20 filas y 19 IDs únicos (95 %): parece identificador y tiene 1 repetido.
  assert.equal(a.columns[0].keyDuplicates, 1);
  assert.equal(a.keyCollisions.length, 1);
  assert.equal(a.keyCollisions[0].name, 'id');
  // La ciudad se repite mucho: no es una posible clave, no se marca.
  assert.equal(a.columns[1].keyDuplicates, 0);
});

test('Decodifica UTF-8 y rescata Windows-1252 avisando la codificación', () => {
  const utf8 = decodeCsvData(new TextEncoder().encode('nombre\nJosé'));
  assert.equal(utf8.encoding, 'utf-8');
  assert.match(utf8.text, /José/);
  // 'año' en Windows-1252: la ñ es el byte 0xF1, UTF-8 inválido.
  const win = decodeCsvData(Uint8Array.from([0x61, 0xF1, 0x6F]).buffer);
  assert.equal(win.encoding, 'windows-1252');
  assert.equal(win.text, 'año');
});

test('Cuenta celdas con mojibake (texto dañado por doble codificación)', () => {
  const a = analyzeCsv('nombre\nJosÃ©\nMarÃ­a\nAna');
  assert.equal(a.mojibakeCells, 2);
});

test('Valida un archivo contra un esquema definido por el usuario', () => {
  const a = analyzeCsv('id,correo,monto\n1,ana@example.com,100\n2,sin-arroba,250\n2,luis@example.com,99999\n,mal@,50');
  const r = validateSchema(a, { columns: {
    id: { required: true, unique: true },
    correo: { type: 'correo' },
    monto: { type: 'numero', min: 0, max: 1000 }
  }});
  // id: repetido (fila 3) + vacío requerido (fila 4) = 2 · correo: filas 2 y 4 = 2 · monto: 99999 fuera de rango = 1
  assert.equal(r.total, 5);
  assert.deepEqual(r.perColumn.map(c => [c.name, c.count]), [['id', 2], ['correo', 2], ['monto', 1]]);
  assert.ok(r.rowViolations.has(1) && r.rowViolations.has(2) && r.rowViolations.has(3));
  assert.equal(r.rowViolations.has(0), false);
});

test('El esquema reporta columnas ausentes y patrones inválidos sin romperse', () => {
  const a = analyzeCsv('a\n1');
  const r = validateSchema(a, { columns: { fantasma: { required: true }, a: { pattern: '([' } } });
  assert.equal(r.total, 1);
  assert.equal(r.perColumn[0].missing, true);
  assert.equal(r.errors.length, 1);
});

test('Genera un esquema desde el propio archivo y ese archivo lo cumple', () => {
  const a = analyzeCsv('id,correo,nota\n1,ana@example.com,x\n2,luis@example.com,y');
  const s = generateSchema(a);
  assert.equal(s.columns.id.required, true);
  assert.equal(s.columns.id.unique, true);
  assert.equal(s.columns.correo.type, 'correo');
  assert.equal(validateSchema(a, s).total, 0);
});

test('Calcula el histograma de una columna numérica', () => {
  const a = analyzeCsv('v\n' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].join('\n'));
  assert.deepEqual(a.columns[0].stats.histogram, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  const b = analyzeCsv('v\n5\n5\n5\n15');
  assert.equal(b.columns[0].stats.histogram[0], 3);
  assert.equal(b.columns[0].stats.histogram[9], 1);
});

test('La limpieza guiada aplica solo las opciones marcadas', () => {
  const a = analyzeCsv('nombre,fecha,nota\nAna,15/03/2026,N/A\nLuis,2026-01-05,ok\n,,\nANA,15/03/2026,N/A');
  const plain = makeCleanCsv(a);
  // Sin opciones: solo caerían duplicadas exactas (no hay); nada se transforma.
  assert.equal(plain.split('\r\n').length, 5);
  assert.match(plain, /N\/A/);
  assert.match(plain, /15\/03\/2026/);
  const fixed = makeCleanCsv(a, { removeEmptyRows: true, placeholdersToEmpty: true, datesToIso: true, removeNearDuplicates: true });
  assert.equal(fixed, '﻿"nombre","fecha","nota"\r\n"Ana","2026-03-15",""\r\n"Luis","2026-01-05","ok"');
});

test('Compara dos archivos por una columna clave', () => {
  const base = analyzeCsv('id,nombre,monto\n1,Ana,100\n2,Luis,200\n3,Pedro,300');
  const other = analyzeCsv('id,nombre,monto,extra\n2,Luis,250,x\n3,Pedro,300,y\n4,Marta,400,z');
  const d = diffAnalyses(base, other, 'id');
  assert.equal(d.added.length, 1);
  assert.equal(d.added[0].key, '4');
  assert.equal(d.removed.length, 1);
  assert.equal(d.removed[0].key, '1');
  assert.equal(d.changed.length, 1);
  assert.deepEqual(d.changed[0].changes, [{ column: 'monto', from: '200', to: '250' }]);
  assert.deepEqual(d.addedColumns, ['extra']);
  const report = makeDiffReport(d);
  assert.match(report, /Agregada/);
  assert.match(report, /Eliminada/);
  assert.match(report, /"250"/);
});

test('La comparación cuenta las claves vacías o repetidas que no puede reconciliar', () => {
  const base = analyzeCsv('id,nombre\n,Ana\n5,Luis\n5,Repetido');
  const other = analyzeCsv('id,nombre\n5,Luis');
  const d = diffAnalyses(base, other, 'id');
  assert.equal(d.ignoredBase, 2);
  assert.equal(d.changed.length, 0);
});

test('Una fila con delimitadores y celdas vacías cuenta como registro incompleto', () => {
  const a = analyzeCsv('a,b,c\n,,\n1,2,3');
  assert.equal(a.rows.length, 2);
  assert.equal(a.rows[0].incomplete, true);
  assert.equal(a.emptyCells, 3);
  // Dos registros vacíos son duplicados entre sí.
  assert.equal(analyzeCsv('a,b\n,\n,').duplicateRows, 1);
});

test('Las líneas físicamente en blanco se siguen omitiendo', () => {
  const a = analyzeCsv('a,b\n\n1,2\n   \n3,4\n');
  assert.equal(a.rows.length, 2);
});

test('Más de 20 000 filas da el error amable, no un RangeError', () => {
  // Regresión: el ancho se calculaba con Math.max(...filas) y un archivo
  // de ~600 KB con filas cortas reventaba la pila antes del chequeo.
  assert.throws(() => analyzeCsv('a,b\n' + '1,2\n'.repeat(150000)), /20 000 registros/);
  assert.doesNotThrow(() => analyzeCsv('a\n' + '1\n'.repeat(20000)));
});

test('Acepta fechas de años menores a 100 y rechaza sus imposibles', () => {
  assert.equal(classifyCell('0001-01-01'), 'fecha');
  assert.equal(classifyCell('0099-05-05'), 'fecha');
  assert.equal(classifyCell('0099-02-29'), 'texto'); // el año 99 no es bisiesto
});

test('Cuenta un encabezado que choca con una etiqueta generada como duplicado', () => {
  const a = analyzeCsv(',Columna 1\n1,2');
  assert.deepEqual(a.headers, ['Columna 1', 'Columna 1 (2)']);
  assert.equal(a.emptyHeaders, 1);
  assert.equal(a.duplicateHeaders, 1);
});

test('Resuelve encabezados repetidos', () => {
  const a = analyzeCsv('id,id,\n1,2,3');
  assert.deepEqual(a.headers, ['id', 'id (2)', 'Columna 3']);
});
