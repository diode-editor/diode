// Витрина на :7777 — HTML + JSON + кнопки.
//
// Она ничего не решает и не считает: только показывает то, что вывели inspect.ts
// и history.ts. Кнопка у каждой роли запускает её немедленно; STOP — аварийный тормоз.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";

import type { AgentsConfig } from "./config.ts";
import { tail } from "./history.ts";
import { listAgents } from "./inspect.ts";
import { RUNS_DIR, STOP_FILE } from "./paths.ts";

/** Сколько записей журнала показывать. Файл append-only и растёт — читаем только хвост. */
export const HISTORY_ON_PAGE = 20;

export interface DashboardDeps {
    getConfig: () => AgentsConfig;
    /** Запустить роль немедленно. false — если такой запуск уже идёт. */
    requestRun: (role: string) => boolean;
    running: () => string[];
}

export function isStopped(): boolean {
    return existsSync(STOP_FILE);
}

export function setStopped(stopped: boolean): void {
    mkdirSync(RUNS_DIR, { recursive: true });
    if (stopped) writeFileSync(STOP_FILE, `${new Date().toISOString()}\n`, "utf8");
    else if (existsSync(STOP_FILE)) rmSync(STOP_FILE);
}

async function buildState(deps: DashboardDeps) {
    const config = deps.getConfig();
    return {
        stopped: isStopped(),
        running: deps.running(),
        roles: Object.entries(config.roles).map(([name, spec]) => ({
            name,
            skill: spec.skill,
            everyMin: spec.everyMin,
            worktree: spec.worktree,
            mode: spec.mode,
        })),
        agents: await listAgents(),
        history: tail(HISTORY_ON_PAGE).reverse(),
    };
}

function json(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body, null, 2));
}

export function createDashboard(deps: DashboardDeps): Server {
    return createServer((request, response) => {
        void (async () => {
            const url = new URL(request.url ?? "/", "http://localhost");
            try {
                if (request.method === "POST" && url.pathname === "/api/run") {
                    const role = url.searchParams.get("role") ?? "";
                    if (!deps.getConfig().roles[role]) {
                        json(response, 404, { error: `нет роли "${role}"` });
                        return;
                    }
                    if (!deps.requestRun(role)) {
                        json(response, 409, { error: `роль "${role}" уже выполняется` });
                        return;
                    }
                    json(response, 202, { queued: role });
                    return;
                }
                if (request.method === "POST" && url.pathname === "/api/stop") {
                    const next = !isStopped();
                    setStopped(next);
                    json(response, 200, { stopped: next });
                    return;
                }
                if (url.pathname === "/api/state") {
                    json(response, 200, await buildState(deps));
                    return;
                }
                if (url.pathname === "/") {
                    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
                    response.end(PAGE);
                    return;
                }
                json(response, 404, { error: "not found" });
            } catch (error) {
                json(response, 500, { error: error instanceof Error ? error.message : String(error) });
            }
        })();
    });
}

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>diode agents</title>
<style>
  body { font: 13px/1.5 ui-monospace, monospace; margin: 2rem; background: #111; color: #ddd; }
  h1 { font-size: 1.1rem; margin: 0 0 1rem; }
  h2 { font-size: .95rem; color: #888; font-weight: normal; margin: 1.6rem 0 .5rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .3rem .6rem; border-bottom: 1px solid #2a2a2a; vertical-align: top; }
  th { color: #777; font-weight: normal; }
  button { font: inherit; padding: .3rem .8rem; margin-right: .4rem; cursor: pointer;
           background: #222; color: #ddd; border: 1px solid #444; border-radius: 4px; }
  button:hover { background: #2c2c2c; }
  .bad { color: #e06c75; } .good { color: #98c379; } .warn { color: #e5c07b; } .dim { color: #666; }
  td.cmd { color: #666; font-size: 11px; word-break: break-all; }
</style>
<h1>diode agents</h1>
<div id="roles"></div>
<div style="margin-top:.6rem"><button id="stop">STOP</button><span id="mode"></span></div>

<h2>Агенты</h2>
<table id="agents"><thead><tr>
  <th>ключ<th>статус<th>возраст, мин<th>ветка<th>сессия
</tr></thead><tbody></tbody></table>

<h2>Журнал — последние 20</h2>
<table id="history"><thead><tr>
  <th>время<th>событие<th>роль / ключ<th>кто дёрнул<th>подробности
</tr></thead><tbody></tbody></table>

<script>
const el = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[<>&]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]));
const time = s => esc(String(s).slice(11, 19));

function historyRow(e) {
  if (e.kind === "launch") {
    const how = e.session === "resume" ? "<span class=warn>продолжает сессию</span>"
              : e.session === "create" ? "новая сессия" : "разовый запуск";
    return "<td>" + time(e.at) + "<td class=good>запуск<td>" + esc(e.key) +
           "<td>" + esc(e.trigger) + " / " + esc(e.by) +
           "<td>" + how + "<br><span class=cmd>" + esc(e.cmd) + "</span>";
  }
  if (e.kind === "finish")
    return "<td>" + time(e.at) + "<td class=" + (e.ok ? "good" : "bad") + ">итог<td>" + esc(e.key) +
           "<td class=dim>—<td>" + Math.round(e.durationMs / 1000) + "с · " + esc(e.summary).slice(0, 300);
  if (e.kind === "stop")
    return "<td>" + time(e.at) + "<td class=warn>остановлен<td>" + esc(e.key) + "<td>" + esc(e.by) + "<td class=dim>—";
  return "<td>" + time(e.at) + "<td class=bad>ошибка<td>" + esc(e.key ?? "—") + "<td class=dim>—<td>" + esc(e.message);
}

async function refresh() {
  const state = await (await fetch("/api/state")).json();
  el("mode").textContent = state.stopped ? " ОСТАНОВЛЕНО — по расписанию ничего не запускается" : " работает";
  el("mode").className = state.stopped ? "bad" : "good";

  el("roles").innerHTML = state.roles.map(r =>
    "<button data-role=" + r.name + ">" + r.name +
    (r.everyMin ? " (" + r.everyMin + "м)" : "") +
    (state.running.includes(r.name) ? " ⏳" : "") + "</button>").join("");
  for (const b of el("roles").children)
    b.onclick = async () => {
      const r = await fetch("/api/run?role=" + b.dataset.role, { method: "POST" });
      if (r.status === 409) alert("Эта роль уже выполняется");
      refresh();
    };

  el("agents").tBodies[0].innerHTML = state.agents.map(a =>
    "<tr><td>" + esc(a.key) + "<td>" + esc(a.status ?? "—") + (a.state ? " / " + esc(a.state) : "") +
    "<td>" + a.ageMin + "<td>" + esc(a.branch ?? "—") +
    "<td class=cmd>" + esc(a.sessionId) + "</tr>").join("") ||
    "<tr><td colspan=5 class=dim>никого</td></tr>";

  el("history").tBodies[0].innerHTML =
    state.history.map(e => "<tr>" + historyRow(e) + "</tr>").join("") ||
    "<tr><td colspan=5 class=dim>пусто</td></tr>";
}
el("stop").onclick = async () => { await fetch("/api/stop", { method: "POST" }); refresh(); };
refresh();
setInterval(refresh, 5000);
</script>
`;
