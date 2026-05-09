import polaris from '@polaris/lint';

export default [
  {
    ignores: ['.next/**', 'node_modules/**', 'public/**', 'supabase/**']
  },
  ...polaris.configs.recommended,
  {
    files: [
      'components/hidden-input.tsx',
      'components/file-input.tsx',
      'components/datetime-input.tsx',
      'components/user-menu.tsx'
    ],
    rules: {
      '@polaris/prefer-polaris-component': 'off'
    }
  }
];
