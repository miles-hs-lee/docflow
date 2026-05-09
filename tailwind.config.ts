import polarisPreset from '@polaris/ui/tailwind';
import type { Config } from 'tailwindcss';

const config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@polaris/ui/dist/**/*.{js,cjs}'
  ],
  presets: [polarisPreset]
} satisfies Config;

export default config;
