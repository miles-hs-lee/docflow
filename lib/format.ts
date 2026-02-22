import { format } from 'date-fns';

export function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return format(new Date(value), 'yyyy-MM-dd HH:mm');
}

export function formatDateOnly(value: string | null | undefined) {
  if (!value) return '-';
  return format(new Date(value), 'yyyy-MM-dd');
}
