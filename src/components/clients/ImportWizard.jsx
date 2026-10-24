import React, { useMemo, useState } from 'react';
import { X, Upload, Check, AlertTriangle, ChevronRight, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FREQUENCY_OPTIONS } from '@/lib/reminderUtils';
import { normalisePhone } from '@/lib/clientStatus';

const FIELDS = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' },
  { key: 'suburb', label: 'Suburb' },
  { key: 'postcode', label: 'Postcode' },
  { key: 'usual_service', label: 'Usual service' },
  { key: 'frequency', label: 'Frequency' },
  { key: 'recurring_enabled', label: 'Recurring enabled' },
  { key: 'last_visit', label: 'Last visit' },
  { key: 'first_visit', label: 'First visit' },
  { key: 'notes', label: 'Notes' },
  { key: 'tags', label: 'Tags' },
];

const HEADER_HINTS = {
  first_name: ['first name', 'first_name', 'given name'],
  last_name: ['last name', 'last_name', 'surname', 'family name'],
  phone: ['phone', 'mobile', 'phone number', 'mobile number'],
  email: ['email', 'email address'],
  address: ['address', 'street'],
  suburb: ['suburb', 'city', 'locality'],
  postcode: ['postcode', 'post code', 'zip', 'postal code'],
  usual_service: ['service', 'usual service', 'default service'],
  frequency: ['frequency'],
  recurring_enabled: ['recurring', 'recurring enabled'],
  last_visit: ['last visit', 'last appointment'],
  first_visit: ['first visit', 'first appointment'],
  notes: ['notes', 'note'],
  tags: ['tags', 'tag', 'categories'],
};

const parseCsv = (text) => {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const parseLine = (line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else { if (ch === ',') { out.push(cur); cur = ''; } else if (ch === '"') q = true; else cur += ch; }
    }
    out.push(cur); return out;
  };
  const headers = parseLine(lines[0]).map(h => h.trim());
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
};

const norm = (s) => (s || '').toLowerCase().trim();

export default function ImportWizard({ open, onClose, existingClients, onConfirm }) {
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [dupChoices, setDupChoices] = useState({});
  const [running, setRunning] = useState(false);

  const records = useMemo(() => {
    if (!rows.length) return [];
    return rows.map((row) => {
      const get = (key) => { const idx = mapping[key]; return idx == null || idx === '' ? '' : (row[idx] || '').trim(); };
      const first = get('first_name'), last = get('last_name');
      const name = get('first_name') && get('last_name') ? `${first} ${last}` : (first || last || '');
      const tags = (get('tags') || '').split(/[,;]/).map(t => t.trim()).filter(Boolean);
      const freq = get('frequency');
      return {
        client_name: name,
        phone: normalisePhone(get('phone')), email: get('email'), address: get('address'),
        suburb: get('suburb'), postcode: get('postcode'),
        usual_service: get('usual_service'),
        frequency: FREQUENCY_OPTIONS.includes(freq) ? freq : 'Monthly',
        cadence_source: FREQUENCY_OPTIONS.includes(freq) ? 'manual' : 'default',
        recurring_enabled: ['true', '1', 'yes', 'y'].includes((get('recurring_enabled') || '').toLowerCase()),
        last_visit_date: get('last_visit') || undefined,
        first_visit_date: get('first_visit') || undefined,
        notes: get('notes') || undefined,
        manual_tags: tags,
        source: 'Square import',
      };
    }).filter(r => r.client_name);
  }, [rows, mapping]);

  const duplicates = useMemo(() => records.map((r, i) => {
    const ph = normalisePhone(r.phone), em = norm(r.email);
    const match = (ph || em) ? existingClients.find(c => (ph && normalisePhone(c.phone) === ph) || (em && norm(c.email) === em)) : null;
    return match ? { index: i, record: r, match } : null;
  }).filter(Boolean), [records, existingClients]);

  const summary = useMemo(() => {
    let create = 0, update = 0, skip = 0;
    records.forEach((_, i) => {
      const dup = duplicates.find(d => d.index === i);
      if (!dup) create++;
      else {
        const choice = dupChoices[i] || 'skip';
        if (choice === 'skip') skip++;
        else update++;
      }
    });
    return { create, update, skip, total: records.length };
  }, [records, duplicates, dupChoices]);

  if (!open) return null;

  const reset = () => { setStep(1); setFileName(''); setHeaders([]); setRows([]); setMapping({}); setDupChoices({}); setRunning(false); };
  const close = () => { reset(); onClose(); };

  const handleFile = async (file) => {
    const text = await file.text();
    const { headers: h, rows: r } = parseCsv(text);
    setFileName(file.name);
    setHeaders(h);
    setRows(r);
    const auto = {};
    FIELDS.forEach(f => {
      const hint = HEADER_HINTS[f.key];
      const idx = h.findIndex(hdr => hint.some(hh => hdr.toLowerCase().includes(hh)));
      if (idx >= 0) auto[f.key] = idx;
    });
    setMapping(auto);
    setStep(2);
  };

  const runImport = async () => {
    setRunning(true);
    const toCreate = [];
    const toUpdate = [];
    records.forEach((r, i) => {
      const dup = duplicates.find(d => d.index === i);
      if (!dup) toCreate.push(r);
      else {
        const choice = dupChoices[i] || 'skip';
        if (choice === 'skip') return;
        const patch = { ...r };
        delete patch.client_name;
        toUpdate.push({ id: dup.match.id, patch });
      }
    });
    await onConfirm({ toCreate, toUpdate, skipped: summary.skip });
    setRunning(false);
    reset();
    onClose();
  };

  const steps = ['Upload', 'Map columns', 'Duplicates', 'Summary', 'Confirm'];

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="relative w-full sm:max-w-[560px] bg-white border-l border-zinc-200 h-full overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <h2 className="text-base font-bold text-zinc-900">Import clients from Square</h2>
          <button onClick={close} className="w-8 h-8 rounded-lg hover:bg-zinc-100 flex items-center justify-center text-zinc-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-3 border-b border-zinc-100 flex items-center gap-1.5">
          {steps.map((s, i) => (
            <React.Fragment key={s}>
              <span className={cn('text-xs font-medium', i + 1 === step ? 'text-indigo-600' : i + 1 < step ? 'text-zinc-400' : 'text-zinc-300')}>{i + 1}. {s}</span>
              {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-zinc-300" />}
            </React.Fragment>
          ))}
        </div>

        <div className="px-5 py-5 flex-1">
          {step === 1 && (
            <div className="flex flex-col items-center justify-center py-10 border-2 border-dashed border-zinc-200 rounded-xl">
              <Upload className="w-8 h-8 text-zinc-300 mb-3" />
              <p className="text-sm text-zinc-500 mb-3">Upload a CSV exported from Square</p>
              <label className="cursor-pointer">
                <span className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#6366F1] hover:bg-[#5457e6] text-white text-sm"><Upload className="w-4 h-4" /> Choose CSV file</span>
                <input type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFile(f); }} />
              </label>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="text-sm text-zinc-600 mb-1">File: <span className="font-medium text-zinc-900">{fileName}</span></p>
              <p className="text-xs text-zinc-400 mb-4">{rows.length} rows detected · match Square columns to Cut Deluxe fields</p>
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {FIELDS.map(f => (
                  <div key={f.key} className="flex items-center gap-3">
                    <span className="w-32 text-xs text-zinc-600 shrink-0">{f.label}</span>
                    <select value={mapping[f.key] == null ? '' : mapping[f.key]} onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value === '' ? '' : Number(e.target.value) }))} className="flex-1 h-8 text-sm rounded-md border border-zinc-200 px-2 text-zinc-800">
                      <option value="">— Not imported —</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg bg-zinc-50 border border-zinc-100 p-3">
                <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Preview (first 3 rows)</p>
                {records.slice(0, 3).map((r, i) => (
                  <p key={i} className="text-xs text-zinc-600 truncate">{r.client_name} · {r.phone || 'no phone'} · {r.email || 'no email'}</p>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <p className="text-sm text-zinc-600 mb-3">{duplicates.length} possible duplicate{duplicates.length === 1 ? '' : 's'} detected by phone or email.</p>
              {duplicates.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 text-emerald-700 px-3 py-3 text-sm"><Check className="w-4 h-4" /> No duplicates found — all rows will import as new clients.</div>
              ) : (
                <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                  {duplicates.map(d => (
                    <div key={d.index} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-900 truncate">{d.record.client_name}</p>
                          <p className="text-xs text-zinc-500">Matches existing: <span className="font-medium text-zinc-700">{d.match.client_name}</span> · {d.match.phone || d.match.email}</p>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {['skip', 'update', 'merge', 'new'].map(opt => (
                              <button key={opt} onClick={() => setDupChoices(c => ({ ...c, [d.index]: opt }))} className={cn('px-2.5 py-1 rounded-md text-xs font-medium border', (dupChoices[d.index] || 'skip') === opt ? 'border-indigo-500 text-indigo-600 bg-indigo-50' : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50')}>
                                {opt === 'skip' ? 'Skip' : opt === 'update' ? 'Update existing' : opt === 'merge' ? 'Merge records' : 'Import as new'}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="grid grid-cols-2 gap-3">
              <SummaryCard label="New clients" value={summary.create} color="text-emerald-600" />
              <SummaryCard label="Update existing" value={summary.update} color="text-indigo-600" />
              <SummaryCard label="Skipped duplicates" value={summary.skip} color="text-zinc-500" />
              <SummaryCard label="Total rows" value={summary.total} color="text-zinc-900" />
            </div>
          )}

          {step === 5 && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mb-3"><Check className="w-6 h-6" /></div>
              <p className="text-sm text-zinc-700 mb-1">Ready to import</p>
              <p className="text-xs text-zinc-400 mb-5">{summary.create} new · {summary.update} updates · {summary.skip} skipped</p>
              <p className="text-xs text-zinc-400 max-w-xs">Imported clients appear in the directory. They will not enter the Client Workflow unless they have an active recurring setup or current booking request.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-zinc-100 sticky bottom-0 bg-white">
          <Button variant="ghost" className="text-zinc-500 hover:bg-zinc-100" onClick={() => (step > 1 ? setStep(step - 1) : close())} disabled={running}>
            <ChevronLeft className="w-4 h-4" /> {step > 1 ? 'Back' : 'Cancel'}
          </Button>
          {step < 5 ? (
            <Button onClick={() => setStep(step + 1)} disabled={step === 1 && !rows.length} className="bg-[#6366F1] hover:bg-[#5457e6] text-white">Continue <ChevronRight className="w-4 h-4" /></Button>
          ) : (
            <Button onClick={runImport} disabled={running || (summary.create + summary.update === 0)} className="bg-[#6366F1] hover:bg-[#5457e6] text-white">{running ? 'Importing…' : 'Confirm import'}</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <p className={cn('text-2xl font-bold', color)}>{value}</p>
      <p className="text-xs text-zinc-400 mt-0.5">{label}</p>
    </div>
  );
}