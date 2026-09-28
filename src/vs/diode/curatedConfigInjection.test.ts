import { describe, expect, it } from "vitest";

import { curatedConfigInjection } from "./curatedConfigInjection.ts";

describe("curatedConfigInjection", () => {
    it("basedpyright: вшитый сервер вместо поиска pip-установки", () => {
        expect(curatedConfigInjection("detachhead.basedpyright")).toEqual({
            "basedpyright.importStrategy": "useBundled",
        });
    });

    it("ruff: вшитый нативный сервер вместо сканирования окружения", () => {
        expect(curatedConfigInjection("charliermarsh.ruff")).toEqual({ "ruff.importStrategy": "useBundled" });
    });

    it("redhat.java: lombok-агент выключен — с ним jdt.ls 1.57 на JDK 21 не компилирует", () => {
        expect(curatedConfigInjection("redhat.java")).toEqual({ "java.jdt.ls.lombokSupport.enabled": false });
    });

    it("redhat.java: updateBuildConfiguration НЕ трогаем — вопрос человеку у нас отвечаем", () => {
        expect(curatedConfigInjection("redhat.java")).not.toHaveProperty("java.configuration.updateBuildConfiguration");
    });

    it("незнакомое расширение — пустой слой, манифестные дефолты не трогаются", () => {
        expect(curatedConfigInjection("vscjava.vscode-java-dependency")).toEqual({});
        expect(curatedConfigInjection("")).toEqual({});
    });

    it("id сравнивается целиком, а не префиксом", () => {
        expect(curatedConfigInjection("redhat.java-debug")).toEqual({});
        expect(curatedConfigInjection("charliermarsh.ruff-lsp")).toEqual({});
    });
});
