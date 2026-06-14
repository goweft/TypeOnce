const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

/**
 * Resolve the profiles file path. Honors PROFILES_FILE (set in docker-compose);
 * otherwise falls back to `<packDir>/../profiles.yml`. Returns null when no
 * candidate path can be determined.
 */
function resolveProfilesPath(packDir) {
  if (process.env.PROFILES_FILE) return process.env.PROFILES_FILE;
  if (packDir) return path.join(packDir, '..', 'profiles.yml');
  return null;
}

class ProfileManager {
  constructor({ profiles = {}, default: def = null } = {}) {
    this.profiles = profiles;     // { name: { description, packs: [...] } }
    this.default = def;           // name of the default profile, or null
  }

  getProfile(name) {
    if (!name) return null;
    return Object.prototype.hasOwnProperty.call(this.profiles, name)
      ? this.profiles[name]
      : null;
  }

  listProfiles() {
    return Object.entries(this.profiles).map(([name, profile]) => ({
      name,
      description: (profile && profile.description) || '',
      packs: (profile && profile.packs) || [],
      isDefault: name === this.default,
    }));
  }
}

/**
 * Load + validate profiles.yml. Returns a ProfileManager, or null when no
 * profiles file is present (no-profile mode -> all packs eligible).
 *
 * @param {string|null} packDir       used for the `<packDir>/../profiles.yml` fallback
 * @param {Set<string>|null} knownPackIds  pack ids loaded by the engine, for validation
 */
function loadProfiles(packDir, knownPackIds = null) {
  const file = resolveProfilesPath(packDir);
  if (!file || !fs.existsSync(file)) return null;

  let doc;
  try {
    doc = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  } catch (error) {
    // Malformed profiles file: warn (don't throw) and fall back to no-profile mode.
    console.warn(`⚠ failed to parse profiles file ${file}: ${error.message}`);
    return null;
  }

  const profiles = (doc && doc.profiles) || {};
  const def = (doc && doc.default) || null;

  // Validate referenced pack ids exist among loaded packs. Warn, never throw.
  if (knownPackIds) {
    for (const [name, profile] of Object.entries(profiles)) {
      const packs = (profile && profile.packs) || [];
      for (const packId of packs) {
        if (!knownPackIds.has(packId)) {
          console.warn(`⚠ profile "${name}" references unknown pack id: ${packId}`);
        }
      }
    }
  }
  if (def && !Object.prototype.hasOwnProperty.call(profiles, def)) {
    console.warn(`⚠ default profile "${def}" is not defined`);
  }

  return new ProfileManager({ profiles, default: def });
}

module.exports = { loadProfiles, resolveProfilesPath, ProfileManager };
