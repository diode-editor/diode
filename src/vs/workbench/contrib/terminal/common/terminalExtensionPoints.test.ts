import { describe, expect, it } from "vitest";

import { parseTerminalProfiles } from "./terminalExtensionPoints.ts";

describe("parseTerminalProfiles — contributes.terminal.profiles", () => {
    it("keeps id, title and a string icon, stamped with the extension", () => {
        const reports: string[] = [];
        const profiles = parseTerminalProfiles(
            "ms-vscode.js-debug",
            {
                profiles: [
                    { id: "extension.js-debug.debugTerminal", title: "JavaScript Debug Terminal", icon: "$(debug)" },
                    { id: "plain", title: "", icon: { light: "a.svg", dark: "b.svg" } },
                ],
            },
            (message) => reports.push(message),
        );
        expect(profiles).toStrictEqual([
            {
                extensionIdentifier: "ms-vscode.js-debug",
                id: "extension.js-debug.debugTerminal",
                title: "JavaScript Debug Terminal",
                icon: "$(debug)",
            },
            { extensionIdentifier: "ms-vscode.js-debug", id: "plain", title: "" },
        ]);
        expect(reports).toStrictEqual([]);
    });

    it("an entry without a string id or title is reported and skipped", () => {
        const reports: string[] = [];
        const profiles = parseTerminalProfiles(
            "x.y",
            {
                profiles: [
                    null,
                    { title: "no id" },
                    { id: "", title: "empty id" },
                    { id: "no-title" },
                    { id: "ok", title: "Ok" },
                ],
            },
            (message) => reports.push(message),
        );
        expect(profiles.map((profile) => profile.id)).toStrictEqual(["ok"]);
        expect(reports).toStrictEqual(
            Array(4).fill("A terminal profile needs a string 'id' and 'title'; it is skipped."),
        );
    });

    it("no terminal contribution, or profiles that are not an array, give nothing", () => {
        const report = (): void => {
            throw new Error("nothing to report");
        };
        expect(parseTerminalProfiles("x.y", undefined, report)).toStrictEqual([]);
        expect(parseTerminalProfiles("x.y", null, report)).toStrictEqual([]);
        expect(parseTerminalProfiles("x.y", { profiles: { id: "a", title: "A" } }, report)).toStrictEqual([]);
    });
});
