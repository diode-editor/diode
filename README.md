# bench-data

Ветка данных бенчмарков Diode. Пишет её джоба `.github/workflows/bench.yml`
(раз в неделю и по кнопке) через `scripts/bench-publish.mjs`; руками сюда не коммитят.
История нужна странице <https://diode-editor.github.io/benchmarks/> — она читает
`open/index.json` и сырые отчёты отсюда через raw.githubusercontent.com.

- `open/index.json` — список прогонов (новые в конце);
- `open/<дата>-<коммит>.json` — отчёт прогона, формат — `FullReport` из `e2e/bench/openReport.ts`;
- `open/latest.json`, `open/latest.md` — последний прогон.

Методика и что меряется — `docs/public/BENCH-OPEN.md` в `main`.
