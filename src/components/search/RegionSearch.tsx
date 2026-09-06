/**
 * Accessible region search — WAI-ARIA 1.2 combobox.
 *
 * Keyboard: ArrowDown/Up move, Enter selects, Escape clears/closes,
 * Home/End jump. Results are announced politely. Fully usable with no
 * pointer and no 3D.
 *
 * On select the app flies the camera to the region (BodyViewer already
 * exposes that via `selectedRegionId`), so search and the 3D figure are the
 * same interaction, not two parallel ones.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { searchRegions } from '../body/search';
import { regionLabel } from '../body/regions';
import type { Locale } from '../body/types';
import './regionSearch.css';

type Props = {
  locale?: Locale;
  onSelect: (regionId: string) => void;
  /** currently selected region, so the field can show it */
  selectedRegionId?: string | null;
};

const STRINGS = {
  en: {
    label: 'Search for a body part',
    placeholder: 'Try “lower back”, “knee”, “shoulder”…',
    clear: 'Clear search',
    noResults: 'No matching body part. Try a simpler word, or pick from the list.',
    countOne: '1 body part found',
    countMany: (n: number) => `${n} body parts found`,
    via: 'matched',
  },
  ar: {
    label: 'ابحث عن جزء من الجسم',
    placeholder: 'جرّب «أسفل الظهر»، «ركبة»، «كتف»…',
    clear: 'مسح البحث',
    noResults: 'لا يوجد جزء مطابق. جرّب كلمة أبسط أو اختر من القائمة.',
    countOne: 'تم العثور على جزء واحد',
    countMany: (n: number) => `تم العثور على ${n} أجزاء`,
    via: 'تطابق',
  },
} as const;

export function RegionSearch({ locale = 'en', onSelect, selectedRegionId }: Props) {
  const t = STRINGS[locale];
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const hits = useMemo(() => searchRegions(query, locale, 8), [query, locale]);

  useEffect(() => setActive(0), [query]);

  const commit = (i: number) => {
    const hit = hits[i];
    if (!hit) return;
    onSelect(hit.region.id);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || hits.length === 0) {
      if (e.key === 'Escape') {
        setQuery('');
        setOpen(false);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => (a + 1) % hits.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => (a - 1 + hits.length) % hits.length);
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(hits.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        commit(active);
        break;
      case 'Escape':
        e.preventDefault();
        setQuery('');
        setOpen(false);
        break;
    }
  };

  const showList = open && query.trim().length >= 2;
  const status =
    !showList ? '' : hits.length === 0 ? t.noResults : hits.length === 1 ? t.countOne : t.countMany(hits.length);

  return (
    <div className="rs-root">
      <div className="rs-field">
        <svg className="rs-icon" viewBox="0 0 20 20" aria-hidden focusable="false">
          <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M13.5 13.5 L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          className="rs-input"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && hits[active] ? `${listId}-${active}` : undefined}
          aria-label={t.label}
          placeholder={t.placeholder}
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button
            type="button"
            className="rs-clear"
            aria-label={t.clear}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        )}
      </div>

      {showList && (
        <ul className="rs-list" id={listId} role="listbox" aria-label={t.label}>
          {hits.length === 0 && <li className="rs-empty">{t.noResults}</li>}
          {hits.map((h, i) => (
            <li
              key={h.region.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`rs-opt${i === active ? ' on' : ''}${
                selectedRegionId === h.region.id ? ' cur' : ''
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => commit(i)}
            >
              <span className="rs-opt-label">{regionLabel(h.region.id, locale)}</span>
              {h.viaSynonym && <span className="rs-opt-via">{t.via}: {h.matchedTerm}</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="rs-sr" role="status" aria-live="polite">
        {status}
      </div>
    </div>
  );
}

export default RegionSearch;
