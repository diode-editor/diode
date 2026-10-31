import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";

const FIXTURE = extensionFixture("test.untitledUri", "opensUntitledUri.cjs");

interface IDocument {
    uri: string;
    isUntitled: boolean;
    isDirty: boolean;
    isClosed: boolean;
    languageId: string;
    encoding: string;
    text: string;
}

const execute = <T>(harness: IExtensionHarness, id: string, ...args: unknown[]): Promise<T> =>
    harness.commandRegistry.execute(`test.untitledUri.${id}`, ...args) as Promise<T>;

describe("ExtensionHost — untitled documents by uri (subprocess)", () => {
    let dir: string;
    let harness: IExtensionHarness;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-untitled-uri-"));
        harness = await createExtensionTestHarness({ extensions: [FIXTURE] });
    });

    afterEach(async () => {
        await harness.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const tabCount = (): number => harness.group.editorGroups.activeGroup.editorCount;

    it.each([
        ["absolute", "untitled:/some/where/new.txt"],
        ["relative", "untitled:new.txt"],
        ["with a host", "untitled://localhost/c%24/Users/jrieken/code/samples/foobar.txt"],
    ])("[api:workspace.openTextDocument] %s: dirty, no tab, the uri survives byte for byte", async (_name, uri) => {
        expect(await execute<IDocument>(harness, "open", uri)).toMatchObject({
            uri,
            isUntitled: true,
            isDirty: true,
            isClosed: false,
            text: "",
        });
        expect(tabCount()).toBe(0);
    });

    it("[api:workspace.openTextDocument] a second open returns the same document, not a new buffer", async () => {
        await execute(harness, "applyEditHeld", "untitled:/some/where/new.txt", "kept");
        expect(await execute<IDocument>(harness, "open", "untitled:/some/where/new.txt")).toMatchObject({
            text: "kept",
        });
    });

    it("[api:workspace.openTextDocument] without a path the document reads as dirty, the tab shows no marker", async () => {
        const doc = await execute<IDocument>(harness, "openEmpty", { language: "markdown" });
        expect(doc).toMatchObject({ uri: "untitled:Untitled-1", isDirty: true, languageId: "markdown", text: "" });
        expect(harness.group.getUntitledModelsWithoutEditor()[0]?.isModified).toBe(false);
    });

    it("[api:workspace.openTextDocument] automatic names skip a name an extension already took", async () => {
        await execute(harness, "open", "untitled:Untitled-1");
        expect(await execute<IDocument>(harness, "openEmpty", {})).toMatchObject({ uri: "untitled:Untitled-2" });
    });

    it("[api:workspace.openTextDocument] a file that already exists is refused, upstream's message", async () => {
        const target = path.join(dir, "taken.txt");
        fs.writeFileSync(target, "x");
        const uri = `untitled:${target}`;
        expect(await execute(harness, "openFails", uri)).toBe(`cannot open ${uri}. Detail: file already exists`);
    });

    it("[api:workspace.openTextDocument] an uri without a path and host is invalid, upstream's message", async () => {
        expect(await execute(harness, "openFails", "untitled:")).toBe(
            "Invalid uri. Scheme and authority or path must be set.",
        );
    });

    it("[api:workspace.openTextDocument] an explicit encoding changes an open untitled document", async () => {
        expect(await execute(harness, "changeEncoding", "windows1252")).toEqual({
            before: "utf8",
            after: "windows1252",
            same: true,
        });
    });

    it("[api:commands.executeCommand] vscode.open with a path: a dirty tab named by the basename", async () => {
        const doc = await execute<IDocument>(harness, "vscodeOpen", "untitled:/some/where/untitled-file.txt");
        expect(doc).toMatchObject({ uri: "untitled:/some/where/untitled-file.txt", isDirty: true });
        const editor = harness.group.getActiveEditor();
        expect(editor?.label).toBe("untitled-file.txt");
        expect(editor?.isModified).toBe(true);
    });

    it("[api:commands.executeCommand] vscode.open with an Untitled-N name is no associated path: the tab is clean", async () => {
        await execute(harness, "vscodeOpen", "untitled:Untitled-7");
        const editor = harness.group.getActiveEditor();
        expect(editor?.label).toBe("Untitled-7");
        expect(editor?.isModified).toBe(false);
    });

    it("[api:TextDocument.save] a shown document with a path: the file is written, the untitled closes, the tab holds the file", async () => {
        const target = path.join(dir, "sub", "new.txt");
        const uri = `untitled:${target}`;
        await execute(harness, "applyEditHeld", uri, "body");

        expect(await execute(harness, "saveShown", uri, true)).toEqual({
            saved: true,
            closedSameDocument: true,
            isDirty: false,
            isClosed: true,
        });
        expect(fs.readFileSync(target, "utf8")).toBe("body");
        const editor = harness.group.getActiveEditor();
        expect(editor?.uri.toString()).toBe(`file://${target}`);
        expect(editor?.isModified).toBe(false);
        expect(tabCount()).toBe(1);
        // The layout comes after the reply to `save`, as upstream: the extension sees the file shortly after.
        await vi.waitFor(async () => {
            expect(await execute(harness, "activeUri")).toBe(`file://${target}`);
        });
    });

    it("[api:TextDocument.save] without a tab: the file is written and the untitled closes, no tab appears", async () => {
        const target = path.join(dir, "new.txt");
        expect(await execute(harness, "saveShown", `untitled:${target}`, false)).toMatchObject({
            saved: true,
            closedSameDocument: true,
            isDirty: false,
        });
        expect(fs.existsSync(target)).toBe(true);
        expect(tabCount()).toBe(0);
        expect(harness.group.getUntitledModelsWithoutEditor()).toEqual([]);
    });

    it("[api:TextDocument.save] a file that appeared after the open is not overwritten without asking", async () => {
        const target = path.join(dir, "late.txt");
        await execute(harness, "open", `untitled:${target}`);
        fs.writeFileSync(target, "theirs");
        expect(await execute(harness, "saveShown", `untitled:${target}`, true)).toMatchObject({ saved: false });
        expect(fs.readFileSync(target, "utf8")).toBe("theirs");
    });

    it("[api:TextDocument.save] a relative uri has no path to write to: it stays unsaved", async () => {
        expect(await execute(harness, "saveShown", "untitled:new.txt", true)).toMatchObject({
            saved: false,
            isDirty: true,
            isClosed: false,
        });
    });

    it("[api:workspace.applyEdit] an open document without a tab takes the edit and stays dirty", async () => {
        expect(await execute(harness, "applyEditHeld", "untitled:/some/where/new2.txt", "Hello")).toMatchObject({
            applied: true,
            isDirty: true,
            text: "Hello",
        });
        expect(tabCount()).toBe(0);
    });

    it("[api:workspace.applyEdit] create + edit on an untitled uri: the create is skipped, the text arrives", async () => {
        expect(await execute(harness, "createAndEdit", "untitled:Untitled-5.test", "Hello Test")).toMatchObject({
            applied: true,
            uri: "untitled:Untitled-5.test",
            text: "Hello Test",
            isDirty: true,
        });
    });

    it("[api:workspace.saveAll] without includeUntitled a document with a path is not written", async () => {
        const target = path.join(dir, "kept.txt");
        await execute(harness, "vscodeOpen", `untitled:${target}`);
        expect(await execute(harness, "saveAll", false)).toBe(true);
        expect(fs.existsSync(target)).toBe(false);
    });
});
