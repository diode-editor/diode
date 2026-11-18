import { describe, expect, it } from "vitest";

import { completeSettingsSections } from "./settingsSections.ts";

const JS_TS_DEFAULTS = { implicitProjectConfig: { experimentalDecorators: false, strictNullChecks: true } };

describe("completeSettingsSections", () => {
    it("a section nobody declares becomes an empty one; declared sections pass through in order", () => {
        const html = { autoClosingTags: true };
        expect(completeSettingsSections(["html", "css", "javascript"], [html, null, false])).toEqual([html, {}, false]);
    });

    it("a missing `js/ts` gets upstream's defaults of the keys the server reads", () => {
        expect(completeSettingsSections(["js/ts"], [null])).toEqual([JS_TS_DEFAULTS]);
    });

    it("user values win over the defaults, at any depth, and the other keys stay", () => {
        const user = { implicitProjectConfig: { strictNullChecks: false }, other: 1 };
        expect(completeSettingsSections(["js/ts"], [user])).toEqual([
            { implicitProjectConfig: { experimentalDecorators: false, strictNullChecks: false }, other: 1 },
        ]);
    });

    it("a value of another shape than the default is kept as is", () => {
        expect(completeSettingsSections(["js/ts"], [{ implicitProjectConfig: "x" }])).toEqual([
            { implicitProjectConfig: "x" },
        ]);
        expect(completeSettingsSections(["js/ts"], [{ implicitProjectConfig: ["x"] }])).toEqual([
            { implicitProjectConfig: ["x"] },
        ]);
        expect(completeSettingsSections(["js/ts"], [{ implicitProjectConfig: null }])).toEqual([
            { implicitProjectConfig: null },
        ]);
    });

    it("an answer without a section name is only made non-null", () => {
        expect(completeSettingsSections([], [null, { a: 1 }])).toEqual([{}, { a: 1 }]);
    });
});
