# i18n plan review and behavior matrix

Scope: the web administrator and its bundled plugins in one PR, as selected by the requester. The ten external plugin repositories and native-speaker release acceptance are outside this PR.

## Review findings addressed

1. **Stored values were coupled to labels.** Settings labels also supplied RBAC/deep-link identifiers; code-template group labels selected connector contexts; source data-type editing compared a translated row label. These now use stable IDs or object identity.
2. **Persisting then reloading could lose work on cancellation.** A page-level guard checks channel, alert, settings, global-script and code-template drafts at action time, before storing the new locale. In-flight saves block switching. The normal unload guard is suppressed only for an approved language reload.
3. **Module evaluation order matters.** Host imports now follow catalog initialization; plugin catalog loads precede each plugin import. Static registrations therefore see their intended language.
4. **Plugin delivery has two deployment paths.** Bundled URLs retain the app context. Node and WAR engine catalogs retain their native/extension base, authenticated headers and session fences. Failed/late catalogs fall back and cannot overwrite newer results.
5. **Broad string conversion can cross protocol boundaries.** The first migration wrapped message-routing XML element names and Monaco’s `plaintext` language ID as UI text. Later full reviews found those earlier defects and removed the wrappers. Structural checks, a Chinese Monaco model assertion, and Chinese/pseudo request-body tests protect selectors, language IDs, values, inserted mapping tokens, scripts and defaults.
6. **IME coverage extended beyond the plan's initial list.** Shared guards cover login, palette, navigation rename, searches, prompts, wizard tags, dashboard suggestions, date/time entry, fallback code editing and bundled log-size input. Composition confirmation and Safari key code 229 must not commit an action.
7. **Third-party language assets must match their runtime.** Monaco's Chinese pack is copied from its installed package and hashed with the vendor provenance. Calendar localization uses the installed DayPicker locale.

8. **Nested messages need recursive extraction.** The first extractor stopped at an outer translation call. Review exposed English fragments inside its values; extraction and the literal ratchet now traverse nested values, with regression coverage.
9. **Expanded labels exposed task-column clipping.** Task buttons now wrap within their column. Browser checks audit pseudo-locale text nodes, control overflow, all table densities and narrow login layout.
10. **Optional localization must preserve compatibility versions.** The API value, package/plugin versions and existing manifest minimums remain at their pre-PR values. Plugin authors detect `platform.i18n` and provide an English path for hosts without it. The plugin loader's existing compatibility check is unchanged.

## Behavior matrix

| Surface | Success | Failure / prerequisites | Ordering / stale state | Retry / idempotence |
| --- | --- | --- | --- | --- |
| Bootstrap | English, Simplified Chinese, script-aware negotiation; static labels initialized once | Invalid preference ignored; missing/invalid/slow host catalog boots English | First initialization wins; late catalog cannot change page language | Stored preference retained for next load |
| ICU formatting | Values, plurals, contexts, rich nodes, Chinese numbers/lists | Invalid syntax, wrong arguments/tags/choices use fallback; user data stays plain text | Cached by language/message/rich mode | Warning emitted once in development |
| Language switch | Persist after guard, reload same route | Dirty cancellation and storage denial do not discard draft or change preference; save-in-progress blocks | Guard reads current editor state; concurrent request rejected; tabs remain independent | Cancel/failure permits retry; same locale avoids reload |
| Plugin catalog | Scoped catalog before module evaluation; existing API minimum or no minimum | Missing/invalid catalog retains plugin with host/English fallback; unsafe paths rejected | Old engine session and older same-plugin response cannot register | Replaces prior namespace; no old catalog after reconnect |
| Optional plugin localization | Detect `platform.i18n`; API version and existing plugin minimum stay unchanged | A host without i18n uses the plugin's English path; unsupported API requirements still skip before import | No static new-export import on hosts without that export | The same manifest works before and after adding optional localization |
| Node / WAR | Correct app/engine/extension paths and import-map singleton | Authenticated no-store catalog request uses CSRF/context headers | Await catalog before script, preserve registration order | Catalog failure does not block unrelated plugins |
| Editors | Channel/alert/template/user saves keep wire values; every bundled connector panel preserves properties | Existing failure/conflict/partial-save flows exercised by the full regression suite | Stable RBAC, routes, data types, code contexts and pane IDs | Existing save-lock and retry semantics preserved |
| Navigation / preferences | Localized built-in names; custom names remain verbatim | Hidden/unauthorized actions remain gated by original IDs | Locale switch does not rekey stored sections | User overrides survive reload and locale changes |
| Keyboard / IME | Ordinary Enter still commits | Composing Enter and key code 229 do not commit | Native and React event shapes handled | Next normal Enter works |
| Presentation | CJK fallback fonts, Chinese calendar and Monaco, pseudo expansion | Missing Monaco assets retain fallback editor | NLS loaded before editor; timeout cannot race an English upgrade | One editor load per page |
| Tooling / delivery | Source extraction, ICU validation, literal ratchet, type declarations, Node/WAR build | CI rejects malformed catalogs and new raw UI literals | Generated artifacts rebuilt from source | Production build excludes pseudo switch |

## Validation record

The PR description records command results and the limits of the local browser run. The focused suites cover locale negotiation and switching, all editor cancellation paths, engine plugin catalog ordering in Node/WAR, shared runtime identity, Chinese calendar/Monaco, composition handling, identical save payloads and navigation preferences, and every built-in connector panel in Chinese and pseudo-locale.

Local checks on Node 22.22.3 passed: lint, public and application type checks, unit/tooling tests, ICU/catalog/literal checks, production dependency audit (zero vulnerabilities), and Node and WAR builds. The catalog check covers 2,754 messages with complete Chinese entries. WAR inspection confirmed bundled catalogs, the shared ICU import, and matching vendor hashes.

The full English Chromium run passed 935 tests and found two outdated assertions (the static-file allowlist omitted digits in `i18n.js`; the user summary expected a comma list). Both assertions were corrected and all 15 affected tests passed on recheck. The focused Chinese/pseudo connector and IME run passed 47 tests. Expanded-text and density checks passed after correcting task-column wrapping.

After integrating main through `b680cad`, the full unit run (including 128 tooling tests), lint, types, catalog checks, audit and both builds passed again. The integration preserves upstream database-driver validation, required-field markers, anonymous FTP/WebDAV credentials, Delimited Text arrays, response-transformer editing, control-character message parsing and command-palette fallback behavior. All 178 focused production Chromium tests passed, including the previously timing-sensitive two-tab Settings test and the upstream regression suites.

After restoring the pre-PR compatibility version and plugin minimums, lint, types,
the full unit/tooling suite, catalog checks, and Node/WAR builds passed again.
All 81 focused browser checks passed across Chromium, Firefox and WebKit: they
cover unchanged compatibility rejection, catalog loading with no minimum or an
existing minimum in Node/WAR, and the documented plugin with localization present
or absent. All 38 package/plugin manifest versions and API requirements match the
pre-PR baseline. WAR inspection confirmed the unchanged API value, 32 plugin
manifests and 21 catalogs. This focused run does not resolve the separate Firefox
Monaco crash described below.

The final Chinese/pseudo run across Chromium, Firefox and WebKit passed 195 tests, skipped the three production-only query checks, and failed three Firefox cases. A 15-case recheck passed 14, resolving the DICOM connection refusals. **One Firefox case remains unresolved:** navigating from Chinese Monaco to Messages crashes the browser content process. A diagnostic run records signal 11 (segmentation fault); explicit test-editor disposal does not resolve it. Chromium and WebKit pass the corresponding cases. Linux CI must verify this remaining browser failure before merge; this is not an all-green browser signoff.

Earlier slow-host runs, including the standalone WebKit timeout and partial regression runs, remain in the retained evidence. Their failures are historical results, not counted as passes. Native-speaker review is still required for release acceptance.

Tests use isolated web servers and mocked engine routes. They do not install engines or create engine databases. Test servers are owned by their harness and stopped when workers exit. Logs, traces, screenshots and build provenance are retained as validation evidence.

## Remaining release work

The catalog is an initial Simplified Chinese translation. A native speaker should review terminology, long messages and screenshots before release signoff. External plugin repositories can opt into scoped catalogs and feature-detect `platform.i18n` without changing their API minimum. Generated scripts, engine data/diagnostics, protocol identifiers, and engine-generated code-reference material remain in their original language by design.
