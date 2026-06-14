const path = require('path');
const fs = require('fs');
const os = require('os');
const Engine = require('../core/engine');
const { loadProfiles } = require('../core/profiles');

const PACKS = path.join(__dirname, '..', 'data', 'packs');

describe('TypeOnce profiles', () => {
  let engine;

  beforeEach(() => {
    // Keep the engine deterministic regardless of the ambient shell.
    delete process.env.PROFILE;
    delete process.env.PROFILES_FILE;
    engine = new Engine();
    engine.loadPacks(PACKS); // picks up data/profiles.yml via <packDir>/../profiles.yml
  });

  test('profiles.yml loads the three profiles with a default', () => {
    const names = engine.listProfiles().map((p) => p.name).sort();
    expect(names).toEqual(['ir', 'personal', 'work']);
    expect(engine.profileManager.default).toBe('work');
  });

  test('unknown pack ids warn but do not throw', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const tmp = path.join(os.tmpdir(), `typeonce-profiles-${process.pid}.yml`);
    fs.writeFileSync(
      tmp,
      'default: work\nprofiles:\n  work:\n    description: W\n    packs: [does.not.exist, dev.toolkit]\n'
    );
    process.env.PROFILES_FILE = tmp;

    let mgr;
    expect(() => {
      mgr = loadProfiles(null, new Set(['dev.toolkit']));
    }).not.toThrow();

    expect(mgr).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('does.not.exist')
    );

    warn.mockRestore();
    delete process.env.PROFILES_FILE;
    fs.unlinkSync(tmp);
  });

  test('work profile: ;sig is the business signature; ;docker is dev.toolkit', () => {
    engine.setActiveProfile('work');

    const sig = engine.expand(';sig');
    expect(sig).toContain('Gostev'); // biz.communication vars.name
    expect(sig).toContain('Email:');
    expect(sig).toContain('Phone:');

    const docker = engine.expand(';docker');
    expect(docker).toContain('{{.Names}}'); // raw, Go-template intact
    expect(docker).toMatch(/^docker ps/); // dev.toolkit, not "sudo docker"
    expect(docker).not.toMatch(/sudo/);
  });

  test('personal profile: ;sig is the short signature; ;docker is custom.personal', () => {
    engine.setActiveProfile('personal');

    const sig = engine.expand(';sig');
    expect(sig).toContain('ACME Corp'); // typeonce.essentials vars.company
    expect(sig).not.toContain('Email:');
    expect(sig).not.toContain('Phone:');

    const docker = engine.expand(';docker');
    expect(docker).toContain('sudo docker ps'); // custom.personal
    expect(docker).toContain('{{.Names}}');
  });

  test('a profile resolves the same trigger to a different result than another', () => {
    engine.setActiveProfile('work');
    const workSig = engine.expand(';sig');
    engine.setActiveProfile('personal');
    const personalSig = engine.expand(';sig');
    expect(workSig).not.toEqual(personalSig);
  });

  test('per-request profile overrides the active profile without mutating it', () => {
    engine.setActiveProfile('work');

    const personalDocker = engine.expand(';docker', { profile: 'personal' });
    const workDocker = engine.expand(';docker', { profile: 'work' });

    expect(personalDocker).toContain('sudo docker');
    expect(workDocker).not.toContain('sudo docker');
    expect(personalDocker).not.toEqual(workDocker);

    // active profile is untouched by the per-request overrides
    expect(engine.getActiveProfileName()).toBe('work');
  });

  test('no profile -> all packs eligible; cross-pack keys still collapse (back-compat)', () => {
    // 7 core packs -> 43 unique keys; extra packs only add more (floor, not exact).
    expect(engine.triggers.size).toBeGreaterThanOrEqual(43);
    expect(engine.getActiveProfileName()).toBeNull();

    // Registry shape: a colliding key holds multiple candidates but one map entry.
    expect(engine.triggers.get(';sig').length).toBeGreaterThanOrEqual(2);
    expect(engine.triggers.get(';docker').length).toBeGreaterThanOrEqual(2);

    // essentials (;date) is reachable only when no profile filters it out
    expect(engine.expand(';date')).toBeTruthy();
    // last-wins across packs is preserved (dev.toolkit's raw docker ps)
    expect(engine.expand(';docker')).toContain('{{.Names}}');
  });

  test('getAllTriggers reflects the active profile', () => {
    const allKeys = new Set(engine.getAllTriggers().map((t) => t.key));
    expect(allKeys.has(';date')).toBe(true); // essentials present with no profile

    engine.setActiveProfile('work');
    const workKeys = new Set(engine.getAllTriggers().map((t) => t.key));
    expect(workKeys.has(';date')).toBe(false); // essentials excluded from work
    expect(workKeys.has(';greet')).toBe(true); // biz.communication present
    expect(workKeys.has(';docker')).toBe(true); // dev.toolkit present
  });
});
