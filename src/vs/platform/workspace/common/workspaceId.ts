import * as crypto from "node:crypto";
import * as path from "node:path";

import type { WorkspaceId } from "./iWorkspaceContextService.ts";

/**
 * Вычисляет {@link WorkspaceId} для воркспейса из одной папки: `sha256` от
 * абсолютного (нормализованного) пути, hex — ровно как в VS Code
 * (`workspaceStorage/<hash>/`). Pure, без I/O.
 *
 * Формат намеренно совпадает с тем, что уже лежит у пользователей на диске:
 * этот PR вводит **понятие** id, а не новую схему адресации. Когда «один
 * проект» станет набором папок или файлом `.code-workspace`, id начнёт
 * выводиться иначе — и вот тогда понадобится миграция, которую предстоит
 * сделать здесь, в одной функции (см. `docs/TODO/MultiRoot.md`, M8).
 */
export function computeWorkspaceId(folderPath: string): WorkspaceId {
    return crypto.createHash("sha256").update(path.resolve(folderPath)).digest("hex");
}
