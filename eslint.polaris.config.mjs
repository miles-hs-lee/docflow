import polaris from '@polaris/lint';

export default [
  {
    ignores: ['.next/**', 'node_modules/**', 'public/**', 'supabase/**']
  },
  ...polaris.configs.recommended,
  {
    files: ['components/hidden-input.tsx'],
    rules: {
      '@polaris/prefer-polaris-component': 'off'
    }
  }
];
