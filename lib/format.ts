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

// Human dwell time from milliseconds — "12초" / "3분 5초" / "1시간 4분".
export function formatDuration(ms: number | null | undefined) {
  if (!ms || ms <= 0) return '0초';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  if (minutes > 0) return `${minutes}분 ${seconds}초`;
  return `${seconds}초`;
}
