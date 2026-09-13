import { describe, expect, it } from "vitest";

import { createL10nNamespace } from "./l10nNamespace.ts";

const l10n = createL10nNamespace();

describe("vscode.l10n (без бандла переводов)", () => {
    it("t(message) возвращает строку как есть", () => {
        expect(l10n.t("Server failed to start.")).toBe("Server failed to start.");
    });

    it("t(message, ...args) подставляет индексные плейсхолдеры", () => {
        expect(l10n.t("Hello {0}, you have {1} issues", "World", 3)).toBe("Hello World, you have 3 issues");
    });

    it("t(message, record) подставляет именованные плейсхолдеры", () => {
        expect(l10n.t("Hello {name}", { name: "Erich" })).toBe("Hello Erich");
    });

    it("t(options) — форма с объектом", () => {
        expect(l10n.t({ message: "Open {0}", args: ["log"], comment: "c" })).toBe("Open log");
        expect(l10n.t({ message: "no args", comment: "c" })).toBe("no args");
    });

    it("незнакомый плейсхолдер остаётся нетронутым", () => {
        expect(l10n.t("keep {2} and {foo}", "only-zero")).toBe("keep {2} and {foo}");
    });

    it("falsy-аргументы подставляются, а не пропускаются", () => {
        expect(l10n.t("{0} and {flag}", 0)).toBe("0 and {flag}");
        expect(l10n.t("flag={flag}", { flag: false })).toBe("flag=false");
    });

    it("bundle и uri честно undefined", () => {
        expect(l10n.bundle).toBeUndefined();
        expect(l10n.uri).toBeUndefined();
    });
});
