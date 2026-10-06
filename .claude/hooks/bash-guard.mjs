#!/usr/bin/env node
// PreToolUse(Bash): команды, которые в этом репозитории молча делают не то.
// Каждое правило — грабля из прошлых сессий (память проекта), а не вкусовщина.
// Лизу на тяжёлые прогоны проверяет отдельный глобальный хук, здесь её нет.
import { pathToFileURL } from "node:url";

import { git, gitSubcommand, runHook, simpleCommands } from "./lib.mjs";

const HTTPS_ORIGIN = "https://github.com/diode-editor/diode.git";

/**
 * `npm run test:mutation -- <ref>`: база гейта задаётся только флагом
 * `--base <ref>`, позиционный аргумент mutation-diff.mjs отвергает (раньше он
 * молча уезжал Stryker'у как имя конфига, а база оставалась `main`). Хук
 * отказывает ещё до запуска — чтобы не тратить на это слот лизы.
 */
function mutationPositional(words) {
    // Обёртки (`claude-lease run -- …`, `timeout 600 …`) не мешают: ищем саму команду.
    const at = words.findIndex((w, i) => w === "npm" && words[i + 1] === "run" && words[i + 2] === "test:mutation");
    if (at < 0) return undefined;
    const sep = words.indexOf("--", at + 3);
    if (sep < 0) return undefined;
    const rest = words.slice(sep + 1);
    for (let i = 0; i < rest.length; i++) {
        const w = rest[i];
        if (w.startsWith("-")) {
            // `--base <ref>` / `--since <ref>` — значение флага, а не позиционный.
            if (!w.includes("=") && /^--(base|since)$/.test(w)) i++;
            continue;
        }
        return `Позиционный аргумент «${w}» у \`npm run test:mutation -- …\` — не база гейта:
scripts/mutation-diff.mjs принимает базу только флагом и на позиционный аргумент
выйдет с ошибкой. Передай её флагом (тяжёлый прогон — под лизой):
  claude-lease run -- npm run test:mutation -- --base ${w}`;
    }
    return undefined;
}

/**
 * `git fetch <url> <src>:refs/remotes/…`: при `fetch.prune=true` (стоит на этой
 * машине) fetch по URL с явным refspec в refs/remotes/ считает «лишними» все
 * остальные ref'ы этого пространства и УДАЛЯЕТ их.
 */
function fetchPrune(words) {
    const g = gitSubcommand(words);
    if (g?.sub !== "fetch") return undefined;
    if (g.args.includes("--no-prune")) return undefined;
    const positional = g.args.filter((a) => !a.startsWith("-"));
    const [repo, ...refspecs] = positional;
    if (repo === undefined || !/^(https?:|ssh:|git@|file:|\/|\.\.?\/)/.test(repo)) return undefined;
    if (!refspecs.some((r) => r.includes(":refs/remotes/"))) return undefined;
    return `\`git fetch <url> …:refs/remotes/…\` без \`--no-prune\` удаляет ref'ы: на этой машине
fetch.prune=true, и всё, чего нет в явном refspec, считается удалённым на сервере.

Обнови origin/main так:
  git fetch origin main          (именованный remote, ref'ы не трогаются)
или добавь \`--no-prune\` к своей команде.`;
}

/**
 * `git push` на ssh-remote: своего ключа на машине нет, ssh живёт, только пока
 * проброшен агент (в отвязанной tmux-сессии его уже нет) — правило проекта:
 * push только по https.
 */
function pushOverSsh(words, cwd) {
    const g = gitSubcommand(words);
    if (g?.sub !== "push") return undefined;
    const positional = [];
    for (let i = 0; i < g.args.length; i++) {
        const a = g.args[i];
        if (a === "-o" || a === "--push-option" || a === "--repo" || a === "--receive-pack" || a === "--exec") {
            i++;
            continue;
        }
        if (!a.startsWith("-")) positional.push(a);
    }
    const target = positional[0];
    let url;
    if (target !== undefined && /^(https?:|ssh:|git@|file:|\/)/.test(target)) {
        url = target;
    } else {
        const remote = target ?? "origin";
        try {
            url = git(g.dir ?? cwd, ["remote", "get-url", "--push", remote]).trim();
        } catch {
            return undefined;
        }
    }
    if (!/^(ssh:|git@)/.test(url)) return undefined;
    return `Push по ssh (${url}) в этом репозитории не делаем: своего ключа на машине нет, ssh
работает лишь пока проброшен агент. Push — только по https:
  git push ${HTTPS_ORIGIN} <ветка>
Перезапись ветки — только с явным SHA (без него --force-with-lease по URL ничего не защищает):
  git push --force-with-lease=refs/heads/<ветка>:<sha-на-сервере> ${HTTPS_ORIGIN} <ветка>
(<sha-на-сервере> — из \`git ls-remote ${HTTPS_ORIGIN} refs/heads/<ветка>\` ДО rebase.)`;
}

export function checkBash(cmdline, cwd) {
    for (const words of simpleCommands(cmdline)) {
        const why = mutationPositional(words) ?? fetchPrune(words) ?? pushOverSsh(words, cwd);
        if (why !== undefined) return why;
    }
    return undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    runHook((input) => {
        if (input.tool_name !== "Bash") return undefined;
        const cmd = String(input.tool_input?.command ?? "");
        const why = checkBash(cmd, input.cwd ?? process.cwd());
        return why === undefined ? undefined : { block: why };
    });
}
