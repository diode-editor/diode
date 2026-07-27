# __PKG_NAME__

> ⚠️ **Experimental.** This is a snapshot of the TUI engine that powers the
> [Vexx](https://github.com/tihonove/vexx) terminal editor. The API is
> **unstable** — no semver guarantees, anything may change between releases.
> Deep imports expose internals on purpose: there is no curated public surface yet.

A DOM-like terminal UI engine: element tree with flex layout, double-buffered
grid rendering with ANSI diffing, keyboard/mouse input parsing (incl. Kitty
protocol), focus management, capture/bubble events, widgets (lists, trees,
menus, inputs, quick pick), and a WebSocket inspector for devtools/e2e.

## Requirements

- Node.js ≥ 24
- TypeScript consumers: `moduleResolution` must be `"node16"`, `"nodenext"` or
  `"bundler"` (the package uses subpath `exports`)
- `@types/node` — some public signatures reference `Buffer`/`process`

Zero runtime dependencies.

## Install

```sh
npm install __PKG_NAME__
```

## Hello world

```ts
import { NodeTerminalBackend } from "__PKG_NAME__/backend/nodeTerminalBackend";
import { TuiApplication } from "__PKG_NAME__/dom/tuiApplication";
import { BodyElement } from "__PKG_NAME__/ui/body/bodyElement";
import { BoxElement } from "__PKG_NAME__/ui/layout/boxElement";

const backend = new NodeTerminalBackend();
const app = new TuiApplication(backend);

const body = new BodyElement();
body.title = "TUIDom host — minimal (Ctrl+C to exit)";
body.setContent(new BoxElement());

// With the Kitty protocol Ctrl+C arrives as an input event, not SIGINT.
backend.onInput((event) => {
    if (event.ctrlKey && event.key === "c") {
        backend.teardown();
        process.exit(0);
    }
});

app.root = body;
app.run();
```

Headless rendering (tests, screenshots) — swap the backend:

```ts
import { HeadlessCaptureBackend } from "__PKG_NAME__/backend/headlessCaptureBackend";
import { Size } from "__PKG_NAME__/common/geometryPromitives";

const backend = new HeadlessCaptureBackend(new Size(80, 24));
// ...app.run(), then:
const frame = backend.captureFrame(); // plain-data GridSnapshot
```

## JSX

Function components are supported via the standard automatic runtime:

```jsonc
// tsconfig.json
{
    "compilerOptions": {
        "jsx": "react-jsx",
        "jsxImportSource": "__PKG_NAME__"
    }
}
```

## License

MIT
