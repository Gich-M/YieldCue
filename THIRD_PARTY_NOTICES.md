# Third-Party Notices

The self-hosted YieldCue client bundles or depends on the following
third-party software. Each entry names the component, its license, and where
its source and full license text live.

## Vendored

### htmx

- Version: 2.0.4
- License: Zero-Clause BSD (0BSD)
- Source: https://github.com/bigskysoftware/htmx
- Vendored at: `public/htmx.min.js`

License text:

    Zero-Clause BSD
    =============

    Permission to use, copy, modify, and/or distribute this software for
    any purpose with or without fee is hereby granted.

    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL
    WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES
    OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE
    FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY
    DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN
    AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
    OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## Runtime dependencies

Installed via npm and shipped in the runtime image. Each package's full MIT
license text is included in its `node_modules/*/LICENSE` file.

### hono

- Version: ^4.13.14
- License: MIT
- Source: https://github.com/honojs/hono

### @hono/node-server

- Version: ^2.1.5
- License: MIT
- Source: https://github.com/honojs/node-server

### tsx

- Version: ^4.22.3
- License: MIT
- Source: https://github.com/privatenumber/tsx

## Build and test tooling

Not shipped in the runtime image (`npm ci --omit=dev` excludes them).

- typescript — Apache License 2.0 — https://github.com/microsoft/TypeScript
- @types/node — MIT — https://github.com/DefinitelyTyped/DefinitelyTyped
- eslint — MIT — https://github.com/eslint/eslint
- @typescript-eslint/* — MIT — https://github.com/typescript-eslint/typescript-eslint
