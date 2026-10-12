/* Unit tests for the RBAC authorization hook (Swing AuthorizationController port). */
import { setAuthorizationController, checkTask, blockAuthorization, authorizationRegistration } from './authorization.js';

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

// A broken authorization provider must never grant a task.
setAuthorizationController({ checkTask() { throw new Error('boom'); } });
ok(checkTask('channel', 'doNewChannel') === false, 'throwing controller fails closed');

// Explicit clearing resets to allow-all; an invalid provider remains denied.
setAuthorizationController(null);
ok(checkTask('channel', 'doNewChannel') === true, 'cleared → allow all');
setAuthorizationController({ notCheckTask: true });
ok(checkTask('channel', 'doNewChannel') === false, 'controller without checkTask → deny');
const before = authorizationRegistration();
setAuthorizationController({ checkTask: () => true });
ok(authorizationRegistration().registered && authorizationRegistration().revision > before.revision, 'valid provider has a registration receipt');
blockAuthorization(true);
ok(!checkTask('view', 'doShowDashboard'), 'pending discovery blocks a permissive provider');
setAuthorizationController(null);
ok(!checkTask('view', 'doShowDashboard'), 'clearing controller cannot remove bootstrap denial');
blockAuthorization(false);
ok(checkTask('view', 'doShowDashboard'), 'successful discovery without provider restores default');
let threw = false;
try { setAuthorizationController({ initialize() { throw new Error('cannot load'); }, checkTask: () => true }); }
catch { threw = true; }
ok(threw && !authorizationRegistration().registered, 'failed initialization cannot earn valid receipt');
ok(!checkTask('view', 'doShowDashboard'), 'failed initialization remains denied');
setAuthorizationController(null);

console.log(`authorization.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
