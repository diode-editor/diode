import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startApiJournal } from "./apiJournal.ts";

describe("marketplace API journal", () => {
    let dir: string;
    const kept = (): string => join(dir, "pub.a.jsonl");

    /** What the app of a check does: appends to the file named by the variable. */
    const appWrites = (text: string): void => {
        writeFileSync(process.env.DIODE_API_TRACE ?? "", text);
    };

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "diode-api-journal-"));
    });

    afterEach(() => {
        delete process.env.DIODE_API_TRACE;
        rmSync(dir, { recursive: true, force: true });
    });

    it("a green check keeps its journal and clears the variable", () => {
        const journal = startApiJournal("pub.a", dir);
        appWrites("row\n");
        journal.keep();
        journal.stop();
        expect(readFileSync(kept(), "utf8")).toBe("row\n");
        expect(process.env.DIODE_API_TRACE).toBeUndefined();
    });

    it("a red check leaves nothing, not even the journal of an earlier green run", () => {
        writeFileSync(kept(), "old\n");
        const journal = startApiJournal("pub.a", dir);
        appWrites("row\n");
        journal.stop();
        expect(existsSync(kept())).toBe(false);
        expect(existsSync(join(dir, "pub.a.pending"))).toBe(false);
    });

    it("a green check of a declarative extension has no journal and stays green", () => {
        const journal = startApiJournal("pub.a", dir);
        expect(() => {
            journal.keep();
        }).not.toThrow();
        journal.stop();
        expect(existsSync(kept())).toBe(false);
    });
});
