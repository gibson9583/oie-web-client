/*
 * Users — user administration (parity with the Swing Administrator's user
 * panel). Lists com.mirth.connect.model.User objects and supports create,
 * edit, password change, and delete.
 *
 * The REST API splits credentials from the user record: POST /users creates
 * the record, then PUT /users/{id}/password (text/plain body) sets the
 * password. That endpoint returns a list of password-requirement violations;
 * an empty list means success.
 */

import { h, toast, taskButton, confirmDialog, contextMenu, DataTable, modal, field, textInput, fmtDate } from '@oie/web-ui';
import api from '@oie/web-api';

export function register(platform) {
    platform.registerNavItem({ id: 'users', label: 'Users', icon: 'users', path: '/users', section: 'Engine', order: 2 });
    platform.registerView('/users', () => renderUsers(platform), { title: 'Users' });
}

/* Fields editable in the web UI; everything else on the User object
   (strikeCount, role, industry, …) is preserved on round-trip. */
const USER_FIELDS = [
    { key: 'username', label: 'Username' },
    { key: 'firstName', label: 'First Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'organization', label: 'Organization' },
    { key: 'email', label: 'Email' },
    { key: 'phoneNumber', label: 'Phone' }
];

function passwordViolations(result) {
    return api.asList(result, 'string').map(String).filter(s => s.trim());
}

function renderUsers(platform) {
    let users = [];

    const table = new DataTable([
        { key: 'username', label: 'Username', render: (u) => u.username || '' },
        { key: 'firstName', label: 'First Name', render: (u) => u.firstName || '' },
        { key: 'lastName', label: 'Last Name', render: (u) => u.lastName || '' },
        { key: 'organization', label: 'Organization', render: (u) => u.organization || '' },
        { key: 'email', label: 'Email', render: (u) => u.email || '' },
        { key: 'phoneNumber', label: 'Phone', render: (u) => u.phoneNumber || '' },
        {
            key: 'lastLogin', label: 'Last Login', className: 'mono',
            sortValue: (u) => {
                const v = u.lastLogin;
                return typeof v === 'object' ? Number(v?.time ?? v?.timestamp ?? 0) : Number(v) || 0;
            },
            render: (u) => fmtDate(u.lastLogin)
        }
    ], {
        selectable: 'single',
        rowKey: (u) => String(u.id),
        emptyText: 'No users',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-users',
        onActivate: (u) => editTask(u),
        onSelect: () => updateTaskVisibility(),
        // Right-click selects the row without firing onSelect, so sync here too.
        // Full Swing userPopupMenu (Frame.userPopupMenu) plus Change Password.
        onContextMenu: (u, e) => {
            updateTaskVisibility();
            contextMenu(e.clientX, e.clientY, [
                { label: 'Refresh', icon: 'refresh', onClick: () => refresh() },
                { label: 'New User', icon: 'plus', onClick: () => newTask() },
                '-',
                { label: 'Edit User', icon: 'edit', onClick: () => editTask(u) },
                { label: 'Change Password', icon: 'key', onClick: () => passwordTask(u) },
                '-',
                { label: 'Delete User', icon: 'trash', danger: true, onClick: () => deleteTask(u) }
            ]);
        }
    });

    async function refresh() {
        try {
            users = (await api.users.list()).filter(u => u && u.id !== undefined);
            table.setRows(users);
            updateTaskVisibility();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    function single() {
        const rows = table.selectedRows();
        if (rows.length !== 1) { toast('Select a user first', 'warn'); return null; }
        return rows[0];
    }

    /* ---- field form helper ---- */

    function userForm(user = {}) {
        const inputs = {};
        const grid = h('div.form-grid');
        for (const def of USER_FIELDS) {
            inputs[def.key] = textInput(user[def.key] ?? '');
            grid.appendChild(field(def.label, inputs[def.key]));
        }
        return { grid, inputs };
    }

    function passwordFields() {
        const password = h('input', { type: 'password' });
        const confirm = h('input', { type: 'password' });
        return {
            password, confirm,
            grid: h('div.form-grid',
                field('Password', password),
                field('Confirm Password', confirm)),
            validate() {
                if (!password.value) { toast('Password is required', 'warn'); return false; }
                if (password.value !== confirm.value) { toast('Passwords do not match', 'warn'); return false; }
                return true;
            }
        };
    }

    /* ---- tasks ---- */

    function newTask() {
        const form = userForm();
        const pw = passwordFields();
        modal({
            title: 'New User',
            size: 'wide',
            body: h('div', form.grid, pw.grid),
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Create', primary: true,
                    onClick: async () => {
                        const username = form.inputs.username.value.trim();
                        if (!username) { toast('Username is required', 'warn'); return false; }
                        if (!pw.validate()) return false;
                        try {
                            const user = {};
                            for (const def of USER_FIELDS) user[def.key] = form.inputs[def.key].value.trim();
                            user.username = username;
                            await api.users.create(user);
                            const list = await api.users.list();
                            const created = list.find(u => u.username === username);
                            if (!created) throw new Error('User was created but could not be found to set the password');
                            const violations = passwordViolations(await api.users.updatePassword(created.id, pw.password.value));
                            if (violations.length) {
                                toast(`User created, but the password was rejected: ${violations.join('; ')}. Use Change Password to set one.`, 'warn');
                            } else {
                                toast(`User "${username}" created`);
                            }
                            refresh();
                            return true;
                        } catch (e) {
                            toast(e.message, 'error');
                            return false;
                        }
                    }
                }
            ]
        });
    }

    function editTask(selected) {
        const user = selected || single();
        if (!user) return;
        const form = userForm(user);
        modal({
            title: `Edit User — ${user.username}`,
            size: 'wide',
            body: form.grid,
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Save', primary: true,
                    onClick: async () => {
                        const username = form.inputs.username.value.trim();
                        if (!username) { toast('Username is required', 'warn'); return false; }
                        try {
                            // Round-trip the fetched object: mutate fields, send it back.
                            for (const def of USER_FIELDS) user[def.key] = form.inputs[def.key].value.trim();
                            await api.users.update(user.id, user);
                            toast(`User "${username}" saved`);
                            refresh();
                            return true;
                        } catch (e) {
                            toast(e.message, 'error');
                            return false;
                        }
                    }
                }
            ]
        });
    }

    function passwordTask(selected) {
        const user = selected || single();
        if (!user) return;
        const pw = passwordFields();
        modal({
            title: `Change Password — ${user.username}`,
            body: pw.grid,
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Change Password', primary: true,
                    onClick: async () => {
                        if (!pw.validate()) return false;
                        try {
                            const violations = passwordViolations(await api.users.updatePassword(user.id, pw.password.value));
                            if (violations.length) {
                                toast(violations.join('; '), 'warn');
                                return false;
                            }
                            toast(`Password updated for "${user.username}"`);
                            return true;
                        } catch (e) {
                            toast(e.message, 'error');
                            return false;
                        }
                    }
                }
            ]
        });
    }

    async function deleteTask(selected) {
        const user = selected || single();
        if (!user) return;
        const me = platform.store.getState('user');
        if (me && String(me.id) === String(user.id)) {
            toast('You cannot delete the user you are signed in as', 'warn');
            return;
        }
        if (!await confirmDialog('Delete user', `Permanently delete user "${user.username}"? This cannot be undone.`, { danger: true, okLabel: 'Delete' })) return;
        try {
            await api.users.remove(user.id);
            toast(`User "${user.username}" deleted`);
        } catch (e) {
            toast(e.message, 'error');
        }
        refresh();
    }

    /* ---- task bar ---- */

    // Selection-dependent tasks live in a context group that only shows when
    // a user is selected (classic task-pane behavior).
    const ctxTasks = h('div.ctx-tasks.hidden',
        taskButton('Edit User', 'edit', () => editTask()),
        taskButton('Change Password', 'key', () => passwordTask()),
        h('span.sep'),
        taskButton('Delete', 'trash', () => deleteTask(), { danger: true }));

    function updateTaskVisibility() {
        ctxTasks.classList.toggle('hidden', table.selectedRows().length === 0);
    }

    const taskbar = h('div.taskbar', { dataset: { paneTitle: 'User Tasks' } },
        taskButton('Refresh', 'refresh', () => refresh()),
        h('span.sep'),
        taskButton('New User', 'plus', () => newTask(), { primary: true }),
        ctxTasks);

    refresh();

    const el = h('div.view',
        taskbar,
        h('div.view-body',
            h('div.panel', h('div.panel-body.flush', table.el))));

    return { el };
}
