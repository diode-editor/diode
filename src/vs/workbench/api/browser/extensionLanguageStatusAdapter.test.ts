import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { LanguageStatusService } from "../../services/languageStatus/common/languageStatusService.ts";
import type { IWireLanguageStatusItem } from "../common/wireTypes.ts";

import { ExtensionLanguageStatusAdapter } from "./extensionLanguageStatusAdapter.ts";

const PY = Uri.file("/work/main.py");

function item(handle: number, overrides: Partial<IWireLanguageStatusItem> = {}): IWireLanguageStatusItem {
    return {
        handle,
        id: `acme/item-${String(handle)}`,
        source: "acme",
        selector: [{ language: "python" }],
        text: "Ruff",
        severity: 0,
        busy: false,
        ...overrides,
    };
}

function make() {
    const service = new LanguageStatusService();
    const adapter = new ExtensionLanguageStatusAdapter(service);
    const current = () => service.getLanguageStatus(PY, "python");
    return { service, adapter, current };
}

describe("ExtensionLanguageStatusAdapter", () => {
    it("maps the wire item onto the service status", () => {
        const { adapter, current } = make();
        adapter.update(
            item(1, {
                name: "Ruff",
                detail: "Native server",
                severity: 1,
                busy: true,
                command: { command: "ruff.restart", title: "Restart", arguments: [1] },
            }),
        );
        expect(current()).toEqual([
            {
                id: "acme/item-1",
                name: "Ruff",
                selector: [{ language: "python" }],
                severity: 1,
                label: "Ruff",
                detail: "Native server",
                busy: true,
                source: "acme",
                command: { id: "ruff.restart", title: "Restart", arguments: [1] },
            },
        ]);
    });

    it("defaults: an empty detail, no command, a command without arguments gets an empty list", () => {
        const { adapter, current } = make();
        adapter.update(item(1));
        expect(current()[0]).toMatchObject({ detail: "", command: undefined, name: undefined });
        adapter.update(item(1, { command: { command: "ruff.show", title: "Show" } }));
        expect(current()[0]?.command).toEqual({ id: "ruff.show", title: "Show", arguments: [] });
    });

    it("an update replaces the item with the same handle, remove and clear take items away", () => {
        const { adapter, current } = make();
        adapter.update(item(1));
        adapter.update(item(2));
        adapter.update(item(1, { text: "Ruff 2" }));
        expect(current().map((s) => s.label)).toEqual(["Ruff 2", "Ruff"]);

        adapter.remove(1);
        adapter.remove(1);
        expect(current().map((s) => s.id)).toEqual(["acme/item-2"]);

        adapter.update(item(3));
        adapter.clear();
        expect(current()).toEqual([]);
    });

    it("an update fires the change once the new state is in", () => {
        const { service, adapter, current } = make();
        const seen: string[][] = [];
        service.onDidChange(() => seen.push(current().map((s) => s.label)));
        adapter.update(item(1));
        adapter.update(item(1, { text: "Ruff 2" }));
        expect(seen.at(-1)).toEqual(["Ruff 2"]);
        expect(seen.every((labels) => labels.length > 0)).toBe(true);
    });
});
