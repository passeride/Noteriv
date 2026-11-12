"use client";

export default function SyncTabs<T extends string>({ id, label, items, value, onChange, disabled = false }: {
  id: string; label: string; items: readonly { value: T; label: string }[];
  value: T; onChange: (value: T) => void; disabled?: boolean;
}) {
  return <div role="tablist" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingBottom: 14, borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
    {items.map((item, index) => <button key={item.value} type="button" role="tab"
      id={`${id}-tab-${item.value}`} aria-controls={`${id}-panel-${item.value}`} aria-selected={value === item.value}
      tabIndex={value === item.value ? 0 : -1} disabled={disabled} onClick={() => onChange(item.value)}
      onKeyDown={event => {
        let next: number;
        if (event.key === 'ArrowRight') next = (index + 1) % items.length;
        else if (event.key === 'ArrowLeft') next = (index + items.length - 1) % items.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        else return;
        event.preventDefault(); onChange(items[next].value);
        document.getElementById(`${id}-tab-${items[next].value}`)?.focus();
      }} className="st-test-btn" style={{ padding: '8px 14px', borderRadius: 7,
        background: value === item.value ? 'var(--accent)' : 'var(--bg-secondary)',
        color: value === item.value ? 'var(--bg-primary)' : 'var(--text-secondary)',
        borderColor: value === item.value ? 'var(--accent)' : 'var(--border)' }}>
      {item.label}
    </button>)}
  </div>;
}
