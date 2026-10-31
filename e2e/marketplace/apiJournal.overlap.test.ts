import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startApiJournal } from "./apiJournal.ts";

/**
 * vitest does not abort a test on timeout: it marks it red and starts the next one, while the body of
 * the timed-out check keeps running. So `keep` and `stop` of a late check run during the next check.
 */
describe("marketplace API journal: a check that outlives its timeout", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "diode-api-journal-"));
    });

    afterEach(() => {
        delete process.env.DIODE_API_TRACE;
        rmSync(dir, { recursive: true, force: true });
    });

    it("the late stop of a timed-out check does not switch off the journal of the next check", () => {
        const timedOut = startApiJournal("pub.slow", dir);
        const next = startApiJournal("pub.next", dir);
        const nextPath = process.env.DIODE_API_TRACE;

        timedOut.stop();

        expect(process.env.DIODE_API_TRACE).toBe(nextPath);
        next.stop();
    });

    it("a check already replaced by the next one is red and hands over no journal", () => {
        const timedOut = startApiJournal("pub.slow", dir);
        writeFileSync(process.env.DIODE_API_TRACE ?? "", "row of a red check\n");
        const next = startApiJournal("pub.next", dir);

        timedOut.keep();

        expect(existsSync(join(dir, "pub.slow.jsonl"))).toBe(false);
        next.stop();
    });
});
