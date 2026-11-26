import { describe, expect, it } from "vitest";

import { serializeHoverContents } from "./extHostTypeConverters.ts";
import { MarkdownString } from "./vscodeTypes.ts";

describe("serializeHoverContents — escaped theme icons", () => {
    it("[api:MarkdownString.supportThemeIcons] with the flag the escape's own backslash goes, in both paren forms", () => {
        const md = new MarkdownString("\\\\$(zap) and \\\\$\\(sync~spin\\)", true);

        expect(serializeHoverContents(md)).toEqual(["$(zap) and $\\(sync~spin\\)"]);
    });

    it("without the flag a backslash before an icon is markdown the extension meant", () => {
        expect(serializeHoverContents(new MarkdownString("\\\\$(zap)"))).toEqual(["\\\\$(zap)"]);
    });

    it("with the flag only an escaped icon changes: a plain icon, a lone backslash and a non-icon stay", () => {
        const md = new MarkdownString("$(zap) \\$(zap) \\\\$(a b) \\\\$(x~)", true);

        expect(serializeHoverContents(md)).toEqual(["$(zap) \\$(zap) \\\\$(a b) \\\\$(x~)"]);
    });
});
