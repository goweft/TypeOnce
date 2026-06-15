const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

class PackParser {
  constructor() {
    this.packs = new Map();
    this.errors = [];
  }

  loadPack(packPath) {
    try {
      const content = fs.readFileSync(packPath, 'utf8');
      const pack = yaml.load(content);

      const validation = this.validatePack(pack);
      if (!validation.valid) {
        throw new Error(`Invalid pack: ${validation.errors.join(', ')}`);
      }

      this.packs.set(pack.id, pack);
      // Diagnostic chatter on stderr so command stdout (e.g. `expand`) stays clean
      // for piping/clipboard.
      console.error(`Loaded pack: ${pack.name} (${pack.id})`);
      return pack;
    } catch (error) {
      console.error(`Failed to load ${packPath}: ${error.message}`);
      throw error;
    }
  }

  validatePack(pack) {
    const errors = [];
    const required = ['id', 'name', 'version', 'triggers'];

    for (const field of required) {
      if (!pack[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    if (pack.triggers && !Array.isArray(pack.triggers)) {
      errors.push('Triggers must be an array');
    }

    // Validate any declared trigger inputs. This is opt-in: existing triggers
    // have no `inputs` key and are skipped entirely, so this can't break them.
    if (Array.isArray(pack.triggers)) {
      const allowedTypes = ['text', 'multiline', 'number', 'select'];
      pack.triggers.forEach((trigger, i) => {
        if (!trigger || trigger.inputs === undefined) return;
        const where = `trigger ${i} (${trigger.key || 'no key'})`;

        if (!Array.isArray(trigger.inputs)) {
          errors.push(`${where}: inputs must be an array`);
          return;
        }
        // Inputs require Mustache rendering; raw bypasses it, so the two conflict.
        if (trigger.action && trigger.action.raw) {
          errors.push(`${where}: inputs cannot be combined with action.raw (raw bypasses rendering)`);
        }

        const names = new Set();
        trigger.inputs.forEach((inp, j) => {
          if (!inp || typeof inp !== 'object') {
            errors.push(`${where}: input ${j} must be a mapping`);
            return;
          }
          const id = inp.name || `#${j}`;
          if (!inp.name) {
            errors.push(`${where}: input ${j} missing 'name'`);
          } else if (names.has(inp.name)) {
            errors.push(`${where}: duplicate input name '${inp.name}'`);
          } else {
            names.add(inp.name);
          }
          if (!inp.prompt) {
            errors.push(`${where}: input '${id}' missing 'prompt'`);
          }
          const type = inp.type || 'text';
          if (!allowedTypes.includes(type)) {
            errors.push(`${where}: input '${id}' has invalid type '${type}' (use ${allowedTypes.join('/')})`);
          }
          if (type === 'select' && (!Array.isArray(inp.options) || inp.options.length === 0)) {
            errors.push(`${where}: select input '${id}' needs a non-empty 'options' list`);
          }
        });
      });
    }

    return { valid: errors.length === 0, errors };
  }

  loadPackDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      console.warn(`Pack directory does not exist: ${dirPath}`);
      return this.packs;
    }

    const files = fs.readdirSync(dirPath);
    const packFiles = files.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

    for (const file of packFiles) {
      try {
        this.loadPack(path.join(dirPath, file));
      } catch (error) {
        console.error(`Skipping ${file}: ${error.message}`);
      }
    }

    return this.packs;
  }

  getAllTriggers() {
    const triggers = [];
    for (const pack of this.packs.values()) {
      for (const trigger of pack.triggers) {
        triggers.push({
          ...trigger,
          packId: pack.id,
          packName: pack.name
        });
      }
    }
    return triggers;
  }
}

module.exports = PackParser;
