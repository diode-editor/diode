import { describe, expect, it } from "vitest";

import { shouldCommandSkipShell } from "./terminalKeyRouting.ts";

const QUICK_OPEN = "workbench.action.quickOpen";
const SAVE = "workbench.action.files.save";

describe("shouldCommandSkipShell", () => {
    it("without user entries: the default skip set", () => {
        expect(shouldCommandSkipShell(QUICK_OPEN, [])).toBe(true);
        expect(shouldCommandSkipShell(SAVE, [])).toBe(false);
    });

    it("ours: notifications.focusMessage (F6) is in the default set and can be removed", () => {
        expect(shouldCommandSkipShell("notifications.focusMessage", [])).toBe(true);
        expect(shouldCommandSkipShell("notifications.focusMessage", ["-notifications.focusMessage"])).toBe(false);
    });

    it("`-<id>` removes a default, `<id>` adds a command", () => {
        expect(shouldCommandSkipShell(QUICK_OPEN, [`-${QUICK_OPEN}`])).toBe(false);
        expect(shouldCommandSkipShell(SAVE, [SAVE])).toBe(true);
    });

    it("entries apply in order: the last one wins", () => {
        expect(shouldCommandSkipShell(QUICK_OPEN, [`-${QUICK_OPEN}`, QUICK_OPEN])).toBe(true);
        expect(shouldCommandSkipShell(SAVE, [SAVE, `-${SAVE}`])).toBe(false);
    });

    it("other commands' entries and non-strings don't matter", () => {
        expect(shouldCommandSkipShell(SAVE, [42, null, "my-ext.run", `-${QUICK_OPEN}`])).toBe(false);
        expect(shouldCommandSkipShell(QUICK_OPEN, [42, null, `-${SAVE}`])).toBe(true);
    });
});
