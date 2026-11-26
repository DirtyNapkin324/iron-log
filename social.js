(() => {
  'use strict';

  const base = 'https://sjtisywreewgaerqjrsi.supabase.co';
  const apiKey = 'sb_publishable_oloZKU0yTJKT4WaJ8MDi9w_ZFIRkPdQ';
  const tokenKey = 'iron-log-social-session-v1';
  const pendingKey = 'iron-log-social-recovery-session-v1';
  const $ = id => document.getElementById(id);
  const { localDay, shiftDay, streaks, backupParts } = IronCore;
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const readJSON = key => { try { return JSON.parse(read(key)); } catch { return null; } };
  const write = (key, value) => {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
    catch { return false; }
    return true;
  };
  const say = text => { $('socialStatus').textContent = text; };
  const guarded = fn => async () => { try { await fn(); } catch (error) { say(error.message); } };
  const groupKey = id => 'iron-log-hydration-group-' + id;
  const sessionData = value => value && value.refresh_token && value.user?.id ? value : null;
  let auth = sessionData(readJSON(tokenKey));
  let pending = sessionData(readJSON(pendingKey));
  let current = auth ? read(groupKey(auth.user.id)) : null;
  let selectedGroup = null, accountOperation = false;
  let refreshTokenInFlight = null;

  async function request(path, options = {}, token) {
    const response = await fetch(base + path, {
      ...options,
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...options.headers
      }
    });
    const content = await response.text();
    let body;
    try { body = JSON.parse(content); } catch { body = content; }
    if (!response.ok) {
      const error = new Error(body?.msg || body?.message || body?.error_description ||
        'Request failed (' + response.status + ')');
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function refreshSession(value, key) {
    if (value.expires_at > Date.now() / 1000 + 60) return value;
    const saved = sessionData(readJSON(key));
    if (saved?.user.id === value.user.id && saved.expires_at > Date.now() / 1000 + 60) return saved;
    const next = await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: JSON.stringify({ refresh_token: value.refresh_token })
    });
    // Older versions of the raw Auth response can omit the absolute expiry.
    next.expires_at ||= Math.floor(Date.now() / 1000) + next.expires_in;
    return next;
  }

  async function session() {
    if (!auth) throw new Error('Sign in first.');
    const original = auth;
    if (!refreshTokenInFlight) {
      // Web Locks coordinates refresh-token rotation between tabs where available.
      const refresh = () => refreshSession(original, tokenKey).then(next => {
        if (auth?.user.id !== original.user.id || auth.refresh_token !== original.refresh_token) {
          throw new Error('Membership changed. Retry the action.');
        }
        auth = next;
        if (next !== original) {
          write(tokenKey, JSON.stringify(next));
          sendRealtimeToken();
        }
        return next;
      });
      refreshTokenInFlight = (navigator.locks
        ? navigator.locks.request(tokenKey, refresh) : refresh()).finally(() => { refreshTokenInFlight = null; });
    }
    return refreshTokenInFlight;
  }

  async function rest(path, options, owner = auth?.user.id) {
    const active = await session();
    if (active.user.id !== owner) throw new Error('Membership changed. Retry the action.');
    return request('/rest/v1/' + path, options, active.access_token);
  }

  const rpcOptions = args => ({ method: 'POST', body: JSON.stringify(args) });
  const rpc = (name, args, owner) => rest('rpc/' + name, rpcOptions(args), owner);
  const get = (table, filters) => rest(table + '?' + filters);
  const postAuth = async username => {
    const value = await request('/auth/v1/signup', rpcOptions({ data: { username } }));
    if (!sessionData(value) || !value.access_token) throw new Error('Could not create a member session.');
    value.expires_at ||= Math.floor(Date.now() / 1000) + value.expires_in;
    return value;
  };

  function setAuth(value) {
    closeRealtime();
    auth = value;
    current = value ? read(groupKey(value.user.id)) : null;
    selectedGroup = null;
    const saved = write(tokenKey, value ? JSON.stringify(value) : null);
    updateIdentity();
    if (value) restorePendingBackup(value.user.id);
    cloudUI();
    scheduleBackup();
    return saved;
  }

  function hideCode() {
    $('issuedCode').value = '';
    $('recoveryPanel').hidden = true;
  }

  function showCode(code) {
    $('issuedCode').value = code.match(/.{4}/g).join('-');
    $('recoveryPanel').hidden = false;
  }

  function updateIdentity() {
    $('socialLogin').hidden = !!auth;
    $('socialMember').hidden = !auth;
    const username = auth?.user.user_metadata?.username;
    $('socialIdentity').textContent = username ? 'Signed in as ' + username : 'Signed in to Iron Log';
    $('socialName').value = username || '';
    hideCode();
    $('socialDetails').hidden = true;
    $('socialBoard').replaceChildren();
    $('waterHistory').textContent = '';
    $('waterStreak').textContent = '';
    $('waterOwn').replaceChildren();
    $('waterTotal').textContent = '0 oz';
    $('recoverCode').value = '';
  }

  function accountAction(fn) {
    return guarded(async () => {
      if (accountOperation) return;
      accountOperation = true;
      const buttons = ['socialSignIn', 'recoverMembership', 'issueCode', 'socialSignOut'].map($);
      buttons.forEach(b => { b.disabled = true; });
      try { await fn(); }
      finally {
        accountOperation = false;
        buttons.forEach(b => { b.disabled = false; });
      }
    });
  }

  $('socialSignIn').onclick = accountAction(async () => {
    if (auth) return;
    const username = field('socialUsername', 40);
    const saved = setAuth(await postAuth(username));
    say(saved ? 'Welcome, ' + username + '!' : 'Browser storage is unavailable. Generate a recovery code now.');
    await refresh();
  });

  $('issueCode').onclick = accountAction(async () => {
    if (!confirm('Generate a new recovery code? This replaces any earlier code.')) return;
    showCode(await rpc('issue_recovery_code', {}));
    say('Recovery code generated.');
  });

  $('recoverMembership').onclick = accountAction(async () => {
    if (auth) return;
    const code = $('recoverCode').value.replace(/[\s-]/g, '').toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(code)) throw new Error('Enter a valid recovery code.');
    if (pending) {
      try { pending = await refreshSession(pending, pendingKey); }
      catch (error) {
        if (error.status !== 400 && error.status !== 401) throw error;
        pending = null;
      }
    }
    pending ||= await postAuth('');
    write(pendingKey, JSON.stringify(pending));
    const replacement = await request('/rest/v1/rpc/recover_membership',
      rpcOptions({ code }), pending.access_token);
    const saved = setAuth(pending);
    if (saved) {
      pending = null;
      write(pendingKey, null);
    }
    showCode(replacement);
    say('Membership recovered. Save your new recovery code and restore your cloud backup if needed.');
    await refresh();
  });

  $('socialSignOut').onclick = accountAction(async () => {
    if (!confirm('Sign out of Iron Log? Make sure you’ve saved your recovery code.')) return;
    const active = auth;
    // A revoked/expired local session should still be removable.
    try { await request('/auth/v1/logout?scope=local', { method: 'POST' }, active.access_token); }
    finally {
      setAuth(null);
      say('Signed out. Your workouts are still on this device.');
    }
  });

  async function copy(text, fallback) {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); return true; } catch {}
    }
    fallback.focus();
    fallback.select();
    fallback.setSelectionRange(0, fallback.value.length);
    return false;
  }

  $('copyRecovery').onclick = guarded(async () => {
    const copied = await copy($('issuedCode').value, $('issuedCode'));
    say(copied ? 'Recovery code copied.' : 'Recovery code selected. Tap Copy.');
  });
  $('hideRecovery').onclick = hideCode;

  function field(id, max) {
    const value = $(id).value.trim();
    if (!value || value.length > max) throw new Error('Enter ' + (max === 80 ? 'a group name.' : 'a display name.'));
    return value;
  }

  function node(tag, value) {
    const element = document.createElement(tag);
    element.textContent = value;
    return element;
  }

  function bottle(oz, goal, large = false) {
    const bottle = node('div', '');
    bottle.className = 'waterBottle' + (large ? ' large' : '');
    const fill = node('div', '');
    fill.className = 'waterFill';
    const percent = Math.min(100, 100 * oz / goal);
    fill.style.height = percent + '%';
    bottle.append(fill, node('span', Math.round(percent) + '%'));
    return bottle;
  }

  function options(select, rows, value, label) {
    select.replaceChildren(...rows.map(row => {
      const option = node('option', row[label]);
      option.value = row[value];
      return option;
    }));
  }

  async function personalHistory(day, user) {
    const rows = [];
    let cursor = 'lte.' + day;
    while (true) {
      const page = await get('hydration_personal', 'select=day,oz,goal_oz&user_id=eq.' +
        user + '&day=' + cursor + '&order=day.desc&limit=500');
      rows.push(...page);
      if (page.length < 500) return rows;
      cursor = 'lt.' + page[page.length - 1].day;
    }
  }

  let refreshing = null, refreshAgain = false;

  function refresh() {
    refreshAgain = true;
    if (!refreshing) {
      refreshing = (async () => {
        while (refreshAgain) {
          refreshAgain = false;
          if (auth) await updateHydration();
        }
      })().finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function updateHydration() {
    const user = auth.user.id, day = localDay();
    const [groups, profiles, history] = await Promise.all([
      get('hydration_groups', 'select=id,title,invite_code,owner_id&order=title,id'),
      get('hydration_profiles', 'select=goal_oz&user_id=eq.' + user),
      personalHistory(day, user)
    ]);
    if (auth?.user.id !== user) return;
    if (!groups.some(group => group.id === current)) current = groups[0]?.id || null;
    const group = groups.find(group => group.id === current);
    const groupChanged = selectedGroup?.id !== group?.id;
    if (groupChanged || selectedGroup?.invite_code !== group?.invite_code) {
      $('inviteLink').hidden = true;
      $('inviteLink').value = '';
    }
    selectedGroup = group;
    options($('socialList'), groups, 'id', 'title');
    $('socialList').value = current || '';
    $('socialList').disabled = !current;
    write(groupKey(user), current);
    $('socialDetails').hidden = !group;
    $('socialDates').textContent = 'Today · ' + day;

    const own = Number(history[0]?.day === day ? history[0].oz : 0);
    const goal = Number(profiles[0]?.goal_oz || 64);
    $('waterOwn').replaceChildren(bottle(own, goal, true));
    $('waterTotal').textContent = own + ' / ' + goal + ' oz';
    if (document.activeElement !== $('waterGoal')) $('waterGoal').value = goal;
    const week = history.filter(row => row.day >= shiftDay(day, -6));
    $('waterHistory').textContent = week.length
      ? 'Last 7 days: ' + week.map(row => row.day.slice(5) + ' — ' + row.oz + ' oz').join(' · ')
      : 'Your hydration history will appear here.';
    const streak = streaks(history, day);
    const days = n => n + (n === 1 ? ' day' : ' days');
    $('waterStreak').textContent = 'Goal streak: ' + days(streak.current) + ' · Best: ' + days(streak.longest);

    watchRealtime(user, current);
    if (!group) return;
    if (groupChanged) {
      $('socialBoard').replaceChildren();
      $('groupManagement').open = false;
    }
    const id = group.id;
    const [members, amounts] = await Promise.all([
      get('hydration_members', 'select=user_id,display_name,goal_oz&group_id=eq.' + id + '&order=display_name,user_id'),
      get('hydration_daily', 'select=user_id,oz&group_id=eq.' + id + '&day=eq.' + day)
    ]);
    if (current !== id || auth?.user.id !== user) return;
    const me = members.find(member => member.user_id === user);
    if (!me) {
      // Membership can change between the list and board requests.
      current = null;
      $('socialDetails').hidden = true;
      refreshAgain = true;
      return;
    }
    $('socialInvite').textContent = group.invite_code;
    if (!$('socialName').value) $('socialName').value = me.display_name;
    if (groupChanged || document.activeElement !== $('groupDisplayName')) $('groupDisplayName').value = me.display_name;
    if (groupChanged || document.activeElement !== $('renameTitle')) $('renameTitle').value = group.title;
    $('leaveGroup').hidden = group.owner_id === user;
    $('ownerTools').hidden = group.owner_id !== user;
    const others = members.filter(member => member.user_id !== user);
    const managementSelect = $('manageMember');
    const previous = groupChanged ? null : managementSelect.value;
    options(managementSelect, [{ user_id: '', display_name: 'Choose a member' }, ...others], 'user_id', 'display_name');
    if (others.some(member => member.user_id === previous)) managementSelect.value = previous;
    const totals = new Map(amounts.map(row => [row.user_id, Number(row.oz)]));
    const board = others.map(member => {
      const total = totals.get(member.user_id) || 0;
      const row = node('div', '');
      row.className = 'waterFriend';
      row.append(bottle(total, Number(member.goal_oz)),
        node('div', member.display_name + ' · ' + total + ' / ' + member.goal_oz + ' oz'));
      return row;
    });
    $('socialBoard').replaceChildren(...(board.length ? board : [node('p', 'Invite a friend to see their daily water intake here.')]));
  }

  const validUUID = value => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

  async function enroll(action) {
    const title = action === 'create' ? field('socialTitle', 80) : null;
    const invite = action === 'join' ? $('socialCode').value.trim() : null;
    if (invite !== null && !validUUID(invite)) throw new Error('Enter a valid invitation code.');
    const id = await rpc('enroll_hydration_group', { action, title, invite, display: field('socialName', 40), d: localDay() });
    current = id;
    await refresh();
    say(action === 'create' ? 'Group created. Share your invitation link.' : 'Group joined.');
  }

  $('socialCreate').onclick = guarded(() => enroll('create'));
  $('socialJoin').onclick = guarded(() => enroll('join'));
  $('socialList').onchange = guarded(async () => { current = $('socialList').value; await refresh(); });
  $('socialRefresh').onclick = guarded(refresh);

  async function manage(action, title = null, member = null) {
    if (!current) throw new Error('Select a group.');
    await rpc('manage_hydration_group', { g: current, action, title, member });
    await refresh();
  }

  $('renameGroup').onclick = guarded(async () => { await manage('rename', field('renameTitle', 80)); say('Group renamed.'); });
  $('saveGroupName').onclick = guarded(async () => { await manage('name', field('groupDisplayName', 40)); say('Display name saved.'); });
  $('leaveGroup').onclick = guarded(async () => {
    if (!confirm('Leave this group? Your personal hydration history stays with you.')) return;
    await manage('leave');
    say('Left group.');
  });
  $('removeMember').onclick = guarded(async () => {
    const member = $('manageMember').value;
    if (!member) throw new Error('Choose a member.');
    if (!confirm('Remove this member and replace the group’s invitation link?')) return;
    await manage('remove', null, member);
    say('Member removed. The group has a new invitation link.');
  });
  $('transferGroup').onclick = guarded(async () => {
    const member = $('manageMember').value;
    if (!member) throw new Error('Choose a member.');
    if (!confirm('Transfer ownership of this group to the selected member?')) return;
    await manage('transfer', null, member);
    say('Ownership transferred.');
  });
  $('socialCopy').onclick = guarded(async () => {
    if (!selectedGroup) return;
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('join', selectedGroup.invite_code);
    const fallback = $('inviteLink');
    fallback.value = url.href;
    fallback.hidden = false;
    say(await copy(url.href, fallback) ? 'Invitation link copied.' : 'Invitation link selected. Tap Copy.');
  });

  $('waterSaveGoal').onclick = guarded(async () => {
    const goal = Number($('waterGoal').value);
    if (!Number.isFinite(goal) || goal <= 0 || goal > 256) throw new Error('Enter a daily goal above 0 and up to 256 oz.');
    await rpc('set_water_goal', { d: localDay(), goal });
    await refresh();
    say('Daily goal saved.');
  });

  const waterButtons = document.querySelectorAll('[data-water],#waterCustomAdd,#waterCorrect');
  let logging = false;
  async function addWater(delta) {
    if (logging) return;
    logging = true;
    waterButtons.forEach(button => { button.disabled = true; });
    try {
      await rpc('log_water', { d: localDay(), v: delta });
      say('Water log updated.');
      await refresh();
    } finally {
      logging = false;
      waterButtons.forEach(button => { button.disabled = false; });
    }
  }

  document.querySelectorAll('[data-water]').forEach(button => {
    button.onclick = guarded(() => addWater(Number(button.dataset.water)));
  });

  function changeCustomWater(direction) {
    return guarded(async () => {
      const value = Number($('waterCustom').value);
      if (!Number.isFinite(value) || value <= 0 || value > 128) throw new Error('Enter an amount above 0 and up to 128 oz.');
      await addWater(direction * value);
      $('waterCustom').value = '';
    });
  }
  $('waterCustomAdd').onclick = changeCustomWater(1);
  $('waterCorrect').onclick = changeCustomWater(-1);

  function validPresets(values) {
    return Array.isArray(values) && values.length === 3 &&
      values.every(value => Number.isFinite(value) && value > 0 && value <= 128);
  }

  function presets(values) {
    document.querySelectorAll('[data-water]').forEach((button, i) => {
      button.dataset.water = values[i];
      button.textContent = '+' + values[i] + ' oz';
    });
    $('waterPresets').value = values.join(', ');
  }

  const savedPresets = readJSON('iron-log-water-presets');
  presets(validPresets(savedPresets) ? savedPresets : [8, 16, 24]);
  $('saveWaterPresets').onclick = guarded(async () => {
    const values = $('waterPresets').value.split(',').map(Number);
    if (!validPresets(values)) throw new Error('Enter three amounts above 0 and up to 128 oz.');
    if (!write('iron-log-water-presets', JSON.stringify(values))) throw new Error('Browser storage is unavailable.');
    presets(values);
    say('Quick amounts saved.');
  });

  // Realtime events invalidate the affected views. REST remains the source of truth
  // and catches missed events after reconnect, resume or midnight.
  const socialPage = document.querySelector('[data-page="social"]');
  const visible = () => !document.hidden && !socialPage.hidden;
  const topic = 'realtime:iron-log-hydration';
  const refreshVisible = guarded(async () => { if (auth && visible()) await refresh(); });
  let connection = null, refreshEvent, retry, reconnectMs = 1000;

  function closeRealtime() {
    clearTimeout(retry);
    retry = null;
    clearTimeout(refreshEvent);
    if (!connection) return;
    const old = connection;
    connection = null;
    clearInterval(old.heartbeat);
    old.socket?.close();
  }

  function sendRealtime(channel, event, payload) {
    if (channel.socket?.readyState === WebSocket.OPEN) {
      channel.socket.send(JSON.stringify([channel.joinRef, String(++channel.ref), topic, event, payload]));
    }
  }

  function sendRealtimeToken() {
    if (connection && auth) sendRealtime(connection, 'access_token', { access_token: auth.access_token });
  }

  async function watchRealtime(user, group) {
    if (!visible() || !('WebSocket' in window) || (connection?.user === user && connection.group === group)) return;
    if (retry) return;
    closeRealtime();
    const channel = { user, group, ref: 0, joinRef: null, heartbeat: null, socket: null };
    connection = channel;
    const retryChannel = () => {
      if (connection !== channel) return;
      closeRealtime();
      if (!visible() || auth?.user.id !== user) return;
      retry = setTimeout(() => { retry = null; refreshVisible(); }, reconnectMs);
      reconnectMs = Math.min(reconnectMs * 2, 30000);
    };
    try {
      const active = await session();
      if (connection !== channel || active.user.id !== user) return;
      const url = base.replace(/^https:/, 'wss:') + '/realtime/v1/websocket?vsn=2.0.0&apikey=' + encodeURIComponent(apiKey);
      const socket = channel.socket = new WebSocket(url);
      const changes = [
        ['hydration_personal', 'user_id', user],
        ['hydration_profiles', 'user_id', user],
        ['hydration_members', 'user_id', user]
      ];
      if (group) changes.push(['hydration_daily', 'group_id', group],
        ['hydration_members', 'group_id', group], ['hydration_groups', 'id', group]);
      socket.onopen = () => {
        if (connection !== channel) return;
        channel.joinRef = '1';
        sendRealtime(channel, 'phx_join', {
          access_token: auth.access_token,
          config: {
            broadcast: { ack: false, self: false }, presence: { enabled: false }, private: false,
            postgres_changes: changes.flatMap(([table, column, value]) => ['INSERT', 'UPDATE'].map(event =>
              ({ event, schema: 'public', table, filter: column + '=eq.' + value })))
          }
        });
        channel.lastHeartbeat = Date.now();
        channel.heartbeat = setInterval(() => {
          if (Date.now() - channel.lastHeartbeat > 39000) { retryChannel(); return; }
          socket.send(JSON.stringify([null, String(++channel.ref), 'phoenix', 'heartbeat', {}]));
          session().catch(retryChannel);
        }, 20000);
      };
      socket.onmessage = message => {
        if (connection !== channel) return;
        let envelope;
        try { envelope = JSON.parse(message.data); } catch { return; }
        const [, ref, msgTopic, event, payload] = envelope;
        if (msgTopic === 'phoenix' && event === 'phx_reply') channel.lastHeartbeat = Date.now();
        if (event === 'phx_error' || event === 'phx_close' ||
            (event === 'phx_reply' && ref === channel.joinRef && payload.status !== 'ok')) {
          retryChannel();
        } else if (event === 'postgres_changes' ||
                   (event === 'system' && payload.status === 'ok') ||
                   (event === 'phx_reply' && ref === channel.joinRef)) {
          reconnectMs = 1000;
          clearTimeout(refreshEvent);
          refreshEvent = setTimeout(refreshVisible, 120);
        }
      };
      socket.onclose = retryChannel;
      socket.onerror = retryChannel;
    } catch { retryChannel(); }
  }

  const backupPref = user => 'iron-log-auto-cloud-' + user;
  const ownerPref = () => auth && backupPref(auth.user.id);
  let backupTimer, backupBusy = false, backupAgain = false;
  const dirty = new Map();
  const pendingBackupKey = user => backupPref(user) + '-pending';
  const pendingBackup = user => dirty.get(user);

  function restorePendingBackup(user) {
    const revision = readJSON(pendingBackupKey(user));
    if (revision && !dirty.has(user)) dirty.set(user, revision);
  }

  function clearPendingBackup(user, revision) {
    if (pendingBackup(user)?.id === revision?.id) dirty.delete(user);
    if (revision && readJSON(pendingBackupKey(user))?.id === revision.id) write(pendingBackupKey(user), null);
  }
  const autoStatus = text => { $('autoCloudStatus').textContent = text; };

  function cloudUI() {
    const pref = ownerPref();
    const enabled = !!pref && read(pref) === 'yes';
    if (!backupBusy) $('autoCloud').checked = enabled;
    $('autoCloud').disabled = !pref || backupBusy;
    $('socialBackup').disabled = $('socialRestore').disabled = backupBusy;
    autoStatus(enabled ? 'Automatic backups on. Last success: ' + (read(pref + '-last') || 'not yet saved')
      : pref ? 'Automatic backups off.' : 'Join Iron Log to enable automatic backups.');
  }

  async function cloudRow(user, includePayload = false) {
    const rows = await rest('workout_backups?select=' + (includePayload ? 'payload,' : '') +
      'updated_at&user_id=eq.' + user, undefined, user);
    return rows[0];
  }

  async function saveCloud(user, expected) {
    const revision = pendingBackup(user);
    const snapshot = JSON.parse(JSON.stringify(makeBackup()));
    backupParts(snapshot);
    const version = await rpc('save_workout_backup', { snapshot, expected }, user);
    const pref = backupPref(user);
    write(pref + '-server', version);
    write(pref + '-last', new Date().toLocaleString());
    const latest = pendingBackup(user);
    if (latest?.id === revision?.id) clearPendingBackup(user, revision);
    else if (latest && dirty.get(user)?.id === latest.id) {
      latest.expected = version;
      if (read(pref) === 'yes') write(pendingBackupKey(user), JSON.stringify(latest));
      scheduleBackup();
    }
  }

  async function runBackup(fn, automatic = false) {
    if (!auth) throw new Error('Sign in first.');
    if (backupBusy) {
      if (automatic) backupAgain = true;
      return;
    }
    const user = auth.user.id;
    const pref = backupPref(user);
    let message;
    backupBusy = true;
    cloudUI();
    try { await fn(user, pref); }
    catch (error) {
      if (error.status === 409) {
        write(pref, null);
        clearPendingBackup(user, pendingBackup(user));
        message = 'Cloud backup changed on another device. Restore it or save a new backup manually.';
        if (!automatic) throw new Error(message);
      } else if (automatic) message = 'Backup pending: ' + error.message;
      else throw error;
    } finally {
      backupBusy = false;
      cloudUI();
      if (message && auth?.user.id === user) autoStatus(message);
      if (backupAgain) { backupAgain = false; scheduleBackup(); }
    }
  }

  $('socialBackup').onclick = guarded(() => runBackup(async user => {
    const row = await cloudRow(user);
    if (!confirm(row ? 'Replace the current cloud backup with this device’s workouts and settings?'
      : 'Save this device’s workouts and settings to your private cloud backup?')) return;
    await saveCloud(user, row?.updated_at ?? null);
    say('Cloud backup saved.');
  }));

  $('socialRestore').onclick = guarded(() => runBackup(async (user, pref) => {
    const row = await cloudRow(user, true);
    if (!row) throw new Error('No cloud backup found.');
    const parts = backupParts(row.payload);
    if (auth?.user.id !== user || !confirm('Replace local workouts and any settings included in your cloud backup?')) return;
    restoreBackup(parts);
    clearTimeout(backupTimer);
    backupAgain = false;
    clearPendingBackup(user, pendingBackup(user));
    write(pref + '-server', row.updated_at);
    say('Cloud backup restored.');
  }));

  $('autoCloud').onchange = guarded(async () => {
    const enable = $('autoCloud').checked;
    if (!enable) {
      if (auth) write(backupPref(auth.user.id), null);
      clearTimeout(backupTimer);
      cloudUI();
      return;
    }
    await runBackup(async (user, pref) => {
      const row = await cloudRow(user);
      if (!confirm(row ? 'Replace the current cloud backup and back up future changes automatically?'
        : 'Save this device’s workouts and settings and back up future changes automatically?')) return;
      await saveCloud(user, row?.updated_at ?? null);
      if (!write(pref, 'yes')) throw new Error('Backup saved, but browser storage is unavailable for automatic backup.');
      scheduleBackup();
    });
  });

  function scheduleBackup() {
    clearTimeout(backupTimer);
    const user = auth?.user.id;
    if (user && pendingBackup(user) && read(backupPref(user)) === 'yes') {
      backupTimer = setTimeout(() => {
        const pending = pendingBackup(user);
        if (auth?.user.id === user && pending && read(backupPref(user)) === 'yes') {
          runBackup(active => saveCloud(active, pending.expected), true);
        }
      }, 2000);
    }
  }

  window.addEventListener('ironlog:saved', () => {
    const user = auth?.user.id;
    if (!user) return;
    const pref = backupPref(user);
    const previous = pendingBackup(user);
    const update = { id: Date.now() + '-' + Math.random(), expected: previous ? previous.expected : read(pref + '-server') };
    dirty.set(user, update);
    if (read(pref) === 'yes') write(pendingBackupKey(user), JSON.stringify(update));
    scheduleBackup();
  });
  window.addEventListener('online', () => { scheduleBackup(); refreshVisible(); });
  window.addEventListener('ironlog:tab', () => { if (visible()) refreshVisible(); else closeRealtime(); });
  document.addEventListener('visibilitychange', () => { if (visible()) refreshVisible(); else closeRealtime(); });
  window.addEventListener('pageshow', refreshVisible);
  window.addEventListener('pagehide', closeRealtime);
  window.addEventListener('storage', event => {
    if (event.key !== tokenKey) return;
    const next = sessionData(readJSON(tokenKey));
    if (auth?.user.id !== next?.user.id) {
      auth = next;
      closeRealtime();
      current = auth ? read(groupKey(auth.user.id)) : null;
      selectedGroup = null;
      updateIdentity();
      if (auth) restorePendingBackup(auth.user.id);
      cloudUI();
      refreshVisible();
    }
  });

  updateIdentity();
  if (auth) restorePendingBackup(auth.user.id);
  cloudUI();
  const invite = new URLSearchParams(location.search).get('join');
  if (validUUID(invite || '')) {
    $('socialCode').value = invite;
    $('socialCode').closest('details').open = true;
    tab('social');
  }
  refreshVisible();
  scheduleBackup();
  setInterval(refreshVisible, 30000);
})();
