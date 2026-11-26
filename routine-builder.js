'use strict';

const RoutineBuilder = (() => {
  const library = new Map(ExerciseLibrary.exercises.map((exercise) => [exercise.id, exercise]));
  const exact = new Map(ExerciseLibrary.exercises.map((exercise) => [exercise.name.toLowerCase(), exercise]));
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const uid = (prefix) =>
    prefix +
    '-' +
    (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  const defaultConfig = { count: 3, lo: 6, hi: 10, rest: 120, step: 2.5 };
  const exercise = (state, id) => library.get(id) || state.customExercises.find((item) => item.id === id);
  const builtIn = (id) => ['Push', 'Pull', 'Legs', 'Upper', 'Lower'].includes(id);
  const legacyId = (name) => 'legacy-' + encodeURIComponent(name.trim().toLowerCase());

  function legacyExercise(state, name) {
    const entry = exact.get(name.trim().toLowerCase());
    if (entry) return entry.id;
    const id = legacyId(name);
    if (!exercise(state, id))
      state.customExercises.push({
        id,
        name,
        aliases: [],
        muscle: 'Other',
        secondary: [],
        equipment: 'Other',
        defaults: { ...defaultConfig },
      });
    return id;
  }

  function migrate(defaults, older, previous) {
    const state = previous ? clone(previous) : { version: 1, routines: [], customExercises: [], favorites: [] };
    for (const name of Object.values(defaults).flat()) legacyExercise(state, name);
    const restored = Object.entries(defaults).map(([id, fallback]) => {
      const values = older?.[id];
      const names =
        Array.isArray(values) && values.length && values.every((name) => typeof name === 'string' && name.trim())
          ? values
          : fallback;
      return {
        id,
        name: id,
        archived: false,
        rows: names.map((name, i) => ({
          id: id + '-legacy-' + i,
          exerciseId: legacyExercise(state, name),
          name,
          legacy: true,
        })),
      };
    });
    state.routines = [...restored, ...state.routines.filter((routine) => !builtIn(routine.id))];
    return state;
  }

  function usable(state) {
    return (
      IronCore.validRoutineState(state) &&
      state.routines.every((r) => r.rows.every((row) => exercise(state, row.exerciseId))) &&
      state.favorites.every((id) => exercise(state, id)) &&
      state.customExercises.every((item) => !library.has(item.id)) &&
      ['Push', 'Pull', 'Legs', 'Upper', 'Lower'].every((id) => state.routines.some((r) => r.id === id))
    );
  }

  function identity(set) {
    if (set.exerciseId) return set.exerciseId;
    const name = set.exercise.trim().toLowerCase();
    return exact.get(name)?.id || legacyId(set.exercise);
  }

  function comparable(set, entry) {
    if (set.exerciseId) return set.exerciseId === entry.id;
    // Established name-only logs match their original name; aliases and equipment variants stay separate.
    return (
      !entry.id.startsWith('custom-') && set.exercise.trim().toLowerCase() === entry.name.trim().toLowerCase()
    );
  }

  const templates = {
    'Push (PPL)': ['Bench press', 'Incline Dumbbell Press', 'Shoulder Press', 'Lateral Raise', 'Triceps Pushdown'],
    'Pull (PPL)': ['Lat Pulldown', 'Chest-Supported Row', 'Face Pull', 'Hammer Curl'],
    'Legs (PPL)': ['Barbell Back Squat', 'Romanian Deadlift', 'Leg Extension', 'Calf Raise'],
    Upper: ['Bench press', 'Seated Cable Row', 'Lat Pulldown', 'Shoulder Press', 'Dumbbell Curl'],
    Lower: ['Leg Press', 'Romanian Deadlift', 'Leg Curl', 'Hip Thrust', 'Calf Raise'],
    'Full body': ['Barbell Back Squat', 'Bench press', 'Lat Pulldown', 'Romanian Deadlift', 'Plank'],
    'Chest and back': ['Bench press', 'Incline Dumbbell Press', 'Pull-Up', 'Seated Cable Row', 'Cable Fly'],
    'Shoulders and arms': ['Shoulder Press', 'Lateral Raise', 'Rear Delt Fly', 'Dumbbell Curl', 'Rope Pushdown'],
    'Bodybuilding legs': ['Hack Squat', 'Seated Leg Curl', 'Leg Extension', 'Hip Thrust', 'Seated Calf Raise'],
  };

  return {
    library,
    clone,
    uid,
    exercise,
    migrate,
    usable,
    builtIn,
    identity,
    comparable,
    legacyId,
    exact,
    templates,
    defaultConfig,
  };
})();
