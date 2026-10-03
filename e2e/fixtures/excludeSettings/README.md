# Фикстура слоя exclude-настроек

Один и тот же токен `kettleBrightSignal` лежит в четырёх местах:

- `app.py` — исходник, его человек и правит;
- `README.md` — этот файл;
- `__pycache__/app.cpython-312.pyc` — байткод, скрыт дефолтом `files.exclude`;
- `out/bundle.js` — результат сборки, скрыт дефолтом `search.exclude` (в дереве
  виден).
