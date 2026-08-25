import { test, expect } from '@playwright/test';
import { login } from './mock.js';

/*
 * Issue #39/#43 against a REAL engine — runs only with E2E_LIVE=1.
 *
 * The mocked suite proves the client BUILDS the right requests. What it cannot
 * prove is that the engine ACCEPTS them: that a channel XML with its
 * exportData dependencies stripped and its resourceIds rewritten still
 * deserializes, that PUT /server/channelDependencies round-trips the merged set,
 * and that the bulk lifecycle endpoints take the set the dashboard submits.
 *
 * Everything it creates it deletes, and it restores the server's dependency set
 * to whatever it found. It touches no pre-existing channel.
 */

const USER = process.env.E2E_USER || 'admin';
const PASS = process.env.E2E_PASS || 'admin';

const PROBE_PREFIX = 'zz webadmin parity';
const CHANNEL_A = `${PROBE_PREFIX} A`;
const CHANNEL_B = `${PROBE_PREFIX} B`;

/* A minimal but complete channel, in the engine's own export shape. `deps` goes
   into exportData/dependencyIds — the element the web importer has to lift out,
   merge into the global set, and strip before upload. `resourceName` seeds a
   resourceIds entry under a DEAD id, which import must re-point by name. */
function channelXml({ id, name, dependencyId, resourceName }: any) {
    return `<channel version="4.6.0">
  <id>${id}</id>
  <nextMetaDataId>2</nextMetaDataId>
  <name>${name}</name>
  <description>temporary — created and removed by a parity check</description>
  <revision>1</revision>
  <sourceConnector version="4.6.0">
    <metaDataId>0</metaDataId>
    <name>sourceConnector</name>
    <properties class="com.mirth.connect.connectors.vm.VmReceiverProperties" version="4.6.0">
      <pluginProperties/>
      <sourceConnectorProperties version="4.6.0">
        <responseVariable>None</responseVariable>
        <respondAfterProcessing>true</respondAfterProcessing>
        <processBatch>false</processBatch>
        <firstResponse>false</firstResponse>
        <processingThreads>1</processingThreads>
        <resourceIds class="linked-hash-map">
          <entry><string>00000000-dead-beef-0000-000000000001</string><string>${resourceName}</string></entry>
        </resourceIds>
        <queueBufferSize>1000</queueBufferSize>
      </sourceConnectorProperties>
    </properties>
    <transformer version="4.6.0"><elements/><inboundTemplate encoding="base64"/><outboundTemplate encoding="base64"/><inboundDataType>RAW</inboundDataType><outboundDataType>RAW</outboundDataType><inboundProperties class="com.mirth.connect.plugins.datatypes.raw.RawDataTypeProperties" version="4.6.0"/><outboundProperties class="com.mirth.connect.plugins.datatypes.raw.RawDataTypeProperties" version="4.6.0"/></transformer>
    <filter version="4.6.0"><elements/></filter>
    <transportName>Channel Reader</transportName>
    <mode>SOURCE</mode>
    <enabled>true</enabled>
    <waitForPrevious>true</waitForPrevious>
  </sourceConnector>
  <destinationConnectors/>
  <preprocessingScript>return message;</preprocessingScript>
  <postprocessingScript>return;</postprocessingScript>
  <deployScript>return;</deployScript>
  <undeployScript>return;</undeployScript>
  <properties version="4.6.0">
    <clearGlobalChannelMap>true</clearGlobalChannelMap>
    <messageStorageMode>DEVELOPMENT</messageStorageMode>
    <encryptData>false</encryptData>
    <encryptAttachments>false</encryptAttachments>
    <encryptCustomMetaData>false</encryptCustomMetaData>
    <removeContentOnCompletion>false</removeContentOnCompletion>
    <removeOnlyFilteredOnCompletion>false</removeOnlyFilteredOnCompletion>
    <removeAttachmentsOnCompletion>false</removeAttachmentsOnCompletion>
    <initialState>STOPPED</initialState>
    <storeAttachments>true</storeAttachments>
    <metaDataColumns/>
    <attachmentProperties version="4.6.0"><type>None</type><properties/></attachmentProperties>
    <resourceIds class="linked-hash-map">
      <entry><string>00000000-dead-beef-0000-000000000002</string><string>${resourceName}</string></entry>
    </resourceIds>
  </properties>
  <exportData>
    <metadata><enabled>true</enabled><lastModified><time>0</time><timezone>UTC</timezone></lastModified><pruningSettings><archiveEnabled>true</archiveEnabled></pruningSettings></metadata>
    ${dependencyId ? `<dependencyIds><string>${dependencyId}</string></dependencyIds>` : ''}
  </exportData>
</channel>`;
}

/* Engine calls made from the page, so they ride the app's authenticated session
   through its /api proxy — no second login, no TLS juggling. */
async function engine(page: any, method: string, path: string, body?: any, contentType?: string) {
    return page.evaluate(async ([method, path, body, contentType]: any) => {
        const headers: any = { 'Accept': 'application/json', 'X-Requested-With': 'OpenIntegrationEngine-WebAdmin' };
        if (contentType) headers['Content-Type'] = contentType;
        const res = await fetch(`/api${path}`, { method, headers, body: body ?? null, credentials: 'same-origin' });
        const text = await res.text();
        let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
        return { status: res.status, text, json };
    }, [method, path, body, contentType]);
}

const asList = (v: any, key: string) => {
    let x = v;
    if (x && typeof x === 'object' && !Array.isArray(x)) {
        const keys = Object.keys(x).filter(k => !k.startsWith('@'));
        if (keys.length === 1) x = x[keys[0]];
    }
    if (x && typeof x === 'object' && key in x) x = x[key];
    if (x === '' || x == null) return [];
    return Array.isArray(x) ? x : [x];
};

test.describe.configure({ mode: 'serial' });

test('a channel imported through the UI keeps its dependency edge and re-points its resource', async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto('/');
    if (await page.getByRole('button', { name: 'Sign in' }).isVisible().catch(() => false)) {
        await login(page, USER, PASS);
    }
    await expect(page.locator('.shell')).toBeVisible({ timeout: 30_000 });

    // What the server looked like before, so we can put it back.
    const depsBefore = asList((await engine(page, 'GET', '/server/channelDependencies')).json, 'channelDependency');
    const resources = (await engine(page, 'GET', '/server/resources')).text;
    const defaultResourceName = resources.match(/"name":"([^"]*Default Resource[^"]*)"/)?.[1] || '[Default Resource]';
    const defaultResourceId = resources.match(/"id":"([^"]+)","name":"[^"]*Default Resource/)?.[1]
        || 'Default Resource';
    const anchor = asList((await engine(page, 'GET', '/channels/idsAndNames')).json, 'entry')[0];
    const anchorId = String(asList(anchor, 'string')[0] || '');
    expect(anchorId, 'need an existing channel to depend on').toBeTruthy();

    const importedId = '00000000-dead-beef-0000-00000000aaaa';
    const xml = channelXml({
        id: importedId, name: CHANNEL_A, dependencyId: anchorId, resourceName: defaultResourceName
    });

    try {
        await page.goto('/channels');
        await expect(page.getByRole('button', { name: 'Import Channel' }).first()).toBeVisible({ timeout: 30_000 });
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import Channel' }).first().click();
        await (await chooser).setFiles({
            name: 'parity-probe.xml', mimeType: 'application/xml', buffer: Buffer.from(xml)
        });

        /* Wait on the ENGINE, not on a toast: the re-map notice is an
           auto-dismissing info toast, so polling for it races its own timeout
           and tells you nothing about what was stored. */
        await expect.poll(
            async () => (await engine(page, 'GET', `/channels/${importedId}`)).status,
            { timeout: 60_000, message: 'engine stored the imported channel' }
        ).toBe(200);

        // 1. The ENGINE accepted the transformed document.
        const stored = await engine(page, 'GET', `/channels/${importedId}`);
        expect(stored.text).toContain(CHANNEL_A);

        // 2. The dependency edge reached the global set (the engine ignores
        //    exportData on create, so only the client PUT can have done this).
        const depsAfter = asList((await engine(page, 'GET', '/server/channelDependencies')).json, 'channelDependency');
        expect(depsAfter.some((d: any) =>
            String(d.dependentId) === importedId && String(d.dependencyId) === anchorId),
        'the imported channel depends on the anchor').toBe(true);
        expect(depsAfter.length, 'existing edges were kept, not replaced').toBe(depsBefore.length + 1);

        // 3. The dead resource ids were re-pointed by NAME to this server's.
        const storedXml = (await engine(page, 'GET', `/channels/${importedId}`)).text;
        expect(storedXml).not.toContain('00000000-dead-beef-0000-000000000001');
        expect(storedXml).not.toContain('00000000-dead-beef-0000-000000000002');
        expect(storedXml).toContain(defaultResourceId);

        /* 4. The edge round-trips: the engine RE-COMPUTES exportData on export
           from its own dependency set, so seeing the anchor here is proof the
           client's PUT landed — not proof the upload still carried it. (The
           upload has it stripped; the engine ignores exportData on create, so
           the global set is the only path this could have taken.) */
        expect(storedXml).toContain(anchorId);
    } finally {
        await engine(page, 'DELETE', `/channels/${importedId}`);
        // Put the dependency set back exactly as it was.
        const restore = `<set>${depsBefore.map((d: any) =>
            `<channelDependency><dependentId>${d.dependentId}</dependentId><dependencyId>${d.dependencyId}</dependencyId></channelDependency>`
        ).join('')}</set>`;
        await engine(page, 'PUT', '/server/channelDependencies', restore, 'application/xml');
    }
});

test('the dashboard submits a multi-channel start as ONE set the engine can order', async ({ page }) => {
    test.setTimeout(240_000);

    await page.goto('/');
    if (await page.getByRole('button', { name: 'Sign in' }).isVisible().catch(() => false)) {
        await login(page, USER, PASS);
    }
    await expect(page.locator('.shell')).toBeVisible({ timeout: 30_000 });

    const idA = '00000000-dead-beef-0000-00000000bbbb';
    const idB = '00000000-dead-beef-0000-00000000cccc';
    const depsBefore = asList((await engine(page, 'GET', '/server/channelDependencies')).json, 'channelDependency');

    try {
        for (const [id, name] of [[idA, CHANNEL_A], [idB, CHANNEL_B]] as const) {
            const r = await engine(page, 'POST', '/channels',
                channelXml({ id, name, dependencyId: null, resourceName: 'Default Resource' }),
                'application/xml');
            expect(r.status, `created ${name}`).toBeLessThan(400);
        }
        // B depends on A, so a start of both must reach the engine as one set.
        await engine(page, 'PUT', '/server/channelDependencies',
            `<set>${[...depsBefore.map((d: any) =>
                `<channelDependency><dependentId>${d.dependentId}</dependentId><dependencyId>${d.dependencyId}</dependencyId></channelDependency>`),
            `<channelDependency><dependentId>${idB}</dependentId><dependencyId>${idA}</dependencyId></channelDependency>`
            ].join('')}</set>`, 'application/xml');

        const deployed = await engine(page, 'POST', '/channels/_deploy',
            `<set><string>${idA}</string><string>${idB}</string></set>`, 'application/xml');
        expect(deployed.status, 'deployed both probe channels').toBeLessThan(400);

        // Wait for both to appear STOPPED on the dashboard.
        await page.goto('/dashboard');
        await expect(page.getByText(CHANNEL_A, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
        await expect(page.getByText(CHANNEL_B, { exact: true }).first()).toBeVisible({ timeout: 60_000 });

        const starts: string[] = [];
        page.on('request', (r: any) => {
            const p = new URL(r.url()).pathname;
            if (r.method() === 'POST' && /_start$/.test(p)) starts.push(p);
        });

        await page.locator('tr', { hasText: CHANNEL_A }).first().click();
        await page.locator('tr', { hasText: CHANNEL_B }).first().click({ modifiers: ['ControlOrMeta'] });

        const bulk = page.waitForRequest((r: any) =>
            r.method() === 'POST' && new URL(r.url()).pathname === '/api/channels/_start');
        await page.getByRole('button', { name: 'Start', exact: true }).click();
        const body = new URLSearchParams((await bulk).postData() || '');
        expect(body.getAll('channelId').sort()).toEqual([idA, idB].sort());
        expect(starts, 'one bulk call, not one per channel').toEqual(['/api/channels/_start']);

        // The engine really started them (it orders the tiers itself).
        await expect.poll(async () => {
            const st = asList((await engine(page, 'GET', '/channels/statuses')).json, 'dashboardStatus');
            return st.filter((s: any) => [idA, idB].includes(String(s.channelId)) && s.state === 'STARTED').length;
        }, { timeout: 60_000 }).toBe(2);
    } finally {
        await engine(page, 'POST', '/channels/_undeploy', `<set><string>${idA}</string><string>${idB}</string></set>`, 'application/xml');
        await engine(page, 'DELETE', `/channels/${idA}`);
        await engine(page, 'DELETE', `/channels/${idB}`);
        await engine(page, 'PUT', '/server/channelDependencies',
            `<set>${depsBefore.map((d: any) =>
                `<channelDependency><dependentId>${d.dependentId}</dependentId><dependencyId>${d.dependencyId}</dependencyId></channelDependency>`
            ).join('')}</set>`, 'application/xml');
    }
});
