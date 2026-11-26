# Iron Log

Iron Log is a local-first strength training PWA with optional Supabase workout backups and hydration groups. Training, routines, exercise settings and the rest timer stay usable offline.

## Iron Log 5.3

Train opens a dedicated logger with an exercise queue, working-set progress and a completion summary. History expands by workout, and Progress and Body show charts and period metrics. Hydration focuses on intake and groups. Membership, recovery and backups live in Profile.

## Membership and hydration

- Generate a recovery code under Hydration and save it somewhere private. Recover from the signed-out screen on another device, then save the replacement code. Recovery moves group access, hydration history and cloud backups to the new session. Restore the cloud backup separately to bring workouts and settings to that device.
- Log water once to update your personal total and every group you belong to. The goal streak uses each day's recorded goal, and yesterday's streak stays current until today's logging window closes. For dates before the upgrade, personal history uses the highest available group total for each day, and the original group totals remain stored.
- Group owners can rename the group, remove members or transfer ownership. Removing a member rotates the invitation. Personal history survives leaving a group.
- File and cloud backups include workouts, body weight, custom routines and exercise settings. Older backups leave routines and settings in place. Automatic backup is opt-in and stops when another device saves a newer version.

## Development

Run `npm ci`, `npm test`, and `npm run test:db` with Docker. Run `npx playwright install --with-deps chromium webkit` once and then `npm run test:browser` for desktop Chromium and mobile WebKit, including a compact 320px layout check. The database tests apply the migrations to an isolated PostgreSQL instance with fixture users. Browser tests use a mocked Supabase API and WebSocket.

For an existing Supabase deployment, apply only the new migration after the four legacy migrations. The migration enables the hydration tables in the existing Realtime publication. Keep anonymous sign-in enabled. Reload older app tabs to get the updated backup and group controls.
