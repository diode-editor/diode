import { describe, expect, it } from "vitest";

import type { IDocumentLanguageChange } from "./iDocumentLanguageChange.ts";
import { TextDocument } from "./textDocument.ts";

describe("TextDocument — language", () => {
    it("language defaults to plaintext", () => {
        const doc = new TextDocument("hello");
        expect(doc.languageId).toBe("plaintext");
    });

    it("accepts language in the constructor", () => {
        const doc = new TextDocument("const x = 1;", "typescript");
        expect(doc.languageId).toBe("typescript");
    });

    it("setLanguage changes language and fires an event with old and new id", () => {
        const doc = new TextDocument("", "plaintext");
        const changes: IDocumentLanguageChange[] = [];
        doc.onDidChangeLanguage((change) => changes.push(change));

        doc.setLanguage("markdown");

        expect(doc.languageId).toBe("markdown");
        expect(changes).toEqual([{ oldLanguageId: "plaintext", newLanguageId: "markdown" }]);
    });

    it("setLanguage with the same id is a no-op without an event", () => {
        const doc = new TextDocument("", "markdown");
        let fired = 0;
        doc.onDidChangeLanguage(() => fired++);

        doc.setLanguage("markdown");

        expect(fired).toBe(0);
        expect(doc.languageId).toBe("markdown");
    });

    it("setLanguage does not change versionId (document does not become dirty)", () => {
        const doc = new TextDocument("text");
        const before = doc.versionId;
        doc.setLanguage("python");
        expect(doc.versionId).toBe(before);
    });

    it("disposing the subscription stops delivery, second dispose is a no-op", () => {
        const doc = new TextDocument("");
        let fired = 0;
        const subscription = doc.onDidChangeLanguage(() => fired++);
        const other = doc.onDidChangeLanguage(() => undefined);

        doc.setLanguage("json");
        subscription.dispose();
        subscription.dispose();
        doc.setLanguage("yaml");

        expect(fired).toBe(1);
        other.dispose();
    });
});
