import { describe, expect, it } from "vitest";

import { collapsedRowLabel } from "./diffSide.ts";

describe("diffSide", () => {
    it("метка плашки склоняет line/lines", () => {
        expect(collapsedRowLabel(1)).toBe("⋯ 1 unchanged line");
        expect(collapsedRowLabel(7)).toBe("⋯ 7 unchanged lines");
    });
});
