import type { EditorTabStripElement } from "@tuidom/elements/editorgroup/editorTabStripElement";

import type { QuickPickElement } from "../vs/workbench/browser/parts/quickinput/quickPickElement.ts";

import type { TestApp } from "./TestApp.ts";

export function quickPickByTitle(app: TestApp, title: string): QuickPickElement {
    const pickers = app.querySelectorAll("QuickPickElement") as QuickPickElement[];
    const picker = pickers.find((p) => p.title === title);
    /* v8 ignore start -- test helper: the test opens the prompt with a command first */
    if (picker === undefined) throw new Error(`QuickPickElement "${title}" not found`);
    /* v8 ignore stop */
    return picker;
}

export function tabLabels(app: TestApp): string[] {
    const tabStrip = app.querySelector("EditorTabStripElement") as EditorTabStripElement;
    return tabStrip.getItemElements().map((el) => el.getLabel());
}

export function typeText(app: TestApp, text: string): void {
    for (const ch of text) {
        app.sendKey(ch);
    }
}
