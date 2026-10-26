import { describe, expect, it } from "vitest";

import { parseWireLanguageStatusItem } from "./hostWireParsers.ts";

describe("parseWireLanguageStatusItem", () => {
    const minimal = { handle: 1, id: "acme.ruff/server", selector: [] };

    it("a minimal envelope gets the defaults", () => {
        expect(parseWireLanguageStatusItem(minimal)).toEqual({
            handle: 1,
            id: "acme.ruff/server",
            source: "",
            selector: [],
            text: "",
            severity: 0,
            busy: false,
        });
    });

    it("parses a full envelope", () => {
        expect(
            parseWireLanguageStatusItem({
                ...minimal,
                source: "acme.ruff",
                selector: [{ language: "python", scheme: "file" }, "junk", { pattern: "**/*.py" }],
                name: "Ruff",
                text: "$(check) Ruff",
                detail: "Native server",
                severity: 2,
                busy: true,
                command: { command: "ruff.restart", title: "Restart", arguments: [1] },
            }),
        ).toEqual({
            handle: 1,
            id: "acme.ruff/server",
            source: "acme.ruff",
            selector: [{ language: "python", scheme: "file" }, { pattern: "**/*.py" }],
            name: "Ruff",
            text: "$(check) Ruff",
            detail: "Native server",
            severity: 2,
            busy: true,
            command: { command: "ruff.restart", title: "Restart", arguments: [1] },
        });
    });

    it("Warning is kept, an unknown severity is Information, only `true` is busy", () => {
        expect(parseWireLanguageStatusItem({ ...minimal, severity: 1 })?.severity).toBe(1);
        expect(parseWireLanguageStatusItem({ ...minimal, severity: 3 })?.severity).toBe(0);
        expect(parseWireLanguageStatusItem({ ...minimal, severity: "2" })?.severity).toBe(0);
        expect(parseWireLanguageStatusItem({ ...minimal, busy: "yes" })?.busy).toBe(false);
    });

    it("drops fields of a foreign type and an empty detail", () => {
        const parsed = parseWireLanguageStatusItem({
            ...minimal,
            source: 5,
            name: 1,
            text: null,
            detail: "",
        });
        expect(parsed).toEqual({ ...minimal, source: "", text: "", severity: 0, busy: false });
    });

    it("a command without a string id is dropped; a missing title is empty, non-array arguments are dropped", () => {
        expect(parseWireLanguageStatusItem({ ...minimal, command: { title: "Restart" } })).not.toHaveProperty(
            "command",
        );
        expect(parseWireLanguageStatusItem({ ...minimal, command: { command: "", title: "x" } })).not.toHaveProperty(
            "command",
        );
        expect(parseWireLanguageStatusItem({ ...minimal, command: "ruff.restart" })).not.toHaveProperty("command");
        expect(parseWireLanguageStatusItem({ ...minimal, command: null })).not.toHaveProperty("command");
        expect(
            parseWireLanguageStatusItem({ ...minimal, command: { command: "ruff.restart", arguments: "a" } })?.command,
        ).toEqual({ command: "ruff.restart", title: "" });
    });

    it("rejects an envelope without a handle, an id or a selector array", () => {
        expect(parseWireLanguageStatusItem(null)).toBeNull();
        expect(parseWireLanguageStatusItem("x")).toBeNull();
        expect(parseWireLanguageStatusItem({ ...minimal, handle: 1.5 })).toBeNull();
        expect(parseWireLanguageStatusItem({ ...minimal, id: 7 })).toBeNull();
        expect(parseWireLanguageStatusItem({ ...minimal, selector: "python" })).toBeNull();
    });
});
