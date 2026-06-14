const PackParser = require('./parser');
const Renderer = require('./renderer');
const { loadProfiles } = require('./profiles');
const EventEmitter = require('events');
const { execSync } = require('child_process');

class ExpansionEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.parser = new PackParser();
    this.renderer = new Renderer();
    // key -> Array<{ ...trigger, packId, packVars }>. A key may hold entries
    // from multiple packs; profile-aware resolution decides which one wins.
    this.triggers = new Map();
    this.profileManager = null;
    this.activeProfileName = null;
    // Match trigger keys case-sensitively? Default (false) preserves the historic
    // lowercase-everything behavior. Set before loadPacks so keys are stored to match.
    this.caseSensitive = options.caseSensitive || false;
    // Pack ids already ingested, so loading extra dirs never double-counts a pack.
    this._ingestedPackIds = new Set();
    // Pack ids that bypass profile filtering. The user's own packs (loaded from
    // config's extraPackDirs) are eligible in every profile — profiles only pick
    // among the bundled packs, they shouldn't hide packs the user explicitly added.
    this._alwaysEligiblePackIds = new Set();
  }

  // Normalize a key for storage/lookup per the caseSensitive setting.
  _normalizeKey(key) {
    return this.caseSensitive ? key : key.toLowerCase();
  }

  loadPacks(packDir, options = {}) {
    this._ingestPacks(packDir);
    for (const dir of options.extraDirs || []) {
      this._ingestPacks(dir, { alwaysEligible: true });
    }
    // Profiles live next to the primary pack dir (<packDir>/../profiles.yml).
    // Load them once, after every dir is ingested, so profile pack-id validation
    // sees triggers contributed by extra dirs too.
    this._loadProfiles(packDir);
    return this.parser.packs;
  }

  _ingestPacks(packDir, { alwaysEligible = false } = {}) {
    const packs = this.parser.loadPackDirectory(packDir);

    for (const pack of packs.values()) {
      // loadPackDirectory returns the parser's cumulative map; only ingest packs
      // we haven't seen so extra-dir loads don't re-add an earlier dir's triggers.
      // First dir wins for a duplicate pack id (bundled packs take precedence).
      if (this._ingestedPackIds.has(pack.id)) continue;
      this._ingestedPackIds.add(pack.id);
      if (alwaysEligible) this._alwaysEligiblePackIds.add(pack.id);

      const seenInPack = new Set();
      for (const trigger of pack.triggers) {
        const key = this._normalizeKey(trigger.key);
        if (seenInPack.has(key)) {
          // Intra-pack duplicate: a real authoring mistake. Cross-pack duplicates
          // are now legitimate (resolved by profiles) and intentionally not warned.
          console.warn(`⚠ duplicate trigger ${trigger.key} within pack ${pack.id} (last wins)`);
        }
        seenInPack.add(key);

        const entry = { ...trigger, packId: pack.id, packVars: pack.vars || {} };
        const existing = this.triggers.get(key);
        if (existing) {
          existing.push(entry);
        } else {
          this.triggers.set(key, [entry]);
        }
      }
    }
  }

  _loadProfiles(packDir) {
    const knownPackIds = new Set();
    for (const entries of this.triggers.values()) {
      for (const entry of entries) knownPackIds.add(entry.packId);
    }
    this.profileManager = loadProfiles(packDir, knownPackIds);
    // Note: loading profiles does NOT activate one. The active profile stays
    // null (no filtering, fully back-compatible) until a caller opts in via
    // setActiveProfile() or passes a per-call profile to expand().
  }

  // --- profile state ------------------------------------------------------

  setActiveProfile(name) {
    if (name && this.profileManager && !this.profileManager.getProfile(name)) {
      console.warn(`⚠ unknown profile "${name}"; falling back to no profile`);
      this.activeProfileName = null;
      return;
    }
    this.activeProfileName = name || null;
  }

  getActiveProfileName() {
    return this.activeProfileName;
  }

  getActiveProfile() {
    if (!this.activeProfileName || !this.profileManager) return null;
    return this.profileManager.getProfile(this.activeProfileName);
  }

  /**
   * Resolve the profile to activate on boot, in priority order:
   * PROFILE env -> profiles.yml `default` -> none. Callers (CLI/server) pass
   * the result to setActiveProfile(); the engine never auto-activates.
   */
  resolveBootProfile() {
    if (!this.profileManager) return null;
    const env = process.env.PROFILE;
    if (env) {
      if (this.profileManager.getProfile(env)) return env;
      console.warn(`⚠ PROFILE="${env}" is not a defined profile; using default`);
    }
    const def = this.profileManager.default;
    if (def && this.profileManager.getProfile(def)) return def;
    return null;
  }

  listProfiles() {
    if (!this.profileManager) return [];
    return this.profileManager.listProfiles().map((p) => ({
      ...p,
      active: p.name === this.activeProfileName,
    }));
  }

  // --- resolution ---------------------------------------------------------

  // null name (or undefined manager) => no filtering. Unknown name => warn + no filtering.
  _profilePackSet(name) {
    if (!name) return null;
    if (!this.profileManager) return null;
    const profile = this.profileManager.getProfile(name);
    if (!profile) {
      console.warn(`⚠ unknown profile "${name}"; ignoring filter`);
      return null;
    }
    return new Set(profile.packs || []);
  }

  // Pick the winning candidate for a key under a given profile name.
  // Mirrors the historic last-wins rule, scoped to the profile's packs.
  _pickCandidate(key, profileName) {
    const candidates = this.triggers.get(key);
    if (!candidates || candidates.length === 0) return null;

    const packSet = this._profilePackSet(profileName);
    const pool = packSet
      ? candidates.filter((c) => packSet.has(c.packId) || this._alwaysEligiblePackIds.has(c.packId))
      : candidates;
    if (pool.length === 0) return null;

    return pool[pool.length - 1];
  }

  // Effective profile: an explicitly-passed `profile` (including null to force
  // all-packs) overrides the active profile.
  _effectiveProfile(context) {
    return context && Object.prototype.hasOwnProperty.call(context, 'profile')
      ? context.profile
      : this.activeProfileName;
  }

  expand(triggerKey, context = {}) {
    const profileName = this._effectiveProfile(context);
    const trigger = this._pickCandidate(this._normalizeKey(triggerKey), profileName);
    if (!trigger) return null;

    switch (trigger.action.type || 'text') {
      case 'text':
        return this._expandText(trigger, context);
      case 'script':
        return this._expandScript(trigger, context);
      default:
        throw new Error(`Unknown action type: ${trigger.action.type}`);
    }
  }

  _expandText(trigger, context) {
    const template = trigger.action.template;

    // raw triggers (e.g. docker --format '{{.Names}}') bypass Mustache entirely
    if (trigger.action.raw) {
      return template;
    }

    return this.renderer.render(template, {
      vars: trigger.packVars,
      inputs: context.inputs || {},
    });
  }

  // Script actions run a shell command and expand to its stdout. The command is
  // a Mustache template, so packs can interpolate vars/inputs into it. Packs are
  // user-authored local config (like shell aliases), so the command is trusted.
  _expandScript(trigger, context) {
    const command = this.renderer.render(trigger.action.command || '', {
      vars: trigger.packVars,
      inputs: context.inputs || {},
    });

    const output = execSync(command, {
      encoding: 'utf8',
      timeout: trigger.action.timeout || 5000,
    });

    // Trim the trailing newline shells add, unless the pack opts out.
    return trigger.action.trim === false ? output : output.trim();
  }

  // Resolve a single trigger to the entry that the active (or passed) profile
  // would expand — same selection logic as expand(). Callers use this to read a
  // trigger's declared `inputs` before expanding. Returns null if unresolved.
  getTrigger(triggerKey, context = {}) {
    const profileName = this._effectiveProfile(context);
    return this._pickCandidate(this._normalizeKey(triggerKey), profileName);
  }

  getAllTriggers(context = {}) {
    const profileName = this._effectiveProfile(context);
    const result = [];
    for (const key of this.triggers.keys()) {
      const winner = this._pickCandidate(key, profileName);
      if (winner) result.push(winner);
    }
    return result;
  }

  findTriggers(query, context = {}) {
    const profileName = this._effectiveProfile(context);
    // Search stays case-insensitive regardless of caseSensitive — it's a fuzzy
    // lookup, not the exact-match path that expand() uses.
    const q = query.toLowerCase();
    const results = [];
    for (const key of this.triggers.keys()) {
      if (!key.toLowerCase().includes(q)) continue;
      const winner = this._pickCandidate(key, profileName);
      if (winner) results.push({ key, ...winner });
    }
    return results;
  }
}

module.exports = ExpansionEngine;
