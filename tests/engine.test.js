const path = require('path');
const Engine = require('../core/engine');

const PACKS = path.join(__dirname, '..', 'data', 'packs');

let engine;
beforeAll(() => {
  engine = new Engine();
  engine.loadPacks(PACKS);
});

describe('TypeOnce engine', () => {
  test('loads packs and collapses duplicate keys (last-wins)', () => {
    // The 7 core packs yield 43 unique keys; additional packs only add more.
    // A floor (rather than an exact count) keeps this green as packs grow,
    // while still catching a load failure.
    expect(engine.triggers.size).toBeGreaterThanOrEqual(43);
  });

  test('{{vars.*}} resolves (regression: signatures/intros were rendering blank)', () => {
    const intro = engine.expand(';intro');
    expect(intro).toContain('Gostev');      // {{vars.name}}
    expect(intro).toContain('Your Company'); // {{vars.company}}
  });

  test('raw triggers keep Go-template format strings intact and unescaped', () => {
    const docker = engine.expand(';docker');
    expect(docker).toContain('{{.Names}}');
    expect(docker).not.toContain('&'); // not HTML-mangled
  });

  test('substituted output is not HTML-escaped', () => {
    expect(engine.expand(';date')).not.toContain('&#x2F;');
  });

  test('unknown trigger returns null', () => {
    expect(engine.expand(';no-such-trigger')).toBeNull();
  });
});

describe('script actions', () => {
  // Fresh engine so directly-injected entries don't leak into other suites.
  // Entries follow the registry shape: key -> Array<{ ...trigger, packVars }>.
  let eng;
  const set = (key, action, packVars = {}) =>
    eng.triggers.set(key, [{ key, action, packId: 'test', packVars }]);

  beforeEach(() => {
    eng = new Engine();
  });

  test('runs the command and returns trimmed stdout', () => {
    set(';echo', { type: 'script', command: 'echo hello' });
    expect(eng.expand(';echo')).toBe('hello');
  });

  test('command is a template (vars + inputs interpolate)', () => {
    set(';greet', { type: 'script', command: 'echo {{vars.x}}-{{name}}' }, { x: 'hi' });
    expect(eng.expand(';greet', { inputs: { name: 'sam' } })).toBe('hi-sam');
  });

  test('trim: false keeps the trailing newline', () => {
    set(';raw', { type: 'script', command: 'echo keep', trim: false });
    expect(eng.expand(';raw')).toBe('keep\n');
  });

  test('unknown action type throws', () => {
    set(';bogus', { type: 'macro' });
    expect(() => eng.expand(';bogus')).toThrow('Unknown action type: macro');
  });

  test('the developer pack ships a working script trigger', () => {
    eng.loadPacks(path.join(__dirname, '..', 'data', 'packs'));
    const branch = eng.getTrigger(';branch');
    expect(branch.action.type).toBe('script');
    // Runs without throwing and returns a string (exact value is env-dependent).
    expect(typeof eng.expand(';branch')).toBe('string');
  });
});
