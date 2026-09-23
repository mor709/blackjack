import { createRound, takeCard, hold, dealerStep, score } from '../lib/blackjack.mjs';

type Card = { rank: string; suit: string };
type Outcome = { result: string; reason: string };
type Round = {
  player: Card[];
  dealer: Card[];
  shoe: Card[];
  phase: string;
  outcome: Outcome | null;
};
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const game = document.querySelector<HTMLElement>('.game')!;
const deal = el<HTMLButtonElement>('deal'),
  hit = el<HTMLButtonElement>('hit'),
  stand = el<HTMLButtonElement>('stand');
const rules = el<HTMLDialogElement>('rules');
const resultDialog = el<HTMLDialogElement>('round-result');
const cardTravelDuration = 280;
const cardLandSoundLead = 55;
const cardSettleDelay = 140;
const dealerThinkDelay = 240;
const resultRevealDelay = 650;
let resultPresented = 0;
let resultAwaitingClose = false;
function presentResult() {
  if (
    (!desktop.matches && !mobile.matches) ||
    document.hidden ||
    rules.open ||
    !round?.outcome ||
    resultPresented === rounds
  )
    return;
  const { result, reason } = round.outcome;
  const titles: Record<string, string> = {
    'player-natural': '黑杰克！',
    'dealer-natural': 'NANA黑杰克！',
    'both-natural': '黑杰克平局',
    'dealer-bust': 'NANA爆牌！',
    'player-bust': '你爆牌了',
    points: result === 'win' ? '你赢了！' : result === 'loss' ? 'NANA获胜' : '平局',
  };
  const descriptions: Record<string, string> = {
    'player-natural': '起手两张牌组成21点',
    'dealer-natural': 'NANA起手组成21点',
    'both-natural': '双方起手均为21点',
    'dealer-bust': 'NANA点数超过21点',
    'player-bust': '你的点数超过21点',
    points:
      result === 'push'
        ? '双方最终点数相同'
        : result === 'win'
          ? '你的点数更接近21点'
          : 'NANA点数更接近21点',
  };
  resultDialog.dataset.result = result;
  el('result-round').textContent = String(rounds).padStart(2, '0');
  el('result-title').textContent = titles[reason];
  el('result-player').textContent = String(score(round.player));
  el('result-dealer').textContent = String(score(round.dealer));
  el('result-description').textContent = descriptions[reason];
  resultDialog.showModal();
  resultPresented = rounds;
}
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const desktop = matchMedia('(min-width: 761px)');
const mobile = matchMedia('(max-width: 760px)');
let desktopMuted = false;
try {
  desktopMuted = localStorage.getItem('blackjack-desktop-muted') === 'true';
} catch {
  /* Storage is optional. */
}
let keyHintsVisible = true;
try {
  keyHintsVisible = localStorage.getItem('blackjack-key-hints') !== 'false';
} catch {
  /* Storage is optional. */
}
const playerTurnHint = () => (mobile.matches ? '选择要牌，或结束本回合。' : '空格 要牌 · S 停牌');
let desktopAudio: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();
const sources = new Set<AudioBufferSourceNode>();
const cardSoundFiles = {
  land: '/audio/blackjack/card-land.ogg?v=trimmed',
  flip: '/audio/blackjack/card-flip.ogg',
} as const;
const cardSoundClips = Object.fromEntries(
  Object.entries(cardSoundFiles).map(([kind, src]) => {
    const clip = new Audio(src);
    clip.preload = 'auto';
    clip.volume = 0.32;
    return [kind, clip];
  }),
) as Record<keyof typeof cardSoundFiles, HTMLAudioElement>;
function stopDesktopSound() {
  for (const source of sources) {
    source.stop();
    source.disconnect();
  }
  sources.clear();
}
function unlockSound() {
  if (!desktop.matches || desktopMuted || document.hidden) return;
  try {
    desktopAudio ??= new AudioContext();
    void desktopAudio.resume().catch(() => {});
  } catch {
    /* Audio must never block play. */
  }
}
function desktopSound(kind: string) {
  const context = desktopAudio;
  if (!desktop.matches || desktopMuted || document.hidden || context?.state !== 'running') return;
  try {
    let buffer = buffers.get(kind);
    if (!buffer) {
      const paper = ['card', 'land', 'flip'].includes(kind);
      const duration = kind === 'land' ? 0.045 : paper ? 0.12 : 0.32;
      buffer = context.createBuffer(
        1,
        Math.ceil(context.sampleRate * duration),
        context.sampleRate,
      );
      const data = buffer.getChannelData(0);
      let smooth = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i / context.sampleRate;
        const envelope = Math.sin((Math.PI * i) / data.length) * Math.exp(-t * (paper ? 22 : 8));
        const smoothing = kind === 'flip' ? 0.3 : kind === 'land' ? 0.85 : 0.65;
        smooth = smooth * smoothing + (Math.random() * 2 - 1) * (1 - smoothing);
        const frequency = kind === 'win' ? 587 : kind === 'push' ? 392 : 220;
        data[i] =
          envelope *
          (paper
            ? smooth * (kind === 'land' ? 0.7 : 0.4)
            : Math.sin(2 * Math.PI * frequency * t) * 0.07);
      }
      buffers.set(kind, buffer);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      source.disconnect();
    };
    source.start();
  } catch {
    /* A failed audio device must not block the round. */
  }
}
function canPlayCardSound() {
  const isMuted = desktop.matches ? desktopMuted : muted;
  return !isMuted && !document.hidden;
}
function cardSound(kind: keyof typeof cardSoundFiles) {
  if (!canPlayCardSound()) return;
  try {
    const clip = cardSoundClips[kind];
    clip.currentTime = 0;
    void clip.play().catch(() => {});
  } catch {
    /* A missing audio file must not block play. */
  }
}
let round: Round | null = null;
let rounds = 0,
  busy = false,
  revealed = false,
  muted = false;
let audio: AudioContext | null = null;
const animations = new Set<Animation>();
const pauses = new Set<() => void>();
const scheduledCardSounds = new Set<ReturnType<typeof setTimeout>>();

function message(title: string, detail: string) {
  el('message').textContent = title;
  el('submessage').textContent = detail;
}
function controls() {
  const playable = round?.phase === 'player' && !busy;
  const ended = !round || (round.phase === 'done' && !busy);
  deal.hidden = !ended;
  deal.disabled = busy || resultAwaitingClose;
  hit.hidden = ended;
  stand.hidden = ended;
  hit.disabled = !playable;
  stand.disabled = !playable;
  deal.innerHTML = rounds
    ? '再来一局 <span aria-hidden="true">↗</span><kbd>空格</kbd>'
    : '开始 <span aria-hidden="true">↗</span><kbd>空格</kbd>';
}
function scores() {
  if (!round) return;
  el('player-score').textContent = String(score(round.player));
  el('dealer-score').textContent = revealed ? String(score(round.dealer)) : '?';
  el('player-score').classList.toggle(
    'active-score',
    round.phase === 'player' || round.phase === 'done',
  );
  el('dealer-score').classList.toggle(
    'active-score',
    (desktop.matches || mobile.matches) &&
      (round.phase === 'player' || round.phase === 'dealer' || round.phase === 'done'),
  );
}
async function animate(target: HTMLElement, frames: Keyframe[], duration: number) {
  if (reduced.matches || document.hidden) return;
  const animation = target.animate(frames, { duration, easing: 'cubic-bezier(.2,.7,.2,1)' });
  animations.add(animation);
  try {
    await animation.finished;
  } catch {
    /* Cancelled motion is a completed visual step. */
  } finally {
    animations.delete(animation);
  }
}
function pause(duration: number) {
  if (!desktop.matches || reduced.matches || document.hidden) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      pauses.delete(finish);
      resolve();
    };
    timer = setTimeout(finish, duration);
    pauses.add(finish);
  });
}
function finishAnimations() {
  for (const animation of animations) animation.finish();
}
function finishPauses() {
  for (const finish of [...pauses]) finish();
}
function scheduleCardSound(kind: keyof typeof cardSoundFiles, delay: number) {
  if (!canPlayCardSound()) return;
  if (!desktop.matches || reduced.matches || delay <= 0) {
    cardSound(kind);
    return;
  }
  const timer = setTimeout(() => {
    scheduledCardSounds.delete(timer);
    cardSound(kind);
  }, delay);
  scheduledCardSounds.add(timer);
}
function cancelScheduledCardSounds() {
  for (const timer of scheduledCardSounds) clearTimeout(timer);
  scheduledCardSounds.clear();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    finishAnimations();
    finishPauses();
    cancelScheduledCardSounds();
    stopDesktopSound();
  } else if (game.dataset.phase === 'done') presentResult();
});
reduced.addEventListener('change', () => {
  if (reduced.matches) {
    finishAnimations();
    finishPauses();
    cancelScheduledCardSounds();
  }
});

function sound(kind: 'card' | 'flip' | 'win' | 'loss' | 'push') {
  if (desktop.matches) {
    desktopSound(kind);
    return;
  }
  if (muted) return;
  try {
    audio ??= new AudioContext();
    void audio.resume().catch(() => {});
    const context = audio;
    if (kind === 'card' || kind === 'flip') {
      const length = Math.floor(context.sampleRate * 0.085);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const source = context.createBufferSource(),
        filter = context.createBiquadFilter(),
        gain = context.createGain();
      source.buffer = buffer;
      filter.type = 'bandpass';
      filter.frequency.value = kind === 'card' ? 850 : 1400;
      gain.gain.value = 0.12;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      source.start();
    } else {
      const osc = context.createOscillator(),
        gain = context.createGain();
      osc.frequency.value = kind === 'win' ? 587 : 220;
      gain.gain.setValueAtTime(0.045, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start();
      osc.stop(context.currentTime + 0.36);
    }
  } catch {
    /* Sound is optional; a failed audio device must not block a round. */
  }
}

const suitPaths: Record<string, string> = {
  '♥': 'M0 8C-3 4-9 0-9-5C-9-11-2-12 0-7C2-12 9-11 9-5C9 0 3 4 0 8Z',
  '♦': 'M0-12 8 0 0 12-8 0Z',
  '♠': 'M0-12C-3-8-9-3-9 2C-9 7-3 8-1 4L-3 11H3L1 4C3 8 9 7 9 2C9-3 3-8 0-12Z',
  '♣': 'M-2 3C-10 9-13-5-5-5C-9-16 9-16 5-5C13-5 10 9 2 3L4 11H-4Z',
};
function artwork(card: Card) {
  const p = suitPaths[card.suit];
  const pip = (x: number, y: number, s = 1) =>
    `<path class="pip" d="${p}" transform="translate(${x} ${y}) scale(${s})"/>`;
  const n = Number(card.rank);
  const faceCard = ['J', 'Q', 'K'].includes(card.rank);
  let content = '';
  if (card.rank === 'A') {
    content =
      '<ellipse class="art-outline" cx="35" cy="50" rx="31" ry="42"/><ellipse class="art-outline" cx="35" cy="50" rx="23" ry="42"/><path class="art-outline" d="M4 50H66M35 8V92"/>' +
      pip(35, 50, 2.1);
  } else if (faceCard) {
    content =
      '<path class="art-hatch" d="M5 5H65V95H5Z"/><path class="art-outline" d="M5 5H65V95H5ZM5 5 65 95M65 5 5 95M5 50H65"/><path class="art-outline" d="M35 10 58 50 35 90 12 50Z"/>' +
      pip(35, 50, 1.65) +
      pip(35, 15, 0.6) +
      pip(35, 85, 0.6);
  } else {
    const rows = Math.floor(n / 2);
    if (n <= 3) {
      for (let i = 0; i < n; i++) content += pip(35, n === 1 ? 50 : 16 + (i * 68) / (n - 1), 0.9);
    } else {
      for (let i = 0; i < rows; i++) {
        const y = 12 + (i * 76) / (rows - 1);
        content += pip(16, y, 0.72) + pip(54, y, 0.72);
      }
      if (n % 2) content += pip(35, 50, 0.72);
    }
  }
  return `<svg class="card-art${faceCard ? ' face-art' : ''}" viewBox="0 0 70 100" aria-hidden="true">${content}</svg>`;
}
function face(node: HTMLElement, card: Card, hidden = false) {
  node.className = 'card' + (['♥', '♦'].includes(card.suit) && !hidden ? ' red' : '');
  node.setAttribute('aria-label', hidden ? 'NANA的暗牌，未翻开' : `${card.suit} ${card.rank}`);
  node.innerHTML = hidden
    ? '<div class="card-back"><span class="back-mark" aria-hidden="true"><span>21</span></span><small>BLACKJACK</small></div>'
    : `<div class="card-face"><span class="corner">${card.rank}<small>${card.suit}</small></span>${artwork(card)}<span class="corner bottom" aria-hidden="true">${card.rank}<small>${card.suit}</small></span></div>`;
}
function positionCards(container: HTMLElement) {
  const cards = [...container.children] as HTMLElement[];
  if (mobile.matches) {
    const step = innerWidth <= 380 ? 32 : 40;
    const slots = Array.from({ length: 10 }, (_, index) => (index - 1) * step);
    cards.forEach((node, index) => {
      if (node.dataset.cardSlot) return;
      const offset = slots[index] ?? (index % 2 ? -1 : 1) * 108;
      node.dataset.cardSlot = String(index);
      node.style.setProperty('--card-offset', `${offset}px`);
      node.style.setProperty('--angle', `${Math.sign(offset) * Math.min(5, Math.abs(offset) / 18)}deg`);
    });
    cards
      .map((node) => ({ node, offset: Number.parseFloat(node.style.getPropertyValue('--card-offset')) || 0 }))
      .sort((left, right) => left.offset - right.offset)
      .forEach(({ node }, index) => node.style.setProperty('z-index', String(index + 1)));
    const groupOffset = cards.length > 3 ? -((cards.length - 3) * step) / 2 : 0;
    container.style.setProperty('--hand-shift', `${groupOffset}px`);
    return;
  }
  container.style.setProperty('--count', String(Math.max(cards.length, 2)));
  cards.forEach((node, i) =>
    node.style.setProperty(
      '--angle',
      `${(i - (cards.length - 1) / 2) * Math.min(5, 16 / cards.length)}deg`,
    ),
  );
}
async function addCard(who: 'player' | 'dealer', card: Card, hidden = false) {
  const container = el(who + '-hand');
  const node = document.createElement('div');
  face(node, card, hidden);
  container.append(node);
  positionCards(container);
  const deck = document.querySelector<HTMLElement>('.deck')!;
  const from = deck.getBoundingClientRect(),
    to = node.getBoundingClientRect();
  const x = innerWidth > 760 ? from.left - to.left : 75;
  const y = innerWidth > 760 ? from.top - to.top : -40;
  scheduleCardSound('land', cardTravelDuration - cardLandSoundLead);
  await animate(
    node,
    [
      { translate: `${x}px ${y}px`, rotate: '12deg', opacity: 0 },
      { translate: '0 0', rotate: '0deg', opacity: 1 },
    ],
    cardTravelDuration,
  );
}
async function reveal() {
  if (revealed || !round) return;
  const node = el('dealer-hand').children[1] as HTMLElement;
  if (!node) return;
  if (mobile.matches) {
    const mobileCardAngle = node.style.getPropertyValue?.('--angle') || '0deg';
    const mobileFlipFrame = (degrees: number) => ({
      transform: `translateX(-50%) rotate(${mobileCardAngle}) rotateY(${degrees}deg)`,
    });
    await animate(node, [mobileFlipFrame(0), mobileFlipFrame(90)], 180);
    face(node, round.dealer[1]);
    cardSound('flip');
    await animate(node, [mobileFlipFrame(-90), mobileFlipFrame(0)], 200);
  } else {
    await animate(node, [{ rotate: 'y 0deg' }, { rotate: 'y 90deg' }], 130);
    face(node, round.dealer[1]);
    cardSound('flip');
    await animate(node, [{ rotate: 'y -90deg' }, { rotate: 'y 0deg' }], 150);
  }
  revealed = true;
  scores();
}
function showResult() {
  if (!round?.outcome) return;
  const { result, reason } = round.outcome;
  const titles: Record<string, string> = {
    win: '你赢了。',
    loss: '这一局，NANA赢。',
    push: '平局。',
    blackjack: 'Blackjack!',
  };
  const details: Record<string, string> = {
    'player-bust': '超过 21 点。下一局，重新选择。',
    'dealer-bust': 'NANA爆牌。',
    'player-natural': 'A + 10，恰好 21。',
    'dealer-natural': 'NANA首两张为 21 点。',
    'both-natural': '双方都是 Blackjack。',
    points: `你 ${score(round.player)} 点 · NANA ${score(round.dealer)} 点`,
  };
  message(titles[result], details[reason]);
  game.dataset.result = result;
  game.dataset.phase = 'done';
  scores();
  sound(
    result === 'win' || result === 'blackjack'
      ? 'win'
      : result === 'push' && desktop.matches
        ? 'push'
        : 'loss',
  );
  resultAwaitingClose = desktop.matches || mobile.matches;
  controls();
  if (desktop.matches && !document.hidden) void pause(resultRevealDelay).then(presentResult);
  else presentResult();
}
async function finishOrContinue() {
  if (!round) return;
  if (round.phase === 'dealer') {
    game.dataset.phase = 'dealer';
    message('NANA的回合。', '不足 17 点，继续要牌。');
    await reveal();
    await pause(dealerThinkDelay);
    while (round.phase === 'dealer') {
      const count = round.dealer.length;
      dealerStep(round);
      if (round.dealer.length > count) {
        await addCard('dealer', round.dealer.at(-1)!);
        scores();
        if (round.phase === 'dealer') await pause(cardSettleDelay);
      }
    }
  }
  if (round.phase === 'done') {
    await reveal();
    showResult();
  } else {
    game.dataset.phase = 'player';
    message('要一张，还是就此停下？', playerTurnHint());
    scores();
  }
}
async function run(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  controls();
  try {
    await action();
  } finally {
    busy = false;
    controls();
  }
}
function startRound() {
  if (busy || (round && round.phase !== 'done')) return;
  unlockSound();
  void run(async () => {
    rounds++;
    round = createRound() as Round;
    revealed = false;
    resultAwaitingClose = false;
    delete game.dataset.result;
    game.dataset.phase = 'dealing';
    el('round').textContent = String(rounds).padStart(2, '0');
    el('dealer-hand').replaceChildren();
    el('player-hand').replaceChildren();
    el('dealer-score').textContent = '—';
    el('player-score').textContent = '—';
    el('dealer-score').classList.remove('active-score');
    el('player-score').classList.remove('active-score');
    message('正在发牌。', '每一局，重新洗牌。');
    for (let i = 0; i < 2; i++) {
      await addCard('player', round.player[i]);
      await pause(cardSettleDelay);
      await addCard('dealer', round.dealer[i], i === 1);
      if (i === 0) await pause(cardSettleDelay);
    }
    await finishOrContinue();
  });
}
deal.addEventListener('click', () => {
  if (resultDialog.open) return;
  startRound();
});
hit.addEventListener('click', () => {
  if (busy || round?.phase !== 'player') return;
  void run(async () => {
    takeCard(round);
    await addCard('player', round!.player.at(-1)!);
    scores();
    await finishOrContinue();
  });
});
stand.addEventListener('click', () => {
  if (busy || round?.phase !== 'player') return;
  void run(async () => {
    hold(round);
    await finishOrContinue();
  });
});
el('rules-open').addEventListener('click', () => rules.showModal());
el('rules-close').addEventListener('click', () => rules.close());
rules.addEventListener('close', () => {
  if (game.dataset.phase === 'done') presentResult();
});
el('result-close').addEventListener('click', () => resultDialog.close());
el('result-replay').addEventListener('click', () => {
  if (!resultDialog.open) return;
  resultAwaitingClose = false;
  resultDialog.close();
  startRound();
});
resultDialog.addEventListener('close', () => {
  resultAwaitingClose = false;
  controls();
  if (round?.phase === 'done' && !busy) deal.focus({ preventScroll: true });
});
resultDialog.addEventListener('click', (event) => {
  if (event.target !== resultDialog) return;
  const rect = resultDialog.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
    resultDialog.close();
});
rules.addEventListener('click', (event) => {
  if (event.target !== rules) return;
  const r = rules.getBoundingClientRect();
  if (
    event.clientX < r.left ||
    event.clientX > r.right ||
    event.clientY < r.top ||
    event.clientY > r.bottom
  )
    rules.close();
});
el('sound').addEventListener('click', () => {
  if (desktop.matches) {
    desktopMuted = !desktopMuted;
    try {
      localStorage.setItem('blackjack-desktop-muted', String(desktopMuted));
    } catch {
      /* Storage is optional. */
    }
    if (desktopMuted) stopDesktopSound();
    else unlockSound();
  } else muted = !muted;
  soundLabel();
  sound('card');
});
function soundLabel() {
  const silent = desktop.matches ? desktopMuted : muted;
  el('sound').setAttribute('aria-pressed', String(!silent));
  el('sound-label').textContent = silent ? '关' : '开';
}
function keyHintsLabel() {
  document.body.dataset.keyHints = keyHintsVisible ? 'visible' : 'hidden';
  el('key-hints').setAttribute('aria-pressed', String(keyHintsVisible));
  el('key-hints-label').textContent = keyHintsVisible ? '开' : '关';
}
el('key-hints').addEventListener('click', () => {
  keyHintsVisible = !keyHintsVisible;
  try {
    localStorage.setItem('blackjack-key-hints', String(keyHintsVisible));
  } catch {
    /* Storage is optional. */
  }
  keyHintsLabel();
  if (round?.phase === 'player' && !busy) {
    el('submessage').textContent = playerTurnHint();
  }
});
desktop.addEventListener('change', () => {
  stopDesktopSound();
  soundLabel();
  if (!desktop.matches) {
    resultAwaitingClose = false;
    if (resultDialog.open) resultDialog.close();
    controls();
  }
});
soundLabel();
keyHintsLabel();
document.addEventListener('keydown', (event) => {
  if (
    !desktop.matches ||
    busy ||
    rules.open ||
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  if (
    event.target instanceof HTMLElement &&
    (event.target.isContentEditable || event.target.closest('input,textarea,select'))
  )
    return;
  const key = event.key.toLowerCase();
  const space = event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar';
  if (resultDialog.open) {
    if (space) {
      event.preventDefault();
      el<HTMLButtonElement>('result-replay').click();
    }
    if (key === 'w') {
      event.preventDefault();
      el<HTMLButtonElement>('result-close').click();
    }
    return;
  }
  if (space) {
    event.preventDefault();
    if (round?.phase === 'player') hit.click();
    else if (!round || round.phase === 'done') deal.click();
  }
  if (key === 's') {
    event.preventDefault();
    stand.click();
  }
});
controls();
