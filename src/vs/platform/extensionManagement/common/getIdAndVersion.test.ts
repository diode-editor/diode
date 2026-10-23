import { describe, expect, it } from "vitest";

import { getIdAndVersion } from "./getIdAndVersion.ts";

describe("getIdAndVersion", () => {
    it.each([
        ["acme.demo@1.0.0", ["acme.demo", "1.0.0"]],
        ["acme.demo@1.2.3-beta.1", ["acme.demo", "1.2.3-beta.1"]],
        // The last `@`: a name may contain one.
        ["acme.de@mo@2.0.0", ["acme.de@mo", "2.0.0"]],
        // The id keeps its case: the registry lookup decides about it.
        ["Acme.Demo@1.0.0", ["Acme.Demo", "1.0.0"]],
    ])("%s is an id and a version", (input, expected) => {
        expect(getIdAndVersion(input)).toEqual(expected);
    });

    it.each([
        "acme.demo",
        "acme.demo@latest",
        "acme.demo@1.0",
        "acme.demo@1.0.0.0",
        "acme.demo@v1.0.0",
        "acme.demo@",
        "demo@1.0.0",
        ".demo@1.0.0",
        "acme.@1.0.0",
    ])("%s is all id", (input) => {
        expect(getIdAndVersion(input)).toEqual([input, undefined]);
    });
});
