// Embedded terminal sandbox: a real shell, full-screen TUIs and resize.
// Run: npm run demo:terminal   (Ctrl+Q exits the demo; Ctrl+C goes to the shell)

import { TuiApplication } from "@tuidom/core/dom/tuiApplication";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { HFlexElement, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { TitledPanelElement } from "@tuidom/elements/titledpanel/titledPanelElement";
import { NodeTerminalBackend } from "@tuidom/terminal-backend/nodeTerminalBackend";

import { EmbeddedTerminalSession } from "../../vs/workbench/contrib/terminal/node/embeddedTerminalSession.ts";

import { HeaderBodyLayout } from "./HeaderBodyLayout.ts";

const backend = new NodeTerminalBackend();
const app = new TuiApplication(backend);
const body = new BodyElement();

const initialSize = backend.getSize();
const session = new EmbeddedTerminalSession({
    cols: Math.max(1, initialSize.width),
    rows: Math.max(1, initialSize.height - 2), // approximate; layout sets the exact size
});

const terminalView = new TerminalViewElement(session);
const panel = new TitledPanelElement("Terminal — click buttons · Ctrl+Q quit demo · Ctrl+C → shell", terminalView);

const toolbar = new HFlexElement();
const addButton = (label: string, onActivate: () => void): void => {
    const button = new ButtonElement(label);
    button.onActivate = onActivate;
    toolbar.addChild(button, { width: hflexFit(), height: 1 });
    toolbar.addChild(new TUIElement(), { width: hflexFixed(1), height: 1 });
};

const layout = new HeaderBodyLayout(toolbar, panel, 1);

let disposed = false;
const quit = (): void => {
    if (disposed) return;
    disposed = true;
    terminalView.dispose();
    session.dispose();
    backend.teardown();
    process.exit(0);
};

addButton("Send ls", () => {
    session.write("ls\r");
});
addButton("Clear", () => {
    session.write("clear\r");
});
addButton("Narrower", () => {
    layout.bodyPadX += 4;
    layout.markDirty();
});
addButton("Wider", () => {
    layout.bodyPadX = Math.max(0, layout.bodyPadX - 4);
    layout.markDirty();
});
addButton("Quit", quit);

body.setContent(layout);

// Before app.run, so it fires ahead of the dispatcher and does not reach the shell.
backend.onInput((event) => {
    if (event.ctrlKey && event.key === "q") quit();
});
session.onExit(() => {
    quit();
});

app.root = body;
app.run();

// Until there is autofocus (docs/TODO/README.md #4).
terminalView.focus();
