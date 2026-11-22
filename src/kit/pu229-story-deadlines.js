/* Story clocks share the fixed simulation tick and keep pause accounting in checkpoints. */
(function (K) {
  const W = K.world, { equal, record } = W.data;
  const open = status => ['available', 'active', 'suspended'].includes(status);
  const inRange = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
  const keys = (value, expected) => record(value) && equal(Object.keys(value).sort(), expected);
  const reasons = Object.freeze({ world: 'world-deadline', offer: 'offer-timeout', work: 'work-timeout' });

  function compile({ deadlines, offerFor }, dt) {
    if (deadlines === undefined && offerFor === undefined) return null;
    const ticks = value => value === undefined ? undefined : Math.max(1, W.storyTriggers.ticks(
      value, dt, Math.ceil, 'Story deadline exceeds the world tick budget'));
    return { tracked: deadlines !== undefined, world: ticks(deadlines?.world?.at),
      offer: ticks(deadlines?.offer?.for ?? offerFor), work: ticks(deadlines?.work?.for) };
  }

  function transition(plan, previous, from, to, tick) {
    if (!plan?.tracked) return undefined;
    if (from === null) return {
      ...(plan.world !== undefined && { world: { dueTick: plan.world } }),
      ...(plan.offer !== undefined && { offer: { budgetTicks: plan.offer, offeredAt: to === 'available' ? tick : null, closedAt: null } }),
      ...(plan.work !== undefined && { work: { budgetTicks: plan.work, spentTicks: 0 } })
    };
    if (from === 'available' && previous.offer) return { ...previous, offer: { ...previous.offer, closedAt: tick } };
    return previous;
  }

  function due(plan, row, status, tick) {
    if (plan.world !== undefined && tick >= plan.world) return { clock: 'world', dueTick: plan.world };
    if (status === 'available' && plan.offer !== undefined) {
      const offeredAt = row.deadlines?.offer?.offeredAt ?? row.transitions.at(-1).tick;
      const dueTick = offeredAt + plan.offer;
      if (tick >= dueTick) return { clock: 'offer', offeredAt, dueTick };
    }
    if (status === 'active' && plan.work !== undefined) {
      const { budgetTicks, spentTicks } = row.deadlines.work;
      if (spentTicks >= budgetTicks) return { clock: 'work', budgetTicks, spentTicks };
    }
    return null;
  }

  function advance(plan, row, status, tick) {
    if (!plan || (status !== null && !open(status))) return { row };
    if (status === 'active' && plan.work !== undefined) {
      const { deadlines } = row;
      const work = { ...deadlines.work, spentTicks: deadlines.work.spentTicks + 1 };
      row = { ...row, deadlines: { ...deadlines, work } };
    }
    const receipt = due(plan, row, status, tick);
    return receipt ? { row, expired: { reason: reasons[receipt.clock], ...(plan.tracked && { receipt }) } } : { row };
  }

  function valid(plan, row, tick) {
    if (row === null) return plan?.world === undefined || tick < plan.world;
    const { transitions, deadlines, dropped } = row, end = transitions.at(-1);
    if (!plan?.tracked) return deadlines === undefined && transitions.every(change => change.deadline === undefined);
    const first = transitions[0], unseenOffer = first.from === null && first.to === 'expired';
    const lastTick = open(end.to) ? tick : end.tick;
    const clocks = ['offer', 'work', 'world'].filter(clock => plan[clock] !== undefined);
    if (!keys(deadlines, clocks) || transitions.slice(0, -1).some(change => change.deadline !== undefined)) return false;
    if (plan.world !== undefined && !equal(deadlines.world, { dueTick: plan.world })) return false;
    if (plan.offer !== undefined) {
      const offer = deadlines.offer;
      if (!keys(offer, ['budgetTicks', 'closedAt', 'offeredAt']) || offer.budgetTicks !== plan.offer) return false;
      const { offeredAt, closedAt } = offer;
      if (unseenOffer) {
        if (offeredAt !== null || closedAt !== null) return false;
      } else {
        if (!inRange(offeredAt, 1, first.tick) || (!dropped && offeredAt !== first.tick)) return false;
        const departure = transitions.find(change => change.from === 'available');
        if (end.to === 'available' ? closedAt !== null :
          !inRange(closedAt, offeredAt, departure?.tick ?? first.tick) || (departure && closedAt !== departure.tick)) return false;
        const dueTick = offeredAt + plan.offer;
        if (closedAt > dueTick || (closedAt === dueTick && (end.to !== 'expired' || end.tick !== closedAt))) return false;
      }
    }
    if (plan.work !== undefined) {
      const work = deadlines.work;
      const retained = transitions.reduce((used, change, i) =>
        change.to === 'active' ? used + (transitions[i + 1]?.tick ?? lastTick) - change.tick : used, 0);
      const possible = retained + (dropped ? first.tick - 1 : 0);
      if (!keys(work, ['budgetTicks', 'spentTicks']) || work.budgetTicks !== plan.work ||
        !inRange(work.spentTicks, retained, Math.min(possible, work.budgetTicks))) return false;
    }
    const expiry = due(plan, row, open(end.to) ? end.to : end.from, lastTick);
    if (plan.work !== undefined && deadlines.work.spentTicks === plan.work &&
      (end.from !== 'active' || !['world', 'work'].includes(expiry?.clock))) return false;
    if (!expiry) return end.deadline === undefined;
    return end.to === 'expired' && end.reason === reasons[expiry.clock] && equal(end.deadline, expiry) &&
      (expiry.dueTick === undefined || lastTick === expiry.dueTick);
  }

  function inspect(deadlines, end, tick) {
    const { to, deadline } = end, live = open(to), now = live ? tick : end.tick;
    const { world, offer, work } = deadlines;
    return {
      ...(world && { world: { ...world, remainingTicks: Math.max(0, world.dueTick - now),
        status: deadline?.clock === 'world' ? 'expired' : live ? 'running' : 'closed' } }),
      ...(offer && { offer: { ...offer, ...(offer.offeredAt !== null && { dueTick: offer.offeredAt + offer.budgetTicks }),
        remainingTicks: offer.offeredAt === null ? null : Math.max(0, offer.offeredAt + offer.budgetTicks - (offer.closedAt ?? now)),
        status: deadline?.clock === 'offer' ? 'expired' : to === 'available' ? 'running' : 'closed' } }),
      ...(work && { work: { ...work, remainingTicks: work.budgetTicks - work.spentTicks,
        status: deadline?.clock === 'work' ? 'expired' : to === 'active' ? 'running' :
          to === 'suspended' ? 'paused' : to === 'available' ? 'waiting' : 'closed' } })
    };
  }

  W.storyDeadlines = Object.freeze({ compile, transition, advance, valid, inspect });
})(KIT);
