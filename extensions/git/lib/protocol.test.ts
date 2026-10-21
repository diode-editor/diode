import { describe, expect, it } from "vitest";

import { GIT_OP_COMMAND as CORE_GIT_OP_COMMAND } from "../../../src/vs/workbench/contrib/scm/common/gitProtocol.ts";

import { GIT_OP_COMMAND } from "./protocol.ts";

// No shared imports across the process boundary: the test keeps the mirrors in lockstep.
describe("git op protocol", () => {
    it("dispatcher command name matches the core mirror", () => {
        expect(GIT_OP_COMMAND).toBe(CORE_GIT_OP_COMMAND);
    });
});
