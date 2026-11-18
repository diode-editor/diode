import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { provideCompletions, provideHovers } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    buildHtmlLanguageFeatures,
    type IHtmlDocument,
    openHtmlDocument,
    until,
} from "../../../../../TestUtils/HtmlLanguageFeaturesHarness.ts";
import type { ICoreCompletionItem } from "../../../../editor/common/languages/iCompletionSource.ts";

// Completion and hover of the built-in HTML language features against the real server.

describe("ExtensionHost — built-in HTML language features: completion and hover", () => {
    let html: IHtmlDocument | undefined;

    beforeAll(buildHtmlLanguageFeatures, 120_000);

    afterEach(async () => {
        await html?.harness.dispose();
        html = undefined;
    });

    async function completionsAt(
        content: string,
        line: number,
        character: number,
        expected: string,
        configuration: Record<string, unknown> = {},
    ): Promise<readonly ICoreCompletionItem[]> {
        const doc = await openHtmlDocument("index.html", content, { configuration });
        html = doc;
        let items: readonly ICoreCompletionItem[] = [];
        await until(`completion of ${expected}`, async () => {
            items = (await provideCompletions(doc.harness, doc.at(line, character))).items;
            return items.some((item) => item.label === expected);
        });
        return items;
    }

    async function hoverAt(
        content: string,
        line: number,
        character: number,
        configuration: Record<string, unknown> = {},
    ): Promise<string> {
        const doc = await openHtmlDocument("index.html", content, { configuration });
        html = doc;
        let text = "";
        await until("a hover", async () => {
            const hovers = await provideHovers(doc.harness, doc.at(line, character));
            text = hovers.flatMap((hover) => hover.contents).join("\n");
            return text !== "";
        });
        return text;
    }

    it("`<di` offers the elements, `div` among them", { timeout: 60_000 }, async () => {
        const items = await completionsAt("<di\n", 0, 3, "div");
        const labels = items.map((item) => item.label);
        expect(labels).toContain("dialog");
        expect(labels).not.toContain("href");
    });

    it("inside a tag the attributes are offered, with the quotes", { timeout: 60_000 }, async () => {
        const items = await completionsAt("<a h></a>\n", 0, 4, "href");
        // `html.completion.attributeDefaultValue` (default `doublequotes`). The server's snippet is `href="$1"`; the core
        // has no snippet session in suggestions yet (#1035) and inserts it as text.
        expect(items.find((item) => item.label === "href")?.insertText).toBe('href=""');
    });

    it("`html.completion.attributeDefaultValue: empty` offers the attribute without quotes", { timeout: 60_000 }, async () => {
        const items = await completionsAt("<a h></a>\n", 0, 4, "href", {
            html: { completion: { attributeDefaultValue: "empty" } },
        });
        expect(items.find((item) => item.label === "href")?.insertText).toBe("href=");
    });

    it('`<input type="` offers the values the service knows', { timeout: 60_000 }, async () => {
        const items = await completionsAt('<input type="">\n', 0, 13, "checkbox");
        expect(items.map((item) => item.label)).toContain("text");
    });

    it("hover on an element shows its MDN description and reference", { timeout: 60_000 }, async () => {
        const text = await hoverAt("<div></div>\n", 0, 2);
        expect(text).toContain("The div element has no special meaning at all");
        expect(text).toContain("[MDN Reference](https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/div)");
    });

    it("hover on an attribute shows its description", { timeout: 60_000 }, async () => {
        const text = await hoverAt('<a href="x"></a>\n', 0, 4);
        expect(text).toContain("Contains a URL or a URL fragment that the hyperlink points to");
    });

    it("`html.hover.references: false` drops the reference link", { timeout: 60_000 }, async () => {
        const text = await hoverAt("<div></div>\n", 0, 2, { html: { hover: { references: false } } });
        expect(text).toContain("The div element has no special meaning at all");
        expect(text).not.toContain("MDN Reference");
    });

    it("`html.hover.documentation: false` keeps only the reference link", { timeout: 60_000 }, async () => {
        const text = await hoverAt("<div></div>\n", 0, 2, { html: { hover: { documentation: false } } });
        expect(text).not.toContain("The div element has no special meaning at all");
        expect(text).toContain("MDN Reference");
    });
});
