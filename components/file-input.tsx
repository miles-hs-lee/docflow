import type { InputHTMLAttributes } from 'react';

export type FileInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export function FileInput(props: FileInputProps) {
  return <input type="file" {...props} />;
}
