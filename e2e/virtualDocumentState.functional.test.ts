import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const userData = resolve(here, "fixtures", "user-data-with-virtual-document-probe");

// The extension host subprocess flakes in e2e on Windows (see docs/TESTING.md).
const describeLinuxOnly = process.platform === "linux" ? describe : describe.skip;

/** Runs a probe command and returns the toast line it reports, read off the frame. */
async function probe(session: HeadlessSession, command: string, marker: RegExp): Promise<string> {
    await session.waitForText((text) => text.includes("probe-ready"), { timeoutMs: 30_000 });
    await session.executeCommand(command);
    let line = "";
    await session.waitForText(
        (text) => {
            line = marker.exec(text)?.[0] ?? "";
            return line !== "";
        },
        { timeoutMs: 15_000 },
    );
    return line;
}

/** #916: the state an extension reads from a provider's document matches what upstream's model reports and what the frame shows. */
describeLinuxOnly("virtual documents and language state seen by an extension", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 180_000);

    it("a provider's change does not make the shown document dirty", async () => {
        const { session } = await useHeadlessApp({ seedUserData: userData, open: [], cols: 140 });

        const line = await probe(session, "probe.dirtyAfterProviderChange", /text=\w+ dirty=\w+/u);

        expect(line).toBe("text=second dirty=false");
    }, 120_000);

    it("a closed document leaves workspace.textDocuments", async () => {
        const { session } = await useHeadlessApp({ seedUserData: userData, open: [], cols: 140 });

        const line = await probe(session, "probe.closeTab", /closed=\w+ listed=\w+/u);

        expect(line).toBe("closed=true listed=false");
    }, 120_000);

    it("closing one of two editors of a document does not close the document", async () => {
        const { session } = await useHeadlessApp({ seedUserData: userData, open: [], cols: 140 });

        const line = await probe(session, "probe.closeOneOfTwoEditors", /shown=\d+ closed=\w+ fired=\w+/u);

        expect(line).toBe("shown=1 closed=false fired=false");
    }, 120_000);

    it("CRLF content reports CRLF and keeps it, with and without a tab", async () => {
        const { session } = await useHeadlessApp({ seedUserData: userData, open: [], cols: 140 });

        const line = await probe(session, "probe.crlf", /bare=\S+ tab=\S+/u);

        expect(line).toBe("bare=2/true tab=2/true");
    }, 120_000);

    it("a language set before the tab exists shows in the status bar when the user opens the file with quick open", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            files: { "held.txt": "held\n" },
            cols: 140,
        });

        expect(await probe(session, "probe.languageWithoutTab", /held=\w+/u)).toBe("held=json");
        await session.key("Ctrl+p");
        await session.waitForNode("#quickInput");
        await session.text("held.txt");
        await session.waitForText((text) => text.split("\n").filter((row) => row.includes("held.txt")).length > 0);
        await session.key("Enter");
        await session.waitForNoNode("#quickInput");
        await session.waitForText((text) => text.includes("held.txt ×"));

        await session.waitForText((text) => text.includes("JSON"), { timeoutMs: 10_000 });
    }, 120_000);

    it("without a folder rootPath is undefined and the folder pick resolves to undefined without a picker", async () => {
        const { session } = await useHeadlessApp({ seedUserData: userData, open: [], cols: 140 });

        const line = await probe(session, "probe.noFolders", /root=\w+ picked=\w+/u);

        expect(line).toBe("root=undefined picked=undefined");
    }, 120_000);
});
