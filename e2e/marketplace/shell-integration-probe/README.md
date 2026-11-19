# Shell Integration Probe

Синтетическое расширение: пишет в свой канал OUTPUT «Shell Integration Probe» каждое событие shell
integration из API терминала — то, что видят агенты (Cline, Roo Code, Claude Code). Активируется по
`onTerminalShellIntegration:*`, то есть только когда в каком-то терминале ожила интеграция.

Строки канала:

- `activated`, затем `shellIntegration on activation: terminal "bash", cwd=…` — терминалы, у которых интеграция
  ожила до активации (их `changed` прошёл мимо);
- `shellIntegration changed: terminal "bash", cwd=…` — `onDidChangeTerminalShellIntegration` (смена cwd, окружения);
- `start: "ls" (High, trusted) cwd=… terminal "bash"` — `onDidStartTerminalShellExecution`: командная строка,
  confidence, isTrusted, cwd;
- `data: "\u001b]633;C\u0007…"` — куски `execution.read()`, первые 200 символов, экранированно (JSON);
- `end: "ls" (High, trusted) exit=0` — `onDidEndTerminalShellExecution`;
- `executeCommand: …` — команда **Shell Integration Probe: Execute Command** (строка из поля ввода уходит в
  `shellIntegration.executeCommand` активного терминала).

## Поставить руками

Из корня репозитория, одной командой (`diode` — бинарь или `npm start --`):

```sh
node scripts/pack-vsix.mjs e2e/marketplace/shell-integration-probe /tmp/shell-integration-probe.vsix && diode --install-extension /tmp/shell-integration-probe.vsix
```

Потом открыть терминал, выполнить `ls`, `false`, `cd /tmp` и посмотреть OUTPUT → «Shell Integration Probe».

Герметичный e2e и демо — сценарий `e2e/scenarios/shellIntegrationProbe.scenario.ts`.
