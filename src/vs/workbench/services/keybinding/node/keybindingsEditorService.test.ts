import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IKeybindingEntrySnapshot } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { chordsEqual, KeybindingRegistry, parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";

import { KeybindingsEditorService } from "./keybindingsEditorService.ts";

let ws: ITempWorkspace;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-kb-editor-" });
});

afterEach(() => {
    ws.dispose();
});

interface IHarness {
    registry: KeybindingRegistry;
    service: KeybindingsEditorService;
    file: string;
    /** Снапшот записи команды из реестра — «строка вкладки», над которой работает мутация. */
    entryOf(commandId: string, chordSpec?: string): IKeybindingEntrySnapshot;
    fileContent(): string;
    resolves(chordSpec: string): string | undefined;
}

function makeHarness(fileContent?: string): IHarness {
    const file = ws.path("User/keybindings.json");
    if (fileContent !== undefined) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, fileContent, "utf-8");
    }
    const registry = new KeybindingRegistry();
    const service = new KeybindingsEditorService(registry, file, NULL_LOG_SERVICE);
    return {
        registry,
        service,
        file,
        entryOf: (commandId, chordSpec) => {
            const entry = registry
                .listBindings()
                .find(
                    (candidate) =>
                        candidate.commandId === commandId &&
                        (chordSpec === undefined || chordsEqual(candidate.chord, parseChord(chordSpec))),
                );
            expect(entry, `запись ${commandId} не найдена в реестре`).toBeDefined();
            return entry!;
        },
        fileContent: () => fs.readFileSync(file, "utf-8"),
        resolves: (chordSpec) => {
            const chord = parseChord(chordSpec);
            let result: string | undefined;
            for (const part of chord) {
                const res = registry.resolveKey({ ...part });
                result = res.kind === "command" ? res.commandId : undefined;
            }
            return result;
        },
    };
}

describe("applyUserKeybindings (bootstrap)", () => {
    it("правило добавляет user-биндинг, который перебивает дефолтный", () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");

        h.service.applyUserKeybindings([{ key: "ctrl+s", command: "user.custom" }]);

        expect(h.resolves("ctrl+s")).toBe("user.custom");
        expect(h.entryOf("user.custom").source).toBe("user");
    });

    it("«-command» с ключом снимает конкретный биндинг, без ключа — все", () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");
        h.registry.register(parseChord("ctrl+shift+s"), "test.save");

        h.service.applyUserKeybindings([{ key: "ctrl+s", command: "-test.save" }]);
        expect(h.resolves("ctrl+s")).toBeUndefined();
        expect(h.resolves("ctrl+shift+s")).toBe("test.save");

        h.service.applyUserKeybindings([{ key: "", command: "-test.save" }]);
        expect(h.resolves("ctrl+shift+s")).toBeUndefined();
    });
});

describe("defineKeybinding", () => {
    it("замена дефолта: файл получает пару «новое правило + unbind», реестр — мгновенно", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save", "textViewFocus");

        const result = await h.service.defineKeybinding("test.save", parseChord("f6"), h.entryOf("test.save"));

        expect(result.ok).toBe(true);
        const content = h.fileContent();
        expect(content).toContain('"key": "f6"');
        expect(content).toContain('"command": "test.save"');
        expect(content).toContain('"command": "-test.save"');
        expect(content).toContain('"key": "ctrl+s"');
        // when скопирован из перекрытой записи.
        expect(content).toContain('"when": "textViewFocus"');
        // Мгновенное применение: старой комбинации нет, новая работает в этом же сеансе.
        expect(h.resolves("ctrl+s")).toBeUndefined();
        expect(h.entryOf("test.save", "f6").source).toBe("user");
    });

    it("замена user-правила переписывает его, не плодя unbind", async () => {
        const h = makeHarness();
        h.service.applyUserKeybindings([{ key: "f6", command: "my.command" }]);

        const result = await h.service.defineKeybinding("my.command", parseChord("f7"), h.entryOf("my.command"));

        expect(result.ok).toBe(true);
        const content = h.fileContent();
        expect(content).toContain('"key": "f7"');
        expect(content).not.toContain('"key": "f6"');
        expect(content).not.toContain("-my.command");
        expect(h.resolves("f7")).toBe("my.command");
        expect(h.resolves("f6")).toBeUndefined();
    });

    it("без previous — добавление ещё одного биндинга", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");

        const result = await h.service.defineKeybinding("test.save", parseChord("f6"));

        expect(result.ok).toBe(true);
        expect(h.fileContent()).not.toContain("-test.save");
        expect(h.resolves("ctrl+s")).toBe("test.save");
        expect(h.resolves("f6")).toBe("test.save");
    });

    it("правка существующего файла сохраняет комментарии соседних правил", async () => {
        const h = makeHarness(`[
    // pinned by hand
    { "key": "ctrl+h", "command": "hand.made" },
    { "key": "f6", "command": "other.command" },
]
`);
        h.service.applyUserKeybindings([
            { key: "ctrl+h", command: "hand.made" },
            { key: "f6", command: "other.command" },
        ]);

        await h.service.defineKeybinding("other.command", parseChord("f9"), h.entryOf("other.command"));

        const content = h.fileContent();
        // Комментарий нетронутого правила выжил (комментарий заменяемого правила
        // уходит вместе с ним — он его и аннотировал).
        expect(content).toContain("// pinned by hand");
        expect(content).toContain('"key": "ctrl+h"');
        expect(content).toContain('"key": "f9"');
        expect(content).not.toContain('"key": "f6"');
    });
});

describe("removeKeybinding", () => {
    it("дефолт снимается unbind-правилом в файле и из реестра", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");

        const result = await h.service.removeKeybinding(h.entryOf("test.save"));

        expect(result.ok).toBe(true);
        expect(h.fileContent()).toContain('"command": "-test.save"');
        expect(h.resolves("ctrl+s")).toBeUndefined();
    });

    it("user-правило удаляется из файла без unbind", async () => {
        const h = makeHarness();
        h.service.applyUserKeybindings([{ key: "f6", command: "my.command" }]);

        const result = await h.service.removeKeybinding(h.entryOf("my.command"));

        expect(result.ok).toBe(true);
        expect(h.fileContent()).not.toContain("my.command");
        expect(h.resolves("f6")).toBeUndefined();
    });
});

describe("resetKeybinding", () => {
    it("возвращает дефолт, снятый переопределением в этом же сеансе", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");
        await h.service.defineKeybinding("test.save", parseChord("f6"), h.entryOf("test.save"));

        const result = await h.service.resetKeybinding("test.save");

        expect(result.ok).toBe(true);
        expect(h.fileContent()).not.toContain("test.save");
        expect(h.resolves("ctrl+s")).toBe("test.save");
        expect(h.resolves("f6")).toBeUndefined();
        expect(h.entryOf("test.save").source).toBe("default");
    });

    it("возвращает дефолт, снятый unbind-правилом ещё на bootstrap — главный кейс леджера", async () => {
        const h = makeHarness(`[
    { "key": "ctrl+s", "command": "-test.save" }
]
`);
        h.registry.register(parseChord("ctrl+s"), "test.save");
        h.service.applyUserKeybindings([{ key: "ctrl+s", command: "-test.save" }]);
        expect(h.resolves("ctrl+s")).toBeUndefined();

        const result = await h.service.resetKeybinding("test.save");

        expect(result.ok).toBe(true);
        expect(h.fileContent()).not.toContain("-test.save");
        expect(h.resolves("ctrl+s")).toBe("test.save");
    });

    it("reset команды без user-правил — no-op с ok", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");

        const result = await h.service.resetKeybinding("test.save");

        expect(result.ok).toBe(true);
        expect(h.resolves("ctrl+s")).toBe("test.save");
    });
});

describe("исходы и события", () => {
    it("null-путь (тесты/демо без user-data) — честный отказ, реестр не тронут", async () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+s"), "test.save");
        const service = new KeybindingsEditorService(registry, null, NULL_LOG_SERVICE);

        const result = await service.defineKeybinding("test.save", parseChord("f6"));

        expect(result).toEqual({ ok: false, error: "keybindings.json path is not resolved" });
        expect(registry.listBindings()).toHaveLength(1);
    });

    it("removeKeybinding и resetKeybinding при null-пути — отказ без правок реестра", async () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+s"), "test.save");
        const service = new KeybindingsEditorService(registry, null, NULL_LOG_SERVICE);
        const entry = registry.listBindings()[0];

        expect((await service.removeKeybinding(entry)).ok).toBe(false);
        expect((await service.resetKeybinding("test.save")).ok).toBe(false);
        expect(registry.listBindings()).toHaveLength(1);
    });

    it("ошибка записи возвращается результатом, реестр не тронут", async () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+s"), "test.save");
        // Путь «в файл внутри файла» — запись гарантированно падает.
        const blocker = ws.path("blocker");
        fs.writeFileSync(blocker, "", "utf-8");
        const service = new KeybindingsEditorService(registry, path.join(blocker, "keybindings.json"), NULL_LOG_SERVICE);

        const result = await service.defineKeybinding("test.save", parseChord("f6"));

        expect(result.ok).toBe(false);
        expect(registry.listBindings()).toHaveLength(1);
    });

    it("успешная мутация эмитит onDidChange, отписка работает", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");
        let fired = 0;
        const subscription = h.service.onDidChange(() => {
            fired++;
        });

        await h.service.defineKeybinding("test.save", parseChord("f6"), h.entryOf("test.save"));
        expect(fired).toBe(1);

        subscription.dispose();
        await h.service.resetKeybinding("test.save");
        expect(fired).toBe(1);
    });

    it("провальная мутация onDidChange не эмитит", async () => {
        const registry = new KeybindingRegistry();
        const service = new KeybindingsEditorService(registry, null, NULL_LOG_SERVICE);
        let fired = 0;
        service.onDidChange(() => {
            fired++;
        });

        await service.defineKeybinding("x", parseChord("f6"));

        expect(fired).toBe(0);
    });
});
