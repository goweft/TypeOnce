const express = require('express');
const cors = require('cors');
const path = require('path');
const ExpansionEngine = require('../core/engine');

const app = express();
const engine = new ExpansionEngine();
const PORT = process.env.API_PORT || 8090;

app.use(cors());
app.use(express.json());

// Usage tracking
const fs = require('fs');
const logDir = path.join(__dirname, '..', 'data', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function logUsage(trigger, result) {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp},${trigger},${result ? 'success' : 'failed'}\n`;
  fs.appendFileSync(path.join(logDir, 'usage.log'), logEntry);
}

// Honor PACK_DIR (set in docker-compose); fall back to ../packs.
const packDir = process.env.PACK_DIR || path.join(__dirname, '..', 'packs');
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
      logUsage(trigger, true);
      res.json({ success: true, result });
    } else {
      logUsage(trigger, false);
      res.status(404).json({ success: false, error: 'Trigger not found' });
    }
  } catch (error) {
    logUsage(trigger, false);
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
