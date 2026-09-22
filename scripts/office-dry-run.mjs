#!/usr/bin/env node
/**
 * Прогон петли офиса на заглушках: без моделей, без денег, без git.
 *
 * Манифест `office.yaml` — это конечный автомат, и сломать его опечаткой в имени состояния
 * ничего не стоит: офис просто молча не поднимет роль. Этот скрипт проверяет автомат целиком —
 * вбрасывает заявку, отвечает за человека и смотрит, доезжает ли она куда обещано.
 *
 *   node scripts/office-dry-run.mjs              все сценарии
 *   node scripts/office-dry-run.mjs фича баг     только названные
 *
 * Роли играют заглушки: офис поднимает не claude, а каталог `office/fake/<сценарий>/<роль>/`,
 * файлы из которого просто кладутся агенту в `out/`. Общие для всех сценариев заготовки —
 * в `office/fake/общее/`; сценарий их дополняет и переопределяет.
 */

import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", cwd: import.meta.dirname }).trim();
const fakeRoot = path.join(repoRoot, "office", "fake");

// ── Сценарии ────────────────────────────────────────────────────────────────

/**
 * `answers` — что человек отвечает на каждое обращение офиса (по id объявления из `requests`).
 * `done(мир, след)` — чего мы ждём: снимка мира и следа узла n-1 по состояниям.
 */
const SCENARIOS = {
    фича: {
        title: "фича: диспетчер → аналитик → согласование → реализация → сверка → тестирование → итерация → приёмка",
        request: { описание: "Хочу, чтобы дерево файлов показывало git-статус цветом, как в vscode" },
        answers: { постановка: "делаем", "приёмка-заявки": "принять" },
        done: (world) => stateOf(world, "n-1") === "готово",
    },
    баг: {
        title: "баг: диспетчер → тестировщик закрепляет тестом → реализация → сверка → тестирование → итерация",
        request: { описание: "Ctrl+Z после quick fix перемешивает текст — регрессия" },
        answers: { "приёмка-заявки": "принять" },
        done: (world) => stateOf(world, "n-1") === "готово",
    },
    возврат: {
        title: "возврат: человек не принял влитую заявку → откатчик снимает её со сборки → к аналитику",
        request: { описание: "Хочу палитру команд на Ctrl+Shift+P" },
        answers: { постановка: "делаем", "приёмка-заявки": "вернуть" },
        done: (world, trail) => trail.includes("к откату") && trail.includes("к анализу"),
    },
    цель: {
        title: "цель: диспетчер → декомпозитор → учётный узел с детьми, дети входят той же дверью",
        request: { описание: "Цель: довести работу с git до уровня vscode" },
        answers: {},
        done: (world) => stateOf(world, "n-1") === "разбита" && world.nodes.filter((node) => node.parent === "n-1").length >= 2,
    },
    итерация: {
        title: "итерация: сборка PR → приёмка человеком → релиз → ретроспектива",
        request: { описание: "Закрыть итерацию 01 и собрать PR" },
        answers: { "приёмка-итерации": "вливать" },
        done: (world) => stateOf(world, "n-1") === "готово",
    },
};

const stateOf = (world, id) => world.nodes.find((node) => node.id === id)?.state;

// ── Один прогон ─────────────────────────────────────────────────────────────

const officeBin = () => {
    const bin = process.env.DIODE_OFFICE_BIN ?? path.join(repoRoot, "node_modules", "@tihonove", "agent-office", "dist", "agent-office.js");
    if (!existsSync(bin)) {
        throw new Error("Нет @tihonove/agent-office — поставь зависимости: npm ci");
    }
    return bin;
};

/** Временный проект: манифест и промпты — наши настоящие, исполнители — заглушки сценария. */
function prepareProject(name) {
    const project = mkdtempSync(path.join(os.tmpdir(), `diode-office-${name}-`));
    cpSync(path.join(repoRoot, "office.yaml"), path.join(project, "office.yaml"));
    cpSync(path.join(repoRoot, "office", "roles"), path.join(project, "office", "roles"), { recursive: true });
    cpSync(path.join(fakeRoot, "общее"), path.join(project, "fake"), { recursive: true });
    const overrides = path.join(fakeRoot, name);
    if (existsSync(overrides)) {
        cpSync(overrides, path.join(project, "fake"), { recursive: true });
    }
    return project;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(port, method, route, body) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`${method} ${route} → ${response.status} ${await response.text()}`);
    }
    return response.json();
}

/** След узла по журналу: как он шёл по состояниям. Это и есть читаемый результат прогона. */
async function trail(port, id) {
    const facts = await api(port, "GET", "/api/facts");
    const steps = facts.filter((fact) => fact.node === id && fact.type === "node.state").map((fact) => fact.payload.to);
    const created = facts.find((fact) => fact.node === id && fact.type === "node.created");
    return [created?.payload.state, ...steps].filter(Boolean).join(" → ");
}

async function runScenario(name, port) {
    const scenario = SCENARIOS[name];
    const project = prepareProject(name);
    const office = spawn(process.execPath, [officeBin(), project, "--fake", "--port", String(port), "--tick", "200"], {
        stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [];
    office.stdout.on("data", (chunk) => output.push(String(chunk)));
    office.stderr.on("data", (chunk) => output.push(String(chunk)));

    try {
        for (let attempt = 0; attempt < 50; attempt++) {
            try {
                await api(port, "GET", "/api/snapshot");
                break;
            } catch {
                await sleep(100);
            }
        }
        await api(port, "POST", "/api/nodes", { fields: scenario.request });

        const deadline = Date.now() + (scenario.within ?? 60) * 1000;
        for (;;) {
            const world = await api(port, "GET", "/api/snapshot");
            const walked = await trail(port, "n-1");

            // Человек в контуре: отвечаем ровно так, как задумано сценарием.
            for (const request of world.requests) {
                const decl = request.openedBy.decl;
                if (request.answer || !decl || !(decl in scenario.answers)) {
                    continue;
                }
                await api(port, "POST", `/api/requests/${request.id}/answer`, { answer: scenario.answers[decl] });
            }

            if (scenario.done(world, walked)) {
                return { ok: true, trail: walked, nodes: world.nodes.length };
            }
            if (Date.now() > deadline) {
                const stuck = world.nodes.map((node) => `${node.id} · ${node.state}`).join(", ");
                const unanswered = world.requests.filter((request) => !request.answer).map((request) => request.openedBy.decl ?? "вопрос агента");
                return {
                    ok: false,
                    trail: walked,
                    why: `не доехало за ${scenario.within ?? 60}с. Узлы: ${stuck}. Без ответа: ${unanswered.join(", ") || "нет"}`,
                    log: output.join("").split("\n").slice(-25).join("\n"),
                };
            }
            await sleep(200);
        }
    } finally {
        office.kill("SIGTERM");
        await sleep(100);
        // Проекции офис кладёт только на чтение — иначе каталог не удалить.
        execFileSync("chmod", ["-R", "u+w", project]);
        rmSync(project, { recursive: true, force: true });
    }
}

// ── Все сценарии подряд ─────────────────────────────────────────────────────

const asked = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const names = asked.length ? asked : Object.keys(SCENARIOS);

const unknown = names.filter((name) => !(name in SCENARIOS));
if (unknown.length) {
    console.error(`Не знаю сценариев: ${unknown.join(", ")}. Есть: ${Object.keys(SCENARIOS).join(", ")}`);
    process.exit(2);
}

let failed = 0;
let port = 4801;
for (const name of names) {
    const scenario = SCENARIOS[name];
    process.stdout.write(`\n── ${name} ──\n${scenario.title}\n`);
    const result = await runScenario(name, port++);
    if (result.ok) {
        console.log(`✓ ${result.trail}`);
        console.log(`  узлов в мире: ${result.nodes}`);
    } else {
        failed++;
        console.log(`✗ ${result.why}`);
        console.log(`  след n-1: ${result.trail}`);
        console.log(result.log.replace(/^/gm, "  | "));
    }
}

console.log(`\n${names.length - failed} из ${names.length} сценариев прошли.`);
process.exit(failed ? 1 : 0);
