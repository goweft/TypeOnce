#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const clipboardy = require('clipboardy');
const axios = require('axios');

const program = new Command();

// Configuration
const API_BASE = process.env.TYPEONCE_API || 'http://localhost:8091';

// Simple console logger instead of ora
const logger = {
  info: (msg) => console.log(chalk.blue('ℹ'), msg),
  success: (msg) => console.log(chalk.green('✓'), msg),
  error: (msg) => console.log(chalk.red('✗'), msg),
  warn: (msg) => console.log(chalk.yellow('⚠'), msg)
};

// ASCII Art Logo
const logo = `
╔════════════════════════════════════╗
║     TypeOnce CLI v1.0.0            ║
║  Docker API Connected               ║
╚════════════════════════════════════╝
`;

// API Client
class TypeOnceAPI {
  constructor(baseURL = API_BASE) {
    this.client = axios.create({
      baseURL,
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  
  async health() {
    const response = await this.client.get('/health');
    return response.data;
  }
  
  async getTriggers() {
    const response = await this.client.get('/triggers');
    return response.data;
  }
  
  async expand(trigger, inputs = {}) {
    const response = await this.client.post('/expand', {
      trigger,
      inputs
    });
    return response.data;
  }
  
  async search(query) {
    const triggers = await this.getTriggers();
    const searchLower = query.toLowerCase();
    return triggers.filter(t => 
      t.key.toLowerCase().includes(searchLower) ||
      (t.label && t.label.toLowerCase().includes(searchLower))
    );
  }
  
  async getPacks() {
    const triggers = await this.getTriggers();
    const packsMap = new Map();
    
    triggers.forEach(t => {
      if (!packsMap.has(t.packId)) {
        packsMap.set(t.packId, {
          id: t.packId,
          name: t.packId,
          triggerCount: 0
        });
      }
      packsMap.get(t.packId).triggerCount++;
    });
    
    return Array.from(packsMap.values());
  }
}

const api = new TypeOnceAPI();

// Main CLI setup
program
  .name('typeonce')
  .description('TypeOnce CLI - Smart Text Expansion')
  .version('1.0.0')
  .addHelpText('before', chalk.cyan(logo));

// Status command
program
  .command('status')
  .description('Check API connection and system status')
  .action(async () => {
    logger.info('Checking API connection...');
    
    try {
      const health = await api.health();
      const packs = await api.getPacks();
      
      logger.success('API connection successful!');
      
      console.log(chalk.bold('\n📊 System Status\n'));
      console.log(`API URL:     ${chalk.cyan(API_BASE)}`);
      console.log(`Status:      ${chalk.green(health.status)}`);
      console.log(`Version:     ${chalk.yellow(health.version)}`);
      console.log(`Triggers:    ${chalk.yellow(health.triggers)}`);
      console.log(`Packs:       ${chalk.yellow(packs.length)}`);
      
      console.log(chalk.bold('\n📦 Loaded Packs:'));
      packs.forEach(pack => {
        console.log(`  • ${chalk.blue(pack.name)} - ${pack.triggerCount} triggers`);
      });
      
    } catch (error) {
      logger.error('Failed to connect to API');
      console.error(chalk.red(`\nError: ${error.message}`));
      console.log(chalk.gray(`\nMake sure the TypeOnce API is running at ${API_BASE}`));
      process.exit(1);
    }
  });

// List command
program
  .command('list')
  .alias('ls')
  .description('List all available triggers')
  .option('-p, --pack <pack>', 'Filter by pack ID')
  .action(async (options) => {
    logger.info('Loading triggers...');
    
    try {
      const triggers = await api.getTriggers();
      
      logger.success(`Found ${triggers.length} triggers`);
      
      let filtered = triggers;
      if (options.pack) {
        filtered = triggers.filter(t => t.packId === options.pack);
        console.log(chalk.gray(`Filtered to pack: ${options.pack}`));
      }
      
      console.log();
      filtered.forEach(t => {
        console.log(`${chalk.green(t.key.padEnd(15))} ${t.label || ''} ${chalk.gray(`[${t.packId}]`)}`);
      });
      
    } catch (error) {
      logger.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// Expand command
program
  .command('expand <trigger>')
  .alias('e')
  .description('Expand a trigger')
  .option('-c, --copy', 'Copy to clipboard')
  .action(async (trigger, options) => {
    logger.info('Expanding trigger...');
    
    try {
      const response = await api.expand(trigger);
      
      if (!response.success) {
        logger.error(response.error || 'Trigger not found');
        
        // Suggest similar triggers
        const triggers = await api.getTriggers();
        const similar = triggers.filter(t => 
          t.key.includes(trigger.replace(';', '')) || 
          t.key.includes(trigger)
        );
        
        if (similar.length > 0) {
          console.log(chalk.yellow('\nDid you mean:'));
          similar.slice(0, 5).forEach(t => {
            console.log(`  ${chalk.green(t.key)} - ${t.label || ''}`);
          });
        }
        return;
      }
      
      logger.success('Expansion complete!');
      
      const result = response.result;
      console.log('\n' + chalk.gray('--- Result ---'));
      console.log(result);
      console.log(chalk.gray('--- End ---\n'));
      
      if (options.copy) {
        await clipboardy.write(result);
        logger.success('Copied to clipboard!');
      }
      
    } catch (error) {
      logger.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// Search command
program
  .command('search <query>')
  .alias('s')
  .description('Search for triggers')
  .action(async (query) => {
    logger.info('Searching...');
    
    try {
      const results = await api.search(query);
      
      logger.success(`Found ${results.length} matches`);
      
      if (results.length === 0) {
        console.log(chalk.yellow('\nNo matches found'));
        return;
      }
      
      console.log();
      results.forEach(t => {
        console.log(`${chalk.green.bold(t.key)} - ${t.label || ''} ${chalk.gray(`[${t.packId}]`)}`);
      });
      
    } catch (error) {
      logger.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// Interactive mode
program
  .command('interactive')
  .alias('i')
  .description('Start interactive mode')
  .action(async () => {
    console.log(chalk.cyan(logo));
    console.log(chalk.gray('Interactive mode - type "exit" to quit'));
    console.log(chalk.gray('Type triggers starting with ; or search for keywords\n'));
    
    // Check API connection first
    logger.info('Connecting to API...');
    try {
      const health = await api.health();
      logger.success(`Connected! ${health.triggers} triggers available`);
    } catch (error) {
      logger.error('Could not connect to API');
      process.exit(1);
    }
    
    while (true) {
      const { input } = await inquirer.prompt([{
        type: 'input',
        name: 'input',
        message: chalk.green('typeonce>'),
        prefix: ''
      }]);
      
      if (input === 'exit' || input === 'quit') {
        console.log(chalk.gray('Goodbye!'));
        break;
      }
      
      if (input === 'help') {
        console.log(chalk.gray('\nCommands:'));
        console.log('  ;trigger   - Expand a trigger (e.g., ;date)');
        console.log('  list       - Show all triggers');
        console.log('  exit       - Exit interactive mode');
        console.log('  <keyword>  - Search for triggers\n');
        continue;
      }
      
      if (input === 'list') {
        const triggers = await api.getTriggers();
        console.log(chalk.gray(`\n${triggers.length} triggers available:\n`));
        triggers.slice(0, 20).forEach(t => {
          console.log(`  ${chalk.green(t.key.padEnd(12))} ${chalk.gray(t.label || '')}`);
        });
        if (triggers.length > 20) {
          console.log(chalk.gray(`  ... and ${triggers.length - 20} more`));
        }
        console.log();
        continue;
      }
      
      // Try to expand if it looks like a trigger
      if (input.startsWith(';')) {
        try {
          const response = await api.expand(input);
          if (response.success) {
            console.log(chalk.cyan('→'), response.result);
          } else {
            console.log(chalk.red('✗'), response.error || 'Trigger not found');
          }
        } catch (error) {
          console.log(chalk.red('✗'), 'Error expanding trigger');
        }
      } else {
        // Search mode
        const results = await api.search(input);
        if (results.length > 0) {
          console.log(chalk.gray(`Found ${results.length} matches:`));
          results.slice(0, 5).forEach(r => {
            console.log(`  ${chalk.green(r.key)} - ${chalk.gray(r.label || '')}`);
          });
        } else {
          console.log(chalk.gray('No matches found'));
        }
      }
      console.log();
    }
  });

// Stats command
program
  .command('stats')
  .description('Show statistics')
  .action(async () => {
    logger.info('Gathering statistics...');
    
    try {
      const health = await api.health();
      const triggers = await api.getTriggers();
      const packs = await api.getPacks();
      
      logger.success('Statistics loaded');
      
      console.log(chalk.bold('\n📊 TypeOnce Statistics\n'));
      console.log(`System Version: ${chalk.cyan(health.version)}`);
      console.log(`Total Packs:    ${chalk.yellow(packs.length)}`);
      console.log(`Total Triggers: ${chalk.yellow(triggers.length)}`);
      console.log(`API Status:     ${chalk.green(health.status)}`);
      
      console.log(chalk.bold('\n📦 Pack Distribution:'));
      packs.sort((a, b) => b.triggerCount - a.triggerCount);
      packs.forEach(pack => {
        const bar = '█'.repeat(Math.floor(pack.triggerCount / 2));
        console.log(`  ${pack.id.padEnd(20)} ${chalk.cyan(bar)} ${pack.triggerCount}`);
      });
      
    } catch (error) {
      logger.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// Parse arguments
program.parse(process.argv);

// Show help if no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
