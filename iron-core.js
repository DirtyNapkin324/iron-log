/* Shared backup validation and calendar logic for the app and regression tests. */
(function (root) {
  'use strict';

  const keys = {
    workout: 'iron-log-coach-v3',
    routines: 'iron-log-routines-v1',
    exerciseConfig: 'iron-log-exercise-config-v1',
    routineState: 'iron-log-routine-builder-v1'
  };
  const routineNames = ['Push', 'Pull', 'Legs', 'Upper', 'Lower'];
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string';
  const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const integer = (value, min, max) => Number.isInteger(value) && number(value, min, max);

  const identifier = value => text(value) && value.trim().length > 0;
  const strings = values => Array.isArray(values) && values.every(text);
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
          (row.legacy === undefined || typeof row.legacy === 'boolean') &&
          (row.config === undefined || validPrescription(row.config))) &&
        distinct(r.rows.map(row => row.id))) &&
      distinct(state.routines.map(r => r.id));
  }

  function backupParts(payload) {
    if (!record(payload) || !Array.isArray(payload.sets) || !Array.isArray(payload.body) ||
        !payload.sets.every(s => record(s) && [s.id, s.date, s.split, s.exercise, s.rir, s.notes].every(text) &&
          number(s.weight, 0, Infinity) && integer(s.reps, 1, Infinity)) ||
        !payload.body.every(b => record(b) && text(b.date) && Number.isFinite(b.weight) && b.weight > 0)) {
      throw new Error('Invalid workout backup.');
    }
    const { routines, exerciseConfig, routineState, ...workout } = payload;
    if (routines !== undefined && (!record(routines) || !Object.entries(routines).every(([key, names]) =>
        routineNames.includes(key) && Array.isArray(names) && names.length > 0 &&
        names.every(n => text(n) && n.trim())))) throw new Error('Invalid routines in backup.');
    if (exerciseConfig !== undefined && (!record(exerciseConfig) || !Object.values(exerciseConfig).every(c =>
        record(c) && integer(c.count, 1, 10) && integer(c.lo, 1, 30) && integer(c.hi, c.lo, 30) &&
        number(c.step, 0.5, 50) && integer(c.rest, 15, 600)))) {
      throw new Error('Invalid exercise settings in backup.');
    }
    if (routineState !== undefined && !validRoutineState(routineState)) throw new Error('Invalid routine builder data.');
    return { workout, routines, exerciseConfig, routineState };
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
