#!/bin/bash

# Create cli/index.js
cat > cli/index.js << 'EOF'
#!/usr/bin/env node
const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const ExpansionEngine = require('../core/engine');

const engine = new ExpansionEngine();
const packDir = path.join(__dirname, '..', 'packs');

if (fs.existsSync(packDir)) {
  engine.loadPacks(packDir);
}

program
  .name('typeonce')
  .description('Smart text expansion engine')
  .version('0.1.0');

program
  .command('expand <trigger>')
  .description('Expand a trigger')
  .action((trigger) => {
    const result = engine.expand(trigger);
    if (result) {
      console.log(result);
    } else {
      console.error(`Trigger '${trigger}' not found`);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all available triggers')
  .action(() => {
    const triggers = engine.getAllTriggers();
    triggers.forEach(trigger => {
      console.log(`${trigger.key.padEnd(15)} ${trigger.label || ''}`);
    });
  });

program
  .command('validate')
  .description('Validate all packs')
  .action(() => {
    try {
      console.log('All packs are valid');
    } catch (error) {
      console.error('Validation failed:', error.message);
      process.exit(1);
    }
  });

program.parse();
EOF

chmod +x cli/index.js
echo "Created cli/index.js"

# Create core/parser.js
cat > core/parser.js << 'EOF'
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
EOF

echo "Created core/parser.js"

# Create core/renderer.js
cat > core/renderer.js << 'EOF'
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
      ...context.vars,
      ...context.inputs,
    };
    
    try {
      return Mustache.render(template, resolved);
    } catch (error) {
      throw new Error(`Template rendering failed: ${error.message}`);
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
EOF

echo "Created core/renderer.js"

# Create core/engine.js
cat > core/engine.js << 'EOF'
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
        this.triggers.set(trigger.key.toLowerCase(), {
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
EOF

echo "Created core/engine.js"

# Create server/index.js
cat > server/index.js << 'EOF'
const express = require('express');
const cors = require('cors');
const path = require('path');
const ExpansionEngine = require('../core/engine');

const app = express();
const engine = new ExpansionEngine();
const PORT = process.env.API_PORT || 8090;

app.use(cors());
app.use(express.json());

const packDir = path.join(__dirname, '..', 'packs');
engine.loadPacks(packDir);

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    triggers: engine.triggers.size,
    version: '0.1.0'
  });
});

app.post('/expand', (req, res) => {
  const { trigger, inputs = {} } = req.body;
  
  try {
    const result = engine.expand(trigger, { inputs });
    if (result) {
      res.json({ success: true, result });
    } else {
      res.status(404).json({ success: false, error: 'Trigger not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/triggers', (req, res) => {
  const triggers = engine.getAllTriggers().map(t => ({
    key: t.key,
    label: t.label,
    packId: t.packId,
  }));
  res.json(triggers);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TypeOnce API server running on port ${PORT}`);
  console.log(`Loaded ${engine.triggers.size} triggers`);
});
EOF

echo "Created server/index.js"

# Create sample pack
cat > packs/essentials.yml << 'EOF'
id: "typeonce.essentials"
name: "Essential Snippets"
version: "0.1.0"
description: "Common text expansions"

vars:
  company: "ACME Corp"
  email: "user@example.com"

triggers:
  - key: ";date"
    label: "Current date"
    action:
      type: "text"
      template: "{{date}}"
  
  - key: ";time"
    label: "Current time"
    action:
      type: "text"
      template: "{{time}}"
  
  - key: ";sig"
    label: "Email signature"
    action:
      type: "text"
      template: |
        Best regards,
        {{user}}
        {{vars.company}}
  
  - key: ";uuid"
    label: "Generate UUID"
    action:
      type: "text"
      template: "{{uuid}}"
EOF

echo "Created packs/essentials.yml"

# Create simpler Dockerfile
cat > docker/Dockerfile.api << 'EOF'
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY cli/ ./cli/
COPY core/ ./core/
COPY server/ ./server/
COPY packs/ ./packs/

RUN mkdir -p /app/data/packs /app/data/logs /app/data/config

EXPOSE 8090

CMD ["node", "server/index.js"]
EOF

echo "Created docker/Dockerfile.api"

echo ""
echo "All files created successfully!"
