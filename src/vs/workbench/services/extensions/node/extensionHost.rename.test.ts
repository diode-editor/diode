import * as fs from "node:fs";

import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    prepareRenameAt,
    provideRename,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IRenameRequest } from "../../../../editor/common/languages/iRenameSource.ts";

const FIXTURE = extensionFixture("test.providesRename", "providesRename.cjs");
const CONTENT = "const value = 1;\nconst other = value;\nkeyword\n";

function requestFor(uri: string, line: number, versionId: number): IRenameRequest {
    return { uri, languageId: "plaintext", versionId, line, character: 8 };
}

describe("ExtensionHost — rename providers (subprocess)", () => {
    it("a real provider: symbol name and edits across an open and a closed file", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.txt", content: CONTENT },
            extensions: [FIXTURE],
        });
        try {
            await settle();
            const mainPath = `${harness.tmpDir}/main.txt`;
            const mainUri = Uri.file(mainPath).toString();
            const neighbour = harness.writeFile("other.txt", "value here\n");

            // The provider's `{range, placeholder}` arrives as the symbol name…
            expect(await prepareRenameAt(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri)))).toEqual({
                name: "value",
            });
            // …a bare Range as the name taken from the text of that range…
            expect(await prepareRenameAt(harness, requestFor(mainUri, 1, documentVersion(harness, mainUri)))).toEqual({
                name: "value",
            });
            // …and a provider refusal as a human-readable reason.
            expect(await prepareRenameAt(harness, requestFor(mainUri, 2, documentVersion(harness, mainUri)))).toEqual({
                name: null,
                rejectReason: "You cannot rename this element.",
            });

            const result = await provideRename(
                harness,
                requestFor(mainUri, 0, documentVersion(harness, mainUri)),
                "renamed",
            );
            await settle();
            expect(result).toEqual({ applied: true });
            expect(harness.group.getActiveEditor()?.getText()).toBe(
                "const renamed = 1;\nconst other = value;\nkeyword\n",
            );
            // A CLOSED neighboring file is changed by writing to disk (bulk edit).
            expect(fs.readFileSync(neighbour, "utf8")).toBe("renamed here\n");
        } finally {
            await harness.dispose();
        }
    });

    it("an invalid name is rejected with the provider's message; the document is untouched", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.txt", content: CONTENT },
            extensions: [FIXTURE],
        });
        try {
            await settle();
            const mainUri = Uri.file(`${harness.tmpDir}/main.txt`).toString();

            expect(
                await provideRename(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri)), "class"),
            ).toEqual({
                applied: false,
                error: "'class' is not a valid identifier",
            });
            // A provider with no edits is a refusal WITHOUT a message (nothing to rename).
            expect(
                await provideRename(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri)), "nothing"),
            ).toEqual({ applied: false });
            await settle();
            expect(harness.group.getActiveEditor()?.getText()).toBe(CONTENT);
        } finally {
            await harness.dispose();
        }
    });

    it("without providers the rename registry is empty: no name, no rename applied", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.txt", content: CONTENT },
            extensions: [extensionFixture("test.noop", "noopExtension.cjs")],
        });
        try {
            await settle();
            const mainUri = Uri.file(`${harness.tmpDir}/main.txt`).toString();

            expect(await prepareRenameAt(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri)))).toEqual({
                name: null,
            });
            expect(
                await provideRename(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri)), "renamed"),
            ).toEqual({ applied: false });
        } finally {
            await harness.dispose();
        }
    });
});
