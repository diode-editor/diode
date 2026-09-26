import { describe, expect, it } from "vitest";

import { terminalConfiguration } from "./terminalConfiguration.ts";

describe("terminalConfiguration", () => {
    it("keyboard.platform: auto по умолчанию и ровно три ОС клавиатуры", () => {
        expect(terminalConfiguration.properties?.["keyboard.platform"]).toMatchObject({
            type: "string",
            default: "auto",
            enum: ["auto", "mac", "linux", "windows"],
        });
    });
});
