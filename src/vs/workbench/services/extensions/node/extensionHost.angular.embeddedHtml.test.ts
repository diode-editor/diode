import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    ANGULAR_ID,
    ensureAngularLibrary,
    type IInstalledAngular,
    installAngular,
} from "../../../../../TestUtils/angularFixture.ts";
import {
    APP_TS,
    HELLO_HTML,
    type IAngularSession,
    type IAngularSessionOptions,
    withAngularProject,
} from "../../../../../TestUtils/angularSession.ts";
import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { provideCompletions, provideHovers } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    buildHtmlLanguageFeatures,
    HTML_SERVER_CONFIGURATION,
    htmlLanguageFeaturesRegistration,
} from "../../../../../TestUtils/HtmlLanguageFeaturesHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";

// Stock Angular.ng-template next to the built-in HTML language features. In an inline template Angular's middleware
// asks `vscode.executeCompletionItemProvider`/`vscode.executeHoverProvider` about its virtual
// `angular-embedded-content://html/….ts.html` document, and the HTML server answers there: HTML elements, attributes
// and MDN hovers join Angular's own items, as in VS Code. Only `app.component.ts` is open: the virtual document is
// what wakes the HTML extension.

const TIMEOUT = { timeout: 240_000 };

let installed: IInstalledAngular;
let nodeModules: string;

function withAngularAndHtml(
    run: (session: IAngularSession) => Promise<void>,
    entry: IAngularSessionOptions["entry"] = APP_TS,
): Promise<void> {
    return withAngularProject(installed, nodeModules, run, {
        entry,
        configuration: HTML_SERVER_CONFIGURATION,
        extensions: [htmlLanguageFeaturesRegistration()],
    });
}

async function labelsAt(session: IAngularSession, request: ReturnType<IAngularSession["at"]>): Promise<string[]> {
    const result = await provideCompletions(session.harness, { ...request, triggerKind: 0 });
    return result.items.map(({ label }) => label);
}

async function hoverAt(session: IAngularSession, request: ReturnType<IAngularSession["at"]>): Promise<string> {
    const hovers = await provideHovers(session.harness, request);
    return hovers.map((hover) => hover.contents.join("\n")).join("\n");
}

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock Angular.ng-template with the built-in HTML", () => {
    beforeAll(async () => {
        await buildHtmlLanguageFeatures();
        installed = await installAngular();
        expect(installed.registration.id).toBe(ANGULAR_ID);
        nodeModules = ensureAngularLibrary();
    }, 300_000);

    afterAll(() => {
        installed.dispose();
    });

    it("`<` in the inline template offers HTML elements together with the components", TIMEOUT, () =>
        withAngularAndHtml(async (session) => {
            // The first request opens the virtual document, and that activates the HTML extension.
            let labels: string[] = [];
            await until("HTML elements next to the components", async () => {
                labels = await labelsAt(session, session.at(APP_TS, "<span>", 1));
                return labels.includes("div") ? labels : null;
            });
            expect(labels).toEqual(expect.arrayContaining(["app-hello", "app-root", "div", "span", "p"]));
        }),
    );

    it("after an edit the HTML answer is about the new text", TIMEOUT, () =>
        withAngularAndHtml(async (session) => {
            await until("HTML elements", async () =>
                (await labelsAt(session, session.at(APP_TS, "<span>", 1))).includes("div") ? true : null,
            );
            // `<p class="note">` becomes `<di <p class="note">`: at the old text the position is in `<p c`, an
            // attribute name.
            const before = session.at(APP_TS, '<p class="note">');
            const editor = session.activeEditor();
            editor.viewState.selections = [createCursorSelection(before.line, before.character)];
            editor.typeText("<di ");
            const labels = await until("the elements at the new <di", async () => {
                const found = await labelsAt(session, { ...session.at(APP_TS, '<p class="note">'), character: 11 });
                return found.includes("div") ? found : null;
            });
            expect(labels).not.toContain("class");
        }),
    );

    it("inside a tag of the inline template HTML attributes come with Angular's inputs", TIMEOUT, () =>
        withAngularAndHtml(async (session) => {
            let labels: string[] = [];
            await until("HTML attributes next to the input", async () => {
                labels = await labelsAt(session, session.at(APP_TS, '[name]="title"', 1));
                return labels.includes("class") ? labels : null;
            });
            expect(labels).toEqual(expect.arrayContaining(["class", "id", "name"]));
        }),
    );

    // The middleware returns Angular's hover when there is one and the HTML server's otherwise, as in VS Code: the
    // element is Angular's `(element)`, a static attribute Angular says nothing about gets the MDN text.
    it("hover in the inline template: Angular's where it has one, HTML's on a static attribute", TIMEOUT, () =>
        withAngularAndHtml(async (session) => {
            const attribute = await until("the MDN hover of class", async () => {
                const text = await hoverAt(session, session.at(APP_TS, 'class="note"', 2));
                return text === "" ? null : text;
            });
            expect(attribute).toContain("A space-separated list of the classes of the element.");
            expect(await hoverAt(session, session.at(APP_TS, "<span>", 2))).toContain(
                "(element) span: HTMLSpanElement",
            );
            expect(await hoverAt(session, session.at(APP_TS, "{{ title.", 3))).toContain(
                "(property) AppComponent.title: string",
            );
        }),
    );

    it("outside the template the TypeScript code gets no HTML items", TIMEOUT, () =>
        withAngularAndHtml(async (session) => {
            expect(await labelsAt(session, session.at(APP_TS, 'title = "diode"'))).not.toContain("div");
        }),
    );

    it("in the .html template the HTML server's elements come with Angular's components", TIMEOUT, () =>
        withAngularAndHtml(async (session) => {
            let labels: string[] = [];
            await until("HTML elements and components", async () => {
                labels = await labelsAt(session, session.at(HELLO_HTML, "<p>", 1));
                return labels.includes("div") ? labels : null;
            });
            expect(labels).toEqual(expect.arrayContaining(["div", "span", "app-root"]));
        }, HELLO_HTML),
    );
});
