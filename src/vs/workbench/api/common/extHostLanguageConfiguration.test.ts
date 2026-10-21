import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry } from "./extHostDocuments.ts";
import { createSetLanguageConfiguration } from "./extHostLanguageConfiguration.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";
import { IndentAction, Position, Range, SyntaxTokenType, Uri } from "./vscodeTypes.ts";

function setup() {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const setLanguageConfiguration = createSetLanguageConfiguration({
        rpc: stub.rpc,
        registry,
    } as unknown as IVscodeHostContext);
    const sent = () => stub.notifies.filter((n) => n.method.startsWith("languages."));
    return { stub, registry, setLanguageConfiguration, sent };
}

describe("languages.setLanguageConfiguration", () => {
    it("exists in the namespace and returns a Disposable", () => {
        const stub = makeStubRpc();
        const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
        const disposable = namespace.languages.setLanguageConfiguration("go", { wordPattern: /\w+/g });
        expect(() => {
            disposable.dispose();
        }).not.toThrow();
    });

    it("sections the core supports go to the host as a layer in configuration file format", () => {
        const { setLanguageConfiguration, sent } = setup();
        setLanguageConfiguration("go", {
            comments: { lineComment: "//", blockComment: ["/*", "*/"] },
            brackets: [
                ["{", "}"],
                ["(", ")"],
            ],
            autoClosingPairs: [
                { open: "{", close: "}" },
                {
                    open: '"',
                    close: '"',
                    notIn: [
                        SyntaxTokenType.String,
                        SyntaxTokenType.Comment,
                        SyntaxTokenType.RegEx,
                        SyntaxTokenType.Other,
                    ],
                },
            ],
            indentationRules: { increaseIndentPattern: /{$/, decreaseIndentPattern: /^}/ },
            onEnterRules: [{ beforeText: /^\/\//, action: { indentAction: IndentAction.None, appendText: "// " } }],
        });
        expect(sent()).toEqual([
            {
                method: "languages.setLanguageConfiguration",
                params: {
                    handle: 0,
                    languageId: "go",
                    configuration: {
                        comments: { lineComment: "//", blockComment: ["/*", "*/"] },
                        brackets: [
                            ["{", "}"],
                            ["(", ")"],
                        ],
                        autoClosingPairs: [
                            { open: "{", close: "}", notIn: [] },
                            { open: '"', close: '"', notIn: ["string", "comment"] },
                        ],
                    },
                },
            },
        ]);
    });

    it("a line comment rule is just the marker; an empty configuration is an empty layer", () => {
        const { setLanguageConfiguration, sent } = setup();
        setLanguageConfiguration("go", { comments: { lineComment: { comment: "#", noIndent: true } } });
        setLanguageConfiguration("go", {});
        // toStrictEqual: an unset section is not sent even as an `undefined` field, or it would wipe the file's section.
        expect(sent().map((n) => (n.params as { configuration: unknown }).configuration)).toStrictEqual([
            { comments: { lineComment: "#", blockComment: undefined } },
            {},
        ]);
    });

    it("dispose removes the layer by its handle; each call gets its own handle", () => {
        const { setLanguageConfiguration, sent } = setup();
        const first = setLanguageConfiguration("go", {});
        setLanguageConfiguration("go.mod", {});
        first.dispose();
        expect(sent().map((n) => [n.method, (n.params as { handle: number }).handle])).toEqual([
            ["languages.setLanguageConfiguration", 0],
            ["languages.setLanguageConfiguration", 1],
            ["languages.unsetLanguageConfiguration", 0],
        ]);
    });

    it("wordPattern becomes the language word definition for documents; dispose does not remove it (as upstream)", () => {
        const { registry, setLanguageConfiguration } = setup();
        const doc = registry.upsertFull({ uri: Uri.file("/a.go").toString(), languageId: "go", text: "foo.bar-baz" });
        const other = registry.upsertFull({
            uri: Uri.file("/a.txt").toString(),
            languageId: "plaintext",
            text: "foo.bar-baz",
        });
        expect(doc.getWordRangeAtPosition(new Position(0, 5))).toEqual(new Range(0, 4, 0, 7));

        const disposable = setLanguageConfiguration("go", { wordPattern: /[\w.-]+/g });
        expect(doc.getWordRangeAtPosition(new Position(0, 5))).toEqual(new Range(0, 0, 0, 11));
        expect(other.getWordRangeAtPosition(new Position(0, 5))).toEqual(new Range(0, 4, 0, 7));
        expect(doc.getWordRangeAtPosition(new Position(0, 5), /[a-z]+/)).toEqual(new Range(0, 4, 0, 7));

        disposable.dispose();
        expect(doc.getWordRangeAtPosition(new Position(0, 5))).toEqual(new Range(0, 0, 0, 11));

        setLanguageConfiguration("go", {});
        expect(doc.getWordRangeAtPosition(new Position(0, 5))).toEqual(new Range(0, 4, 0, 7));
    });

    it("a wordPattern matching the empty string throws as upstream; nothing goes to the host", () => {
        const { setLanguageConfiguration, sent } = setup();
        expect(() => setLanguageConfiguration("go", { wordPattern: /\w*/g })).toThrow(
            "Invalid language configuration: wordPattern '/\\w*/g' is not allowed to match the empty string.",
        );
        expect(sent()).toEqual([]);
    });
});
