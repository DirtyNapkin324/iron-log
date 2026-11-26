'use strict';

(() => {
  let draft, baseline, picker, editingRow;
  const stateCopy = () => RoutineBuilder.clone(routineState);
  const newRow = (exerciseId) => ({ id: RoutineBuilder.uid('row'), exerciseId });
  const button = (label, handler, className = 'quiet', accessibleName) => {
    const control = el('button', label, className);
    control.type = 'button';
    control.onclick = handler;
    if (accessibleName) control.setAttribute('aria-label', accessibleName);
    return control;
  };
  const move = (rows, from, to) => {
    if (from !== to && to >= 0 && to < rows.length) rows.splice(to, 0, rows.splice(from, 1)[0]);
  };

  function dragHandle(label, selector, index, onDrop) {
    const handle = button('⠿', null, 'dragHandle', 'Drag ' + label);
    let pointer, target, y, frame, dragged;
    const scroll = () => {
      const host = handle.closest('.sheetScroll');
      if (!host) return;
      const box = host.getBoundingClientRect();
      if (y < box.top + 35) host.scrollTop -= 8;
      else if (y > box.bottom - 35) host.scrollTop += 8;
      frame = requestAnimationFrame(scroll);
    };
    handle.onpointerdown = (event) => {
      if (pointer !== undefined || event.button !== 0) return;
      pointer = event.pointerId;
      y = event.clientY;
      handle.setPointerCapture(pointer);
      dragged = handle.closest(selector);
      dragged.dataset.dragging = 'true';
      frame = requestAnimationFrame(scroll);
    };
    handle.onpointermove = (event) => {
      if (pointer === event.pointerId) y = event.clientY;
    };
    const finish = (event) => {
      if (pointer !== event.pointerId) return;
      cancelAnimationFrame(frame);
      if (dragged) delete dragged.dataset.dragging;
      if (event.type === 'pointerup')
        target = document.elementFromPoint(event.clientX, event.clientY)?.closest(selector);
      pointer = undefined;
      if (target && target !== dragged) onDrop(index, Number(target.dataset.position));
      target = null;
    };
    handle.onpointerup = handle.onpointercancel = handle.onlostpointercapture = finish;
    return handle;
  }

  function orderControls(name, index, length, reorder) {
    const group = el('div', '', 'rowOrder');
    const up = button('↑', () => reorder(index, index - 1, 'up'), 'secondary', 'Move up ' + name);
    const down = button('↓', () => reorder(index, index + 1, 'down'), 'secondary', 'Move down ' + name);
    up.disabled = index === 0;
    down.disabled = index === length - 1;
    up.dataset.order = 'up';
    down.dataset.order = 'down';
    group.append(up, down);
    return group;
  }

  function rerenderAndFocus(container, index, direction) {
    if (!direction) return;
    const row = container.children[index];
    const control =
      row?.querySelector('[data-order="' + direction + '"]:not(:disabled)') ||
      row?.querySelector('[data-order]:not(:disabled)');
    control?.focus({ preventScroll: true });
  }

  function drawManager() {
    const live = routineState.routines.filter((routine) => !routine.archived);
    const archived = routineState.routines.filter((routine) => routine.archived);
    function manage(routine, action) {
      const next = stateCopy();
      const target = next.routines.find((item) => item.id === routine.id);
      if (action === 'duplicate') {
        target.id = RoutineBuilder.uid('routine');
        target.name = target.name.slice(0, 72) + ' copy';
        target.rows = target.rows.map((row) => ({ ...row, id: RoutineBuilder.uid('row') }));
        target.archived = false;
        const original = next.routines.findIndex((item) => item.id === routine.id);
        next.routines.splice(original, 1, RoutineBuilder.clone(routine), target);
      } else target.archived = action === 'archive';
      if (
        persistRoutines(
          next,
          action === 'archive'
            ? 'Routine archived'
            : action === 'restore'
              ? 'Routine restored'
              : 'Routine duplicated',
        )
      ) {
        renderTraining();
        drawManager();
      }
    }
    function reorder(from, to, direction) {
      const next = stateCopy();
      const ordered = next.routines.filter((routine) => !routine.archived);
      move(ordered, from, to);
      next.routines = [...ordered, ...next.routines.filter((routine) => routine.archived)];
      if (persistRoutines(next)) {
        renderTraining();
        drawManager();
        rerenderAndFocus($('savedRoutines'), to, direction);
      }
    }
    $('savedRoutines').replaceChildren(
      ...(live.length
        ? live.map((routine, index) => {
            const card = el('div', '', 'savedRoutine');
            card.dataset.position = index;
            const head = el('div', '', 'sectionLine');
            head.append(
              dragHandle(routine.name, '.savedRoutine[data-position]', index, reorder),
              el('h3', routine.name),
              orderControls(routine.name, index, live.length, reorder),
            );
            const actions = el('div', '', 'actions');
            actions.append(
              button(
                'Train',
                () => {
                  $('split').value = routine.id;
                  renderTraining();
                  $('manageRoutineDialog').close();
                  $('beginWorkout').click();
                },
                'primary',
                'Train ' + routine.name,
              ),
              button('Edit', () => openEditor(routine), 'secondary', 'Edit ' + routine.name),
              button('Duplicate', () => manage(routine, 'duplicate'), 'quiet', 'Duplicate ' + routine.name),
              button('Archive', () => manage(routine, 'archive'), 'quiet', 'Archive ' + routine.name),
            );
            card.append(head, el('p', routine.rows.length + ' exercises', 'muted small'), actions);
            return card;
          })
        : [el('p', 'Create a routine or restore one below.', 'empty')]),
    );
    $('archivedRoutines').replaceChildren(
      ...(archived.length
        ? archived.map((routine) => {
            const line = el('div', '', 'listRow sectionLine');
            line.append(
              el('span', routine.name),
              button('Restore', () => manage(routine, 'restore'), 'secondary', 'Restore ' + routine.name),
            );
            return line;
          })
        : [el('p', 'No archived routines.', 'muted small')]),
    );
  }

  function openEditor(routine, template) {
    draft = routine
      ? RoutineBuilder.clone(routine)
      : {
          id: RoutineBuilder.uid('routine'),
          name: template || '',
          archived: false,
          rows: (RoutineBuilder.templates[template] || []).map((name) =>
            newRow(RoutineBuilder.exact.get(norm(name)).id),
          ),
        };
    baseline = JSON.stringify(draft);
    $('routineDialogTitle').textContent = routine ? 'Edit routine' : 'New routine';
    $('routineName').value = draft.name;
    $('routineStatus').textContent = '';
    $('resetRoutine').hidden = !RoutineBuilder.builtIn(draft.id);
    $('routineScroll').scrollTop = 0;
    drawDraft();
    showDialog($('routineDialog'));
  }

  function editSettings(row) {
    editingRow = row;
    $('supersetLabel').hidden = draft.rows.at(-1)?.id === row.id;
    $('supersetNext').checked = row.superset === true;
    $('exerciseFormTitle').textContent = rowExercise(row).name;
    $('customFields').hidden = true;
    $('customName').required = false;
    $('clearRowConfig').hidden = false;
    fillConfig(rowSettings(row));
    showDialog($('exerciseFormDialog'));
  }

  function drawDraft() {
    let sets = 0;
    function reorder(from, to, direction) {
      move(draft.rows, from, to);
      drawDraft();
      rerenderAndFocus($('routineRows'), to, direction);
    }
    $('routineRows').replaceChildren(
      ...draft.rows.map((row, index) => {
        const entry = rowExercise(row);
        const config = rowSettings(row);
        sets += config.count;
        const card = el('li', '', 'exerciseCard');
        card.dataset.position = index;
        const title = el('div');
        title.append(
          el('h3', entry.name),
          el(
            'p',
            entry.muscle +
              ' · ' +
              config.count +
              ' sets · ' +
              config.lo +
              (config.hi === config.lo ? '' : '–' + config.hi) +
              ' reps',
            'small muted',
          ),
        );
        const head = el('div', '', 'sectionLine');
        head.append(
          dragHandle(entry.name, '.exerciseCard', index, reorder),
          title,
          orderControls(entry.name, index, draft.rows.length, reorder),
        );
        const actions = el('div', '', 'actions');
        actions.append(
          button('Edit', () => editSettings(row), 'secondary', 'Edit ' + entry.name),
          button('Replace', () => openPicker('replace', row.id), 'quiet', 'Replace ' + entry.name),
          button(
            'Duplicate',
            () => {
              draft.rows.splice(index + 1, 0, { ...RoutineBuilder.clone(row), id: RoutineBuilder.uid('row') });
              drawDraft();
            },
            'quiet',
            'Duplicate ' + entry.name,
          ),
          button(
            'Remove',
            () => {
              draft.rows.splice(index, 1);
              drawDraft();
            },
            'quiet destructive',
            'Remove ' + entry.name,
          ),
        );
        card.append(head, actions);
        return card;
      }),
    );
    $('routineTotals').textContent =
      draft.rows.length +
      (draft.rows.length === 1 ? ' exercise' : ' exercises') +
      ' · ' +
      sets +
      ' working ' +
      (sets === 1 ? 'set' : 'sets');
  }

  async function cancelEditor() {
    if (
      JSON.stringify(draft) !== baseline &&
      !(await confirmAction('Discard unsaved changes to this routine?', 'Discard changes', 'Discard changes?'))
    )
      return;
    $('routineDialog').close();
  }

  $('manageRoutines').onclick = () => {
    drawManager();
    showDialog($('manageRoutineDialog'));
  };
  $('closeManage').onclick = () => $('manageRoutineDialog').close();
  $('newRoutine').onclick = () => openEditor();
  $('routineTemplates').replaceChildren(
    ...Object.keys(RoutineBuilder.templates).map((name) =>
      button(name, () => openEditor(null, name), 'settingRow'),
    ),
  );
  $('editRoutine').onclick = () => {
    const routine = routineById($('split').value);
    if (routine) openEditor(routine);
  };
  $('closeRoutine').onclick = cancelEditor;
  $('routineDialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    cancelEditor();
  });
  $('routineName').oninput = () => {
    draft.name = $('routineName').value;
  };
  $('addRoutineRow').onclick = () => openPicker('add');
  $('resetRoutine').onclick = async () => {
    if (!(await confirmAction('Replace this draft’s exercises with the original defaults?', 'Reset draft')))
      return;
    const defaults = RoutineBuilder.migrate(defaultPlans, {}).routines.find((routine) => routine.id === draft.id);
    draft.rows = defaults.rows;
    drawDraft();
  };
  $('saveRoutine').onclick = () => {
    draft.name = draft.name.trim();
    if (draft.rows.length) delete draft.rows.at(-1).superset;
    if (!draft.name || !draft.rows.length) {
      $('routineStatus').textContent = 'Enter a routine name and add at least one exercise.';
      return;
    }
    const next = stateCopy();
    const index = next.routines.findIndex((routine) => routine.id === draft.id);
    if (index < 0) next.routines.push(draft);
    else next.routines[index] = draft;
    if (!persistRoutines(next, 'Routine saved')) return;
    $('routineDialog').close();
    if (!trainingActive()) {
      syncRoutineOptions();
      $('split').value = draft.id;
    }
    suggestions();
    renderTraining();
    if ($('manageRoutineDialog').open) drawManager();
  };

  const fields = { count: 'rowSets', rest: 'rowRest', lo: 'rowLo', hi: 'rowHi', step: 'rowStep' };
  function fillConfig(config) {
    for (const [field, id] of Object.entries(fields))
      $(id).value = field === 'step' ? weightInput(config[field]) : config[field];
    $('rowRir').value = config.rir ?? '';
    $('rowInstructions').value = config.instructions ?? '';
    $('exerciseFormStatus').textContent = '';
  }
  $('cancelExerciseForm').onclick = () => $('exerciseFormDialog').close();
  $('clearRowConfig').onclick = () => {
    delete editingRow.config;
    drawDraft();
    $('exerciseFormDialog').close();
  };
  $('exerciseForm').onsubmit = (event) => {
    event.preventDefault();
    const config = Object.fromEntries(
      Object.entries(fields).map(([field, id]) => [
        field,
        field === 'step' ? inputPounds($(id).value) : Number($(id).value),
      ]),
    );
    const initialStep = editingRow ? rowSettings(editingRow).step : RoutineBuilder.defaultConfig.step;
    if ($('rowStep').value === weightInput(initialStep)) config.step = initialStep;
    if ($('rowRir').value !== '') config.rir = Number($('rowRir').value);
    if ($('rowInstructions').value.trim()) config.instructions = $('rowInstructions').value.trim();
    if (!IronCore.validPrescription(config)) {
      $('exerciseFormStatus').textContent = 'Check that the minimum reps do not exceed the maximum.';
      return;
    }
    if (editingRow) {
      editingRow.config = config;
      const index = draft.rows.indexOf(editingRow);
      if (!$('supersetLabel').hidden && $('supersetNext').checked) {
        if (draft.rows[index - 1]?.superset) delete draft.rows[index - 1].superset;
        if (draft.rows[index + 1]?.superset) delete draft.rows[index + 1].superset;
        editingRow.superset = true;
      } else delete editingRow.superset;
      drawDraft();
    } else {
      const name = $('customName').value.trim();
      if (!name || allExercises().some((item) => norm(item.name) === norm(name))) {
        $('exerciseFormStatus').textContent =
          'Enter a unique name that identifies this exercise and its equipment.';
        return;
      }
      const split = (id) =>
        $(id)
          .value.split(',')
          .map((value) => value.trim())
          .filter(Boolean);
      const entry = {
        id: RoutineBuilder.uid('custom'),
        name,
        aliases: split('customAliases'),
        muscle: $('customMuscle').value,
        equipment: $('customEquipment').value,
        secondary: split('customSecondary'),
        defaults: config,
      };
      const next = stateCopy();
      next.customExercises.push(entry);
      if (!persistRoutines(next, 'Custom exercise created')) return;
      if (picker.mode !== 'add') picker.selected.clear();
      picker.selected.add(entry.id);
      picker.scope = 'all';
      $('exerciseSearch').value = name;
      $('filterMuscle').value = $('filterEquipment').value = '';
      drawPicker();
    }
    $('exerciseFormDialog').close();
  };

  const allExercises = () => [...ExerciseLibrary.exercises, ...routineState.customExercises];
  const options = (id, values, placeholder) => {
    $(id).replaceChildren(
      ...(placeholder ? [new Option(placeholder, '')] : []),
      ...values.map((value) => new Option(value, value)),
    );
  };
  function openPicker(mode, rowId) {
    picker = { mode, rowId, scope: 'all', selected: new Set() };
    const muscles = [
      ...new Set(
        allExercises()
          .map((item) => item.muscle)
          .concat('Other'),
      ),
    ].sort();
    const equipment = [...new Set(ExerciseLibrary.equipment.concat('Other'))].sort();
    options('filterMuscle', muscles, 'All muscles');
    options('filterEquipment', equipment, 'All equipment');
    options('customMuscle', muscles);
    options('customEquipment', equipment);
    $('exerciseSearch').value = '';
    $('pickerTitle').textContent =
      mode === 'add' ? 'Add exercises' : mode === 'today' ? 'Swap for today' : 'Replace exercise';
    drawPicker();
    $('pickerList').scrollTop = 0;
    showDialog($('exercisePicker'));
  }

  function recentExercises() {
    const entries = new Map();
    for (const set of [...data.sets].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))) {
      const id = exerciseIdentity(set);
      if (!entries.has(id))
        entries.set(
          id,
          RoutineBuilder.exercise(routineState, id) || {
            id,
            name: set.exercise,
            aliases: [],
            muscle: 'Other',
            secondary: [],
            equipment: 'Other',
            defaults: RoutineBuilder.defaultConfig,
          },
        );
      if (entries.size === 30) break;
    }
    return entries;
  }

  function pickerSelection() {
    $('addSelected').disabled = !picker.selected.size;
    $('addSelected').textContent =
      picker.mode === 'add'
        ? 'Add ' +
          (picker.selected.size
            ? picker.selected.size + (picker.selected.size === 1 ? ' exercise' : ' exercises')
            : 'exercises')
        : picker.mode === 'today'
          ? 'Swap exercise'
          : 'Replace exercise';
  }

  function drawPicker() {
    const query = norm($('exerciseSearch').value).split(/\s+/).filter(Boolean);
    const muscle = $('filterMuscle').value;
    const equipment = $('filterEquipment').value;
    const recent = recentExercises();
    let pool =
      picker.scope === 'recent'
        ? [...recent.values()]
        : [...new Map([...allExercises(), ...recent.values()].map((item) => [item.id, item])).values()].sort(
            (a, b) => a.name.localeCompare(b.name),
          );
    if (picker.scope === 'favorites') pool = pool.filter((item) => routineState.favorites.includes(item.id));
    for (const control of document.querySelectorAll('[data-scope]')) {
      control.setAttribute('aria-pressed', String(control.dataset.scope === picker.scope));
    }
    const rows = pool.filter(
      (item) =>
        (!muscle || item.muscle === muscle || item.secondary.includes(muscle)) &&
        (!equipment || item.equipment === equipment) &&
        query.every((word) =>
          norm([item.name, ...item.aliases, item.muscle, item.equipment].join(' ')).includes(word),
        ),
    );
    $('pickerList').replaceChildren(
      ...(rows.length
        ? rows.map((item) => {
            const row = el('div', '', 'pickerEntry');
            const input = el('input');
            input.type = picker.mode === 'add' ? 'checkbox' : 'radio';
            input.name = 'pickerExercise';
            input.checked = picker.selected.has(item.id);
            input.setAttribute('aria-label', item.name);
            input.onchange = () => {
              if (picker.mode !== 'add') picker.selected.clear();
              if (input.checked) picker.selected.add(item.id);
              else picker.selected.delete(item.id);
              pickerSelection();
            };
            const label = el('label');
            const detail = el('span');
            detail.append(el('strong', item.name), el('small', item.muscle + ' · ' + item.equipment, 'muted'));
            label.append(input, detail);
            const starred = routineState.favorites.includes(item.id);
            const star = button(
              starred ? '★' : '☆',
              () => {
                const next = stateCopy();
                if (!RoutineBuilder.exercise(next, item.id)) next.customExercises.push(item);
                if (starred) next.favorites = next.favorites.filter((id) => id !== item.id);
                else next.favorites.push(item.id);
                if (!persistRoutines(next)) return;
                drawPicker();
                [...$('pickerList').querySelectorAll('button')]
                  .find((control) => control.getAttribute('aria-label') === 'Favorite ' + item.name)
                  ?.focus({ preventScroll: true });
              },
              'quiet',
              'Favorite ' + item.name,
            );
            star.setAttribute('aria-pressed', String(starred));
            row.append(label, star);
            return row;
          })
        : [el('p', 'No exercises match this view.', 'empty')]),
    );
    pickerSelection();
  }

  $('closePicker').onclick = () => $('exercisePicker').close();
  $('exerciseSearch').oninput = drawPicker;
  $('filterMuscle').onchange = $('filterEquipment').onchange = drawPicker;
  for (const button of document.querySelectorAll('[data-scope]'))
    button.onclick = () => {
      picker.scope = button.dataset.scope;
      drawPicker();
    };
  $('customExercise').onclick = () => {
    editingRow = null;
    $('supersetLabel').hidden = true;
    $('exerciseFormTitle').textContent = 'Create exercise';
    $('customFields').hidden = false;
    $('customName').required = true;
    $('clearRowConfig').hidden = true;
    $('customName').value = $('exerciseSearch').value.trim();
    $('customAliases').value = $('customSecondary').value = '';
    $('customMuscle').value = $('customEquipment').value = 'Other';
    fillConfig(RoutineBuilder.defaultConfig);
    showDialog($('exerciseFormDialog'));
  };
  $('addSelected').onclick = () => {
    const ids = [...picker.selected];
    if (!ids.length) return;
    const recent = recentExercises();
    const next = stateCopy();
    const unknown = ids.filter((id) => !RoutineBuilder.exercise(next, id)).map((id) => recent.get(id));
    if (unknown.length) {
      next.customExercises.push(...unknown);
      if (!persistRoutines(next)) return;
    }
    if (picker.mode === 'today') {
      if (!matchesActive()) return;
      const index = active.rows.findIndex((row) => row.id === picker.rowId);
      if (index < 0) return;
      if (active.rows[index].exerciseId === ids[0]) {
        $('exercisePicker').close();
        return;
      }
      active.rows[index] = newRow(ids[0]);
      const entry = routineState.customExercises.find((item) => item.id === ids[0]);
      active.customExercises ||= [];
      if (entry && !active.customExercises.some((item) => item.id === entry.id))
        active.customExercises.push(entry);
      $('exercisePicker').close();
      chooseExercise(active.rows[index]);
      toast('Swapped for today');
      return;
    }
    if (picker.mode === 'replace') {
      const index = draft.rows.findIndex((row) => row.id === picker.rowId);
      if (index >= 0 && draft.rows[index].exerciseId !== ids[0]) draft.rows[index] = newRow(ids[0]);
    } else draft.rows.push(...ids.map(newRow));
    $('exercisePicker').close();
    drawDraft();
  };
  $('substituteExercise').onclick = () => {
    const row = currentRow();
    if (row) openPicker('today', row.id);
  };

  function fitSheets() {
    const height = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty('--builder-height', Math.floor(height) + 'px');
  }
  window.visualViewport?.addEventListener('resize', fitSheets);
  fitSheets();
})();
