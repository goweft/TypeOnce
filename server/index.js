const express = require('express');
const cors = require('cors');
const path = require('path');
const ExpansionEngine = require('../core/engine');
const { Config } = require('../core/config');

const app = express();
const config = new Config();
const engine = new ExpansionEngine({ caseSensitive: config.get('caseSensitive') });
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

// Canonical pack set lives in data/packs (overridable via PACK_DIR, as
// docker-compose does). This mirrors the CLI default so local `node server/index.js`
// loads the same packs — and, via profiles.js's `<packDir>/../profiles.yml`
// fallback, the same data/profiles.yml — instead of the stale legacy ../packs.
const packDir = process.env.PACK_DIR || path.join(__dirname, '..', 'data', 'packs');

// Extra pack dirs from config (orthogonal to profiles); resolved, missing skipped.
const extraDirs = (config.get('extraPackDirs') || [])
  .map((d) => path.resolve(d))
  .filter((d) => fs.existsSync(d));

engine.loadPacks(packDir, { extraDirs });

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
    // Declared input fields (name/prompt/default/type/options/required) so clients
    // can prompt before calling /expand. Empty array for triggers with no inputs.
    inputs: Array.isArray(t.inputs) ? t.inputs : [],
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
