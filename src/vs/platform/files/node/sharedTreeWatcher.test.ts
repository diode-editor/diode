import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { IDisposable } from "@tuidom/core/common/disposable";
import { describe, expect, it } from "vitest";

import type { LogEntry } from "../../log/common/iLogService.ts";
import { LogLevel } from "../../log/common/logLevel.ts";
import { LogService } from "../../log/common/logService.ts";
import type { ITreeFileChange, ITreeFileWatcher, ITreeFileWatchOptions } from "../common/iTreeFileWatcher.ts";

import { ChokidarTreeWatcher } from "./chokidarTreeWatcher.ts";
import { SharedTreeWatcher } from "./sharedTreeWatcher.ts";

/**
 * Делегат-счётчик: каждый его `watchTree` — это ровно один полный обход дерева
 * и один набор inotify-fd в проде. Их число — и есть то, что экономит
 * {@link SharedTreeWatcher}, поэтому тесты считают именно его.
 */
class FakeTreeWatcher implements ITreeFileWatcher {
    public readonly traversals: {
        readonly root: string;
        readonly options: ITreeFileWatchOptions;
        /** Отдаёт пачку **тем же** массивом: по нему видно, копировал ли её слой. */
        readonly emit: (batch: readonly ITreeFileChange[]) => void;
        /** Именно счётчик, а не флаг: лишний `close()` — это баг, и его должно быть видно. */
        disposeCount: number;
    }[] = [];

    public get liveCount(): number {
        return this.traversals.filter((t) => t.disposeCount === 0).length;
    }

    public watchTree(
        rootPath: string,
        options: ITreeFileWatchOptions,
        onChanges: (changes: readonly ITreeFileChange[]) => void,
    ): IDisposable {
        const traversal = {
            root: rootPath,
            options,
            emit: onChanges,
            disposeCount: 0,
        };
        this.traversals.push(traversal);
        return {
            dispose: () => {
                traversal.disposeCount++;
            },
        };
    }
}

function created(...paths: string[]): ITreeFileChange[] {
    return paths.map((path) => ({ type: "created", path }));
}

describe("SharedTreeWatcher — сколько обходов заводится", () => {
    it("два запроса на один корень с одинаковыми excludes дают один обход", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: true, excludes: ["**/node_modules"] }, () => undefined);
        shared.watchTree("/repo", { recursive: true, excludes: ["**/node_modules"] }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("вложенный запрос едет на рекурсивном обходе предка", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/src/deep", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/.git", { recursive: false, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("корень нормализуется: `/repo/` и `/repo/src/..` — тот же обход", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/src/..", { recursive: true, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("порядок шаблонов в excludes не мешает делить обход", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: true, excludes: ["**/a", "**/b"] }, () => undefined);
        shared.watchTree("/repo", { recursive: true, excludes: ["**/b", "**/a"] }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("разные excludes — разные обходы: подписать на чужие значит потерять события", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: true, excludes: ["**/node_modules"] }, () => undefined);
        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    it("рекурсивный запрос не едет на нерекурсивном обходе того же корня", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: false, excludes: [] }, () => undefined);
        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    it("два нерекурсивных запроса на один корень — один обход", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: false, excludes: [] }, () => undefined);
        shared.watchTree("/repo", { recursive: false, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("вложенный запрос не едет на нерекурсивном обходе предка", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: false, excludes: [] }, () => undefined);
        shared.watchTree("/repo/src", { recursive: false, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    it("соседнее поддерево — свой обход, предком оно не является", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/srcx", { recursive: true, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    it("каталог с ведущими точками лежит внутри, а не снаружи", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        // `..foo` начинается на `..`, но наверх не выходит — префикс считаем по
        // границе сегмента, а не по первым двум символам.
        shared.watchTree("/repo/..foo", { recursive: true, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("обход на корне файловой системы тоже делится", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        // Корень — единственный путь, который сам кончается разделителем
        // (на Windows это `C:\`, случай куда более житейский).
        shared.watchTree(path.sep, { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree(path.join(path.sep, "repo"), { recursive: true, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("обход предка, заведённый позже, старых подписчиков к себе не забирает", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);

        // Переезд подписки задним числом не делаем: обход-потомок уже живой и
        // рвать его ради экономии — значит терять события в зазоре.
        expect(delegate.traversals).toHaveLength(2);
    });
});

describe("SharedTreeWatcher — excludes и переякоривание", () => {
    it("многосегментный шаблон запрещает делить обход с вложенной базой", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const excludes = ["**/.git/objects/**"];

        shared.watchTree("/repo", { recursive: true, excludes }, () => undefined);
        // На корне шаблон исключает `/repo/.git/objects`, на самой `.git` — нет:
        // подписать `.git` на обход корня значит молча съесть её события.
        shared.watchTree("/repo/.git", { recursive: true, excludes }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    it("тот же многосегментный шаблон не мешает делить обход при совпадении корня", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const excludes = ["**/.git/objects/**"];

        shared.watchTree("/repo", { recursive: true, excludes }, () => undefined);
        shared.watchTree("/repo", { recursive: true, excludes }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("шаблон без `**/` привязан к корню и тоже запрещает деление", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const excludes = ["node_modules"];

        shared.watchTree("/repo", { recursive: true, excludes }, () => undefined);
        shared.watchTree("/repo/src", { recursive: true, excludes }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    it("исключённая у предка база получает свой обход", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const excludes = ["**/.git"];

        shared.watchTree("/repo", { recursive: true, excludes }, () => undefined);
        // Обход корня в `.git` не заходит вовсе — там событий просто нет.
        shared.watchTree("/repo/.git", { recursive: false, excludes }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    it("исключённый каталог по пути к базе тоже отменяет деление", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const excludes = ["**/vendor"];

        shared.watchTree("/repo", { recursive: true, excludes }, () => undefined);
        shared.watchTree("/repo/vendor/lib/src", { recursive: true, excludes }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    it("не задетый excludes'ами вложенный путь обход делит", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const excludes = ["**/node_modules", "**/dist"];

        shared.watchTree("/repo", { recursive: true, excludes }, () => undefined);
        shared.watchTree("/repo/packages/core/src", { recursive: true, excludes }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });
});

describe("SharedTreeWatcher — что доезжает подписчикам", () => {
    it("каждый подписчик общего обхода получает свою пачку", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const root: ITreeFileChange[][] = [];
        const nested: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, (c) => root.push([...c]));
        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => nested.push([...c]));
        delegate.traversals[0].emit(created("/repo/a.ts", "/repo/src/b.ts", "/repo/src/deep/c.ts"));

        expect(root).toEqual([created("/repo/a.ts", "/repo/src/b.ts", "/repo/src/deep/c.ts")]);
        expect(nested).toEqual([created("/repo/src/b.ts", "/repo/src/deep/c.ts")]);
    });

    it("нерекурсивному подписчику доезжают только прямые дети базы", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/.git", { recursive: false, excludes: [] }, (c) => batches.push([...c]));
        delegate.traversals[0].emit(created("/repo/.git/HEAD", "/repo/.git/refs/heads/main", "/repo/a.ts"));

        expect(batches).toEqual([created("/repo/.git/HEAD")]);
    });

    it("сама база событием подписчику не приходит", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => batches.push([...c]));
        delegate.traversals[0].emit(created("/repo/src", "/repo/src/a.ts"));

        expect(batches).toEqual([created("/repo/src/a.ts")]);
    });

    it("путь выше базы подписчику не приходит", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => batches.push([...c]));
        delegate.traversals[0].emit(created("/repo", "/repo/srcx/a.ts", "/repo/src/a.ts"));

        expect(batches).toEqual([created("/repo/src/a.ts")]);
    });

    it("нерекурсивный запрос на корне обхода тоже видит только прямых детей", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo", { recursive: false, excludes: [] }, (c) => batches.push([...c]));
        delegate.traversals[0].emit(created("/repo/a.ts", "/repo/src/b.ts"));

        expect(batches).toEqual([created("/repo/a.ts")]);
    });

    it("пачка, в которой подписчику ничего не досталось, его не будит", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => batches.push([...c]));
        delegate.traversals[0].emit(created("/repo/a.ts"));

        expect(batches).toEqual([]);
    });

    it("единственному подписчику своего обхода пачка достаётся без копии", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: (readonly ITreeFileChange[])[] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, (c) => batches.push(c));
        const batch = created("/repo/a.ts");
        delegate.traversals[0].emit(batch);

        // Тот же массив, а не равный ему: типовой случай (обход ровно под один
        // запрос) не должен платить за фильтрацию.
        expect(batches[0]).toBe(batch);
    });

    it("рекурсивность и excludes уезжают делегату как попросили", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo/.git", { recursive: false, excludes: ["**/x"] }, () => undefined);

        expect(delegate.traversals[0].root).toBe("/repo/.git");
        expect(delegate.traversals[0].options).toEqual({ recursive: false, excludes: ["**/x"] });
    });
});

describe("SharedTreeWatcher — жизненный цикл общего обхода", () => {
    it("уход одного подписчика не закрывает обход остальным", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        const first = shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => batches.push([...c]));
        first.dispose();
        delegate.traversals[0].emit(created("/repo/src/a.ts"));

        expect(delegate.liveCount).toBe(1);
        expect(batches).toEqual([created("/repo/src/a.ts")]);
    });

    it("уход последнего подписчика закрывает обход", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        const first = shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        const second = shared.watchTree("/repo/src", { recursive: true, excludes: [] }, () => undefined);
        first.dispose();
        second.dispose();

        expect(delegate.liveCount).toBe(0);
    });

    it("отписавшемуся события больше не приходят", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        const second = shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => batches.push([...c]));
        second.dispose();
        delegate.traversals[0].emit(created("/repo/src/a.ts"));

        expect(batches).toEqual([]);
    });

    it("повторный dispose не закрывает обход второй раз", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        const subscription = shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        subscription.dispose();
        subscription.dispose();

        expect(delegate.traversals[0].disposeCount).toBe(1);
    });

    it("повторный dispose не уносит чужую подписку", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        const first = shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        first.dispose();
        const second = shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        first.dispose();

        expect(delegate.liveCount).toBe(1);
        second.dispose();
        expect(delegate.liveCount).toBe(0);
    });

    it("закрытый обход не переиспользуется — следующий запрос заводит новый", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined).dispose();
        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
        expect(delegate.traversals[1].root).toBe("/repo/src");
    });

    it("dispose из колбэка не ломает рассылку остальным", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        const first = shared.watchTree("/repo", { recursive: true, excludes: [] }, () => {
            first.dispose();
        });
        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => batches.push([...c]));
        delegate.traversals[0].emit(created("/repo/src/a.ts"));

        expect(batches).toEqual([created("/repo/src/a.ts")]);
        expect(delegate.liveCount).toBe(1);
    });

    it("отписанному соседом подписчику пачка уже не доезжает", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        // Первый в очереди рассылки уносит второго — до второго пачка дойти не
        // должна, хотя снимок списка подписчиков его ещё помнит.
        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => {
            second.dispose();
        });
        const second = shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => batches.push([...c]));
        delegate.traversals[0].emit(created("/repo/src/a.ts"));

        expect(batches).toEqual([]);
    });

    it("подписка из колбэка не получает пачку, которая уже разъезжается", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const late: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => {
            shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => late.push([...c]));
        });
        delegate.traversals[0].emit(created("/repo/src/a.ts"));

        expect(delegate.traversals).toHaveLength(1);
        expect(late).toEqual([]);
    });
});

describe("SharedTreeWatcher — лог", () => {
    it("переиспользование обхода видно в канале files.watcher", () => {
        const logService = new LogService();
        logService.setLevel("*", LogLevel.Trace);
        const entries: LogEntry[] = [];
        logService.addSink({
            append: (entry) => entries.push(entry),
            dispose: () => undefined,
        });
        const shared = new SharedTreeWatcher(new FakeTreeWatcher(), logService.createLogger("files.watcher"));

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        expect(entries).toEqual([]);

        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, () => undefined);
        expect(entries.at(-1)?.message).toContain("reusing");
        // Без пары «чей обход» / «кого подписали» строка ничего не диагностирует.
        expect(entries.at(-1)?.args).toEqual([{ root: "/repo", base: "/repo/src" }]);
    });
});

describe("SharedTreeWatcher — настоящий chokidar", () => {
    /**
     * Один обход на диске, два запроса поверх него. Проверяем то, ради чего
     * деление вообще допустимо: подписчики видят ровно свои события, как если
     * бы каждый поднял собственный watcher.
     */
    it("общий обход доставляет события и вложенному, и нерекурсивному запросу", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-shared-watch-"));
        fs.mkdirSync(path.join(root, "src", "deep"), { recursive: true });
        const shared = new SharedTreeWatcher(new ChokidarTreeWatcher());
        const all: string[] = [];
        const nested: string[] = [];
        const subscriptions = [
            shared.watchTree(root, { recursive: true, excludes: [] }, (c) => all.push(...c.map((x) => x.path))),
            shared.watchTree(path.join(root, "src"), { recursive: false, excludes: [] }, (c) =>
                nested.push(...c.map((x) => x.path)),
            ),
        ];
        try {
            // До `ready` chokidar считает найденное начальным состоянием и с
            // `ignoreInitial` глотает — ждём.
            await new Promise((resolve) => setTimeout(resolve, 400));

            fs.writeFileSync(path.join(root, "top.ts"), "x");
            fs.writeFileSync(path.join(root, "src", "a.ts"), "y");
            fs.writeFileSync(path.join(root, "src", "deep", "b.ts"), "z");
            await new Promise((resolve) => setTimeout(resolve, 800));

            expect(all).toEqual(
                expect.arrayContaining([
                    path.join(root, "top.ts"),
                    path.join(root, "src", "a.ts"),
                    path.join(root, "src", "deep", "b.ts"),
                ]),
            );
            expect(nested).toContain(path.join(root, "src", "a.ts"));
            // Нерекурсивный запрос: ни чужого поддерева, ни глубины.
            expect(nested).not.toContain(path.join(root, "top.ts"));
            expect(nested).not.toContain(path.join(root, "src", "deep", "b.ts"));
        } finally {
            for (const subscription of subscriptions) subscription.dispose();
            fs.rmSync(root, { recursive: true, force: true });
        }
    }, 20000);
});
