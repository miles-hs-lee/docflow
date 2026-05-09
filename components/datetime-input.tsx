import type { InputHTMLAttributes } from 'react';

export type DateTimeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: string;
};

export function DateTimeInput({ label, className, ...props }: DateTimeInputProps) {
  return (
    <label className="datetime-field">
      {label ? <span className="datetime-field-label">{label}</span> : null}
      <input type="datetime-local" className={className} {...props} />
    </label>
  );
}
