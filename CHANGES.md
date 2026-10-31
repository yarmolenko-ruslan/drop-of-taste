# CHANGES

## 2026-10-24 — Начальная настройка приложения

**Задача.** Развернуть основу: Vite, React 19, Zustand и необходимые инструменты.

**Причина решений.**

- Vite + React Router выбраны пользователем (строка 1 таблицы раздела 3.2). SEO-требования к каталогу ещё не подтверждены — см. «Открытые вопросы» в README.
- Установлен минимальный набор. TanStack Query, Zod, React Hook Form, Radix, clsx, Playwright, Capacitor не ставились: у них пока нет потребителя (раздел 4 — «меню, а не установка всего сразу»).
- Шаблон create-vite использует oxlint; заменён на ESLint, так как правила проекта требуют проверки hooks, доступности (jsx-a11y) и границ слоёв.
- ESLint 9, а не 10: `eslint-plugin-jsx-a11y` 6.10 не поддерживает ESLint 10. Перейти, когда плагин добавит поддержку.
- TypeScript `strict` + `noUncheckedIndexedAccess` (в шаблоне strict отсутствовал).
- Store Zustand не создан: первый store появится вместе с корзиной или другим реально общим состоянием.
- React Compiler не включён — отдельное решение после появления реальных экранов.

**Новые файлы.** `package.json`, `package-lock.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `.claude/launch.json`, `public/favicon.svg`, `src/main.tsx`, `src/app/App.tsx`, `src/screens/HomeScreen/{HomeScreen.tsx,HomeScreen.module.css,HomeScreen.test.tsx}`, `src/shared/styles/{tokens.css,global.css}`, `src/test/setup.ts`, `CHANGES.md`.

**Изменённые файлы.** `README.md`.

**Оговорки.** Проверены lint, typecheck, test, build и ответ dev-сервера. Не проверены: отображение на реальных устройствах, матрица ширин, Android/iOS. Значения дизайн-токенов — временные заглушки. CI не настроен. Graphify не запускался: графа нет, а строить его для каркаса преждевременно.
