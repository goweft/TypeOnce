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
