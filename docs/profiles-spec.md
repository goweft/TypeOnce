# TypeOnce — Role-Based Profiles (implementation spec)

> Task brief for Claude Code. Implement on a `feat/profiles` branch, keep `npm test` green, open a PR. Paths are relative to the repo root (`/opt/typeonce`).

## Goal
Add named **profiles** that each activate a subset of packs, so the same trigger can resolve differently per context (work / personal / IR), and the current cross-pack key collisions (`;sig`, `;docker`) are *resolved* rather than merely warned about.

## Current state (what exists today)
- `core/engine.js` (`ExpansionEngine extends EventEmitter`): `loadPacks(packDir)` loads every pack from one directory into a single `Map<key, trigger>` (last-wins; intra/cross-pack dups currently just `console.warn`). `expand(key, { inputs })` renders via `core/renderer.js`, with a `raw` passthrough that returns the template verbatim. `getAllTriggers()`, `findTriggers(query)`.
- Packs: `data/packs/*.yml` — 7 packs, 45 trigger entries → 43 unique keys after dedup. Each pack has a stable `id` (`biz.communication`, `it.support`, `personal.quick`, `prod.shortcuts`, `dev.toolkit`, `typeonce.essentials`, `custom.personal`).
- CLI `cli/index.js` (commander: `expand`, `list`, `validate` [stub], `serve`). Rich client `cli/typeonce-cli.js` (talks to the API on :8091).
- API `server/index.js` (Express): `GET /health`, `GET /triggers`, `POST /expand`. Loads packs from `PACK_DIR || ../packs`.
- Tests: `tests/engine.test.js`. CI (`.github/workflows/ci.yml`) runs `npm ci && npm test` on push/PR to `main`.
- Container: `docker/Dockerfile.api` (copies `cli/ core/ server/ packs/`, `npm ci --only=production`, `CMD node server/index.js`); `docker-compose.yml` (`typeonce-api`, host `8091`→container `8090`, mounts `./data/packs:/app/packs`, `PACK_DIR=/app/packs`).

## Design (recommended approach)
Keep **all** packs loaded in one registry, but make *resolution* profile-aware. A profile is a named list of pack `id`s. `expand(key, { profile })` only considers triggers whose `packId` is in that profile's pack set. With **no profile**, behavior is unchanged (all packs eligible) — fully backward compatible.

Why this over reloading packs per profile: the API can accept a **per-request** profile with zero reload, and collisions resolve naturally — within `work`, only `dev.toolkit` defines `;docker`, so it wins cleanly with no ambiguity.

Registry shape change: `this.triggers` becomes `Map<key, Array<{ ...trigger, packId, packVars }>>` (a key can hold entries from multiple packs). Note `this.triggers.size` stays **43** (it counts unique keys), so the existing engine test's count assertion still holds; `expand` with no profile picks the last entry (preserving today's last-wins), so existing results are unchanged.

## Files to create / modify

1. **`data/profiles.yml`** (new):
   ```yaml
   default: work
   profiles:
     work:
       description: Work / IT
       packs: [biz.communication, it.support, dev.toolkit, prod.shortcuts]
     personal:
       description: Personal
       packs: [personal.quick, custom.personal, typeonce.essentials]
     ir:
       description: Incident response
       packs: [it.support, dev.toolkit]   # expand as security packs land
   ```
   Packs are referenced by `id`. Profiles are designed to be internally collision-free (e.g. `work` gets `;sig` from `biz.communication`, `personal` gets it from `typeonce.essentials`).

2. **`core/profiles.js`** (new) — load + validate `profiles.yml`:
   - Resolve path from `PROFILES_FILE` env, else `<packDir>/../profiles.yml`. If absent → return `null` (no-profile mode).
   - Validate every referenced pack `id` exists among loaded packs; `console.warn` (don't throw) on unknown ids.
   - Export `{ profiles, default }` plus `getProfile(name)`, `listProfiles()`.

3. **`core/engine.js`** (modify):
   - Registry → `Map<key, Array<entry>>`; `loadPacks` appends per key (keep the intra-pack dup warning).
   - Profile state: `setActiveProfile(name)`, `getActiveProfile()`; load profiles via `core/profiles.js`. Resolution order: explicit arg → `PROFILE` env → `profiles.yml` `default` → none.
   - `expand(key, { inputs, profile } = {})`: candidates = entries for `key`; if a profile is active or passed, filter to `packId ∈ profile.packs`; pick the last candidate; keep the `raw` passthrough + renderer call; return `null` if none.
   - `getAllTriggers({ profile } = {})` filters likewise so `/triggers` and `list` reflect the active profile.
   - **Back-compat:** no profile → no filtering (identical to today).

4. **`cli/index.js`** (modify) — add a `profile` command group:
   - `typeonce profile list` → profiles, their packs, which is default/active.
   - `typeonce profile use <name>` → persist active profile to `data/config/active-profile` (plain text).
   - `typeonce profile current` → print active.
   - `expand`/`list` read the persisted active profile (`PROFILE` env overrides). While here, make `validate` actually validate packs (it's currently a no-op stub).

5. **`server/index.js`** (modify):
   - Set active profile on boot from `PROFILE` env / profiles default.
   - `POST /expand` accepts optional `profile` in the JSON body (or `?profile=`) → per-request override.
   - Add `GET /profiles` (list); include `activeProfile` in `/health`.
   - Unchanged when no profile is configured.

6. **`tests/profiles.test.js`** (new):
   - `profiles.yml` loads; unknown pack ids warn, don't throw.
   - `work` active: `;sig` resolves to the **business** signature (contains the `Email:`/`Phone:` lines); `;docker` resolves to `dev.toolkit` (`docker ps …`, raw, `{{.Names}}` intact).
   - `personal` active: `;sig` resolves to `typeonce.essentials` (the short signature, **no** email/phone line); `;docker` resolves to `custom.personal` (`sudo docker ps …`). I.e. a *different* result than `work`.
   - Per-request: `expand(';docker', { profile: 'personal' })` differs from `{ profile: 'work' }`.
   - No profile → all packs eligible; registry still 43 unique keys (back-compat).

7. **`docker/Dockerfile.api`** + **`docker-compose.yml`** (modify):
   - Dockerfile: `COPY data/profiles.yml ./data/profiles.yml`.
   - compose: mount `./data/profiles.yml:/app/data/profiles.yml`, set `PROFILES_FILE=/app/data/profiles.yml`, and `PROFILE=work` (or leave unset for all-packs).
   - `docker compose up --build` must still start `typeonce-api` on host 8091 and pass `/health`.

## Acceptance criteria
- `npm test` passes — the existing engine suite **and** the new profiles suite.
- `node cli/index.js profile list` shows the three profiles; `profile use personal` then `expand ;docker` differs from under `work`.
- `POST /expand {"trigger":";docker","profile":"personal"}` differs from `"profile":"work"`; `GET /profiles` lists them; `/health` reports `activeProfile`.
- With no `profiles.yml` / `PROFILE` unset, behavior is identical to current `main` (existing AHK + Mac clients unaffected).
- `docker compose up --build` works; container loads the default profile.

## Constraints
- Backward compatible — no profile means today's behavior.
- Keep `tests/engine.test.js` green; only adjust it if the registry-shape change forces it, and keep its assertions equivalent.
- Profiles reference packs by `id`; don't rename packs or change the `id` scheme.
- Work on `feat/profiles`, open a PR, keep CI green.
