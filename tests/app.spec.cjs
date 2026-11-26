const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');

const user = '10000000-0000-0000-0000-000000000001';
const friend = '10000000-0000-0000-0000-000000000002';
const groupId = '20000000-0000-0000-0000-000000000001';
const invite = '30000000-0000-0000-0000-000000000001';
const tokenKey = 'iron-log-social-session-v1';
const code = '1234567890abcdef1234567890abcdef';
const newCode = 'abcdabcdabcdabcdabcdabcdabcdabcd';
const backup = {
  sets: [{ id: 'legacy-set', date: '2025-01-01', split: 'Push', exercise: 'Bench press',
    weight: 105, reps: 6, rir: '', notes: 'legacy set' }],
  body: [{ date: '2025-01-01', weight: 165 }],
  routines: { Push: ['Bench press', 'Weighted dips'] },
  exerciseConfig: { 'bench press': { count: 4, lo: 5, hi: 8, step: 2.5, rest: 150 } }
};

const makeSession = () => ({
  access_token: 'test-token', refresh_token: 'test-refresh', expires_at: Date.now() / 1000 + 3600,
  user: { id: user, user_metadata: { username: 'Lifter' } }
});

const confirm = page => page.locator('#confirmAction').click();
async function selectExercise(page, name, query = name) {
  await page.locator('#exerciseSearch').fill(query);
  await page.locator('#pickerList input').and(page.getByLabel(name, { exact: true })).check();
}
async function editRoutine(page, name) {
  await page.locator('#editRoutine').click();
  await page.locator('#routineRows').getByRole('button', { name: /^Replace / }).nth(1).click();
  await selectExercise(page, name);
  await page.locator('#addSelected').click();
  await page.locator('#saveRoutine').click();
}


const tab = (page, name) => page.locator('[data-tab="' + name + '"]').click();

async function fakeCloud(page, signedIn = true) {
  const state = { groups: [], total: 0, friendTotal: 8, goal: 64, requests: [],
    payload: null, version: null, conflict: false };
  if (signedIn) {
    await page.addInitScript(({ key, session }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(session));
    }, { key: tokenKey, session: makeSession() });
  }
  // Keep fake requests local even when a browser bypasses Playwright interception.
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = new URL(input, location.href);
      return originalFetch(url.hostname.endsWith('.supabase.co')
        ? '/__supabase_mock' + url.pathname + url.search : input, init);
    };
    // Service worker/offline behavior has its own end-to-end test.
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.resolve();

    window.WebSocket = class {
      static OPEN = 1;
      constructor() {
        this.readyState = 1;
        setTimeout(() => this.onopen?.(), 0);
      }
      send(raw) {
        const [join, id, topic, event, payload] = JSON.parse(raw);
        if (event === 'phx_join') {
          window.testRealtimeChanges = payload.config.postgres_changes;
          window.notifyRealtime = () => this.deliver([join, null, topic, 'postgres_changes', {}]);
        }
        this.deliver([join, id, topic, 'phx_reply', { status: 'ok', response: {} }]);
      }
      deliver(message) {
        setTimeout(() => {
          if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(message) });
        }, 0);
      }
      close() { this.readyState = 3; }
    };
  });
  await page.route('**/__supabase_mock/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname.split('/').at(-1);
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'apikey, authorization, content-type'
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const args = method === 'POST' && request.postData() ? request.postDataJSON() : {};
    const send = (json, status = 200) => route.fulfill({ json, status, headers });
    state.requests.push({ path, args, token: request.headers().authorization });
    switch (path) {
      case 'signup': return send(makeSession());
      case 'logout': return send({});
      case 'recover_membership': return args.code === code ? send(newCode) : send({ message: 'Invalid code' }, 400);
      case 'issue_recovery_code': return send(code);
      case 'hydration_groups': return send(state.groups);
      case 'hydration_profiles': return send([{ goal_oz: state.goal }]);
      case 'hydration_personal': return send(state.total ? [{ day: url.searchParams.get('day').slice(4), oz: state.total, goal_oz: state.goal }] : []);
      case 'hydration_members': return send([
        { user_id: user, display_name: 'Lifter', goal_oz: state.goal },
        { user_id: friend, display_name: 'Friend', goal_oz: 64 }
      ]);
      case 'hydration_daily': return send([{ user_id: user, oz: state.total }, { user_id: friend, oz: state.friendTotal }]);
      case 'log_water':
        state.total = Math.max(0, state.total + args.v);
        return send(state.total);
      case 'set_water_goal':
        state.goal = args.goal;
        return send(null);
      case 'enroll_hydration_group':
        state.groups = [{ id: groupId, title: args.title, invite_code: invite, owner_id: user }];
        return send(groupId);
      case 'manage_hydration_group':
        if (args.action === 'rename') state.groups[0].title = args.title;
        if (args.action === 'transfer') state.groups[0].owner_id = args.member;
        if (args.action === 'leave') state.groups = [];
        return send(null);
      case 'workout_backups':
        return send(state.version ? [{ updated_at: state.version, payload: state.payload }] : []);
      case 'save_workout_backup':
        if (state.conflict || args.expected !== state.version) return send({ message: 'Cloud backup changed elsewhere.' }, 409);
        state.payload = args.snapshot;
        state.version = new Date().toISOString();
        return send(state.version);
      default: throw new Error('Unexpected mock request to ' + path);
    }
  });
  return state;
}

test('workout sets, body weight, timer and routines survive reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await editRoutine(page, 'Weighted Dip');
  await page.locator('#beginWorkout').click();
  await expect(page.locator('#exerciseTitle')).toHaveText('Bench press');
  await page.locator('#weight').fill('110');
  await page.locator('#reps').fill('5');
  await page.locator('#setDetails summary').click();
  await page.locator('#notes').fill('first working set');
  await page.locator('#saveSet').click();
  await expect(page.locator('#sessionstats')).toContainText('1 sets');
  await page.locator('#barpause').click();
  await expect(page.locator('#barpause')).toHaveText('Resume');
  await tab(page, 'body');
  await page.locator('#bodyweight').fill('167.5');
  await page.locator('#bodyform button').click();
  await expect(page.locator('#bw')).toHaveText('167.5 lb');
  await expect(page.locator('#bodyChart')).toBeVisible();
  await page.reload();
  await expect(page.locator('#barpause')).toHaveText('Resume');
  await expect(page.locator('#coachplan')).toContainText('Weighted Dip');
  await tab(page, 'history');
  await page.locator('.workoutCard summary').first().click();
  await expect(page.locator('#history').getByText('first working set')).toBeVisible();
  await page.locator('#history').getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#saveSet')).toHaveText('Update set');
  await page.locator('#weight').fill('115');
  await page.locator('#saveSet').click();
  await tab(page, 'progress');
  await expect(page.locator('#records')).toContainText('115 lb');
  expect(errors).toEqual([]);
});

test('local import and export include settings and accept legacy backups', async ({ page }) => {
  await page.goto('/');
  await tab(page, 'settings');
  const restore = value => page.locator('#file').setInputFiles({
    name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value))
  });
  await page.locator('#localBackups summary').click();
  await restore(backup);
  await page.locator('#restoreReplace').click();
  await expect(page.locator('#status')).toHaveText('Backup restored on this device.');
  const downloadReady = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadReady;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported).toMatchObject(backup);
  await restore({ sets: [], body: [] });
  await page.locator('#restoreReplace').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('iron-log-coach-v3')).sets)).toEqual([]);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('iron-log-exercise-config-v1')))).toEqual(backup.exerciseConfig);
  await tab(page, 'workout');
  await expect(page.locator('#coachplan')).toContainText('Weighted dips');
});

test('hydration works before joining and refreshes friends on a Realtime event', async ({ page }) => {
  const cloud = await fakeCloud(page);
  await page.goto('/');
  await tab(page, 'social');
  await expect(page.locator('#waterTotal')).toHaveText('0 / 64 oz');
  await expect(page.locator('#socialList')).toBeDisabled();
  await page.locator('[data-water="24"]').click();
  await expect(page.locator('#waterTotal')).toHaveText('24 / 64 oz');
  await page.getByText('Hydration preferences', { exact: true }).click();
  await page.locator('#waterGoal').fill('24');
  await page.locator('#waterSaveGoal').click();
  await expect(page.locator('#waterStreak')).toContainText('Goal streak: 1 day');
  await page.getByText('Create or join a group', { exact: true }).click();
  await page.locator('#socialTitle').fill('Water friends');
  await page.locator('#socialCreate').click();
  await expect(page.locator('#socialList')).toHaveValue(groupId);
  await expect(page.locator('#socialBoard')).toContainText('8 / 64 oz');
  await expect.poll(() => page.evaluate(id => window.testRealtimeChanges?.some(change =>
    change.table === 'hydration_daily' && change.filter === 'group_id=eq.' + id), groupId)).toBe(true);
  cloud.friendTotal = 28;
  await page.evaluate(() => window.notifyRealtime());
  await expect(page.locator('#socialBoard')).toContainText('28 / 64 oz', { timeout: 5000 });
  await page.getByText('Manage membership', { exact: true }).click();
  await page.locator('#renameTitle').fill('New group title');
  await page.locator('#renameGroup').click();
  await expect(page.locator('#socialList option')).toHaveText('New group title');
  await page.locator('#manageMember').selectOption(friend);
  await page.locator('#transferGroup').click();
  await confirm(page);
  await expect(page.locator('#ownerTools')).toBeHidden();
  await page.locator('#leaveGroup').click();
  await confirm(page);
  await expect(page.locator('#socialList')).toBeDisabled();
  await expect(page.locator('#waterTotal')).toHaveText('24 / 24 oz');
});

test('recovery needs only the code and shows a new one after success', async ({ page }) => {
  const cloud = await fakeCloud(page, false);
  await page.goto('/');
  await tab(page, 'social');
  await expect(page.getByRole('button', { name: 'Recover membership' })).toHaveCount(0);
  await page.locator('#openProfile').click();
  await expect(page.locator('#pageLabel')).toHaveText('Profile');
  await page.getByText('Recover a membership', { exact: true }).click();
  await page.locator('#recoverCode').fill(code.match(/.{4}/g).join('-').toUpperCase());
  await page.locator('#recoverMembership').click();
  await expect(page.locator('#issuedCode')).toHaveValue('abcd-abcd-abcd-abcd-abcd-abcd-abcd-abcd');
  await expect(page.locator('#profileStatus')).toContainText('Membership recovered');
  expect(cloud.requests.find(request => request.path === 'signup').args).toEqual({ data: { username: '' } });
  expect(cloud.requests.find(request => request.path === 'recover_membership')).toMatchObject({ args: { code }, token: 'Bearer test-token' });
  expect(await page.evaluate(() => localStorage.getItem('iron-log-social-recovery-session-v1'))).toBeNull();
  await page.locator('#hideRecovery').click();
  await expect(page.locator('#issuedCode')).toHaveValue('');
});

test('cloud saves use a version, restore settings, and stop auto backup on conflict', async ({ page }) => {
  const cloud = await fakeCloud(page);
  cloud.payload = backup;
  cloud.version = '2025-01-01T00:00:00+00:00';
  await page.goto('/');
  await tab(page, 'settings');
  await page.locator('#socialRestore').click();
  await page.locator('#restoreReplace').click();
  await expect(page.locator('#profileStatus')).toHaveText('Cloud backup restored.');
  await page.locator('#socialBackup').click();
  await confirm(page);
  await expect(page.locator('#profileStatus')).toHaveText('Cloud backup saved.');
  expect(cloud.requests.find(request => request.path === 'save_workout_backup').args).toMatchObject({
    expected: '2025-01-01T00:00:00+00:00', snapshot: { ...backup, routineState: { version: 1 } }
  });
  await tab(page, 'settings');
  await page.locator('#autoCloud').check();
  await confirm(page);
  await expect(page.locator('#autoCloudStatus')).toContainText('Automatic backups on.');
  cloud.conflict = true;
  await tab(page, 'workout');
  await editRoutine(page, 'Face Pull');
  await tab(page, 'settings');
  await expect(page.locator('#autoCloudStatus')).toContainText('Cloud backup changed on another device.');
  await expect(page.locator('#autoCloud')).not.toBeChecked();
  expect(cloud.payload.routines.Push).toEqual(backup.routines.Push);
});

test('installed shell opens offline with the current app scripts', async ({ page, context }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#coachplan')).toContainText('Bench press');
  await tab(page, 'social');
  await expect(page.locator('#hydrationGuest')).toBeVisible();
  await expect(page.locator('#offline')).toBeVisible();
  await tab(page, 'workout');
  await page.locator('#editRoutine').click();
  await page.locator('#addRoutineRow').click();
  await selectExercise(page, 'Kettlebell Deadlift');
  await page.locator('#addSelected').click();
  await page.locator('#saveRoutine').click();
  await expect(page.locator('#coachplan')).toContainText('Kettlebell Deadlift');
});

test('routine ordering, workout completion and history deletion use in-app controls', async ({ page }) => {
  await page.goto('/');
  await page.locator('#editRoutine').click();
  await page.getByRole('button', { name: 'Move up Lateral Raise' }).click();
  await expect(page.locator('#routineRows li').nth(3)).toContainText('Lateral Raise');
  await page.locator('#addRoutineRow').click();
  await selectExercise(page, 'Cable Crunch');
  await page.locator('#addSelected').click();
  await page.locator('#saveRoutine').click();
  await expect(page.locator('#coachplan .listRow').nth(3)).toContainText('Lateral Raise');
  await page.locator('#beginWorkout').click();
  await page.locator('#weight').fill('100');
  await page.locator('#saveSet').click();
  await expect(page.locator('#setProgressText')).toHaveText('1 of 3 working sets');
  await page.locator('#finishWorkout').click();
  await confirm(page);
  await expect(page.locator('#workoutSummary')).toBeVisible();
  await expect(page.locator('#summaryMetrics')).toContainText('400 lb');
  await page.locator('#summaryHistory').click();
  const workout = page.locator('.workoutCard').first();
  await expect(workout.locator('summary')).toContainText('1 exercise · 400 lb');
  await expect(workout.locator('table')).toBeHidden();
  await workout.locator('summary').click();
  await workout.getByRole('button', { name: 'Delete' }).click();
  await page.locator('#confirmation').getByRole('button', { name: 'Cancel' }).click();
  await expect(workout.locator('table')).toBeVisible();
  await workout.getByRole('button', { name: 'Delete' }).click();
  await confirm(page);
  await expect(workout.locator('summary')).toContainText('0 exercises');
});

test('six tabs fit the current viewport and charts render at device pixel density', async ({ page }) => {
  await page.addInitScript(() => {
    const d = new Date();
    const day = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    localStorage.setItem('iron-log-coach-v3', JSON.stringify({
      sets: [{ id: '1', date: day, split: 'Push', exercise: 'Bench press', weight: 100, reps: 5, rir: '', notes: '' }],
      body: [{ date: day, weight: 160 }]
    }));
  });
  await page.goto('/');
  for (const name of ['workout', 'history', 'progress', 'body', 'social', 'settings']) {
    await tab(page, name);
    await expect(page.locator('[data-tab="' + name + '"]')).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (name === 'progress' || name === 'body') {
      const chart = page.locator(name === 'progress' ? '#chart' : '#bodyChart');
      await expect(chart).toBeVisible();
      expect(await chart.evaluate(canvas => canvas.width === Math.round(canvas.getBoundingClientRect().width * devicePixelRatio))).toBe(true);
    }
  }
  await tab(page, 'workout');
  await page.locator('#editRoutine').click();
  await page.locator('#addRoutineRow').click();
  await page.locator('#exerciseSearch').fill('Romanian deadlift');
  await expect(page.locator('#addSelected')).toBeInViewport();
  await expect(page.locator('#closePicker')).toBeInViewport();
  expect(await page.locator('#exercisePicker').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  await page.locator('#closePicker').click();
  await page.locator('#closeRoutine').click();
  await page.locator('#beginWorkout').click();
  await expect(page.getByRole('button', { name: 'Log working set 1' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('workout recommendations and automatic advancement honor saved prescriptions', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('iron-log-coach-v3', JSON.stringify({
      sets: [{ id: 'past', date: '2024-01-01', split: 'Push', exercise: 'Bench press', weight: 100, reps: 6, rir: '2', notes: '' }],
      body: []
    }));
    localStorage.setItem('iron-log-exercise-config-v1', JSON.stringify({
      'bench press': { count: 1, lo: 4, hi: 6, step: 5, rest: 75 }
    }));
  });
  await page.goto('/');
  await page.locator('#beginWorkout').click();
  await expect(page.locator('#last')).toContainText('100 lb × 6');
  await expect(page.locator('#target')).toHaveText('105 lb × 4');
  await expect(page.locator('#weight')).toHaveValue('105');
  await page.locator('#saveSet').click();
  await expect(page.locator('#exerciseTitle')).toHaveText('Incline Dumbbell Press');
  await expect(page.locator('#currentsets')).toContainText('105 lb');
  await expect(page.locator('#barclock')).toHaveText(/^01:1[0-5]$/);
  await page.reload();
  await expect(page.locator('#exerciseTitle')).toHaveText('Incline Dumbbell Press');
});

test('create and organize custom routines with templates and a multi-select library', async ({ page }) => {
  await page.goto('/');
  await page.locator('#manageRoutines').click();
  await page.getByText('Starting templates', { exact: true }).click();
  await page.getByRole('button', { name: 'Full body', exact: true }).click();
  await expect(page.locator('#routineTotals')).toContainText('5 exercises');
  await page.locator('#routineName').fill('Saturday Strength');
  await page.locator('#addRoutineRow').click();
  await page.locator('#filterMuscle').selectOption('Chest');
  await page.locator('#filterEquipment').selectOption('Dumbbell');
  await selectExercise(page, 'Dumbbell Bench Press', 'db bench');
  await page.getByRole('button', { name: 'Favorite Dumbbell Bench Press', exact: true }).click();
  await selectExercise(page, 'Incline Dumbbell Press', 'incline db');
  await page.locator('#addSelected').click();
  await expect(page.locator('#routineTotals')).toContainText('7 exercises');
  await page.getByRole('button', { name: 'Duplicate Incline Dumbbell Press', exact: true }).click();
  await expect(page.locator('#routineTotals')).toContainText('8 exercises');
  await page.getByRole('button', { name: 'Remove Incline Dumbbell Press', exact: true }).last().click();
  await page.locator('#saveRoutine').click();
  await page.getByRole('button', { name: 'Edit Saturday Strength', exact: true }).click();
  await page.locator('#routineName').fill('Unsaved');
  await page.locator('#closeRoutine').click();
  await expect(page.locator('#confirmTitle')).toHaveText('Discard changes?');
  await confirm(page);
  await page.getByRole('button', { name: 'Edit Saturday Strength', exact: true }).click();
  await page.locator('#routineName').fill('Weekend Strength');
  await page.locator('#saveRoutine').click();
  await page.getByRole('button', { name: 'Duplicate Weekend Strength', exact: true }).click();
  await page.getByRole('button', { name: 'Move up Weekend Strength copy', exact: true }).click();
  await page.getByRole('button', { name: 'Archive Weekend Strength copy', exact: true }).click();
  await page.getByText('Archived routines', { exact: true }).click();
  await page.getByRole('button', { name: 'Restore Weekend Strength copy', exact: true }).click();
  await page.getByRole('button', { name: 'Train Weekend Strength copy', exact: true }).click();
  await expect(page.locator('#exerciseTitle')).toHaveText('Barbell Back Squat');
  await expect(page.locator('#activeWorkoutInfo')).toContainText('Weekend Strength copy');
});

test('prescriptions, custom library entries and substitutions preserve distinct history through backups', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('iron-log-coach-v3')) return;
    localStorage.setItem('iron-log-coach-v3', JSON.stringify({
      sets: [{ id: 'past-bench', date: '2024-01-01', split: 'Push', exercise: 'Bench press', weight: 135, reps: 6, rir: '2', notes: '' }],
      body: []
    }));
  });
  await page.goto('/');
  await page.locator('#editRoutine').click();
  await page.getByRole('button', { name: 'Edit Bench press', exact: true }).click();
  await page.locator('#rowSets').fill('1');
  await page.locator('#rowRest').fill('75');
  await page.locator('#rowStep').fill('10');
  await page.locator('#rowRir').selectOption('2');
  await page.locator('#rowInstructions').fill('Pause on the chest.');
  await page.locator('#exerciseForm button[type=submit], #exerciseForm .sheetFooter button').click();
  await page.locator('#addRoutineRow').click();
  await page.getByRole('button', { name: 'Recent', exact: true }).click();
  await expect(page.locator('#pickerList input').and(page.getByLabel('Bench press', { exact: true }))).toBeVisible();
  await page.locator('#customExercise').click();
  await page.locator('#customName').fill('Gym A floor press');
  await page.locator('#customMuscle').selectOption('Chest');
  await page.locator('#customEquipment').selectOption('Barbell');
  await page.locator('#exerciseForm .sheetFooter button').click();
  await page.getByRole('button', { name: 'Favorite Gym A floor press', exact: true }).click();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(page.getByLabel('Gym A floor press', { exact: true })).toBeChecked();
  await page.locator('#addSelected').click();
  await page.locator('#saveRoutine').click();
  await page.locator('#beginWorkout').click();
  await expect(page.locator('#target')).toHaveText('145 lb × 4 · 2 RIR');
  await expect(page.locator('#exerciseInstructions')).toHaveText('Pause on the chest.');
  await page.locator('#saveSet').click();
  await expect(page.locator('#barclock')).toHaveText(/^01:1[0-5]$/);
  await expect(page.locator('#exerciseTitle')).toHaveText('Incline Dumbbell Press');
  await page.locator('#queueDisclosure summary').click();
  await page.locator('#coachplan').getByRole('button', { name: /Bench press/ }).first().click();
  await page.locator('#exerciseOptions').click();
  await page.locator('#substituteExercise').click();
  await selectExercise(page, 'Smith Machine Bench Press');
  await page.locator('#addSelected').click();
  await expect(page.locator('#exerciseTitle')).toHaveText('Smith Machine Bench Press');
  await expect(page.locator('#last')).toHaveText('—');
  await expect(page.locator('#target')).toContainText('Baseline');
  await page.reload();
  await expect(page.locator('#exerciseTitle')).toHaveText('Smith Machine Bench Press');
  await page.locator('#weight').fill('50');
  await page.locator('#saveSet').click();
  await page.locator('#finishWorkout').click();
  await confirm(page);
  await page.locator('#summaryDone').click();
  await expect(page.locator('#coachplan').first()).toContainText('Bench press');
  await page.locator('#editRoutine').click();
  await page.getByRole('button', { name: 'Replace Bench press', exact: true }).click();
  await selectExercise(page, 'Dumbbell Bench Press');
  await page.locator('#addSelected').click();
  await page.locator('#saveRoutine').click();
  await tab(page, 'settings');
  await page.locator('#localBackups summary').click();
  const downloading = page.waitForEvent('download');
  await page.locator('#export').click();
  const downloaded = await readFile(await (await downloading).path());
  const snapshot = JSON.parse(downloaded);
  expect(snapshot.sets).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'past-bench', exercise: 'Bench press' }),
    expect.objectContaining({ exercise: 'Smith Machine Bench Press', exerciseId: 'lift-smith-machine-bench-press' })
  ]));
  expect(snapshot.routineState.favorites).toEqual([snapshot.routineState.customExercises.find(e => e.name === 'Gym A floor press').id]);
  expect(snapshot.routines.Push[0]).toBe('Dumbbell Bench Press');
  expect(snapshot.sets.find(set => set.weight === 145)).toMatchObject({ exerciseId: 'lift-bench-press' });
  await page.evaluate(() => localStorage.removeItem('iron-log-routine-builder-v1'));
  await page.reload();
  await tab(page, 'settings');
  await page.locator('#localBackups summary').click();
  await page.locator('#file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: downloaded });
  await page.locator('#restoreReplace').click();
  await expect(page.locator('#status')).toHaveText('Backup restored on this device.');
  await tab(page, 'workout');
  await expect(page.locator('#coachplan')).toContainText('Gym A floor press');
  await expect(page.locator('#coachplan .listRow').first()).toContainText('Dumbbell Bench Press');
});

test('drag handles reorder exercise cards with pointer input', async ({ page }) => {
  await page.goto('/');
  await page.locator('#editRoutine').click();
  const from = await page.getByRole('button', { name: 'Drag Bench press', exact: true }).boundingBox();
  const to = await page.locator('#routineRows li').nth(1).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + 15, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#routineRows li').first()).toContainText('Incline Dumbbell Press');
});

test('active logger compares prior sets, tracks classification, and preserves drafts on reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('iron-log-coach-v3')) localStorage.setItem('iron-log-coach-v3', JSON.stringify({
      sets: [
        { id: 'old-a', date: '2024-01-01', split: 'Push', exercise: 'Bench press', weight: 100, reps: 5, rir: '2', notes: '' },
        { id: 'old-b', date: '2024-01-01', split: 'Push', exercise: 'Bench press', weight: 95, reps: 6, rir: '2', notes: '' }
      ], body: []
    }));
  });
  await page.goto('/');
  await page.locator('#beginWorkout').click();
  await expect(page.locator('#plannedSets tbody tr').first()).toContainText('100 lb × 5');
  await expect(page.locator('#plannedSets tbody tr').nth(1)).toContainText('95 lb × 6');
  await page.locator('#weight').fill('185');
  await page.locator('#reps').fill('5');
  await page.reload();
  await expect(page.locator('#weight')).toHaveValue('185');
  await page.locator('#warmupOpen').click();
  await expect(page.locator('.warmupRow').first()).toBeVisible();
  await page.locator('.warmupRow').first().getByRole('button', { name: 'Log', exact: true }).click();
  await page.locator('#warmupClose').click();
  await expect(page.locator('#setProgressText')).toHaveText('0 of 3 working sets');
  await page.locator('#platesOpen').click();
  await expect(page.locator('#plateTarget')).toHaveValue('185');
  await expect(page.locator('#plateResult')).toContainText('Load each side');
  await page.locator('#plateTarget').fill('186');
  await expect(page.locator('#plateResult')).toContainText('Target is unavailable');
  await page.locator('#platesClose').click();
  await page.locator('#platesOpen').click();
  await expect(page.locator('#plateTarget')).toHaveValue('186');
  await page.locator('#platesClose').click();
  await page.locator('#setDetails summary').click();
  await page.locator('#partialReps').fill('2');
  await page.locator('#failedSet').check();
  await page.getByRole('button', { name: 'Log working set 1' }).click();
  await expect(page.locator('#currentsets')).toContainText('+2 partial');
  await expect(page.locator('#currentsets')).toContainText('Failure');
  await expect(page.locator('#setProgressText')).toHaveText('1 of 3 working sets');
  await page.locator('#undoSet').click();
  await expect(page.locator('#setProgressText')).toHaveText('0 of 3 working sets');
  await expect(page.locator('#currentsets')).toContainText('Warm-up');
  await page.locator('#addWorkingSet').click();
  await expect(page.locator('#plannedSets tbody tr')).toHaveCount(4);
  await page.locator('#exerciseOptions').click();
  await page.locator('#removeWorkingSet').click();
  await expect(page.locator('#plannedSets tbody tr')).toHaveCount(3);
});

test('timer, calendar, muscle volume, records and unit preferences work together', async ({ page }) => {
  await page.goto('/');
  await page.locator('#beginWorkout').click();
  await page.locator('#weight').fill('100');
  await page.locator('#saveSet').click();
  await expect(page.locator('#restProgress')).toBeVisible();
  await page.locator('#barpause').click();
  const before = await page.locator('#barclock').textContent();
  await page.locator('#barExtend').click();
  await expect(page.locator('#barclock')).not.toHaveText(before);
  const after = await page.locator('#barclock').textContent();
  await page.reload();
  await expect(page.locator('#barclock')).toHaveText(after);
  await page.locator('#barstop').click();
  await page.locator('#workoutOptions').click();
  await page.locator('#sessionOpen').click();
  await page.locator('#workoutMemo').fill('Training fixture');
  await page.locator('#workoutDetailsForm').getByRole('button', { name: 'Save details' }).click();
  await page.locator('#finishWorkout').click();
  await confirm(page);
  await page.locator('#summaryDone').click();
  await page.locator('#beginWorkout').click();
  await page.locator('#finishWorkout').click();
  await confirm(page);
  await page.locator('#summaryHistory').click();
  await page.locator('#calendarPanel summary').click();
  await expect(page.locator('#calendarMetrics')).toContainText('2 workouts');
  await page.locator('#calendarGrid [data-trained=true]').click();
  await expect(page.locator('.workoutCard')).toHaveCount(2);
  await page.locator('#monthPrevious').click();
  await expect(page.locator('#calendarMetrics')).toContainText('0 workouts');
  await tab(page, 'settings');
  await page.locator('#weightUnit').selectOption('kg');
  await tab(page, 'progress');
  await page.getByText('Personal records', { exact: true }).click();
  await expect(page.locator('#personalRecords')).toContainText('45.4 kg');
  await page.getByText('Muscle group volume', { exact: true }).click();
  await expect(page.locator('#muscleChart')).toContainText('1 direct');
  await expect(page.locator('#muscleChart')).toContainText('1 secondary');
  await tab(page, 'body');
  await page.locator('#bodyweight').fill('75');
  await page.locator('#recordWeight').click();
  await expect(page.locator('#bw')).toHaveText('75 kg');
  await page.getByText('Bodyweight goal', { exact: true }).click();
  await page.locator('#bodyGoal').fill('74');
  await page.getByRole('button', { name: 'Save goal' }).click();
  await expect(page.locator('#bodyGoalProgress')).toContainText('1 kg above goal');
});

test('backup merge previews conflicts and replacement preserves a recovery snapshot', async ({ page }) => {
  const fixture = backup.sets[0];
  await page.addInitScript(sets => {
    if (!localStorage.getItem('iron-log-coach-v3')) localStorage.setItem('iron-log-coach-v3', JSON.stringify({ sets, body: [] }));
  }, [fixture]);
  await page.goto('/');
  await tab(page, 'settings');
  await page.locator('#localBackups summary').click();
  const restore = value => page.locator('#file').setInputFiles({
    name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value))
  });
  await restore({ sets: [fixture, { ...fixture, weight: 500 }, { ...fixture, id: 'second-identical' }], body: [] });
  await expect(page.locator('#restoreCounts')).toContainText('1 add · 1 skip · 1 conflict');
  await page.locator('#restoreMerge').click();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('iron-log-coach-v3')).sets);
  await expect.poll(read).toEqual([fixture, { ...fixture, id: 'second-identical' }]);
  await restore({ sets: [], body: [] });
  await page.locator('#restoreReplace').click();
  await expect.poll(read).toEqual([]);
  await page.locator('#recoverSnapshot').click();
  await page.locator('#restoreReplace').click();
  await expect.poll(read).toEqual([fixture, { ...fixture, id: 'second-identical' }]);
});

test('superset changes exercise after the first lift and starts rest after the second', async ({ page }) => {
  await page.goto('/');
  await page.locator('#editRoutine').click();
  await page.getByRole('button', { name: 'Edit Bench press', exact: true }).click();
  await page.locator('#supersetNext').check();
  await page.locator('#exerciseForm .sheetFooter button').click();
  await page.locator('#saveRoutine').click();
  await page.locator('#beginWorkout').click();
  await page.locator('#weight').fill('100');
  await page.locator('#saveSet').click();
  await expect(page.locator('#exerciseTitle')).toHaveText('Incline Dumbbell Press');
  await expect(page.locator('#timerbar')).toBeHidden();
  await page.locator('#weight').fill('45');
  await page.locator('#saveSet').click();
  await expect(page.locator('#exerciseTitle')).toHaveText('Bench press');
  await expect(page.locator('#timerbar')).toBeVisible();
});

test('cancelling an empty workout clears its draft and rest timer on reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('#beginWorkout').click();
  await page.locator('#weight').fill('185');
  await page.locator('.restPanel summary').click();
  await page.locator('[data-rest="120"]').click();
  await expect(page.locator('#timerbar')).toBeVisible();
  await page.locator('#workoutOptions').click();
  await page.locator('#cancelWorkout').click();
  await expect(page.locator('#beginWorkout')).toBeVisible();
  await expect(page.locator('#timerbar')).toBeHidden();
  await page.reload();
  await expect(page.locator('#beginWorkout')).toBeVisible();
  await expect(page.locator('#timerbar')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('iron-log-active-v1')))).toBeNull();
});

test('cancel keeps logged sets and clears the active workout from automatic cloud backup', async ({ page }) => {
  const cloud = await fakeCloud(page);
  await page.goto('/');
  await tab(page, 'settings');
  await page.locator('#autoCloud').check();
  await confirm(page);
  await expect(page.locator('#autoCloudStatus')).toContainText('Automatic backups on');
  await tab(page, 'workout');
  await page.locator('#beginWorkout').click();
  await page.locator('#weight').fill('100');
  await page.locator('#saveSet').click();
  await page.locator('#workoutOptions').click();
  await page.locator('#cancelWorkout').click();
  await expect(page.locator('#cancelWorkoutSheet')).toBeVisible();
  await page.locator('#continueWorkout').click();
  await expect(page.locator('#setProgressText')).toHaveText('1 of 3 working sets');
  await page.locator('#workoutOptions').click();
  await page.locator('#cancelWorkout').click();
  await page.locator('#cancelKeep').click();
  await expect(page.locator('#beginWorkout')).toBeVisible();
  await expect.poll(() => cloud.payload?.sets.length).toBe(1);
  expect(cloud.payload.activeSession).toBeNull();
  await page.reload();
  await tab(page, 'history');
  await expect(page.locator('.workoutCard summary')).toContainText('Push');
});

test('discard affects only the active session and History shows all workout types', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('iron-log-coach-v3')) return;
    const now = new Date();
    const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    const old = { id: 'legacy-same-day', date, split: 'Push', exercise: 'Bench press', weight: 110, reps: 5, rir: '', notes: '' };
    localStorage.setItem('iron-log-coach-v3', JSON.stringify({ body: [], sets: [
      old, { ...old, id: 'prior-session', workoutId: 'historical-workout' },
      { ...old, id: 'separate-set', split: 'Fitness assignment', exercise: 'Separate Bench' }
    ] }));
  });
  await page.goto('/');
  await page.locator('#beginWorkout').click();
  await page.locator('#weight').fill('120');
  await page.locator('#saveSet').click();
  await page.locator('#workoutOptions').click();
  await page.locator('#cancelWorkout').click();
  await page.locator('#cancelDiscard').click();
  await expect(page.locator('#confirmTitle')).toHaveText('Discard logged sets?');
  await confirm(page);
  await page.reload();
  await tab(page, 'history');
  await expect(page.getByLabel('Workout type')).toHaveCount(0);
  await expect(page.locator('#history .workoutCard')).toHaveCount(3);
  const ids = await page.evaluate(() => JSON.parse(localStorage.getItem('iron-log-coach-v3')).sets.map(set => set.id));
  expect(ids).toEqual(['legacy-same-day', 'prior-session', 'separate-set']);
  await page.locator('#searchHistory').fill('Separate Bench');
  await expect(page.locator('#history .workoutCard summary')).toHaveText(/Separate workout/);
});

test('exercise options and the primary Next action protect incomplete work', async ({ page }) => {
  await page.goto('/');
  await page.locator('#beginWorkout').click();
  await expect(page.locator('#workoutPosition')).toContainText('Exercise 1 of 6');
  await expect(page.locator('#upNextName')).toHaveText('Incline Dumbbell Press');
  await page.locator('#nextExercise').click();
  await expect(page.locator('#confirmTitle')).toHaveText('Skip exercise?');
  await page.locator('#confirmation').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#exerciseTitle')).toHaveText('Bench press');
  await page.locator('#exerciseOptions').click();
  await page.locator('#exerciseNotesOpen').click();
  await page.locator('#exerciseMemo').fill('Pause briefly');
  await page.locator('#saveExerciseMemo').click();
  await page.locator('#exerciseNotesSheet').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('#exerciseOptions')).toBeFocused();
  await page.locator('#reps').fill('9');
  await page.getByRole('button', { name: 'Apply recommendation' }).click();
  await expect(page.locator('#reps')).toHaveValue('4');
  await page.locator('#exerciseOptions').click();
  await page.locator('#performanceOpen').click();
  await expect(page.locator('#performanceList')).toContainText('No previous working sets');
  await page.locator('#performanceSheet').getByRole('button', { name: 'Done' }).click();
  await page.locator('#nextExercise').click();
  await confirm(page);
  await expect(page.locator('#exerciseTitle')).toHaveText('Incline Dumbbell Press');
  await expect(page.locator('#platesOpen')).toBeHidden();
});

test('older unfinished workouts cannot discard unverified same-day sets', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('iron-log-coach-v3')) return;
    const now = new Date();
    const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    localStorage.setItem('iron-log-active-v1', JSON.stringify({ date, split: 'Push', exercise: 'Bench press', started: Date.now() }));
    localStorage.setItem('iron-log-coach-v3', JSON.stringify({ body: [], sets: [
      { id: 'unverified', date, split: 'Push', exercise: 'Bench press', weight: 110, reps: 5, rir: '', notes: '' }
    ] }));
  });
  await page.goto('/');
  await page.locator('#workoutOptions').click();
  await page.locator('#cancelWorkout').click();
  await expect(page.locator('#cancelWorkoutMessage')).toContainText('without a verified session link');
  await expect(page.locator('#cancelDiscard')).toBeHidden();
  await page.locator('#cancelKeep').click();
  await expect(page.locator('#beginWorkout')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('iron-log-coach-v3')).sets.map(set => set.id))).toEqual(['unverified']);
});
