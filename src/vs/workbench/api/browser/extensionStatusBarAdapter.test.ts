import { describe, expect, it } from "vitest";

import { CODICON_GLYPHS } from "../../../base/common/codicons.generated.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import { NULL_STATE_SERVICE } from "../../../platform/state/common/nullStateService.ts";
import type { IStatusBarEntry } from "../../services/statusbar/common/statusBarService.ts";
import { StatusBarService } from "../../services/statusbar/common/statusBarService.ts";
import type { ICommandService } from "../common/iCommandService.ts";
import type { IWireStatusBarItem } from "../common/wireTypes.ts";

import { ExtensionStatusBarAdapter, renderStatusBarItemText } from "./extensionStatusBarAdapter.ts";

/** Реестр команд на минималках: пишет вызовы, умеет падать и отдавать промис. */
function makeCommands(behaviour?: (id: string) => unknown): {
    service: ICommandService;
    calls: { id: string; args: readonly unknown[] }[];
} {
    const calls: { id: string; args: readonly unknown[] }[] = [];
    const service = {
        execute: (id: string, args: readonly unknown[]): unknown => {
            calls.push({ id, args });
            return behaviour?.(id);
        },
        registerProxy: () => ({ dispose: () => undefined }),
    };
    return { service, calls };
}

function makeErrorLogger(): { logger: ILogger; errors: string[] } {
    const errors: string[] = [];
    const logger = {
        error: (message: string) => errors.push(message),
    } as unknown as ILogger;
    return { logger, errors };
}

function makeAdapter(behaviour?: (id: string) => unknown): {
    bar: StatusBarService;
    adapter: ExtensionStatusBarAdapter;
    calls: { id: string; args: readonly unknown[] }[];
    errors: string[];
} {
    const bar = new StatusBarService(NULL_STATE_SERVICE);
    const { service, calls } = makeCommands(behaviour);
    const { logger, errors } = makeErrorLogger();
    return { bar, adapter: new ExtensionStatusBarAdapter(bar, service, logger), calls, errors };
}

function wireItem(patch: Partial<IWireStatusBarItem> = {}): IWireStatusBarItem {
    return { handle: 1, id: "demo", alignment: "right", text: "Demo", ...patch };
}

function entry(bar: StatusBarService, id: string): IStatusBarEntry {
    const found = bar.allEntries().find((e) => e.id === id);
    if (found === undefined)
        throw new Error(
            `нет записи "${id}": ${bar
                .allEntries()
                .map((e) => e.id)
                .join(", ")}`,
        );
    return found;
}

describe("ExtensionStatusBarAdapter", () => {
    it("update заводит запись полосы под своим префиксом", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ name: "Status Bar Demo", priority: 100 }));

        expect(entry(bar, "extensions.demo")).toMatchObject({
            text: " Demo ".trim(),
            alignment: "right",
            priority: 100,
            name: "Status Bar Demo",
        });
    });

    it("id расширения не может совпасть со встроенным сегментом", () => {
        const { bar, adapter } = makeAdapter();
        bar.addEntry({ id: "status.editor.encoding", text: "UTF-8", alignment: "right", priority: 30 });
        adapter.update(wireItem({ id: "status.editor.encoding", text: "ХА" }));

        expect(bar.entries().map((e) => e.id)).toEqual(["status.editor.encoding", "extensions.status.editor.encoding"]);
    });

    it("повторный update того же handle правит запись на месте", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem());
        adapter.update(wireItem({ text: "Demo 42" }));

        expect(bar.entries()).toHaveLength(1);
        expect(entry(bar, "extensions.demo").text).toBe("Demo 42");
    });

    it("правка на месте не пересоздаёт запись: порядок равноприоритетных не едет", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ handle: 1, id: "a", alignment: "left", text: "A", priority: 10 }));
        adapter.update(wireItem({ handle: 2, id: "b", alignment: "left", text: "B", priority: 10 }));
        adapter.update(wireItem({ handle: 1, id: "a", alignment: "left", text: "A2", priority: 10 }));

        // Пересозданная запись уехала бы в хвост своей стороны.
        expect(bar.entries().map((e) => e.text)).toEqual(["A2", "B"]);
    });

    it("приоритет доезжает до записи как есть", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ priority: 100 }));
        adapter.update(wireItem({ priority: 42 }));

        expect(entry(bar, "extensions.demo").priority).toBe(42);
    });

    it("правка без имени имя не стирает, а новое имя — применяет", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ name: "Status Bar Demo" }));
        adapter.update(wireItem({ text: "Demo 42" }));
        expect(entry(bar, "extensions.demo").name).toBe("Status Bar Demo");

        adapter.update(wireItem({ id: "demo", name: "Другое имя" }));
        expect(entry(bar, "extensions.demo").name).toBe("Другое имя");
    });

    it("сменившийся id пересоздаёт запись, старая не остаётся", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ id: "item-1" }));
        adapter.update(wireItem({ id: "status-bar-demo", name: "Status Bar Demo" }));

        expect(bar.entries().map((e) => e.id)).toEqual(["extensions.status-bar-demo"]);
    });

    it("пункт без приоритета встаёт правее приоритетных своей стороны", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ handle: 1, id: "l-high", alignment: "left", text: "L-high", priority: 100 }));
        adapter.update(wireItem({ handle: 2, id: "l-low", alignment: "left", text: "L-low", priority: 10 }));
        adapter.update(wireItem({ handle: 3, id: "l-none", alignment: "left", text: "L-none" }));

        expect(bar.entries().map((e) => e.text)).toEqual(["L-high", "L-low", "L-none"]);
    });

    it("два пункта без приоритета сохраняют порядок добавления", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ handle: 1, id: "a", alignment: "left", text: "A" }));
        adapter.update(wireItem({ handle: 2, id: "b", alignment: "left", text: "B" }));

        expect(bar.entries().map((e) => e.text)).toEqual(["A", "B"]);
    });

    it("remove снимает запись; повторный remove — no-op", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem());
        adapter.remove(1);
        adapter.remove(1);

        expect(bar.entries()).toEqual([]);
    });

    it("clear снимает все пункты (смерть субпроцесса)", () => {
        const { bar, adapter } = makeAdapter();
        bar.addEntry({ id: "status.editor.encoding", text: "UTF-8", alignment: "right", priority: 30 });
        adapter.update(wireItem({ handle: 1, id: "a", text: "A" }));
        adapter.update(wireItem({ handle: 2, id: "b", text: "B" }));
        adapter.clear();

        expect(bar.entries().map((e) => e.id)).toEqual(["status.editor.encoding"]);
    });

    it("после clear тот же handle заводит запись заново (респавн субпроцесса)", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem());
        adapter.clear();
        adapter.update(wireItem());

        expect(bar.entries().map((e) => e.id)).toEqual(["extensions.demo"]);
    });

    it("клик исполняет команду пункта с её аргументами", () => {
        const { bar, adapter, calls } = makeAdapter();
        adapter.update(wireItem({ command: "demo.click", arguments: [1, "two"] }));
        entry(bar, "extensions.demo").onClick?.();

        expect(calls).toEqual([{ id: "demo.click", args: [1, "two"] }]);
    });

    it("клик берёт КОМАНДУ ИЗ ПОСЛЕДНЕГО update, а не из момента создания записи", () => {
        const { bar, adapter, calls } = makeAdapter();
        adapter.update(wireItem({ command: "demo.first" }));
        adapter.update(wireItem({ command: "demo.second", arguments: ["x"] }));
        entry(bar, "extensions.demo").onClick?.();

        expect(calls).toEqual([{ id: "demo.second", args: ["x"] }]);
    });

    it("команда без аргументов зовётся с пустым списком", () => {
        const { bar, adapter, calls } = makeAdapter();
        adapter.update(wireItem({ command: "demo.click" }));
        entry(bar, "extensions.demo").onClick?.();

        expect(calls).toEqual([{ id: "demo.click", args: [] }]);
    });

    it("правка, снявшая аргументы, снимает их и у клика", () => {
        const { bar, adapter, calls } = makeAdapter();
        adapter.update(wireItem({ command: "demo.click", arguments: [1] }));
        adapter.update(wireItem({ command: "demo.click" }));
        entry(bar, "extensions.demo").onClick?.();

        expect(calls).toEqual([{ id: "demo.click", args: [] }]);
    });

    it("пункт без команды инертен, но кликабелен", () => {
        const { bar, adapter, calls } = makeAdapter();
        adapter.update(wireItem());
        const clickable = entry(bar, "extensions.demo").onClick;
        clickable?.();

        expect(clickable).toBeTypeOf("function");
        expect(calls).toEqual([]);
    });

    it("упавшая команда не роняет редактор, а уходит в лог", () => {
        const { bar, adapter, errors } = makeAdapter(() => {
            throw new Error("boom");
        });
        adapter.update(wireItem({ command: "demo.broken" }));

        expect(() => entry(bar, "extensions.demo").onClick?.()).not.toThrow();
        expect(errors).toEqual(['status bar command "demo.broken" failed']);
    });

    it("отвалившийся промис команды тоже уходит в лог", async () => {
        const { bar, adapter, errors } = makeAdapter(() => Promise.reject(new Error("boom")));
        adapter.update(wireItem({ command: "demo.async" }));
        entry(bar, "extensions.demo").onClick?.();
        await Promise.resolve();
        await Promise.resolve();

        expect(errors).toEqual(['status bar command "demo.async" failed']);
    });

    it("успешная команда в лог не пишет", async () => {
        const { bar, adapter, errors } = makeAdapter(() => Promise.resolve("ok"));
        adapter.update(wireItem({ command: "demo.ok" }));
        entry(bar, "extensions.demo").onClick?.();
        await Promise.resolve();
        await Promise.resolve();

        expect(errors).toEqual([]);
    });

    it("без логгера упавшая команда всё равно не роняет редактор", () => {
        const bar = new StatusBarService(NULL_STATE_SERVICE);
        const { service } = makeCommands(() => {
            throw new Error("boom");
        });
        const adapter = new ExtensionStatusBarAdapter(bar, service);
        adapter.update(wireItem({ command: "demo.broken" }));

        expect(() => entry(bar, "extensions.demo").onClick?.()).not.toThrow();
    });

    it("скрытый пользователем пункт не показывается, сколько бы update ни пришло", () => {
        const { bar, adapter } = makeAdapter();
        adapter.update(wireItem({ name: "Status Bar Demo" }));
        bar.setHidden("extensions.demo", true);
        adapter.update(wireItem({ name: "Status Bar Demo", text: "Demo 42" }));

        expect(bar.entries()).toEqual([]);
        expect(bar.allEntries().map((e) => e.text)).toEqual(["Demo 42"]);
    });
});

describe("renderStatusBarItemText", () => {
    it("подставляет значок вместо разметки", () => {
        expect(renderStatusBarItemText("$(check) Demo")).toBe(`${CODICON_GLYPHS.check ?? ""} Demo`);
    });

    it("режет длинный текст, оставляя многоточие", () => {
        const rendered = renderStatusBarItemText("x".repeat(200));

        expect(rendered).toBe(`${"x".repeat(23)}…`);
    });

    it("текст ровно по потолку не режется", () => {
        expect(renderStatusBarItemText("y".repeat(24))).toBe("y".repeat(24));
    });

    it("на символ длиннее потолка — уже режется", () => {
        expect(renderStatusBarItemText("y".repeat(25))).toBe(`${"y".repeat(23)}…`);
    });

    it("режет по кодпоинтам, не разрывая суррогатную пару", () => {
        const rendered = renderStatusBarItemText("🙂".repeat(10), 5);

        expect(rendered).toBe(`${"🙂".repeat(4)}…`);
    });

    it("пункт из одних неизвестных значков получает запасной символ", () => {
        expect(renderStatusBarItemText("$(definitely-not-a-codicon)")).toBe("•");
    });

    it("пустой текст расширение выбрало само — запасного символа не подставляем", () => {
        expect(renderStatusBarItemText("")).toBe("");
    });

    it("текст из одних пробелов тоже получает запасной символ", () => {
        expect(renderStatusBarItemText("   ")).toBe("•");
    });

    it("значок без текста остаётся видимым сам по себе", () => {
        expect(renderStatusBarItemText("$(sync~spin)")).toBe(CODICON_GLYPHS.sync);
    });
});
