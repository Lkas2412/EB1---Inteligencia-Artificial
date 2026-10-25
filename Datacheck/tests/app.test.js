import test from 'node:test';
import assert from 'node:assert/strict';

class FakeElement {
  constructor() {
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.className = '';
    this.style = {};
    this.classes = new Set();
    this.classList = {
      toggle: (name, force) => {
        const enabled = force ?? !this.classes.has(name);
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
        return enabled;
      }
    };
  }

  get textContent() {
    return this.children.length
      ? this.children.map(child => typeof child === 'string' ? child : child.textContent).join('')
      : this._text ?? '';
  }

  set textContent(value) {
    this.children = [];
    this._text = String(value);
  }

  set innerHTML(value) {
    this.children = [];
    this._text = String(value).replace(/<[^>]*>/g, '');
  }

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = nodes;
    this._text = '';
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

test('una carga CSV inválida muestra el error y limpia el análisis anterior', async t => {
  const selectors = [
    '#csvInput', '#dropZone', '#message', '#fileLabel', '#resetBtn', '#exportBtn',
    '#statRows', '#statCols', '#statBlanks', '#statDuplicates', '#statBlanksSub',
    '#insight', '#insightText', '#columnsList', '#tableWrap', '#previewCount',
    '#previewHelp', '#selectBtn', '#demoBtn'
  ];
  const elements = new Map(selectors.map(selector => [selector, new FakeElement()]));
  const filters = ['all', 'incomplete', 'duplicates'].map(filter => {
    const button = new FakeElement();
    button.dataset.filter = filter;
    return button;
  });
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector: selector => elements.get(selector),
    querySelectorAll: selector => selector === '[data-filter]' ? filters : [],
    createElement: () => new FakeElement(),
    createTextNode: text => ({ textContent: text })
  };
  t.after(() => { globalThis.document = previousDocument; });
  await import(`../src/app.js?test=${Date.now()}`);

  const input = elements.get('#csvInput');
  const submit = async file => {
    input.files = [file];
    await input.listeners.change();
  };
  const validFile = {
    name: 'valido.csv',
    size: 20,
    text: async () => 'id,nombre\n1,Ana\n2,Luis'
  };
  await submit(validFile);
  assert.equal(elements.get('#statRows').textContent, '2', elements.get('#message').textContent);
  assert.equal(elements.get('#exportBtn').disabled, false);
  assert.equal(elements.get('#previewCount').textContent, '2 registros');

  await submit({
    name: 'invalido.csv',
    size: 20,
    text: async () => 'id,nombre\n1,"sin cerrar'
  });
  assert.equal(elements.get('#message').textContent, 'El CSV contiene comillas sin cerrar. Corrige el archivo e inténtalo nuevamente.');
  assert.equal(elements.get('#statRows').textContent, '—');
  assert.equal(elements.get('#statCols').textContent, '—');
  assert.equal(elements.get('#statBlanks').textContent, '—');
  assert.equal(elements.get('#statDuplicates').textContent, '—');
  assert.equal(elements.get('#statBlanksSub').textContent, 'Pendiente de análisis');
  assert.equal(elements.get('#insight').hidden, true);
  assert.match(elements.get('#columnsList').textContent, /Importa un archivo/);
  assert.match(elements.get('#tableWrap').textContent, /Aquí podrás revisar/);
  assert.equal(elements.get('#previewCount').textContent, 'Sin datos');
  assert.equal(elements.get('#previewHelp').hidden, true);
  assert.equal(elements.get('#exportBtn').disabled, true);
  assert.equal(elements.get('#resetBtn').hidden, true);
  assert.equal(elements.get('#fileLabel').textContent.trim(), 'Ningún archivo cargado');
  assert.equal(filters[0].attributes['aria-pressed'], 'true');
  assert.equal(filters[1].attributes['aria-pressed'], 'false');
  assert.equal(filters[2].attributes['aria-pressed'], 'false');
});
