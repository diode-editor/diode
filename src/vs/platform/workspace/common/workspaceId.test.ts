import * as crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { computeWorkspaceId } from "./workspaceId.ts";

describe("computeWorkspaceId", () => {
    // The format is a layout already on users' disks: changing the formula means migrating directories.
    it("даёт sha256-hex от абсолютного пути папки — формат vscode", () => {
        const expected = crypto.createHash("sha256").update("/projects/app").digest("hex");
        expect(computeWorkspaceId("/projects/app")).toBe(expected);
        expect(computeWorkspaceId("/projects/app")).toMatch(/^[0-9a-f]{64}$/);
    });

    // The same folder named differently must yield ONE project:
    // otherwise `diode .` and `diode /abs/path` would open different session stores.
    it("нормализует путь перед хешированием", () => {
        const canonical = computeWorkspaceId("/projects/app");
        expect(computeWorkspaceId("/projects/app/")).toBe(canonical);
        expect(computeWorkspaceId("/projects/./app")).toBe(canonical);
        expect(computeWorkspaceId("/projects/sub/../app")).toBe(canonical);
    });

    it("разные папки — разные id", () => {
        expect(computeWorkspaceId("/projects/a")).not.toBe(computeWorkspaceId("/projects/b"));
    });

    it("относительный путь резолвится от cwd", () => {
        expect(computeWorkspaceId("sub/dir")).toBe(computeWorkspaceId(`${process.cwd()}/sub/dir`));
    });
});
