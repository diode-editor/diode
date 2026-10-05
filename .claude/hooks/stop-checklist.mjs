#!/usr/bin/env node
// Stop: мягкий чеклист «готово» по диффу ветки (AGENTS.md, «Что считать готово»).
//
// Молчит, пока ветка не отличается от origin/main. Каждый пункт напоминает
// ОДИН раз (линт/типы — раз за сессию, остальное — раз на ветку): состояние
// лежит в git-каталоге worktree. Напоминание приходит модели продолжением хода
// (`decision: block` — единственный способ до неё достучаться из Stop), и текст
// прямо разрешает закончить, если пункт неприменим. Повторный Stop в том же
// ходу (`stop_hook_active`) пропускается — петли нет.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { git, runHook } from "./lib.mjs";

const TRANSCRIPT_LIMIT = 64 * 1024 * 1024;
const CODE_RE = /^(src|extensions)\/.+\.ts$/;
// Запуск — это Bash-вызов в транскрипте (`"command":"…"`), а не упоминание:
// AGENTS.md, прочитанный в начале сессии, тоже содержит `npm run lint`.
const STATIC_RUN_RE = /"command":"(?:[^"\\]|\\.)*(?:npm run (?:lint|typecheck|check:diff)\b|npx (?:tsc|eslint)\b)/;

/**
 * Пункты чеклиста по фактам ветки. Чистая функция — тестируется без git.
 * @param {{ files: string[], subjects: string[], transcript: string }} facts
 */
export function checklist({ files, subjects, transcript }) {
    const items = [];
    if (files.some((f) => CODE_RE.test(f)) && !STATIC_RUN_RE.test(transcript)) {
        items.push({
            id: "static",
            scope: "session",
            text: "Линт и типы в этой сессии не прогонялись: `npm run check:diff` (быстро) или `npm run lint` + `npm run typecheck` перед сдачей.",
        });
    }
    const visible = subjects.some((s) => /^feat(\(.+\))?!?:/.test(s));
    if (visible && !files.some((f) => f.startsWith("e2e/scenarios/"))) {
        items.push({
            id: "scenario",
            scope: "branch",
            text: "В ветке есть `feat`-коммит, а в `e2e/scenarios/` ничего не менялось. Видимой фиче нужен сценарий-демо (docs/PR.md).",
        });
    }
    if (files.includes("src/vscode-dts/vscode.d.ts") && !files.includes("docs/public/API-COVERAGE.md")) {
        items.push({
            id: "api-coverage",
            scope: "branch",
            text: "`vscode.d.ts` изменён, а `docs/public/API-COVERAGE.md` — нет. Матрица обновляется в том же PR.",
        });
    }
    return items;
}

function lines(s) {
    return s.split("\n").filter(Boolean);
}

function readTranscript(p) {
    try {
        if (typeof p !== "string" || statSync(p).size > TRANSCRIPT_LIMIT) return "";
        return readFileSync(p, "utf8");
    } catch {
        return "";
    }
}

function gather(cwd, transcriptPath) {
    const base = git(cwd, ["merge-base", "origin/main", "HEAD"]).trim();
    const files = new Set([
        ...lines(git(cwd, ["diff", "--name-only", base])),
        ...lines(git(cwd, ["ls-files", "--others", "--exclude-standard"])),
    ]);
    if (files.size === 0) return undefined;
    const subjects = lines(git(cwd, ["log", "--format=%s", `${base}..HEAD`]));
    return { files: [...files], subjects, transcript: readTranscript(transcriptPath) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    runHook((input) => {
        if (input.stop_hook_active === true || typeof input.cwd !== "string") return undefined;
        const cwd = input.cwd;
        const branch = git(cwd, ["branch", "--show-current"]).trim();
        if (branch === "" || branch === "main") return undefined;
        const facts = gather(cwd, input.transcript_path);
        if (facts === undefined) return undefined;

        const stateFile = path.resolve(cwd, git(cwd, ["rev-parse", "--git-dir"]).trim(), "claude-stop-checklist.json");
        const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
        const keyOf = (item) => `${item.id}@${item.scope === "session" ? String(input.session_id) : branch}`;
        const fresh = checklist(facts).filter((item) => state[keyOf(item)] !== true);
        if (fresh.length === 0) return undefined;
        for (const item of fresh) state[keyOf(item)] = true;
        writeFileSync(stateFile, JSON.stringify(state));

        return {
            json: {
                decision: "block",
                reason: `Напоминание по чеклисту «готово» (AGENTS.md) для ветки ${branch} — разово, не гейт:
${fresh.map((i) => `- ${i.text}`).join("\n")}
Если пункт уже закрыт или к этой работе не относится — ответь одной строкой и заканчивай.`,
            },
        };
    });
}
