import { describe, expect, it } from "vitest";

import { parseWireEnvInitialize, parseWireEnvLogLevel } from "./envWire.ts";

describe("parseWireEnvInitialize", () => {
    it("takes the fields as sent", () => {
        expect(parseWireEnvInitialize({ machineId: "m", shell: "/bin/sh", appRoot: "/r", logLevel: 1 })).toEqual({
            machineId: "m",
            shell: "/bin/sh",
            appRoot: "/r",
            logLevel: 1,
        });
    });

    it("garbage becomes empty strings and upstream's default level Info", () => {
        expect(parseWireEnvInitialize(null)).toEqual({ machineId: "", shell: "", appRoot: "", logLevel: 3 });
        expect(parseWireEnvInitialize({ machineId: 1, shell: {}, appRoot: [], logLevel: "trace" })).toEqual({
            machineId: "",
            shell: "",
            appRoot: "",
            logLevel: 3,
        });
    });
});

describe("parseWireEnvLogLevel", () => {
    it("every API level, bounds included, passes", () => {
        expect([0, 1, 2, 3, 4, 5].map((logLevel) => parseWireEnvLogLevel({ logLevel }).logLevel)).toEqual([
            0, 1, 2, 3, 4, 5,
        ]);
    });

    it("outside the API's range, a fraction, a non-number or no object — Info", () => {
        for (const raw of [{ logLevel: -1 }, { logLevel: 6 }, { logLevel: 1.5 }, { logLevel: "1" }, {}, null, 7]) {
            expect(parseWireEnvLogLevel(raw)).toEqual({ logLevel: 3 });
        }
    });
});
