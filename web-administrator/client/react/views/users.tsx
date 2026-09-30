import { t } from '../../core/i18n.js';
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
import { ViewTasks } from '../mount.jsx';
import { useUsers, useInvalidate } from '../queries.js';
import { RailPane, TaskButton, DataTableHost } from '../ui.jsx';
import {
    USER_FIELDS, userForm, passwordFields, passwordViolations,
    openEditUserModal, openChangePasswordModal
} from './user-modals.js';
import { isSsoSelf } from '../sso-session.js';


const COLUMNS = [
    { key: 'username', label: t("Username"), render: (u: any) => u.username || '' },
    { key: 'firstName', label: t("First Name"), render: (u: any) => u.firstName || '' },
    { key: 'lastName', label: t("Last Name"), render: (u: any) => u.lastName || '' },
    { key: 'organization', label: t("Organization"), render: (u: any) => u.organization || '' },
    { key: 'email', label: t("Email"), render: (u: any) => u.email || '' },
    { key: 'phoneNumber', label: t("Phone"), render: (u: any) => u.phoneNumber || '' },
    {
        key: 'lastLogin', label: t("Last Login"), className: 'mono',
        sortValue: (u: any) => {
            const v = u.lastLogin;
            return typeof v === 'object' ? Number(v?.time ?? v?.timestamp ?? 0) : Number(v) || 0;
        },
        render: (u: any) => fmtDate(u.lastLogin)
    }
];

export function UsersView() {
    // Server state via TanStack Query — replaces the hand-rolled
    // useState + useEffect(list) + manual refetch. `refresh` now just invalidates
    // the cache (and clears selection, as the old imperative refresh did).
    const usersQuery = useUsers();
    const users = usersQuery.data ?? [];
    const [sel, setSel] = useState([] as any[]);
    const tableRef = useRef<any>(null);
    const invalidate = useInvalidate();

    // Surface load errors the way the old imperative refresh did (toast).
    useEffect(() => {
        if (usersQuery.error) toast(usersQuery.error.message, 'error');
    }, [usersQuery.error]);

    const refresh = () => { invalidate(['users']); setSel([]); };

    const single = () => (sel.length === 1 ? sel[0] : null);

    function newTask() {
        const form = userForm();
        const pw = passwordFields();
        const notice = h('p', { role: 'status', hidden: true });
        let phase: 'draft' | 'unknown' | 'unverified' | 'created' = 'draft';
        let busy = false;
        let createdId: string | number | undefined;
        let createdUsername = '';
        const dialog = modal({
            title: t("New User"),
            size: 'wide',
            body: h('div', notice, form.grid, pw.grid),
            buttons: [
                { label: t("Cancel") },
                {
                    label: t("Create"), primary: true,
                    onClick: async () => {
                        if (busy || (phase !== 'draft' && phase !== 'created')) return false;
                        const username = createdUsername || form.inputs.username.value.trim();
                        if (!username) { toast(t("Username is required"), 'warn'); return false; }
                        if (!pw.validate()) return false;
                        const password = (pw.password as HTMLInputElement).value;
                        const user: any = {};
                        for (const def of USER_FIELDS) user[def.key] = form.inputs[def.key].value.trim();
                        user.username = username;
                        busy = true;
                        form.grid.inert = pw.grid.inert = true;
                        const submit = dialog.el.querySelector<HTMLButtonElement>('.modal-foot .btn-primary');
                        if (submit) { submit.disabled = true; submit.textContent = t("Saving…"); }
                        try {
                            // Enforce the password policy BEFORE creating the user
                            // (Swing checks first) — otherwise a rejected password
                            // leaves a passwordless user behind and the requirement
                            // is effectively ignored.
                            const violations = passwordViolations(await api.users.checkPassword(password));
                            if (violations.length) { toast(t("Password rejected: {value1}", { value1: String(violations.join('; ')) }), 'warn'); return false; }

                            if (phase === 'draft') {
                                createdUsername = username;
                                // A failed response does not prove the write failed. Do
                                // not repeat creation or reset an unverified account.
                                phase = 'unknown';
                                await api.users.create(user);
                                phase = 'unverified';
                            }
                            if (createdId === undefined) {
                                const list = await api.users.list();
                                const created = list.find(u => u.username === username);
                                if (created?.id == null) throw new Error(t("The created account could not be found to set its password"));
                                createdId = created.id;
                                phase = 'created';
                            }
                            const rejected = passwordViolations(await api.users.updatePassword(createdId, password));
                            if (rejected.length) throw new Error(t("Password rejected: {value1}", { value1: String(rejected.join('; ')) }));
                            toast(t("User \"{value1}\" created", { value1: String(username) }));
                            return true;
                        } catch (e: any) {
                            toast(e.message, 'error');
                            return false;
                        } finally {
                            busy = false;
                            form.grid.inert = phase !== 'draft';
                            pw.grid.inert = phase === 'unknown' || phase === 'unverified';
                            if (phase !== 'draft') {
                                notice.hidden = false;
                                notice.textContent = phase === 'created'
                                    ? t("Account \"{value1}\" was created. Password setup is incomplete; retry below to finish.", { value1: String(createdUsername) })
                                    : phase === 'unverified'
                                    ? t("Account \"{value1}\" was created, but its identity could not be verified. Close this dialog, refresh Users, and select the account before changing its password.", { value1: String(createdUsername) })
                                    : t("Creation of \"{value1}\" could not be confirmed. Close this dialog, refresh Users, and verify the account before creating it again or changing its password.", { value1: String(createdUsername) });
                                refresh();
                            }
                            if (submit) {
                                submit.disabled = phase === 'unknown' || phase === 'unverified';
                                submit.textContent = phase === 'created' ? t("Retry Password Setup") : phase === 'unverified' ? t("Verify Account") : phase === 'unknown' ? t("Outcome Unknown") : t("Create");
                            }
                        }
                    }
                }
            ]
        });
    }

    function editTask(selected?: any) {
        const user = selected || single();
        if (!user) { toast(t("Select a user first"), 'warn'); return; }
        openEditUserModal(user, { onSaved: refresh });
    }

    function passwordTask(selected: any) {
        const user = selected || single();
        if (!user) { toast(t("Select a user first"), 'warn'); return; }
        openChangePasswordModal(user);
    }

    async function deleteTask(selected?: any) {
        const user = selected || single();
        if (!user) { toast(t("Select a user first"), 'warn'); return; }
        const me = store.getState('user');
        if (me && String(me.id) === String(user.id)) {
            toast(t("You cannot delete the user you are signed in as"), 'warn');
            return;
        }
        if (!await confirmDialog(t("Delete user"), t("Permanently delete user \"{value1}\"? This cannot be undone.", { value1: String(user.username) }), { danger: true, okLabel: t("Delete") })) return;
        try {
            await api.users.remove(user.id);
            toast(t("User \"{value1}\" deleted", { value1: String(user.username) }));
        } catch (e: any) {
            toast(e.message, 'error');
        }
        refresh();
    }

    const openMenu = (u: any, e: any) => {
        setSel(tableRef.current ? tableRef.current.selectedRows() : [u]);
        // Only YOUR OWN row is suppressed, and only in an SSO session: another
        // user's password stays an admin's to manage, including the break-glass
        // credential on an OIDC-linked local account. The reason rides in the
        // label — ctx items carry no tooltip, and a bare greyed row invites a
        // bug report.
        const ssoSelf = isSsoSelf(u, store.getState('user'));
        contextMenu(e.clientX, e.clientY, [
            { label: t("Refresh"), icon: 'refresh', task: 'doRefreshUser', group: 'user', onClick: () => refresh() },
            { label: t("New User"), icon: 'plus', task: 'doNewUser', group: 'user', onClick: () => newTask() },
            '-',
            { label: t("Edit User"), icon: 'edit', task: 'doEditUser', group: 'user', onClick: () => editTask(u) },
            {
                label: ssoSelf ? t("Change Password — managed by SSO") : t("Change Password"),
                icon: 'key', disabled: ssoSelf, onClick: () => passwordTask(u)
            },
            '-',
            { label: t("Delete User"), icon: 'trash', danger: true, task: 'doDeleteUser', group: 'user', onClick: () => deleteTask(u) }
        ]);
    };

    const options = useRef({
        selectable: 'single',
        rowKey: (u: any) => String(u.id),
        emptyText: t("No users"),
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-users',
        onActivate: (u: any) => editTask(u),
        onSelect: (rows: any) => setSel(rows),
        onContextMenu: openMenu
    }).current;

    const hasSel = sel.length > 0;

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title={t("User Tasks")} paneKey="tasks:User Tasks" group="user">
                    <div className="taskbar" data-pane-title="User Tasks">
                        <TaskButton label={t("Refresh")} icon="refresh" task="doRefreshUser" onClick={refresh} />
                        <TaskButton label={t("New User")} icon="plus" primary task="doNewUser" onClick={() => newTask()} />
                        {hasSel && <TaskButton label={t("Edit User")} icon="edit" task="doEditUser" onClick={() => editTask()} />}
                        {hasSel && <TaskButton label={t("Delete User")} icon="trash" danger task="doDeleteUser" onClick={() => deleteTask()} />}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body">
                <div className="panel"><div className="panel-body flush">
                    <DataTableHost columns={COLUMNS} options={options} rows={users}
                        onReady={(t: any) => { tableRef.current = t; }} />
                </div></div>
            </div>
        </div>
    );
}
