const path = require('path');
const Engine = require('../core/engine');

const PACKS = path.join(__dirname, '..', 'data', 'packs');

let engine;
beforeAll(() => {
  engine = new Engine();
  engine.loadPacks(PACKS);
});

describe('TypeOnce engine', () => {
  test('loads packs; duplicate keys collapse last-wins (45 entries -> 43 unique)', () => {
    expect(engine.triggers.size).toBe(43);
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
