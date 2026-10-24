#!/usr/bin/env node
// PreToolUse(Bash): каждое правило — грабля из прошлых сессий, а не вкусовщина.
// Лизу на тяжёлые прогоны проверяет отдельный глобальный хук, здесь её нет.
import { pathToFileURL } from "node:url";

import { parseArgs, PositionalArgumentError } from "../../scripts/mutation-gate.mjs";
import { git, gitSubcommand, runHook, simpleCommands } from "./lib.mjs";

const HTTPS_ORIGIN = "https://github.com/diode-editor/diode.git";

/**
 * Отказ до запуска — чтобы не тратить слот лизы. Позиционность решает сам гейт
 * (`parseArgs`): своя копия логики отказывала на значении любого флага (`--concurrency 4`).
 */
function mutationPositional(words) {
    // Обёртки (`claude-lease run -- …`, `timeout 600 …`) не мешают: ищем саму команду.
    const at = words.findIndex((w, i) => w === "npm" && words[i + 1] === "run" && words[i + 2] === "test:mutation");
    if (at < 0) return undefined;
    const sep = words.indexOf("--", at + 3);
    if (sep < 0) return undefined;
    try {
        parseArgs(words.slice(sep + 1));
    } catch (error) {
        if (!(error instanceof PositionalArgumentError)) return undefined;
        return `Позиционный аргумент «${error.arg}» у \`npm run test:mutation -- …\` — не база гейта:
scripts/mutation-diff.mjs принимает базу только флагом и на позиционный аргумент
выйдет с ошибкой. Передай её флагом (тяжёлый прогон — под лизой):
  claude-lease run -- npm run test:mutation -- --base ${error.arg}`;
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

/** Ключа на машине нет: ssh живёт, только пока проброшен агент (в отвязанной tmux — нет). */
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

const MUTATION_RUN = [
    (w, i) => w[i] === "npm" && w[i + 1] === "run" && w[i + 2] === "test:mutation",
    (w, i) => w[i] === "npx" && w[i + 1] === "stryker",
    (w, i) => w[i] === "node" && /scripts\/(mutation-diff|verify-mutants)\.mjs$/.test(w[i + 1] ?? ""),
];

/**
 * В сессии агентского лупа (`AGENT_LOOP_TASK` в окружении, scripts/agent-loop/README.md) у
 * реализатора 20 минут мутационных прогонов на задачу. Считает их обёртка
 * `mutation-budget.mjs`; прямой запуск мимо неё — обход бюджета. `--scope-only` бесплатен.
 */
function mutationBudget(words, env) {
    const task = env.AGENT_LOOP_TASK;
    if (task === undefined || task === "") return undefined;
    if (words.some((w) => /scripts\/agent-loop\/mutation-budget\.mjs$/.test(w))) return undefined;
    const at = words.findIndex((_, i) => MUTATION_RUN.some((isRun) => isRun(words, i)));
    if (at < 0) return undefined;
    if (words.includes("--scope-only") || words.includes("--help")) return undefined;
    // Обёртки перед прогоном (`claude-lease run --`, `timeout 600`) в подсказку не попадают.
    return `Мутационный прогон в задаче лупа #${task} идёт только через бюджет (20 минут прогонов на задачу,
ожидание лизы не считается):
  claude-lease run -- node scripts/agent-loop/mutation-budget.mjs -- ${words.slice(at).join(" ")}
Код 76 — бюджет исчерпан: дальше только CI, \`npm run ci:run -- mutation\`. Скилл implementer.`;
}

export function checkBash(cmdline, cwd, env = process.env) {
    for (const words of simpleCommands(cmdline)) {
        const why =
            mutationBudget(words, env) ?? mutationPositional(words) ?? fetchPrune(words) ?? pushOverSsh(words, cwd);
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
