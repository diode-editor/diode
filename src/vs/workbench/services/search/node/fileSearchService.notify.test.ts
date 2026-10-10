import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";

import { FileSearchService } from "./fileSearchService.ts";

// Поддельный `rg` — shell-скрипт: печатает заготовленные пути и ВИСИТ, пока его
// не снимут. Так состояние «обход идёт, часть файлов уже пришла»
// воспроизводится детерминированно, без гонки с настоящим rg, который на
// маленьком дереве успевает закончить раньше любой проверки.

describe.skipIf(process.platform === "win32")("FileSearchService — обход в процессе (поддельный rg)", () => {
    let bin: ITempWorkspace;
    let service: FileSearchService | null = null;

    beforeEach(() => {
        bin = createTempWorkspace({ prefix: "diode-filesearch-fake-rg-" });
    });

    afterEach(() => {
        service?.dispose();
        service = null;
        bin.dispose();
        vi.useRealTimers();
    });

    /** `rg`, который печатает `lines` и висит (или выходит, если `hang: false`). */
    function fakeRg(lines: readonly string[], options: { hang?: boolean } = {}): string {
        const out = bin.writeFile("stdout.txt", lines.map((line) => `${line}\n`).join(""));
        const script = bin.writeFile(
            "rg",
            `#!/bin/sh\ncat '${out}'\n${options.hang === false ? "" : "exec sleep 30\n"}exit 0\n`,
        );
        fs.chmodSync(script, 0o755);
        return script;
    }

    /** Ждёт, пока в индекс придут первые пути (обход при этом не закончен). */
    async function waitForEntries(s: FileSearchService): Promise<void> {
        await vi.waitFor(
            () => {
                expect(s.search("").length).toBeGreaterThan(0);
            },
            { interval: 5, timeout: 5000 },
        );
    }

    it("индекс растёт вживую, пока rg ещё печатает", async () => {
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, fakeRg(["a.ts", "src/b.ts"])));
        const pending = s.activate(bin.dir);

        await waitForEntries(s);
        expect(s.search("").map((r) => r.entry.relativePath)).toEqual(["a.ts", "src/b.ts"]);
        expect(s.isIndexed).toBe(false);

        s.dispose();
        await pending;
        expect(s.isIndexed).toBe(false);
    });

    it("debounced onIndexChanged срабатывает по таймеру посреди обхода", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, fakeRg(["a.ts"])));
        let fired = 0;
        s.onIndexChanged(() => {
            fired += 1;
        });
        const pending = s.activate(bin.dir);

        await waitForEntries(s);
        expect(fired).toBe(0);
        vi.advanceTimersByTime(50);
        expect(fired).toBe(1);

        s.dispose();
        await pending;
    });

    it("dispose() снимает отложенный notify — подписчик его не получает", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, fakeRg(["a.ts"])));
        let fired = 0;
        s.onIndexChanged(() => {
            fired += 1;
        });
        const pending = s.activate(bin.dir);
        await waitForEntries(s);
        expect(vi.getTimerCount()).toBe(1);

        s.dispose();
        expect(vi.getTimerCount()).toBe(0);
        await pending;
        expect(fired).toBe(0);
    });

    it("dispose() посреди обхода снимает rg — `ready` дорешивается", async () => {
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, fakeRg(["a.ts"])));
        const pending = s.activate(bin.dir);
        await waitForEntries(s);

        s.dispose();
        // Без kill висящий rg держал бы `ready` 30 секунд — тест упал бы по таймауту.
        await pending;
        expect(s.isIndexed).toBe(false);
    });

    it("новый обход снимает прежний rg и не смешивает их вывод", async () => {
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, fakeRg(["old.ts"])));
        const first = s.activate(bin.dir);
        await waitForEntries(s);

        // Прежний rg висит: если его не снять, `first` не дорешится никогда.
        fakeRg(["new.ts"], { hang: false });
        const second = s.activate(bin.dir);
        await Promise.all([first, second]);

        expect(s.isIndexed).toBe(true);
        expect(s.search("").map((r) => r.entry.relativePath)).toEqual(["new.ts"]);
    });

    /**
     * `rg`, который на SIGTERM выходит не сразу, а через 300 мс, и отмечает
     * каждый свой старт строкой в `starts`. Так прежний обход гарантированно
     * заканчивается ПОЗЖЕ, чем стартовал новый, — та самая гонка, где конец
     * старого не должен трогать состояние нового. Скрипт один на оба обхода:
     * переписывать файл, который ещё читает живой `sh`, нельзя.
     */
    function slowExitRg(): { rg: string; starts: () => number } {
        const out = bin.writeFile("stdout.txt", "a.ts\n");
        const starts = bin.path("starts");
        const script = bin.writeFile(
            "rg",
            `#!/bin/sh\necho started >> '${starts}'\ntrap 'sleep 0.3; exit 0' TERM\ncat '${out}'\nwhile :; do sleep 0.05; done\n`,
        );
        fs.chmodSync(script, 0o755);
        return {
            rg: script,
            starts: () => (fs.existsSync(starts) ? fs.readFileSync(starts, "utf8").split("\n").length - 1 : 0),
        };
    }

    /** Запускает обход A, поверх него обход B и ждёт, пока A доумрёт (B ещё идёт). */
    async function supersededWalk(s: FileSearchService, starts: () => number): Promise<{ second: Promise<void> }> {
        const first = s.activate(bin.dir);
        await vi.waitFor(() => {
            expect(starts()).toBe(1);
        });
        const second = s.activate(bin.dir);
        await vi.waitFor(() => {
            expect(starts()).toBe(2);
        });
        await first;
        // В объекте: промис, возвращённый из async-функции, развернулся бы, и
        // вызывающий ждал бы конец B вместо конца A.
        return { second };
    }

    it("конец снятого обхода не сбрасывает `indexing` идущего", async () => {
        const { rg, starts } = slowExitRg();
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, rg));
        const { second } = await supersededWalk(s, starts);

        // Индекс ни разу не достроен — устарел по времени; отказ refreshIfStale
        // держится только на `indexing` идущего обхода B.
        const readyBefore = s.ready;
        s.refreshIfStale();
        expect(s.ready).toBe(readyBefore);
        expect(starts()).toBe(2);

        s.dispose();
        await second;
    });

    it("dispose() до старта обхода rg не запускает", async () => {
        const { rg, starts } = slowExitRg();
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, rg));
        const pending = s.activate(bin.dir);
        // Обход отложен на setImmediate — снимаем до него. Запущенный после
        // dispose rg снять было бы некому: `pending` не дорешился бы.
        s.dispose();
        await pending;

        expect(starts()).toBe(0);
        expect(s.isIndexed).toBe(false);
    });

    it("конец снятого обхода не забывает rg идущего — dispose его снимает", async () => {
        const { rg, starts } = slowExitRg();
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, rg));
        const { second } = await supersededWalk(s, starts);

        // Забытый rg обхода B крутился бы вечно, и `second` не дорешился бы.
        s.dispose();
        await second;
        expect(s.isIndexed).toBe(false);
    });

    it("refreshIfStale не запускает второй обход, пока идёт первый", async () => {
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, fakeRg(["a.ts"])));
        const pending = s.activate(bin.dir);
        await waitForEntries(s);

        const readyBefore = s.ready;
        s.refreshIfStale();
        expect(s.ready).toBe(readyBefore);

        s.dispose();
        await pending;
    });

    it("обход кончается по `close`: строки, пришедшие после `exit`, в индексе", async () => {
        // Сам `rg` выходит сразу, а унаследовавший его stdout потомок допечатывает
        // строку позже: `exit` уже был, `close` — ещё нет.
        const script = bin.writeFile("rg", "#!/bin/sh\necho a.ts\n(sleep 0.3; echo late.ts) &\nexit 0\n");
        fs.chmodSync(script, 0o755);
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, script));

        await s.activate(bin.dir);

        expect(s.search("").map((r) => r.entry.relativePath)).toEqual(["a.ts", "late.ts"]);
    });

    it("пропавший rg — пустой индекс, а не отказ", async () => {
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, bin.path("no-such-rg")));
        await s.activate(bin.dir);

        expect(s.isIndexed).toBe(true);
        expect(s.search("")).toHaveLength(0);
    });
});

describe("FileSearchService — notify", () => {
    let ws: ITempWorkspace;
    let service: FileSearchService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-filesearch-notify-" });
        service = new FileSearchService(NULL_CONFIGURATION_SERVICE);
    });

    afterEach(() => {
        service.dispose();
        ws.dispose();
    });

    it("dispose() with no pending notify timer is a no-op", () => {
        // Never activated → notifyTimer is null. dispose() must take the false branch.
        expect(() => {
            service.dispose();
        }).not.toThrow();
    });

    it("flushNotify fires onIndexChanged on completion when subscribed late", async () => {
        ws.writeFile("only.ts", "");
        const p = service.activate(ws.dir);
        let fired = 0;
        service.onIndexChanged(() => {
            fired += 1;
        });
        await p;
        // Не «ровно 1»: под нагрузкой debounce-таймер может успеть до `close`.
        expect(fired).toBeGreaterThan(0);
    });

    it("не индексирует битый симлинк", async () => {
        ws.writeFile("real.ts", "");
        fs.symlinkSync(ws.path("nonexistent-target"), ws.path("dangling"));

        await service.activate(ws.dir);

        expect(service.search("").map((r) => r.entry.relativePath)).toEqual(["real.ts"]);
    });
});
