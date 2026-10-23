import { describe, expect, it } from "vitest";

import {
    type IRegistryExtensionMeta,
    REGISTRY_SCHEMA_VERSION,
} from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

import type { IExtensionPageContent } from "./extensionPageContent.ts";
import {
    buildExtensionBodyLines,
    buildExtensionHeaderLines,
    PARTIAL_SUPPORT_HEADLINE,
    statusLine,
    wrapText,
} from "./extensionPageContent.ts";

function entry(overrides: Partial<IExtensionListEntry> = {}): IExtensionListEntry {
    return {
        id: "acme.tools",
        publisher: "acme",
        name: "tools",
        displayName: "Acme Tools",
        description: "Tools for acme",
        kind: "native",
        support: undefined,
        latestVersion: "1.0.0",
        installedVersion: null,
        availability: "available",
        pinned: false,
        needsReload: false,
        ...overrides,
    };
}

function meta(overrides: Partial<IRegistryExtensionMeta> = {}): IRegistryExtensionMeta {
    return {
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        id: "acme.tools",
        publisher: "acme",
        name: "tools",
        displayName: "Acme Tools",
        description: "Tools for acme",
        kind: "native",
        support: undefined,
        versions: [
            {
                version: "1.0.0",
                engines: { vscode: "^1.90.0" },
                artifact: { type: "url", url: "https://example.test/a.vsix" },
                sha256: "a".repeat(64),
            },
        ],
        ...overrides,
    };
}

function texts(lines: readonly { text: string }[]): string[] {
    return lines.map((l) => l.text);
}

describe("wrapText", () => {
    it("wraps at words without breaking them", () => {
        expect(wrapText("alpha beta gamma delta", 12)).toEqual(["alpha beta", "gamma delta"]);
    });

    it("keeps empty lines — in markdown they are paragraph boundaries", () => {
        expect(wrapText("one\n\ntwo", 20)).toEqual(["one", "", "two"]);
    });

    it("hard-breaks a word longer than the width", () => {
        expect(wrapText("aaaaaaaaaaaa", 8)).toEqual(["aaaaaaaa", "aaaa"]);
    });

    it("a long word mid-paragraph does not swallow its neighbors", () => {
        expect(wrapText("hi aaaaaaaaaaaa bye", 8)).toEqual(["hi", "aaaaaaaa", "aaaa bye"]);
    });

    it("collapses double spaces and trims trailing ones", () => {
        expect(wrapText("alpha  beta   ", 20)).toEqual(["alpha beta"]);
    });

    it("trailing spaces do not count toward the width — the line does not break because of them", () => {
        // Exactly at the limit plus two spaces: trimming the tail must remove both.
        expect(wrapText("alpha beta  ", 10)).toEqual(["alpha beta"]);
    });

    it("a whitespace-only paragraph yields an empty line, not spaces", () => {
        expect(wrapText("one\n   \ntwo", 20)).toEqual(["one", "", "two"]);
    });

    it("zero width does not loop — wraps at the minimum", () => {
        expect(wrapText("abcdefghijkl", 0)).toEqual(["abcdefgh", "ijkl"]);
    });

    it("a line exactly as wide as the width does not wrap", () => {
        expect(wrapText("alpha beta", 10)).toEqual(["alpha beta"]);
    });

    it("the space between words counts toward the width — one column longer already wraps", () => {
        // 6 + 1 + 4 = 11 > 10: without counting the space the line would overflow.
        expect(wrapText("alphas beta", 10)).toEqual(["alphas", "beta"]);
    });
});

describe("statusLine", () => {
    it("available", () => {
        expect(statusLine(entry())).toBe("Not installed");
    });

    it("installed — with the version", () => {
        expect(statusLine(entry({ availability: "installed", installedVersion: "1.0.0" }))).toBe("Installed 1.0.0");
    });

    it("outdated — both versions", () => {
        expect(statusLine(entry({ availability: "outdated", installedVersion: "0.9.0" }))).toBe(
            "Installed 0.9.0 · update available: 1.0.0",
        );
    });

    it("incompatible", () => {
        expect(statusLine(entry({ availability: "incompatible" }))).toBe("Incompatible with this build of Diode");
    });
});

describe("buildExtensionHeaderLines", () => {
    it("the header carries identity, status, version, requirements and entry kind", () => {
        const lines = buildExtensionHeaderLines(
            { entry: entry(), meta: meta(), metaError: null, operationError: null },
            60,
        );
        // Whole, with tone: color is part of the meaning, and a text-only assert would miss a recolor.
        expect(lines.slice(0, 9)).toEqual([
            { text: "Acme Tools", tone: "normal" },
            { text: "acme.tools", tone: "dim" },
            { text: "Tools for acme", tone: "normal" },
            { text: "", tone: "normal" },
            { text: "Not installed", tone: "dim" },
            { text: "Latest version: 1.0.0", tone: "dim" },
            { text: "Requires: vscode ^1.90.0", tone: "dim" },
            { text: "Kind: native", tone: "dim" },
            { text: "", tone: "normal" },
        ]);
    });

    it("requirements of both channels go on one line", () => {
        const lines = buildExtensionHeaderLines(
            {
                entry: entry(),
                meta: meta({
                    versions: [
                        {
                            version: "1.0.0",
                            engines: { diode: "^1.2.0", vscode: "^1.90.0" },
                            artifact: { type: "url", url: "https://example.test/a.vsix" },
                            sha256: "a".repeat(64),
                        },
                    ],
                }),
                metaError: null,
                operationError: null,
            },
            60,
        );
        expect(texts(lines)).toContain("Requires: diode ^1.2.0, vscode ^1.90.0");
    });

    it("a diode-only requirement has no vscode tail", () => {
        const lines = buildExtensionHeaderLines(
            {
                entry: entry(),
                meta: meta({
                    versions: [
                        {
                            version: "1.0.0",
                            engines: { diode: "^0.3.0" },
                            artifact: { type: "url", url: "https://example.test/a.vsix" },
                            sha256: "a".repeat(64),
                        },
                    ],
                }),
                metaError: null,
                operationError: null,
            },
            60,
        );
        expect(texts(lines)).toContain("Requires: diode ^0.3.0");
    });

    it("no version in the metadata — no requirements line either", () => {
        const lines = buildExtensionHeaderLines(
            { entry: entry({ latestVersion: "9.9.9" }), meta: meta(), metaError: null, operationError: null },
            60,
        );
        expect(texts(lines).some((t) => t.startsWith("Requires:"))).toBe(false);
    });

    it("links and license are shown when present in the metadata", () => {
        const lines = buildExtensionHeaderLines(
            {
                entry: entry(),
                meta: meta({
                    license: "MIT",
                    repository: "https://github.com/acme/tools",
                    homepage: "https://acme.test",
                }),
                metaError: null,
                operationError: null,
            },
            60,
        );
        expect(lines).toEqual(
            expect.arrayContaining([
                { text: "License: MIT", tone: "dim" },
                { text: "Repository: https://github.com/acme/tools", tone: "dim" },
                { text: "Homepage: https://acme.test", tone: "dim" },
            ]),
        );
    });

    it("no registry entry — neither license nor links: nowhere to take them from", () => {
        const lines = buildExtensionHeaderLines(
            {
                entry: entry({
                    latestVersion: null,
                    installedVersion: "0.1.0",
                    availability: "installed",
                    kind: undefined,
                    support: undefined,
                }),
                meta: undefined,
                metaError: null,
                operationError: null,
            },
            60,
        );
        expect(texts(lines)).toEqual(["Acme Tools", "acme.tools", "Tools for acme", "", "Installed 0.1.0", ""]);
    });

    it("an operation error is a warning in the header — next to the buttons that caused it", () => {
        const lines = buildExtensionHeaderLines(
            { entry: entry(), meta: meta(), metaError: null, operationError: "sha256 mismatch" },
            60,
        );
        expect(lines.at(-2)).toEqual({ text: "sha256 mismatch", tone: "warning" });
        // The header ends with a blank spacer line before the button row.
        expect(lines.at(-1)).toEqual({ text: "", tone: "normal" });
    });

    it("incompatibility is highlighted, not hidden in a dimmed line", () => {
        const lines = buildExtensionHeaderLines(
            { entry: entry({ availability: "incompatible" }), meta: meta(), metaError: null, operationError: null },
            60,
        );
        expect(lines.find((l) => l.text.startsWith("Incompatible"))?.tone).toBe("warning");
    });

    it("an empty description yields no empty line in the header", () => {
        const lines = buildExtensionHeaderLines(
            { entry: entry({ description: "" }), meta: meta(), metaError: null, operationError: null },
            60,
        );
        // Exactly one blank line between identity and status: an extra one
        // would mean the description was printed after all, empty.
        expect(texts(lines).slice(0, 4)).toEqual(["Acme Tools", "acme.tools", "", "Not installed"]);
    });

    it("the readme does not go into the header — it lives in the scrollable body", () => {
        const lines = buildExtensionHeaderLines(
            { entry: entry(), meta: meta({ readme: "Readme body" }), metaError: null, operationError: null },
            60,
        );
        expect(texts(lines)).not.toContain("Readme body");
    });
});

describe("buildExtensionBodyLines", () => {
    it("the readme wraps to the width in the normal tone — it is content", () => {
        const lines = buildExtensionBodyLines(
            {
                entry: entry(),
                meta: meta({ readme: "# Acme\n\nalpha beta gamma delta" }),
                metaError: null,
                operationError: null,
            },
            12,
        );
        expect(lines).toEqual([
            { text: "# Acme", tone: "normal" },
            { text: "", tone: "normal" },
            { text: "alpha beta", tone: "normal" },
            { text: "gamma delta", tone: "normal" },
        ]);
    });

    it("no readme — says so in a dimmed line", () => {
        const lines = buildExtensionBodyLines(
            { entry: entry(), meta: meta(), metaError: null, operationError: null },
            60,
        );
        expect(lines).toEqual([{ text: "No readme published for this extension.", tone: "dim" }]);
    });

    it("no registry entry — the body states where the extension comes from", () => {
        const lines = buildExtensionBodyLines(
            {
                entry: entry({ latestVersion: null, installedVersion: "0.1.0", availability: "installed" }),
                meta: undefined,
                metaError: null,
                operationError: null,
            },
            100,
        );
        expect(lines).toEqual([
            {
                text: "This extension is not in the marketplace — it was installed from a file.",
                tone: "dim",
            },
        ]);
    });

    it("a metadata network failure replaces the readme and is colored as a warning", () => {
        const lines = buildExtensionBodyLines(
            { entry: entry(), meta: undefined, metaError: "fetch failed (ENOTFOUND)", operationError: null },
            100,
        );
        expect(lines).toEqual([
            {
                text: "Cannot read this extension from the registry: fetch failed (ENOTFOUND)",
                tone: "warning",
            },
        ]);
    });

    it("a metadata failure overrides even received metadata — showing a half-truth is worse than the reason", () => {
        const lines = buildExtensionBodyLines(
            { entry: entry(), meta: meta({ readme: "Readme body" }), metaError: "boom", operationError: null },
            100,
        );
        expect(texts(lines)).not.toContain("Readme body");
    });
});

describe("page of a partially supported extension", () => {
    const content = (o: Partial<IExtensionPageContent> = {}): IExtensionPageContent => ({
        entry: entry(),
        meta: meta(),
        metaError: null,
        operationError: null,
        ...o,
    });

    const support = {
        level: "partial",
        works: ["Inline completions", "Commands"],
        limits: ["Chat panel needs a webview", "Sign-in opens a browser"],
    } as const;

    it("the header warns in one line", () => {
        const lines = buildExtensionHeaderLines(content({ entry: entry({ support }) }), 80);
        // Text as a literal, not via the constant: otherwise the assert moves together
        // with it, and a changed string goes unnoticed.
        const warning = lines.find((l) => l.text === "Partial support: some features do not work in Diode");
        expect(warning?.tone).toBe("warning");
        expect(PARTIAL_SUPPORT_HEADLINE).toBe("Partial support: some features do not work in Diode");
    });

    it("the body does not repeat the header title", () => {
        const lines = buildExtensionBodyLines(content({ entry: entry({ support }) }), 80);
        expect(lines.map((l) => l.text)).not.toContain(PARTIAL_SUPPORT_HEADLINE);
    });

    it("the body lists what works and what does not — before the readme", () => {
        const lines = buildExtensionBodyLines(
            content({ entry: entry({ support }), meta: meta({ readme: "# Readme body" }) }),
            80,
        );
        const texts = lines.map((l) => l.text);
        expect(texts).toContain("Works in Diode:");
        expect(texts).toContain("- Inline completions");
        expect(texts).toContain("Does not work:");
        expect(texts).toContain("- Chat panel needs a webview");
        expect(texts.indexOf("- Chat panel needs a webview")).toBeLessThan(texts.indexOf("# Readme body"));
    });

    it("limitations are visible even when the metadata cannot be read", () => {
        const lines = buildExtensionBodyLines(
            content({ entry: entry({ support }), meta: undefined, metaError: "network is down" }),
            80,
        );
        const texts = lines.map((l) => l.text);
        expect(texts).toContain("- Chat panel needs a webview");
        expect(texts.some((t) => t.includes("network is down"))).toBe(true);
    });

    it("the whole block: each line's tone and the gap before the readme", () => {
        const lines = buildExtensionBodyLines(
            content({
                entry: entry({ support: { level: "partial", works: ["Ghost text"], limits: ["Chat panel"] } }),
                meta: meta({ readme: "# Readme body" }),
            }),
            80,
        );
        // Whole, with tone: the title is a reference line, "does not work" is a warning, the last
        // line is blank, otherwise the readme sticks to the list.
        expect(lines.slice(0, 5)).toEqual([
            { text: "Works in Diode:", tone: "dim" },
            { text: "- Ghost text", tone: "dim" },
            { text: "Does not work:", tone: "dim" },
            { text: "- Chat panel", tone: "warning" },
            { text: "", tone: "normal" },
        ]);
        expect(lines[5]?.text).toBe("# Readme body");
    });

    it("no list — no list heading either", () => {
        const onlyLimits = buildExtensionBodyLines(
            content({ entry: entry({ support: { level: "partial", limits: ["Chat panel"] } }) }),
            80,
        );
        expect(onlyLimits.map((l) => l.text)).not.toContain("Works in Diode:");
        expect(onlyLimits.map((l) => l.text)).toContain("Does not work:");
    });

    it("an empty list yields no heading without items", () => {
        // The registry won't publish this, but the type allows it: a
        // "Works in Diode:" title with nothing under it would read as "nothing".
        const lines = buildExtensionBodyLines(
            content({ entry: entry({ support: { level: "partial", works: [], limits: ["Chat panel"] } }) }),
            80,
        );
        const texts = lines.map((l) => l.text);
        expect(texts).not.toContain("Works in Diode:");
        expect(texts).toContain("Does not work:");
    });

    it("full support has no block", () => {
        const full = buildExtensionBodyLines(
            content({ entry: entry({ support: { level: "full" } }), meta: undefined, metaError: null }),
            80,
        );
        // The block is absent ENTIRELY, no titles and no blank spacer line: otherwise
        // the page of a fully supported extension would start with a gap.
        expect(full.map((l) => l.text)).not.toContain("Does not work:");
        expect(full.map((l) => l.text)).not.toContain("Works in Diode:");
        expect(full.every((l) => l.text !== "")).toBe(true);
        expect(
            buildExtensionHeaderLines(content({ entry: entry({ support: { level: "full" } }) }), 80).map((l) => l.text),
        ).not.toContain(PARTIAL_SUPPORT_HEADLINE);
    });
});
