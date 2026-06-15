const Renderer = require('../core/renderer');
const Engine = require('../core/engine');
const PackParser = require('../core/parser');

describe('input rendering', () => {
  const r = new Renderer();

  test('{{inputs.x}} namespace resolves, and flat {{x}} still works', () => {
    const out = r.render('ns=[{{inputs.x}}] flat=[{{x}}]', { inputs: { x: 'V' } });
    expect(out).toBe('ns=[V] flat=[V]');
  });

  test('a named input shadows a same-named global (e.g. user) when namespaced', () => {
    const out = r.render('{{inputs.user}}', { inputs: { user: 'sam' } });
    expect(out).toBe('sam');
  });
});

describe('engine input resolution', () => {
  let eng;
  // Entries follow the registry shape: key -> Array<{ ...trigger, packId, packVars }>.
  const set = (key, trigger) =>
    eng.triggers.set(key, [{ key, packId: 'test', packVars: {}, ...trigger }]);

  beforeEach(() => {
    eng = new Engine();
  });

  test('applies declared defaults for inputs not provided', () => {
    set(';t', {
      inputs: [{ name: 'a', default: 'DA' }, { name: 'b', default: 'DB' }],
      action: { type: 'text', template: 'a={{inputs.a}} b={{inputs.b}}' },
    });
    expect(eng.expand(';t')).toBe('a=DA b=DB');
  });

  test('provided values override declared defaults', () => {
    set(';t', {
      inputs: [{ name: 'a', default: 'DA' }],
      action: { type: 'text', template: 'a={{inputs.a}}' },
    });
    expect(eng.expand(';t', { inputs: { a: 'X' } })).toBe('a=X');
  });

  test('a required input with no default and no value renders empty (graceful)', () => {
    set(';t', {
      inputs: [{ name: 'a', required: true }],
      action: { type: 'text', template: 'a=[{{inputs.a}}]' },
    });
    expect(eng.expand(';t')).toBe('a=[]');
  });

  test('getAllTriggers carries declared inputs so the API can expose them', () => {
    set(';t', {
      label: 'T',
      inputs: [{ name: 'a', prompt: 'A?' }],
      action: { type: 'text', template: '{{inputs.a}}' },
    });
    const found = eng.getAllTriggers().find((x) => x.key === ';t');
    expect(Array.isArray(found.inputs)).toBe(true);
    expect(found.inputs[0].name).toBe('a');
  });
});

describe('parser input validation', () => {
  const base = { id: 'p', name: 'P', version: '1.0.0' };
  const validate = (triggers) => new PackParser().validatePack({ ...base, triggers });

  test('rejects inputs combined with raw', () => {
    const v = validate([
      { key: ';x', inputs: [{ name: 'a', prompt: 'A' }], action: { type: 'text', raw: true, template: 'x' } },
    ]);
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toMatch(/raw/i);
  });

  test('rejects an input missing a name', () => {
    const v = validate([
      { key: ';x', inputs: [{ prompt: 'A' }], action: { type: 'text', template: 'x' } },
    ]);
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toMatch(/name/i);
  });

  test('rejects a select input with no options', () => {
    const v = validate([
      { key: ';x', inputs: [{ name: 'a', prompt: 'A', type: 'select' }], action: { type: 'text', template: 'x' } },
    ]);
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toMatch(/options/i);
  });

  test('accepts a valid inputs block', () => {
    const v = validate([
      {
        key: ';x',
        inputs: [
          { name: 'a', prompt: 'A', required: true },
          { name: 'b', prompt: 'B', type: 'select', options: ['x', 'y'], default: 'x' },
          { name: 'c', prompt: 'C', type: 'number', default: 3 },
        ],
        action: { type: 'text', template: '{{inputs.a}}{{inputs.b}}{{inputs.c}}' },
      },
    ]);
    expect(v.valid).toBe(true);
  });

  test('triggers without inputs are unaffected', () => {
    const v = validate([{ key: ';x', action: { type: 'text', raw: true, template: 'x' } }]);
    expect(v.valid).toBe(true);
  });
});
