# @oie/eslint-config

Shared ESLint flat config for OIE web-admin plugins. It enforces the one rule
that keeps the platform pluggable: **a plugin reaches the web-admin framework
only through the `@oie/*` public API** — never through shell internals or a
package's deep paths. That boundary is what guarantees your plugin shares the
shell's single framework instance at runtime.

## Usage

```sh
npm install -D @oie/eslint-config eslint
```

```js
// eslint.config.js in your plugin repo
import oie from '@oie/eslint-config';

export default oie;
```

To add your own rules, spread it:

```js
import oie from '@oie/eslint-config';

export default [
  ...oie,
  { rules: { 'no-console': 'warn' } },
];
```

## What it enforces

- **`error`** — no imports of web-admin shell internals (`**/client/core/*`,
  `**/web-administrator/**`) and no deep imports into `@oie/*` packages. Use the
  public entry: `@oie/web-api`, `@oie/web-ui`, `@oie/web-shell`.
- **`warn`** — undefined references (`no-undef`) and unused code
  (`no-unused-vars`). Catches the kind of mistake `node --check` misses in ES
  modules (e.g. an unbalanced paren).

## License

MPL-2.0
