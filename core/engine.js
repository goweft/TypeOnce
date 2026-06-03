const PackParser = require('./parser');
const Renderer = require('./renderer');
const EventEmitter = require('events');

class ExpansionEngine extends EventEmitter {
  constructor() {
    super();
    this.parser = new PackParser();
    this.renderer = new Renderer();
    this.triggers = new Map();
  }

  loadPacks(packDir) {
    const packs = this.parser.loadPackDirectory(packDir);

    for (const pack of packs.values()) {
      for (const trigger of pack.triggers) {
        const key = trigger.key.toLowerCase();
        if (this.triggers.has(key)) {
          const prev = this.triggers.get(key);
          // Same key in two packs: last loaded wins. Surface it instead of failing silently.
          console.warn(`\u26a0 duplicate trigger ${trigger.key}: ${prev.packId} overwritten by ${pack.id}`);
        }
        this.triggers.set(key, {
          ...trigger,
          packId: pack.id,
          packVars: pack.vars || {},
        });
      }
    }

    return packs;
  }

  expand(triggerKey, context = {}) {
    const trigger = this.triggers.get(triggerKey.toLowerCase());
    if (!trigger) return null;

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

  getAllTriggers() {
    return Array.from(this.triggers.values());
  }

  findTriggers(query) {
    const results = [];
    for (const [key, trigger] of this.triggers) {
      if (key.includes(query.toLowerCase())) {
        results.push({ key, ...trigger });
      }
    }
    return results;
  }
}

module.exports = ExpansionEngine;
