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

// Activate the boot profile: PROFILE env -> profiles.yml default -> none.
// With no profiles file and PROFILE unset, this stays null (all packs eligible),
// preserving the pre-profiles behavior for existing clients.
engine.setActiveProfile(engine.resolveBootProfile());

// A per-request profile may arrive in the JSON body or as a ?profile= query.
// `null` (explicitly) forces all-packs; `undefined` falls back to the active profile.
function requestProfile(req) {
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'profile')) {
    return req.body.profile;
  }
  if (req.query && Object.prototype.hasOwnProperty.call(req.query, 'profile')) {
    return req.query.profile;
  }
  return undefined;
}

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    triggers: engine.triggers.size,
    activeProfile: engine.getActiveProfileName(),
    version: '0.1.0'
  });
});

app.post('/expand', (req, res) => {
  const { trigger, inputs = {} } = req.body;
  const profile = requestProfile(req);
  const context = profile === undefined ? { inputs } : { inputs, profile };
  try {
    const result = engine.expand(trigger, context);
    if (result !== null) {
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
  const profile = requestProfile(req);
  const context = profile === undefined ? {} : { profile };
  const triggers = engine.getAllTriggers(context).map(t => ({
    key: t.key,
    label: t.label,
    packId: t.packId,
  }));
  res.json(triggers);
});

app.get('/profiles', (req, res) => {
  res.json({
    active: engine.getActiveProfileName(),
    default: engine.profileManager ? engine.profileManager.default : null,
    profiles: engine.listProfiles(),
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TypeOnce API server running on port ${PORT}`);
  console.log(`Loaded ${engine.triggers.size} triggers`);
  const active = engine.getActiveProfileName();
  console.log(`Active profile: ${active || '(none — all packs eligible)'}`);
});
