# TypeOnce — Trigger Inputs / Variables Spec

## Goal
Today, prompt-heavy triggers (`;appnew`, `;cpfull`, `;gcreview`, ...) expand to a
template full of `[bracketed]` placeholders that you hand-edit after pasting. This
spec adds **typed, named inputs**: a trigger declares the fields it needs, the client
prompts you for them at expansion time, and the engine renders the values into the
template. So `;appnew` asks "What are you building? / Stack? / Constraints?" and emits
a ready-to-send prompt with no hand-editing.

Design constraints: opt-in per trigger, fully backward-compatible, server stays
stateless (clients drive the prompting), reuses the existing Mustache renderer.

## 1. Pack schema — `inputs`
A trigger gains an optional `inputs` array. Example:

```yaml
- key: ";appnew"
  label: "Scaffold a new app (staged)"
  inputs:
    - name: description            # referenced in the template as {{inputs.description}}
      prompt: "What are you building? (features + who it's for)"
      required: true
    - name: stack
      prompt: "Stack (blank = let the model choose)"
      default: "recommend a stack and confirm with me before starting"
    - name: constraints
      prompt: "Constraints (auth, storage, structure, deps, platform, testing)"
      type: multiline
      default: ""
    - name: questions
      prompt: "Max clarifying questions"
      type: number
      default: 3
    - name: mode
      prompt: "Build mode"
      type: select
      options: [staged, one-shot]
      default: staged
  action:
    type: text
    template: |
      ... Stack: {{inputs.stack}} ... ask up to {{inputs.questions}} clarifying questions ...
```

Field keys:

| key        | required | meaning                                                            |
|------------|----------|--------------------------------------------------------------------|
| `name`     | yes      | variable name; referenced as `{{inputs.<name>}}` in the template   |
| `prompt`   | yes      | the question shown to the user                                     |
| `default`  | no       | pre-filled value; used if the user leaves it blank                 |
| `required` | no (false) | client should not submit this empty                              |
| `type`     | no (`text`) | `text` \| `multiline` \| `number` \| `select`                   |
| `options`  | for `select` | list of allowed choices                                        |

## 2. Rendering semantics
- Inputs are exposed under the `inputs` namespace, mirroring the existing
  `{{vars.*}}`: `{{inputs.stack}}`. (Flat `{{stack}}` could also be supported, but the
  namespace avoids collisions with globals like `{{date}}` / `{{user}}`.)
- The renderer builds context as `{ ...globals, vars: {...}, inputs: {...} }`, where
  `inputs` = declared defaults overridden by values supplied at expansion time.
- `raw: true` and `inputs` are **mutually exclusive** — `raw` bypasses Mustache, so a
  trigger with inputs must be rendered (`raw` absent/false). The parser should reject
  or warn if both are set. Templates that need literal `{{ }}` (e.g. the Go-template
  `;docker`) keep `raw: true` and simply don't use inputs.
- HTML escaping stays disabled (`Mustache.escape = t => t`), so `<thinking>`,
  `[brackets]`, etc. render literally — unchanged from today.

## 3. API changes
**`GET /triggers`** — add `inputs` to each trigger object so clients can build a form:

```json
{ "key": ";appnew", "label": "...", "packId": "ai.appbuilder",
  "inputs": [ {"name":"description","prompt":"...","required":true,"type":"text"}, ... ] }
```

Triggers with no inputs omit the field (or return `[]`); existing clients ignore it.

**`POST /expand`** — accept an optional `inputs` object:

```json
{ "trigger": ";appnew", "profile": "work",
  "inputs": { "description": "a CLI todo app", "stack": "Go + SQLite", "questions": 5, "mode": "staged" } }
```

- Merge provided `inputs` over declared defaults, render, return
  `{ "success": true, "result": "..." }` as today.
- No `inputs` key -> behaves exactly as now (defaults used; `raw` triggers untouched).
  **Fully backward-compatible.**
- Optional safety net: if a `required` input is missing and has no default, respond
  `{ "success": false, "needsInput": ["description"] }` so a client can prompt instead
  of sending an empty field.

## 4. Client UX
The server stays stateless; each client reads the schema from `/triggers` and prompts
before calling `/expand`.

- **Windows / AutoHotkey** (`Generate-TypeOnce-AHK.ps1`): for triggers with `inputs`,
  generate a hotstring that opens an AHK v2 `Gui` — one control per field (Edit for
  text, multi-line Edit for `multiline`, numeric Edit for `number`, DropDownList for
  `select`), pre-filled with `default`. On submit, POST to `/expand` with the collected
  `inputs`, then `SendText` the result. Triggers without inputs keep the current
  direct-expand hotstring. The generator embeds each trigger's input schema (from
  `/triggers`) into the generated `.ahk`.
- **macOS `rto`**: if the trigger has inputs, prompt for each field — a terminal loop
  (`read -r -p "prompt [default]: "`) or a per-field `osascript` dialog for a GUI —
  then POST `/expand` with `inputs`, copy the result to the clipboard, and fire the
  existing notification. No-input triggers unchanged.
- **Web UI (8092)**: render a form from the schema, submit, show/copy the rendered
  prompt.

## 5. Backward compatibility & migration
- `inputs` is opt-in; every existing trigger (including all `[bracket]` ones) keeps
  working untouched.
- Migrating one trigger: (1) drop `raw: true`, (2) replace each `[placeholder]` with
  `{{inputs.<name>}}`, (3) add the `inputs:` block. Because Mustache leaves non-`{{}}`
  text alone, removing `raw` is safe for any template that has no literal braces.
- Parser validation to add: `name` present + unique within the trigger; `type` is one
  of the allowed values; `select` has non-empty `options`; `inputs` not combined with
  `raw: true`. Optionally warn if a template references `{{inputs.x}}` with no matching
  field.

## 6. Worked example — `;appnew`
- **Before (today):** template with `[description]`, `[exact stack ...]`, `[3]`
  brackets; you paste, then hand-edit each one.
- **After:** the five `inputs` above; expanding `;appnew` prompts you for them (stack
  pre-filled with the "recommend and confirm" default, mode a staged/one-shot
  dropdown), and emits the finished prompt with nothing left to edit.

## 7. Concrete next steps (suggested order)
1. **Parser** (`core/parser.js`): accept + validate the `inputs` schema; reject
   `inputs` + `raw` together.
2. **Renderer / engine** (`core/renderer.js`, `core/engine.js`): merge
   `defaults (+) provided inputs` into the `inputs` namespace; skip when `raw`.
3. **API** (`server/index.js`): include `inputs` in `/triggers`; accept `inputs` in
   `/expand` (+ optional `needsInput` response).
4. **Tests** (`tests/`): render-with-inputs, defaults-applied, missing-required,
   `select` / `number` coercion, `raw` bypass unchanged.
5. **AHK generator**: per-trigger `Gui` for triggers with inputs.
6. **macOS `rto`**: prompt loop for inputs.
7. **Migrate packs incrementally**: start with `;app*`, then `;cp*` / `;gc*` — convert
   `[brackets]` -> `{{inputs.*}}`.

Steps 1-4 are the core (engine + tests); 5-6 are the client UX that makes it feel
native; 7 is incremental polish.
