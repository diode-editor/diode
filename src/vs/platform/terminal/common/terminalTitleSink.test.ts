import { describe, expect, it } from "vitest";

import { terminalTitleSequence } from "./terminalTitleSink.ts";

describe("terminalTitleSequence", () => {
    it("OSC 0 с BEL-терминатором", () => {
        expect(terminalTitleSequence("app - Diode")).toBe("\x1b]0;app - Diode\x07");
    });

    it("управляющие символы в заголовке заменяются пробелом — последовательность не рвётся", () => {
        expect(terminalTitleSequence("a\x07b\x1bc\nd\x7f")).toBe("\x1b]0;a b c d \x07");
    });
});
