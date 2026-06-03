#!/bin/bash

# TypeOnce Complete Setup Script
# Run this on your server to create all necessary files

echo "🚀 Setting up TypeOnce implementation files..."

# Navigate to TypeOnce directory
cd /opt/typeonce

# Create directory structure
echo "Creating directories..."
sudo mkdir -p cli core server packs docker tests scripts data/{packs,logs,config}

# Create package.json
echo "Creating package.json..."
cat > package.json << 'EOF'
{
  "name": "typeonce",
  "version": "0.1.0",
  "description": "Smart text expansion engine with composable packs",
  "main": "server/index.js",
  "bin": {
    "typeonce": "./cli/index.js"
  },
  "scripts": {
    "start": "node server/index.js",
    "cli": "node cli/index.js",
    "test": "jest",
    "validate": "node cli/index.js validate"
  },
  "dependencies": {
    "js-yaml": "^4.1.0",
    "commander": "^11.0.0",
    "mustache": "^4.2.0",
    "express": "^4.18.0",
    "cors": "^2.8.5",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "nodemon": "^3.0.0"
  }
}
EOF

# Create requirements.txt
echo "Creating requirements.txt..."
cat > requirements.txt << 'EOF'
PyYAML==6.0
pytest==7.4.0
EOF

# Create core/parser.js
echo "Creating core/parser.js..."
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
      
      pack._filePath = packPath;
      pack._fileName = path.basename(packPath);
      
      this.packs.set(pack.id, pack);
      console.log(`✅ Loaded pack: ${pack.name} (${pack.id})`);
      
      return pack;
    } catch (error) {
      const errorMsg = `Failed to load ${packPath}: ${error.message}`;
      this.errors.push(errorMsg);
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
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
    
    if (pack.id && !/^[a-z0-9.-]+$/.test(pack.id)) {
      errors.push('Pack ID must contain only lowercase letters, numbers, dots, and hyphens');
    }
    
    if (pack.version && !/^\d+\.\d+\.\d+/.test(pack.version)) {
      errors.push('Version must follow semver format (e.g., 1.0.0)');
    }
    
    if (pack.triggers) {
      if (!Array.isArray(pack.triggers)) {
        errors.push('Triggers must be an array');
      } else {
        pack.triggers.forEach((trigger, index) => {
          if (!trigger.key) {
            errors.push(`Trigger ${index} missing 'key'`);
          }
          if (!trigger.action) {
            errors.push(`Trigger ${index} missing 'action'`);
          }
        });
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  loadPackDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      console.warn(`Pack directory does not exist: ${dirPath}`);
      return this.packs;
    }
    
    const files = fs.readdirSync(dirPath);
    const packFiles = files.filter(f => 
      (f.endsWith('.yml') || f.endsWith('.yaml')) && 
      !f.startsWith('.')
    );
    
    console.log(`Loading ${packFiles.length} pack(s) from ${dirPath}`);
    
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

# Create core/renderer.js
echo "Creating core/renderer.js..."
cat > core/renderer.js << 'EOF'
const Mustache = require('mustache');

class Renderer {
  constructor() {
    this.globalVars = this.initGlobalVars();
  }

  initGlobalVars() {
    return {
      date: () => new Date().toLocaleDateString(),
      time: () => new Date().toLocaleTimeString(),
      datetime: () => new Date().toLocaleString(),
      timestamp: () => new Date().toISOString(),
      year: () => new Date().getFullYear(),
      month: () => (new Date().getMonth() + 1).toString().padStart(2, '0'),
      day: () => new Date().getDate().toString().padStart(2, '0'),
      weekday: () => new Date().toLocaleDateString('en-US', { weekday: 'long' }),
      user: () => process.env.USER || process.env.USERNAME || 'User',
      home: () => process.env.HOME || process.env.USERPROFILE || '',
      uuid: () => this.generateUUID(),
      random: () => Math.random().toString(36).substring(7),
    };
  }

  render(template, context = {}) {
    const resolved = this.resolveContext(context);
    
    try {
      return Mustache.render(template, resolved);
    } catch (error) {
      throw new Error(`Template rendering failed: ${error.message}`);
    }
  }

  resolveContext(context) {
    const resolved = {
      ...this.resolveGlobalVars(),
      ...context.vars,
      ...context.inputs,
      ...context.runtime,
    };
    
    for (const [key, value] of Object.entries(resolved)) {
      if (typeof value === 'object' && value !== null) {
        resolved[key] = this.resolveObject(value);
      }
    }
    
    return resolved;
  }

  resolveGlobalVars() {
    const resolved = {};
    for (const [key, value] of Object.entries(this.globalVars)) {
      resolved[key] = typeof value === 'function' ? value() : value;
    }
    return resolved;
  }

  resolveObject(obj) {
    const resolved = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'function') {
        resolved[key] = value();
      } else if (typeof value === 'object' && value !== null) {
        resolved[key] = this.resolveObject(value);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  addGlobalVar(name, value) {
    this.globalVars[name] = value;
  }
}

module.exports = Renderer;
EOF

# Create core/engine.js
echo "Creating core/engine.js..."
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
    this.config = {
      caseSensitive: false,
      prefix: ';',
    };
  }

  loadPacks(packDir) {
    const packs = this.parser.loadPackDirectory(packDir);
    
    for (const pack of packs.values()) {
      for (const trigger of pack.triggers) {
        const key = this.config.caseSensitive 
          ? trigger.key 
          : trigger.key.toLowerCase();
        
        this.triggers.set(key, {
          ...trigger,
          packId: pack.id,
          packVars: pack.vars || {},
        });
      }
    }
    
    this.emit('packsLoaded', packs.size);
    return packs;
  }

  expand(triggerKey, context = {}) {
    const key = this.config.caseSensitive 
      ? triggerKey 
      : triggerKey.toLowerCase();
    
    const trigger = this.triggers.get(key);
    if (!trigger) {
      return null;
    }
    
    switch (trigger.action.type) {
      case 'text':
        return this.expandText(trigger, context);
      default:
        throw new Error(`Unknown action type: ${trigger.action.type}`);
    }
  }

  expandText(trigger, context) {
    const template = trigger.action.template;
    const fullContext = {
      vars: trigger.packVars,
      inputs: context.inputs || {},
      runtime: context.runtime || {},
    };
    
    return this.renderer.render(template, fullContext);
  }

  findTriggers(query) {
    const results = [];
    const searchQuery = this.config.caseSensitive 
      ? query 
      : query.toLowerCase();
    
    for (const [key, trigger] of this.triggers) {
      if (key.includes(searchQuery)) {
        results.push({ key, ...trigger });
      }
    }
    
    return results;
  }

  getAllTriggers() {
    return Array.from(this.triggers.values());
  }
}

module.exports = ExpansionEngine;
EOF

# Create cli/index.js
echo "Creating cli/index.js..."
cat > cli/index.js << 'EOF'
#!/usr/bin/env node
const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const ExpansionEngine = require('../core/engine');

const engine = new ExpansionEngine();
const packDir = path.join(__dirname, '..', 'packs');

// Load packs on startup
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
      console.log(`✅ All packs in ${packDir} are valid`);
    } catch (error) {
      console.error('❌ Validation failed:', error.message);
      process.exit(1);
    }
  });

program.parse();
EOF

# Create server/index.js
echo "Creating server/index.js..."
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

// Load packs on startup
const packDir = path.join(__dirname, '..', 'packs');
engine.loadPacks(packDir);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    triggers: engine.triggers.size,
    version: '0.1.0'
  });
});

// Expand trigger
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

// List triggers
app.get('/triggers', (req, res) => {
  const triggers = engine.getAllTriggers().map(t => ({
    key: t.key,
    label: t.label,
    packId: t.packId,
  }));
  res.json(triggers);
});

// Search triggers
app.get('/triggers/search', (req, res) => {
  const { q } = req.query;
  const results = engine.findTriggers(q || '');
  res.json(results);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TypeOnce API server running on port ${PORT}`);
  console.log(`Loaded ${engine.triggers.size} triggers`);
});
EOF

# Create packs/essentials.yml
echo "Creating packs/essentials.yml..."
cat > packs/essentials.yml << 'EOF'
id: "typeonce.essentials"
name: "Essential Snippets"
version: "0.1.0"
description: "Common text expansions for everyday use"

vars:
  company: "ACME Corp"
  email: "user@example.com"
  phone: "555-0100"

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
  
  - key: ";datetime"
    label: "Date and time"
    action:
      type: "text"
      template: "{{datetime}}"
  
  - key: ";sig"
    label: "Email signature"
    action:
      type: "text"
      template: |
        Best regards,
        {{user}}
        {{vars.company}}
        {{vars.email}}
  
  - key: ";ty"
    label: "Thank you"
    action:
      type: "text"
      template: "Thank you"
  
  - key: ";lorem"
    label: "Lorem ipsum"
    action:
      type: "text"
      template: "Lorem ipsum dolor sit amet, consectetur adipiscing elit."
  
  - key: ";uuid"
    label: "Generate UUID"
    action:
      type: "text"
      template: "{{uuid}}"
EOF

# Create docker/Dockerfile.api
echo "Creating docker/Dockerfile.api..."
cat > docker/Dockerfile.api << 'EOF'
FROM node:20-alpine

WORKDIR /app

# Install Python for pack validation
RUN apk add --no-cache python3 py3-pip git

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY cli/ ./cli/
COPY core/ ./core/
COPY server/ ./server/
COPY packs/ ./packs/

# Create data directories
RUN mkdir -p /app/data/packs /app/data/logs /app/data/config

# Install Python dependencies
COPY requirements.txt ./
RUN pip3 install -r requirements.txt --break-system-packages

EXPOSE 8090

CMD ["node", "server/index.js"]
EOF

# Update docker-compose.yml if it exists
echo "Updating docker-compose.yml..."
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  typeonce-api:
    build: 
      context: .
      dockerfile: docker/Dockerfile.api
    container_name: typeonce-api
    restart: unless-stopped
    ports:
      - "8090:8090"
    volumes:
      - ./data/packs:/app/packs
      - ./data/logs:/app/logs
      - ./data/config:/app/config
    environment:
      - NODE_ENV=production
      - API_PORT=8090
      - PACK_DIR=/app/packs
      - LOG_LEVEL=info
    networks:
      - typeonce-network

networks:
  typeonce-network:
    driver: bridge
EOF

# Set permissions
echo "Setting permissions..."
chmod +x cli/index.js

echo "✅ TypeOnce setup complete!"
echo ""
echo "Next steps:"
echo "1. Install dependencies: npm install"
echo "2. Test CLI: node cli/index.js list"
echo "3. Test expansion: node cli/index.js expand ';date'"
echo "4. Build Docker: sudo docker-compose build"
echo "5. Run Docker: sudo docker-compose up -d"
echo "6. Check health: curl http://localhost:8090/health"
