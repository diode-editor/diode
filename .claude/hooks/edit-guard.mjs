#!/usr/bin/env node
// PreToolUse(Edit|Write|NotebookEdit): сессия живёт в worktree
// (`<репо>/.claude/worktrees/<имя>`), а правка целится в тот же репозиторий
// МИМО него — в основной checkout или в соседний worktree. Так правки уже
// уезжали в main: путь собран от корня репозитория по памяти, а не от
// текущего worktree. Файлы вне репозитория (память, scratchpad) не трогаем.
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runHook } from "./lib.mjs";

const WORKTREE_RE = /^(.*?)[/\\]\.claude[/\\]worktrees[/\\]([^/\\]+)/;

export function checkEdit(filePath, cwd) {
    const m = WORKTREE_RE.exec(cwd);
    if (m === null) return undefined;
    const root = m[1];
    const worktree = m[0];
    const target = path.resolve(cwd, filePath);
    const inside = (dir) => target === dir || target.startsWith(dir + path.sep);
    if (!inside(root) || inside(worktree)) return undefined;

    const rel = path.relative(root, target);
    const other = WORKTREE_RE.exec(target);
    const fixed = other === null ? path.join(worktree, rel) : path.join(worktree, path.relative(other[0], target));
    return `Сессия работает в worktree ${worktree}, а правка целится мимо него:
  ${target}
${other === null ? "Это основной checkout репозитория" : `Это соседний worktree «${other[2]}»`} — правка уехала бы не в ту ветку.
Скорее всего, нужен этот путь:
  ${fixed}
Хук пропускает только пути внутри текущего worktree; если чужое дерево и правда нужно
править — согласуй это с человеком.`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    runHook((input) => {
        const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
        if (typeof file !== "string" || typeof input.cwd !== "string") return undefined;
        const why = checkEdit(file, input.cwd);
        return why === undefined ? undefined : { block: why };
    });
}
