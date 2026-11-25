import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';

const recommendedTypeScriptConfigs = typescriptEslint.configs['flat/recommended'];

export default [
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'generated/**',
      '**/generated/**',
      '**/*.generated.ts',
      '**/*.gen.ts',
    ],
  },
  ...recommendedTypeScriptConfigs.map((config) => ({
    ...config,
    files: ['src/**/*.ts'],
    languageOptions: {
      ...config.languageOptions,
      parser: typescriptParser,
    },
  })),
];
