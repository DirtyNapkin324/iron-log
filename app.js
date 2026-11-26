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
const isWorking = (set) => !/drop set|warm.?up/i.test(set.notes || '');
const splitName = (split) =>
  split === 'Fitness assignment' ? 'Separate workout' : routineById(split)?.name || split;
const sessionSets = (date = $('date').value, split = $('split').value) =>
  data.sets.filter((set) => set.date === date && set.split === split);
const regular = () => data.sets.filter((set) => set.split !== 'Fitness assignment');
const volume = (sets) => sets.reduce((sum, set) => sum + set.weight * set.reps, 0);
const exerciseCount = (sets) => new Set(sets.map((set) => exerciseIdentity(set))).size;
const est = (set) => (set.reps === 1 ? set.weight : set.reps <= 10 ? set.weight * (1 + set.reps / 30) : null);

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

let data = read(key, {});
if (!Array.isArray(data.sets) || !Array.isArray(data.body)) data = { sets: [], body: [] };
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
function confirmAction(message, action = 'Continue', title = 'Confirm action') {
  const dialog = $('confirmation');
  if (dialog.open) return Promise.resolve(false);
  if (!dialog.showModal) return Promise.resolve(window.confirm(message));
  $('confirmTitle').textContent = title;
  $('confirmMessage').textContent = message;
  $('confirmAction').textContent = action;
  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
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
  let valid = (s) => !/drop set|warm.?up/i.test(s.notes || '') && s.weight > 0 && s.reps > 0;
  let prior = history.filter(valid),
    done = current.filter(valid),
    lastDate = prior
      .map((s) => s.date)
      .sort()
      .at(-1),
    last = prior.filter((s) => s.date === lastDate),
    idx = done.length,
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
        (cfg?.rir === undefined || !/failed|not completed|very heavy/i.test(s.notes || '')),
    );
  let unknown = prev.rir === '' || prev.rir == null,
    failed = /failed|not completed|very heavy/i.test(prev.notes || '') || (!unknown && Number(prev.rir) === 0);
  result.weight = prev.weight;
  result.reps = Math.max(lo, Math.min(hi, prev.reps));
  if (n.includes('machine not confirmed')) {
    result.why =
      'Machine unconfirmed: use this only if it is the same machine; otherwise establish a new baseline.';
    return result;
  }
  if (allReady && hi > lo && !n.includes('face pull')) {
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
  let dates = [...new Set(prior.map((s) => s.date))].sort().slice(-3);
  if (
    dates.length === 3 &&
    !allReady &&
    dates.every((d) => prior.filter((s) => s.date === d).every((s) => s.reps < hi && Number(s.rir || -1) === 0))
  ) {
    result.weight = Math.max(0, Math.round((prev.weight - step) * 100) / 100);
    result.reps = lo;
    result.why =
      'Three recent sessions near failure without reaching the rep target. Try one increment lighter and rebuild.';
  }
  let recent = done.at(-1);
  if (recent && (recent.reps < lo || recent.rir === '0')) {
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
function recommend(name, row = currentRow()) {
  const split = $('split').value,
    date = $('date').value;
  const same = (set) =>
    matchesExercise(set, name, row) && (set.split === 'Fitness assignment') === (split === 'Fitness assignment');
  return prescription(
    norm(name),
    data.sets.filter((set) => same(set) && set.date < date),
    row ? setsForRow(row) : sessionSets().filter(same),
    row ? rowSettings(row) : undefined,
  );
}

function trainingActive() {
  return Boolean(active && active.date === today());
}
function matchesActive() {
  return trainingActive() && active.date === $('date').value && active.split === $('split').value;
}

function previousPerformance(name, row) {
  const separate = $('split').value === 'Fitness assignment';
  const previous = data.sets
    .filter(
      (set) =>
        set.date < $('date').value &&
        matchesExercise(set, name, row) &&
        (set.split === 'Fitness assignment') === separate &&
        isWorking(set),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))[0];
  return previous
    ? number(previous.weight) + ' lb × ' + previous.reps + (previous.rir ? ' · ' + previous.rir + ' RIR' : '')
    : '—';
}

function target() {
  const name = $('exercise').value.trim();
  $('exerciseTitle').textContent = name || 'Choose exercise';
  $('saveSet').disabled = !name;
  const row = currentRow();
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
    $('setProgress').replaceChildren();
    $('recommendationWhy').textContent = '';
    return;
  }
  const recommendation = recommend(name);
  const done = (row ? setsForRow(row) : sessionSets().filter((set) => matchesExercise(set, name, null))).filter(
    isWorking,
  ).length;
  $('setProgress').replaceChildren(
    ...Array.from({ length: recommendation.count }, (_, i) => el('span', '', i < done ? 'done' : '')),
  );
  $('setProgressText').textContent = done + ' of ' + recommendation.count + ' working sets';
  $('target').textContent =
    recommendation.weight === null
      ? 'Baseline × ' + recommendation.reps
      : number(recommendation.weight) + ' lb × ' + recommendation.reps;
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
  $('weight').value = r.weight ?? '';
  $('reps').value = r.reps;
  $('rir').value = $('notes').value = '';
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
    $(id).value = r[field];
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
function renderTraining() {
  syncRoutineOptions();
  const split = $('split').value;
  const queue = workoutRows();
  const rows = sessionSets();
  const showLogger = trainingActive() || manual || Boolean(editing);
  const available = routineById(split) && !routineById(split).archived && queue.length;
  $('trainingLog').hidden = !showLogger;
  $('workoutSetup').hidden = showLogger;
  $('finishWorkout').hidden = !matchesActive() || !!editing;
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
  $('sessionstats').textContent = rows.length + ' sets · ' + number(volume(rows)) + ' lb';
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
        el('span', done + '/' + rowSettings(row).count, 'planCount'),
      );
      if (showLogger) item.onclick = () => chooseExercise(row, true);
      if (showLogger && currentRow()?.id === row.id) item.setAttribute('aria-current', 'true');
      line.append(item);
      return line;
    }),
  );
  $('currentsets').replaceChildren(setTable(rows, { showExercise: true, repeat: true }));
  activeUI();
  target();
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
$('nextExercise').onclick = () => {
  const queue = workoutRows();
  const i = queue.findIndex((row) => row.id === currentRow()?.id);
  if (i + 1 < queue.length) chooseExercise(queue[i + 1]);
  else toast('You reached the end of this routine.');
};

$('log').onsubmit = (event) => {
  event.preventDefault();
  if (Date.now() - lastSubmitAt < 750 || !$('exercise').value.trim() || !$('weight').value || !$('reps').value)
    return;
  lastSubmitAt = Date.now();
  const old = editing ? data.sets.find((set) => set.id === editing) : null;
  const row = currentRow();
  const item = {
    ...old,
    id: editing || Date.now().toString().padStart(14, '0') + '-' + Math.random().toString(36).slice(2),
    date: $('date').value,
    split: $('split').value,
    exercise: $('exercise').value.trim(),
    weight: Number($('weight').value),
    reps: Number($('reps').value),
    rir: $('rir').value,
    notes: $('notes').value,
  };
  if (row) {
    item.exerciseId = row.exerciseId;
    item.routineRowId = row.id;
  } else if (repeatOrigin?.exercise === item.exercise) {
    if (repeatOrigin.exerciseId) item.exerciseId = repeatOrigin.exerciseId;
    if (repeatOrigin.routineRowId && repeatOrigin.split === item.split)
      item.routineRowId = repeatOrigin.routineRowId;
  } else if (old && (old.exercise !== item.exercise || old.split !== item.split)) {
    delete item.exerciseId;
    delete item.routineRowId;
  }
  if (editing) data.sets = data.sets.map((set) => (set.id === editing ? item : set));
  else data.sets.push(item);
  const wasEdit = Boolean(editing);
  resetEdit();
  persistData(wasEdit ? 'Set updated' : 'Set logged');
  if (wasEdit) {
    exitManual();
    return;
  }
  applyTarget();
  if ($('autoRest').checked) startRest(recommend(item.exercise).rest);
  if (!matchesActive()) return;
  const queue = workoutRows();
  const position = queue.findIndex((item) => item.id === row?.id);
  if (position >= 0 && setsForRow(row).filter(isWorking).length >= rowSettings(row).count) {
    const next = queue
      .slice(position + 1)
      .find((item) => setsForRow(item).filter(isWorking).length < rowSettings(item).count);
    if (next) chooseExercise(next);
  }
};

function activeUI() {
  const min = matchesActive() ? Math.max(0, Math.floor((Date.now() - active.started) / 60000)) : 0;
  $('activeWorkoutInfo').textContent = matchesActive()
    ? (active.name || splitName(active.split)) + ' · ' + min + ' min'
    : 'Set logger';
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
  const next = queue.find((row) => setsForRow(row).filter(isWorking).length < rowSettings(row).count);
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
$('finishWorkout').onclick = async () => {
  if (!matchesActive()) return;
  if (
    !(await confirmAction(
      'Finish this training session and see your results?',
      'Finish workout',
      'Finish workout?',
    ))
  )
    return;
  const sets = sessionSets(active.date, active.split);
  const minutes = Math.max(0, Math.floor((Date.now() - active.started) / 60000));
  $('summarySplit').textContent = (active.name || splitName(active.split)) + ' · ' + displayDate(active.date);
  $('summaryMetrics').replaceChildren(
    metric(sets.length, 'Sets'),
    metric(exerciseCount(sets), 'Exercises'),
    metric(minutes + ' min', 'Duration'),
    metric(number(volume(sets)) + ' lb', 'Volume'),
  );
  active = null;
  persistActive();
  exitManual();
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
    step: Number($('cfgStep').value),
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
    if (set.notes || set.rir)
      row.cells[0].append(el('small', [set.rir && set.rir + ' RIR', set.notes].filter(Boolean).join(' · ')));
    row.insertCell().textContent = number(set.weight) + ' lb';
    row.insertCell().textContent = set.reps;
    const actions = row.insertCell();
    const edit = el('button', 'Edit', 'quiet');
    edit.onclick = () => editSet(set);
    actions.append(edit);
    if (repeat) {
      const button = el('button', 'Repeat', 'quiet');
      button.onclick = () => editSet(set, true);
      actions.append(button);
    } else {
      const remove = el('button', 'Delete', 'quiet destructive');
      remove.onclick = async () => {
        if (!(await confirmAction('Remove this set from your workout history?', 'Delete set', 'Delete set?')))
          return;
        data.sets = data.sets.filter((item) => item.id !== set.id);
        persistData('Set deleted');
      };
      actions.append(remove);
    }
  });
  return table;
}

function renderHistory() {
  const history = $('history');
  const open = new Set([...history.querySelectorAll('details[open]')].map((card) => card.dataset.session));
  const filter = $('filter').value;
  const search = norm($('searchHistory').value);
  const groups = new Map();
  const sets = data.sets
    .filter(
      (set) => filter === 'All' || (set.split === 'Fitness assignment') === (filter === 'Fitness assignment'),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  for (const set of sets) {
    const key = set.date + ' ' + set.split;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(set);
  }
  const cards = [];
  for (const [key, workout] of groups) {
    const { date, split } = workout[0];
    if (
      search &&
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
      el('strong', splitName(split)),
      el(
        'span',
        displayDate(date) +
          ' · ' +
          count +
          (count === 1 ? ' exercise' : ' exercises') +
          ' · ' +
          number(volume(workout)) +
          ' lb',
        'historyMeta',
      ),
    );
    summary.append(title);
    card.append(summary);
    card.dataset.session = key;
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
      el('p', data.sets.length ? 'No workouts match these filters.' : 'Your first workout will appear here.'),
    );
    if (!data.sets.length) {
      const start = el('button', 'Go to Train', 'primary');
      start.onclick = () => tab('workout');
      empty.append(start);
    }
    cards.push(empty);
  }
  history.replaceChildren(...cards);
}
$('filter').onchange = renderHistory;
$('searchHistory').oninput = renderHistory;

function inRange(date, range) {
  return date <= today() && (range === 'all' || date >= IronCore.shiftDay(today(), 1 - Number(range)));
}

function plot(id, emptyId, points, color, unit) {
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
  const values = points.map((point) => point[1]);
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
  const selectedSets = sets.filter((set) => exerciseIdentity(set) === selected);
  const estimates = new Map();
  for (const set of selectedSets) {
    const value = est(set);
    if (value !== null) estimates.set(set.date, Math.max(estimates.get(set.date) || 0, value));
  }
  const points = [...estimates].sort(([a], [b]) => a.localeCompare(b));
  $('records').replaceChildren(
    metric(
      selectedSets.length ? number(Math.max(...selectedSets.map((set) => set.weight))) + ' lb' : '—',
      'Heaviest set',
    ),
    metric(
      points.length ? number(Math.round(Math.max(...points.map((point) => point[1])))) + ' lb' : '—',
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
          frequency + (frequency === 1 ? ' day' : ' days') + ' · ' + number(volume(sets)) + ' lb',
          'weekValue',
        ),
        bar,
      );
      return row;
    });
  $('progressOverview').replaceChildren(
    ...(rows.length ? rows : [el('p', 'Weekly totals will appear after your first workout.', 'empty')]),
  );
  plot('chart', 'chartEmpty', points, '#c1f65d', 'lb');
}
$('progress').onchange = $('progressRange').onchange = renderProgress;

$('bodyform').onsubmit = (event) => {
  event.preventDefault();
  const date = $('bdate').value;
  data.body = data.body.filter((entry) => entry.date !== date);
  data.body.push({ date, weight: Number($('bodyweight').value) });
  $('bodyweight').value = '';
  persistData('Weight recorded');
};

function renderBody() {
  const entries = [...data.body].sort((a, b) => a.date.localeCompare(b.date));
  const latest = entries[entries.length - 1];
  $('bw').textContent = latest ? number(latest.weight) + ' lb' : '—';
  $('bodyLatestDate').textContent = latest ? displayDate(latest.date) : 'No weigh-ins yet';
  const week = entries.filter((entry) => inRange(entry.date, '7'));
  const selected = entries.filter((entry) => inRange(entry.date, $('bodyRange').value));
  const change = selected.length > 1 ? selected[selected.length - 1].weight - selected[0].weight : null;
  $('bodytrend').replaceChildren(
    metric(
      week.length ? number(week.reduce((sum, entry) => sum + entry.weight, 0) / week.length) + ' lb' : '—',
      '7-day average',
    ),
    metric(change === null ? '—' : (change > 0 ? '+' : '') + number(change) + ' lb', 'Period change'),
  );
  $('bodyhistory').replaceChildren(
    ...(entries.length
      ? entries
          .slice()
          .reverse()
          .slice(0, 10)
          .map((entry) => {
            const row = el('div', '', 'sectionLine listRow');
            const label = el('div', displayDate(entry.date) + ' · ' + number(entry.weight) + ' lb');
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
  plot(
    'bodyChart',
    'bodyChartEmpty',
    selected.map((entry) => [entry.date, entry.weight]),
    '#c1f65d',
    'lb',
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
let deadline = 0,
  interval,
  paused = 0,
  alarm = false;
function persistRest() {
  try {
    localStorage.setItem('iron-log-rest-v1', JSON.stringify({ deadline, paused }));
  } catch {}
}
function tick() {
  let left = paused || Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  $('timer').textContent = $('barclock').textContent =
    String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
  if (!left) {
    clearInterval(interval);
    $('timer').textContent = $('barclock').textContent = 'Done';
    deadline = 0;
    persistRest();
    if (!alarm) {
      alarm = true;
      if (navigator.vibrate) navigator.vibrate(200);
    }
  }
}
function startRest(sec) {
  clearInterval(interval);
  paused = 0;
  alarm = false;
  deadline = Date.now() + sec * 1000;
  $('timerbar').hidden = false;
  $('pauseRest').textContent = $('barpause').textContent = 'Pause';
  persistRest();
  tick();
  interval = setInterval(tick, 250);
}
function pauseRest() {
  if (paused) {
    startRest(paused);
    return;
  }
  if (!deadline) return;
  paused = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
  deadline = 0;
  clearInterval(interval);
  $('pauseRest').textContent = $('barpause').textContent = 'Resume';
  persistRest();
  tick();
}
$('pauseRest').onclick = $('barpause').onclick = pauseRest;
$('extendRest').onclick = () => {
  if (paused) {
    paused += 30;
    persistRest();
    tick();
  } else startRest(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) + 30);
};
document.querySelectorAll('[data-rest]').forEach((b) => (b.onclick = () => startRest(Number(b.dataset.rest))));
$('stop').onclick = $('barstop').onclick = () => {
  clearInterval(interval);
  deadline = paused = 0;
  persistRest();
  $('timerbar').hidden = true;
  $('timer').textContent = 'Stopped';
  $('pauseRest').textContent = $('barpause').textContent = 'Pause';
};
try {
  let t = JSON.parse(localStorage.getItem('iron-log-rest-v1') || 'null');
  if (t?.paused > 0) {
    paused = t.paused;
    $('timerbar').hidden = false;
    $('pauseRest').textContent = $('barpause').textContent = 'Resume';
    tick();
  } else if (t?.deadline > Date.now()) {
    deadline = t.deadline;
    $('timerbar').hidden = false;
    tick();
    interval = setInterval(tick, 250);
  }
} catch {}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (deadline || paused)) tick();
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
  return { ...data, routines, exerciseConfig, routineState };
}
function restoreBackup(parts) {
  const next =
    parts.routineState ??
    (parts.routines !== undefined
      ? RoutineBuilder.migrate(defaultPlans, parts.routines, routineState)
      : undefined);
  if (next !== undefined && !RoutineBuilder.usable(next))
    throw new Error('Backup contains missing exercise or routine references.');
  // Keep references from the current workout snapshot if a backup replaces the custom library.
  if (next && active?.customExercises) {
    for (const entry of active.customExercises) {
      if (!RoutineBuilder.exercise(next, entry.id)) next.customExercises.push(entry);
    }
  }
  IronCore.writeBackup(localStorage, { ...parts, routineState: next });
  data = parts.workout;
  if (next !== undefined) routineState = next;
  if (parts.exerciseConfig !== undefined)
    exerciseConfig = Object.assign(Object.create(null), parts.exerciseConfig);
  exitManual();
  render();
  loadConfig();
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
    if (
      !(await confirmAction(
        'Replace local workouts and settings included in this backup?',
        'Restore backup',
        'Restore local backup?',
      ))
    )
      return;
    restoreBackup(parts);
    toast('Backup restored');
    window.dispatchEvent(new Event('ironlog:saved'));
  } catch (error) {
    status('status', error.message || 'Could not restore backup.');
  } finally {
    $('file').value = '';
  }
};

const restPref = 'iron-log-auto-rest-v1';
$('autoRest').checked = read(restPref, true) !== false;
$('autoRest').onchange = () => {
  try {
    localStorage.setItem(restPref, JSON.stringify($('autoRest').checked));
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
setInterval(activeUI, 15000);
if ('serviceWorker' in navigator && window.isSecureContext)
  navigator.serviceWorker.register('./sw.js').catch(console.warn);
