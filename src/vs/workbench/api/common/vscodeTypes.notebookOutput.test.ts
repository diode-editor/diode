import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";
import { NotebookCellOutputItem as RuntimeNotebookCellOutputItem } from "./vscodeTypes.ts";

const { NotebookCellOutputItem } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk()).namespace;
const decode = (data: Uint8Array): string => new TextDecoder().decode(data);

describe("vscode.NotebookCellOutputItem", () => {
    it("error: JSON of name, message and stack under the notebook error mime", () => {
        const err = new TypeError("boom");
        const item = NotebookCellOutputItem.error(err);
        expect(item.mime).toBe("application/vnd.code.notebook.error");
        expect(JSON.parse(decode(item.data))).toEqual({ name: "TypeError", message: "boom", stack: err.stack });
    });

    it("error: tab-indented JSON, as upstream", () => {
        const item = NotebookCellOutputItem.error({ name: "E", message: "m" });
        expect(decode(item.data)).toBe('{\n\t"name": "E",\n\t"message": "m"\n}');
    });

    it("text: UTF-8 bytes, default mime text/plain", () => {
        const item = NotebookCellOutputItem.text("\u043f\u0440\u0438\u0432\u0435\u0442"); // "privet": non-ASCII round-trips through UTF-8
        expect(item.mime).toBe("text/plain");
        expect(decode(item.data)).toBe("\u043f\u0440\u0438\u0432\u0435\u0442"); // "privet"
        expect(NotebookCellOutputItem.text("<b/>", "text/html").mime).toBe("text/html");
    });

    it("text: coerces a non-string to a string (JS caller)", () => {
        expect(decode(NotebookCellOutputItem.text(42 as unknown as string).data)).toBe("42");
    });

    it("json: default mime of the upstream runtime is text/x-json", () => {
        const item = NotebookCellOutputItem.json({ a: [1] });
        expect(item.mime).toBe("text/x-json");
        expect(JSON.parse(decode(item.data))).toEqual({ a: [1] });
        expect(NotebookCellOutputItem.json(1, "application/json").mime).toBe("application/json");
    });

    it("stdout/stderr: their own stream mimes", () => {
        expect(NotebookCellOutputItem.stdout("o").mime).toBe("application/vnd.code.notebook.stdout");
        expect(NotebookCellOutputItem.stderr("e").mime).toBe("application/vnd.code.notebook.stderr");
        expect(decode(NotebookCellOutputItem.stderr("e").data)).toBe("e");
    });

    it("bytes (upstream runtime, not in d.ts): bytes as is, default mime application/octet-stream", () => {
        const bytes = new Uint8Array([0, 255]);
        const item = RuntimeNotebookCellOutputItem.bytes(bytes);
        expect(item.data).toBe(bytes);
        expect(item.mime).toBe("application/octet-stream");
        expect(RuntimeNotebookCellOutputItem.bytes(bytes, "image/png").mime).toBe("image/png");
    });

    it("constructor lowercases type and subtype, parameters stay as is", () => {
        const item = new NotebookCellOutputItem(new Uint8Array([1]), "Text/HTML;Charset=UTF-8");
        expect(item.mime).toBe("text/html;Charset=UTF-8");
        expect(item.data).toEqual(new Uint8Array([1]));
    });

    it("constructor rejects a non-mime with the upstream text", () => {
        expect(() => new NotebookCellOutputItem(new Uint8Array(), "plain")).toThrow(
            'INVALID mime type: plain. Must be in the format "type/subtype[;optionalparameter]"',
        );
    });
});
