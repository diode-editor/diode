import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";

import { type ILanguageStatus, LanguageStatusService } from "./languageStatusService.ts";

const PY = Uri.file("/work/main.py");

function status(id: string, overrides: Partial<ILanguageStatus> = {}): ILanguageStatus {
    return {
        id,
        name: undefined,
        selector: { language: "python" },
        severity: 0,
        label: id,
        detail: "",
        busy: false,
        source: "ext",
        command: undefined,
        ...overrides,
    };
}

function ids(service: LanguageStatusService, uri = PY, languageId = "python"): string[] {
    return service.getLanguageStatus(uri, languageId).map((s) => s.id);
}

describe("LanguageStatusService", () => {
    it("returns only the items whose selector matches the document", () => {
        const service = new LanguageStatusService();
        service.addStatus(status("py"));
        service.addStatus(status("toml", { selector: "toml" }));
        service.addStatus(status("all", { selector: "*" }));
        service.addStatus(status("untitled", { selector: { scheme: "untitled" } }));

        expect(ids(service)).toEqual(["all", "py"]);
        expect(ids(service, Uri.file("/work/pyproject.toml"), "toml")).toEqual(["all", "toml"]);
    });

    it("orders by severity descending, then source, then id", () => {
        const service = new LanguageStatusService();
        service.addStatus(status("b", { source: "z.ext" }));
        service.addStatus(status("a", { source: "z.ext" }));
        service.addStatus(status("c", { source: "a.ext" }));
        service.addStatus(status("warn", { source: "z.ext", severity: 1 }));
        service.addStatus(status("error", { source: "z.ext", severity: 2 }));

        expect(ids(service)).toEqual(["error", "warn", "c", "a", "b"]);
    });

    // Both insertion orders: a comparator that answers "first" for equal or reversed keys gets one of them wrong.
    it.each([
        ["ascending", ["a", "b", "c"]],
        ["descending", ["c", "b", "a"]],
    ])("the order does not depend on insertion (%s)", (_name, order) => {
        const bySource = new LanguageStatusService();
        // Ids sort the other way: a source comparison that falls through to the id shows up.
        const idOf: Record<string, string> = { a: "z", b: "y", c: "x" };
        for (const key of order) bySource.addStatus(status(idOf[key] ?? key, { source: key }));
        expect(ids(bySource)).toEqual(["z", "y", "x"]);

        const byId = new LanguageStatusService();
        for (const key of order) byId.addStatus(status(key, { source: "same" }));
        expect(ids(byId)).toEqual(["a", "b", "c"]);
    });

    it("fires on add and on remove; a second dispose changes nothing", () => {
        const service = new LanguageStatusService();
        let changes = 0;
        service.onDidChange(() => {
            changes += 1;
        });
        const added = service.addStatus(status("py"));
        expect(changes).toBe(1);
        added.dispose();
        added.dispose();
        expect(changes).toBe(2);
        expect(ids(service)).toEqual([]);
    });

    it("dispose stops the change events", () => {
        const service = new LanguageStatusService();
        let changes = 0;
        service.onDidChange(() => {
            changes += 1;
        });
        service.dispose();
        service.addStatus(status("py"));
        expect(changes).toBe(0);
    });
});
