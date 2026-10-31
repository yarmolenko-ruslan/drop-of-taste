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
| `npm run build`     | Проверка типов и production-сборка в `dist` |
| `npm run preview`   | Локальный просмотр production-сборки        |
| `npm run lint`      | ESLint                                      |
| `npm run typecheck` | Проверка типов TypeScript                   |
| `npm test`          | Unit/компонентные тесты (Vitest)            |
| `npm run format`    | Форматирование Prettier                     |

`test:e2e` (Playwright) появится вместе с первым сквозным сценарием.

## Архитектурные границы

`src/app → src/screens → src/features → src/shared`. Нижний слой не импортирует верхний — это проверяет ESLint (`no-restricted-imports`). Каталоги создаются по мере появления кода.

## Открытые вопросы

- SEO: Vite отдаёт SPA без готового HTML. Если публичный каталог должен индексироваться поиском, это нужно решить до реализации каталога (см. CLAUDE.md, раздел 3.2).
- Хостинг SPA должен отдавать `index.html` на все вложенные маршруты.
