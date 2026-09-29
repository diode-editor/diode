import * as crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { computeWorkspaceId } from "./workspaceId.ts";

describe("computeWorkspaceId", () => {
    // Формат — не деталь реализации, а раскладка, которая уже лежит у
    // пользователей на диске (`workspaceStorage/<id>/`): PR вводит ПОНЯТИЕ id,
    // а не новую схему адресации. Смена формулы = миграция каталогов.
    it("даёт sha256-hex от абсолютного пути папки — формат vscode", () => {
        const expected = crypto.createHash("sha256").update("/projects/app").digest("hex");
        expect(computeWorkspaceId("/projects/app")).toBe(expected);
        expect(computeWorkspaceId("/projects/app")).toMatch(/^[0-9a-f]{64}$/);
    });

    // Одна и та же папка, названная по-разному, обязана давать ОДИН проект:
    // иначе `diode .` и `diode /abs/path` открыли бы разные сторы сессии.
    it("нормализует путь перед хешированием", () => {
        const canonical = computeWorkspaceId("/projects/app");
        expect(computeWorkspaceId("/projects/app/")).toBe(canonical);
        expect(computeWorkspaceId("/projects/./app")).toBe(canonical);
        expect(computeWorkspaceId("/projects/sub/../app")).toBe(canonical);
    });

    it("разные папки — разные id", () => {
        expect(computeWorkspaceId("/projects/a")).not.toBe(computeWorkspaceId("/projects/b"));
    });

    // Относительный путь резолвится от cwd — тот же `path.resolve`, что стоял
    // в `resolveWorkspaceStorageDir` до выделения идентичности.
    it("относительный путь резолвится от cwd", () => {
        expect(computeWorkspaceId("sub/dir")).toBe(computeWorkspaceId(`${process.cwd()}/sub/dir`));
    });
});
