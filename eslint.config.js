// eslint.config.js — ESLint v9 flat config
// NOTE: Type-aware rules (e.g. @typescript-eslint/recommended-type-checked)
// are intentionally disabled. typescript-eslint v8 declares a peer dep on
// TypeScript <6.1, while this project uses TypeScript 7. The syntax-only
// rule set works fine with any TS version. Re-enable type-aware rules once
// typescript-eslint officially supports TypeScript 7.

import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // --- Files to lint ---------------------------------------------------
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'scripts/**/*.mjs'],
  },

  // --- Files to ignore -------------------------------------------------
  {
    ignores: ['dist/**', 'node_modules/**', '*.zip', 'coverage/**'],
  },

  // --- TypeScript syntax rules (no type-checking required) -------------
  ...tseslint.configs.recommended,

  // --- Turn off rules that conflict with Prettier ----------------------
  prettierConfig,

  // --- Project-wide overrides ------------------------------------------
  {
    rules: {
      // Allow unused vars prefixed with _ (matches existing convention, e.g. _sender)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Extensions regularly call async functions in event listeners without
      // awaiting them — the void operator is the explicit acknowledgement.
      '@typescript-eslint/no-floating-promises': 'off',

      // chrome.runtime.sendMessage returns unknown at runtime boundaries;
      // explicit casts are unavoidable in MV3 extension code.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Empty catch blocks are intentional in several pipeline cleanup paths.
      '@typescript-eslint/no-empty-function': 'off',

      // Prefer const assertions over type annotations where possible.
      'prefer-const': 'error',

      // Catch common async mistakes.
      'no-return-await': 'error',
    },
  },

  // --- Test file overrides ---------------------------------------------
  {
    files: ['test/**/*.ts'],
    rules: {
      // Tests often cast to any to set up mocks / spies.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // --- Script file overrides -------------------------------------------
  {
    files: ['scripts/**/*.mjs'],
    rules: {
      // Build scripts use console freely.
      'no-console': 'off',
    },
  },
);
