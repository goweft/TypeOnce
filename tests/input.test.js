const InputHandler = require('../core/input');

describe('InputHandler', () => {
  test('returns {} when the trigger declares no inputs', async () => {
    const h = new InputHandler({ isTTY: false });
    expect(await h.collectInputs({ key: ';x' })).toEqual({});
    expect(await h.collectInputs({ key: ';x', inputs: [] })).toEqual({});
  });

  test('uses provided values and skips prompting', async () => {
    const promptFn = jest.fn();
    const h = new InputHandler({ promptFn });
    const trigger = { inputs: [{ name: 'type' }, { name: 'message' }] };

    const out = await h.collectInputs(trigger, { type: 'fix', message: 'bug' });

    expect(out).toEqual({ type: 'fix', message: 'bug' });
    expect(promptFn).not.toHaveBeenCalled();
  });

  test('prompts for missing values and applies defaults on empty answers', async () => {
    const answers = { type: '', message: 'ship it' };
    const promptFn = (input) => Promise.resolve(answers[input.name]);
    const h = new InputHandler({ promptFn });
    const trigger = {
      inputs: [
        { name: 'type', default: 'feat' },
        { name: 'message' },
      ],
    };

    const out = await h.collectInputs(trigger);

    expect(out).toEqual({ type: 'feat', message: 'ship it' });
  });

  test('mixes provided values with prompted ones', async () => {
    const promptFn = jest.fn((input) => Promise.resolve(`prompted-${input.name}`));
    const h = new InputHandler({ promptFn });
    const trigger = { inputs: [{ name: 'type' }, { name: 'message' }] };

    const out = await h.collectInputs(trigger, { type: 'fix' });

    expect(out).toEqual({ type: 'fix', message: 'prompted-message' });
    expect(promptFn).toHaveBeenCalledTimes(1);
  });

  test('non-interactive (no TTY, no prompt fn) falls back to defaults instead of hanging', async () => {
    const h = new InputHandler({ isTTY: false });
    const trigger = { inputs: [{ name: 'type', default: 'feat' }, { name: 'scope' }] };

    expect(await h.collectInputs(trigger)).toEqual({ type: 'feat', scope: '' });
  });
});
