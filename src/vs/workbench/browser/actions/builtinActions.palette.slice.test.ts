import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { WORKBENCH_ACTIONS } from "../../workbench.common.main.ts";

/**
 * With an empty query the command palette lists commands in registration order, and the
 * same order breaks ties between equal scores — so `WORKBENCH_ACTIONS` order is user-visible.
 * Regenerate the snapshot: `UPDATE_SLICE=1 npx vitest run <this file>`.
 */

const SLICE_URL = new URL("./builtinActions.palette.slice.json", import.meta.url);

describe("command palette order slice", () => {
    it("built-in commands register in upstream order", () => {
        const current = WORKBENCH_ACTIONS.map((action) => action.id);
        if (process.env.UPDATE_SLICE === "1") writeFileSync(SLICE_URL, `${JSON.stringify(current, null, 4)}\n`);
        const reference = JSON.parse(readFileSync(SLICE_URL, "utf8")) as string[];
        expect(current.length).toBeGreaterThan(100);
        expect(current).toEqual(reference);
    });
});
