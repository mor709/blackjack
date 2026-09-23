import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeck,
  score,
  natural,
  settlement,
  createRound,
  takeCard,
  hold,
  dealerStep,
} from '../src/lib/blackjack.mjs';
const hand = (...ranks) => ranks.map((rank) => ({ rank, suit: '♠' }));
const arranged = (...ranks) => hand(...ranks).reverse();
test('aces count as 1 or 11 without avoidable busts', () => {
  assert.equal(score(hand('A', 'A', '9')), 21);
  assert.equal(score(hand('A', '6')), 17);
  assert.equal(score(hand('A', '6', 'K')), 17);
  assert.equal(score(hand('A', 'A', 'K', 'K')), 22);
});
test('deck has 52 unique cards', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((c) => c.rank + c.suit)).size, 52);
});
test('natural beats drawn 21; two naturals push', () => {
  assert.equal(natural(hand('7', '7', '7')), false);
  assert.equal(settlement(hand('A', 'K'), hand('7', '7', '7')).result, 'blackjack');
  assert.equal(settlement(hand('7', '7', '7'), hand('A', 'K')).result, 'loss');
  assert.equal(settlement(hand('A', 'K'), hand('A', 'Q')).result, 'push');
});
test('normal wins, ties and busts', () => {
  assert.equal(settlement(hand('K', '9'), hand('K', '8')).result, 'win');
  assert.equal(settlement(hand('K', '8'), hand('K', '8')).result, 'push');
  assert.equal(settlement(hand('K', '9'), hand('K', '8', '6')).result, 'win');
  assert.equal(settlement(hand('K', '9', '6'), hand('K', '8', '6')).result, 'loss');
});
test('natural resolves on deal and completed rounds reject actions', () => {
  const r = createRound(arranged('A', '9', 'K', '8', '2'));
  assert.equal(r.phase, 'done');
  assert.equal(r.outcome.result, 'blackjack');
  const before = JSON.stringify(r);
  takeCard(r);
  hold(r);
  dealerStep(r);
  assert.equal(JSON.stringify(r), before);
});
test('21 automatically passes to dealer; soft 17 stands', () => {
  const r = createRound(arranged('9', 'A', '7', '6', '5', 'K'));
  takeCard(r);
  assert.equal(score(r.player), 21);
  assert.equal(r.phase, 'dealer');
  const before = r.dealer.length;
  dealerStep(r);
  assert.equal(r.dealer.length, before);
  assert.equal(r.outcome.result, 'win');
});
test('dealer draws until 17 and cannot be interrupted by player', () => {
  const r = createRound(arranged('K', '2', '8', '3', '4', 'K'));
  hold(r);
  const before = r.player.length;
  takeCard(r);
  assert.equal(r.player.length, before);
  dealerStep(r);
  assert.equal(r.phase, 'dealer');
  dealerStep(r);
  assert.equal(r.phase, 'done');
  assert.equal(score(r.dealer), 19);
  assert.equal(r.outcome.result, 'loss');
});
test('player bust ends immediately', () => {
  const r = createRound(arranged('K', '2', '9', '3', '4'));
  takeCard(r);
  assert.equal(r.phase, 'done');
  assert.equal(r.outcome.reason, 'player-bust');
});
