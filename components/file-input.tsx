import { forwardRef, type InputHTMLAttributes } from 'react';

export type FileInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const FileInput = forwardRef<HTMLInputElement, FileInputProps>(function FileInput(props, ref) {
  return <input ref={ref} type="file" {...props} />;
});
