import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    documentVersion,
    provideCompletions,
    provideDefinitions,
    provideImplementations,
    provideReferences,
    provideRename,
    provideTypeDefinitions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { type IInstalledSvelte, installSvelte, svelteSampleFiles } from "../../../../../TestUtils/svelteFixture.ts";
import { withSvelteFiles } from "../../../../../TestUtils/svelteSession.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";

// The language features of stock svelte.svelte-vscode in a `.svelte` file, across to `.ts`. Inlay hints, lenses,
// symbols, occurrences, call hierarchy and linked editing are in `extensionHost.svelte.features.test.ts`.

const TIMEOUT = { timeout: 240_000 };

let installed: IInstalledSvelte;

interface ITarget {
    readonly file: string;
    readonly line: number;
    readonly character: number;
}

function targets(locations: readonly { uri: string; range: { start: { line: number; character: number } } }[]) {
    return locations.map(
        ({ uri, range }): ITarget => ({
            file: uri.slice(uri.lastIndexOf("/") + 1),
            line: range.start.line,
            character: range.start.character,
        }),
    );
}

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock svelte.svelte-vscode", () => {
    beforeAll(async () => {
        installed = await installSvelte();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it("completion offers the props and events of a component", TIMEOUT, () =>
        withSvelteFiles(installed, async (session) => {
            const { harness } = session;
            // `<Button ` and the cursor after the space: what Ctrl+Space asks for.
            const request = { ...session.at("App.svelte", "<Button", 8), triggerKind: 0 as const };
            const result = await provideCompletions(harness, request);
            expect(result.items.map(({ label }) => label)).toEqual(expect.arrayContaining(["label", "on:click"]));
        }),
    );

    it("completion of a component that is not imported adds the import", TIMEOUT, () =>
        withSvelteFiles(
            installed,
            async (session) => {
                const { harness } = session;
                const editor = session.activeEditor();
                const line = editor.getText().split("\n").indexOf("</main>");
                editor.viewState.applyEdits([{ range: createRange(line, 0, line, 0), text: "    <Car\n" }], "test");
                const uri = session.uriOf("App.svelte");
                const item = await until("the Card item", async () => {
                    const result = await provideCompletions(harness, {
                        uri,
                        languageId: "svelte",
                        versionId: documentVersion(harness, uri),
                        line,
                        character: 8,
                        triggerKind: 0,
                    });
                    return result.items.find(({ label, id }) => label === "Card" && id !== undefined) ?? null;
                });
                const resolved = await until("resolve with the import", async () => {
                    const found = await harness.host.resolveCompletionItem(item.id ?? "");
                    return found?.additionalEdits !== undefined ? found : null;
                });
                expect(resolved.additionalEdits?.map(({ text }) => text).join("")).toContain(
                    'import Card from "./Card.svelte"',
                );
            },
            {},
            { ...svelteSampleFiles(), "Card.svelte": "<div>card</div>\n" },
        ),
    );

    it("F12, Go to Implementation and Go to Type Definition lead from the markup into util.ts", TIMEOUT, () =>
        withSvelteFiles(installed, async (session) => {
            const { harness } = session;
            const greet = session.at("App.svelte", "greet(user)");
            await expect(provideDefinitions(harness, greet).then(targets)).resolves.toEqual([
                { file: "util.ts", line: 4, character: 16 },
            ]);
            await expect(provideImplementations(harness, greet).then(targets)).resolves.toEqual([
                { file: "util.ts", line: 4, character: 16 },
            ]);
            const user = session.at("App.svelte", "greet(user)", 6);
            await expect(provideTypeDefinitions(harness, user).then(targets)).resolves.toEqual([
                { file: "util.ts", line: 0, character: 17 },
            ]);
        }),
    );

    it("Find All References finds the declaration in util.ts and the use in the markup", TIMEOUT, () =>
        withSvelteFiles(installed, async (session) => {
            const request = { ...session.at("App.svelte", "greet(user)"), includeDeclaration: true };
            const found = targets(await provideReferences(session.harness, request));
            expect(found).toEqual(
                expect.arrayContaining([
                    { file: "util.ts", line: 4, character: 16 },
                    { file: "App.svelte", line: 12, character: 9 },
                ]),
            );
        }),
    );

    it("rename of an imported function in the markup renames it locally, through an alias in the import", TIMEOUT, () =>
        withSvelteFiles(installed, async (session) => {
            const result = await provideRename(session.harness, session.at("App.svelte", "greet(user)"), "salute");
            expect(result).toEqual({ applied: true });
            // The server always asks TypeScript for the alias (its RenameProvider), in VS Code as well.
            expect(session.activeEditor().getText()).toContain('import { greet as salute, type User } from "./util";');
            expect(session.activeEditor().getText()).toContain("<h1>{salute(user)}</h1>");
        }),
    );

    it("rename of a prop in Button.svelte renames the attribute in App.svelte", TIMEOUT, () =>
        withSvelteFiles(installed, async (session) => {
            const { harness } = session;
            harness.group.openFile(path.join(harness.tmpDir, "Button.svelte"));
            const result = await provideRename(harness, session.at("Button.svelte", "label: string"), "caption");
            expect(result).toEqual({ applied: true });
            const app = harness.group
                .getEditors()
                .find((editor) => editor.uri.toString() === session.uriOf("App.svelte"));
            expect(app?.getText()).toContain('<Button caption="Add" on:click={increment} />');
        }),
    );
});
