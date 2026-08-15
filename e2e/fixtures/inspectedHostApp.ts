// Мини-хост TUIDom с инспектором на порту — фикстура для e2e-смоука инспектора.
// Раньше эту роль играла демка tuidom/demos/inspectedHost.ts; демки уехали в
// репозиторий tuidom и в пакеты @tuidom/* не входят, поэтому хост живёт здесь.
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
