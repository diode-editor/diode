import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    ANGULAR_ID,
    ensureAngularLibrary,
    type IInstalledAngular,
    installAngular,
} from "../../../../../TestUtils/angularFixture.ts";
import { APP_TS, HELLO_HTML, HELLO_TS, withAngularProject } from "../../../../../TestUtils/angularSession.ts";
import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    provideCompletions,
    provideDefinitions,
    provideHovers,
    provideReferences,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { DEFAULT_CODE_LENS_OPTIONS } from "../../../../editor/contrib/codelens/browser/codeLensController.ts";

// Stock Angular.ng-template on a project with `strictTemplates`: a template in an `.html` file and an inline one in
// `app.component.ts`. Only the Angular extension is registered here, so every answer below is its server's.

const TIMEOUT = { timeout: 240_000 };

let installed: IInstalledAngular;
let nodeModules: string;

function fileOf(uri: string): string {
    return uri.slice(uri.lastIndexOf("/") + 1);
}

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock Angular.ng-template", () => {
    beforeAll(async () => {
        installed = await installAngular();
        expect(installed.registration.id).toBe(ANGULAR_ID);
        nodeModules = ensureAngularLibrary();
    }, 300_000);

    afterAll(() => {
        installed.dispose();
    });

    it("ngtsc diagnostics in the .html template and in the inline one", TIMEOUT, () =>
        withAngularProject(installed, nodeModules, async (session) => {
            const external = await session.markerSaying(HELLO_HTML, "missingProp");
            expect(external).toMatchObject({
                message: "Property 'missingProp' does not exist on type 'HelloComponent'.",
                source: "ngtsc",
                code: "2339",
                range: { start: { line: 2, character: 6 } },
            });
            session.open(APP_TS);
            const inline = await session.markerSaying(APP_TS, "nope");
            expect(inline).toMatchObject({ source: "ngtsc", code: "2339", range: { start: { line: 9 } } });
        }),
    );

    it("completion offers the component's members in an interpolation and the events of an element", TIMEOUT, () =>
        withAngularProject(installed, nodeModules, async (session) => {
            const { harness } = session;
            const members = await provideCompletions(harness, {
                ...session.at(HELLO_HTML, "{{ count }}", 3),
                triggerKind: 0,
            });
            expect(members.items.map(({ label }) => label)).toEqual(
                expect.arrayContaining(["count", "increment", "name"]),
            );
            const events = await provideCompletions(harness, {
                ...session.at(HELLO_HTML, "(click)", 1),
                triggerKind: 0,
            });
            expect(events.items.map(({ label }) => label)).toContain("(click)");
        }),
    );

    it("completion in the inline template offers the imported component", TIMEOUT, () =>
        withAngularProject(installed, nodeModules, async (session) => {
            session.open(APP_TS);
            await session.markerSaying(APP_TS, "nope");
            const result = await provideCompletions(session.harness, {
                ...session.at(APP_TS, "<app-hello", 1),
                triggerKind: 0,
            });
            expect(result.items.map(({ label }) => label)).toContain("app-hello");
        }),
    );

    it("hover and Go to Definition lead from the template into the component", TIMEOUT, () =>
        withAngularProject(installed, nodeModules, async (session) => {
            const { harness } = session;
            const count = session.at(HELLO_HTML, "{{ count }}", 3);
            const hovers = await provideHovers(harness, count);
            expect(hovers.map((hover) => hover.contents.join("\n")).join("\n")).toContain("count: number");
            const definitions = await provideDefinitions(harness, session.at(HELLO_HTML, "increment()"));
            expect(definitions.map(({ uri, range }) => [fileOf(uri), range.start.line])).toEqual([
                ["hello.component.ts", 9],
            ]);
        }),
    );

    it("references from the component reach the template", TIMEOUT, () =>
        withAngularProject(installed, nodeModules, async (session) => {
            session.open(HELLO_TS);
            const found = await until("the references in the template", async () => {
                const references = await provideReferences(session.harness, {
                    ...session.at(HELLO_TS, "count = 0"),
                    includeDeclaration: true,
                });
                return references.some(({ uri }) => uri === session.uriOf(HELLO_HTML)) ? references : null;
            });
            expect(
                found.filter(({ uri }) => uri === session.uriOf(HELLO_HTML)).map(({ range }) => range.start),
            ).toEqual([{ line: 1, character: 41 }]);
        }),
    );

    it("the Go to component lens is in the .html template", TIMEOUT, () =>
        withAngularProject(installed, nodeModules, async (session) => {
            session.activeEditor().setCodeLens(DEFAULT_CODE_LENS_OPTIONS);
            await session.frameHas("Go to component");
        }),
    );

    it("Go to template hands the location of the template to editor.action.goToLocations", TIMEOUT, () =>
        withAngularProject(installed, nodeModules, async (session) => {
            const { harness } = session;
            // The workbench's command opens the location (the demo scenario goes there); here it records the call.
            const calls: unknown[][] = [];
            harness.commandRegistry.register("editor.action.goToLocations", (...args: unknown[]) => {
                calls.push(args);
            });
            session.open(HELLO_TS);
            const component = session.at(HELLO_TS, "class HelloComponent", 6);
            session.activeEditor().viewState.selections = [createCursorSelection(component.line, component.character)];
            // The selection reaches the extension's `activeTextEditor` asynchronously: ask until it is there.
            const [, , locations] = await until("the goToLocations call", async () => {
                await harness.commandRegistry.execute("angular.goToTemplateForComponent");
                return calls.at(0) ?? null;
            });
            const targets = (locations as readonly { uri: { path: string } }[]).map(({ uri }) => uri.path);
            expect(targets).toEqual([expect.stringMatching(/\/hello\.component\.html$/)]);
        }),
    );

    it("View Template Typecheck Block opens the generated typecheck file beside", TIMEOUT, () =>
        withAngularProject(installed, nodeModules, async (session) => {
            const { harness } = session;
            const missing = session.at(HELLO_HTML, "missingProp");
            session.activeEditor().viewState.selections = [createCursorSelection(missing.line, missing.character)];
            await harness.commandRegistry.execute("angular.getTemplateTcb");
            const tcb = await until(
                "the typecheck block",
                () => harness.group.getEditors().find((editor) => editor.uri.path.endsWith(".ngtypecheck.ts")) ?? null,
            );
            expect(tcb.getText()).toContain("missingProp");
            // `preserveFocus`: the cursor stays in the template.
            expect(session.activeEditor().uri.toString()).toBe(session.uriOf(HELLO_HTML));
        }),
    );
});
