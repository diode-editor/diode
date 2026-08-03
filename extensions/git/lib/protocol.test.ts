import { describe, expect, it } from "vitest";

import { GIT_OP_COMMAND as CORE_GIT_OP_COMMAND } from "../../../src/vs/workbench/contrib/scm/common/gitProtocol.ts";

import { GIT_OP_COMMAND } from "./protocol.ts";

// Протокол дублируется по значению по обе стороны границы процесса (общих
// импортов нет) — этот тест держит зеркала в лок-степе.
describe("git op protocol", () => {
    it("имя команды диспетчера совпадает с зеркалом ядра", () => {
        expect(GIT_OP_COMMAND).toBe(CORE_GIT_OP_COMMAND);
    });
});
