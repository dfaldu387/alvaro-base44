import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { SAMPLE_VALUES } from '@/lib/messageTemplateMeta';

/** Renders `body` on the server with the sweep's own renderer. Reads and writes nothing. */
export default function useTemplatePreview(body, payload = SAMPLE_VALUES) {
  const [result, setResult] = useState(null);
  const [failed, setFailed] = useState(false);
  const payloadKey = JSON.stringify(payload);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setFailed(false);
    const timer = setTimeout(async () => {
      try {
        const res = await base44.functions.invoke('renderMessagePreview', { body, payload: JSON.parse(payloadKey) });
        if (!cancelled) setResult(res.data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [body, payloadKey]);

  return { result, failed, loading: !result && !failed };
}