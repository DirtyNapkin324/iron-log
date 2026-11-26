const assert = require('node:assert/strict');
const test = require('node:test');
const { backupParts, writeBackup, keys, localDay, shiftDay, streaks } = require('../iron-core');

const workout = {
  sets: [{ id: '1', date: '2026-02-28', split: 'Push', exercise: 'Bench press', weight: 100, reps: 5, rir: '', notes: 'kept' }],
  body: [{ date: '2026-02-28', weight: 165, notes: 'also kept' }]
};
const routines = { Push: ['Bench press', 'Weighted dips'] };
const exerciseConfig = { 'bench press': { count: 4, lo: 5, hi: 8, step: 2.5, rest: 150 } };
const settings = { routines, exerciseConfig };

function storage(initial = {}, failKey) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      if (key === failKey) throw new Error('Storage full');
      values.set(key, value);
    },
    removeItem: key => values.delete(key)
  };
}

test('backup round-trips workouts, routines, settings and additional workout metadata', () => {
  const parts = backupParts({ ...workout, ...settings, preference: true });
  const target = storage();
  writeBackup(target, parts);
  assert.deepEqual(JSON.parse(target.getItem(keys.workout)), { ...workout, preference: true });
  assert.deepEqual(JSON.parse(target.getItem(keys.routines)), routines);
  assert.deepEqual(JSON.parse(target.getItem(keys.exerciseConfig)), exerciseConfig);
});

test('a legacy backup preserves existing routines and exercise settings', () => {
  const target = storage({ [keys.routines]: 'original routines', [keys.exerciseConfig]: 'original settings' });
  writeBackup(target, backupParts(workout));
  assert.equal(target.getItem(keys.routines), 'original routines');
  assert.equal(target.getItem(keys.exerciseConfig), 'original settings');
});

test('null or malformed settings and entries fail validation before writes', () => {
  for (const bad of [
    null, { ...workout, sets: [null] }, { ...workout, body: [null] }, { ...workout, routines: null },
    { ...workout, routines: { Push: [] } }, { ...workout, exerciseConfig: { Press: { count: 2 } } }
  ]) assert.throws(() => backupParts(bad), /Invalid/);
});

test('failed multi-key restore puts earlier keys back', () => {
  const target = storage({ [keys.workout]: 'original' }, keys.exerciseConfig);
  assert.throws(() => writeBackup(target, backupParts({ ...workout, ...settings })), /Storage full/);
  assert.equal(target.getItem(keys.workout), 'original');
  assert.equal(target.getItem(keys.routines), null);
});

test('local dates are numeric and date arithmetic crosses DST, year and leap boundaries', () => {
  assert.equal(localDay(new Date(2026, 2, 8, 0, 10)), '2026-03-08');
  assert.equal(shiftDay('2026-03-08', 1), '2026-03-09');
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDay('2028-03-01', -1), '2028-02-29');
});

test('streaks use the recorded goal and continue through yesterday until today ends', () => {
  const history = [
    { day: '2026-03-05', oz: '60', goal_oz: '80' },
    { day: '2026-03-04', oz: '72', goal_oz: '72' },
    { day: '2026-03-03', oz: '80', goal_oz: '80' },
    { day: '2026-03-01', oz: '64', goal_oz: '64' }
  ];
  assert.deepEqual(streaks(history, '2026-03-05'), { current: 2, longest: 2 });
  assert.deepEqual(streaks(history, '2026-03-06'), { current: 0, longest: 2 });
  assert.deepEqual(streaks([], '2026-03-06'), { current: 0, longest: 0 });
});

test('the offline library has stable, unique exercises and valid defaults', () => {
  const { exercises, equipment } = require('../exercise-library');
  const { validPrescription } = require('../iron-core');
  assert.ok(exercises.length >= 200);
  assert.equal(new Set(exercises.map(item => item.id)).size, exercises.length);
  for (const item of exercises) {
    assert.match(item.id, /^lift-[a-z0-9-]+$/);
    assert.ok(item.name && item.muscle && equipment.includes(item.equipment));
    assert.ok(Array.isArray(item.aliases) && Array.isArray(item.secondary));
    assert.ok(validPrescription(item.defaults), item.name);
  }
  assert.notEqual(exercises.find(item => item.name === 'Bench press').id,
    exercises.find(item => item.name === 'Smith Machine Bench Press').id);
});

test('builder backups round-trip prescriptions, favorites, custom exercises and archived routines', () => {
  const defaults = { count: 2, lo: 8, hi: 12, rest: 90, step: 2.5 };
  const routineState = {
    version: 1,
    customExercises: [{ id: 'custom-example', name: 'Gym A press', muscle: 'Chest',
      equipment: 'Machine', aliases: ['Gym A'], secondary: ['Triceps'], defaults }],
    favorites: ['custom-example'],
    routines: [{ id: 'routine-example', name: 'Weekend', archived: true, rows: [
      { id: 'row-one', exerciseId: 'custom-example', config: { ...defaults, rir: 3, instructions: 'Pause briefly.' } }
    ] }]
  };
  const target = storage();
  const parts = backupParts({ ...workout, routineState });
  writeBackup(target, parts);
  assert.deepEqual(JSON.parse(target.getItem(keys.routineState)), routineState);
  writeBackup(target, backupParts(workout));
  assert.deepEqual(JSON.parse(target.getItem(keys.routineState)), routineState);
  routineState.routines[0].rows[0].config.rir = 6;
  assert.throws(() => backupParts({ ...workout, routineState }), /Invalid routine builder/);
});
