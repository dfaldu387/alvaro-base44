import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { countOpenAssistantItems } from '@/lib/assistant';

/** How many assistant items are waiting for a person (sidebar badge and inbox tab). Live. */
export default function useOpenAssistantCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    let t;
    const load = () => countOpenAssistantItems().then((n) => { if (live) setCount(Number(n) || 0); }).catch(() => {});
    load();
    const off = base44.entities.AssistantEvent.subscribe(() => { clearTimeout(t); t = setTimeout(load, 500); });
    return () => { live = false; off(); clearTimeout(t); };
  }, []);
  return count;
}