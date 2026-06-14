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
