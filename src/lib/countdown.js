// The loyalty rule: every PIZZAS_FOR_FREE paid pizzas earns one free pizza
// (buy 9, the 10th is free). Counts are never capped, so buying several pizzas
// in one order can't lose credit: extra pizzas simply carry toward the next
// free one.

const PIZZAS_FOR_FREE = 9;

function summarize(card) {
  const paid = card.paidPizzas || 0;
  const freeRedeemed = card.freeRedeemed || 0;
  const freeEarned = Math.floor(paid / PIZZAS_FOR_FREE);
  const freeAvailable = Math.max(0, freeEarned - freeRedeemed);
  const towardNext = paid % PIZZAS_FOR_FREE;

  return {
    paidPizzas: paid,
    freeEarned,
    freeRedeemed,
    freeAvailable,
    towardNext, // punches already toward the next free pizza (0-8)
    pizzasUntilFree: freeAvailable > 0 ? 0 : PIZZAS_FOR_FREE - towardNext,
    pizzasForFree: PIZZAS_FOR_FREE,
  };
}

module.exports = { PIZZAS_FOR_FREE, summarize };
