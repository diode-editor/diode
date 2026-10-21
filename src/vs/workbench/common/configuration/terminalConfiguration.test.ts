import { describe, expect, it } from "vitest";

import { terminalConfiguration } from "./terminalConfiguration.ts";

describe("terminalConfiguration", () => {
    it("keyboard.platform: auto by default and exactly three keyboard OSes", () => {
        expect(terminalConfiguration.properties["keyboard.platform"]).toMatchObject({
            type: "string",
            default: "auto",
            enum: ["auto", "mac", "linux", "windows"],
        });
    });
});
