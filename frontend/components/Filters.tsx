"use client";

export interface FilterState {
  source: string;
  type: string;
  location: string;
  search: string;
  hideApplied: boolean;
  showExpired: boolean;
}

export default function Filters({
  value,
  onChange,
  onReset,
}: {
  value: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
}) {
  const dirty = Object.values(value).some((v) => v !== "" && v !== false);
  return (
    <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <input
        className="input sm:col-span-2 lg:col-span-4"
        type="search"
        placeholder="Search company, role or eligibility…"
        aria-label="Search"
        value={value.search}
        onChange={(e) => onChange({ search: e.target.value })}
      />
      <select className="input" aria-label="Source" value={value.source} onChange={(e) => onChange({ source: e.target.value })}>
        <option value="">All sources</option>
        <option value="telegram">Telegram</option>
        <option value="youtube">YouTube</option>
        <option value="manual">Added by me</option>
      </select>
      <select className="input" aria-label="Employment type" value={value.type} onChange={(e) => onChange({ type: e.target.value })}>
        <option value="">All types</option>
        <option value="internship">Internship</option>
        <option value="full-time">Full-time</option>
        <option value="contract">Contract</option>
      </select>
      <input
        className="input"
        placeholder="Location (e.g. Bengaluru)"
        aria-label="Location"
        value={value.location}
        onChange={(e) => onChange({ location: e.target.value })}
      />
      <div className="flex items-center gap-4 text-sm">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={value.hideApplied} onChange={(e) => onChange({ hideApplied: e.target.checked })} />
          Hide applied
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={value.showExpired} onChange={(e) => onChange({ showExpired: e.target.checked })} />
          Show expired
        </label>
        {dirty && (
          <button onClick={onReset} className="ml-auto text-indigo-600 hover:underline dark:text-indigo-400">
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
