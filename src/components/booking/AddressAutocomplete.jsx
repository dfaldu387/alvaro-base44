import React, { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Search, X, MapPin, Loader2, AlertCircle } from 'lucide-react';

// Mapbox Geocoding autocomplete input for address entry. Uses the
// mapboxGeocode backend function. Mapbox returns coordinates directly in
// search results — no separate details call needed. On selection, calls
// onSelect with structured address data. Editing the text after selection
// fires onInvalidate so the parent can clear stale coordinates.
export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  onInvalidate,
  customerLocation,
  placeholder = 'Start typing your street address',
  error,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [validatedText, setValidatedText] = useState('');
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

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
      const payload = { input: q };
      if (customerLocation?.lat != null && customerLocation?.lng != null) {
        payload.lat = customerLocation.lat;
        payload.lng = customerLocation.lng;
      }
      const res = await base44.functions.invoke('mapboxGeocode', payload);
      if (res.data?.error) {
        setApiError(res.data.error);
        setSuggestions([]);
        setOpen(false);
      } else {
        setSuggestions(res.data?.suggestions || []);
        setOpen(true);
      }
    } catch (err) {
      setApiError("We couldn't search addresses right now. Please try again.");
      setSuggestions([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, [customerLocation]);

  const handleChange = (e) => {
    const v = e.target.value;
    onChange(v);
    setHighlightIndex(-1);
    if (validatedText && v !== validatedText) {
      setValidatedText('');
      onInvalidate?.();
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 300);
  };

  const handleSelect = (suggestion) => {
    setOpen(false);
    setSuggestions([]);
    onChange(suggestion.description);
    setValidatedText(suggestion.description);
    setApiError(null);
    onSelect({
      formatted_address: suggestion.formatted_address || suggestion.description,
      lat: suggestion.lat,
      lng: suggestion.lng,
      postcode: suggestion.postcode || '',
      suburb: suggestion.suburb || '',
      state: suggestion.state || '',
      country: suggestion.country || '',
      street_number: suggestion.street_number || '',
      street_name: suggestion.street_name || '',
      place_id: suggestion.mapbox_id || suggestion.place_id || '',
      mapbox_id: suggestion.mapbox_id || '',
    });
  };

  const handleClear = () => {
    onChange('');
    setValidatedText('');
    setSuggestions([]);
    setOpen(false);
    setApiError(null);
    onInvalidate?.();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
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
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
          placeholder={placeholder}
          aria-label="Full service address"
          aria-expanded={open}
          aria-autocomplete="list"
          className={`w-full rounded-xl border bg-card pl-10 pr-10 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 disabled:opacity-50 ${error ? 'border-red-500/70' : 'border-border'}`}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {loading && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
          {value && !loading && (
            <button type="button" onClick={handleClear} className="text-muted-foreground hover:text-foreground" aria-label="Clear address">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {apiError && (
        <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-2">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-400 leading-relaxed">{apiError}</p>
        </div>
      )}

      {open && suggestions.length > 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-popover shadow-xl max-h-64 overflow-y-auto" role="listbox">
          {suggestions.map((s, i) => (
            <button
              key={s.mapbox_id || s.place_id || i}
              type="button"
              onClick={() => handleSelect(s)}
              onMouseEnter={() => setHighlightIndex(i)}
              role="option"
              aria-selected={i === highlightIndex}
              className={`w-full text-left px-3 py-2.5 flex items-start gap-2 border-b border-border last:border-0 transition-colors ${i === highlightIndex ? 'bg-primary/10' : 'hover:bg-muted'}`}
            >
              <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{s.main_text || s.description}</p>
                {s.secondary_text && <p className="text-xs text-muted-foreground truncate">{s.secondary_text}</p>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}