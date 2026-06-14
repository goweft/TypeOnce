#!/usr/bin/env node
const { program, InvalidArgumentError } = require('commander');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const ExpansionEngine = require('../core/engine');
const PackParser = require('../core/parser');
const InputHandler = require('../core/input');
const { Config, DEFAULTS } = require('../core/config');

// Accumulate repeatable `--input key=value` flags into an object.
function collectInput(value, previous) {
  const eq = value.indexOf('=');
  if (eq === -1) {
    // InvalidArgumentError makes commander print a clean message + exit 1
    // instead of dumping a stack trace.
    throw new InvalidArgumentError(`Invalid --input '${value}', expected key=value`);
  }
  previous[value.slice(0, eq)] = value.slice(eq + 1);
  return previous;
}

// Canonical pack set lives in data/packs (overridable via PACK_DIR). This is the
// same set the API and tests use, so collisions like ;sig / ;docker are present
// and therefore resolvable by profile.
const packDir = process.env.PACK_DIR || path.join(__dirname, '..', 'data', 'packs');
const configDir = path.join(__dirname, '..', 'data', 'config');
const activeProfileFile = path.join(configDir, 'active-profile');

const config = new Config();

// Extra pack dirs from config let users load their own packs alongside the
// bundled set without touching the repo. Resolved against cwd; missing dirs skipped.
const extraDirs = (config.get('extraPackDirs') || [])
  .map((d) => path.resolve(d))
  .filter((d) => fs.existsSync(d));

const engine = new ExpansionEngine({ caseSensitive: config.get('caseSensitive') });
if (fs.existsSync(packDir)) {
  engine.loadPacks(packDir, { extraDirs });
}

// --- active profile persistence ------------------------------------------

function readPersistedProfile() {
  try {
    if (fs.existsSync(activeProfileFile)) {
      const v = fs.readFileSync(activeProfileFile, 'utf8').trim();
      return v || null;
    }
  } catch (_) { /* ignore */ }
  return null;
}

function writePersistedProfile(name) {
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(activeProfileFile, `${name}\n`);
}

// Resolution order: PROFILE env -> persisted file -> profiles.yml default -> none.
function resolveProfileName() {
  if (process.env.PROFILE) return process.env.PROFILE;
  const persisted = readPersistedProfile();
  if (persisted) return persisted;
  if (engine.profileManager && engine.profileManager.default) {
    return engine.profileManager.default;
  }
  return null;
}

function applyActiveProfile() {
  engine.setActiveProfile(resolveProfileName());
}

program
  .name('typeonce')
  .description('Smart text expansion engine')
  .version('0.1.0');

program
  .command('expand <trigger>')
  .description('Expand a trigger (uses the active profile)')
  .option('-i, --input <key=value>', 'provide an input value (repeatable)', collectInput, {})
  .action(async (trigger, options) => {
    applyActiveProfile();
    // Resolve the trigger first so we can prompt for its declared inputs before
    // expanding. Values from --input are used as-is; the rest are prompted for
    // (or fall back to defaults when stdin isn't a TTY, e.g. piped/CI).
    const resolved = engine.getTrigger(trigger);
    if (!resolved) {
      console.error(`Trigger '${trigger}' not found`);
      process.exit(1);
    }
    const inputs = await new InputHandler().collectInputs(resolved, options.input);
    const result = engine.expand(trigger, { inputs });
    if (result !== null) {
      console.log(result);
    } else {
      console.error(`Trigger '${trigger}' not found`);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List available triggers (filtered by the active profile)')
  .action(() => {
    applyActiveProfile();
    const active = engine.getActiveProfileName();
    if (active) console.error(`profile: ${active}`);
    const triggers = engine.getAllTriggers();
    triggers.forEach((trigger) => {
      console.log(`${trigger.key.padEnd(15)} ${trigger.label || ''} [${trigger.packId}]`);
    });
  });

// --- profile command group -----------------------------------------------

const profileCmd = program
  .command('profile')
  .description('Manage role-based profiles');

profileCmd
  .command('list')
  .description('List profiles, their packs, and which is default/active')
  .action(() => {
    const profiles = engine.listProfiles();
    if (profiles.length === 0) {
      console.log('No profiles configured (all packs eligible).');
      return;
    }
    const active = resolveProfileName();
    profiles.forEach((p) => {
      const flags = [];
      if (p.isDefault) flags.push('default');
      if (p.name === active) flags.push('active');
      const suffix = flags.length ? ` (${flags.join(', ')})` : '';
      console.log(`${p.name}${suffix}`);
      if (p.description) console.log(`  ${p.description}`);
      console.log(`  packs: ${p.packs.join(', ')}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Set the active profile (persisted to data/config/active-profile)')
  .action((name) => {
    if (engine.profileManager && !engine.profileManager.getProfile(name)) {
      console.error(`Unknown profile '${name}'. Run 'typeonce profile list'.`);
      process.exit(1);
    }
    writePersistedProfile(name);
    console.log(`Active profile set to '${name}'`);
  });

profileCmd
  .command('current')
  .description('Print the active profile')
  .action(() => {
    const name = resolveProfileName();
    console.log(name || '(none — all packs eligible)');
  });

// --- config command group ------------------------------------------------

// Coerce a CLI string to the type of the setting's default (bool / array / string),
// so `config set caseSensitive true` stores a boolean, not the string "true".
function coerceConfigValue(key, raw) {
  const def = DEFAULTS[key];
  if (typeof def === 'boolean') {
    if (['true', '1', 'yes', 'on'].includes(raw.toLowerCase())) return true;
    if (['false', '0', 'no', 'off'].includes(raw.toLowerCase())) return false;
    throw new InvalidArgumentError(`'${key}' expects a boolean (true/false), got '${raw}'`);
  }
  if (Array.isArray(def)) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return raw;
}

const configCmd = program
  .command('config')
  .description('Manage app settings (orthogonal to profiles)');

configCmd
  .command('list')
  .description('Show all settings')
  .action(() => {
    const all = config.all();
    Object.keys(all).forEach((k) => {
      console.log(`${k} = ${JSON.stringify(all[k])}`);
    });
  });

configCmd
  .command('get <key>')
  .description('Print a setting')
  .action((key) => {
    console.log(JSON.stringify(config.get(key)));
  });

configCmd
  .command('set <key> <value>')
  .description('Set a setting (e.g. caseSensitive true, extraPackDirs a,b)')
  .action((key, value) => {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
      console.error(`Unknown setting '${key}'. Known: ${Object.keys(DEFAULTS).join(', ')}`);
      process.exit(1);
    }
    let coerced;
    try {
      // coerceConfigValue throws on a bad value; caught here because commander
      // only auto-handles parser errors, not ones thrown from an action handler.
      coerced = coerceConfigValue(key, value);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    config.set(key, coerced);
    console.log(`${key} = ${JSON.stringify(coerced)}`);
  });

program
  .command('validate')
  .description('Validate all packs (and profile references)')
  .action(() => {
    let ok = true;
    const parser = new PackParser();

    if (!fs.existsSync(packDir)) {
      console.error(`Pack directory not found: ${packDir}`);
      process.exit(1);
    }

    const files = fs
      .readdirSync(packDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    const knownPackIds = new Set();

    for (const file of files) {
      const full = path.join(packDir, file);
      try {
        const pack = yaml.load(fs.readFileSync(full, 'utf8'));
        const v = parser.validatePack(pack);
        if (!v.valid) {
          ok = false;
          console.error(`✗ ${file}: ${v.errors.join(', ')}`);
        } else {
          knownPackIds.add(pack.id);
          console.log(`✓ ${file} — ${pack.id} (${pack.triggers.length} triggers)`);
        }
      } catch (error) {
        ok = false;
        console.error(`✗ ${file}: ${error.message}`);
      }
    }

    // Validate that profiles reference packs that actually exist.
    const profiles = engine.listProfiles();
    for (const p of profiles) {
      for (const packId of p.packs) {
        if (!knownPackIds.has(packId)) {
          ok = false;
          console.error(`✗ profile '${p.name}' references unknown pack id: ${packId}`);
        }
      }
    }

    if (ok) {
      console.log('All packs are valid');
    } else {
      console.error('Validation failed');
      process.exit(1);
    }
  });

// parseAsync so the now-async `expand` action (which awaits input collection)
// is fully awaited before the process exits.
program.parseAsync();
