import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";

const FIXTURE = extensionFixture("test.appliesWorkspaceEdit", "appliesWorkspaceEdit.cjs");

// Deleting a file goes to the system trash (`files.enableTrash` is on by default),
// so point it at tmp to keep test runs out of the developer's trash.
let savedXdg: string | undefined;

beforeEach(() => {
    savedXdg = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "diode-applyedit-xdg-"));
});

afterEach(() => {
    const isolated = process.env.XDG_DATA_HOME;
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    if (isolated !== undefined && isolated !== savedXdg) fs.rmSync(isolated, { recursive: true, force: true });
});

describe("ExtensionHost — workspace.applyEdit (subprocess)", () => {
    it("an edit of the active document applies and reverts with one undo", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "hello\nworld" },
            extensions: [FIXTURE],
        });
        try {
            await settle();
            const applied = await harness.commandRegistry.execute("test.applyReplaceActive");
            await settle();
            expect(applied).toBe(true);
            expect(harness.group.getActiveEditor()?.getText()).toBe("HELLO\nworld");

            harness.group.getActiveEditor()?.undo();
            expect(harness.group.getActiveEditor()?.getText()).toBe("hello\nworld");
        } finally {
            await harness.dispose();
        }
    });

    it("a multi-file edit applies to ALL open documents, including inactive ones", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "alpha" },
            extensions: [FIXTURE],
        });
        try {
            const second = harness.writeFile("b.txt", "beta");
            harness.group.openFile(second);
            await settle();

            const first = harness.group
                .getEditors()
                .find((editor) => editor.uri.toString() !== Uri.file(second).toString());
            expect(first).toBeDefined();

            const applied = await harness.commandRegistry.execute("test.applyToFiles", [first!.uri.fsPath, second]);
            await settle();
            expect(applied).toBe(true);
            expect(first?.getText()).toBe("Xalpha");
            expect(harness.group.getActiveEditor()?.getText()).toBe("Xbeta");
        } finally {
            await harness.dispose();
        }
    });

    it("a CLOSED file is edited on disk and an open one in its buffer; one undo reverts both", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "alpha" },
            extensions: [FIXTURE],
        });
        try {
            await settle();
            const closed = harness.writeFile("closed.txt", "beta");
            const active = harness.group.getActiveEditor();
            expect(harness.group.getEditors().map((e) => e.uri.fsPath)).not.toContain(closed);

            const applied = await harness.commandRegistry.execute("test.applyToFiles", [active!.uri.fsPath, closed]);
            await settle();

            expect(applied).toBe(true);
            expect(active?.getText()).toBe("Xalpha");
            expect(fs.readFileSync(closed, "utf8")).toBe("Xbeta");
            expect(active?.isModified).toBe(true);

            // A step on a closed file first checks the disk asynchronously, so wait for the rollback.
            active?.undo();
            await vi.waitFor(() => {
                expect(active?.getText()).toBe("alpha");
                expect(fs.readFileSync(closed, "utf8")).toBe("beta");
            });
        } finally {
            await harness.dispose();
        }
    });

    it("a missing resource cancels the whole edit: false, buffers and disk untouched", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "alpha" },
            extensions: [FIXTURE],
        });
        try {
            await settle();
            const active = harness.group.getActiveEditor();
            const applied = await harness.commandRegistry.execute("test.applyToFiles", [
                active!.uri.fsPath,
                path.join(harness.tmpDir, "nowhere", "closed.txt"),
            ]);
            await settle();
            expect(applied).toBe(false);
            expect(active?.getText()).toBe("alpha");
        } finally {
            await harness.dispose();
        }
    });

    it("an edit with a file rename applies as a whole: text in the buffer, file at the new path", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "alpha" },
            extensions: [FIXTURE],
        });
        try {
            await settle();
            const from = harness.writeFile("old.txt", "payload");
            const to = path.join(harness.tmpDir, "new.txt");
            const active = harness.group.getActiveEditor();

            const applied = await harness.commandRegistry.execute("test.applyRenameWithText", [from, to]);
            await settle();

            expect(applied).toBe(true);
            expect(active?.getText()).toBe("Ylpha");
            expect(fs.existsSync(from)).toBe(false);
            expect(fs.readFileSync(to, "utf8")).toBe("payload");
        } finally {
            await harness.dispose();
        }
    });

    it("`Move to a new file`: create with contents, edit the new file and delete the old one", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "alpha" },
            extensions: [FIXTURE],
        });
        try {
            await settle();
            const created = path.join(harness.tmpDir, "moved", "target.txt");
            const removed = harness.writeFile("source.txt", "gone");

            const applied = await harness.commandRegistry.execute("test.applyMoveToNewFile", [created, removed]);
            await settle();

            expect(applied).toBe(true);
            expect(fs.readFileSync(created, "utf8")).toBe("moved\ntail\n");
            expect(fs.existsSync(removed)).toBe(false);
        } finally {
            await harness.dispose();
        }
    });
});
