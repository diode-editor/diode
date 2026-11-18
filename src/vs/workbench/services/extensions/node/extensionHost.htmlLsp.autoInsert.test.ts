import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
    buildHtmlLanguageFeatures,
    type IHtmlDocument,
    openHtmlDocument,
} from "../../../../../TestUtils/HtmlLanguageFeaturesHarness.ts";
import { settle, waitUntil } from "../../../../../TestUtils/timing.ts";

// The client's `html/autoInsert` (upstream `autoInsertion.ts`): typing `>`, `/` or `=` in the active editor asks the
// server, and the answer goes in as a snippet at the caret.

describe("ExtensionHost — built-in HTML language features: auto insertion", () => {
    let html: IHtmlDocument | undefined;

    beforeAll(buildHtmlLanguageFeatures, 120_000);

    afterEach(async () => {
        await html?.harness.dispose();
        html = undefined;
    });

    /** Puts the caret at the end of line 0 once the client is up, and types `typed` there. */
    async function typeAtEnd(content: string, typed: string, configuration: Record<string, unknown> = {}) {
        const doc = await openHtmlDocument("index.html", content, { configuration });
        html = doc;
        const { editor, harness } = doc;
        await waitUntil("the client", () => harness.languageFeatures.completionProvider.has(editor), 30_000);
        const character = editor.model.document.getLineContent(0).length;
        editor.viewState.selections = [
            { anchor: { line: 0, character }, active: { line: 0, character }, idealColumn: undefined },
        ];
        editor.pushUndo(editor.viewState.type(typed));
        const text = (): string => editor.model.document.getText();
        const caret = (): unknown => editor.viewState.selections[0].active;
        const frame = (): string => {
            harness.app.render();
            return harness.app.backend.screenToString();
        };
        return { text, caret, frame };
    }

    it("`>` after `<div` closes the tag, the caret stays between the tags", { timeout: 60_000 }, async () => {
        const { text, caret, frame } = await typeAtEnd("<div\n", ">");
        await waitUntil("the closing tag", () => text() === "<div></div>\n");
        expect(caret()).toEqual({ line: 0, character: 5 });
        expect(frame()).toContain("<div></div>");
    });

    it("`/` after `<div></` completes the end tag", { timeout: 60_000 }, async () => {
        const { text } = await typeAtEnd("<div><\n", "/");
        await waitUntil("the end tag", () => text() === "<div></div>\n");
    });

    it("`html.autoClosingTags: false` leaves the tag open", { timeout: 60_000 }, async () => {
        const { text } = await typeAtEnd("<div\n", ">", { html: { autoClosingTags: false } });
        // The client asks 100 ms after the change; well past that nothing came.
        await settle(1_000);
        expect(text()).toBe("<div>\n");
    });

    it("`=` after an attribute name adds the quotes, the caret between them", { timeout: 60_000 }, async () => {
        const { text, caret } = await typeAtEnd('<a href\n', "=");
        await waitUntil("the quotes", () => text() === '<a href=""\n');
        expect(caret()).toEqual({ line: 0, character: 9 });
    });

    it("`html.autoCreateQuotes: false` leaves `=` alone", { timeout: 60_000 }, async () => {
        const { text } = await typeAtEnd("<a href\n", "=", { html: { autoCreateQuotes: false } });
        await settle(1_000);
        expect(text()).toBe("<a href=\n");
    });
});
