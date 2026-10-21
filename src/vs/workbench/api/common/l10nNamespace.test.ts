import { beforeEach, describe, expect, it } from "vitest";

import { createL10nNamespace } from "./l10nNamespace.ts";

// In beforeEach, not at module top level: a call at import time runs before Stryker
// activates the mutant in the worker, so a createL10nNamespace body mutant would falsely survive.
let l10n: ReturnType<typeof createL10nNamespace>;

describe("vscode.l10n (without a translation bundle)", () => {
    beforeEach(() => {
        l10n = createL10nNamespace();
    });
    it("t(message) returns the string as is", () => {
        expect(l10n.t("Server failed to start.")).toBe("Server failed to start.");
    });

    it("t(message, ...args) substitutes indexed placeholders", () => {
        expect(l10n.t("Hello {0}, you have {1} issues", "World", 3)).toBe("Hello World, you have 3 issues");
    });

    it("t(message, record) substitutes named placeholders", () => {
        expect(l10n.t("Hello {name}", { name: "Erich" })).toBe("Hello Erich");
    });

    it("t(options) is the object form", () => {
        expect(l10n.t({ message: "Open {0}", args: ["log"], comment: "c" })).toBe("Open log");
        expect(l10n.t({ message: "no args", comment: "c" })).toBe("no args");
    });

    it("an unknown placeholder is left untouched", () => {
        expect(l10n.t("keep {2} and {foo}", "only-zero")).toBe("keep {2} and {foo}");
    });

    it("a placeholder with no arguments at all returns the string as is without touching args", () => {
        expect(l10n.t("hello {0}")).toBe("hello {0}");
        // The options form is the only path where args is exactly undefined (rest
        // always yields an array): substitution must not touch args at all.
        expect(l10n.t({ message: "keep {0}", comment: "c" })).toBe("keep {0}");
    });

    it("an object among SEVERAL rest arguments is not the record form", () => {
        // The t(message, record) form is exactly one object as the second argument;
        // with trailing arguments it is the rest path and the object is stringified.
        expect(l10n.t("{0} {1}", { a: 1 } as unknown as string, "z")).toBe("[object Object] z");
    });

    it("null as the second argument takes the rest path, not record", () => {
        expect(l10n.t("hi {0}", null as unknown as string)).toBe("hi null");
    });

    it("falsy arguments are substituted, not skipped", () => {
        expect(l10n.t("{0} and {flag}", 0)).toBe("0 and {flag}");
        expect(l10n.t("flag={flag}", { flag: false })).toBe("flag=false");
    });

    it("bundle and uri are honestly undefined", () => {
        expect(l10n.bundle).toBeUndefined();
        expect(l10n.uri).toBeUndefined();
    });
});
