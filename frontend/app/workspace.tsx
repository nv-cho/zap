'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Zap, ArrowUpRight, ArrowRight, ArrowLeft, Plus, FileText, BookOpen, Check, CheckCircle2, AlertCircle, Download, X, RotateCcw, Save, Loader2, ShieldCheck, Clock3, Trash2, Sparkles, PenLine, SlidersHorizontal, LockKeyhole, ChevronRight } from 'lucide-react';

type Item = { description: string; quantity: string; unit_price: string };
type Brief = { kind: 'services' | 'partnership'; company: string; client: string; facts: string; company_experience?: Experience[]; customer_id?: string | null; customer_context?: string; opportunity: string; scope: string; start_date: string; end_date: string; terms: string; exclusions: string; items: Item[] };
type Section = { heading: string; body: string; sources: string[] };
type Draft = { title: string; summary: string; sections: Section[]; total: string | null; origin: 'sample' | 'crusoe'; model: string };
type Verdict = { issues: { code: string; message: string; severity: string; section?: string }[]; passed: boolean; expected_total: string | null; checks: string[]; note: string };
type Health = { configured: boolean; model: string; usage: { calls: number; cost: number }; budget: number; max_calls: number };
type Saved = { id: string; title: string; client: string; version: number };
type Question = { field: string; question: string };
type Experience = { description: string; start_date: string; end_date: string };
type Profile = { id: string; name: string; context: string; experience?: Experience[] };
type CompanyForm = { name: string; context: string; experience: Experience[] };
const profileForm = (p: Profile | null): CompanyForm => ({ name: p?.name || '', context: p?.context || '', experience: p?.experience || [] });
type Screen = 'brief' | 'proposal' | 'saved' | 'company' | 'customers';
const progressKey = 'zap.proposal-in-progress.v1';
type Progress = { serverRevision?: number; pendingSync?: boolean; brief: Brief; draft: Draft | null; step: number; view: 'brief' | 'proposal'; stale: boolean; editing: boolean; example: boolean; id: string | null; version: number | null; versions: { version: number; created: string }[]; trace: { step: string; detail: string }[] };
function readProgress(): Progress | null {
  const raw = localStorage.getItem(progressKey);
  if (!raw) return null;
  const value = JSON.parse(raw) as Progress;
  if (!value?.brief || !Array.isArray(value.brief.items) || !['brief', 'proposal'].includes(value.view) || ![0, 1].includes(value.step)) return null;
  if (['company', 'client', 'facts', 'opportunity', 'scope', 'start_date', 'end_date', 'terms', 'exclusions'].some(key => typeof value.brief[key as keyof Brief] !== 'string')) return null;
  if (value.draft && (!Array.isArray(value.draft.sections) || typeof value.draft.title !== 'string')) return null;
  return value;
}
const sourceNames: Record<string, string> = { company: 'Company information', customer: 'Customer context', brief: 'Client need', scope: 'Agreed scope', terms: 'Pricing & terms', dates: 'Project dates', exclusions: 'Exclusions' };
const empty: Brief = { kind: 'services', company: '', client: '', facts: '', opportunity: '', scope: '', start_date: '', end_date: '', terms: '', exclusions: '', items: [] };
const stepFields = [['kind', 'company', 'facts', 'client', 'opportunity', 'scope', 'exclusions'], ['start_date', 'end_date', 'items', 'terms']];
const stepTitles = ['The opportunity', 'The details', 'Review'];
const protectedHeadings = ['Scope', 'Deliverables', 'Timeline', 'Pricing', 'Exclusions', 'Assumptions', 'Acceptance criteria', 'Contributions', 'Responsibilities', 'Commercial arrangement'];
const dollars = (value: string | number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value));

async function api(path: string, body?: unknown) {
  const res = await fetch('/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: 'We couldn’t complete that request. Please try again.' }));
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Check your dates, prices, and required fields, then try again.');
  }
  return res.json();
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary') || []);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, [onClose]);
  return <div className="drawer-backdrop" onClick={onClose}><div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="drawer" onClick={event => event.stopPropagation()}><header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close panel"><X size={21}/></button></header><div className="drawer-body">{children}</div></div></div>;
}

export default function Workspace() {
  const [screen, setScreen] = useState<Screen>('saved');
  const [step, setStep] = useState(0);
  const [brief, setBrief] = useState<Brief>(empty);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stale, setStale] = useState(false);
  const [approved, setApproved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [example, setExample] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [trace, setTrace] = useState<{ step: string; detail: string }[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [versions, setVersions] = useState<{ version: number; created: string }[]>([]);
  const [drawer, setDrawer] = useState<'review' | 'details' | 'crusoe' | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const requestLock = useRef(false);

  const [company, setCompany] = useState<Profile | null>(null);
  const [customers, setCustomers] = useState<Profile[]>([]);
  const [companyForm, setCompanyForm] = useState<CompanyForm>({ name: '', context: '', experience: [] });
  const [customerForm, setCustomerForm] = useState({ id: '', name: '', context: '' });
  const [customerEditor, setCustomerEditor] = useState(false);
  const [returnToBrief, setReturnToBrief] = useState(false);
  const [ready, setReady] = useState(false);
  const [inProgress, setInProgress] = useState(false);
  const [resumeView, setResumeView] = useState<'brief' | 'proposal'>('brief');
  const [storageFailed, setStorageFailed] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'saving' | 'saved' | 'error'>('saved');
  const [syncError, setSyncError] = useState('');
  const serverRevision = useRef(0);
  const syncedProgress = useRef('');
  const latestProgress = useRef('');
  const syncBlocked = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  const [replacement, setReplacement] = useState<{ kind: 'new' } | { kind: 'saved'; key: string; version?: number } | null>(null);
  const cancelReplacement = useCallback(() => setReplacement(null), []);
  const unfinished = inProgress && (!version || stale) && !!(draft || brief.client || brief.opportunity || brief.scope || brief.exclusions || brief.items.length || brief.start_date || brief.end_date || brief.terms);

  useEffect(() => {
    let restored: Progress | null = null;
    try { restored = readProgress(); } catch { setStorageFailed(true); }
    Promise.all([api('health'), api('proposals'), api('company'), api('customers'), api('progress')]).then(async ([h, proposals, c, clients, shared]) => {
      serverRevision.current = shared.revision;
      const pendingLocal = restored?.pendingSync && restored.serverRevision === shared.revision;
      if (shared.progress && !pendingLocal) {
        // Preserve the previous browser-only copy when migrating to shared storage.
        if (restored) {
          try { localStorage.setItem(progressKey + '.backup', JSON.stringify(restored)); } catch { /* Best effort backup. */ }
        }
        restored = shared.progress as Progress;
      }
      if (restored) {
        const { serverRevision: oldRevision, pendingSync, ...content } = restored;
        void oldRevision; void pendingSync;
        syncedProgress.current = shared.progress && !pendingLocal ? JSON.stringify(content) : '';
        setBrief(restored.brief); setDraft(restored.draft); setStep(restored.step);
        setResumeView(restored.view === 'proposal' && !restored.draft ? 'brief' : restored.view);
        setStale(restored.stale); setEditing(restored.editing); setExample(restored.example);
        setId(restored.id); setVersion(restored.version); setVersions(restored.versions || []); setTrace(restored.trace || []);
        setInProgress(true);
        // Approval is renewed after recovery; requests are never replayed.
        setApproved(false); setVerdict(null);
      }
      setHealth(h); setSaved(proposals); setCompany(c); setCompanyForm(profileForm(c)); setCustomers(clients);
      const query = new URLSearchParams(window.location.search);
      if (restored && (query.has('new') || query.has('example'))) {
        setScreen(restored.view === 'proposal' && restored.draft ? 'proposal' : 'brief');
        setNotice('Your in-progress proposal is ready to continue. Use New proposal to start another.');
      }
      else if (query.has('example')) { setInProgress(true); const data = await api('sample?kind=services'); setBrief(data.brief); setExample(true); setScreen('brief'); }
      else if (query.has('new')) {
        setInProgress(true);
        setBrief({ ...empty, company: c?.name || '', facts: c?.context || '', company_experience: c?.experience || [] });
        setReturnToBrief(true); setScreen(c ? 'brief' : 'company');
      }
      else {
        const view = query.get('view');
        if (view === 'company' || view === 'customers' || view === 'saved') setScreen(view);
        else if (view === 'proposal') setScreen(restored?.draft ? 'proposal' : 'saved');
        else if (view === 'brief') {
          if (!restored) {
            setBrief({ ...empty, company: c?.name || '', facts: c?.context || '', company_experience: c?.experience || [] });
            setInProgress(true);
          }
          setScreen('brief');
        }
      }
      setReady(true);
    }).catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    if (ready) window.history.replaceState(window.history.state, '', '/app?view=' + screen);
  }, [ready, screen]);
  useEffect(() => {
    if (screen === 'brief' || screen === 'proposal') setResumeView(screen);
  }, [screen]);
  useEffect(() => {
    if (!ready || !inProgress) return;
    const progress: Progress = { brief, draft, step, view: screen === 'brief' || screen === 'proposal' ? screen : resumeView, stale, editing, example, id, version, versions, trace };
    const serialized = JSON.stringify(progress);
    latestProgress.current = serialized;
    const writeLocal = (pendingSync: boolean) => {
      try {
        localStorage.setItem(progressKey, JSON.stringify({ ...progress, serverRevision: serverRevision.current, pendingSync }));
        setStorageFailed(false);
      } catch { setStorageFailed(true); }
    };
    writeLocal(serialized !== syncedProgress.current);
    if (syncBlocked.current || serialized === syncedProgress.current) return;
    setSyncStatus('saving');
    const timer = window.setTimeout(() => {
      saveQueue.current = saveQueue.current.then(async () => {
        if (syncBlocked.current || serialized !== latestProgress.current || serialized === syncedProgress.current) return;
        try {
          const response = await fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_revision: serverRevision.current, progress }) });
          const data = await response.json();
          if (!response.ok) {
            if (response.status === 409) syncBlocked.current = true;
            throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not save the proposal. Your local copy is still available in this browser.');
          }
          serverRevision.current = data.revision;
          syncedProgress.current = serialized;
          // A newer edit may have arrived while this request was in flight.
          if (latestProgress.current === serialized) {
            writeLocal(false); setSyncStatus('saved'); setSyncError('');
          } else {
            try { localStorage.setItem(progressKey, JSON.stringify({ ...JSON.parse(latestProgress.current), serverRevision: data.revision, pendingSync: true })); } catch { setStorageFailed(true); }
          }
        } catch (e) {
          setSyncStatus('error'); setSyncError(e instanceof Error ? e.message : 'Could not save the proposal. Keep this browser open.');
        }
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [ready, inProgress, brief, draft, step, screen, resumeView, stale, editing, example, id, version, versions, trace]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [screen, step]);
  const closeDrawer = useCallback(() => setDrawer(null), []);

  async function action(name: string, fn: () => Promise<void>) {
    if (requestLock.current) return;
    requestLock.current = true; setBusy(name); setError(''); setNotice('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { requestLock.current = false; setBusy(''); api('health').then(setHealth).catch(() => {}); }
  }
  function reset() {
    setBrief(empty); setDraft(null); setVerdict(null); setId(null); setVersion(null); setVersions([]); setQuestions([]); setTrace([]); setStale(false); setApproved(false); setEditing(false); setExample(false); setShowSources(false); setSource(null); setDrawer(null); setNotice(''); setError(''); setStep(0);
  }
  function start() {
    if (busy || !ready) return;
    if (unfinished) { setReplacement({ kind: 'new' }); return; }
    createNew();
  }
  function createNew() {
    setInProgress(true); setResumeView('brief');
    reset(); setBrief({ ...empty, company: company?.name || '', facts: company?.context || '', company_experience: company?.experience || [] });
    setReturnToBrief(true); setScreen(company ? 'brief' : 'company');
  }
  function resume() {
    if (busy) return;
    setError(''); setNotice(''); setDrawer(null);
    if (!brief.company && company) patch({ company: company.name, facts: company.context, company_experience: company.experience || [] });
    if (!brief.company && !company) { openCompany(true); return; }
    setScreen(resumeView === 'proposal' && draft ? 'proposal' : 'brief');
  }
  function openCompany(fromBrief = false) {
    setCompanyForm(profileForm(company)); setReturnToBrief(fromBrief); setScreen('company');
  }
  function openCustomers(fromBrief = false) { setReturnToBrief(fromBrief); setCustomerEditor(false); setScreen('customers'); }
  async function saveCompany() {
    await action('company', async () => {
      const value = await api('company', companyForm); setCompany(value); setCompanyForm(profileForm(value));
      if (returnToBrief) { patch({ company: value.name, facts: value.context, company_experience: value.experience || [] }); setScreen('brief'); }
      setNotice('Company saved. Ready to reuse in your proposals.');
    });
  }
  function chooseCustomer(value: Profile) {
    patch({ client: value.name, customer_id: value.id, customer_context: value.context });
  }
  async function saveCustomer() {
    await action('customer', async () => {
      const value = await api('customers' + (customerForm.id ? '/' + customerForm.id : ''), { name: customerForm.name, context: customerForm.context });
      setCustomers(await api('customers')); setCustomerEditor(false);
      if (returnToBrief) { chooseCustomer(value); setScreen('brief'); }
      setNotice('Customer saved. Their context is ready for your next proposal.');
    });
  }
  function patch(part: Partial<Brief>) {
    setInProgress(true);
    setBrief(b => ({ ...b, ...part })); setStale(true); setApproved(false); setVerdict(null); setNotice('');
    setQuestions(q => q.filter(item => !(item.field in part)));
  }
  function editDraft(part: Partial<Draft>) {
    if (busy) return;
    setDraft(d => d ? { ...d, ...part } : d); setVersion(null); setVerdict(null); setApproved(false); setNotice('');
  }
  async function next() {
    await action('prepare', async () => {
      const data = await api('prepare', { ...brief, items: [], start_date: '', end_date: '' });
      const relevant = data.questions.filter((q: Question) => stepFields[step].includes(q.field));
      setQuestions(relevant);
      if (!relevant.length) setStep(s => Math.min(s + 1, 1));
      else setTimeout(() => document.getElementById('field-' + relevant[0].field)?.focus(), 0);
    });
  }
  async function generate() {
    await action('generate', async () => {
      const prep = await api('prepare', brief); setQuestions(prep.questions);
      if (prep.questions.length) { setStep(Math.max(0, stepFields.findIndex(fields => fields.includes(prep.questions[0].field)))); return; }
      const data = await api('generate', brief);
      if (data.draft) { setDraft(data.draft); setVerdict(data.validation); setTrace(data.trace); setStale(false); setApproved(false); setEditing(false); setVersion(null); setScreen('proposal'); }
      else setQuestions(data.questions || []);
    });
  }
  async function check() {
    if (draft) await action('validate', async () => { setVerdict(await api('validate', { brief, draft })); });
  }
  async function openReview() {
    setDrawer('review');
    if (draft && !stale) await check();
  }
  async function save() {
    if (draft) await action('save', async () => {
      const data = await api('save', { brief, draft, proposal_id: id }); setId(data.id); setVersion(data.version); setSaved(await api('proposals'));
      const loaded = await api('proposals/' + data.id); setVersions(loaded.versions); setNotice(`Saved as version ${data.version}.`);
    });
  }
  async function loadSaved(key: string, v?: number, confirmed = false) {
    if (unfinished && !confirmed) { setDrawer(null); setReplacement({ kind: 'saved', key, version: v }); return; }
    await action('load', async () => {
      const data = await api('proposals/' + key + (v ? '?version=' + v : ''));
      setInProgress(true); setResumeView('proposal');
      setBrief(data.brief); setDraft(data.draft); setVerdict(data.validation); setId(data.id); setVersion(data.version); setVersions(data.versions); setApproved(false); setStale(false); setQuestions([]); setExample(false); setTrace([{ step: 'Saved proposal opened', detail: `Version ${data.version}` }]); setScreen('proposal'); setEditing(false); setDrawer(null); setSource(null);
    });
  }
  async function exportDoc() {
    if (!draft) return;
    await action('export', async () => {
      const res = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief, draft, approved }) });
      if (!res.ok) { const data = await res.json(); throw new Error(data.detail); }
      const url = URL.createObjectURL(await res.blob()); const link = document.createElement('a'); link.href = url; link.download = 'zap-' + brief.client.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.docx'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('Your Word document is ready. Check your downloads.');
    });
  }
  const field = (label: string, key: keyof Brief, options: { multiline?: boolean; placeholder?: string; hint?: string; type?: string; rows?: number } = {}) => {
    const question = questions.find(q => q.field === key);
    return <label className={'field ' + (question ? 'invalid' : '')}><span>{label}</span>{options.hint && <small>{options.hint}</small>}{options.multiline ? <textarea id={'field-' + key} aria-label={label} aria-invalid={!!question} rows={options.rows || 4} value={String(brief[key])} placeholder={options.placeholder} disabled={!!busy} onChange={e => patch({ [key]: e.target.value })} /> : <input id={'field-' + key} aria-label={label} aria-invalid={!!question} type={options.type || 'text'} value={String(brief[key])} placeholder={options.placeholder} disabled={!!busy} onChange={e => patch({ [key]: e.target.value })}/>} {question && <em><AlertCircle size={13}/>{question.question}</em>}</label>;
  };
  const errors = verdict?.issues.filter(i => i.severity === 'error') || [];
  const sourceText = source === 'company' ? [brief.facts, ...(brief.company_experience || []).map(e => `${e.start_date} to ${e.end_date}: ${e.description}`)].join('\n\n') : source === 'customer' ? brief.customer_context : source === 'brief' ? brief.opportunity : source === 'scope' ? brief.scope : source === 'terms' ? brief.terms : source === 'dates' ? `${brief.start_date} to ${brief.end_date}` : brief.exclusions;
  const savedCards = (items: Saved[]) => <div className="saved-grid">{items.map((p, i) => <button key={p.id} className="saved-card" onClick={() => loadSaved(p.id)} disabled={!!busy}><div className={'card-thumbnail tone-' + i % 3}><FileText size={30} strokeWidth={1.2}/><span>PROPOSAL</span><div/><div/><div/></div><div className="saved-copy"><span>{p.client}</span><h3>{p.title}</h3><footer>Version {p.version}<ArrowUpRight size={17}/></footer></div></button>)}</div>;

  return <div className={'app ' + (screen === 'proposal' ? 'document-mode' : '')}>
    <header className="navigation workspace-nav"><Link className="wordmark" href="/" aria-label="Zap landing page"><span><Zap size={22} fill="currentColor"/></span>zap<span className="wordmark-dot">.</span></Link><div className="navigation-right"><span className="workspace-label">YOUR WORKSPACE</span><button className="button primary small" onClick={start} disabled={!!busy || !ready}><Plus size={15}/>New proposal</button></div></header>
    <nav className="workspace-tabs" aria-label="Workspace"><button className={screen === 'saved' ? 'active' : ''} disabled={!!busy} onClick={() => setScreen('saved')}>Proposals</button><button className={screen === 'customers' ? 'active' : ''} disabled={!!busy} onClick={() => openCustomers()}>Customers<span>{customers.length}</span></button><button className={screen === 'company' ? 'active' : ''} disabled={!!busy} onClick={() => openCompany()}>My company{company && <Check size={13}/>}</button>{inProgress && screen !== 'brief' && screen !== 'proposal' && <button className="resume-proposal" onClick={resume} disabled={!!busy}><ArrowLeft size={14}/>Resume your current proposal</button>}{(screen === 'brief' || screen === 'proposal') && <span className="current-work">{syncStatus === 'saved' ? 'Progress saved' : syncStatus === 'saving' ? 'Saving progress…' : 'Progress not synced'}</span>}</nav>
    {syncError && <div className="message-wrap"><div className="message error" role="status"><AlertCircle size={18}/><span>{syncError}</span></div></div>}
    {storageFailed && syncStatus !== 'saved' && inProgress && <div className="message-wrap"><div className="message error" role="status"><AlertCircle size={18}/><span>Browser storage is unavailable. You can switch sections, but keep this tab open to preserve unfinished work.</span></div></div>}
    {(error || notice) && <div className="message-wrap" role="status"><div className={'message ' + (error ? 'error' : '')}>{error ? <AlertCircle size={18}/> : <CheckCircle2 size={18}/>}<span>{error || notice}</span><button aria-label="Dismiss message" onClick={() => { setError(''); setNotice(''); }}><X size={16}/></button></div></div>}

    {screen === 'brief' && <main className="brief-page"><button className="back-link" disabled={!!busy} onClick={() => draft ? setScreen('proposal') : setScreen('saved')}><ArrowLeft size={15}/>{draft ? 'Back to your proposal' : 'Back to proposals'}</button><div className="brief-intro"><span className="eyebrow">LET’S PUT IT ON PAPER</span><h1>{step === 0 ? 'What’s the opportunity?' : 'Let’s get the details right.'}</h1><p>{step === 0 ? 'Choose a customer and describe this opportunity.' : 'Confirm the dates and terms, then create your draft for review.'}</p></div><div className="stepper" aria-label="Proposal setup progress">{stepTitles.map((title, i) => <button key={title} aria-current={step === i ? 'step' : undefined} disabled={!!busy || i > step} onClick={() => { setQuestions([]); setStep(i); }} className={i === step ? 'current' : i < step ? 'complete' : ''}><span>{i < step ? <Check size={13}/> : i + 1}</span>{title}</button>)}</div><section className="brief-card">{example && <div className="sample-note"><Sparkles size={15}/><span>You’re trying a fictional example. Change anything you like.</span></div>}
      {step === 0 && <div className="form-content"><fieldset className="type-picker"><legend>What kind of proposal?</legend><button aria-pressed={brief.kind === 'services'} className={brief.kind === 'services' ? 'selected' : ''} onClick={() => patch({ kind: 'services' })} disabled={!!busy}><FileText size={19}/><span><strong>Services</strong><small>Quote a project or engagement</small></span><span className="radio-dot"/></button><button aria-pressed={brief.kind === 'partnership'} className={brief.kind === 'partnership' ? 'selected' : ''} onClick={() => patch({ kind: 'partnership' })} disabled={!!busy}><Sparkles size={19}/><span><strong>Partnership</strong><small>Build something together</small></span><span className="radio-dot"/></button></fieldset><div className="reused-profile"><div><small>YOUR COMPANY</small><strong>{brief.company || 'Set up your company'}</strong><span>{example ? 'Fictional example context' : 'Company context included in this proposal'}</span></div><button className="text-link" onClick={() => openCompany(true)} disabled={!!busy}>Update<ArrowUpRight size={14}/></button></div>{(!brief.company || !brief.facts) && <p className="field-error">Save your company profile to continue.</p>}<label className="field"><span>Customer</span><select id="field-client" aria-label="Customer" value={brief.customer_id || (brief.client ? '__snapshot' : '')} disabled={!!busy} onChange={e => { const c = customers.find(c => c.id === e.target.value); if (c) chooseCustomer(c); else patch({ client: '', customer_context: '', customer_id: null }); }}><option value="">Select a customer</option>{brief.client && !brief.customer_id && <option value="__snapshot">{brief.client}{example ? ' · fictional example' : ' · saved proposal context'}</option>}{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{questions.some(q => q.field === 'client') && <em>Select or add a customer.</em>}</label><button className="text-link" onClick={() => openCustomers(true)} disabled={!!busy}><Plus size={14}/>Add or manage customers</button>{field('What do they need?', 'opportunity', { multiline: true, placeholder: 'They’re opening a second location and need a brand refresh and website…', rows: 3 })}{field(brief.kind === 'services' ? 'What will we provide?' : 'What will each partner contribute?', 'scope', { multiline: true, placeholder: 'List the work you have agreed to do, including quantities and revision limits.', hint: 'Be specific. These commitments will appear in the proposal.', rows: 4 })}{field('What’s outside the scope?', 'exclusions', { multiline: true, placeholder: 'e.g. Ongoing maintenance, paid advertising, and photography.', hint: 'Write “None” if there are no exclusions.', rows: 3 })}</div>}
      {step === 1 && <div className="form-content"><div className="field-pair">{field('Start date', 'start_date', { type: 'date' })}{field('Finish date', 'end_date', { type: 'date' })}</div>{brief.kind === 'services' && <div className="pricing-fields"><div className="field-title"><h3>What will it cost?</h3><span>USD</span></div><p>Add the agreed line items. Zap calculates the total.</p>{brief.items.map((item, i) => <div className="price-row" key={i}><label className="price-description"><span>Item {i + 1}</span><input disabled={!!busy} aria-label={`Item ${i + 1} description`} value={item.description} placeholder="e.g. Website design" onChange={e => patch({ items: brief.items.map((x, j) => j === i ? { ...x, description: e.target.value } : x) })}/></label><label><span>Qty</span><input disabled={!!busy} aria-label={`Item ${i + 1} quantity`} type="number" min="0.01" step="0.01" value={item.quantity} onChange={e => patch({ items: brief.items.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x) })}/></label><label><span>Unit price</span><input disabled={!!busy} aria-label={`Item ${i + 1} unit price`} type="number" min="0" step="0.01" value={item.unit_price} onChange={e => patch({ items: brief.items.map((x, j) => j === i ? { ...x, unit_price: e.target.value } : x) })}/></label><button className="icon-button" aria-label={`Remove item ${i + 1}`} disabled={!!busy} onClick={() => patch({ items: brief.items.filter((_, j) => j !== i) })}><Trash2 size={16}/></button></div>)}<button className="text-link" disabled={!!busy} onClick={() => patch({ items: [...brief.items, { description: '', quantity: '1', unit_price: '0' }] })}><Plus size={15}/>Add an item</button>{questions.some(q => q.field === 'items') && <p className="field-error">Add at least one item with an agreed price.</p>}</div>}{field(brief.kind === 'services' ? 'Payment terms' : 'Commercial arrangement', 'terms', { multiline: true, placeholder: brief.kind === 'services' ? 'e.g. 50% deposit, 50% on final approval.' : 'e.g. No fees. Each partner covers their own costs.', rows: 3 })}<div className="gentle-note"><ShieldCheck size={17}/><p>You’ll review the proposal before exporting. Nothing is sent automatically.</p></div></div>}
      <div className="form-footer"><button className="button text" disabled={!!busy} onClick={() => step ? setStep(step - 1) : setScreen('saved')}><ArrowLeft size={16}/>{step ? 'Back' : 'Cancel'}</button>{step < 1 ? <button className="button primary" onClick={next} disabled={!!busy}>{busy === 'prepare' && <Loader2 size={16} className="spin"/>}Continue<ArrowRight size={17}/></button> : <button className="button primary" onClick={generate} disabled={!!busy}>{busy === 'generate' ? <Loader2 size={17} className="spin"/> : <Sparkles size={17}/>} {busy === 'generate' ? 'Writing your proposal…' : 'Create draft & review'}{busy !== 'generate' && <ArrowRight size={17}/>}</button>}</div></section>{busy === 'generate' && <div className="generation-note" role="status"><span className="pulse-dot"/><div><strong>Putting your proposal together.</strong><p>Crusoe is drafting, then Zap checks the details. Keep this page open.</p></div></div>}<p className="brief-footnote">Step {step + 1} of 3 · {step < 1 ? 'Your answers stay here as you go.' : 'You can edit the draft before exporting.'}</p></main>}

    {screen === 'proposal' && draft && <main className="proposal-page"><div className="stepper review-stepper" aria-label="Proposal progress">{stepTitles.map((title, i) => <button key={title} className={i === 2 ? 'current' : 'complete'} aria-current={i === 2 ? 'step' : undefined} disabled={!!busy} onClick={() => { if (i < 2) { setStep(i); setScreen('brief'); } }}><span>{i === 2 ? 3 : <Check size={13}/>}</span>{title}</button>)}</div><div className="proposal-heading"><div><button className="back-link" onClick={() => { setStep(0); setScreen('brief'); }} disabled={!!busy}><ArrowLeft size={15}/>Edit brief</button><h1>A proposal for {brief.client}.</h1><p>{draft.origin === 'sample' ? 'Fictional example · no AI generation' : 'Your first draft is ready. Read it through and make it yours.'}</p></div><button className="button primary" onClick={openReview} disabled={!!busy || stale}>Review & export<ArrowRight size={17}/></button></div>{stale && <div className="stale-message"><AlertCircle size={18}/><span>Your brief has changed. Create a new draft to include your updates.</span><button className="text-link" onClick={() => { setStep(1); setScreen('brief'); }}>Update proposal<ArrowRight size={15}/></button></div>}<div className="document-tools"><div className="document-state"><span className="status-dot"/>{version ? `Saved · Version ${version}` : 'Draft · ready for your review'}</div><div><button className={'tool-button ' + (editing ? 'selected' : '')} onClick={() => setEditing(!editing)} disabled={!!busy || stale}>{editing ? <Check size={15}/> : <PenLine size={15}/>} {editing ? 'Done editing' : 'Edit text'}</button><button className="tool-button" onClick={save} disabled={!!busy || stale}>{busy === 'save' ? <Loader2 size={15} className="spin"/> : <Save size={15}/>}Save</button><button className="tool-button" onClick={() => setDrawer('details')} disabled={!!busy}><SlidersHorizontal size={15}/>Details</button></div></div>
      {editing && <div className="editing-note"><PenLine size={15}/>Edit the narrative here. To change agreed scope, prices, or dates, use “Edit brief”.</div>}
      <article className="proposal-paper"><div className="paper-header"><span className="paper-company"><span>✳</span>{brief.company}</span><span>{brief.kind === 'services' ? 'SERVICES PROPOSAL' : 'PARTNERSHIP PROPOSAL'}</span></div><div className="paper-cover"><span className="eyebrow">PREPARED FOR {brief.client.toUpperCase()}</span>{editing ? <input className="title-edit" aria-label="Proposal title" value={draft.title} onChange={e => editDraft({ title: e.target.value })}/> : <h2>{draft.title}</h2>}{editing ? <textarea className="summary-edit" aria-label="Proposal summary" value={draft.summary} onChange={e => editDraft({ summary: e.target.value })}/> : <p>{draft.summary}</p>}<div className="paper-meta"><div><small>PREPARED BY</small><span>{brief.company}</span></div><div><small>PROJECT DATES</small><span>{brief.start_date} — {brief.end_date}</span></div>{draft.total && <div><small>INVESTMENT</small><strong>{dollars(draft.total)}</strong></div>}</div></div><div className="paper-sections">{draft.sections.map((s, i) => <section className="proposal-section" key={i}><div className="section-heading"><span>{String(i + 1).padStart(2, '0')}</span><h3>{s.heading}</h3>{editing && protectedHeadings.includes(s.heading) && <LockKeyhole size={13} aria-label="From the approved brief"/>}</div>{editing && !protectedHeadings.includes(s.heading) ? <textarea aria-label={s.heading + ' content'} rows={Math.max(3, Math.ceil(s.body.length / 80))} value={s.body} onChange={e => editDraft({ sections: draft.sections.map((x, j) => i === j ? { ...x, body: e.target.value } : x) })}/> : <p>{s.body}</p>}{showSources && <div className="source-tags">{s.sources.map(ref => <button key={ref} onClick={() => { setSource(ref); setDrawer('details'); }}><BookOpen size={11}/>{sourceNames[ref] || ref}</button>)}</div>}</section>)}</div><footer className="paper-footer"><span>{brief.company}</span><span>Prepared with zap.</span></footer></article><div className="end-of-proposal"><CheckCircle2 size={22}/><h3>Happy with the draft?</h3><p>Give it a final review, then make it a Word document.</p><button className="button primary" onClick={openReview} disabled={!!busy || stale}>Review & export<ArrowRight size={17}/></button></div></main>}

    {screen === 'company' && <main className="brief-page profile-page"><div className="brief-intro"><h1>Your company.</h1></div><form className="brief-card" onSubmit={e => { e.preventDefault(); saveCompany(); }}><div className="form-content"><label className="field"><span>Company name</span><input aria-label="Company name" required maxLength={150} value={companyForm.name} disabled={!!busy} onChange={e => setCompanyForm({ ...companyForm, name: e.target.value })} placeholder="e.g. Forma Studio"/></label><label className="field"><span>Your company context</span><small>Services, expertise, and approved facts. Keep opportunity-specific scope and prices in each proposal.</small><textarea aria-label="Your company context" required maxLength={12000} rows={9} value={companyForm.context} disabled={!!busy} onChange={e => setCompanyForm({ ...companyForm, context: e.target.value })} placeholder="We are a design studio helping local businesses build their brands…"/></label><section className="experience-section"><div className="experience-heading"><h2>Experience</h2><button type="button" className="text-link" disabled={!!busy || companyForm.experience.length >= 20} onClick={() => setCompanyForm(f => ({ ...f, experience: [...f.experience, { description: '', start_date: '', end_date: '' }] }))}><Plus size={15}/>Add experience</button></div>{companyForm.experience.length === 0 && <p className="profile-footnote">Add past work to reuse in your proposals.</p>}{companyForm.experience.map((item, index) => <div className="experience-row" key={index}><div className="experience-row-heading"><span>Experience {index + 1}</span><button type="button" className="icon-button" aria-label={`Remove experience ${index + 1}`} disabled={!!busy} onClick={() => setCompanyForm(f => ({ ...f, experience: f.experience.filter((_, i) => i !== index) }))}><Trash2 size={16}/></button></div><label className="field"><span>What we did</span><textarea aria-label={`Experience ${index + 1} description`} rows={3} required maxLength={2000} disabled={!!busy} value={item.description} placeholder="Describe the project, your role, and the work delivered." onChange={e => setCompanyForm(f => ({ ...f, experience: f.experience.map((x, i) => i === index ? { ...x, description: e.target.value } : x) }))}/></label><div className="field-pair"><label className="field"><span>Start date</span><input aria-label={`Experience ${index + 1} start date`} type="date" required disabled={!!busy} value={item.start_date} onChange={e => setCompanyForm(f => ({ ...f, experience: f.experience.map((x, i) => i === index ? { ...x, start_date: e.target.value } : x) }))}/></label><label className="field"><span>End date</span><input aria-label={`Experience ${index + 1} end date`} type="date" min={item.start_date || undefined} required disabled={!!busy} value={item.end_date} onChange={e => setCompanyForm(f => ({ ...f, experience: f.experience.map((x, i) => i === index ? { ...x, end_date: e.target.value } : x) }))}/></label></div>{item.start_date && item.end_date && item.end_date < item.start_date && <p className="field-error">End date must be on or after the start date.</p>}</div>)}</section><p className="profile-footnote">Saved locally. Used as reference material when you generate with Crusoe. Existing saved proposals keep their original context.</p></div><div className="form-footer"><button type="button" className="button text" disabled={!!busy} onClick={() => setScreen(returnToBrief ? 'brief' : 'saved')}>Back</button><button className="button primary" disabled={!!busy || !ready || !companyForm.name.trim() || !companyForm.context.trim() || companyForm.experience.some(e => !e.description.trim() || !e.start_date || !e.end_date || e.end_date < e.start_date)}>{busy === 'company' ? <Loader2 size={16} className="spin"/> : <Save size={16}/>}Save company{ returnToBrief ? ' & continue' : ''}</button></div></form></main>}

    {screen === 'customers' && <main className="library-page"><div className="library-heading"><div><h1>Your customers.</h1></div><button className="button primary" disabled={!!busy} onClick={() => { setCustomerForm({id:'',name:'',context:''}); setCustomerEditor(true); }}><Plus size={16}/>Add customer</button></div>{returnToBrief && <button className="back-link" onClick={() => setScreen('brief')} disabled={!!busy}><ArrowLeft size={15}/>Back to opportunity</button>}{customerEditor && <form className="brief-card customer-form" onSubmit={e => { e.preventDefault(); saveCustomer(); }}><div className="form-content"><h2>{customerForm.id ? 'Edit customer' : 'A little about your customer'}</h2><label className="field"><span>Customer name</span><input aria-label="Customer name" required maxLength={150} value={customerForm.name} disabled={!!busy} onChange={e => setCustomerForm({...customerForm,name:e.target.value})} placeholder="e.g. Northstar Coffee"/></label><label className="field"><span>What does this customer do?</span><small>Their business, customers, market, and background. Describe the specific opportunity when you create a proposal.</small><textarea aria-label="What does this customer do?" required maxLength={12000} rows={6} value={customerForm.context} disabled={!!busy} onChange={e => setCustomerForm({...customerForm,context:e.target.value})} placeholder="An independent coffee shop serving its neighborhood…"/></label></div><div className="form-footer"><button type="button" className="button text" onClick={() => setCustomerEditor(false)} disabled={!!busy}>Cancel</button><button className="button primary" disabled={!!busy || !customerForm.name.trim() || !customerForm.context.trim()}><Save size={16}/>{returnToBrief ? 'Save & select customer' : 'Save customer'}</button></div></form>}{!customers.length && !customerEditor ? <div className="empty-library"><BookOpen size={36}/><h2>Your customer context starts here.</h2><p>Add a customer so you can select them whenever a new opportunity comes up.</p></div> : <div className="customer-grid">{customers.map(c => <article className="customer-card" key={c.id}><span className="customer-initial">{c.name.charAt(0).toUpperCase()}</span><h2>{c.name}</h2><p>{c.context}</p><div><button className="text-link" disabled={!!busy} onClick={() => { setCustomerForm(c); setCustomerEditor(true); window.scrollTo({top:0,behavior:'smooth'}); }}>Edit context<PenLine size={14}/></button>{returnToBrief && <button className="button secondary small" disabled={!!busy} onClick={() => { chooseCustomer(c); setScreen('brief'); }}>Select<ArrowRight size={14}/></button>}</div></article>)}</div>}</main>}

    {screen === 'saved' && <main className="library-page"><div className="library-heading"><div><h1>Your proposals.</h1></div><button className="button primary" onClick={start}><Plus size={16}/>Create a proposal</button></div>{!company && <div className="setup-banner"><div><strong>Make your next proposal easier.</strong><p>Save your company context once, then add the customers you work with.</p></div><button className="button secondary small" onClick={() => openCompany()}>Set up my company<ArrowRight size={15}/></button></div>}{saved.length ? savedCards(saved) : <div className="empty-library"><FileText size={40} strokeWidth={1}/><h2>Your next opportunity belongs here.</h2><p>Save a proposal and you can come back to it anytime.</p><button className="button primary" onClick={start}>Create your first proposal<ArrowRight size={16}/></button></div>}</main>}

    <footer className="app-footer"><span>Good work deserves a good proposal.</span><button onClick={() => setDrawer('crusoe')}><Zap size={13}/>Powered by Crusoe<ArrowUpRight size={12}/></button></footer>

    {replacement && <Drawer title="Keep your current work?" onClose={cancelReplacement}><p className="drawer-intro">You have an unfinished proposal{brief.client ? ` for ${brief.client}` : ''}. {replacement.kind === 'new' ? 'Starting a new proposal' : 'Opening another saved version'} replaces the current unfinished proposal. Previously saved versions remain available.</p><button className="button primary full" onClick={() => { setReplacement(null); resume(); }}>Keep working on this proposal<ArrowRight size={16}/></button><button className="button text full" onClick={() => { const choice = replacement; setReplacement(null); if (choice.kind === 'new') createNew(); else loadSaved(choice.key, choice.version, true); }}>{replacement.kind === 'new' ? 'Replace with a new proposal' : 'Replace with the saved version'}</button></Drawer>}
    {drawer && <Drawer title={drawer === 'review' ? 'One last look.' : drawer === 'details' ? 'Behind the proposal' : 'Powered by Crusoe'} onClose={closeDrawer}>
      {error && <div className="drawer-message error"><AlertCircle size={16}/>{error}</div>}
      {notice && <div className="drawer-message"><CheckCircle2 size={16}/>{notice}</div>}
      {drawer === 'review' && <><p className="drawer-intro">Read the proposal, confirm the commitments, and download your document.</p><div className={'review-result ' + (verdict?.passed && !stale ? 'passed' : '')}>{busy === 'validate' ? <Loader2 size={25} className="spin"/> : verdict?.passed && !stale ? <CheckCircle2 size={25}/> : <AlertCircle size={25}/>}<div><h3>{busy === 'validate' ? 'Checking the details…' : stale ? 'Your brief has changed' : !verdict ? 'Run the checks first' : errors.length ? `${errors.length} ${errors.length === 1 ? 'detail needs' : 'details need'} attention` : 'The checks look good.'}</h3><p>{verdict?.passed ? 'Now review the wording and commitments.' : 'Resolve these items before exporting.'}</p></div></div>{verdict?.issues.map((issue, i) => <div className={'issue ' + issue.severity} key={i}><AlertCircle size={16}/><div>{issue.section && <strong>{issue.section}</strong>}<p>{issue.message}</p></div></div>)}{(!verdict?.passed || errors.length > 0) && <button className="button secondary full" disabled={!!busy || stale} onClick={check}><RotateCcw size={15}/>Run checks again</button>}<details className="check-details"><summary>What did Zap check?<ChevronRight size={15}/></summary><ul>{verdict?.checks.map(c => <li key={c}><Check size={13}/>{c}</li>)}</ul><p>These checks catch specific issues. They don’t verify every claim or replace your review.</p></details><div className="review-confirmation"><h3>The final word is yours.</h3><p>Make sure the scope, price, timing, and promises match what you intend to offer.</p><label className="approval"><input type="checkbox" checked={approved} disabled={!verdict?.passed || stale || !!busy} onChange={e => setApproved(e.target.checked)}/><span>I’ve reviewed the proposal and its commitments.</span></label></div><button className="button primary full" disabled={!approved || !!busy || stale} onClick={exportDoc}>{busy === 'export' ? <Loader2 size={17} className="spin"/> : <Download size={17}/>}Download Word document</button><span className="download-hint">Editable .docx · nothing is sent to the client</span></>}
      {drawer === 'details' && <><p className="drawer-intro">Your source material and saved versions, whenever you need them.</p><section className="drawer-section"><h3>Source references</h3><p>See which parts of the brief each section refers to. References help you review; they don’t prove every claim.</p><label className="toggle"><input type="checkbox" checked={showSources} onChange={e => setShowSources(e.target.checked)}/><span>Show sources on the proposal</span></label>{showSources && <button className="text-link" onClick={closeDrawer}>Back to the proposal<ArrowRight size={15}/></button>}{source && <div className="source-excerpt"><strong>{sourceNames[source] || source}</strong><p>{sourceText || 'No source text supplied.'}</p></div>}</section><section className="drawer-section"><h3>Version history</h3>{versions.length ? <div className="version-list">{versions.map(v => <button key={v.version} disabled={!!busy} onClick={() => id && loadSaved(id, v.version)}><Clock3 size={16}/><span>Version {v.version}</span>{v.version === version ? <small>Current</small> : <ArrowUpRight size={15}/>}</button>)}</div> : <p>Save this draft to keep a version you can return to.</p>}</section><details className="activity"><summary>How this draft was made<ChevronRight size={15}/></summary>{trace.map((item, i) => <div key={i}><span/><p><strong>{item.step}</strong>{item.detail}</p></div>)}</details></>}
      {drawer === 'crusoe' && <><div className="provider-icon"><Zap size={30} fill="currentColor"/></div><h3 className="provider-title">Drafted with AI.<br/>Decided by you.</h3><p className="drawer-intro">Crusoe hosts the model that writes and revises your proposal. Your brief is sent to its serverless inference API when you generate.</p><div className="provider-facts"><div><span>Model</span><strong>{health?.model || 'Loading…'}</strong></div><div><span>Estimated usage</span><strong>${(health?.usage.cost || 0).toFixed(4)}</strong></div><div><span>Local spending limit</span><strong>${health?.budget || 4}</strong></div><div><span>Requests</span><strong>{health?.usage.calls || 0} / {health?.max_calls || 60}</strong></div></div><p className="fine-print">Usage estimates cover this app. Check Crusoe for your actual account balance. Saved proposals are stored locally.</p></>}
    </Drawer>}
  </div>;
}
