# TypeOnce: 14-Day Implementation Plan
## Building a Deployable MVP from Scratch

---

## Day 1-2: Core Foundation

### Day 1: Project Setup & Pack Parser
**Goal**: Parse YAML packs and load them into memory

```bash
# Initialize project
mkdir typeonce && cd typeonce
npm init -y
npm install js-yaml commander mustache dotenv
npm install -D jest eslint prettier nodemon
```

**Create core/parser.js**:
```javascript
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

class PackParser {
  constructor() {
    this.packs = new Map();
  }

  loadPack(packPath) {
    try {
      const content = fs.readFileSync(packPath, 'utf8');
      const pack = yaml.load(content);
      this.validatePack(pack);
      this.packs.set(pack.id, pack);
      return pack;
    } catch (error) {
      throw new Error(`Failed to load pack ${packPath}: ${error.message}`);
    }
  }

  validatePack(pack) {
    const required = ['id', 'name', 'version', 'triggers'];
    for (const field of required) {
      if (!pack[field]) {
        throw new Error(`Pack missing required field: ${field}`);
      }
    }
    
    if (!Array.isArray(pack.triggers)) {
      throw new Error('Triggers must be an array');
    }
    
    pack.triggers.forEach((trigger, index) => {
      if (!trigger.key) {
        throw new Error(`Trigger ${index} missing 'key'`);
      }
      if (!trigger.action) {
        throw new Error(`Trigger ${index} missing 'action'`);
      }
    });
  }

  loadPackDirectory(dirPath) {
    const files = fs.readdirSync(dirPath);
    const packFiles = files.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    
    for (const file of packFiles) {
      this.loadPack(path.join(dirPath, file));
    }
    
    return this.packs;
  }
}

module.exports = PackParser;
```

**Create first pack (packs/essentials.yml)**:
```yaml
id: "typeonce.essentials"
name: "Essential Snippets"
version: "0.1.0"
description: "Common text expansions for everyday use"

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
  
  - key: ";datetime"
    label: "Current date and time"
    action:
      type: "text"
      template: "{{date}} {{time}}"
  
  - key: ";sig"
    label: "Email signature"
    action:
      type: "text"
      template: |
        Best regards,
        {{vars.email}}
        {{vars.company}}
```

**Test it**:
```javascript
// test-parser.js
const PackParser = require('./core/parser');
const parser = new PackParser();
parser.loadPack('./packs/essentials.yml');
console.log('Pack loaded:', parser.packs.get('typeonce.essentials'));
```

### Day 2: Template Renderer & Variable Resolution
**Goal**: Render templates with variables

**Create core/renderer.js**:
```javascript
const Mustache = require('mustache');

class Renderer {
  constructor() {
    this.globalVars = {
      date: () => new Date().toLocaleDateString(),
      time: () => new Date().toLocaleTimeString(),
      timestamp: () => new Date().toISOString(),
      year: () => new Date().getFullYear(),
      month: () => (new Date().getMonth() + 1).toString().padStart(2, '0'),
      day: () => new Date().getDate().toString().padStart(2, '0'),
    };
  }

  render(template, context = {}) {
    // Merge contexts: global < pack vars < trigger inputs < runtime context
    const fullContext = {
      ...this.resolveGlobalVars(),
      ...context.vars,
      ...context.inputs,
      ...context.runtime,
    };
    
    return Mustache.render(template, fullContext);
  }

  resolveGlobalVars() {
    const resolved = {};
    for (const [key, value] of Object.entries(this.globalVars)) {
      resolved[key] = typeof value === 'function' ? value() : value;
    }
    return resolved;
  }

  addGlobalVar(name, value) {
    this.globalVars[name] = value;
  }
}

module.exports = Renderer;
```

---

## Day 3-4: Expansion Engine

### Day 3: Core Engine Implementation
**Goal**: Build the main expansion engine

**Create core/engine.js**:
```javascript
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
    
    // Build trigger index
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
    
    // Handle different action types
    switch (trigger.action.type) {
      case 'text':
        return this.expandText(trigger, context);
      case 'script':
        return this.expandScript(trigger, context);
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

  expandScript(trigger, context) {
    // TODO: Implement script execution
    throw new Error('Script actions not yet implemented');
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
}

module.exports = ExpansionEngine;
```

### Day 4: CLI Interface
**Goal**: Create the command-line interface

**Create cli/index.js**:
```javascript
#!/usr/bin/env node
const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const ExpansionEngine = require('../core/engine');
const package = require('../package.json');

const engine = new ExpansionEngine();
const packDir = path.join(__dirname, '..', 'packs');

// Load packs on startup
if (fs.existsSync(packDir)) {
  engine.loadPacks(packDir);
}

program
  .name('typeonce')
  .description('Smart text expansion engine')
  .version(package.version);

program
  .command('expand <trigger>')
  .description('Expand a trigger')
  .option('-i, --input <key=value...>', 'Input variables')
  .action((trigger, options) => {
    const inputs = {};
    if (options.input) {
      options.input.forEach(pair => {
        const [key, value] = pair.split('=');
        inputs[key] = value;
      });
    }
    
    const result = engine.expand(trigger, { inputs });
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
  .option('-p, --pack <id>', 'Filter by pack')
  .action((options) => {
    const triggers = Array.from(engine.triggers.values());
    const filtered = options.pack 
      ? triggers.filter(t => t.packId === options.pack)
      : triggers;
    
    filtered.forEach(trigger => {
      console.log(`${trigger.key.padEnd(15)} ${trigger.label || ''}`);
    });
  });

program
  .command('search <query>')
  .description('Search for triggers')
  .action((query) => {
    const results = engine.findTriggers(query);
    if (results.length === 0) {
      console.log('No triggers found');
    } else {
      results.forEach(trigger => {
        console.log(`${trigger.key.padEnd(15)} ${trigger.label || ''}`);
      });
    }
  });

program
  .command('validate [packFile]')
  .description('Validate a pack file')
  .action((packFile) => {
    try {
      const parser = new PackParser();
      if (packFile) {
        parser.loadPack(packFile);
        console.log('✅ Pack is valid');
      } else {
        parser.loadPackDirectory(packDir);
        console.log(`✅ All packs in ${packDir} are valid`);
      }
    } catch (error) {
      console.error('❌ Validation failed:', error.message);
      process.exit(1);
    }
  });

program.parse();
```

**Update package.json**:
```json
{
  "bin": {
    "typeonce": "./cli/index.js"
  }
}
```

---

## Day 5-6: Input Handling & Forms

### Day 5: Interactive Input System
**Goal**: Handle triggers that require user input

**Create core/input.js**:
```javascript
const readline = require('readline');

class InputHandler {
  async collectInputs(trigger) {
    if (!trigger.inputs || trigger.inputs.length === 0) {
      return {};
    }
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    const inputs = {};
    
    for (const input of trigger.inputs) {
      const answer = await this.askQuestion(rl, input);
      inputs[input.name] = answer;
    }
    
    rl.close();
    return inputs;
  }
  
  askQuestion(rl, input) {
    return new Promise((resolve) => {
      const prompt = input.prompt || `Enter ${input.name}`;
      const defaultVal = input.default ? ` (${input.default})` : '';
      
      rl.question(`${prompt}${defaultVal}: `, (answer) => {
        resolve(answer || input.default || '');
      });
    });
  }
}

module.exports = InputHandler;
```

### Day 6: Advanced Packs
**Goal**: Create more sophisticated packs

**Create packs/developer.yml**:
```yaml
id: "typeonce.developer"
name: "Developer Snippets"
version: "0.1.0"

triggers:
  - key: ";commit"
    label: "Git commit message"
    inputs:
      - name: type
        prompt: "Type (feat/fix/docs/refactor)"
        default: "feat"
      - name: scope
        prompt: "Scope (optional)"
      - name: message
        prompt: "Message"
    action:
      type: "text"
      template: "{{type}}{{#scope}}({{scope}}){{/scope}}: {{message}}"
  
  - key: ";pr"
    label: "Pull request template"
    inputs:
      - name: title
        prompt: "PR Title"
      - name: description
        prompt: "Description"
      - name: issue
        prompt: "Issue number"
    action:
      type: "text"
      template: |
        ## Description
        {{description}}
        
        ## Related Issues
        Closes #{{issue}}
        
        ## Checklist
        - [ ] Tests pass
        - [ ] Documentation updated
        - [ ] Code reviewed
```

---

## Day 7-8: Testing Suite

### Day 7: Unit Tests
**Goal**: Comprehensive test coverage

**Create tests/engine.test.js**:
```javascript
const ExpansionEngine = require('../core/engine');
const path = require('path');

describe('ExpansionEngine', () => {
  let engine;
  
  beforeEach(() => {
    engine = new ExpansionEngine();
    engine.loadPacks(path.join(__dirname, '..', 'packs'));
  });
  
  test('loads packs from directory', () => {
    expect(engine.triggers.size).toBeGreaterThan(0);
  });
  
  test('expands simple text trigger', () => {
    const result = engine.expand(';sig');
    expect(result).toContain('Best regards');
  });
  
  test('expands with variables', () => {
    const result = engine.expand(';date');
    const today = new Date().toLocaleDateString();
    expect(result).toBe(today);
  });
  
  test('returns null for unknown trigger', () => {
    const result = engine.expand(';unknown');
    expect(result).toBeNull();
  });
  
  test('searches triggers', () => {
    const results = engine.findTriggers('date');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].key).toContain('date');
  });
});
```

### Day 8: Integration Tests
**Goal**: Test the complete workflow

**Create tests/integration.test.js**:
```javascript
const { execSync } = require('child_process');
const path = require('path');

describe('CLI Integration', () => {
  const cli = path.join(__dirname, '..', 'cli', 'index.js');
  
  test('expands trigger via CLI', () => {
    const output = execSync(`node ${cli} expand ';date'`).toString();
    const today = new Date().toLocaleDateString();
    expect(output.trim()).toBe(today);
  });
  
  test('lists triggers', () => {
    const output = execSync(`node ${cli} list`).toString();
    expect(output).toContain(';date');
    expect(output).toContain(';sig');
  });
  
  test('validates packs', () => {
    const output = execSync(`node ${cli} validate`).toString();
    expect(output).toContain('valid');
  });
});
```

---

## Day 9-10: Advanced Features

### Day 9: Configuration System
**Goal**: User configuration and profiles

**Create core/config.js**:
```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');

class Config {
  constructor() {
    this.configDir = path.join(os.homedir(), '.typeonce');
    this.configFile = path.join(this.configDir, 'config.json');
    this.defaultConfig = {
      packDirs: [
        path.join(__dirname, '..', 'packs'),
        path.join(this.configDir, 'packs'),
      ],
      caseSensitive: false,
      prefix: ';',
      profiles: {
        default: {
          enabledPacks: ['all'],
        },
      },
      activeProfile: 'default',
    };
    this.config = this.load();
  }
  
  load() {
    if (fs.existsSync(this.configFile)) {
      const content = fs.readFileSync(this.configFile, 'utf8');
      return { ...this.defaultConfig, ...JSON.parse(content) };
    }
    return this.defaultConfig;
  }
  
  save() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2));
  }
  
  get(key) {
    return this.config[key];
  }
  
  set(key, value) {
    this.config[key] = value;
    this.save();
  }
}

module.exports = Config;
```

### Day 10: HTTP Actions & API Server
**Goal**: Support HTTP actions and create REST API

**Create server/index.js**:
```javascript
const express = require('express');
const cors = require('cors');
const ExpansionEngine = require('../core/engine');

const app = express();
const engine = new ExpansionEngine();
const PORT = process.env.PORT || 8090;

app.use(cors());
app.use(express.json());

// Load packs on startup
engine.loadPacks('./packs');

// API Routes
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', triggers: engine.triggers.size });
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
  const triggers = Array.from(engine.triggers.values()).map(t => ({
    key: t.key,
    label: t.label,
    packId: t.packId,
  }));
  res.json(triggers);
});

app.get('/triggers/search', (req, res) => {
  const { q } = req.query;
  const results = engine.findTriggers(q || '');
  res.json(results);
});

app.listen(PORT, () => {
  console.log(`TypeOnce server running on port ${PORT}`);
});
```

---

## Day 11-12: Polish & Documentation

### Day 11: Error Handling & Logging
**Goal**: Robust error handling and logging

**Create core/logger.js**:
```javascript
const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: 'error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'combined.log' 
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }));
}

module.exports = logger;
```

### Day 12: Documentation
**Goal**: Complete documentation

**Create README.md**:
```markdown
# TypeOnce

Smart text expansion engine with composable packs.

## Installation

```bash
npm install -g typeonce
```

## Quick Start

```bash
# List all triggers
typeonce list

# Expand a trigger
typeonce expand ';date'

# Search triggers
typeonce search date

# Validate packs
typeonce validate
```

## Creating Packs

Create a YAML file in `~/.typeonce/packs/`:

```yaml
id: "my.pack"
name: "My Custom Pack"
version: "1.0.0"

triggers:
  - key: ";hello"
    label: "Greeting"
    action:
      type: "text"
      template: "Hello, {{name}}!"
```

## API Server

```bash
# Start the API server
typeonce server

# Use the API
curl -X POST http://localhost:8090/expand \
  -H "Content-Type: application/json" \
  -d '{"trigger": ";date"}'
```

## License

MIT
```

---

## Day 13-14: Deployment & Release

### Day 13: Build & Package
**Goal**: Create distributable packages

**Create scripts/build.js**:
```javascript
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Build for different platforms
const platforms = [
  { platform: 'linux', arch: 'x64', ext: '' },
  { platform: 'darwin', arch: 'x64', ext: '' },
  { platform: 'win32', arch: 'x64', ext: '.exe' },
];

for (const { platform, arch, ext } of platforms) {
  console.log(`Building for ${platform}-${arch}...`);
  
  // Use pkg or nexe to create binaries
  execSync(`pkg . --target node20-${platform}-${arch} --output dist/typeonce-${platform}-${arch}${ext}`);
}

console.log('Build complete!');
```

### Day 14: GitHub Release
**Goal**: Push to GitHub with CI/CD

**Create .github/workflows/release.yml**:
```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - run: npm ci
      - run: npm test
      - run: npm run build
      
      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: dist/*
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Final Checklist Before GitHub

### Code Quality
- [ ] All tests passing (>80% coverage)
- [ ] ESLint configured and passing
- [ ] No console.logs in production code
- [ ] Error handling in all functions

### Documentation
- [ ] README with clear instructions
- [ ] API documentation
- [ ] Pack creation guide
- [ ] Installation instructions for all platforms

### Project Files
- [ ] LICENSE file (MIT)
- [ ] .gitignore configured
- [ ] package.json with all scripts
- [ ] CHANGELOG.md started

### Testing
- [ ] Unit tests for all modules
- [ ] Integration tests for CLI
- [ ] Manual testing on all platforms
- [ ] Example packs working

### Release Preparation
- [ ] Version tagged (v0.1.0)
- [ ] GitHub Actions configured
- [ ] Binary builds working
- [ ] npm package ready (optional)

## Commands Summary

```bash
# Development
npm run dev        # Start with nodemon
npm test          # Run all tests
npm run lint      # Check code style
npm run build     # Build binaries

# Usage
typeonce expand ';date'
typeonce list
typeonce validate
typeonce server

# Deployment
npm version patch  # Bump version
git push --tags   # Trigger release
```

## Success Metrics

After 14 days, you should have:
- ✅ Working text expansion engine
- ✅ 10+ built-in triggers
- ✅ CLI with 5+ commands
- ✅ REST API server
- ✅ 90%+ test coverage
- ✅ Documentation complete
- ✅ GitHub repo with CI/CD
- ✅ Binary releases for 3 platforms

## Next Steps After MVP

1. **Community Building**
   - Create Discord/Slack
   - Write blog post announcement
   - Submit to Product Hunt

2. **Feature Expansion**
   - GUI system tray app
   - Browser extension
   - VS Code extension
   - Mobile companion app

3. **Pack Ecosystem**
   - Pack registry website
   - Pack sharing platform
   - Enterprise pack management

This plan gives you a working, deployable TypeOnce in 14 days!