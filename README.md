# drop-of-taste

Адаптивный сайт (этап 1) с последующей упаковкой в Android/iOS (этап 2). Правила разработки — [CLAUDE.md](CLAUDE.md), журнал решений — [CHANGES.md](CHANGES.md).

## Стек

Vite 8 · React 19 · TypeScript (strict) · React Router 7 · Zustand 5 · CSS Modules + CSS custom properties · Vitest + React Testing Library · ESLint 9 · Prettier.

## Запуск

Требуется Node.js 24+ и npm (единственный package manager проекта).

```bash
npm install
npm run dev
```

## Команды

| Команда             | Назначение                                  |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | Dev-сервер Vite                             |
| `npm run dev:db`    | Временная локальная MongoDB на порту 27017  |
| `npm run dev:api`   | Локальный API на порту 3001                 |
| `npm run start:api` | Запуск локального API без наблюдения файлов |
| `npm run build`     | Проверка типов и production-сборка в `dist` |
| `npm run preview`   | Локальный просмотр production-сборки        |
| `npm run lint`      | ESLint                                      |
| `npm run typecheck` | Проверка типов TypeScript                   |
| `npm test`          | Unit/компонентные тесты (Vitest)            |
| `npm run format`    | Форматирование Prettier                     |

Для полного локального запуска откройте три терминала в папке проекта:

```bash
npm run dev:db
npm run dev:api
npm run dev
```

Затем откройте `http://localhost:5173`. База из `dev:db` временная: после остановки этого процесса данные удаляются. При наличии своей MongoDB скопируйте `.env.example` в `.env` и задайте `MONGODB_URI`. Тестовый код входа — `123456`; реальные SMS не отправляются. Меню, профиль, адреса, сессии и тестовые заказы хранятся в MongoDB. Production-запуск заблокирован до настройки настоящего SMS и инфраструктуры. Ожидаемое поведение и проверки описаны в [ТЗ](docs/spec-local-mvp.md), серверные решения — в [docs/backend.md](docs/backend.md).

## Архитектурные границы

`src/app → src/screens → src/features → src/shared`. Нижний слой не импортирует верхний — это проверяет ESLint (`no-restricted-imports`). `server/` — отдельная серверная граница, которую клиентские модули не импортируют. Каталоги создаются по мере появления кода.

## Открытые вопросы

- SEO: Vite отдаёт SPA без готового HTML. Если публичный каталог должен индексироваться поиском, это нужно решить до реализации каталога (см. CLAUDE.md, раздел 3.2).
- Хостинг SPA должен отдавать `index.html` на все вложенные маршруты.
