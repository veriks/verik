import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiveRegion, isCancel, isConfirm, isDown, isUp } from './keypress.js';
import { isInteractive, select, ask } from './prompt.js';

/**
 * The behaviour that matters here is what happens when nobody is watching.
 * Verik is routinely run by CI and by coding agents, where stdin is not a
 * TTY — a prompt that blocks there hangs the whole pipeline forever, and it is
 * exactly the case a human testing by hand never hits.
 */
describe('non-interactive safety', () => {
  const original = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY };

  afterEach(() => {
    process.stdin.isTTY = original.stdin;
    process.stdout.isTTY = original.stdout;
  });

  it('reports non-interactive when stdin is not a TTY', () => {
    process.stdin.isTTY = false;
    expect(isInteractive()).toBe(false);
  });

  it('select returns the default instead of waiting for a keypress', async () => {
    process.stdin.isTTY = false;
    const value = await select({
      question: 'pick',
      choices: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      defaultIndex: 1,
    });
    expect(value).toBe('b');
  });

  it('ask returns the fallback instead of reading stdin', async () => {
    process.stdin.isTTY = false;
    expect(await ask('name', 'default-value')).toBe('default-value');
  });
});

describe('key matching', () => {
  const key = (name: string, ctrl = false) => ({ name, ctrl, shift: false });

  it('accepts both arrows and vim keys', () => {
    expect(isUp(key('up'))).toBe(true);
    expect(isUp(key('k'))).toBe(true);
    expect(isDown(key('down'))).toBe(true);
    expect(isDown(key('j'))).toBe(true);
  });

  it('treats ctrl-c and escape as cancel', () => {
    expect(isCancel(key('c', true))).toBe(true);
    expect(isCancel(key('escape'))).toBe(true);
    // A bare 'c' is a normal keystroke, not a cancel.
    expect(isCancel(key('c'))).toBe(false);
  });

  it('accepts return and enter', () => {
    expect(isConfirm(key('return'))).toBe(true);
    expect(isConfirm(key('enter'))).toBe(true);
  });
});

describe('LiveRegion', () => {
  it('rewinds exactly as many lines as it drew', () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    try {
      const region = new LiveRegion();
      region.render(['one', 'two', 'three']);
      region.render(['four']);

      // The second render must rewind 3 lines — the count of the first draw,
      // not of the second. Getting this wrong leaves stale menu rows on screen
      // or eats the caller's output above the region.
      const rewind = writes[1]!;
      expect(rewind).toBe('\x1b[1A\x1b[2K'.repeat(3));
    } finally {
      spy.mockRestore();
    }
  });

  it('counts embedded newlines as the extra rows they occupy', () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    try {
      const region = new LiveRegion();
      // Two array entries, but the first prints two rows — this is exactly the
      // shape stepHeader produces, and counting entries made the whole block
      // walk up the screen one line per keypress.
      region.render(['\nheader', 'body']);
      region.render(['redrawn']);

      expect(writes[1]).toBe('\x1b[1A\x1b[2K'.repeat(3));
    } finally {
      spy.mockRestore();
    }
  });

  it('does not rewind when nothing has been drawn', () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      new LiveRegion().clear();
      expect(writes).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('commit leaves content on screen', () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      const region = new LiveRegion();
      region.render(['keep me']);
      region.commit();
      writes.length = 0;
      region.clear();
      expect(writes).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
