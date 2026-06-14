// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      // Allow the omit-by-destructure idiom: `const { secret, ...rest } = obj`
      // where `secret` is intentionally extracted only to drop it from `rest`.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // The no-unsafe-* family is WARN, not error: with no-explicit-any already off
      // (the project accepts `any` at external/SDK/decorator boundaries — Express
      // req, the OTel SDK, Prisma dynamic shapes), erroring on every downstream use
      // of those `any`s is internally inconsistent — it blocks CI without adding
      // signal. Warn keeps them visible in editors/output without failing the build.
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    // Test files legitimately use `as any` mocks and reach into jest mock internals
    // (`.mock.calls[0][0]`), so the unsafe family + unbound-method are noise here.
    files: ['**/*.spec.ts', 'src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // Test fakes legitimately model async provider APIs (a mock `json()` with no
      // await) and pull in modules dynamically via require().
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
