/*
 * Users view (React port of views/users.js). The grid wraps core/ui.js
 * DataTable via <DataTableHost>; the create/edit/password modals reuse the
 * imperative modal()/field()/textInput() helpers as-is (called from React
 * handlers); the task pane is React, portaled into the rail via <ViewTasks>.
 */

import { useState, useEffect, useRef } from 'react';
import { h, toast, confirmDialog, contextMenu, modal, field, textInput, fmtDate } from '@oie/web-ui';
import api from '@oie/web-api';
import * as store from '../../core/store.js';
import { reactView, ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton, DataTableHost } from '../ui.jsx';
import { passwordRequirementHints } from '../../core/passwords.js';

export function register(platform) {
    platform.registerNavItem({ id: 'users', label: 'Users', icon: 'users', path: '/users', section: 'Engine', order: 2, task: 'doShowUsers' });
    platform.registerView('/users', reactView(UsersView), { title: 'Users' });
}

/* Fields editable in the web UI; everything else on the User object is
   preserved on round-trip. */
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

const COLUMNS = [
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
];

/* ---- imperative form helpers (reused verbatim) ---- */

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
    // Show the configured policy up front (the engine still enforces on submit).
    const hint = h('div.hint', { class: 'mt-1.5' });
    api.server.passwordRequirements()
        .then((req) => { const hs = passwordRequirementHints(req); if (hs.length) hint.textContent = `Password must include ${hs.join(', ')}.`; })
        .catch(() => { /* requirements unavailable */ });
    return {
        password, confirm,
        grid: h('div',
            h('div.form-grid', field('Password', password), field('Confirm Password', confirm)),
            hint),
        validate() {
            if (!password.value) { toast('Password is required', 'warn'); return false; }
            if (password.value !== confirm.value) { toast('Passwords do not match', 'warn'); return false; }
            return true;
        }
    };
}

function UsersView() {
    const [users, setUsers] = useState([]);
    const [sel, setSel] = useState([]);
    const tableRef = useRef(null);

    const refresh = async () => {
        try {
            const list = (await api.users.list()).filter(u => u && u.id !== undefined);
            setUsers(list);
            setSel([]);
        } catch (e) {
            toast(e.message, 'error');
        }
    };
    useEffect(() => { refresh(); }, []);

    const single = () => (sel.length === 1 ? sel[0] : null);

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
                            // Enforce the password policy BEFORE creating the user
                            // (Swing checks first) — otherwise a rejected password
                            // leaves a passwordless user behind and the requirement
                            // is effectively ignored.
                            const violations = passwordViolations(await api.users.checkPassword(pw.password.value));
                            if (violations.length) { toast(`Password rejected: ${violations.join('; ')}`, 'warn'); return false; }

                            const user = {};
                            for (const def of USER_FIELDS) user[def.key] = form.inputs[def.key].value.trim();
                            user.username = username;
                            await api.users.create(user);
                            const list = await api.users.list();
                            const created = list.find(u => u.username === username);
                            if (!created) throw new Error('User was created but could not be found to set the password');
                            await api.users.updatePassword(created.id, pw.password.value);
                            toast(`User "${username}" created`);
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
        if (!user) { toast('Select a user first', 'warn'); return; }
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
        if (!user) { toast('Select a user first', 'warn'); return; }
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
                            if (violations.length) { toast(violations.join('; '), 'warn'); return false; }
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
        if (!user) { toast('Select a user first', 'warn'); return; }
        const me = store.getState('user');
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

    const openMenu = (u, e) => {
        setSel(tableRef.current ? tableRef.current.selectedRows() : [u]);
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshUser', group: 'user', onClick: () => refresh() },
            { label: 'New User', icon: 'plus', task: 'doNewUser', group: 'user', onClick: () => newTask() },
            '-',
            { label: 'Edit User', icon: 'edit', task: 'doEditUser', group: 'user', onClick: () => editTask(u) },
            { label: 'Change Password', icon: 'key', onClick: () => passwordTask(u) },
            '-',
            { label: 'Delete User', icon: 'trash', danger: true, task: 'doDeleteUser', group: 'user', onClick: () => deleteTask(u) }
        ]);
    };

    const options = {
        selectable: 'single',
        rowKey: (u) => String(u.id),
        emptyText: 'No users',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-users',
        onActivate: (u) => editTask(u),
        onSelect: (rows) => setSel(rows),
        onContextMenu: openMenu
    };

    const hasSel = sel.length > 0;

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="User Tasks" paneKey="tasks:User Tasks" group="user">
                    <div className="taskbar" data-pane-title="User Tasks">
                        <TaskButton label="Refresh" icon="refresh" task="doRefreshUser" onClick={refresh} />
                        <TaskButton label="New User" icon="plus" primary task="doNewUser" onClick={() => newTask()} />
                        {hasSel && <TaskButton label="Edit User" icon="edit" task="doEditUser" onClick={() => editTask()} />}
                        {hasSel && <TaskButton label="Delete User" icon="trash" danger task="doDeleteUser" onClick={() => deleteTask()} />}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body">
                <div className="panel"><div className="panel-body flush">
                    <DataTableHost columns={COLUMNS} options={options} rows={users}
                        onReady={(t) => { tableRef.current = t; }} />
                </div></div>
            </div>
        </div>
    );
}
