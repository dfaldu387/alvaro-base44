import { useCallback, useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { asList, escapeRegex, toConversations, conversationFor } from '@/lib/conversations';

const PAGE = 100;

/**
 * The conversation list: the newest Message rows, one entry per client, with a
 * "load more" page. A name search queries ReminderClient on the server so an
 * admin can also open a client who has no messages yet.
 */
export default function useConversationList(tick, search) {
  const [messages, setMessages] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [clients, setClients] = useState({});
  const [found, setFound] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const known = useRef({});

  const remember = useCallback(async (ids) => {
    const missing = [...new Set(ids.filter(Boolean))].filter((id) => !known.current[id]);
    if (missing.length === 0) return;
    const rows = asList(await base44.entities.ReminderClient.filter({ id: { $in: missing } }, { limit: 200 }));
    for (const c of rows) known.current[c.id] = c;
    setClients({ ...known.current });
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const page = await base44.entities.Message.filter({}, { sort: '-created_date', limit: PAGE });
        if (!live) return;
        await remember(page.items.map((m) => m.client_id));
        if (!live) return;
        setMessages(page.items);
        setCursor(page.next_cursor);
        setHasMore(page.has_more === true);
        setError(false);
      } catch {
        if (live) setError(true);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [tick, remember]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) { setFound(null); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const rows = asList(await base44.entities.ReminderClient.filter(
          { client_name: { $regex: escapeRegex(term), $options: 'i' } }, { limit: 20 },
        ));
        if (!live) return;
        for (const c of rows) known.current[c.id] = c;
        setClients({ ...known.current });
        setFound(rows.map((c) => c.id));
      } catch {
        if (live) setFound([]);
      }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [search]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !cursor) return;
    const page = await base44.entities.Message.filter({}, { sort: '-created_date', limit: PAGE, cursor });
    await remember(page.items.map((m) => m.client_id));
    setMessages((prev) => [...prev, ...page.items]);
    setCursor(page.next_cursor);
    setHasMore(page.has_more === true);
  }, [hasMore, cursor, remember]);

  const all = toConversations(messages, clients);
  const conversations = found === null
    ? all
    : found.map((id) => all.find((c) => c.clientId === id) || conversationFor(id, clients[id], null));

  return { conversations, loading, error, hasMore, loadMore, searching: found !== null };
}