import { describe, expect, it } from "vitest";

import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { gotoLineAction, quickOpenAction, showAllEditorsAction, showCommandsAction } from "./quickOpenActions.ts";
import type { QuickOpenService } from "./quickOpenService.ts";
import { QuickOpenServiceDIToken } from "./quickOpenService.ts";

/**
 * Аксессор с QuickOpenService-заглушкой, записывающей запрос показа. Составление
 * запроса (префикс провайдера + args) — зона этих экшенов; то, что show(запрос)
 * префиллит строку ввода и фильтрует список, закрывают тесты QuickOpenService,
 * сквозной путь из keybindings.json — e2e-сценарий quick-open-prefill.
 */
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

describe("quick open actions — аргумент-префилл", () => {
    it("quickOpen без аргумента открывается пустым", () => {
        const { accessor, shown } = makeAccessor();
        quickOpenAction.run(accessor);
        expect(shown).toEqual([""]);
    });

    it("quickOpen: строковый аргумент — запрос целиком (работают и префиксы «>», «:»)", () => {
        const { accessor, shown } = makeAccessor();
        quickOpenAction.run(accessor, "src/main");
        quickOpenAction.run(accessor, ">git");
        expect(shown).toEqual(["src/main", ">git"]);
    });

    it("не-строковый аргумент игнорируется (как в VS Code)", () => {
        const { accessor, shown } = makeAccessor();
        quickOpenAction.run(accessor, { text: "src/" });
        quickOpenAction.run(accessor, 42);
        expect(shown).toEqual(["", ""]);
    });

    it("gotoLine: аргумент дописывается после префикса «:»", () => {
        const { accessor, shown } = makeAccessor();
        gotoLineAction.run(accessor);
        gotoLineAction.run(accessor, "12:3");
        expect(shown).toEqual([":", ":12:3"]);
    });

    it("showCommands: аргумент дописывается после префикса «>»", () => {
        const { accessor, shown } = makeAccessor();
        showCommandsAction.run(accessor);
        showCommandsAction.run(accessor, "git");
        expect(shown).toEqual([">", ">git"]);
    });

    it("showAllEditors: аргумент дописывается после префикса «edt »", () => {
        const { accessor, shown } = makeAccessor();
        showAllEditorsAction.run(accessor);
        showAllEditorsAction.run(accessor, "index");
        expect(shown).toEqual(["edt ", "edt index"]);
    });
});

describe("quick open actions — кейбинды палитры и пикера редакторов", () => {
    it("Ctrl+K Ctrl+P открывает пикер открытых редакторов (как в VS Code), без tier-условия", () => {
        expect(showAllEditorsAction.keybinding).toEqual(parseChord("ctrl+k ctrl+p"));
        expect(showAllEditorsAction.keybindings).toBeUndefined();
    });

    it("палитре на legacy-терминале достался F1 — аккорд Ctrl+K Ctrl+P теперь занят пикером", () => {
        expect(showCommandsAction.keybinding).toEqual(parseKeybinding("mod+shift+p"));
        expect(showCommandsAction.keybindings).toEqual([{ keys: parseKeybinding("f1"), when: "tier == 'legacy'" }]);
    });
});
