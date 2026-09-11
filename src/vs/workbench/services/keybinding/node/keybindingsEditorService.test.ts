import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parse as parseJsonc } from "jsonc-parser";

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
    rules(): { key?: string; command: string; when?: string }[];
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
        rules: () =>
            parseJsonc(fs.readFileSync(file, "utf-8"), [], { allowTrailingComma: true }) as {
                key?: string;
                command: string;
                when?: string;
            }[],
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

describe("hasUserModifications", () => {
    it("false без правок, true после define и bootstrap-unbind, false после reset", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");
        expect(h.service.hasUserModifications("test.save")).toBe(false);

        await h.service.defineKeybinding("test.save", parseChord("f6"), h.entryOf("test.save"));
        expect(h.service.hasUserModifications("test.save")).toBe(true);

        await h.service.resetKeybinding("test.save");
        expect(h.service.hasUserModifications("test.save")).toBe(false);

        h.service.applyUserKeybindings([{ key: "ctrl+s", command: "-test.save" }]);
        expect(h.service.hasUserModifications("test.save")).toBe(true);
    });

    it("true когда есть ТОЛЬКО добавленный биндинг (removedDefaults пуст)", async () => {
        const h = makeHarness();
        // Добавление без previous: added=[…], removedDefaults=[] — проверяет левую ветку ||.
        await h.service.defineKeybinding("brand.new", parseChord("f6"));
        expect(h.service.hasUserModifications("brand.new")).toBe(true);
    });

    it("true когда снят ТОЛЬКО дефолт (added пуст) — правая ветка ||", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");
        // remove дефолта: removedDefaults=[…], added=[] — правая ветка ||.
        await h.service.removeKeybinding(h.entryOf("test.save"));
        expect(h.service.hasUserModifications("test.save")).toBe(true);
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

    it("remove и reset тоже эмитят onDidChange", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");
        let fired = 0;
        h.service.onDidChange(() => {
            fired++;
        });

        await h.service.removeKeybinding(h.entryOf("test.save"));
        expect(fired).toBe(1);

        await h.service.resetKeybinding("test.save");
        expect(fired).toBe(2);
    });
});

describe("выбор правила и запись файла — тонкости", () => {
    it("define без previous поверх непустого файла не трогает существующие правила", async () => {
        const h = makeHarness(`[
    { "key": "ctrl+h", "command": "other.command" }
]
`);
        h.registry.register(parseChord("ctrl+s"), "test.save");

        const result = await h.service.defineKeybinding("test.save", parseChord("f6"));

        expect(result.ok).toBe(true);
        const rules = h.rules();
        // Обе записи на месте: чужое правило не снято (ветка «previous === undefined» не идёт в remove).
        expect(rules.map((r) => r.command).sort()).toEqual(["other.command", "test.save"]);
    });

    it("define в несуществующий файл даёт ровно одно валидное правило", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");

        await h.service.defineKeybinding("test.save", parseChord("f6"), h.entryOf("test.save"));

        const rules = h.rules();
        expect(Array.isArray(rules)).toBe(true);
        // Новое правило + unbind дефолта — ровно два, файл валиден (стартовый контент чистый).
        expect(rules).toHaveLength(2);
        expect(rules.map((r) => r.command).sort()).toEqual(["-test.save", "test.save"]);
        // Файл заканчивается закрытой скобкой массива — стартовый контент был "",
        // а не мусор (иначе modify оставил бы хвост после `]`).
        expect(h.fileContent().trimEnd().endsWith("]")).toBe(true);
    });

    it("matchesUserRule снимает ровно совпадающее правило: другое command/key/when остаются", async () => {
        // Четыре user-правила, отличающиеся ровно одним полем от цели {save, ctrl+s, listFocus}.
        const h = makeHarness(`[
    { "key": "ctrl+s", "command": "save", "when": "listFocus" },
    { "key": "ctrl+s", "command": "other", "when": "listFocus" },
    { "key": "ctrl+x", "command": "save", "when": "listFocus" },
    { "key": "ctrl+s", "command": "save", "when": "editorFocus" }
]
`);
        h.service.applyUserKeybindings([
            { key: "ctrl+s", command: "save", when: "listFocus" },
            { key: "ctrl+s", command: "other", when: "listFocus" },
            { key: "ctrl+x", command: "save", when: "listFocus" },
            { key: "ctrl+s", command: "save", when: "editorFocus" },
        ]);
        const target = h.registry
            .listBindings()
            .find((b) => b.commandId === "save" && b.when === "listFocus" && chordsEqual(b.chord, parseChord("ctrl+s")))!;

        await h.service.removeKeybinding(target);

        const rules = h.rules();
        // Снята ровно цель; остальные три (другой command / key / when) на месте.
        expect(rules).toHaveLength(3);
        expect(rules.some((r) => r.command === "save" && r.key === "ctrl+s" && r.when === "listFocus")).toBe(false);
        expect(rules.some((r) => r.command === "other")).toBe(true);
        expect(rules.some((r) => r.key === "ctrl+x")).toBe(true);
        expect(rules.some((r) => r.when === "editorFocus")).toBe(true);
    });

    it("remove снимает ТОЛЬКО user-правило с совпадающим when (matchesUserRule чувствителен к when)", async () => {
        // Файл и реестр в bootstrap-состоянии: два user-правила одной команды и
        // комбинации, различаются when.
        const h = makeHarness(`[
    { "key": "f6", "command": "dup.cmd", "when": "listFocus" },
    { "key": "f6", "command": "dup.cmd", "when": "textViewFocus" }
]
`);
        h.service.applyUserKeybindings([
            { key: "f6", command: "dup.cmd", when: "listFocus" },
            { key: "f6", command: "dup.cmd", when: "textViewFocus" },
        ]);

        const listFocusEntry = h.registry
            .listBindings()
            .find((b) => b.commandId === "dup.cmd" && b.when === "listFocus")!;
        await h.service.removeKeybinding(listFocusEntry);

        const remaining = h.rules().filter((r) => r.command === "dup.cmd");
        expect(remaining).toHaveLength(1);
        expect(remaining[0].when).toBe("textViewFocus");
    });

    it("remove user-правила без when не задевает user-правило с when на той же комбинации", async () => {
        const h = makeHarness(`[
    { "key": "f6", "command": "dup.cmd" },
    { "key": "f6", "command": "dup.cmd", "when": "listFocus" }
]
`);
        h.service.applyUserKeybindings([
            { key: "f6", command: "dup.cmd" },
            { key: "f6", command: "dup.cmd", when: "listFocus" },
        ]);

        const noWhenEntry = h.registry
            .listBindings()
            .find((b) => b.commandId === "dup.cmd" && b.when === undefined)!;
        await h.service.removeKeybinding(noWhenEntry);

        const remaining = h.rules().filter((r) => r.command === "dup.cmd");
        expect(remaining).toHaveLength(1);
        expect(remaining[0].when).toBe("listFocus");
    });

    it("проваленный reset (ошибка записи) НЕ трогает реестр — ранний выход по !result.ok", async () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+s"), "test.save");
        const blocker = ws.path("blocker");
        fs.writeFileSync(blocker, "", "utf-8");
        const service = new KeybindingsEditorService(registry, path.join(blocker, "keybindings.json"), NULL_LOG_SERVICE);
        // Bootstrap-снятие дефолта наполняет леджер (removedDefaults), файл не пишет.
        service.applyUserKeybindings([{ key: "ctrl+s", command: "-test.save" }]);
        expect(registry.getKeybindingForCommand("test.save")).toBeUndefined();

        const result = await service.resetKeybinding("test.save");

        // Запись упала → реестр остаётся в снятом состоянии, дефолт НЕ возвращён.
        expect(result.ok).toBe(false);
        expect(registry.getKeybindingForCommand("test.save")).toBeUndefined();
    });

    it("remove единственного user-биндинга очищает леджер (added фильтруется, не уезжает в removedDefaults)", async () => {
        const h = makeHarness(`[{ "key": "f6", "command": "my.cmd" }]\n`);
        h.service.applyUserKeybindings([{ key: "f6", command: "my.cmd" }]);
        expect(h.service.hasUserModifications("my.cmd")).toBe(true);

        await h.service.removeKeybinding(h.entryOf("my.cmd", "f6"));

        // added отфильтрован до пустого И ничего не попало в removedDefaults → нет правок.
        expect(h.service.hasUserModifications("my.cmd")).toBe(false);
    });

    it("remove одного из двух user-биндингов оставляет другой живым и он снимается reset'ом", async () => {
        const h = makeHarness(`[
    { "key": "f6", "command": "dup.cmd" },
    { "key": "f7", "command": "dup.cmd" }
]
`);
        h.service.applyUserKeybindings([
            { key: "f6", command: "dup.cmd" },
            { key: "f7", command: "dup.cmd" },
        ]);

        await h.service.removeKeybinding(h.entryOf("dup.cmd", "f6"));
        // f7 всё ещё действует…
        expect(h.resolves("f7")).toBe("dup.cmd");

        await h.service.resetKeybinding("dup.cmd");
        // …и reset снимает именно его (леджер.added хранил f7, не f6).
        expect(h.resolves("f7")).toBeUndefined();
    });

    it("reset убирает и прямое правило, и -command той же команды, чужие не трогает", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");
        h.registry.register(parseChord("ctrl+h"), "other.command");
        // Наберём файлу и прямое user-правило, и unbind этой же команды, и чужое.
        await h.service.defineKeybinding("test.save", parseChord("f6"), h.entryOf("test.save")); // add + -test.save
        await h.service.defineKeybinding("other.command", parseChord("f7"), h.entryOf("other.command"));

        await h.service.resetKeybinding("test.save");

        const commands = h.rules().map((r) => r.command);
        expect(commands).not.toContain("test.save");
        expect(commands).not.toContain("-test.save");
        // Чужие правила остались.
        expect(commands).toContain("other.command");
        expect(commands).toContain("-other.command");
    });
});
