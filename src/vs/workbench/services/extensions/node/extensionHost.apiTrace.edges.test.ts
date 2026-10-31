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

const ID = "test.apiTraceEdges";

describe("ExtensionHost — call journal, edges of a provider response (subprocess)", () => {
    let dir: string;
    let journal: string;

    const rows = (): IApiTraceRecord[] =>
        fs
            .readFileSync(journal, "utf8")
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => JSON.parse(line) as IApiTraceRecord);

    const fields = (): string[] =>
        rows()
            .filter((r) => r.extension === ID && r.kind === "field")
            .map((r) => r.member);

    async function run(): Promise<{ harness: IExtensionHarness; labels: string[] }> {
        process.env.DIODE_API_TRACE = journal;
        const harness = await createExtensionTestHarness({
            initialFile: { name: ".editorconfig", content: "ind" },
            extensions: [extensionFixture(ID, "apiTraceEdges.cjs")],
        });
        await settle();
        const uri = Uri.file(`${harness.tmpDir}/.editorconfig`).toString();
        const { items } = await provideCompletions(harness, {
            uri,
            languageId: "editorconfig",
            versionId: documentVersion(harness, uri),
            line: 0,
            character: 3,
        });
        return { harness, labels: items.map((i) => i.label) };
    }

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "diode-api-trace-"));
        journal = path.join(dir, "journal.jsonl");
    });

    afterEach(() => {
        delete process.env.DIODE_API_TRACE;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("a foreign thenable response is not walked: its `then` is not a CompletionItem field", async () => {
        const { harness, labels } = await run();
        try {
            expect(labels).toContain("fromThenable");
            expect(fields()).not.toContain("CompletionItem.then");
        } finally {
            await harness.dispose();
        }
    });

    it("a field left undefined was not filled by the provider", async () => {
        const { harness } = await run();
        try {
            expect(fields()).toContain("CompletionItem.sortText");
            expect(fields()).not.toContain("CompletionItem.detail");
        } finally {
            await harness.dispose();
        }
    });

    it("the deltas sum up to the exact number of calls after exit", async () => {
        const { harness } = await run();
        await harness.dispose();
        const total = rows()
            .filter((r) => r.extension === ID && r.member === "workspace.getConfiguration" && r.kind === "call")
            .reduce((sum, r) => sum + r.count, 0);
        expect(total).toBe(1000);
    });
});
