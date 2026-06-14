const fs = require('fs');
const path = require('path');

// App-level settings that the profiles system does NOT own. Stored in the same
// data/config dir as the active-profile marker — deliberately not a rival
// ~/.typeonce store. Profiles stay the source of truth for which packs are
// active per context; config only adds orthogonal knobs:
//   - caseSensitive : whether trigger keys match case-sensitively
//   - extraPackDirs : additional directories to load user packs from
const DEFAULTS = {
  caseSensitive: false,
  extraPackDirs: [],
};

class Config {
  constructor({ configDir, file } = {}) {
    this.configDir = configDir || path.join(__dirname, '..', 'data', 'config');
    this.file = file || path.join(this.configDir, 'config.json');
    this.config = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        // Unknown keys are kept (forward-compat); missing keys fall to defaults.
        return { ...DEFAULTS, ...parsed };
      }
    } catch (err) {
      console.warn(`⚠ could not read config (${this.file}): ${err.message}; using defaults`);
    }
    return { ...DEFAULTS };
  }

  save() {
    if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(this.config, null, 2)}\n`);
  }

  get(key) {
    return this.config[key];
  }

  set(key, value) {
    this.config[key] = value;
    this.save();
    return value;
  }

  all() {
    return { ...this.config };
  }
}

module.exports = { Config, DEFAULTS };
