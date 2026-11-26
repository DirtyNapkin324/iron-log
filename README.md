# Iron Log

Iron Log is a local-first strength training PWA with optional Supabase workout backups and hydration groups. Training, routines, exercise settings and the rest timer stay usable offline.

## Iron Log 5.5.1

Train opens a dedicated logger with an exercise queue, working-set progress and a completion summary. History expands by workout, and Progress and Body show charts and period metrics. Hydration focuses on intake and groups. Membership, recovery and backups live in Profile.

## Active workout interface

- Use the workout menu beside **Finish** to edit workout details or cancel. You can keep logged sets, or explicitly confirm that the sets tied to the active session should be discarded. Older sets without a verified session link are kept.
- The exercise menu holds substitutions, settings, notes, previous performances, and skipping. **Next exercise** previews the next prescription and asks before leaving incomplete sets behind.
- Apply recommendations in the exercise card. Warm-up and plate calculators open in sheets and retain their in-session inputs while the selected exercise and working load stay the same.
- History shows all workout types together. Its calendar and search still narrow what is displayed.

## Training experience

- **Train** compares planned working sets with the previous comparable workout. The active queue and unfinished entry drafts survive reloads. You can undo the last set, edit logged sets, and adjust the number of planned sets during a workout.
- Classify working, warm-up, drop and back-off sets separately. Record failure and partial reps independently. Progression and records use full working reps from the same exercise identity. General volume includes drop and back-off sets and excludes warm-ups. Supersets alternate two adjacent exercises and start rest after the second exercise.
- Warm-ups use the chosen work weight and equipment increment. The plate calculator applies only to bar-based equipment and supports per-unit bar weights and paired plate inventory. Choose pounds or kilograms in Profile. Stored weights and CSV exports use pounds.
- History’s monthly calendar groups completed workout sessions, including multiple on one day. Older sets use their original date and routine grouping, and duration is available where recorded. Progress lists personal records and separates direct muscle sets from secondary involvement. Body includes a goal and a rolling seven-day average.
- The rest timer uses a deadline and recovers its display after reload. Sound requires an unlocked audio session, and vibration depends on browser support. iOS may suspend background JavaScript. Home Screen Web Push requires a separate delivery service and is not used for rest alerts.

## Backup and recovery

- Open a local or cloud backup to preview added, skipped and conflicting records. Merge keeps the current value for conflicts. Distinct set IDs remain distinct even when their numbers match. Older sets without IDs use a fingerprint and occurrence count.
- Replace stores one pre-replacement snapshot on this device. Recover or export it under **Profile → Local backups and export**. Each successful replacement keeps the immediately preceding snapshot. Replacement stops if the browser cannot store it.
- Backups include workout sessions and notes, active workout drafts, training preferences, bodyweight goals, routines, exercise settings and exercise notes. Older backups remain readable and old storage keys are retained. No database migration is required for 5.5.1.
- The existing cloud backup remains a single version with conflict protection. Supabase Free has a 500 MB database limit, so 5.5 keeps rollback on the device instead of storing multiple cloud copies of each complete backup.

## Routine builder

- In **Train → Manage routines**, create a routine from scratch or choose a PPL, Upper/Lower, full-body or bodybuilding template. Rename, duplicate, reorder, archive and restore routines there.
- Use **Edit routine** to select from 257 offline exercises, search aliases, filter by equipment or muscle, and browse Recent or Favorites. Create custom exercises in the same library.
- Drag a card by its handle or use its up/down buttons. Each row can override sets, rep range, rest, increment, target reps in reserve, and instructions. The logger uses these prescriptions for recommendations, progress and rest.
- Use **Swap for today** in an active workout to change its exercise queue. Replace a card in **Edit routine** to change future workouts. Existing workout entries retain their exercise names and identities.
- Builder data has its own versioned local storage key. The original routine and settings keys are still supported. File and cloud backups carry the new builder data and can restore earlier formats.

## Membership and hydration

- Generate a recovery code in Profile and save it somewhere private. Recover from the signed-out screen on another device, then save the replacement code. Recovery moves group access, hydration history and cloud backups to the new session. Restore the cloud backup separately to bring workouts and settings to that device.
- Log water once to update your personal total and every group you belong to. The goal streak uses each day's recorded goal, and yesterday's streak stays current until today's logging window closes. For dates before the upgrade, personal history uses the highest available group total for each day, and the original group totals remain stored.
- Group owners can rename the group, remove members or transfer ownership. Removing a member rotates the invitation. Personal history survives leaving a group.
- File and cloud backups include workouts, body weight, custom routines and exercise settings. Older backups leave routines and settings in place. Automatic backup is opt-in and stops when another device saves a newer version.

## Development

Run `npm ci`, `npm test`, and `npm run test:db` with Docker. Run `npx playwright install --with-deps chromium webkit` once and then `npm run test:browser` for desktop Chromium and mobile WebKit, including 320px, 375px, 390px and 430px layout checks. The database tests apply the migrations to an isolated PostgreSQL instance with fixture users. Browser tests use a mocked Supabase API and WebSocket.

For an existing Supabase deployment, apply only the new migration after the four legacy migrations. The migration enables the hydration tables in the existing Realtime publication. Keep anonymous sign-in enabled. Reload older app tabs to get the updated backup and group controls.
