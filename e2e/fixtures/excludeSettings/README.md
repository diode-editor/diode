# Фикстура слоя exclude-настроек

Один и тот же токен `kettleBrightSignal` лежит в пяти местах:

- `app.py` — исходник, его человек и правит;
- `README.md` — этот файл;
- `build/generated.js` — каталог `build` дефолтом не скрыт нигде, как у эталона
  (что генерируется, отсекает `.gitignore`);
- `__pycache__/app.cpython-312.pyc` — байткод, скрыт дефолтом `files.exclude`;
- `bower_components/vendored.js` — зависимость, скрыта дефолтом `search.exclude`
  (в дереве видна).
