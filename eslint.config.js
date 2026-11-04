import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Направление зависимостей: app → screens → features → shared (CLAUDE.md, раздел 5).
const layerRestrictions = (forbidden) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: forbidden.map((layer) => ({
        group: [`**/${layer}/**`],
        message: `Нижний слой не импортирует ${layer}.`,
      })),
    },
  ],
})

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  { files: ['src/app/**'], rules: layerRestrictions(['server']) },
  { files: ['src/screens/**'], rules: layerRestrictions(['app', 'server']) },
  { files: ['src/features/**'], rules: layerRestrictions(['app', 'screens', 'server']) },
  { files: ['src/shared/**'], rules: layerRestrictions(['app', 'screens', 'features', 'server']) },
  { files: ['shared/**'], rules: layerRestrictions(['app', 'screens', 'features', 'src']) },
  prettier,
])
