import { useState } from 'react';
import { isSensitiveHeader, maskSensitiveValue } from '../utils/sensitive';

export function SensitiveValue({
  header,
  value,
  sensitive = false,
}: {
  header: string;
  value?: string;
  sensitive?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  if (!sensitive && !isSensitiveHeader(header))
    return <span className="value-preview">{value || '-'}</span>;
  return (
    <span className="sensitive">
      <span className="value-preview">{revealed ? value : maskSensitiveValue(value)}</span>
      <button className="link" onClick={() => setRevealed((current) => !current)} type="button">
        {revealed ? 'Ocultar' : 'Revelar'}
      </button>
    </span>
  );
}
