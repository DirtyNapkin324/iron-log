'use strict';

(() => {
  const control = (text, action, label = text) => {
    const button = el('button', text, 'quiet');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.onclick = action;
    return button;
  };
  const workoutEntry = () => rowExercise(currentRow()) || RoutineBuilder.exact.get(norm($('exercise').value));
  const selectedWeight = () => ($('weight').value ? inputPounds($('weight').value) : null);
  const applicableBar = (entry) => ['Barbell', 'Trap bar', 'Smith machine', 'EZ bar'].includes(entry?.equipment);
  let editingWorkout;
  let month = today().slice(0, 7);
  let lastMemoKey;

  function planRows() {
    const row = matchesActive() && !editing && currentRow();
    const host = $('plannedSets');
    const submit = $('saveSet');
    $('setSubmitHome').append(submit);
    submit.classList.remove('plannedSubmit');
    submit.removeAttribute('aria-label');
    $('trainingLog').classList.toggle('planActive', Boolean(row));
    host.hidden = !row;
    $('liftTools').hidden = !matchesActive() || Boolean(editing);
    $('addWorkingSet').hidden = !row || planCount(row) >= 100;
    $('removeWorkingSet').hidden = !row || planCount(row) <= Math.max(1, setsForRow(row).filter(isWorking).length);
    $('warmupOpen').hidden = !row;
    $('platesOpen').hidden = !row || !applicableBar(workoutEntry());
    $('undoSet').hidden = !undoItem || !active || undoItem.workout !== (active.id || active.started);
    if (!row) return;
    const completed = setsForRow(row).filter(isWorking);
    const prior = previousRows($('exercise').value, row);
    const recommendation = recommend($('exercise').value, row);
    const table = el('table');
    const head = table.createTHead().insertRow();
    ['Set', 'Previous', 'Current', 'Action'].forEach((label) => head.append(el('th', label)));
    const body = table.createTBody();
    const total = Math.max(planCount(row), completed.length);
    for (let i = 0; i < total; i++) {
      const line = body.insertRow(),
        previous = prior[i],
        logged = completed[i];
      const pending = !logged && i === completed.length;
      const priorText = previous ? shownWeight(previous.weight) + ' × ' + previous.reps : '—';
      line.dataset.current = String(pending);
      line.insertCell().textContent = i + 1;
      const previousCell = line.insertCell();
      previousCell.textContent = priorText;
      if (previous?.rir) previousCell.append(el('small', previous.rir + ' RIR'));
      line.insertCell().textContent = logged
        ? shownWeight(logged.weight) + ' × ' + logged.reps
        : pending
          ? 'Up next'
          : (recommendation.weight === null ? 'Baseline' : shownWeight(recommendation.weight)) +
            ' × ' +
            recommendation.reps;
      const action = line.insertCell();
      if (logged) action.append(control('Edit', () => editSet(logged), 'Edit working set ' + (i + 1)));
      else if (pending) {
        submit.classList.add('plannedSubmit');
        submit.setAttribute('aria-label', 'Log working set ' + (i + 1));
        action.append(submit);
      }
    }
    host.replaceChildren(table);
  }

  function memoKey() {
    const row = currentRow();
    const name = $('exercise').value.trim();
    return name ? row?.exerciseId || exerciseIdentity({ exercise: name }) : '';
  }
  function refreshMemo() {
    const key = memoKey();
    $('exerciseNotesPanel').hidden = !key;
    if (key !== lastMemoKey) {
      $('exerciseMemo').value = data.training?.exerciseNotes?.[key] || '';
      lastMemoKey = key;
    }
  }
  $('saveExerciseMemo').onclick = () => {
    const key = memoKey();
    if (!key) return;
    const next = { ...data.training?.exerciseNotes };
    const value = $('exerciseMemo').value.trim();
    if (value) next[key] = value;
    else delete next[key];
    setPreference('exerciseNotes', next);
    toast('Exercise note saved');
  };
  $('exercise').addEventListener('input', refreshMemo);
  $('undoSet').onclick = () => {
    if (!undoItem || !active || undoItem.workout !== (active.id || active.started)) return;
    const { id, row } = undoItem;
    undoItem = null;
    const set = data.sets.find((item) => item.id === id);
    data.sets = data.sets.filter((item) => item.id !== id);
    $('barstop').click();
    const lift = workoutRows().find((item) => item.id === row);
    if (lift) chooseExercise(lift);
    if (set && lift) {
      $('weight').value = weightInput(set.weight);
      $('reps').value = set.reps;
      $('rir').value = set.rir;
      $('notes').value = set.notes;
      $('setKind').value = Training.kind(set);
      $('partialReps').value = set.partials || 0;
      $('failedSet').checked = Training.failed(set);
    }
    persistData('Set undone');
    storeDraft();
  };
  $('addWorkingSet').onclick = () => {
    const row = currentRow();
    if (!row || !matchesActive() || planCount(row) >= 100) return;
    active.extra ||= {};
    active.extra[row.id] = Math.max(planCount(row), setsForRow(row).filter(isWorking).length) + 1;
    persistActive();
    renderTraining();
  };

  $('removeWorkingSet').onclick = () => {
    const row = currentRow();
    if (!row || !matchesActive() || planCount(row) <= Math.max(1, setsForRow(row).filter(isWorking).length))
      return;
    active.extra ||= {};
    active.extra[row.id] = planCount(row) - 1;
    persistActive();
    renderTraining();
  };

  const draftFields = ['weight', 'reps', 'rir', 'notes', 'setKind', 'partialReps', 'failedSet'];
  function storeDraft() {
    const row = currentRow();
    if (!row || !matchesActive() || editing) return;
    active.drafts ||= {};
    active.drafts[row.id] = Object.fromEntries(
      draftFields.map((id) => [
        id,
        $(id).type === 'checkbox'
          ? $(id).checked
          : id === 'weight'
            ? $(id).value
              ? inputPounds($(id).value)
              : null
            : $(id).value,
      ]),
    );
    persistActive();
  }
  function restoreDraft() {
    const draft = active?.drafts?.[currentRow()?.id];
    if (!draft || !matchesActive() || editing) return;
    for (const id of draftFields) {
      if (draft[id] === undefined) continue;
      if ($(id).type === 'checkbox') $(id).checked = draft[id];
      else $(id).value = id === 'weight' ? weightInput(draft[id]) : draft[id];
    }
  }
  draftFields.forEach((id) => $(id).addEventListener('input', storeDraft));
  window.addEventListener('ironlog:chooseExercise', restoreDraft);
  window.addEventListener('ironlog:training', () => {
    planRows();
    refreshMemo();
  });
  restoreDraft();

  function warmupRow(item) {
    const form = el('form', '', 'warmupRow');
    const weightLabel = el('label', 'Weight (' + weightUnit() + ')');
    const repsLabel = el('label', 'Reps');
    const weight = el('input'),
      reps = el('input');
    weight.type = reps.type = 'number';
    weight.step = 'any';
    weight.min = '0';
    weight.required = true;
    reps.min = '1';
    reps.step = '1';
    reps.required = true;
    weight.value = weightInput(item.weight);
    reps.value = item.reps;
    weightLabel.append(weight);
    repsLabel.append(reps);
    const log = el('button', 'Log', 'primary');
    const skip = control('Skip', () => form.remove());
    form.append(weightLabel, repsLabel, log, skip);
    form.onsubmit = (event) => {
      event.preventDefault();
      if (
        logSet(
          { weight: inputPounds(weight.value), reps: Number(reps.value), kind: 'warmup' },
          { preserveInput: true },
        )
      ) {
        form.remove();
        $('warmupHint').textContent = 'Warm-up logged. It stays out of your working sets and records.';
      }
    };
    return form;
  }
  $('warmupOpen').onclick = () => {
    const row = currentRow(),
      entry = workoutEntry(),
      weight = selectedWeight();
    if (!row) return;
    const settings = rowSettings(row);
    const unit = weightUnit();
    const minimum = applicableBar(entry)
      ? Training.pounds(data.training?.plates?.[unit]?.bar ?? plateDefaults[unit].bar, unit)
      : 0;
    const sequence = Training.warmups(
      weight,
      settings.step,
      entry?.equipment || '',
      isIsolation(norm(entry?.name || '')),
      minimum,
    );
    $('warmupHint').textContent = sequence.length
      ? 'Suggested sequence for ' + shownWeight(weight) + '.'
      : 'Enter a working weight for suggestions, or add a warm-up below.';
    $('warmupRows').replaceChildren(...sequence.map(warmupRow));
    showDialog($('warmupDialog'));
  };
  $('warmupAdd').onclick = () => $('warmupRows').append(warmupRow({ weight: null, reps: 5 }));
  $('warmupClose').onclick = () => $('warmupDialog').close();

  const plateDefaults = {
    lb: {
      bar: 45,
      inventory: [45, 35, 25, 10, 5, 2.5].map((weight) => ({ weight, quantity: weight === 45 ? 8 : 2 })),
    },
    kg: {
      bar: 20,
      inventory: [25, 20, 15, 10, 5, 2.5, 1.25].map((weight) => ({ weight, quantity: weight >= 20 ? 6 : 2 })),
    },
  };
  let plateUnits, plateConfig;
  function plateSettings() {
    plateUnits = $('plateUnit').value;
    plateConfig = data.training?.plates?.[plateUnits] || plateDefaults[plateUnits];
    $('plateBar').value = plateConfig.bar;
    $('plateInventory').value = plateConfig.inventory
      .map((item) => item.weight + ' × ' + item.quantity)
      .join('\n');
  }
  function drawPlates() {
    const target = Number($('plateTarget').value),
      bar = Number($('plateBar').value);
    const result = $('plateResult'),
      visual = $('barbellPreview');
    visual.replaceChildren();
    if (!$('plateTarget').value || !$('plateBar').value || !$('plateBar').checkValidity() || target < 0) {
      result.textContent = 'Enter a target and bar weight.';
      return;
    }
    const { exact, lower, upper } = Training.plates(target, bar, plateConfig.inventory);
    const unit = ' ' + plateUnits;
    result.replaceChildren(
      el(
        'p',
        exact
          ? 'Load each side: ' + (lower.side.join(' + ') || 'empty bar') + unit
          : 'Target is unavailable with this inventory.',
        'small',
      ),
    );
    if (!exact)
      for (const option of [lower, upper].filter(Boolean))
        result.append(
          el('p', option.total + unit + ' · each side ' + (option.side.join(' + ') || 'empty') + unit, 'small'),
        );
    const loaded = lower || upper;
    if (loaded) {
      const plates = loaded.side.map((weight) => {
        const plate = el('div', '', 'plate');
        plate.style.height = Math.min(65, 17 + weight * 1.05) + 'px';
        return plate;
      });
      visual.append(
        ...plates
          .slice()
          .reverse()
          .map((plate) => plate.cloneNode(true)),
        el('div', '', 'shaft'),
        ...plates,
      );
    }
  }
  $('platesOpen').onclick = () => {
    $('plateUnit').value = weightUnit();
    plateSettings();
    $('plateTarget').value = weightInput(selectedWeight());
    drawPlates();
    showDialog($('platesDialog'));
  };
  $('platesClose').onclick = () => $('platesDialog').close();
  $('plateTarget').oninput = $('plateBar').oninput = drawPlates;
  $('plateUnit').onchange = () => {
    const target = $('plateTarget').value;
    const pounds = target ? Training.pounds(Number(target), plateUnits) : null;
    plateSettings();
    $('plateTarget').value = pounds === null ? '' : Number(Training.display(pounds, plateUnits).toFixed(2));
    drawPlates();
  };
  $('saveInventory').onclick = () => {
    const bar = Number($('plateBar').value);
    const lines = $('plateInventory').value.trim().split('\n').filter(Boolean);
    const inventory = [];
    for (const line of lines) {
      const parsed = line.match(/^\s*(\d{1,3}(?:\.\d{1,2})?)\s*[x×]\s*(\d{1,2})\s*$/i);
      if (parsed) inventory.push({ weight: Number(parsed[1]), quantity: Number(parsed[2]) });
    }
    if (
      !$('plateBar').value ||
      !$('plateBar').checkValidity() ||
      inventory.length !== lines.length ||
      inventory.length > 8 ||
      inventory.some((item) => item.weight <= 0 || item.weight > 100 || item.quantity > 20) ||
      new Set(inventory.map((item) => item.weight)).size !== inventory.length
    ) {
      $('plateResult').textContent = 'Enter up to eight distinct denominations with quantities from 0 to 20.';
      return;
    }
    plateConfig = { bar, inventory };
    setPreference('plates', { ...data.training?.plates, [plateUnits]: plateConfig });
    drawPlates();
    toast('Plate inventory saved');
  };

  function workoutDetails(workout) {
    if (!workout) return;
    editingWorkout = workout;
    const local = (timestamp) => {
      const d = new Date(timestamp);
      return (
        IronCore.localDay(d) +
        'T' +
        String(d.getHours()).padStart(2, '0') +
        ':' +
        String(d.getMinutes()).padStart(2, '0')
      );
    };
    $('workoutStarted').value = local(workout.started);
    $('workoutEndedLabel').hidden = workout === active;
    $('workoutEnded').required = workout !== active;
    $('workoutEnded').value = workout.finished ? local(workout.finished) : '';
    $('workoutMemo').value = workout.notes || '';
    $('workoutDetailsError').textContent = '';
    showDialog($('workoutDetails'));
  }
  $('sessionOpen').onclick = () => workoutDetails(active);
  $('workoutDetailsCancel').onclick = () => $('workoutDetails').close();
  $('workoutDetailsForm').onsubmit = (event) => {
    event.preventDefault();
    const started = new Date($('workoutStarted').value).getTime();
    const finished = editingWorkout === active ? Date.now() : new Date($('workoutEnded').value).getTime();
    if (!(started >= 0 && finished >= started)) {
      $('workoutDetailsError').textContent = 'Enter a start time before the finish time.';
      return;
    }
    editingWorkout.started = started;
    editingWorkout.notes = $('workoutMemo').value.trim();
    if (editingWorkout === active) persistActive();
    else {
      editingWorkout.finished = finished;
      persistData('Workout updated');
    }
    $('workoutDetails').close();
  };

  function calendar() {
    const first = month + '-01';
    const firstDate = stamp(first);
    $('calendarMonth').textContent = firstDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const groups = new Map(
      data.workouts.filter((item) => item.date.startsWith(month)).map((item) => [item.id, item]),
    );
    for (const set of data.sets)
      if (
        set.date.startsWith(month) &&
        (!active || set.workoutId !== active.id || !active.id) &&
        !groups.has(Training.sessionKey(set))
      ) {
        groups.set(Training.sessionKey(set), { date: set.date, name: splitName(set.split) });
      }
    const dates = new Map();
    for (const workout of groups.values()) {
      if (!dates.has(workout.date)) dates.set(workout.date, []);
      dates.get(workout.date).push(workout);
    }
    const minutes = [...groups.values()].reduce(
      (sum, item) => sum + (item.finished ? (item.finished - item.started) / 60000 : 0),
      0,
    );
    const daysInMonth = new Date(firstDate.getFullYear(), firstDate.getMonth() + 1, 0).getDate();
    $('calendarMetrics').textContent =
      groups.size +
      (groups.size === 1 ? ' workout' : ' workouts') +
      ' · ' +
      ((dates.size * 7) / daysInMonth).toFixed(1) +
      ' active days/week · ' +
      Math.round(minutes) +
      ' min recorded';
    const items = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => el('span', day, 'weekday'));
    for (let i = 0; i < firstDate.getDay(); i++) items.push(el('span'));
    for (let d = 1; d <= daysInMonth; d++) {
      const day = month + '-' + String(d).padStart(2, '0');
      const workouts = dates.get(day) || [];
      const label =
        displayDate(day) + (workouts.length ? ' · ' + workouts.map((item) => item.name).join(', ') : '');
      const button = control(
        String(d),
        () => {
          calendarDay = calendarDay === day ? '' : day;
          renderHistory();
        },
        label,
      );
      button.setAttribute('aria-pressed', String(calendarDay === day));
      button.dataset.trained = String(workouts.length > 0);
      if (workouts.length)
        button.append(el('small', workouts.length > 1 ? workouts.length + ' workouts' : workouts[0].name));
      items.push(button);
    }
    $('calendarGrid').replaceChildren(...items);
    $('clearCalendarDay').hidden = !calendarDay;
  }
  function changeMonth(delta) {
    const date = stamp(month + '-01');
    date.setMonth(date.getMonth() + delta);
    month = IronCore.localDay(date).slice(0, 7);
    calendarDay = '';
    renderHistory();
  }
  $('monthPrevious').onclick = () => changeMonth(-1);
  $('monthNext').onclick = () => changeMonth(1);
  $('clearCalendarDay').onclick = () => {
    calendarDay = '';
    renderHistory();
  };

  function analytics() {
    const key = $('progress').value;
    const matches = Training.records(
      regular().filter((set) => exerciseIdentity(set) === key),
      exerciseIdentity,
    ).best;
    $('personalRecords').replaceChildren(
      ...(matches.length
        ? matches.map((record) => {
            const line = el('div', '', 'recordRow sectionLine');
            const label = record.key.startsWith('reps-')
              ? 'Most reps at ' + shownWeight(record.set.weight)
              : record.label;
            line.append(
              el('span', label),
              el('strong', record.key.startsWith('reps-') ? record.value + ' reps' : shownWeight(record.value)),
            );
            return line;
          })
        : [el('p', 'Log working sets to see records for the selected exercise.', 'small muted')]),
    );
    const range = $('muscleRange').value;
    $('muscleCustom').hidden = range !== 'custom';
    const end = range === 'custom' ? $('muscleTo').value : today();
    const start = range === 'custom' ? $('muscleFrom').value : IronCore.shiftDay(end, 1 - Number(range));
    if (!start || !end || start > end) {
      $('muscleChart').textContent = 'Choose a valid date range.';
      return;
    }
    const length = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
    const prior = IronCore.shiftDay(start, -length);
    const lookup = (set) => RoutineBuilder.exercise(routineState, exerciseIdentity(set));
    const current = Training.muscleVolume(
      regular().filter((set) => set.date >= start && set.date <= end),
      lookup,
    );
    const previous = Training.muscleVolume(
      regular().filter((set) => set.date >= prior && set.date < start),
      lookup,
    );
    const muscles = [...new Set([...current.keys(), ...previous.keys()])].sort(
      (a, b) => (current.get(b)?.direct || 0) - (current.get(a)?.direct || 0) || a.localeCompare(b),
    );
    const max = Math.max(1, ...muscles.map((muscle) => current.get(muscle)?.direct || 0));
    $('muscleChart').replaceChildren(
      ...(muscles.length
        ? muscles.map((muscle) => {
            const { direct = 0, secondary = 0 } = current.get(muscle) || {};
            const delta = direct - (previous.get(muscle)?.direct || 0);
            const row = el('div', '', 'muscleRow');
            row.append(
              el('strong', muscle),
              el(
                'p',
                direct +
                  ' direct · ' +
                  secondary +
                  ' secondary · ' +
                  (delta > 0 ? '+' : '') +
                  delta +
                  ' direct vs previous',
                'small muted',
              ),
            );
            const bar = el('progress');
            bar.max = max;
            bar.value = direct;
            bar.setAttribute('aria-label', muscle + ' direct working sets');
            row.append(bar);
            return row;
          })
        : [el('p', 'No working sets in these periods.', 'small muted')]),
    );
  }
  $('muscleTo').value = today();
  $('muscleFrom').value = IronCore.shiftDay(today(), -6);
  for (const id of ['muscleRange', 'muscleFrom', 'muscleTo']) $(id).onchange = analytics;
  $('bodyGoalForm').onsubmit = (event) => {
    event.preventDefault();
    const goal = $('bodyGoal').value ? inputPounds($('bodyGoal').value) : null;
    if (goal !== null && !(goal >= 1 && goal <= 1500)) {
      toast('Enter a valid bodyweight goal.');
      return;
    }
    setPreference('bodyGoal', goal);
    toast(goal ? 'Bodyweight goal saved' : 'Bodyweight goal cleared');
  };

  function syncPreferences() {
    const unit = weightUnit();
    $('weightUnit').value = unit;
    $('restSound').checked = data.training?.restSound === true;
    $('restVibration').checked = data.training?.restVibration !== false;
    $('bodyGoal').value = weightInput(data.training?.bodyGoal);
    $('autoRest').checked = data.training?.autoRest ?? read(restPref, true) !== false;
    document.querySelectorAll('.unitWeight').forEach((label) => (label.textContent = 'Weight (' + unit + ')'));
    document
      .querySelectorAll('.unitIncrement')
      .forEach((label) => (label.textContent = 'Increment (' + unit + ')'));
    document.querySelectorAll('.unitGoal').forEach((label) => (label.textContent = 'Goal (' + unit + ')'));
    document.querySelectorAll('.unitText').forEach((label) => (label.textContent = unit));
  }
  $('weightUnit').onchange = () => {
    storeDraft();
    setPreference('unit', $('weightUnit').value);
    syncPreferences();
    restoreDraft();
    loadConfig();
  };
  $('restSound').onchange = () => {
    setPreference('restSound', $('restSound').checked);
    unlockAudio();
  };
  $('restVibration').onchange = () => setPreference('restVibration', $('restVibration').checked);
  window.TrainingUI = {
    calendar,
    analytics,
    workoutDetails,
    syncPreferences,
    reload: () => {
      lastMemoKey = null;
      refreshMemo();
    },
  };
  syncPreferences();
  calendar();
  analytics();
  planRows();
  refreshMemo();
})();
