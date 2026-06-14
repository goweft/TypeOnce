const fs = require('fs');
const os = require('os');
const path = require('path');
const { Config, DEFAULTS } = require('../core/config');
const Engine = require('../core/engine');

// Each test gets an isolated config dir so nothing touches the repo's data/config.
function tmpConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'typeonce-cfg-'));
}

describe('Config', () => {
  test('returns defaults when no file exists', () => {
    const cfg = new Config({ configDir: tmpConfigDir() });
    expect(cfg.all()).toEqual(DEFAULTS);
    expect(cfg.get('caseSensitive')).toBe(false);
    expect(cfg.get('extraPackDirs')).toEqual([]);
  });

  test('set persists and a fresh Config reads it back', () => {
    const dir = tmpConfigDir();
    const cfg = new Config({ configDir: dir });
    cfg.set('caseSensitive', true);
    cfg.set('extraPackDirs', ['/tmp/packs']);

    const reloaded = new Config({ configDir: dir });
    expect(reloaded.get('caseSensitive')).toBe(true);
    expect(reloaded.get('extraPackDirs')).toEqual(['/tmp/packs']);
  });

  test('corrupt config file falls back to defaults (no throw)', () => {
    const dir = tmpConfigDir();
    fs.writeFileSync(path.join(dir, 'config.json'), '{ not valid json');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = new Config({ configDir: dir });
    expect(cfg.all()).toEqual(DEFAULTS);
    warn.mockRestore();
  });

  test('missing keys fall back to defaults; unknown keys are preserved', () => {
    const dir = tmpConfigDir();
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ caseSensitive: true, future: 'keep' })
    );
    const cfg = new Config({ configDir: dir });
    expect(cfg.get('caseSensitive')).toBe(true);
    expect(cfg.get('extraPackDirs')).toEqual([]); // defaulted
    expect(cfg.get('future')).toBe('keep');       // preserved
  });
});

describe('engine caseSensitive', () => {
  const inject = (eng, key, packVars = {}) =>
    eng.triggers.set(eng._normalizeKey(key), [
      { key, action: { type: 'text', template: 'hi' }, packId: 'test', packVars },
    ]);

  test('default (false): keys match case-insensitively', () => {
    const eng = new Engine();
    inject(eng, ';foo');
    expect(eng.expand(';FOO')).toBe('hi');
    expect(eng.expand(';Foo')).toBe('hi');
  });

  test('caseSensitive: true distinguishes case', () => {
    const eng = new Engine({ caseSensitive: true });
    inject(eng, ';Foo');
    expect(eng.expand(';Foo')).toBe('hi');
    expect(eng.expand(';foo')).toBeNull();
  });
});

describe('engine extraPackDirs', () => {
  function writePack(dir, file, body) {
    fs.writeFileSync(path.join(dir, file), body);
  }

  test('loads packs from extra dirs and does not double-count', () => {
    const main = fs.mkdtempSync(path.join(os.tmpdir(), 'typeonce-main-'));
    const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'typeonce-extra-'));
    writePack(main, 'a.yml', [
      'id: "main.a"', 'name: "Main"', 'version: "1"',
      'triggers:', '  - key: ";m"', '    action:', '      type: "text"', '      template: "from-main"',
    ].join('\n'));
    writePack(extra, 'b.yml', [
      'id: "extra.b"', 'name: "Extra"', 'version: "1"',
      'triggers:', '  - key: ";x"', '    action:', '      type: "text"', '      template: "from-extra"',
    ].join('\n'));

    const eng = new Engine();
    eng.loadPacks(main, { extraDirs: [extra] });

    expect(eng.expand(';m')).toBe('from-main');
    expect(eng.expand(';x')).toBe('from-extra');
    // No double-count: the cumulative parser map must not re-add main's pack.
    expect(eng.triggers.get(';m')).toHaveLength(1);
  });

  test('extra-dir packs stay eligible under a profile that does not list them', () => {
    const main = fs.mkdtempSync(path.join(os.tmpdir(), 'typeonce-main2-'));
    const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'typeonce-extra2-'));
    const profDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typeonce-prof-'));
    writePack(main, 'a.yml', [
      'id: "main.a"', 'name: "Main"', 'version: "1"',
      'triggers:', '  - key: ";m"', '    action:', '      type: "text"', '      template: "from-main"',
    ].join('\n'));
    writePack(extra, 'mine.yml', [
      'id: "user.mine"', 'name: "Mine"', 'version: "1"',
      'triggers:', '  - key: ";u"', '    action:', '      type: "text"', '      template: "from-user"',
    ].join('\n'));
    // A profile that lists ONLY the bundled pack — the user's extra pack is absent.
    fs.writeFileSync(path.join(profDir, 'profiles.yml'), [
      'default: narrow', 'profiles:', '  narrow:', '    packs: [main.a]',
    ].join('\n'));

    const prev = process.env.PROFILES_FILE;
    process.env.PROFILES_FILE = path.join(profDir, 'profiles.yml');
    try {
      const eng = new Engine();
      eng.loadPacks(main, { extraDirs: [extra] });
      // 'narrow' excludes user.mine, yet the extra-dir pack still resolves...
      expect(eng.expand(';u', { profile: 'narrow' })).toBe('from-user');
      // ...while the bundled pack resolves because it's in the profile.
      expect(eng.expand(';m', { profile: 'narrow' })).toBe('from-main');
    } finally {
      if (prev === undefined) delete process.env.PROFILES_FILE;
      else process.env.PROFILES_FILE = prev;
    }
  });
});
