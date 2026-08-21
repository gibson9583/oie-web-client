import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Channel import must carry over the two things the engine does NOT apply from
 * exportData on create/update:
 *
 *  - deploy/start dependencies (exportData.dependencyIds / dependentIds), which
 *    Swing merges into the global dependency set and PUTs, and
 *  - library resource assignments (resourceIds id->name maps), whose ids are
 *    meaningless on a different server and must be re-matched by name.
 *
 * Without these an imported channel loses its ordering and deploys without its
 * libraries, silently.
 */

const OTHER_ID = 'c-upstream';

/** A channel export carrying one dependency edge and one foreign resource id. */
const CHANNEL_XML = `<channel version="4.5.0">
  <id>c-imported</id>
  <name>Imported Channel</name>
  <revision>7</revision>
  <sourceConnector version="4.5.0">
    <properties>
      <sourceConnectorProperties version="4.5.0">
        <resourceIds class="linked-hash-map">
          <entry><string>OLD-RESOURCE-UUID</string><string>Shared Libs</string></entry>
        </resourceIds>
      </sourceConnectorProperties>
    </properties>
  </sourceConnector>
  <properties version="4.5.0">
    <resourceIds class="linked-hash-map">
      <entry><string>OLD-RESOURCE-UUID</string><string>Shared Libs</string></entry>
      <entry><string>UNKNOWN-UUID</string><string>Not On This Server</string></entry>
    </resourceIds>
  </properties>
  <exportData>
    <metadata><enabled>true</enabled></metadata>
    <dependencyIds><string>${OTHER_ID}</string></dependencyIds>
    <dependentIds/>
  </exportData>
</channel>`;

/** Wire the import flow: capture the channel POST and the dependency PUT. */
async function importChannel(page: any, xml: string) {
    const captured: { channelBody: string | null; deps: string | null } = { channelBody: null, deps: null };

    await page.route('**/api/channels', async (route: any) => {
        const req = route.request();
        if (req.method() === 'POST') {
            captured.channelBody = req.postData();
            return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
        }
        return route.fallback();
    });
    await page.route('**/api/server/channelDependencies', async (route: any) => {
        const req = route.request();
        if (req.method() === 'PUT') {
            captured.deps = req.postData();
            return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
        }
        return route.fallback();
    });

    await page.goto('/channels');
    await expect(page.getByRole('button', { name: 'Import Channel' }).first()).toBeVisible();

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Channel' }).first().click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'channel.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });

    return captured;
}

test('import merges the export dependency edge and strips it from the upload', async ({ page }) => {
    await mockEngine(page, {
        // One pre-existing, unrelated edge that the merge must preserve.
        'GET /server/channelDependencies': {
            set: { channelDependency: [{ dependentId: 'c-a', dependencyId: 'c-b' }] }
        },
        'GET /server/resources': { list: '' }
    });

    const captured = await importChannel(page, CHANNEL_XML);
    await expect.poll(() => captured.deps, { timeout: 8000 }).not.toBeNull();

    // The imported edge was added and the existing one kept.
    expect(captured.deps).toContain(OTHER_ID);
    expect(captured.deps).toContain('c-imported');
    expect(captured.deps).toContain('c-a');
    expect(captured.deps).toContain('c-b');

    // The uploaded channel no longer carries the (engine-ignored) id elements.
    expect(captured.channelBody).not.toContain('dependencyIds');
    expect(captured.channelBody).not.toContain('dependentIds');
});

test('import re-points resource ids by name and warns about unmatched ones', async ({ page }) => {
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        // The target server knows "Shared Libs" under a DIFFERENT id.
        'GET /server/resources': {
            'com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties': [
                { id: 'NEW-RESOURCE-UUID', name: 'Shared Libs' }
            ]
        }
    });

    const captured = await importChannel(page, CHANNEL_XML);

    // The unmatched-resource warning is raised during the re-map, which runs before
    // the upload. toast(..., 'warn') renders a modal here, not a corner toast.
    await expect(page.getByText('Not On This Server')).toBeVisible();
    await page.locator('.modal-foot').getByRole('button', { name: 'Close', exact: true }).click();

    await expect.poll(() => captured.channelBody, { timeout: 8000 }).not.toBeNull();
    // Both occurrences (channel properties + source connector) were re-pointed.
    expect(captured.channelBody).toContain('NEW-RESOURCE-UUID');
    expect(captured.channelBody).not.toContain('OLD-RESOURCE-UUID');
    // An id whose name matches nothing here is left alone.
    expect(captured.channelBody).toContain('UNKNOWN-UUID');
});

test('a channel export with no dependencies PUTs nothing', async ({ page }) => {
    await mockEngine(page, {
        'GET /server/channelDependencies': { set: '' },
        'GET /server/resources': { list: '' }
    });

    const plain = CHANNEL_XML.replace(`<dependencyIds><string>${OTHER_ID}</string></dependencyIds>`, '');
    const captured = await importChannel(page, plain);
    await expect.poll(() => captured.channelBody, { timeout: 8000 }).not.toBeNull();
    expect(captured.deps).toBeNull();
});
