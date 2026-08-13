import { afterEach, describe, expect, it, vi } from "vitest";

import type { TerminalCell } from "@tuidom/all/common/iTerminalSurface";

import { EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

// Тесты гоняют РЕАЛЬНЫЕ node-pty + @xterm/headless (linux, оба установлены).

function readRow(session: EmbeddedTerminalSession, row: number, width: number): string {
    const out: TerminalCell = { char: "", fg: 0, bg: 0, style: 0, width: 1 };
    let text = "";
    for (let x = 0; x < width; x++) {
        if (session.readCell(x, row, out)) text += out.char;
    }
    return text;
}

/**
 * Весь видимый экран одной строкой. Нужен там, где вывод идёт через ИНТЕРАКТИВНЫЙ шелл:
 * длина его промпта зависит от машины (на CI `runner@…:~/work/vexx/vexx$` — длиннее, чем
 * локально), поэтому номер строки, на которую ляжет вывод, предсказать нельзя. Склейка
 * без разделителя заодно переживает перенос строки: у перенесённой строки нет хвостовых
 * пробелов, так что маркер, разорванный переносом, снова становится целым.
 */
function readScreen(session: EmbeddedTerminalSession, rows: number, width: number): string {
    let text = "";
    for (let row = 0; row < rows; row++) text += readRow(session, row, width);
    return text;
}

function awaitExit(session: EmbeddedTerminalSession): Promise<number> {
    return new Promise<number>((resolve) => {
        session.onExit(resolve);
    });
}

describe("EmbeddedTerminalSession — выбор шелла и аргументов", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("берёт шелл из $SHELL, когда options.shell не задан", async () => {
        vi.stubEnv("SHELL", "/bin/bash");
        // Без args интерактивный bash просто ждёт ввода — проверяем, что он живой,
        // и заодно покрываем дефолт `options.args ?? []`.
        const session = new EmbeddedTerminalSession({ cols: 120, rows: 6 });
        session.write("echo from-env-shell\r");
        await vi.waitFor(
            () => {
                expect(readScreen(session, 6, 120)).toContain("from-env-shell");
            },
            { timeout: 8000, interval: 50 },
        );
        session.dispose();
    }, 20000);

    it("откатывается на bash, когда нет ни options.shell, ни $SHELL", async () => {
        vi.stubEnv("SHELL", undefined);
        const session = new EmbeddedTerminalSession({ cols: 40, rows: 6, args: ["-c", "echo fallback-shell"] });
        await awaitExit(session);
        await vi.waitFor(
            () => {
                expect(readRow(session, 0, 40)).toContain("fallback-shell");
            },
            { timeout: 5000, interval: 50 },
        );
        session.dispose();
    }, 20000);

    it("прокидывает options.env и cwd в шелл", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 60,
            rows: 6,
            shell: "/bin/bash",
            cwd: "/tmp",
            env: { VEXX_MARKER: "custom-env" },
            args: ["-c", "echo $VEXX_MARKER; pwd"],
        });
        await awaitExit(session);
        await vi.waitFor(
            () => {
                expect(readRow(session, 0, 60)).toContain("custom-env");
                expect(readRow(session, 1, 60)).toContain("/tmp");
            },
            { timeout: 5000, interval: 50 },
        );
        session.dispose();
    }, 20000);
});

describe("EmbeddedTerminalSession — write", () => {
    it("доставляет ввод в живой шелл", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 6,
            shell: "/bin/bash",
            args: ["-c", "read -r line; echo got:$line"],
        });
        session.write("ping\r");
        await vi.waitFor(
            () => {
                expect(readRow(session, 1, 40)).toContain("got:ping");
            },
            { timeout: 8000, interval: 50 },
        );
        session.dispose();
    }, 20000);
});

describe("EmbeddedTerminalSession — isExited", () => {
    it("переключается с false на true после выхода шелла", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 6,
            shell: "/bin/bash",
            args: ["-c", "sleep 5"],
        });
        expect(session.isExited).toBe(false);
        session.dispose(); // убивает PTY → onExit
        await vi.waitFor(
            () => {
                expect(session.isExited).toBe(true);
            },
            { timeout: 5000, interval: 25 },
        );
    }, 20000);
});

describe("EmbeddedTerminalSession — resize", () => {
    function liveSession(): EmbeddedTerminalSession {
        return new EmbeddedTerminalSession({
            cols: 40,
            rows: 6,
            shell: "/bin/bash",
            args: ["-c", "sleep 5"],
        });
    }

    it("рефлоует шелл при реальной смене размера", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 6,
            shell: "/bin/bash",
            // Шелл печатает свой размер по SIGWINCH — так виден именно TIOCSWINSZ на
            // реальном tty, а не только внутренний ресайз эмулятора. `stty size` печатает
            // "<rows> <cols>".
            // Короткий sleep в цикле: bash откладывает обработчик trap до конца текущей
            // команды, поэтому один длинный sleep растянул бы тест на всю свою длину.
            args: ["-c", "trap 'stty size' WINCH; while true; do sleep 0.1; done"],
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        session.resize(50, 10);
        await vi.waitFor(
            () => {
                expect(readRow(session, 0, 50)).toContain("10 50");
            },
            { timeout: 8000, interval: 50 },
        );
        session.dispose();
    }, 20000);

    it.each([
        [0, 6],
        [40, 0],
        [-1, 6],
        [40, -1],
    ])(
        "игнорирует неположительный размер %ix%i",
        async (cols, rows) => {
            const session = liveSession();
            // Курсор остаётся читаемым — значит эмулятор не пересобрали под мусорный размер.
            session.resize(cols, rows);
            expect(session.getCursor()).not.toBeNull();
            session.dispose();
        },
        20000,
    );

    it("no-op при совпадении размера с текущим", async () => {
        const session = liveSession();
        expect(() => {
            session.resize(40, 6);
        }).not.toThrow();
        expect(session.getCursor()).not.toBeNull();
        session.dispose();
    }, 20000);

    it("ресайзит эмулятор, но не мёртвый PTY, после выхода шелла", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 6,
            shell: "/bin/bash",
            args: ["-c", "exit 0"],
        });
        await awaitExit(session);
        // Размер ДРУГОЙ (иначе сработал бы ранний no-op) — путь доходит до term.resize,
        // а pty.resize пропускается: обращение к мёртвому PTY бросило бы EBADF.
        expect(() => {
            session.resize(50, 10);
        }).not.toThrow();
        session.dispose();
    }, 20000);
});

describe("EmbeddedTerminalSession — подписки", () => {
    it("зовёт onUpdate на новые данные и перестаёт после dispose подписки", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 6,
            shell: "/bin/bash",
            args: ["-c", "printf one; sleep 1; printf two; sleep 5"],
        });
        const updates: number[] = [];
        const subscription = session.onUpdate(() => updates.push(1));
        await vi.waitFor(
            () => {
                expect(updates.length).toBeGreaterThan(0);
            },
            { timeout: 5000, interval: 25 },
        );

        subscription.dispose();
        const afterDispose = updates.length;
        // Второй кусок вывода уже не должен дёргать снятый колбэк.
        await vi.waitFor(
            () => {
                expect(readRow(session, 0, 40)).toContain("onetwo");
            },
            { timeout: 5000, interval: 25 },
        );
        expect(updates).toHaveLength(afterDispose);
        session.dispose();
    }, 20000);

    it("не зовёт onExit после dispose подписки", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 6,
            shell: "/bin/bash",
            args: ["-c", "sleep 5"],
        });
        const exits: number[] = [];
        const subscription = session.onExit((code) => exits.push(code));
        subscription.dispose();

        session.dispose(); // убивает PTY
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(exits).toEqual([]);
    }, 20000);

    it("раздаёт код выхода всем живым подписчикам", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 6,
            shell: "/bin/bash",
            args: ["-c", "exit 7"],
        });
        const seen: number[] = [];
        session.onExit((code) => seen.push(code));
        session.onExit((code) => seen.push(code * 2));
        await awaitExit(session);

        expect(seen).toEqual([7, 14]);
        session.dispose();
    }, 20000);
});
