const Mustache = require('mustache');

class Renderer {
  constructor() {
    this.globalVars = {
      date: () => new Date().toLocaleDateString(),
      time: () => new Date().toLocaleTimeString(),
      datetime: () => new Date().toLocaleString(),
      timestamp: () => new Date().toISOString(),
      year: () => new Date().getFullYear(),
      month: () => (new Date().getMonth() + 1).toString().padStart(2, '0'),
      day: () => new Date().getDate().toString().padStart(2, '0'),
      user: () => process.env.USER || 'User',
      uuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      }),
      random: () => Math.random().toString(36).substring(7),
    };
  }

  render(template, context = {}) {
    const resolved = {
      ...this.resolveGlobalVars(),
      ...context.vars,           // keep flat spread for back-compat
      vars: context.vars || {},  // namespace so {{vars.x}} resolves
      ...context.inputs,
    };

    // Do not HTML-escape expansion output (was turning / ' < into entities).
    const escapeBackup = Mustache.escape;
    Mustache.escape = (text) => text;
    try {
      return Mustache.render(template, resolved);
    } catch (error) {
      throw new Error(`Template rendering failed: ${error.message}`);
    } finally {
      Mustache.escape = escapeBackup;
    }
  }

  resolveGlobalVars() {
    const resolved = {};
    for (const [key, value] of Object.entries(this.globalVars)) {
      resolved[key] = typeof value === 'function' ? value() : value;
    }
    return resolved;
  }
}

module.exports = Renderer;
