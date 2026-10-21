// Minimal TUIDom host with an inspector on a port — the fixture for the inspector e2e smoke test.
// The tuidom demos live in the tuidom repo and are not part of the @tuidom/* packages,
// so the host lives here.
//
// Port — argv[2] (0 = ephemeral). Ctrl+C exits.

import { NodeTerminalBackend } from "@tuidom/terminal-backend/nodeTerminalBackend";
import { TuiApplication } from "@tuidom/core/dom/tuiApplication";
import { attachInspector } from "@tuidom/inspector/index";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { BoxElement } from "@tuidom/elements/layout/boxElement";

const port = Number(process.argv[2] ?? 0);

const backend = new NodeTerminalBackend();
const app = new TuiApplication(backend);

const body = new BodyElement();
body.title = "TUIDom host + inspector (Ctrl+C to exit)";
const box = new BoxElement();
box.id = "main";
body.setContent(box);

backend.onInput((event) => {
    if (event.ctrlKey && event.key === "c") {
        backend.teardown();
        process.exit(0);
    }
});

app.root = body;
app.run();

await attachInspector(app, { host: "127.0.0.1", port });
