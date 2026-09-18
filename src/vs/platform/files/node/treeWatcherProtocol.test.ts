import { describe, expect, it } from "vitest";

import { parseTreeWatcherRequest, parseTreeWatcherResponse } from "./treeWatcherProtocol.ts";

/**
 * Разбор сообщений на границе процессов. Проверяем обе стороны: валидное
 * сообщение доезжает целиком (id, корень, опции), а мусор отсеивается, а не
 * роняет ту сторону — по IPC-каналу к нам может прилететь что угодно, а
 * watcher-процесс и редактор обязаны пережить это молча.
 */
describe("parseTreeWatcherRequest", () => {
    it("разбирает watch со всеми полями", () => {
        expect(
            parseTreeWatcherRequest({
                t: "watch",
                id: 7,
                rootPath: "/repo",
                options: { recursive: true, excludes: ["**/node_modules"] },
            }),
        ).toEqual({
            t: "watch",
            id: 7,
            rootPath: "/repo",
            options: { recursive: true, excludes: ["**/node_modules"] },
        });
    });

    it("разбирает unwatch", () => {
        expect(parseTreeWatcherRequest({ t: "unwatch", id: 3 })).toEqual({ t: "unwatch", id: 3 });
    });

    it("нерекурсивный запрос не превращается в рекурсивный", () => {
        const parsed = parseTreeWatcherRequest({
            t: "watch",
            id: 1,
            rootPath: "/repo/.git",
            options: { recursive: false, excludes: [] },
        });
        expect(parsed).toEqual({
            t: "watch",
            id: 1,
            rootPath: "/repo/.git",
            options: { recursive: false, excludes: [] },
        });
    });

    it.each([
        ["не объект", "watch"],
        ["null", null],
        ["без id", { t: "watch", rootPath: "/repo", options: { recursive: true, excludes: [] } }],
        ["id не число", { t: "watch", id: "7", rootPath: "/repo", options: { recursive: true, excludes: [] } }],
        ["неизвестный тип", { t: "sniff", id: 1 }],
        ["без rootPath", { t: "watch", id: 1, options: { recursive: true, excludes: [] } }],
        ["без options", { t: "watch", id: 1, rootPath: "/repo" }],
        ["options не объект", { t: "watch", id: 1, rootPath: "/repo", options: 42 }],
        ["recursive не булев", { t: "watch", id: 1, rootPath: "/repo", options: { recursive: 1, excludes: [] } }],
        ["excludes не массив", { t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: {} } }],
    ])("отсеивает мусор: %s", (_name, raw) => {
        expect(parseTreeWatcherRequest(raw)).toBeNull();
    });
});

describe("parseTreeWatcherResponse", () => {
    it("разбирает пачку событий", () => {
        const changes = [{ type: "created", path: "/repo/a.ts" }];
        expect(parseTreeWatcherResponse({ t: "changes", id: 2, changes })).toEqual({ t: "changes", id: 2, changes });
    });

    it("пустая пачка — валидное сообщение (а не отсутствие сообщения)", () => {
        expect(parseTreeWatcherResponse({ t: "changes", id: 2, changes: [] })).toEqual({
            t: "changes",
            id: 2,
            changes: [],
        });
    });

    it("разбирает запись лога вместе с хвостом аргументов", () => {
        expect(
            parseTreeWatcherResponse({
                t: "log",
                level: "warn",
                message: "tree watcher error",
                args: [{ code: "ENOSPC" }],
            }),
        ).toEqual({ t: "log", level: "warn", message: "tree watcher error", args: [{ code: "ENOSPC" }] });
    });

    it.each([
        ["не объект", 12],
        ["null", null],
        ["неизвестный тип", { t: "hello" }],
        ["changes без id", { t: "changes", changes: [] }],
        ["changes не массив", { t: "changes", id: 1, changes: "a.ts" }],
        ["log без уровня", { t: "log", message: "hi", args: [] }],
        ["log с чужим уровнем", { t: "log", level: "fatal", message: "hi", args: [] }],
        ["log без сообщения", { t: "log", level: "warn", args: [] }],
        ["log без args", { t: "log", level: "warn", message: "hi" }],
    ])("отсеивает мусор: %s", (_name, raw) => {
        expect(parseTreeWatcherResponse(raw)).toBeNull();
    });
});
