import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";

const FIXTURE = extensionFixture("test.openWithEncoding", "opensFileWithEncoding.cjs");
const HELLO = "Hellö Wörld"; // "Hello World" with o-umlauts

const execute = <T>(harness: IExtensionHarness, id: string, ...args: unknown[]): Promise<T> =>
    harness.commandRegistry.execute(`test.openWithEncoding.${id}`, ...args) as Promise<T>;

describe("ExtensionHost — openTextDocument(file, { encoding }) on the live model (subprocess)", () => {
    let dir: string;
    let file: string;
    let harness: IExtensionHarness;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-open-encoding-"));
        file = path.join(dir, "latin.txt");
        fs.writeFileSync(file, iconv.encode(HELLO, "cp1252"));
        harness = await createExtensionTestHarness({ extensions: [FIXTURE] });
    });

    afterEach(async () => {
        await harness.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const paneOf = (target: string) => harness.group.getEditors().find((editor) => editor.uri.fsPath === target);

    it("[api:workspace.openTextDocument] [api:TextDocument.encoding] decodes the live model in the name given, the tab shows it", async () => {
        expect(await execute(harness, "open", file, "cp1252")).toEqual({
            encoding: "cp1252",
            isDirty: false,
            text: HELLO,
        });

        await execute(harness, "show", file);

        expect(paneOf(file)?.encoding).toBe("cp1252");
        expect(paneOf(file)?.getText()).toBe(HELLO);
    });

    it("[api:workspace.openTextDocument] another encoding rereads the same document and fires a change", async () => {
        const result = await execute<{ changed: number }>(harness, "switch", file, "cp1252", "utf16le");
        expect(result).toMatchObject({ before: "cp1252", after: "utf16le", same: true });
        expect(result.changed).toBeGreaterThan(0);
    });

    it("[api:workspace.openTextDocument] concurrent requests with and without an encoding give one document in it", async () => {
        expect(await execute(harness, "concurrent", file, "cp1252")).toEqual({
            same: true,
            plain: "cp1252",
            encoded: "cp1252",
        });
    });

    it("[api:workspace.openTextDocument] an unknown name is utf-8", async () => {
        expect(await execute(harness, "open", file, "foobar123")).toMatchObject({ encoding: "utf8" });
    });

    it("[api:workspace.openTextDocument] a dirty document refuses another encoding with upstream's message", async () => {
        expect(await execute(harness, "editThenReopen", file, "cp1252", "utf16le")).toEqual({
            isDirty: true,
            error: "Cannot re-open a dirty text document with different encoding. Save it first.",
        });
    });

    it("[api:workspace.openTextDocument] a file rewritten in another encoding reads back in it", async () => {
        fs.writeFileSync(file, "Hellö\nWörld"); // utf-8
        expect(await execute(harness, "rewriteAndReopen", file, "windows1252")).toEqual({
            encoding: "windows1252",
            isDirty: false,
            text: "Hellö\nWörld",
            original: "Hellö\nWörld",
        });
        expect(fs.readFileSync(file).equals(iconv.encode("Hellö\nWörld", "windows1252"))).toBe(true);
    });
});
