import React, { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Search, X, MapPin, Loader2, AlertCircle } from 'lucide-react';

// Google Places autocomplete input. Debounces typing, fetches suggestions from
// the googlePlacesAutocomplete backend function, and calls onSelect with full
// place details when a suggestion is chosen. Shows specific API errors (not
// generic "not found") when the Places API fails.
//
// theme="dark" (default) keeps the admin map/service-area styling; theme="light"
// matches the light SaaS panels (Team Members). Editing the text after a
// selection calls onInvalidate so the parent can drop stale coordinates.
const THEMES = {
  dark: {
    shell: 'flex items-center gap-2 rounded-lg border border-[#27272a] bg-[#1a1a1e] px-3 py-2.5 focus-within:border-[#6366f1]',
    searchIcon: 'w-4 h-4 text-zinc-500 shrink-0',
    input: 'flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600 disabled:cursor-not-allowed',
    spinner: 'w-4 h-4 text-[#818cf8] animate-spin shrink-0',
    clear: 'text-zinc-500 hover:text-zinc-300 shrink-0',
    errorBox: 'mt-1.5 flex items-start gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-2',
    errorIcon: 'w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5',
    errorText: 'text-xs text-red-400 leading-relaxed',
    menu: 'absolute z-30 mt-1 w-full rounded-lg border border-[#27272a] bg-[#1a1a1e] shadow-xl max-h-64 overflow-y-auto',
    item: 'w-full text-left px-3 py-2.5 flex items-start gap-2 border-b border-[#222226] last:border-0 transition-colors',
    itemActive: 'bg-[#6366f1]/10',
    itemIdle: 'hover:bg-[#222226]',
    itemIcon: 'w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5',
    itemTitle: 'text-sm font-medium text-white truncate',
    itemSub: 'text-xs text-zinc-500 truncate',
    empty: 'absolute z-30 mt-1 w-full rounded-lg border border-[#27272a] bg-[#1a1a1e] shadow-xl p-3 text-center',
    emptyText: 'text-xs text-zinc-500',
  },
  light: {
    shell: 'flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 focus-within:border-[#5E42F3]',
    searchIcon: 'w-4 h-4 text-zinc-400 shrink-0',
    input: 'flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed',
    spinner: 'w-4 h-4 text-[#5E42F3] animate-spin shrink-0',
    clear: 'text-zinc-400 hover:text-zinc-700 shrink-0',
    errorBox: 'mt-1.5 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2',
    errorIcon: 'w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5',
    errorText: 'text-xs text-red-600 leading-relaxed',
    menu: 'absolute z-30 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-xl max-h-64 overflow-y-auto',
    item: 'w-full text-left px-3 py-2.5 flex items-start gap-2 border-b border-zinc-100 last:border-0 transition-colors',
    itemActive: 'bg-[#5E42F3]/10',
    itemIdle: 'hover:bg-zinc-50',
    itemIcon: 'w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5',
    itemTitle: 'text-sm font-medium text-zinc-900 truncate',
    itemSub: 'text-xs text-zinc-500 truncate',
    empty: 'absolute z-30 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-xl p-3 text-center',
    emptyText: 'text-xs text-zinc-500',
  },
};

export default function LocationAutocomplete({
  value,
  onSelect,
  onInvalidate,
  onClear,
  disabled,
  theme = 'dark',
  placeholder = 'Search suburb or address...',
}) {
  const t = THEMES[theme] || THEMES.dark;
  const [input, setInput] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchingDetails, setFetchingDetails] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    setInput(value || '');
    setApiError(null);
  }, [value]);

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchSuggestions = useCallback(async (q) => {
    if (q.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    setApiError(null);
    try {
      const res = await base44.functions.invoke('googlePlacesAutocomplete', { input: q });
      if (res.data?.error) {
        setApiError(res.data.error);
        setSuggestions([]);
        setOpen(false);
      } else {
        setSuggestions(res.data?.suggestions || []);
        setOpen(true);
      }
    } catch (err) {
      setApiError(err?.message || 'Failed to search locations.');
      setSuggestions([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e) => {
    const v = e.target.value;
    setInput(v);
    setHighlightIndex(-1);
    // Edited text no longer matches the saved address — let the parent drop the
    // coordinates that belong to the previous selection.
    if (value && v !== value) onInvalidate?.();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 300);
  };

  const handleSelect = async (suggestion) => {
    setOpen(false);
    setSuggestions([]);
    setInput(suggestion.description);
    setFetchingDetails(true);
    setApiError(null);
    try {
      const res = await base44.functions.invoke('googlePlaceDetails', { place_id: suggestion.place_id });
      if (res.data?.error) {
        setApiError(res.data.error);
      } else if (res.data?.lat != null && res.data?.lng != null) {
        onSelect({
          formatted_address: suggestion.description,
          lat: res.data.lat,
          lng: res.data.lng,
          postcode: res.data.postcode || '',
          suburb: res.data.suburb || '',
        });
      } else {
        setApiError('Could not retrieve coordinates for this location.');
      }
    } catch (err) {
      setApiError(err?.message || 'Could not retrieve place details.');
    } finally {
      setFetchingDetails(false);
    }
  };

  const handleClear = () => {
    setInput('');
    setSuggestions([]);
    setOpen(false);
    setApiError(null);
    if (onClear) onClear();
    else onInvalidate?.();
  };

  const handleKeyDown = (e) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault();
      handleSelect(suggestions[highlightIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className={t.shell}>
        <Search className={t.searchIcon} />
        <input
          type="text"
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
          disabled={disabled || fetchingDetails}
          placeholder={placeholder}
          className={t.input}
        />
        {loading && <Loader2 className={t.spinner} />}
        {fetchingDetails && <Loader2 className={t.spinner} />}
        {input && !disabled && !fetchingDetails && (
          <button type="button" onClick={handleClear} className={t.clear}>
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {apiError && (
        <div className={t.errorBox}>
          <AlertCircle className={t.errorIcon} />
          <p className={t.errorText}>{apiError}</p>
        </div>
      )}

      {open && suggestions.length > 0 && (
        <div className={t.menu}>
          {suggestions.map((s, i) => (
            <button
              key={s.place_id}
              type="button"
              onClick={() => handleSelect(s)}
              onMouseEnter={() => setHighlightIndex(i)}
              className={`${t.item} ${i === highlightIndex ? t.itemActive : t.itemIdle}`}
            >
              <MapPin className={t.itemIcon} />
              <div className="min-w-0">
                <p className={t.itemTitle}>{s.main_text || s.description}</p>
                {s.secondary_text && <p className={t.itemSub}>{s.secondary_text}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {open && !loading && !fetchingDetails && input.trim().length >= 2 && suggestions.length === 0 && !apiError && (
        <div className={t.empty}>
          <p className={t.emptyText}>No matching locations. Try a different search.</p>
        </div>
      )}
    </div>
  );
}