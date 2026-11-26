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
async function editRoutine(page, name) {
  await page.locator('#editRoutine').click();
  await page.getByRole('textbox', { name: 'Exercise 2', exact: true }).fill(name);
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
  await editRoutine(page, 'Weighted dips');
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
  await expect(page.locator('#coachplan')).toContainText('Weighted dips');
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
  await confirm(page);
  await expect(page.locator('#status')).toHaveText('Backup restored on this device.');
  const downloadReady = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadReady;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported).toMatchObject(backup);
  await restore({ sets: [], body: [] });
  await confirm(page);
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
  await confirm(page);
  await expect(page.locator('#profileStatus')).toHaveText('Cloud backup restored.');
  await page.locator('#socialBackup').click();
  await confirm(page);
  await expect(page.locator('#profileStatus')).toHaveText('Cloud backup saved.');
  expect(cloud.requests.find(request => request.path === 'save_workout_backup').args).toMatchObject({
    expected: '2025-01-01T00:00:00+00:00', snapshot: backup
  });
  await tab(page, 'settings');
  await page.locator('#autoCloud').check();
  await confirm(page);
  await expect(page.locator('#autoCloudStatus')).toContainText('Automatic backups on.');
  cloud.conflict = true;
  await tab(page, 'workout');
  await editRoutine(page, 'Face pull');
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
});

test('routine ordering, workout completion and history deletion use in-app controls', async ({ page }) => {
  await page.goto('/');
  await page.locator('#editRoutine').click();
  await page.getByRole('button', { name: 'Move up Lateral Raise' }).click();
  await expect(page.getByRole('textbox', { name: 'Exercise 4', exact: true })).toHaveValue('Lateral Raise');
  await page.locator('#addRoutineRow').click();
  await page.getByRole('textbox', { name: 'Exercise 7', exact: true }).fill('Cable Crunch');
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
  await expect(page.getByText('Your first workout will appear here.')).toBeVisible();
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
