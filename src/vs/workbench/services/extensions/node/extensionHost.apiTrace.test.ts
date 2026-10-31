import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    type IExtensionHarness,
    provideCompletions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IApiTraceRecord } from "../../../api/common/apiTrace.ts";

const ID = "test.providesCompletion";
const MEMBER = "languages.registerCompletionItemProvider";

async function startHarness(): Promise<IExtensionHarness> {
    const harness = await createExtensionTestHarness({
        initialFile: { name: ".editorconfig", content: "ind" },
        extensions: [extensionFixture(ID, "providesCompletion.cjs")],
    });
    await settle();
    return harness;
}

function complete(harness: IExtensionHarness): ReturnType<typeof provideCompletions> {
    const uri = Uri.file(`${harness.tmpDir}/.editorconfig`).toString();
    return provideCompletions(harness, {
        uri,
        languageId: "editorconfig",
        versionId: documentVersion(harness, uri),
        line: 0,
        character: 3,
    });
}

describe("ExtensionHost — call journal (subprocess)", () => {
    let dir: string;
    let journal: string;

    const rows = (): IApiTraceRecord[] =>
        fs
            .readFileSync(journal, "utf8")
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => JSON.parse(line) as IApiTraceRecord);

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "diode-api-trace-"));
        journal = path.join(dir, "journal.jsonl");
    });

    afterEach(() => {
        delete process.env.DIODE_API_TRACE;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("registered at activation, invoked only after the editor asks", async () => {
        process.env.DIODE_API_TRACE = journal;
        const harness = await startHarness();
        try {
            const facts = (): unknown[] => rows().map((r) => [r.extension, r.member, r.kind, r.method]);
            expect(facts()).toContainEqual([ID, MEMBER, "registered", undefined]);
            expect(facts()).not.toContainEqual([ID, MEMBER, "invoked", "provideCompletionItems"]);

            const { items } = await complete(harness);
            // The provider still works through the wrapper.
            expect(items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
            expect(facts()).toContainEqual([ID, MEMBER, "invoked", "provideCompletionItems"]);
            expect(facts()).toContainEqual([ID, "CompletionItem.detail", "field", undefined]);
            expect(facts()).toContainEqual([ID, "commands.registerCommand", "call", undefined]);
        } finally {
            await harness.dispose();
        }
    });

    it("without the variable there is no file and the provider works", async () => {
        const harness = await startHarness();
        try {
            expect((await complete(harness)).items).toHaveLength(2);
        } finally {
            await harness.dispose();
        }
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it("an unwritable journal does not break the extension", async () => {
        // A directory in place of the file: every append fails.
        process.env.DIODE_API_TRACE = dir;
        const harness = await startHarness();
        try {
            expect((await complete(harness)).items).toHaveLength(2);
        } finally {
            await harness.dispose();
        }
    });
});
