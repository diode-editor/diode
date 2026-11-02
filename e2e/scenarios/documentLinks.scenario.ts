import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { StyleFlags } from "@tuidom/core/common/styleFlags";

import { findTextCell } from "../helpers/frame.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// `doc-links` registers `vscode.languages.registerDocumentLinkProvider` for plaintext, where no bundled server
// competes: `DOCS` is a link without a target, resolved only when it is opened. `https://…` comes from the built-in
// detector. The run has no graphical session, so an external link ends in the toast with the link copied.

const URL = "https://example.com/page";
const RESOLVED = "https://example.com/resolved";

const sampleDir = mkdtempSync(join(tmpdir(), "diode-document-links-"));
const textFile = join(sampleDir, "sample.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-document-links");

/** Exactly the cells of `text` are underlined. Text on screen is not enough: links arrive after it. */
async function waitForUnderline(editor: ScenarioDriver, text: string): Promise<void> {
    await waitUntil(
        () => editor.captureFrame(),
        (frame) => {
            const at = findTextCell(frame, text);
            if (at === null) return false;
            const underlined = (x: number): boolean =>
                (frame.cells[at.y * frame.cols + x].style & StyleFlags.Underline) !== 0;
            const whole = Array.from({ length: text.length }, (_, i) => underlined(at.x + i)).every(Boolean);
            return whole && !underlined(at.x - 1) && !underlined(at.x + text.length);
        },
        { describe: `the underline of ${text}`, timeoutMs: 30_000, intervalMs: 100 },
    );
}

export default defineScenario({
    name: "document-links",
    title: "Links: the built-in detector and a provider underline text; Open Link and Ctrl+click open them",
    seedUserData: userData,
    open: [sampleDir, textFile],
    cols: 90,
    rows: 16,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    // Keeps a browser from opening where the run happens to have a display.
    env: { DISPLAY: "", WAYLAND_DISPLAY: "" },
    userKeybindings: [{ key: "ctrl+alt+o", command: "editor.action.openLink" }],
    async prepare() {
        writeFileSync(textFile, `see ${URL} for more\nread DOCS here\nno link on this line\n`);
        writeFileSync(join(sampleDir, "second.txt"), "DOCS in the second file\n");
    },
    async run(editor) {
        await editor.waitForReady();
        await waitForUnderline(editor, URL);
        await waitForUnderline(editor, "DOCS");
        await editor.capture("links-underlined");

        // The caret inside the link: "see " and two characters of the url.
        for (let i = 0; i < 6; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+Alt+o");
        // The toast wraps the url onto its own line, and the url is also in the text: the border tells them apart.
        await editor.waitForText((t) => t.includes("Link copied to clipboard:") && t.includes(`│  ${URL}`));
        await editor.capture("open-link-copied-the-url");

        // The provider's link has no target until it is opened. Ctrl+click: the same, by mouse.
        const frame = await editor.captureFrame();
        const docs = findTextCell(frame, "DOCS");
        if (docs === null) throw new Error("the provider's link is not on screen");
        await editor.click(docs.x + 1, docs.y, { ctrlKey: true });
        await editor.waitForText((t) => t.includes(RESOLVED));
        await editor.capture("ctrl-click-resolved-the-providers-link");

        // A file opened when the provider is already there: no edit, the provider has to be asked on open.
        await editor.sendKey("Ctrl+P");
        await editor.waitForNode("#quickInput");
        await editor.sendText("second.txt");
        await editor.waitForText((t) => t.includes("second.txt"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("in the second file"));
        await waitForUnderline(editor, "DOCS");
        await editor.capture("second-file-has-the-providers-link");
    },
});
