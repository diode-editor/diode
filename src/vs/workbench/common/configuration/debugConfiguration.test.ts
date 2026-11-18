import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { debugConfiguration } from "./debugConfiguration.ts";

/** `src/vs`. */
const SRC = fileURLToPath(new URL("../../../", import.meta.url));

// `debugConfiguration.upstream.json` is the `properties` of upstream's `debug` node in
// `contrib/debug/browser/debug.contribution.ts` at the pinned tag (`node scripts/vscode-ref.mjs`), with the `nls`
// messages formatted and `isMacintosh` false.

interface IUpstreamSchema {
    readonly type?: string;
    readonly default?: unknown;
    readonly enum?: readonly string[];
    readonly enumDescriptions?: readonly string[];
    readonly markdownEnumDescriptions?: readonly string[];
    readonly description?: string;
    readonly markdownDescription?: string;
    readonly scope?: string;
}

const upstreamProperties = JSON.parse(
    readFileSync(new URL("debugConfiguration.upstream.json", import.meta.url), "utf8"),
) as Readonly<Record<string, IUpstreamSchema>>;
const declared: Readonly<Record<string, IUpstreamSchema>> = debugConfiguration.properties;

/** Declared for settings.json and its completion, not applied; in upstream's order. */
const UNSUPPORTED = [
    // The Debug Console is drawn in the terminal's cells, in the terminal's font, a line a row.
    "debug.console.fontSize",
    "debug.console.fontFamily",
    "debug.console.lineHeight",
    // A terminal application cannot bring its window to the front.
    "debug.focusWindowOnBreak",
    // There is no disassembly view (not planned).
    "debug.disassemblyView.showSourceCode",
];

describe("debugConfiguration against upstream's debug.contribution.ts", () => {
    it("declares every upstream key and nothing else", () => {
        expect(Object.keys(declared).sort()).toEqual(Object.keys(upstreamProperties).sort());
    });

    it.each(Object.keys(upstreamProperties))("%s: type, default, enum and descriptions verbatim", (key) => {
        const theirs = upstreamProperties[key];
        const ours = declared[key];
        // Upstream leaves out `type` of an enum: a string.
        expect(ours.type).toBe(theirs.type ?? (theirs.enum ? "string" : undefined));
        expect(ours.default).toEqual(theirs.default);
        expect(ours.enum).toEqual(theirs.enum);
        expect(ours.enumDescriptions).toEqual(theirs.enumDescriptions ?? theirs.markdownEnumDescriptions);
        expect(ours.description).toBe(theirs.description ?? theirs.markdownDescription);
        // No `scope` upstream: window.
        expect(ours.scope).toBe(theirs.scope ?? "window");
    });

    it("the code reads every key but the unsupported ones", () => {
        const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
            .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".d.ts"))
            .map((file) => join(SRC, file))
            .filter((file) => file !== fileURLToPath(new URL("debugConfiguration.ts", import.meta.url)))
            .map((file) => readFileSync(file, "utf8"));
        // `configuration.get("debug.x")`, or `config.debug.x` in a `when`.
        const read = (key: string): boolean =>
            sources.some((text) => text.includes(`"${key}"`) || text.includes(`config.${key}`));
        expect(Object.keys(upstreamProperties).filter((key) => !read(key))).toEqual(UNSUPPORTED);
    });
});
