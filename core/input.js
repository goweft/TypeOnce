const readline = require('readline');

// Collects values for a trigger's declared `inputs` so templates can reference
// them (e.g. {{message}}). The actual prompting is injectable (promptFn) so the
// handler is testable and so non-interactive callers don't have to touch stdin.
class InputHandler {
  constructor({ promptFn, isTTY } = {}) {
    this.promptFn = promptFn || null;
    this.isTTY = isTTY !== undefined ? isTTY : Boolean(process.stdin.isTTY);
  }

  // provided: values supplied up front (e.g. from `--input key=value`); any
  // input present there is used as-is and never prompted for.
  async collectInputs(trigger, provided = {}) {
    if (!trigger || !trigger.inputs || trigger.inputs.length === 0) {
      return {};
    }

    const values = {};
    let rl = null;

    for (const input of trigger.inputs) {
      if (Object.prototype.hasOwnProperty.call(provided, input.name)) {
        values[input.name] = provided[input.name];
        continue;
      }

      // No way to prompt (no TTY, no injected prompt): fall back to the
      // declared default rather than blocking on stdin forever.
      if (!this.promptFn && !this.isTTY) {
        values[input.name] = input.default || '';
        continue;
      }

      let answer;
      if (this.promptFn) {
        answer = await this.promptFn(input);
      } else {
        rl = rl || readline.createInterface({ input: process.stdin, output: process.stdout });
        answer = await this.ask(rl, input);
      }

      // Empty answer falls back to the default (which may itself be empty).
      values[input.name] = answer || input.default || '';
    }

    if (rl) rl.close();
    return values;
  }

  ask(rl, input) {
    return new Promise((resolve) => {
      const label = input.prompt || `Enter ${input.name}`;
      const hint = input.default ? ` (${input.default})` : '';
      rl.question(`${label}${hint}: `, (answer) => resolve(answer));
    });
  }
}

module.exports = InputHandler;
