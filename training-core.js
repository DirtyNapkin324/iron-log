/* Calculations use pounds internally, regardless of display preferences. */
(() => {
  const KG = 0.45359237;
  const labels = { working: 'Working', warmup: 'Warm-up', drop: 'Drop', backoff: 'Back-off' };
  function kind(set) {
    if (Object.hasOwn(labels, set.kind)) return set.kind;
    // Only explicit legacy notes classify an older set. The stored record is untouched.
    if (/^\s*warm[ -]?up\b/i.test(set.notes || '')) return 'warmup';
    if (/^\s*drop set\b/i.test(set.notes || '')) return 'drop';
    return 'working';
  }
  const working = (set) => kind(set) === 'working';
  const failed = (set) => set.failed ?? /\b(?:failed|not completed|very heavy)\b/i.test(set.notes || '');
  const estimate = (set) =>
    set.reps === 1 ? set.weight : set.reps >= 2 && set.reps <= 10 ? set.weight * (1 + set.reps / 30) : null;
  const display = (lb, unit) => (unit === 'kg' ? lb * KG : lb);
  const pounds = (value, unit) => (unit === 'kg' ? value / KG : value);
  const sessionKey = (set) => set.workoutId || set.date + ' ' + set.split;
  const volume = (sets) =>
    unique(sets).reduce((sum, set) => sum + (kind(set) === 'warmup' ? 0 : set.weight * set.reps), 0);
  const unique = (sets) => [...new Map(sets.map((set) => [set.id, set])).values()];

  function warmups(target, increment, equipment, isolation, minimum = 0) {
    if (!(target > 0 && increment > 0)) return [];
    const ratios = isolation
      ? [[0.55, 8]]
      : target >= 135 && /barbell|trap bar|smith/i.test(equipment)
        ? [
            [0.35, 8],
            [0.55, 5],
            [0.75, 3],
            [0.9, 1],
          ]
        : [
            [0.5, 8],
            [0.75, 4],
          ];
    const result = new Map();
    for (const [ratio, reps] of ratios) {
      const weight = Math.max(minimum, minimum + Math.round((target * ratio - minimum) / increment) * increment);
      if (weight > 0 && weight < target && !result.has(weight)) result.set(weight, { weight, reps });
    }
    return [...result.values()];
  }

  function plates(target, bar, inventory) {
    const cents = (value) => Math.round(value * 100);
    const pairs = inventory
      .slice()
      .sort((a, b) => b.weight - a.weight)
      .flatMap((item) => Array(Math.floor(item.quantity / 2)).fill(item.weight));
    const states = new Map([[0, null]]);
    for (const weight of pairs) {
      for (const [sum, previous] of [...states]) {
        const next = sum + cents(weight);
        const count = (previous?.count || 0) + 1;
        if (!states.has(next) || states.get(next).count > count) states.set(next, { weight, previous, count });
      }
    }
    const wanted = cents(target),
      shaft = cents(bar);
    let lower = null,
      upper = null;
    for (const sum of states.keys()) {
      const total = shaft + sum * 2;
      if (total <= wanted && (lower === null || sum > lower)) lower = sum;
      if (total >= wanted && (upper === null || sum < upper)) upper = sum;
    }
    const option = (sum) => {
      if (sum === null) return null;
      const side = [];
      for (let link = states.get(sum); link; link = link.previous) side.push(link.weight);
      return { total: (shaft + sum * 2) / 100, side: side.sort((a, b) => b - a) };
    };
    return { exact: lower !== null && lower === upper, lower: option(lower), upper: option(upper) };
  }

  function records(sets, identity) {
    const best = new Map(),
      markers = new Map(),
      totals = new Map(),
      results = [];
    const sorted = unique(sets)
      .filter((set) => working(set) && set.reps > 0)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const mark = (set, key, label, value) => {
      if (value === null) return;
      const exercise = identity(set);
      const id = JSON.stringify([exercise, key]);
      if ((best.get(id)?.value ?? -Infinity) >= value) return;
      const record = { set, exercise, key, label, value };
      best.set(id, record);
      if (!markers.has(set.id)) markers.set(set.id, []);
      markers.get(set.id).push(label);
      results.push(record);
    };
    for (const set of sorted) {
      mark(set, 'weight', 'Heaviest weight', set.weight);
      mark(set, 'reps-' + set.weight, 'Most reps at weight', set.reps);
      mark(set, 'estimate', 'Estimated 1RM', estimate(set));
      mark(set, 'setVolume', 'Set volume', set.weight * set.reps);
      const key = JSON.stringify([sessionKey(set), identity(set)]);
      totals.set(key, (totals.get(key) || 0) + set.weight * set.reps);
      mark(set, 'sessionVolume', 'Exercise session volume', totals.get(key));
    }
    return { best: [...best.values()], markers, results };
  }

  function muscleVolume(sets, lookup) {
    const groups = new Map();
    function add(muscle, field) {
      if (!groups.has(muscle)) groups.set(muscle, { direct: 0, secondary: 0 });
      groups.get(muscle)[field]++;
    }
    for (const set of unique(sets).filter(working)) {
      const entry = lookup(set);
      const primary = entry?.muscle === 'Other' ? 'Unknown' : entry?.muscle || 'Unknown';
      add(primary, 'direct');
      for (const muscle of new Set(entry?.secondary || [])) if (muscle !== primary) add(muscle, 'secondary');
    }
    return groups;
  }

  function rollingWeight(entries) {
    let head = 0,
      total = 0;
    return entries.map((entry, index) => {
      total += entry.weight;
      const cutoff = Date.parse(entry.date) - 6 * 86400000;
      while (head < index && Date.parse(entries[head].date) < cutoff) total -= entries[head++].weight;
      return [entry.date, total / (index - head + 1)];
    });
  }

  function setSignature(set) {
    return JSON.stringify([
      set.date,
      set.split,
      set.exercise,
      set.weight,
      set.reps,
      set.rir,
      set.notes,
      set.exerciseId || '',
      set.workoutId || '',
      kind(set),
      Boolean(set.failed),
      set.partials || 0,
    ]);
  }

  function mergeRecords(existing, incoming, key, legacyKey) {
    const records = existing.slice(),
      indexed = new Map(records.map((item) => [key(item), item]));
    const legacy = new Set(legacyKey ? records.filter((item) => !key(item)).map(legacyKey) : []);
    const report = { added: 0, skipped: 0, conflicts: 0 };
    function stable(value) {
      if (Array.isArray(value)) return value.map(stable);
      if (value && typeof value === 'object')
        return Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, stable(value[k])]),
        );
      return value;
    }
    for (const item of incoming) {
      const id = key(item);
      const current = id && indexed.get(id);
      if (current) {
        report[JSON.stringify(stable(current)) === JSON.stringify(stable(item)) ? 'skipped' : 'conflicts']++;
      } else if (!id && legacyKey && legacy.has(legacyKey(item))) {
        report.skipped++;
      } else {
        report.added++;
        records.push(item);
        if (id) indexed.set(id, item);
        else if (legacyKey) legacy.add(legacyKey(item));
      }
    }
    return { records, report };
  }

  function normalizeSets(sets) {
    const occurrences = new Map();
    return sets.map((set) => {
      if (set.id) return set;
      const key = setSignature(set);
      const order = (occurrences.get(key) || 0) + 1;
      occurrences.set(key, order);
      return { ...set, id: 'legacy:' + key + ':' + order };
    });
  }

  function mergeSets(existing, incoming) {
    const current = normalizeSets(existing);
    const stable = new Map(current.map((set) => [set.id, set]));
    const fingerprints = new Map();
    for (const set of current) {
      const key = setSignature(set);
      fingerprints.set(key, (fingerprints.get(key) || 0) + 1);
    }
    const legacyCounts = new Map();
    let skipped = 0;
    const candidates = normalizeSets(incoming).filter((set) => {
      if (!set.id.startsWith('legacy:')) return true;
      const key = setSignature(set);
      const count = (legacyCounts.get(key) || 0) + 1;
      legacyCounts.set(key, count);
      if (stable.has(set.id) || count > (fingerprints.get(key) || 0)) return true;
      skipped++;
      return false;
    });
    const result = mergeRecords(current, candidates, (set) => set.id);
    result.report.skipped += skipped;
    return result;
  }

  const api = {
    labels,
    kind,
    working,
    failed,
    estimate,
    display,
    pounds,
    sessionKey,
    volume,
    unique,
    warmups,
    plates,
    records,
    muscleVolume,
    rollingWeight,
    mergeRecords,
    setSignature,
    normalizeSets,
    mergeSets,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.Training = api;
})();
