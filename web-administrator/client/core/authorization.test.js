/* Unit tests for the RBAC authorization hook (Swing AuthorizationController port). */
import { setAuthorizationController, checkTask } from './authorization.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error('  FAIL -', label); } };

// Default controller: allow everything (no RBAC plugin installed).
ok(checkTask('channel', 'doNewChannel') === true, 'default allows a tagged task');
ok(checkTask('view', 'doShowDashboard') === true, 'default allows a nav item');

// Untagged items (no task name) are always allowed.
ok(checkTask('channel', '') === true, 'missing task → allowed');
ok(checkTask(null, null) === true, 'null/null → allowed');

// A denying controller hides exactly the matched (group, task).
let initialized = 0;
setAuthorizationController({
    initialize() { initialized++; },
    checkTask(g, t) { return !(g === 'channel' && t === 'doNewChannel'); }
});
ok(initialized === 1, 'initialize() runs once on register');
ok(checkTask('channel', 'doNewChannel') === false, 'denied (group,task) is hidden');
ok(checkTask('channel', 'doDeleteChannel') === true, 'sibling task still allowed');
ok(checkTask('view', 'doShowDashboard') === true, 'unrelated group/task allowed');

// A task WITHOUT a group still consults the controller (group passed as '') —
// a missing group tag must not silently fail open.
setAuthorizationController({ checkTask(g, t) { return !(g === '' && t === 'doSaveChannel'); } });
ok(checkTask('', 'doSaveChannel') === false, 'groupless task still checked (empty group)');
ok(checkTask(undefined, 'doSaveChannel') === false, 'groupless task still checked (undefined group)');
ok(checkTask(undefined, 'doExportChannel') === true, 'groupless unrelated task allowed');

// A controller that returns a truthy non-boolean still shows (only false hides).
setAuthorizationController({ checkTask: () => undefined });
ok(checkTask('channel', 'doNewChannel') === true, 'non-false return → visible');

// A throwing controller fails OPEN (visible), like Swing's default.
setAuthorizationController({ checkTask() { throw new Error('boom'); } });
ok(checkTask('channel', 'doNewChannel') === true, 'throwing controller fails open');

// Invalid controller / clearing resets to allow-all.
setAuthorizationController(null);
ok(checkTask('channel', 'doNewChannel') === true, 'cleared → allow all');
setAuthorizationController({ notCheckTask: true });
ok(checkTask('channel', 'doNewChannel') === true, 'controller without checkTask → allow all');

console.log(`authorization.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
