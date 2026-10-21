import { describe, expect, it } from "vitest";

import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { gotoLineAction, quickOpenAction, showAllEditorsAction, showCommandsAction } from "./quickOpenActions.ts";
import type { QuickOpenService } from "./quickOpenService.ts";
import { QuickOpenServiceDIToken } from "./quickOpenService.ts";

function makeAccessor(): { accessor: ServiceAccessor; shown: string[] } {
    const shown: string[] = [];
    const stub = {
        show: (prefix = "") => {
            shown.push(prefix);
        },
    } as unknown as QuickOpenService;
    const accessor: ServiceAccessor = {
        get: (diToken) => {
            expect(diToken).toBe(QuickOpenServiceDIToken);
            return stub as never;
        },
    };
    return { accessor, shown };
}

describe("quick open actions — prefill argument", () => {
    it("quickOpen without an argument opens empty", () => {
        const { accessor, shown } = makeAccessor();
        quickOpenAction.run(accessor);
        expect(shown).toEqual([""]);
    });

    it("quickOpen: a string argument is the whole query (the `>` and `:` prefixes work too)", () => {
        const { accessor, shown } = makeAccessor();
        quickOpenAction.run(accessor, "src/main");
        quickOpenAction.run(accessor, ">git");
        expect(shown).toEqual(["src/main", ">git"]);
    });

    it("a non-string argument is ignored (as in VS Code)", () => {
        const { accessor, shown } = makeAccessor();
        quickOpenAction.run(accessor, { text: "src/" });
        quickOpenAction.run(accessor, 42);
        expect(shown).toEqual(["", ""]);
    });

    it("gotoLine: the argument is appended after the `:` prefix", () => {
        const { accessor, shown } = makeAccessor();
        gotoLineAction.run(accessor);
        gotoLineAction.run(accessor, "12:3");
        expect(shown).toEqual([":", ":12:3"]);
    });

    it("showCommands: the argument is appended after the `>` prefix", () => {
        const { accessor, shown } = makeAccessor();
        showCommandsAction.run(accessor);
        showCommandsAction.run(accessor, "git");
        expect(shown).toEqual([">", ">git"]);
    });

    it("showAllEditors: the argument is appended after the `edt ` prefix", () => {
        const { accessor, shown } = makeAccessor();
        showAllEditorsAction.run(accessor);
        showAllEditorsAction.run(accessor, "index");
        expect(shown).toEqual(["edt ", "edt index"]);
    });
});

describe("quick open actions — keybindings of the palette and the editors picker", () => {
    it("Ctrl+K Ctrl+P opens the open editors picker (as in VS Code), with no tier condition", () => {
        expect(showAllEditorsAction.keybinding).toEqual(parseChord("ctrl+k ctrl+p"));
        expect(showAllEditorsAction.keybindings).toBeUndefined();
    });

    it("the palette gets F1 (the Ctrl+K Ctrl+P chord belongs to the picker), and it is UNCONDITIONAL", () => {
        expect(showCommandsAction.keybinding).toEqual(parseKeybinding("mod+shift+p"));
        // No tier condition on purpose: under `tier == 'legacy'` F1 vanished exactly where
        // it's needed (tmux raises the tier but doesn't deliver extended keys) —
        // the editor was left with no palette at all.
        expect(showCommandsAction.keybindings).toEqual([parseKeybinding("f1")]);
    });
});
