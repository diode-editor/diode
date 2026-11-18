import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
    formatDocumentFor,
    provideCompletions,
    provideDocumentSymbols,
    provideFoldingRegions,
    provideHovers,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    buildHtmlLanguageFeatures,
    type IHtmlDocument,
    openHtmlDocument,
    until,
} from "../../../../../TestUtils/HtmlLanguageFeaturesHarness.ts";
import type { ICoreDocumentSymbol } from "../../../../editor/common/languages/iDocumentSymbolSource.ts";
import type { ILink } from "../../../../editor/common/languages/iLinkSource.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";

// Formatting, outline, folding, links and the embedded CSS/JavaScript of the built-in HTML language features.

describe("ExtensionHost — built-in HTML language features: document features", () => {
    let html: IHtmlDocument | undefined;

    beforeAll(buildHtmlLanguageFeatures, 120_000);

    afterEach(async () => {
        await html?.harness.dispose();
        html = undefined;
    });

    async function open(
        content: string,
        fileName = "index.html",
        configuration: Record<string, unknown> = {},
    ): Promise<IHtmlDocument> {
        html = await openHtmlDocument(fileName, content, { configuration });
        return html;
    }

    async function formatted(doc: IHtmlDocument): Promise<string> {
        let text = "";
        await until("formatting edits", async () => {
            const edits = await formatDocumentFor(doc.harness, { ...doc.document(), tabSize: 4, insertSpaces: true });
            if (edits === null || edits.length === 0) return false;
            // The service answers with one edit over the whole range.
            expect(edits).toHaveLength(1);
            text = edits[0].text;
            return true;
        });
        return text;
    }

    it("Format Document formats the markup", { timeout: 60_000 }, async () => {
        const doc = await open("<div><p>a</p>\n<p>b</p></div>\n");
        expect(await formatted(doc)).toBe("<div>\n    <p>a</p>\n    <p>b</p>\n</div>");
    });

    it("`html.format.wrapAttributes: force` puts every attribute but the first on its own line", { timeout: 60_000 }, async () => {
        const doc = await open('<a href="x" title="y" id="z">t</a>\n', "index.html", {
            html: { format: { wrapAttributes: "force" } },
        });
        expect(await formatted(doc)).toBe('<a href="x"\n    title="y"\n    id="z">t</a>');
    });

    it("the outline lists the elements as a tree", { timeout: 60_000 }, async () => {
        const doc = await open('<html>\n<body>\n<div id="main"><p>x</p></div>\n</body>\n</html>\n');
        let symbols: readonly ICoreDocumentSymbol[] = [];
        await until("document symbols", async () => {
            symbols = await provideDocumentSymbols(doc.harness, doc.document());
            return symbols.length > 0;
        });
        const names = (list: readonly ICoreDocumentSymbol[]): unknown =>
            list.map((symbol) => [symbol.name, names(symbol.children)]);
        expect(names(symbols)).toEqual([["html", [["body", [["div#main", [["p", []]]]]]]]]);
    });

    it("elements fold", { timeout: 60_000 }, async () => {
        const doc = await open("<div>\n  <p>\n    x\n  </p>\n</div>\n");
        let regions: readonly { start: number; end: number }[] = [];
        await until("folding ranges", async () => {
            regions = (await provideFoldingRegions(doc.harness, doc.document())).map(({ startLine, endLine }) => ({
                start: startLine,
                end: endLine,
            }));
            return regions.length > 0;
        });
        expect(regions).toEqual(expect.arrayContaining([{ start: 0, end: 3 }, { start: 1, end: 2 }]));
    });

    it("`href` and `src` are document links", { timeout: 60_000 }, async () => {
        const doc = await open('<a href="https://example.com/">x</a>\n<script src="app.js"></script>\n');
        const editor = doc.editor;
        let links: readonly ILink[] = [];
        await until("document links", async () => {
            const providers = doc.harness.languageFeatures.documentLinkProvider.ordered({
                uri: editor.uri,
                languageId: doc.languageId,
            });
            const all = await Promise.all(
                providers.map((provider) =>
                    provider.provideLinks(
                        { ...doc.document(), document: editor.model.document },
                        CancellationTokenNone,
                    ),
                ),
            );
            links = all.flatMap((list) => list ?? []);
            return links.length >= 2;
        });
        expect(links.map((link) => link.url)).toEqual(
            expect.arrayContaining(["https://example.com/", expect.stringMatching(/\/app\.js$/)]),
        );
    });

    it("`<style>` gets CSS completion and hover", { timeout: 60_000 }, async () => {
        const doc = await open("<style>\np { colo }\n</style>\n");
        await until("CSS property completion", async () => {
            const { items } = await provideCompletions(doc.harness, doc.at(1, 8));
            return items.some((item) => item.label === "color");
        });
        let text = "";
        await until("CSS hover", async () => {
            const hovers = await provideHovers(doc.harness, doc.at(1, 0));
            text = hovers.flatMap((hover) => hover.contents).join("\n");
            return text !== "";
        });
        expect(text).toContain("<p>");
    });

    it("`<script>` gets JavaScript completion with the DOM library and hover", { timeout: 60_000 }, async () => {
        const doc = await open("<script>\ndocument.getEl\n</script>\n");
        await until("DOM completion", async () => {
            const { items } = await provideCompletions(doc.harness, doc.at(1, 14));
            return items.some((item) => item.label === "getElementById");
        });
        let text = "";
        await until("JavaScript hover", async () => {
            const hovers = await provideHovers(doc.harness, doc.at(1, 3));
            text = hovers.flatMap((hover) => hover.contents).join("\n");
            return text !== "";
        });
        expect(text).toContain("var document: Document");
    });

    it("a handlebars file gets the same features", { timeout: 60_000 }, async () => {
        const doc = await open("<di\n", "index.hbs");
        expect(doc.languageId).toBe("handlebars");
        await until("element completion", async () => {
            const { items } = await provideCompletions(doc.harness, doc.at(0, 3));
            return items.some((item) => item.label === "div");
        });
    });
});
