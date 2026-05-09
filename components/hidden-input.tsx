type HiddenInputProps = {
  name: string;
  value: string | number | boolean;
};

export function HiddenInput({ name, value }: HiddenInputProps) {
  return <input type="hidden" name={name} value={String(value)} />;
}
