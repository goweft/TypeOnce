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
      console.log(`Loaded pack: ${pack.name} (${pack.id})`);
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
