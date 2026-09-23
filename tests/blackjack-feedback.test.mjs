import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as rules from '../src/lib/blackjack.mjs';

// Execute the actual UI controller with deterministic cards and a controllable
// animation clock. No debug controls or seeded decks are shipped to the page.
const source = ts.transpileModule(
  readFileSync(new URL('../src/scripts/blackjack.ts', import.meta.url), 'utf8').replace(
    /^import .*?;\s*/,
    '',
  ),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;
function setup(ranks, desktop = true, audioFails = false, reducedMotion = false) {
  const nodes = new Map(),
    motion = [],
    delays = [],
    audio = { buffers: 0, starts: 0, stops: 0, assets: [] };
  const storage = new Map();
  class Element {
    children = [];
    dataset = {};
    textContent = '';
    innerHTML = '';
    hidden = false;
    disabled = false;
    open = false;
    opens = 0;
    showModal() {
      this.open = true;
      this.opens++;
    }
    close() {
      this.open = false;
      this.events.get('close')?.();
    }
    focus() {}
    events = new Map();
    attributes = new Map();
    classes = new Set();
    classList = {
      toggle: (name, force) => {
        if (force) this.classes.add(name);
        else this.classes.delete(name);
      },
      remove: (name) => this.classes.delete(name),
    };
    style = { setProperty() {} };
    addEventListener(name, fn) {
      this.events.set(name, fn);
    }
    removeEventListener(name) {
      this.events.delete(name);
    }
    setAttribute(name, value) {
      this.attributes.set(name, value);
    }
    append(child) {
      this.children.push(child);
    }
    replaceChildren() {
      this.children = [];
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 400, bottom: 480 };
    }
    closest() {
      return null;
    }
    click() {
      if (!this.disabled) this.events.get('click')?.({});
    }
    animate() {
      let finish;
      const finished = new Promise((resolve) => {
        finish = resolve;
      });
      const animation = { finished, finish };
      motion.push(animation);
      return animation;
    }
  }
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  const doc = new Element();
  doc.hidden = false;
  doc.body = new Element();
  doc.getElementById = get;
  doc.querySelector = get;
  doc.createElement = () => new Element();
  class AudioContextStub {
    state = 'running';
    sampleRate = 8000;
    destination = {};
    constructor() {
      if (audioFails) throw new Error('No device');
    }
    resume() {
      return Promise.resolve();
    }
    createBuffer(_, length) {
      audio.buffers++;
      return { getChannelData: () => new Float32Array(length) };
    }
    createBufferSource() {
      return {
        connect() {},
        disconnect() {},
        start() {
          audio.starts++;
        },
        stop() {
          audio.stops++;
        },
      };
    }
  }
  class HtmlAudio {
    constructor(src) {
      this.src = src;
      this.volume = 1;
    }
    play() {
      audio.assets.push(this.src);
      return Promise.resolve();
    }
  }
  const deck = ranks.map((rank) => ({ rank, suit: '♠' })).reverse();
  vm.runInNewContext(source, {
    ...rules,
    createRound: () => rules.createRound([...deck]),
    document: doc,
    HTMLElement: Element,
    innerWidth: desktop ? 1280 : 390,
    matchMedia: (query) => ({
      matches: query.includes('prefers-reduced-motion')
        ? reducedMotion
        : query.includes('min-width') && desktop,
      addEventListener() {},
    }),
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
    Audio: HtmlAudio,
    AudioContext: AudioContextStub,
    setTimeout: (fn, delay) => {
      delays.push(delay);
      queueMicrotask(fn);
      return 1;
    },
    clearTimeout() {},
  });
  const flush = async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  };
  const step = async () => {
    motion.shift()?.finish();
    await flush();
  };
  const settle = async () => {
    await flush();
    for (let i = 0; motion.length && i < 60; i++) await step();
    assert.equal(motion.length, 0);
  };
  return { get, step, settle, flush, delays, audio, doc, storage };
}
function keydown(h, key, code = undefined) {
  let prevented = false;
  h.doc.events.get('keydown')({
    key,
    code,
    preventDefault() {
      prevented = true;
    },
  });
  return prevented;
}
test('first edition scoring and pacing are restored', async () => {
  const h = setup(['9', '6', '8', '9', '3']);
  h.get('deal').click();
  h.get('deal').click();
  assert.equal(h.get('round').textContent, '01');
  assert.equal(h.get('player-score').textContent, '—');
  await h.step();
  assert.equal(h.get('player-score').textContent, '—');
  assert.equal(h.get('dealer-score').textContent, '—');
  await h.step();
  assert.equal(h.get('dealer-score').textContent, '—');
  await h.settle();
  assert.equal(h.get('player-score').textContent, '17');
  assert.equal(h.get('dealer-score').textContent, '?');
  assert.equal(h.get('dealer-score').classes.has('active-score'), true);
  h.get('stand').click();
  await h.settle();
  assert.equal(h.get('dealer-score').textContent, '18');
  assert.equal(h.get('dealer-score').classes.has('active-score'), true);
  assert.equal(h.get('.game').dataset.result, 'loss');
  assert.deepEqual(h.delays, [225, 140, 225, 140, 225, 140, 225, 240, 225, 650]);
});
test('landing sound is scheduled before a card reaches the table', async () => {
  const h = setup(['9', '6', '8', '9', '3']);
  h.get('deal').click();
  await h.flush();
  assert.deepEqual(h.audio.assets, ['/audio/blackjack/card-land.ogg?v=trimmed']);
});
for (const [name, cards, action, result, title] of [
  ['normal win', ['K', 'K', '9', '8'], 'stand', 'win', '你赢了！'],
  ['push', ['K', 'Q', '8', '8'], 'stand', 'push', '平局'],
  ['natural', ['A', '9', 'K', '8'], null, 'blackjack', '黑杰克！'],
  ['both natural', ['A', 'A', 'K', 'Q'], null, 'push', '黑杰克平局'],
  ['dealer natural', ['9', 'A', '8', 'K'], null, 'loss', 'NANA黑杰克！'],
  ['player bust', ['K', '2', '9', '3', '4'], 'hit', 'loss', '你爆牌了'],
  ['dealer bust', ['K', '9', '8', '7', 'K'], 'stand', 'win', 'NANA爆牌！'],
  ['multiple draws', ['K', '2', '8', '3', '4', 'K'], 'stand', 'loss', 'NANA获胜'],
]) {
  test(`persistent desktop result: ${name}`, async () => {
    const h = setup(cards);
    h.get('deal').click();
    await h.settle();
    if (action) {
      h.get(action).click();
      await h.settle();
    }
    assert.equal(h.get('.game').dataset.result, result);
    assert.equal(h.get('result-title').textContent, title);
    assert.equal(h.get('round-result').open, true);
    assert.equal(h.get('result-player').textContent, h.get('player-score').textContent);
    assert.equal(h.get('result-dealer').textContent, h.get('dealer-score').textContent);
    assert.equal(h.get('deal').disabled, true);
    const previous = h.get('result-title').textContent;
    h.get('hit').click();
    await h.settle();
    assert.equal(h.get('result-title').textContent, previous);
  });
}
test('mobile plays sound by default, keeps old process messages and has no new reading pauses', async () => {
  const h = setup(['A', '2', '6', '3', 'K', '4', 'K'], false);
  assert.equal(h.get('sound-label').textContent, '开');
  h.get('deal').click();
  await h.settle();
  assert.equal(h.get('message').textContent, '要一张，还是就此停下？');
  assert.equal(h.get('dealer-score').textContent, '?');
  h.get('hit').click();
  await h.settle();
  assert.equal(h.get('player-score').textContent, '17');
  h.get('stand').click();
  await h.settle();
  assert.deepEqual(h.delays, []);
  assert.ok(h.audio.assets.length > 0);
  assert.equal(h.get('round-result').opens, 0);
});
test('reduced motion skips the desktop pacing pauses', async () => {
  const h = setup(['9', '6', '8', '9', '3'], true, false, true);
  h.get('deal').click();
  await h.settle();
  h.get('stand').click();
  await h.settle();
  assert.deepEqual(h.delays, []);
  assert.equal(h.get('round-result').open, true);
});
test('dialog replay closes the receipt and starts the next round', async () => {
  const h = setup(['9', '6', '8', '9', '3']);
  h.get('deal').click();
  await h.settle();
  h.get('stand').click();
  await h.settle();
  assert.equal(h.get('round-result').open, true);
  h.get('result-replay').click();
  assert.equal(h.get('round-result').open, false);
  assert.equal(h.get('round').textContent, '02');
});
test('keyboard hint switch remembers its setting without disabling shortcuts', async () => {
  const h = setup(['9', '6', '8', '9', '3']);
  assert.equal(h.get('key-hints').attributes.get('aria-pressed'), 'true');
  assert.equal(h.doc.body.dataset.keyHints, 'visible');
  h.get('key-hints').click();
  assert.equal(h.get('key-hints').attributes.get('aria-pressed'), 'false');
  assert.equal(h.get('key-hints-label').textContent, '关');
  assert.equal(h.doc.body.dataset.keyHints, 'hidden');
  assert.equal(h.storage.get('blackjack-key-hints'), 'false');
  assert.equal(keydown(h, ' ', 'Space'), true);
  assert.equal(h.get('round').textContent, '01');
});
test('desktop keyboard keeps all round actions under one hand', async () => {
  const h = setup(['9', '6', '8', '9', '3']);
  assert.equal(keydown(h, 'h'), false);
  assert.equal(keydown(h, 'Enter'), false);
  assert.equal(h.get('round').textContent, '');
  assert.equal(keydown(h, ' ', 'Space'), true);
  await h.settle();
  assert.equal(h.get('round').textContent, '01');
  const playerTotal = h.get('player-score').textContent;
  assert.equal(keydown(h, 'w'), false);
  assert.equal(h.get('player-score').textContent, playerTotal);
  assert.equal(keydown(h, 's'), true);
  await h.settle();
  assert.equal(h.get('round-result').open, true);
  assert.equal(keydown(h, 'w'), true);
  assert.equal(h.get('round-result').open, false);
  assert.equal(h.get('round').textContent, '01');
});
test('space replays only from the desktop result receipt', async () => {
  const h = setup(['9', '6', '8', '9', '3']);
  h.get('deal').click();
  await h.settle();
  h.get('stand').click();
  await h.settle();
  assert.equal(h.get('round-result').open, true);
  assert.equal(keydown(h, ' ', 'Space'), true);
  assert.equal(h.get('round-result').open, false);
  assert.equal(h.get('round').textContent, '02');
});
test('dialog blocks game shortcuts, closes without starting a round and opens once per round', async () => {
  const h = setup(['9', '6', '8', '9', '3']);
  h.get('deal').click();
  await h.settle();
  h.get('stand').click();
  await h.settle();
  for (const key of ['h', 's', 'Enter']) h.doc.events.get('keydown')({ key });
  h.get('deal').click();
  assert.equal(h.get('round').textContent, '01');
  h.get('result-close').click();
  assert.equal(h.get('round-result').open, false);
  assert.equal(h.get('round').textContent, '01');
  h.doc.events.get('visibilitychange')();
  assert.equal(h.get('round-result').opens, 1);
  h.get('deal').click();
  await h.settle();
  h.get('stand').click();
  await h.settle();
  assert.equal(h.get('round-result').opens, 2);
  h.get('round-result').events.get('click')({
    target: h.get('round-result'),
    clientX: -10,
    clientY: -10,
  });
  assert.equal(h.get('round-result').open, false);
});
test('desktop caches sounds, mute stops sources and hidden actions do not play', async () => {
  const h = setup(['9', '6', '8', '9', '3']);
  h.get('deal').click();
  await h.settle();
  assert.deepEqual(h.audio.assets, [
    '/audio/blackjack/card-land.ogg?v=trimmed',
    '/audio/blackjack/card-land.ogg?v=trimmed',
    '/audio/blackjack/card-land.ogg?v=trimmed',
    '/audio/blackjack/card-land.ogg?v=trimmed',
  ]);
  assert.equal(h.audio.buffers, 0);
  assert.equal(h.audio.starts, 0);
  h.get('result-close').click();
  h.get('sound').click();
  assert.equal(h.audio.stops, 0);
  assert.equal(h.storage.get('blackjack-desktop-muted'), 'true');
  h.get('stand').click();
  await h.settle();
  assert.equal(h.audio.starts, 0);
  h.get('sound').click();
  const before = h.audio.starts;
  h.doc.hidden = true;
  h.get('deal').click();
  await h.settle();
  assert.equal(h.audio.starts, before);
});
test('background settlement waits for visibility and never replays its sound', async () => {
  const h = setup(['A', '9', 'K', '8']);
  h.doc.hidden = true;
  h.get('deal').click();
  await h.settle();
  assert.equal(h.get('round-result').open, false);
  h.doc.hidden = false;
  h.doc.events.get('visibilitychange')();
  assert.equal(h.get('round-result').open, true);
  assert.equal(h.audio.starts, 0);
});
test('audio failure does not prevent a completed round', async () => {
  const h = setup(['A', '9', 'K', '8'], true, true);
  h.get('deal').click();
  await h.settle();
  assert.equal(h.get('.game').dataset.result, 'blackjack');
});
