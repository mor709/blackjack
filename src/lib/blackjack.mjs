export function score(hand) {
  let total = 0,
    aces = 0;
  for (const card of hand) {
    total += card.rank === 'A' ? 11 : ['J', 'Q', 'K'].includes(card.rank) ? 10 : Number(card.rank);
    if (card.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}
export const natural = (hand) => hand.length === 2 && score(hand) === 21;
export function createDeck() {
  const deck = ['♠', '♥', '♣', '♦'].flatMap((suit) =>
    ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].map((rank) => ({
      rank,
      suit,
    })),
  );
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
export function settlement(player, dealer) {
  const p = score(player),
    d = score(dealer);
  if (p > 21) return { result: 'loss', reason: 'player-bust' };
  if (natural(player) && natural(dealer)) return { result: 'push', reason: 'both-natural' };
  if (natural(player)) return { result: 'blackjack', reason: 'player-natural' };
  if (natural(dealer)) return { result: 'loss', reason: 'dealer-natural' };
  if (d > 21) return { result: 'win', reason: 'dealer-bust' };
  return { result: p > d ? 'win' : p === d ? 'push' : 'loss', reason: 'points' };
}
// Pure round state. Presentation and animation never determine the winner.
export function createRound(deck = createDeck()) {
  const shoe = [...deck];
  const player = [shoe.pop()],
    dealer = [shoe.pop()];
  player.push(shoe.pop());
  dealer.push(shoe.pop());
  const round = { player, dealer, shoe, phase: 'player', outcome: null };
  if (natural(player) || natural(dealer)) resolveRound(round);
  return round;
}
function resolveRound(round) {
  round.outcome = settlement(round.player, round.dealer);
  round.phase = 'done';
}
export function takeCard(round) {
  if (round.phase !== 'player') return;
  round.player.push(round.shoe.pop());
  if (score(round.player) > 21) resolveRound(round);
  else if (score(round.player) === 21) round.phase = 'dealer';
}
export function hold(round) {
  if (round.phase === 'player') round.phase = 'dealer';
}
export function dealerStep(round) {
  if (round.phase !== 'dealer') return;
  if (score(round.dealer) < 17) round.dealer.push(round.shoe.pop());
  if (score(round.dealer) >= 17) resolveRound(round);
}
