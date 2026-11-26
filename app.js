'use strict';

const $ = (id) => document.getElementById(id);
const key = 'iron-log-coach-v3';
const routinesKey = 'iron-log-routines-v1';
const configKey = 'iron-log-exercise-config-v1';
const activeKey = 'iron-log-active-v1';
const today = IronCore.localDay;
const norm = (text) => text.trim().toLowerCase();
const el = (tag, text = '', className = '') => {
  const item = document.createElement(tag);
  item.textContent = text;
  if (className) item.className = className;
  return item;
};
const number = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const stamp = (date) => new Date(date + 'T12:00:00');
const displayDate = (date, options = { month: 'short', day: 'numeric', year: 'numeric' }) =>
  stamp(date).toLocaleDateString(undefined, options);
const isIsolation = (n) => /curl|raise|fly|pec deck|pushdown|extension|calf/i.test(n);
const isWorking = Training.working;
const splitName = (split) =>
  split === 'Fitness assignment' ? 'Separate workout' : routineById(split)?.name || split;
const sessionSets = (date = $('date').value, split = $('split').value) =>
  data.sets.filter(
    (set) =>
      set.date === date &&
      set.split === split &&
      (active?.date === date && active.split === split
        ? active.id
          ? set.workoutId === active.id
          : !set.workoutId
        : true),
  );
const regular = () => data.sets.filter((set) => set.split !== 'Fitness assignment');
const volume = Training.volume;
const exerciseCount = (sets) => new Set(sets.map(exerciseIdentity)).size;
const est = (set) => (isWorking(set) ? Training.estimate(set) : null);
const weightUnit = () => data.training?.unit || 'lb';
const shownWeight = (value) => number(Training.display(value, weightUnit())) + ' ' + weightUnit();
const weightInput = (value) =>
  value == null ? '' : String(Number(Training.display(value, weightUnit()).toFixed(3)));
const inputPounds = (value) => Number(Training.pounds(Number(value), weightUnit()).toFixed(8));
function setPreference(name, value) {
  data.training = { ...data.training, [name]: value };
  persistData();
}
const planCount = (row) =>
  active?.extra && Object.hasOwn(active.extra, row.id) ? active.extra[row.id] : rowSettings(row).count;
let undoItem = null;
let calendarDay = '';

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

let data = read(key, {});
if (!Array.isArray(data.sets) || !Array.isArray(data.body)) data = { sets: [], body: [] };
data.workouts ||= [];
data.sets = Training.normalizeSets(data.sets);
const defaultPlans = {
  Push: [
    'Bench press',
    'Incline Dumbbell Press',
    'Shoulder Press',
    'Cable Fly',
    'Lateral Raise',
    'Triceps Pushdown',
  ],
  Pull: [
    'Lat Pulldown',
    'Chest-Supported Row',
    'Seated Cable Row',
    'Rear Delt Fly',
    'Dumbbell Curl',
    'Hammer Curl',
  ],
  Legs: ['Leg Press', 'Leg Curl', 'Leg Extension', 'Calf Raise'],
  Upper: [
    'Bench press',
    'Seated Cable Row',
    'Shoulder Press',
    'Lat Pulldown (machine not confirmed)',
    'Dumbbell Curl',
    'Triceps Pushdown',
  ],
  Lower: ['Leg Press', 'Hip Thrust', 'Leg Curl', 'Calf Raise'],
};
const builderKey = IronCore.keys.routineState;
const storedBuilder = read(builderKey, null);
let routineState = RoutineBuilder.usable(storedBuilder)
  ? storedBuilder
  : RoutineBuilder.migrate(defaultPlans, read(routinesKey, {}));
const routineById = (id) => routineState.routines.find((routine) => routine.id === id);
const exerciseIdentity = (set) => RoutineBuilder.identity(set);
function rowExercise(row) {
  if (!row) return null;
  const entry =
    RoutineBuilder.exercise(routineState, row.exerciseId) ||
    active?.customExercises?.find((item) => item.id === row.exerciseId);
  return entry && (row.name ? { ...entry, name: row.name } : entry);
}
let selectedRow = null;

function persistRoutines(next, message) {
  if (!RoutineBuilder.usable(next)) {
    toast('Could not save invalid routine data.');
    return false;
  }
  try {
    localStorage.setItem(builderKey, JSON.stringify(next));
  } catch {
    toast('Browser storage is unavailable.');
    return false;
  }
  routineState = next;
  if (message) toast(message);
  window.dispatchEvent(new Event('ironlog:saved'));
  return true;
}
let exerciseConfig = Object.assign(Object.create(null), read(configKey, {}));
let active = read(activeKey, null);
let editing = null;
let repeatOrigin = null;
let manual = false;
let lastSubmitAt = 0;
let lastSubmitKey = '';
let toastTimer;
let page = 'workout';
const pages = {
  workout: 'Train',
  history: 'History',
  progress: 'Progress',
  body: 'Body',
  social: 'Hydration',
  settings: 'Profile',
};

function status(id, message) {
  $(id).textContent = message;
  $(id).hidden = !message;
}
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  toastTimer = setTimeout(() => {
    $('toast').textContent = '';
  }, 3200);
}

function showDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}
function confirmAction(message, action = 'Continue', title = 'Confirm action', onConfirmed) {
  const dialog = $('confirmation');
  if (dialog.open) return Promise.resolve(false);
  if (!dialog.showModal) {
    const confirmed = window.confirm(message);
    if (confirmed) onConfirmed?.();
    return Promise.resolve(confirmed);
  }
  $('confirmTitle').textContent = title;
  $('confirmMessage').textContent = message;
  $('confirmAction').textContent = action;
  dialog.returnValue = '';
  return new Promise((resolve) => {
    const form = dialog.querySelector('form');
    function commit(event) {
      if (event.submitter?.value !== 'confirm') return;
      event.preventDefault();
      dialog.close('confirm');
      onConfirmed();
    }
    if (onConfirmed) form.addEventListener('submit', commit);
    dialog.addEventListener(
      'close',
      () => {
        form.removeEventListener('submit', commit);
        resolve(dialog.returnValue === 'confirm');
      },
      { once: true },
    );
    showDialog(dialog);
  });
}

function tab(name) {
  if (!pages[name]) return;
  page = name;
  $('pageLabel').textContent = pages[name];
  for (const section of document.querySelectorAll('[data-page]')) section.hidden = section.dataset.page !== name;
  for (const button of document.querySelectorAll('[data-tab]')) {
    const selected = button.dataset.tab === name;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('pageLabel').focus({ preventScroll: true });
  window.scrollTo(0, 0);
  drawVisibleCharts();
  window.dispatchEvent(new Event('ironlog:tab'));
}
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => tab(button.dataset.tab);

function persistData(message) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    status('status', '');
    if (message) toast(message);
  } catch {
    status('status', 'Browser storage is full or unavailable. Export a backup in Profile.');
    toast('Storage unavailable. Export a backup in Profile.');
  }
  render();
  window.dispatchEvent(new Event('ironlog:saved'));
}

function suggestions() {
  const names = new Set([
    ...workoutRows()
      .map((row) => rowExercise(row)?.name)
      .filter(Boolean),
    ...data.sets.map((set) => set.exercise),
  ]);
  $('exercises').replaceChildren(
    ...Array.from(names, (name) => {
      const option = el('option');
      option.value = name;
      return option;
    }),
  );
}

function prescription(n, history, current, override) {
  let bench = n === 'bench press',
    iso = isIsolation(n) || /pullover|face pull|press-around|skull crusher/.test(n),
    face = n.includes('face pull'),
    larsen = n === 'larsen press';
  let lo = bench ? 4 : larsen ? 6 : face ? 12 : iso ? 8 : 6,
    hi = bench ? 6 : larsen ? 10 : face ? 15 : iso ? 12 : 10;
  if (n.includes('y-raise')) {
    lo = 10;
    hi = 15;
  }
  if (n.includes('partials')) {
    lo = 8;
    hi = 8;
  }
  let count = bench ? 3 : face ? 1 : /larsen|press-around|pullover|triceps press/.test(n) ? 2 : 3;
  let step = bench || larsen ? 5 : /dumbbell/.test(n) ? 5 : /omni chest|hammer strength/.test(n) ? 10 : 2.5;
  const cfg = override ?? exerciseConfig[norm(n)];
  if (cfg) {
    count = cfg.count;
    lo = cfg.lo;
    hi = cfg.hi;
    step = cfg.step;
  }
  let rest = cfg?.rest ?? (iso ? 105 : 180);
  const valid = (s) => isWorking(s) && s.weight > 0 && s.reps > 0;
  const prior = Training.unique(history).filter(valid),
    done = current.filter(valid);
  const sessions = new Map();
  for (const set of prior) {
    const key = Training.sessionKey(set);
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key).push(set);
  }
  const recentSessions = [...sessions.values()].slice(-3);
  const last = recentSessions.at(-1) || [];
  const idx = done.length,
    prev = last[Math.min(idx, last.length - 1)];
  let result = {
    count,
    lo,
    hi,
    step,
    rest,
    rir: cfg?.rir,
    instructions: cfg?.instructions,
    weight: null,
    reps: lo,
    why: 'No comparable history. Choose a comfortable starting load and leave 2–3 reps in reserve.',
  };
  if (!prev) {
    let recent = done.at(-1);
    if (recent) {
      result.weight = recent.weight;
      result.reps = Math.max(lo, Math.min(hi, recent.reps));
      result.why = 'Repeat today’s baseline load with good form.';
    }
    return result;
  }
  let allReady =
    last.length >= count &&
    last.every(
      (s) =>
        s.reps >= hi &&
        s.rir !== '' &&
        s.rir != null &&
        Number.parseInt(s.rir) >= (cfg?.rir ?? 1) &&
        !Training.failed(s),
    );
  let unknown = prev.rir === '' || prev.rir == null,
    failed = Training.failed(prev) || (!unknown && Number(prev.rir) === 0);
  result.weight = prev.weight;
  result.reps = Math.max(lo, Math.min(hi, prev.reps));
  if (n.includes('machine not confirmed')) {
    result.why =
      'Machine unconfirmed: use this only if it is the same machine; otherwise establish a new baseline.';
    return result;
  }
  const priorSession = recentSessions.at(-2);
  const setback = priorSession?.some(
    (set) => set.weight >= prev.weight && (set.reps < lo || Training.failed(set)),
  );
  if (allReady && setback) {
    result.why = 'Repeat this load to confirm that the improvement holds.';
  } else if (allReady && hi > lo && !n.includes('face pull')) {
    result.weight = Math.round((prev.weight + step) * 100) / 100;
    result.reps = lo;
    result.why =
      'All prescribed sets reached the top of the range with at least ' +
      (cfg?.rir ?? 1) +
      ' RIR. Increase load if that increment is available.';
  } else if (prev.reps < lo) {
    result.weight = Math.max(0, Math.round(prev.weight * 0.95 * 100) / 100);
    result.reps = lo;
    result.why = 'Below target range last time. Use the nearest available lighter load.';
  } else if (failed) {
    result.why = 'Last set was near failure or difficult. Repeat rather than force an increase.';
  } else if (cfg?.rir !== undefined && !unknown && Number.parseInt(prev.rir) < cfg.rir) {
    result.why = 'Repeat at the same load until you reach your target RIR.';
  } else if (prev.reps < hi) {
    result.reps = prev.reps + 1;
    result.why = unknown
      ? 'Aim for one extra rep only if form stays clean and 1–2 RIR remains. Prior RIR unknown.'
      : 'Add one rep at the same load, keeping 1–2 RIR.';
  } else {
    result.why = 'At top of range. Confirm effort on all sets before increasing load.';
  }
  if (
    recentSessions.length === 3 &&
    !allReady &&
    recentSessions.every((session) => session.every((s) => s.reps < hi && (Training.failed(s) || s.rir === '0')))
  ) {
    result.weight = Math.max(0, Math.round((prev.weight - step) * 100) / 100);
    result.reps = lo;
    result.why =
      'Three recent sessions near failure without reaching the rep target. Try one increment lighter and rebuild.';
  }
  let recent = done.at(-1);
  if (recent && (recent.reps < lo || recent.rir === '0' || Training.failed(recent))) {
    result.weight = Math.min(result.weight, Math.round(recent.weight * 0.95 * 100) / 100);
    result.reps = lo;
    result.why = 'Fatigue check: reduce to the nearest available lighter load for the next set.';
  }
  return result;
}
function workoutRows() {
  return (matchesActive() && active.rows) || routineById($('split').value)?.rows || [];
}
function currentRow() {
  const row = workoutRows().find((item) => item.id === selectedRow);
  return rowExercise(row)?.name === $('exercise').value.trim() ? row : null;
}
function rowDefaults(row) {
  const entry = rowExercise(row);
  return {
    ...prescription(
      norm(entry.name),
      [],
      [],
      exerciseConfig[entry.id] ?? exerciseConfig[norm(entry.name)] ?? (row.legacy ? undefined : entry.defaults),
    ),
  };
}
function rowSettings(row) {
  return row.config || rowDefaults(row);
}
function matchesExercise(set, name, row) {
  const entry = rowExercise(row) || RoutineBuilder.exact.get(norm(name));
  if (entry) return RoutineBuilder.comparable(set, entry);
  const candidates = routineState.customExercises.filter((item) => norm(item.name) === norm(name));
  return candidates.length === 1
    ? RoutineBuilder.comparable(set, candidates[0])
    : !set.exerciseId && norm(set.exercise) === norm(name);
}
function setsForRow(row, rows = sessionSets()) {
  const name = rowExercise(row).name;
  const first = workoutRows().find((item) => item.exerciseId === row.exerciseId);
  return rows.filter(
    (set) =>
      matchesExercise(set, name, row) && (set.routineRowId ? set.routineRowId === row.id : row.id === first?.id),
  );
}
function comparableHistory(name, row) {
  const split = $('split').value,
    date = $('date').value;
  return data.sets
    .filter(
      (set) =>
        (set.date < date || (matchesActive() && active.id && set.date === date && set.workoutId !== active.id)) &&
        matchesExercise(set, name, row) &&
        (set.split === 'Fitness assignment') === (split === 'Fitness assignment'),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
function previousRows(name, row) {
  const history = comparableHistory(name, row).filter(isWorking);
  const last = history.at(-1);
  return last ? history.filter((set) => Training.sessionKey(set) === Training.sessionKey(last)) : [];
}
function recommend(name, row = currentRow()) {
  return prescription(
    norm(name),
    comparableHistory(name, row),
    row ? setsForRow(row) : sessionSets().filter((set) => matchesExercise(set, name, null)),
    row ? rowSettings(row) : undefined,
  );
}

function trainingActive() {
  return Boolean(active?.date && active?.split);
}
function matchesActive() {
  return trainingActive() && active.date === $('date').value && active.split === $('split').value;
}

function previousPerformance(name, row) {
  const previous = previousRows(name, row).at(-1);
  return previous
    ? shownWeight(previous.weight) + ' × ' + previous.reps + (previous.rir ? ' · ' + previous.rir + ' RIR' : '')
    : '—';
}
function target() {
  const name = $('exercise').value.trim();
  $('exerciseTitle').textContent = name || 'Choose exercise';
  $('saveSet').disabled = !name;
  const row = currentRow();
  $('exerciseOptions').hidden = !name || Boolean(editing);
  $('applyTarget').disabled = !name || Boolean(editing);
  $('globalPrescription').hidden = Boolean(row?.config);
  $('routinePrescriptionNotice').hidden = !row?.config;
  $('substituteExercise').hidden = !matchesActive() || !row || Boolean(editing);
  $('last').textContent = name ? previousPerformance(name, row) : '—';
  const instructions = name && row ? rowSettings(row).instructions : '';
  $('exerciseInstructions').textContent = instructions || '';
  $('exerciseInstructions').hidden = !instructions;
  if (!name) {
    $('target').textContent = '—';
    $('setProgressText').textContent = '';
    $('prescribedReps').textContent = '';
    $('setProgress').replaceChildren();
    $('recommendationWhy').textContent = '';
    return;
  }
  const recommendation = recommend(name);
  const done = (row ? setsForRow(row) : sessionSets().filter((set) => matchesExercise(set, name, null))).filter(
    isWorking,
  ).length;
  $('setProgress').replaceChildren(
    ...Array.from({ length: row ? planCount(row) : recommendation.count }, (_, i) =>
      el('span', '', i < done ? 'done' : ''),
    ),
  );
  $('setProgressText').textContent =
    done + ' of ' + (row ? planCount(row) : recommendation.count) + ' working sets';
  $('prescribedReps').textContent =
    (recommendation.lo === recommendation.hi ? recommendation.lo : recommendation.lo + '–' + recommendation.hi) +
    ' reps';
  $('target').textContent =
    recommendation.weight === null
      ? 'Baseline × ' + recommendation.reps
      : shownWeight(recommendation.weight) + ' × ' + recommendation.reps;
  if (recommendation.rir !== undefined) $('target').textContent += ' · ' + recommendation.rir + ' RIR';
  $('recommendationWhy').textContent =
    recommendation.why +
    ' Aim for ' +
    recommendation.lo +
    '–' +
    recommendation.hi +
    (recommendation.rir === undefined
      ? ' reps and 1–2 reps in reserve (2–3 for new lifts).'
      : ' reps and ' + recommendation.rir + ' reps in reserve.') +
    ' Stop or modify if pain, instability or form breakdown occurs.';
}

function applyTarget() {
  if (editing || !$('exercise').value.trim()) return;
  const r = recommend($('exercise').value);
  $('weight').value = weightInput(r.weight);
  $('reps').value = r.reps;
  $('rir').value = $('notes').value = '';
  $('setKind').value = 'working';
  $('partialReps').value = '0';
  $('failedSet').checked = false;
  target();
}

function resetEdit() {
  editing = null;
  repeatOrigin = null;
  $('logtitle').textContent = '';
  $('saveSet').textContent = 'Log set';
  $('cancelEdit').hidden = true;
  $('cancelEdit').textContent = 'Cancel edit';
}
function chooseExercise(row, scroll = false) {
  resetEdit();
  const name = rowExercise(row)?.name || '';
  selectedRow = row?.id ?? null;
  $('exercise').value = name;
  if (matchesActive()) {
    active.exercise = name;
    active.rowId = selectedRow;
    persistActive();
  }
  applyTarget();
  loadConfig();
  window.dispatchEvent(new Event('ironlog:chooseExercise'));
  renderTraining();
  if (scroll) $('trainingLog').scrollIntoView({ block: 'start' });
}
function loadConfig() {
  const name = $('exercise').value.trim();
  if (!name) return;
  const r = recommend(name);
  for (const [id, field] of [
    ['cfgSets', 'count'],
    ['cfgLo', 'lo'],
    ['cfgHi', 'hi'],
    ['cfgStep', 'step'],
    ['cfgRest', 'rest'],
  ]) {
    $(id).value = field === 'step' ? weightInput(r[field]) : r[field];
  }
}

function syncRoutineOptions() {
  const select = $('split');
  const chosen = select.value;
  const options = routineState.routines.map((routine) => new Option(routine.name, routine.id));
  options.push(new Option('Separate workout', 'Fitness assignment'), new Option('Other', 'Other'));
  if (chosen && !options.some((option) => option.value === chosen)) options.push(new Option(chosen, chosen));
  select.replaceChildren(...options);
  select.value = chosen || 'Push';
  const live = routineState.routines.filter((routine) => !routine.archived);
  const chooser = $('routineSelect');
  chooser.replaceChildren(...live.map((routine) => new Option(routine.name, routine.id)));
  if (live.some((routine) => routine.id === chosen)) chooser.value = chosen;
  else if (!trainingActive() && !manual && !editing && live.length) select.value = chooser.value;
  chooser.disabled = !live.length;
}
let queueWasActive = false;
function renderTraining() {
  syncRoutineOptions();
  const split = $('split').value;
  const queue = workoutRows();
  const rows = sessionSets();
  const showLogger = trainingActive() || manual || Boolean(editing);
  const available = routineById(split) && !routineById(split).archived && queue.length;
  $('trainingLog').hidden = !showLogger;
  $('workoutSetup').hidden = showLogger;
  const activeView = matchesActive() && !editing;
  $('finishWorkout').hidden = $('workoutOptions').hidden = !activeView;
  if (activeView !== queueWasActive) $('queueDisclosure').open = !activeView;
  queueWasActive = activeView;
  $('routineCard').classList.toggle('activeQueue', activeView);
  if (!editing && (manual || (trainingActive() && !matchesActive()))) {
    $('cancelEdit').textContent = trainingActive() ? 'Back to workout' : 'Close logger';
    $('cancelEdit').hidden = false;
  }
  $('beginWorkout').hidden = !available;
  $('routineCard').hidden = !queue.length || (!showLogger && !available);
  $('editRoutine').hidden = !routineById(split);
  $('completedCard').hidden = !rows.length;
  $('planOverview').textContent = available
    ? queue.length + ' exercises planned'
    : 'Create or restore a routine to start.';
  $('routineHeading').textContent = showLogger ? 'Exercise queue' : splitName(split) + ' plan';
  $('sessionstats').textContent = rows.length + ' sets · ' + shownWeight(volume(rows));
  $('coachplan').replaceChildren(
    ...queue.map((row, i) => {
      const name = rowExercise(row)?.name;
      if (!name) return el('div', 'Exercise unavailable', 'listRow');
      const line = el('div', '', 'listRow');
      const item = el(showLogger ? 'button' : 'div', '', 'planExercise');
      const done = setsForRow(row, rows).filter(isWorking).length;
      item.append(
        el('span', String(i + 1).padStart(2, '0'), 'planIndex'),
        el('span', name),
        el('span', done + '/' + planCount(row), 'planCount'),
      );
      if (showLogger)
        item.onclick = () => {
          if (activeView && active.skippedRows?.includes(row.id)) {
            active.skippedRows = active.skippedRows.filter((id) => id !== row.id);
          }
          chooseExercise(row, true);
        };
      if (showLogger && currentRow()?.id === row.id) item.setAttribute('aria-current', 'true');
      line.append(item);
      return line;
    }),
  );
  $('currentsets').replaceChildren(setTable(rows, { showExercise: true, repeat: true }));
  activeUI(true);
  target();
  window.dispatchEvent(new Event('ironlog:training'));
}

function editSet(set, repeat = false) {
  if (page !== 'workout') tab('workout');
  manual = true;
  selectedRow = set.routineRowId || null;
  if (![...$('split').options].some((option) => option.value === set.split))
    $('split').add(new Option(splitName(set.split), set.split));
  for (const k of ['date', 'split', 'exercise', 'weight', 'reps', 'rir', 'notes']) $(k).value = set[k] ?? '';
  if (repeat) {
    resetEdit();
    repeatOrigin = set;
  } else {
    editing = set.id;
    $('logtitle').textContent = 'Edit logged set';
    $('saveSet').textContent = 'Update set';
    $('cancelEdit').hidden = false;
  }
  $('setDetails').open = !repeat;
  suggestions();
  loadConfig();
  renderTraining();
  $('trainingLog').scrollIntoView({ block: 'start' });
}
function exitManual() {
  manual = false;
  resetEdit();
  if (trainingActive()) resumeWorkout();
  else {
    $('date').value = today();
    $('split').value = routineById($('split').value) ? $('split').value : $('routineSelect').value || 'Push';
    selectedRow = null;
    $('setDetails').open = false;
    $('exercise').value = '';
    renderTraining();
  }
}

$('cancelEdit').onclick = exitManual;
$('manualStart').onclick = () => {
  manual = true;
  $('cancelEdit').textContent = 'Close logger';
  $('cancelEdit').hidden = false;
  $('setDetails').open = true;
  renderTraining();
  $('exercise').focus();
};
$('exercise').oninput = () => {
  selectedRow = null;
  target();
  loadConfig();
};
$('date').onchange = renderTraining;
$('split').onchange = () => {
  suggestions();
  renderTraining();
  loadConfig();
};
$('routineSelect').onchange = () => {
  $('split').value = $('routineSelect').value;
  $('exercise').value = '';
  selectedRow = null;
  suggestions();
  renderTraining();
};
$('applyTarget').onclick = applyTarget;
function exerciseIncomplete(row) {
  return setsForRow(row).filter(isWorking).length < planCount(row);
}
function exercisePending(row) {
  return rowExercise(row) && !active?.skippedRows?.includes(row.id) && exerciseIncomplete(row);
}
function upcomingExercise() {
  const queue = workoutRows();
  const index = queue.findIndex((row) => row.id === currentRow()?.id);
  return [...queue.slice(index + 1), ...queue.slice(0, Math.max(0, index))].find(exercisePending);
}
async function advanceExercise({ skip = false } = {}) {
  if (!matchesActive() || editing) return;
  const session = active;
  const row = currentRow();
  const next = upcomingExercise();
  if (!skip && !next) {
    $('finishWorkout').click();
    return;
  }
  if (row && exercisePending(row)) {
    if (
      !(await confirmAction(
        'Leave the remaining working sets for this exercise unlogged?',
        'Skip remaining sets',
        'Skip exercise?',
      )) ||
      active !== session
    )
      return;
    active.skippedRows ||= [];
    active.skippedRows.push(row.id);
    persistActive();
  }
  if (next) chooseExercise(next, true);
  else renderTraining();
}
$('nextExercise').onclick = () => advanceExercise();
$('skipExercise').onclick = () => advanceExercise({ skip: true });

function logSet(
  { weight, reps, rir = '', notes = '', kind = 'working', failed = false, partials = 0 },
  options = {},
) {
  const name = $('exercise').value.trim();
  if (
    !name ||
    !Number.isFinite(weight) ||
    weight < 0 ||
    !Number.isInteger(reps) ||
    reps < (partials > 0 ? 0 : 1) ||
    !Number.isInteger(partials) ||
    partials < 0 ||
    partials > 1000
  ) {
    toast('Enter valid weight and repetitions.');
    return false;
  }
  const old = editing ? data.sets.find((set) => set.id === editing) : null;
  const row = currentRow();
  const live = matchesActive() && !editing;
  const rest = recommend(name, row).rest;
  const item = {
    ...old,
    id: old?.id || RoutineBuilder.uid(String(Date.now()).padStart(14, '0')),
    date: $('date').value,
    split: $('split').value,
    exercise: name,
    weight,
    reps,
    rir,
    notes,
    kind,
    failed,
    partials,
  };
  if (live && active.id) item.workoutId = active.id;
  else if (live) {
    active.ownedSetIds ||= [];
    active.ownedSetIds.push(item.id);
    persistActive();
  } else if (old && (old.date !== item.date || old.split !== item.split)) delete item.workoutId;
  if (row) {
    item.exerciseId = row.exerciseId;
    item.routineRowId = row.id;
  } else if (repeatOrigin?.exercise === name) {
    if (repeatOrigin.exerciseId) item.exerciseId = repeatOrigin.exerciseId;
    if (repeatOrigin.routineRowId && repeatOrigin.split === item.split)
      item.routineRowId = repeatOrigin.routineRowId;
  } else if (old && (old.exercise !== name || old.split !== item.split)) {
    delete item.exerciseId;
    delete item.routineRowId;
  }
  const previous =
    live && isWorking(item)
      ? Training.records(
          regular().filter((set) => set.date <= item.date && exerciseIdentity(set) === exerciseIdentity(item)),
          exerciseIdentity,
        )
      : null;
  if (old) data.sets = data.sets.map((set) => (set.id === old.id ? item : set));
  else data.sets.push(item);
  if (live && row && !options.preserveInput && active.drafts?.[row.id]) {
    delete active.drafts[row.id];
    persistActive();
  }
  if (live) undoItem = { id: item.id, workout: active.id || active.started, row: row?.id };
  resetEdit();
  let message = old ? 'Set updated' : 'Set logged';
  if (
    previous?.best.length &&
    Training.records(
      regular().filter((set) => set.date <= item.date && exerciseIdentity(set) === exerciseIdentity(item)),
      exerciseIdentity,
    )
      .markers.get(item.id)
      ?.some(
        (label) =>
          label !== 'Exercise session volume' ||
          previous.best.some(
            (record) => record.label === label && Training.sessionKey(record.set) !== Training.sessionKey(item),
          ),
      )
  ) {
    message = 'Personal record · ' + name;
  }
  persistData(message);
  if (old) {
    exitManual();
    return true;
  }
  if (!options.preserveInput) applyTarget();
  const queue = workoutRows();
  const position = queue.findIndex((candidate) => candidate.id === row?.id);
  const unfinished = exercisePending;
  let next,
    paired = false;
  if (live && position >= 0 && isWorking(item)) {
    const partner = row.superset
      ? queue[position + 1]
      : queue[position - 1]?.superset
        ? queue[position - 1]
        : null;
    if (partner && rowExercise(partner) && unfinished(partner)) {
      next = partner;
      paired = row.superset;
    } else if (!unfinished(row)) next = queue.slice(position + 1).find(unfinished);
  }
  if ($('autoRest').checked && !paired) startRest(rest);
  if (next) chooseExercise(next);
  return true;
}

$('log').onsubmit = (event) => {
  event.preventDefault();
  const submitKey = editing || currentRow()?.id || $('exercise').value;
  if ((submitKey === lastSubmitKey && Date.now() - lastSubmitAt < 750) || !$('weight').value || !$('reps').value)
    return;
  lastSubmitAt = Date.now();
  lastSubmitKey = submitKey;
  const recommendation = recommend($('exercise').value);
  const original = editing ? data.sets.find((set) => set.id === editing) : repeatOrigin;
  const entered = $('weight').value;
  const weight =
    original && entered === weightInput(original.weight)
      ? original.weight
      : recommendation.weight !== null && entered === weightInput(recommendation.weight)
        ? recommendation.weight
        : inputPounds(entered);
  logSet({
    weight,
    reps: Number($('reps').value),
    rir: $('rir').value,
    notes: $('notes').value,
    kind: $('setKind').value,
    failed: $('failedSet').checked,
    partials: Number($('partialReps').value || 0),
  });
};

function activeUI(updateProgress = false) {
  const isActive = matchesActive() && !editing;
  $('workoutProgress').hidden = $('workoutPosition').hidden = !isActive;
  $('activeWorkoutInfo').textContent = isActive ? active.name || splitName(active.split) : 'Set logger';
  if (!isActive) return;
  const seconds = Math.max(0, Math.floor((Date.now() - active.started) / 1000));
  const elapsed = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  const queue = workoutRows();
  const index = queue.findIndex((row) => row.id === currentRow()?.id);
  $('workoutPosition').textContent =
    elapsed + (index >= 0 ? ' · Exercise ' + (index + 1) + ' of ' + queue.length : '');
  if (!updateProgress) return;
  const counts = queue
    .filter((row) => rowExercise(row))
    .map((row) => [planCount(row), Math.min(planCount(row), setsForRow(row).filter(isWorking).length)]);
  $('workoutProgress').max = Math.max(
    1,
    counts.reduce((total, [planned]) => total + planned, 0),
  );
  $('workoutProgress').value = counts.reduce((total, [, completed]) => total + completed, 0);
}
function persistActive() {
  try {
    localStorage.setItem(activeKey, JSON.stringify(active));
  } catch {}
  activeUI();
}
function resumeWorkout() {
  syncRoutineOptions();
  if (![...$('split').options].some((option) => option.value === active.split))
    $('split').add(new Option(active.name || active.split, active.split));
  $('split').value = active.split;
  $('date').value = active.date;
  active.rows ||= RoutineBuilder.clone(routineById(active.split)?.rows || []);
  const fallbackName = active.exercise;
  const queue = workoutRows().filter((row) => rowExercise(row));
  const next = queue.find((row) => setsForRow(row).filter(isWorking).length < planCount(row));
  suggestions();
  chooseExercise(
    queue.find((row) => row.id === active.rowId) ||
      (active.rowId === undefined && queue.find((row) => rowExercise(row)?.name === active.exercise)) ||
      next ||
      queue[queue.length - 1],
  );
  if (!queue.length && fallbackName) {
    $('exercise').value = fallbackName;
    target();
  }
}
$('beginWorkout').onclick = () => {
  const routine = routineById($('split').value);
  if (!routine?.rows.length || routine.archived) return;
  active = {
    id: RoutineBuilder.uid('workout'),
    split: routine.id,
    name: routine.name,
    rows: RoutineBuilder.clone(routine.rows),
    customExercises: RoutineBuilder.clone(
      routineState.customExercises.filter((entry) => routine.rows.some((row) => row.exerciseId === entry.id)),
    ),
    date: today(),
    started: Date.now(),
  };
  persistActive();
  resumeWorkout();
  $('exerciseTitle').scrollIntoView({ block: 'nearest' });
};
function workoutRecord(session, finished = Date.now()) {
  return {
    id: session.id || session.date + ' ' + session.split,
    date: session.date,
    split: session.split,
    name: session.name || splitName(session.split),
    started: session.started,
    finished: Math.max(session.started, finished),
    notes: session.notes || '',
  };
}
function ownedWorkoutSets(session) {
  if (session.id) return data.sets.filter((set) => set.workoutId === session.id);
  const ids = new Set(session.ownedSetIds || []);
  return data.sets.filter((set) => !set.workoutId && ids.has(set.id));
}
function closeCancelledWorkout(session, discard = false) {
  if (!session || active !== session) return;
  const owned = ownedWorkoutSets(session);
  const next = { ...data };
  if (discard) {
    const matches = new Set(owned);
    next.sets = data.sets.filter((set) => !matches.has(set));
    if (session.id) next.workouts = data.workouts.filter((workout) => workout.id !== session.id);
  } else if (session.id && owned.length) {
    next.workouts = [...data.workouts.filter((workout) => workout.id !== session.id), workoutRecord(session)];
  }
  try {
    IronCore.writeBackup(localStorage, { workout: next, activeSession: null });
  } catch {
    toast('Could not save the cancellation. Your workout is still active.');
    return;
  }
  data = next;
  active = null;
  undoItem = null;
  lastSubmitKey = '';
  $('cancelWorkoutSheet').close();
  restDuration = restartDuration = 0;
  $('barstop').click();
  exitManual();
  render();
  toast(
    discard
      ? 'Workout and its logged sets discarded'
      : owned.length
        ? 'Workout cancelled. Sets kept.'
        : 'Workout cancelled',
  );
  window.dispatchEvent(new Event('ironlog:saved'));
  $('beginWorkout').focus();
}
$('cancelWorkout').onclick = () => {
  if (!matchesActive()) return;
  $('workoutOptionsSheet').close();
  const session = active;
  const owned = ownedWorkoutSets(session);
  const legacy = !session.id && sessionSets(session.date, session.split).some((set) => !owned.includes(set));
  if (!owned.length && !legacy) {
    closeCancelledWorkout(session);
    return;
  }
  $('cancelWorkoutMessage').textContent = legacy
    ? 'Older sets without a verified session link will be kept.'
    : owned.length + (owned.length === 1 ? ' set is' : ' sets are') + ' logged in this workout.';
  $('cancelDiscard').hidden = !owned.length;
  showDialog($('cancelWorkoutSheet'));
};
$('cancelKeep').onclick = () => closeCancelledWorkout(active);
$('cancelDiscard').onclick = () => {
  const session = active;
  if (!session || !ownedWorkoutSets(session).length) return;
  confirmAction(
    'Permanently remove the sets linked to this workout?',
    'Discard logged sets',
    'Discard logged sets?',
    () => closeCancelledWorkout(session, true),
  );
};

$('finishWorkout').onclick = async () => {
  if (!matchesActive()) return;
  if (
    !(await confirmAction(
      workoutRows().some(exercisePending)
        ? 'Some working sets are still open. Finish this workout and keep the sets you logged?'
        : 'Finish this training session and see your results?',
      'Finish workout',
      'Finish workout?',
    ))
  )
    return;
  const sets = sessionSets(active.date, active.split);
  const finished = Date.now();
  const minutes = Math.max(0, Math.floor((finished - active.started) / 60000));
  const workout = workoutRecord(active, finished);
  data.workouts = [...data.workouts.filter((item) => item.id !== workout.id), workout];
  $('summarySplit').textContent = (active.name || splitName(active.split)) + ' · ' + displayDate(active.date);
  $('summaryMetrics').replaceChildren(
    metric(sets.filter(isWorking).length, 'Working sets'),
    metric(exerciseCount(sets), 'Exercises'),
    metric(minutes + ' min', 'Duration'),
    metric(shownWeight(volume(sets)), 'Volume'),
  );
  const warmups = sets.filter((set) => Training.kind(set) === 'warmup').length;
  const additional = sets.filter((set) => !isWorking(set) && Training.kind(set) !== 'warmup').length;
  $('summaryHighlights').textContent = [
    warmups && warmups + ' warm-up',
    additional && additional + ' drop or back-off',
    workout.notes,
  ]
    .filter(Boolean)
    .join(' · ');
  active = null;
  undoItem = null;
  persistActive();
  exitManual();
  persistData();
  showDialog($('workoutSummary'));
};
$('summaryDone').onclick = () => $('workoutSummary').close();
$('summaryHistory').onclick = () => {
  $('workoutSummary').close();
  tab('history');
};

function saveExerciseConfig(next) {
  try {
    localStorage.setItem(configKey, JSON.stringify(next));
  } catch {
    toast('Browser storage is unavailable.');
    return;
  }
  exerciseConfig = next;
  renderTraining();
  loadConfig();
  toast('Exercise settings saved');
  window.dispatchEvent(new Event('ironlog:saved'));
}
$('cfgSave').onclick = () => {
  const name = $('exercise').value.trim();
  if (!name) return;
  const config = {
    count: Number($('cfgSets').value),
    lo: Number($('cfgLo').value),
    hi: Number($('cfgHi').value),
    step:
      $('cfgStep').value === weightInput(recommend(name).step)
        ? recommend(name).step
        : inputPounds($('cfgStep').value),
    rest: Number($('cfgRest').value),
  };
  if (
    ![config.count, config.lo, config.hi, config.rest].every(Number.isInteger) ||
    config.count < 1 ||
    config.count > 10 ||
    config.lo < 1 ||
    config.hi < config.lo ||
    config.hi > 30 ||
    !Number.isFinite(config.step) ||
    config.step < 0.5 ||
    config.step > 50 ||
    config.rest < 15 ||
    config.rest > 600
  ) {
    toast('Check the exercise settings.');
    return;
  }
  saveExerciseConfig(Object.assign(Object.create(null), exerciseConfig, { [norm(name)]: config }));
};
$('cfgReset').onclick = () => {
  const next = Object.assign(Object.create(null), exerciseConfig);
  delete next[norm($('exercise').value)];
  saveExerciseConfig(next);
};

function metric(value, label) {
  const card = el('div', '', 'metric');
  card.append(el('small', label), el('strong', String(value)));
  return card;
}

function setTable(sets, { showExercise = false, repeat = false } = {}) {
  const table = el('table');
  const header = table.createTHead().insertRow();
  for (const label of [showExercise ? 'Exercise' : 'Set', 'Weight', 'Reps', 'Actions']) {
    const cell = el('th', label);
    cell.scope = 'col';
    header.append(cell);
  }
  const body = table.createTBody();
  sets.forEach((set, index) => {
    const row = body.insertRow();
    row.insertCell().textContent = showExercise ? set.exercise : index + 1;
    const details = [
      Training.kind(set) !== 'working' && Training.labels[Training.kind(set)],
      Training.failed(set) && 'Failure',
      set.rir && set.rir + ' RIR',
      set.notes,
    ].filter(Boolean);
    if (details.length) row.cells[0].append(el('small', details.join(' · ')));
    const badges = historyRecords?.get(set.id);
    if (badges?.length && !repeat)
      row.cells[0].append(el('small', 'PR · ' + [...new Set(badges)].join(', '), 'recordBadge'));
    row.insertCell().textContent = shownWeight(set.weight);
    row.insertCell().textContent = String(set.reps) + (set.partials ? ' +' + set.partials + ' partial' : '');
    const actions = row.insertCell();
    const edit = el('button', 'Edit', 'quiet');
    edit.onclick = () => editSet(set);
    actions.append(edit);
    if (repeat) {
      const button = el('button', 'Repeat', 'quiet');
      button.onclick = () => editSet(set, true);
      actions.append(button);
    }
    const remove = el('button', 'Delete', 'quiet destructive');
    remove.onclick = async () => {
      if (!(await confirmAction('Remove this set from your workout history?', 'Delete set', 'Delete set?')))
        return;
      data.sets = data.sets.filter((item) => item.id !== set.id);
      persistData('Set deleted');
    };
    actions.append(remove);
  });
  return table;
}

let historyRecords;
function renderHistory() {
  historyRecords = Training.records(regular(), exerciseIdentity).markers;
  const history = $('history');
  const open = new Set([...history.querySelectorAll('details[open]')].map((card) => card.dataset.session));
  const search = norm($('searchHistory').value);
  const groups = new Map();
  const sets = [...data.sets].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  for (const set of sets) {
    const key = Training.sessionKey(set);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(set);
  }
  for (const workout of data.workouts) if (!groups.has(workout.id)) groups.set(workout.id, []);
  const metadata = new Map(data.workouts.map((workout) => [workout.id, workout]));
  const cards = [];
  for (const [key, workout] of [...groups].sort(
    ([keyA, a], [keyB, b]) =>
      (metadata.get(keyB)?.date || b[0].date).localeCompare(metadata.get(keyA)?.date || a[0].date) ||
      (metadata.get(keyB)?.started || 0) - (metadata.get(keyA)?.started || 0),
  )) {
    const info = metadata.get(key);
    const { date, split } = info || workout[0];
    if (calendarDay && date !== calendarDay) continue;
    if (
      search &&
      !norm([date, info?.name, info?.notes, splitName(split)].filter(Boolean).join(' ')).includes(search) &&
      !workout.some((set) =>
        norm([set.date, set.split, splitName(set.split), set.exercise, set.notes].join(' ')).includes(search),
      )
    )
      continue;
    const card = el('details', '', 'panel disclosure workoutCard');
    const summary = el('summary');
    const title = el('span', '', 'historyTitle');
    const count = exerciseCount(workout);
    title.append(
      el('strong', info?.name || splitName(split)),
      el(
        'span',
        displayDate(date) +
          ' · ' +
          count +
          (count === 1 ? ' exercise' : ' exercises') +
          ' · ' +
          shownWeight(volume(workout)) +
          (info ? ' · ' + Math.round((info.finished - info.started) / 60000) + ' min' : ''),
        'historyMeta',
      ),
    );
    summary.append(title);
    card.append(summary);
    card.dataset.session = key;
    if (info) {
      if (info.notes) card.append(el('p', info.notes, 'small muted'));
      const edit = el('button', 'Edit workout details', 'quiet');
      edit.onclick = () => window.TrainingUI?.workoutDetails(info);
      card.append(edit);
    }
    card.open = open.has(key);
    const exercises = new Map();
    for (const set of workout) {
      const name = exerciseIdentity(set);
      if (!exercises.has(name)) exercises.set(name, []);
      exercises.get(name).push(set);
    }
    for (const exercise of exercises.values())
      card.append(el('h3', exercise[0].exercise, 'historyExercise'), setTable(exercise));
    cards.push(card);
  }
  if (!cards.length) {
    const empty = el('div', '', 'panel empty');
    empty.append(
      el(
        'p',
        data.sets.length
          ? 'No workouts match your search or selected date.'
          : 'Your first workout will appear here.',
      ),
    );
    if (!data.sets.length) {
      const start = el('button', 'Go to Train', 'primary');
      start.onclick = () => tab('workout');
      empty.append(start);
    }
    cards.push(empty);
  }
  history.replaceChildren(...cards);
  window.TrainingUI?.calendar();
}
$('searchHistory').oninput = renderHistory;

function inRange(date, range) {
  return date <= today() && (range === 'all' || date >= IronCore.shiftDay(today(), 1 - Number(range)));
}

function plot(id, emptyId, points, color, unit, average = []) {
  const canvas = $(id);
  canvas.hidden = !points.length;
  $(emptyId).hidden = !!points.length;
  const { width, height } = canvas.getBoundingClientRect();
  if (!points.length || !width || !height) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  const pad = { left: 49, right: 18, top: 20, bottom: 35 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  if (plotWidth < 15) return;
  const values = [...points, ...average].map((point) => point[1]);
  const low = Math.min(...values),
    high = Math.max(...values);
  const spread = Math.max(4, high - low);
  const step = spread < 15 ? Math.ceil(spread / 3) : Math.ceil(spread / 15) * 5;
  const min = Math.max(0, Math.floor(low / step) * step - step);
  const max = Math.ceil(high / step) * step + step;
  const first = stamp(points[0][0]).getTime();
  const last = stamp(points[points.length - 1][0]).getTime();
  const x = (day) =>
    pad.left + (last === first ? 0.5 : (stamp(day).getTime() - first) / (last - first)) * plotWidth;
  const y = (value) => pad.top + ((max - value) * plotHeight) / (max - min);
  ctx.font = '11px system-ui';
  ctx.fillStyle = '#a9b2af';
  ctx.strokeStyle = '#363d3e';
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const value = min + ((max - min) * i) / 4;
    const line = y(value);
    ctx.beginPath();
    ctx.moveTo(pad.left, line);
    ctx.lineTo(width - pad.right, line);
    ctx.stroke();
    ctx.fillText(number(value), pad.left - 6, line + 4);
  }
  const middle = Math.floor(points.length / 2);
  const middleX = x(points[middle][0]);
  const tickIndices = [...new Set([0, points.length - 1])];
  if (points.length > 2 && middleX > pad.left + 72 && middleX < width - pad.right - 72) {
    tickIndices.splice(1, 0, middle);
  }
  tickIndices.forEach((index, i) => {
    ctx.textAlign =
      tickIndices.length === 1 ? 'center' : i === 0 ? 'left' : i === tickIndices.length - 1 ? 'right' : 'center';
    ctx.fillText(
      displayDate(points[index][0], { month: 'short', day: 'numeric' }),
      x(points[index][0]),
      height - 9,
    );
  });
  if (average.length > 1) {
    ctx.strokeStyle = '#a9b2af';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    average.forEach(([day, weight], index) =>
      index ? ctx.lineTo(x(day), y(weight)) : ctx.moveTo(x(day), y(weight)),
    );
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach(([day, value], i) => {
    if (i) ctx.lineTo(x(day), y(value));
    else ctx.moveTo(x(day), y(value));
  });
  ctx.stroke();
  points.forEach(([day, value], i) => {
    if (points.length > 55 && i !== points.length - 1) return;
    ctx.beginPath();
    ctx.arc(x(day), y(value), 3, 0, Math.PI * 2);
    ctx.fill();
  });
  const [day, latest] = points[points.length - 1];
  ctx.textAlign = last === first ? 'center' : 'right';
  ctx.fillText(number(latest) + ' ' + unit, x(day) - (first === last ? 0 : 4), y(latest) - 8);
  canvas.setAttribute(
    'aria-label',
    (id === 'chart' ? 'Estimated one-rep max' : 'Bodyweight') +
      ' trend. Latest ' +
      number(latest) +
      ' ' +
      unit +
      ' on ' +
      displayDate(day) +
      '.',
  );
}

function monday(day) {
  const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
  return IronCore.shiftDay(day, -((weekday + 6) % 7));
}

function renderProgress() {
  const range = $('progressRange').value;
  const selected = $('progress').value;
  const sets = regular().filter((set) => inRange(set.date, range));
  const selectedSets = Training.unique(sets.filter((set) => isWorking(set) && exerciseIdentity(set) === selected));
  const estimates = new Map();
  for (const set of selectedSets) {
    const value = est(set);
    if (value !== null) estimates.set(set.date, Math.max(estimates.get(set.date) || 0, value));
  }
  const points = [...estimates].sort(([a], [b]) => a.localeCompare(b));
  $('records').replaceChildren(
    metric(
      selectedSets.length ? shownWeight(Math.max(...selectedSets.map((set) => set.weight))) : '—',
      'Heaviest set',
    ),
    metric(
      points.length ? shownWeight(Math.round(Math.max(...points.map((point) => point[1])))) : '—',
      'Best estimated 1RM',
    ),
  );
  const weeks = new Map();
  for (const set of sets) {
    const week = monday(set.date);
    if (!weeks.has(week)) weeks.set(week, []);
    weeks.get(week).push(set);
  }
  if (range !== 'all') {
    const oldest = monday(IronCore.shiftDay(today(), 1 - Number(range)));
    for (let week = monday(today()); week >= oldest; week = IronCore.shiftDay(week, -7)) {
      if (!weeks.has(week)) weeks.set(week, []);
    }
  }
  const max = Math.max(1, ...Array.from(weeks.values(), volume));
  const rows = [...weeks]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([week, sets]) => {
      const row = el('div', '', 'weekRow');
      const frequency = new Set(sets.map((set) => set.date)).size;
      const bar = el('div', '', 'weekBar');
      bar.setAttribute('aria-hidden', 'true');
      const fill = el('i');
      fill.style.width = (volume(sets) / max) * 100 + '%';
      bar.append(fill);
      row.append(
        el('strong', 'Week of ' + displayDate(week, { month: 'short', day: 'numeric' })),
        el(
          'span',
          frequency + (frequency === 1 ? ' day' : ' days') + ' · ' + shownWeight(volume(sets)),
          'weekValue',
        ),
        bar,
      );
      return row;
    });
  $('progressOverview').replaceChildren(
    ...(rows.length ? rows : [el('p', 'Weekly totals will appear after your first workout.', 'empty')]),
  );
  plot(
    'chart',
    'chartEmpty',
    points.map(([day, value]) => [day, Training.display(value, weightUnit())]),
    '#c1f65d',
    weightUnit(),
  );
  window.TrainingUI?.analytics();
}
$('progress').onchange = $('progressRange').onchange = renderProgress;

$('bodyform').onsubmit = (event) => {
  event.preventDefault();
  const date = $('bdate').value;
  data.body = data.body.filter((entry) => entry.date !== date);
  data.body.push({ date, weight: inputPounds($('bodyweight').value) });
  $('bodyweight').value = '';
  persistData('Weight recorded');
};

function renderBody() {
  const entries = [...data.body].sort((a, b) => a.date.localeCompare(b.date));
  const latest = entries[entries.length - 1];
  $('bw').textContent = latest ? shownWeight(latest.weight) : '—';
  $('bodyLatestDate').textContent = latest ? displayDate(latest.date) : 'No weigh-ins yet';
  const week = entries.filter((entry) => inRange(entry.date, '7'));
  const selected = entries.filter((entry) => inRange(entry.date, $('bodyRange').value));
  const change = selected.length > 1 ? selected[selected.length - 1].weight - selected[0].weight : null;
  $('bodytrend').replaceChildren(
    metric(
      week.length ? shownWeight(week.reduce((sum, entry) => sum + entry.weight, 0) / week.length) : '—',
      '7-day average',
    ),
    metric(change === null ? '—' : (change > 0 ? '+' : '') + shownWeight(change), 'Period change'),
  );
  $('bodyhistory').replaceChildren(
    ...(entries.length
      ? entries
          .slice()
          .reverse()
          .slice(0, 10)
          .map((entry) => {
            const row = el('div', '', 'sectionLine listRow');
            const label = el('div', displayDate(entry.date) + ' · ' + shownWeight(entry.weight));
            if (entry.notes) label.append(el('p', entry.notes, 'small muted'));
            const remove = el('button', 'Delete', 'quiet destructive');
            remove.onclick = async () => {
              if (
                !(await confirmAction(
                  'Remove the weigh-in for ' + displayDate(entry.date) + '?',
                  'Delete weigh-in',
                  'Delete weigh-in?',
                ))
              )
                return;
              data.body = data.body.filter((item) => item.date !== entry.date);
              persistData('Weight entry deleted');
            };
            row.append(label, remove);
            return row;
          })
      : [el('p', 'No weigh-ins yet.', 'empty')]),
  );
  const goal = data.training?.bodyGoal;
  $('bodyGoalProgress').hidden = !goal;
  $('bodyGoalProgress').textContent = goal
    ? 'Goal ' +
      shownWeight(goal) +
      (latest
        ? ' · ' +
          shownWeight(Math.abs(goal - latest.weight)) +
          (latest.weight > goal ? ' above goal' : latest.weight < goal ? ' below goal' : ' from goal')
        : '')
    : '';
  const rolling = Training.rollingWeight(entries)
    .filter(([day]) => inRange(day, $('bodyRange').value))
    .map(([day, value]) => [day, Training.display(value, weightUnit())]);
  plot(
    'bodyChart',
    'bodyChartEmpty',
    selected.map((entry) => [entry.date, Training.display(entry.weight, weightUnit())]),
    '#c1f65d',
    weightUnit(),
    rolling,
  );
}
$('bodyRange').onchange = renderBody;

function drawVisibleCharts() {
  if (page === 'progress') renderProgress();
  if (page === 'body') renderBody();
}
window.addEventListener('resize', drawVisibleCharts);

function render() {
  const select = $('progress');
  const before = select.value;
  const exercises = new Map(regular().map((set) => [exerciseIdentity(set), set.exercise]));
  select.replaceChildren(
    ...[...exercises]
      .sort(([, a], [, b]) => a.localeCompare(b))
      .map(([key, name]) => {
        const option = el('option', name);
        option.value = key;
        return option;
      }),
  );
  if (exercises.has(before)) select.value = before;
  else if (exercises.has('lift-bench-press')) select.value = 'lift-bench-press';
  if (!exercises.size) select.append(el('option', 'No exercises yet'));
  select.disabled = !exercises.size;
  suggestions();
  renderTraining();
  renderHistory();
  renderBody();
  renderProgress();
}
const restKey = 'iron-log-rest-v1';
const storedRest = read(restKey, {});
let deadline = Number(storedRest.deadline) || 0;
let paused = Number(storedRest.paused) || 0;
let restDuration = Number(storedRest.duration) || Math.max(0, paused, Math.ceil((deadline - Date.now()) / 1000));
let restartDuration = Number(storedRest.restart) || restDuration;
let interval, audio;
function unlockAudio() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!data.training?.restSound || !Audio) return;
  try {
    audio ||= new Audio();
    audio.resume().catch(() => {});
  } catch {}
}
function signalRest() {
  if (data.training?.restVibration !== false) navigator.vibrate?.(180);
  if (!data.training?.restSound || audio?.state !== 'running') return;
  const tone = audio.createOscillator(),
    gain = audio.createGain();
  tone.frequency.value = 660;
  gain.gain.setValueAtTime(0.14, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.3);
  tone.connect(gain).connect(audio.destination);
  tone.start();
  tone.stop(audio.currentTime + 0.32);
}
function persistRest() {
  try {
    localStorage.setItem(
      restKey,
      JSON.stringify({ deadline, paused, duration: restDuration, restart: restartDuration }),
    );
  } catch {}
}
function tick() {
  const seconds = paused || Math.max(0, (deadline - Date.now()) / 1000);
  const left = Math.ceil(seconds);
  $('timer').textContent = $('barclock').textContent = left
    ? String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0')
    : 'Done';
  $('restProgress').max = Math.max(1, restDuration);
  $('restProgress').value = Math.max(0, restDuration - seconds);
  if (deadline && !left) {
    clearInterval(interval);
    const recent = Date.now() - deadline < 3000;
    deadline = 0;
    persistRest();
    if (!document.hidden && recent) signalRest();
  }
}
function runRest(seconds) {
  clearInterval(interval);
  paused = 0;
  deadline = Date.now() + seconds * 1000;
  $('timerbar').hidden = false;
  $('pauseRest').textContent = $('barpause').textContent = 'Pause';
  persistRest();
  tick();
  interval = setInterval(tick, 250);
}
function startRest(seconds) {
  unlockAudio();
  restDuration = restartDuration = seconds;
  runRest(seconds);
}
function pauseRest() {
  if (paused) {
    unlockAudio();
    runRest(paused);
    return;
  }
  if (!deadline) return;
  paused = Math.max(0.001, (deadline - Date.now()) / 1000);
  deadline = 0;
  clearInterval(interval);
  $('pauseRest').textContent = $('barpause').textContent = 'Resume';
  persistRest();
  tick();
}
function extendRest(amount) {
  if (!deadline && !paused) {
    startRest(amount);
    return;
  }
  restDuration += amount;
  if (paused) paused += amount;
  else deadline += amount * 1000;
  persistRest();
  tick();
}
$('pauseRest').onclick = $('barpause').onclick = pauseRest;
$('extendRest15').onclick = $('barExtend').onclick = () => extendRest(15);
$('extendRest').onclick = () => extendRest(30);
$('restartRest').onclick = () => startRest(restartDuration || 180);
document
  .querySelectorAll('[data-rest]')
  .forEach((button) => (button.onclick = () => startRest(Number(button.dataset.rest))));
$('stop').onclick = $('barstop').onclick = () => {
  clearInterval(interval);
  deadline = paused = 0;
  persistRest();
  $('timerbar').hidden = true;
  $('timer').textContent = 'Skipped';
  $('pauseRest').textContent = $('barpause').textContent = 'Pause';
};
if (deadline || paused) {
  $('timerbar').hidden = false;
  if (paused) $('pauseRest').textContent = $('barpause').textContent = 'Resume';
  tick();
  if (deadline) interval = setInterval(tick, 250);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (deadline || paused)) tick();
});
window.addEventListener('pageshow', () => {
  if (deadline || paused) tick();
});

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = el('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function makeBackup() {
  const routines = Object.fromEntries(
    routineState.routines
      .filter((r) => RoutineBuilder.builtIn(r.id))
      .map((r) => [r.id, r.rows.map((row) => rowExercise(row).name)]),
  );
  const training = { ...data.training, autoRest: data.training?.autoRest ?? read(restPref, true) !== false };
  return { ...data, training, routines, exerciseConfig, routineState, activeSession: active };
}
function restoreBackup(parts, beforeWrite) {
  const next =
    parts.routineState ??
    (parts.routines !== undefined
      ? RoutineBuilder.migrate(defaultPlans, parts.routines, routineState)
      : undefined);
  if (next !== undefined && !RoutineBuilder.usable(next))
    throw new Error('Backup contains missing exercise or routine references.');
  const keepActive = parts.activeSession === undefined ? active : parts.activeSession;
  // Preserve metadata used by an in-progress queue when the library in the backup differs.
  if (next && keepActive?.customExercises) {
    for (const entry of keepActive.customExercises) {
      if (!RoutineBuilder.exercise(next, entry.id)) next.customExercises.push(entry);
    }
  }
  if (
    keepActive?.rows?.some(
      (row) =>
        !RoutineBuilder.exercise(next || routineState, row.exerciseId) &&
        !keepActive.customExercises?.some((entry) => entry.id === row.exerciseId),
    )
  ) {
    throw new Error('Backup contains missing references in its active workout.');
  }
  const workout = {
    ...parts.workout,
    sets: Training.normalizeSets(parts.workout.sets),
    workouts: parts.workout.workouts || [],
  };
  if (workout.training === undefined && data.training !== undefined) workout.training = data.training;
  beforeWrite?.();
  IronCore.writeBackup(localStorage, { ...parts, workout, routineState: next });
  data = workout;
  active = keepActive;
  undoItem = null;
  if (next !== undefined) routineState = next;
  if (parts.exerciseConfig !== undefined)
    exerciseConfig = Object.assign(Object.create(null), parts.exerciseConfig);
  exitManual();
  render();
  loadConfig();
  window.TrainingUI?.syncPreferences();
  window.TrainingUI?.reload();
  status('status', 'Backup restored on this device.');
}
$('export').onclick = () => {
  download('iron-log-backup.json', JSON.stringify(makeBackup(), null, 2), 'application/json');
  toast('Backup exported');
};
$('csv').onclick = () => {
  const fields = ['date', 'split', 'exercise', 'weight', 'reps', 'rir', 'notes'];
  const quote = (value) =>
    '"' +
    String(value ?? '')
      .replace(/^[=+\-@\t\r]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  download(
    'iron-log-sets.csv',
    [fields.join(','), ...data.sets.map((set) => fields.map((field) => quote(set[field])).join(','))].join('\n'),
    'text/csv',
  );
  toast('Sets exported');
};
$('import').onclick = () => $('file').click();
const recoveryKey = 'iron-log-before-replace-v1';
function showRecoveryActions() {
  const available = Boolean(read(recoveryKey, null));
  $('recoverSnapshot').hidden = $('exportSnapshot').hidden = !available;
}
function previewMerge(parts) {
  const changes = [];
  function merge(label, existing, incoming, key) {
    const result = Training.mergeRecords(existing, incoming, key);
    if (incoming.length) changes.push({ label, ...result.report });
    return result.records;
  }
  const sets = Training.mergeSets(data.sets, parts.workout.sets);
  changes.push({ label: 'Workout sets', ...sets.report });
  const body = merge('Weigh-ins', data.body, parts.workout.body, (item) => item.date);
  const workouts = merge('Workout sessions', data.workouts, parts.workout.workouts || [], (item) => item.id);
  let incoming = parts.routineState;
  if (!incoming && parts.routines) {
    incoming = RoutineBuilder.migrate(defaultPlans, parts.routines);
    incoming.routines = incoming.routines.filter((routine) => Object.hasOwn(parts.routines, routine.id));
    incoming.customExercises = incoming.customExercises.filter((entry) =>
      incoming.routines.some((routine) => routine.rows.some((row) => row.exerciseId === entry.id)),
    );
  }
  if (parts.routineState && !RoutineBuilder.usable(parts.routineState))
    throw new Error('Backup contains missing exercise references.');
  const routineStateNext = incoming
    ? {
        version: 1,
        routines: merge('Routines', routineState.routines, incoming.routines, (item) => item.id),
        customExercises: merge(
          'Custom exercises',
          routineState.customExercises,
          incoming.customExercises,
          (item) => item.id,
        ),
        favorites: merge('Favorites', routineState.favorites, incoming.favorites, (item) => item),
      }
    : undefined;
  if (routineStateNext && !RoutineBuilder.usable(routineStateNext))
    throw new Error('Merge contains missing exercise references.');
  const config =
    parts.exerciseConfig === undefined
      ? undefined
      : Object.fromEntries(
          merge(
            'Exercise settings',
            Object.entries(exerciseConfig),
            Object.entries(parts.exerciseConfig),
            (item) => item[0],
          ),
        );
  const { exerciseNotes: currentNotes, ...currentPrefs } = data.training || {};
  const { exerciseNotes: incomingNotes, ...incomingPrefs } = parts.workout.training || {};
  const workout = { ...parts.workout, ...data, sets: sets.records, body, workouts };
  if (data.training || parts.workout.training) {
    workout.training = Object.fromEntries(
      merge('Preferences', Object.entries(currentPrefs), Object.entries(incomingPrefs), (item) => item[0]),
    );
    if (incomingNotes || currentNotes)
      workout.training.exerciseNotes = Object.fromEntries(
        merge(
          'Exercise notes',
          Object.entries(currentNotes || {}),
          Object.entries(incomingNotes || {}),
          (item) => item[0],
        ),
      );
  }
  const sessions = parts.activeSession
    ? merge('Active workout', active ? [active] : [], [parts.activeSession], () => 'active')
    : [];
  return {
    changes,
    parts: { workout, routineState: routineStateNext, exerciseConfig: config, activeSession: sessions[0] },
  };
}
async function chooseRestore(parts) {
  const dialog = $('restorePreview');
  const summary = previewMerge(parts);
  $('restoreCounts').replaceChildren(
    ...summary.changes.map((change) =>
      el(
        'p',
        change.label +
          ' · ' +
          change.added +
          ' add · ' +
          change.skipped +
          ' skip · ' +
          change.conflicts +
          ' conflict' +
          (change.conflicts === 1 ? '' : 's'),
        'small',
      ),
    ),
  );
  dialog.returnValue = '';
  const option = await new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
    showDialog(dialog);
  });
  return option === 'merge' || option === 'replace' ? option : null;
}
function applyRestore(parts, mode) {
  if (mode === 'merge') restoreBackup(previewMerge(parts).parts);
  else
    restoreBackup(parts, () => {
      try {
        localStorage.setItem(recoveryKey, JSON.stringify(makeBackup()));
      } catch {
        throw new Error('Replacement cancelled. There is not enough space to save a recovery snapshot.');
      }
      showRecoveryActions();
    });
}
$('restoreCancel').onclick = () => $('restorePreview').close('cancel');
$('restoreMerge').onclick = () => $('restorePreview').close('merge');
$('restoreReplace').onclick = () => $('restorePreview').close('replace');
$('recoverSnapshot').onclick = async () => {
  try {
    const parts = IronCore.backupParts(read(recoveryKey, null));
    const mode = await chooseRestore(parts);
    if (!mode) return;
    applyRestore(parts, mode);
    toast('Snapshot restored');
    window.dispatchEvent(new Event('ironlog:saved'));
  } catch (error) {
    status('status', error.message);
  }
};
$('exportSnapshot').onclick = () => {
  const snapshot = read(recoveryKey, null);
  if (snapshot)
    download('iron-log-before-replacement.json', JSON.stringify(snapshot, null, 2), 'application/json');
};
showRecoveryActions();
$('file').onchange = async () => {
  const file = $('file').files[0];
  if (!file) return;
  try {
    const content =
      typeof file.text === 'function'
        ? await file.text()
        : await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsText(file);
          });
    const parts = IronCore.backupParts(JSON.parse(content));
    const mode = await chooseRestore(parts);
    if (!mode) return;
    applyRestore(parts, mode);
    toast(mode === 'merge' ? 'Backup merged' : 'Backup restored');
    window.dispatchEvent(new Event('ironlog:saved'));
  } catch (error) {
    status('status', error.message || 'Could not restore backup.');
  } finally {
    $('file').value = '';
  }
};

const restPref = 'iron-log-auto-rest-v1';
$('autoRest').checked = data.training?.autoRest ?? read(restPref, true) !== false;
$('autoRest').onchange = () => {
  try {
    localStorage.setItem(restPref, JSON.stringify($('autoRest').checked));
    setPreference('autoRest', $('autoRest').checked);
  } catch {
    toast('Browser storage is unavailable.');
  }
};
function updateConnectivity() {
  $('offline').hidden = navigator.onLine;
}
window.addEventListener('online', updateConnectivity);
window.addEventListener('offline', updateConnectivity);
function updateKeyboard() {
  const viewport = window.visualViewport;
  const input = document.activeElement?.matches('input:not([type=checkbox],[type=date]),textarea');
  document.body.classList.toggle('keyboard', !!input && !!viewport && innerHeight - viewport.height > 100);
}
window.visualViewport?.addEventListener('resize', updateKeyboard);
document.addEventListener('focusout', () => setTimeout(updateKeyboard, 0));
$('date').value = $('bdate').value = today();
$('headerDate').textContent = displayDate(today(), { weekday: 'short', month: 'short', day: 'numeric' });
if (trainingActive()) resumeWorkout();
render();
updateConnectivity();
setInterval(activeUI, 1000);
if ('serviceWorker' in navigator && window.isSecureContext)
  navigator.serviceWorker.register('./sw.js').catch(console.warn);
