/*
 * Users view (React port of views/users.js). The grid wraps core/ui.js
 * DataTable via <DataTableHost>; the create/edit/password modals reuse the
 * imperative modal()/field()/textInput() helpers as-is (called from React
 * handlers); the task pane is React, portaled into the rail via <ViewTasks>.
 */

import { useState, useEffect, useRef } from 'react';
import { h, toast, confirmDialog, contextMenu, modal, fmtDate } from '@oie/web-ui';
import api from '@oie/web-api';
import * as store from '../../core/store.js';
import { reactView, ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton, DataTableHost } from '../ui.jsx';
import {
    USER_FIELDS, userForm, passwordFields, passwordViolations,
    openEditUserModal, openChangePasswordModal
} from './user-modals.js';

export function register(platform) {
    platform.registerNavItem({ id: 'users', label: 'Users', icon: 'users', path: '/users', section: 'Engine', order: 2, task: 'doShowUsers' });
    platform.registerView('/users', reactView(UsersView), { title: 'Users' });
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
        openEditUserModal(user, { onSaved: refresh });
    }

    function passwordTask(selected) {
        const user = selected || single();
        if (!user) { toast('Select a user first', 'warn'); return; }
        openChangePasswordModal(user);
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
