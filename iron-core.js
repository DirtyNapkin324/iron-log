/* Shared backup validation and calendar logic for the app and regression tests. */
(function (root) {
  'use strict';

  const keys = {
    workout: 'iron-log-coach-v3',
    routines: 'iron-log-routines-v1',
    exerciseConfig: 'iron-log-exercise-config-v1',
    routineState: 'iron-log-routine-builder-v1',
    activeSession: 'iron-log-active-v1'
  };
  const routineNames = ['Push', 'Pull', 'Legs', 'Upper', 'Lower'];
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string';
  const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const integer = (value, min, max) => Number.isInteger(value) && number(value, min, max);

  const identifier = value => text(value) && value.trim().length > 0;
  const strings = values => Array.isArray(values) && values.every(text);
  const date = value => {
    if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + 'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  const distinct = values => new Set(values).size === values.length;
  function validPrescription(c) {
    return record(c) && integer(c.count, 1, 10) && integer(c.lo, 1, 30) && integer(c.hi, c.lo, 30) &&
      number(c.step, 0.5, 50) && integer(c.rest, 15, 600) &&
      (c.rir === undefined || integer(c.rir, 0, 5)) &&
      (c.instructions === undefined || (text(c.instructions) && c.instructions.length <= 500));
  }
  function validRoutineState(state) {
    return record(state) && state.version === 1 && Array.isArray(state.routines) &&
      Array.isArray(state.customExercises) && strings(state.favorites) && distinct(state.favorites) &&
      state.customExercises.every(e => record(e) && identifier(e.id) && identifier(e.name) &&
        strings(e.aliases) && identifier(e.muscle) && strings(e.secondary) && identifier(e.equipment) &&
        validPrescription(e.defaults)) &&
      distinct(state.customExercises.map(e => e.id)) &&
      state.routines.every(r => record(r) && identifier(r.id) && identifier(r.name) &&
        typeof r.archived === 'boolean' && Array.isArray(r.rows) && r.rows.length > 0 &&
        r.rows.every(row => record(row) && identifier(row.id) && identifier(row.exerciseId) &&
          (row.name === undefined || identifier(row.name)) &&
          (row.superset === undefined || typeof row.superset === 'boolean') &&
          (row.legacy === undefined || typeof row.legacy === 'boolean') &&
          (row.config === undefined || validPrescription(row.config))) &&
        distinct(r.rows.map(row => row.id))) &&
      distinct(state.routines.map(r => r.id));
  }

  function validTraining(p) {
    return record(p) && (p.unit === undefined || ['lb', 'kg'].includes(p.unit)) &&
      ['autoRest', 'restSound', 'restVibration'].every(k => p[k] === undefined || typeof p[k] === 'boolean') &&
      (p.bodyGoal === undefined || p.bodyGoal === null || number(p.bodyGoal, 1, 1500)) &&
      (p.exerciseNotes === undefined || (record(p.exerciseNotes) &&
        Object.values(p.exerciseNotes).every(note => text(note) && note.length <= 2000))) &&
      (p.plates === undefined || (record(p.plates) && Object.entries(p.plates).every(([unit, plate]) =>
        ['lb', 'kg'].includes(unit) && record(plate) && number(plate.bar, 0, 100) &&
        Array.isArray(plate.inventory) && plate.inventory.length <= 8 &&
        plate.inventory.every(item => record(item) && number(item.weight, .01, 100) && integer(item.quantity, 0, 20)) &&
        distinct(plate.inventory.map(item => item.weight)))));
  }

  function validActiveSession(w) {
    if (w === null) return true;
    if (!(record(w) && date(w.date) && identifier(w.split) &&
      number(w.started, 0, 8640000000000000) &&
      (w.id === undefined || identifier(w.id)) &&
      (w.name === undefined || identifier(w.name)) &&
      (w.notes === undefined || (text(w.notes) && w.notes.length <= 2000)))) return false;
    if (w.rows !== undefined && (!Array.isArray(w.rows) || !w.rows.every(row => record(row) && identifier(row.id) &&
      identifier(row.exerciseId) && (row.name === undefined || identifier(row.name)) &&
      (row.config === undefined || validPrescription(row.config)) &&
      (row.superset === undefined || typeof row.superset === 'boolean')) ||
      !distinct(w.rows.map(row => row.id)))) return false;
    if (w.customExercises !== undefined && !validRoutineState({ version: 1, routines: [], favorites: [],
      customExercises: w.customExercises })) return false;
    if (w.extra !== undefined && (!record(w.extra) || !Object.values(w.extra).every(count => integer(count, 1, 1000)))) return false;
    if (w.drafts !== undefined && (!record(w.drafts) || !Object.values(w.drafts).every(draft => record(draft) &&
      (draft.weight === undefined || draft.weight === null || number(draft.weight, 0, Infinity)) &&
      ['reps','rir','notes','partialReps'].every(k => draft[k] === undefined || text(draft[k])) &&
      (draft.setKind === undefined || ['working','warmup','backoff','drop'].includes(draft.setKind)) &&
      (draft.failedSet === undefined || typeof draft.failedSet === 'boolean')))) return false;
    return true;
  }

  function backupParts(payload) {
    if (!record(payload) || !Array.isArray(payload.sets) || !Array.isArray(payload.body) ||
        !payload.sets.every(s => record(s) && date(s.date) && [s.split, s.exercise, s.rir, s.notes].every(text) &&
          (s.id === undefined || text(s.id)) &&
          number(s.weight, 0, Infinity) && integer(s.reps, s.partials > 0 ? 0 : 1, Infinity) &&
          (s.partials === undefined || integer(s.partials, 0, 1000)) &&
          (s.failed === undefined || typeof s.failed === 'boolean') &&
          (s.kind === undefined || ['working', 'warmup', 'drop', 'backoff'].includes(s.kind)) &&
          ['exerciseId','routineRowId','workoutId'].every(k => s[k] === undefined || identifier(s[k]))) ||
        !payload.body.every(b => record(b) && date(b.date) && Number.isFinite(b.weight) && b.weight > 0)) {
      throw new Error('Invalid workout backup.');
    }
    if (payload.training !== undefined && !validTraining(payload.training)) throw new Error('Invalid training preferences.');
    if (payload.workouts !== undefined && (!Array.isArray(payload.workouts) ||
        !payload.workouts.every(w => record(w) && date(w.date) && [w.id, w.split, w.name].every(identifier) &&
          text(w.notes) && number(w.started, 0, 8640000000000000) && number(w.finished, w.started, 8640000000000000)) ||
        !distinct(payload.workouts.map(w => w.id)))) throw new Error('Invalid workout sessions.');
    const { routines, exerciseConfig, routineState, activeSession, ...workout } = payload;
    if (routines !== undefined && (!record(routines) || !Object.entries(routines).every(([key, names]) =>
        routineNames.includes(key) && Array.isArray(names) && names.length > 0 &&
        names.every(n => text(n) && n.trim())))) throw new Error('Invalid routines in backup.');
    if (exerciseConfig !== undefined && (!record(exerciseConfig) || !Object.values(exerciseConfig).every(c =>
        record(c) && integer(c.count, 1, 10) && integer(c.lo, 1, 30) && integer(c.hi, c.lo, 30) &&
        number(c.step, 0.5, 50) && integer(c.rest, 15, 600)))) {
      throw new Error('Invalid exercise settings in backup.');
    }
    if (routineState !== undefined && !validRoutineState(routineState)) throw new Error('Invalid routine builder data.');
    if (activeSession !== undefined && !validActiveSession(activeSession)) throw new Error('Invalid active workout.');
    return { workout, routines, exerciseConfig, routineState, activeSession };
  }

  function writeBackup(storage, parts) {
    const writes = Object.keys(keys).filter(k => parts[k] !== undefined)
      .map(k => [keys[k], JSON.stringify(parts[k]), storage.getItem(keys[k])]);
    let written = 0;
    try {
      for (const [key, value] of writes) {
        storage.setItem(key, value);
        written++;
      }
    } catch (error) {
      for (const [key, , previous] of writes.slice(0, written).reverse()) {
        if (previous === null) storage.removeItem(key);
        else storage.setItem(key, previous);
      }
      throw error;
    }
  }

  function localDay(date = new Date()) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')].join('-');
  }

  function shiftDay(day, amount) {
    const date = new Date(day + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }

  function streaks(history, today) {
    let longest = 0, chain = 0, last = null;
    for (const row of [...history].reverse()) {
      if (row.day > today || Number(row.oz) < Number(row.goal_oz)) continue;
      chain = last && shiftDay(last, 1) === row.day ? chain + 1 : 1;
      last = row.day;
      longest = Math.max(longest, chain);
    }
    return { current: last === today || last === shiftDay(today, -1) ? chain : 0, longest };
  }

  const api = { keys, backupParts, writeBackup, localDay, shiftDay, streaks, validPrescription, validRoutineState };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IronCore = api;
})(globalThis);
