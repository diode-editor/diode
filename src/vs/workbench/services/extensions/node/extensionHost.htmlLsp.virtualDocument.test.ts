import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
    activatingLanguageService,
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    buildHtmlLanguageFeatures,
    HTML_LANGUAGE_SERVICE,
    HTML_SERVER_CONFIGURATION,
    htmlLanguageFeaturesRegistration,
    until,
} from "../../../../../TestUtils/HtmlLanguageFeaturesHarness.ts";

// The hermetic counterpart of extensionHost.angular.embeddedHtml.test.ts: a synthetic extension does Angular's dance
// with an `.html` document of its content provider. No `.html` file is open: opening the virtual document is what
// activates the HTML extension (`onLanguage:html`, as in the app), and each command reads the provider again. The
// HTML client serves only `html` documents, so an answer also says the document opened as html.

describe("ExtensionHost — built-in HTML language features: virtual documents", () => {
    let harness: IExtensionHarness | undefined;

    beforeAll(buildHtmlLanguageFeatures, 120_000);

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
    });

    async function start(): Promise<IExtensionHarness> {
        harness = await createExtensionTestHarness({
            languageService: activatingLanguageService(HTML_LANGUAGE_SERVICE),
            configuration: HTML_SERVER_CONFIGURATION,
            extensions: [
                htmlLanguageFeaturesRegistration(),
                extensionFixture("test.virtualHtml", "providesHtmlVirtualDocument.cjs"),
            ],
        });
        return harness;
    }

    it(
        "completion wakes the HTML extension, the next command answers about the provider's new text",
        { timeout: 60_000 },
        async () => {
            const { commandRegistry } = await start();
            const complete = async (text: string, character: number): Promise<string[]> =>
                (await commandRegistry.execute("fixture.completeVirtualHtml", text, character)) as string[];
            let elements: string[] = [];
            await until("completion in the virtual document", async () => {
                elements = await complete("<di\n", 3);
                return elements.includes("div");
            });
            expect(elements).toContain("dialog");

            const attributes = await complete("<p c\n", 4);
            expect(attributes).toContain("class");
            expect(attributes).not.toContain("div");
        },
    );

    it("hover in the document is the HTML server's", { timeout: 60_000 }, async () => {
        const { commandRegistry } = await start();
        let contents: string[] = [];
        await until("hover in the virtual document", async () => {
            contents = (await commandRegistry.execute(
                "fixture.hoverVirtualHtml",
                '<p class="note"></p>\n',
                5,
            )) as string[];
            return contents.length > 0;
        });
        expect(contents.join("\n")).toContain("A space-separated list of the classes of the element.");
    });
});
