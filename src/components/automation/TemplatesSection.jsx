import React, { useEffect } from 'react';
import MessageTemplateEditor from '@/components/messages/MessageTemplateEditor';

export default function TemplatesSection() {
  useEffect(() => {
    if (window.location.hash === '#templates') setTimeout(() => document.getElementById('templates')?.scrollIntoView(), 300);
  }, []);
  return (
    <section id="templates" className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Templates</h2>
      <MessageTemplateEditor />
    </section>
  );
}