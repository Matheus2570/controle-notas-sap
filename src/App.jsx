import React, { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, ClipboardList, Search, MapPin, Plus, ChevronRight,
  FileSpreadsheet, Boxes, CalendarDays, X, Save, Trash2, Pencil,
  CheckCircle2, Clock3, ReceiptText, AlertCircle, Download, LogOut,
  LockKeyhole, RefreshCw, Menu, ChevronLeft, Loader2, Copy,
  Database, TrendingUp, Layers3, PackageCheck, Info, ListFilter,
  ChevronDown, Check, SlidersHorizontal, ExternalLink, Eye, Palette, UserRoundCheck, ShieldCheck,
  Receipt,
} from 'lucide-react';
import {
  isDemo, supabase, listSites, listLines, getDashboard, getSiteSummary,
  getRequest, saveRequest, deleteRequest, saveSite, deleteSite, fetchAllLines,
  getMyRole, getAppConfig, saveAppConfig, DEFAULT_CONFIG,
  listInvoiceableLines, listInvoices, saveInvoice, deleteInvoice,
} from './api';

const STATUSES = {
  rascunho: { label:'A pedir', cls:'draft' },
  solicitado: { label:'Pedido', cls:'requested' },
  nota_recebida: { label:'Nota recebida', cls:'received' },
  concluido: { label:'Concluído', cls:'done' },
  cancelado: { label:'Cancelado', cls:'cancelled' },
};
const PROCESSES = { '3d':'Impressão 3D', cnc:'CNC', outro:'Outro', indefinido:'Não definido' };
const money = n => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)||0);
const number = n => new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3}).format(Number(n)||0);
const formatDate = v => v ? new Date(`${v}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const today = () => {
  const d=new Date();
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
};
const noFilters = { search:'',site:'',status:'',process:'',from:'',to:'' };
const blankItem = () => ({ _key:crypto.randomUUID(),sap_code:'',forms_code:'',material:'',process:'indefinido',quantity:'1',unit_price:'0' });
function dateNum(v){
  let s=String(v??'').trim().replace(/R\$|\s/g,'');
  if(s.includes(',')) s=s.replace(/\./g,'').replace(',','.');
  const n=Number(s);
  return Number.isFinite(n)?n:0;
}
function parseDecimal(v){
  let s=String(v??'').trim().replace(/R\$|\s/g,'');
  if(!s)return null;
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  const n=Number(s);
  return Number.isFinite(n)?n:NaN;
}
function statusBadge(status){ const item=STATUSES[status]||STATUSES.rascunho; return <span className={`status-tag ${item.cls}`}><span className="status-dot"/>{item.label}</span>; }
function processBadge(process){return <span className={`process-tag process-${process==='3d'?'3d':process==='cnc'?'cnc':'other'}`}>{process==='3d'?'3D':process==='cnc'?'CNC':process==='outro'?'OUTRO':'—'}</span>;}
function activitySummary(value){
  const labels={rascunho:'A pedir',solicitado:'Pedido',nota_recebida:'Nota recebida',concluido:'Concluído',cancelado:'Cancelado'};
  return String(value||'').replace(/\b(rascunho|solicitado|nota_recebida|concluido|cancelado)\b/g,match=>labels[match]||match);
}
function displayActivity(activity=[],history=[]){
  if(activity?.length) return activity;
  return (history||[]).map(h=>({...h,summary:h.previous_status?`Situação alterada: ${h.previous_status} → ${h.new_status}`:`Pedido criado · situação inicial: ${h.new_status}`}));
}
function EmptyState({icon:Icon=Search,title,description,action}){return <div className="empty-state"><div className="empty-icon"><Icon size={24}/></div><h3>{title}</h3><p>{description}</p>{action}</div>;}
function ErrorBanner({message,onClose}){return message?<div className="error-banner"><AlertCircle size={18}/><span>{message}</span><button onClick={onClose} aria-label="Fechar aviso"><X size={16}/></button></div>:null;}
function MiniLabel({children}){return <label className="field-label">{children}</label>;}
function FormField({label,children,className=''}){return <div className={`field ${className}`}><MiniLabel>{label}</MiniLabel>{children}</div>;}

function Login({sessionReady}) {
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(e){
    e.preventDefault();setBusy(true);setError('');
    try{const {error:err}=await supabase.auth.signInWithPassword({email,password});if(err)throw err;}
    catch(e){setError(e.message==='Invalid login credentials'?'E-mail ou senha incorretos.':e.message);}
    finally{setBusy(false);}
  }
  return <div className="auth-screen">
    <div className="auth-brand"><div className="brand-mark"><Layers3 size={25}/></div><div><strong>NotaFlow</strong><span>CONTROLE SAP & FORMS</span></div></div>
    <div className="auth-box"><div className="auth-icon"><LockKeyhole size={27}/></div><h1>Bem-vindo de volta</h1><p>Entre para consultar materiais e acompanhar pedidos de nota.</p>
      <ErrorBanner message={error} onClose={()=>setError('')}/>
      <form onSubmit={submit}><FormField label="E-mail"><input autoComplete="username" type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="seu@email.com"/></FormField>
      <FormField label="Senha"><input autoComplete="current-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required placeholder="••••••••"/></FormField>
      <button className="btn btn-primary btn-full" disabled={busy||!sessionReady} type="submit">{busy?<Loader2 className="spin" size={17}/>:<LockKeyhole size={17}/>} Entrar no sistema</button></form>
      <div className="auth-footnote"><Info size={15}/> O acesso é liberado pelo administrador do Supabase.</div>
    </div>
    <div className="auth-footer">Seus registros são protegidos por autenticação e banco de dados com regras de acesso.</div>
  </div>;
}

function FilterBar({filters,onChange,sites,includeSearch=true,showProcess=true}){
  const [searchDraft,setSearchDraft]=useState(filters.search||'');
  const update=(field,value)=>onChange(f=>({...f,[field]:value}));
  const hasFilters=Object.values(filters).some(Boolean);
  useEffect(()=>setSearchDraft(filters.search||''),[filters.search]);
  useEffect(()=>{
    if(searchDraft===(filters.search||''))return;
    const timer=window.setTimeout(()=>onChange(f=>({...f,search:searchDraft})),280);
    return()=>window.clearTimeout(timer);
  },[searchDraft,filters.search,onChange]);
  return <div className="filters-area">
    <div className="filters-row">
      {includeSearch&&<div className="filter-search"><Search size={18}/><input aria-label="Buscar SAP, Forms ou material" placeholder="Buscar SAP, Forms, material ou NF..." value={searchDraft} onChange={e=>setSearchDraft(e.target.value)}/></div>}
      <select aria-label="Filtrar site" className="filter-control" value={filters.site} onChange={e=>update('site',e.target.value)}><option value="">Todos os sites</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <select aria-label="Filtrar status" className="filter-control" value={filters.status} onChange={e=>update('status',e.target.value)}><option value="">Todos os status</option>{Object.entries(STATUSES).map(([v,s])=><option value={v} key={v}>{s.label}</option>)}</select>
      {showProcess&&<select aria-label="Filtrar processo" className="filter-control" value={filters.process} onChange={e=>update('process',e.target.value)}><option value="">3D ou CNC</option>{Object.entries(PROCESSES).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select>}
    </div>
    <div className="filters-row filters-secondary"><span className="date-range-label"><CalendarDays size={15}/> Período</span><input aria-label="Data inicial" type="date" className="date-control" value={filters.from} onChange={e=>update('from',e.target.value)}/><span className="date-to">até</span><input aria-label="Data final" type="date" className="date-control" value={filters.to} onChange={e=>update('to',e.target.value)}/>{hasFilters&&<button className="clear-btn" onClick={()=>onChange({...noFilters})}><X size={14}/> Limpar filtros</button>}</div>
  </div>;
}

function LinesTable({rows,loading,onSelect,emptyText='Nenhum item encontrado.',showNF=false}) {
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Data</th><th>Site</th><th>Código SAP</th><th>Forms</th><th>Material / descrição</th><th>Processo</th><th className="align-right">Qtd.</th><th className="align-right">Unitário</th><th className="align-right">Total</th><th>Status</th>{showNF&&<th>NF</th>}<th></th></tr></thead>
    <tbody>{loading?<tr><td colSpan={showNF?12:11}><div className="table-loading"><Loader2 className="spin" size={20}/> Carregando registros...</div></td></tr>:rows.length===0?<tr><td colSpan={showNF?12:11}><div className="table-loading muted">{emptyText}</div></td></tr>:rows.map((r,i)=><tr key={r.item_id||i} className="click-row" tabIndex={0} role="button" aria-label={`Abrir pedido de ${r.site_name}, SAP ${r.sap_code||'não informado'}`} onClick={()=>onSelect(r.request_id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(r.request_id);}}} title="Clique para abrir o pedido"><td className="date-col">{formatDate(r.requested_on)}</td><td><span className="site-name">{r.site_name}</span><span className="site-sub">{r.center_code}</span></td><td><span className="mono-code">{r.sap_code||'—'}</span></td><td><span className="mono-code form-code">{r.forms_code||'—'}</span></td><td className="material-col">{r.material||<span className="muted">Não informado</span>}</td><td>{processBadge(r.process)}</td><td className="align-right num">{number(r.quantity)}</td><td className="align-right num">{money(r.unit_price)}</td><td className="align-right total-cell num">{money(r.total)}</td><td>{statusBadge(r.status)}</td>{showNF&&<td className="mono-code">{r.invoice_note_number||r.note_number||'—'}</td>}<td className="row-arrow"><ChevronRight size={16}/></td></tr>)}</tbody></table></div>;
}

function Dashboard({stats,summary,recent,loading,onOpen,onNew,canEdit,config}){
  const max=Math.max(...summary.map(s=>Number(s.total_value)),1);
  return <div className="page-content">
    <div className="welcome-banner"><div><span className="welcome-kicker">VISÃO GERAL</span><h2>{config.dashboard_title}</h2><p>{config.dashboard_message}</p></div><div className="welcome-art"><Layers3 size={70} strokeWidth={1}/></div></div>
    <div className="stats-grid">
      <div className="stat-card"><span className="stat-label">Pedidos cadastrados <ClipboardList size={18}/></span><strong>{loading?'—':number(stats.requests_total)}</strong><span className="stat-caption">Todos os períodos</span></div>
      <div className="stat-card"><span className="stat-label">Itens registrados <Boxes size={18}/></span><strong>{loading?'—':number(stats.items_total)}</strong><span className="stat-caption">Códigos e materiais</span></div>
      <div className="stat-card"><span className="stat-label">Em andamento <Clock3 size={18}/></span><strong>{loading?'—':number(stats.pending_total)}</strong><span className="stat-caption"><span className="tiny-dot amber"/> A pedir + pedidos</span></div>
      <div className="stat-card featured"><span className="stat-label">Valor registrado <TrendingUp size={18}/></span><strong>{loading?'—':money(stats.total_value)}</strong><span className="stat-caption">Soma de todos os itens</span></div>
    </div>
    <div className="dashboard-grid"><section className="surface-card summary-card"><div className="section-heading"><div><h3>Volume por site</h3><p>Distribuição do valor cadastrado</p></div><MapPin size={18}/></div><div className="site-bars">{summary.length===0?<p className="muted">Nenhum site cadastrado.</p>:summary.slice(0,7).map(s=><div className="bar-item" key={s.site_id}><div className="bar-top"><span>{s.site_name}</span><strong>{money(s.total_value)}</strong></div><div className="bar-track"><div className="bar-fill" style={{width:`${Number(s.total_value)/max*100}%`}}/></div><span className="bar-meta">{number(s.items_total)} {Number(s.items_total)===1?'item':'itens'}</span></div>)}</div></section>
      <section className="surface-card steps-card"><div className="section-heading"><div><h3>Fluxo de um pedido</h3><p>Do lançamento à nota recebida</p></div><ReceiptText size={18}/></div><div className="steps"><div className="step"><span className="step-number">01</span><div><strong>A pedir</strong><p>Cadastre SAP, Forms, quantidade e valores.</p></div></div><div className="step"><span className="step-number">02</span><div><strong>Pedido</strong><p>Marque quando solicitar a nota no SAP.</p></div></div><div className="step"><span className="step-number">03</span><div><strong>Nota recebida</strong><p>Registre o número da NF e consulte o Forms.</p></div></div><div className="step"><span className="step-number">04</span><div><strong>Concluído</strong><p>Finalize mantendo tudo no histórico.</p></div></div></div>{canEdit&&<button className="btn btn-secondary btn-full" onClick={onNew}><Plus size={16}/> Criar novo pedido</button>}</section></div>
    <section className="surface-card recent-card"><div className="section-heading"><div><h3>Últimos lançamentos</h3><p>Itens mais recentes cadastrados no controle</p></div><button className="subtle-link" onClick={onOpen}>Ver todos <ChevronRight size={16}/></button></div><LinesTable rows={recent} loading={loading} onSelect={onOpen} emptyText="Crie seu primeiro pedido para começar."/></section>
  </div>;
}

function PaginatedTable({filters,sites,onOpen,revision,showNF=false,queryMode=false,canEdit=true}){
  const [page,setPage]=useState(0),[lines,setLines]=useState([]),[count,setCount]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState(''),[downloading,setDownloading]=useState(false),[copying,setCopying]=useState(false),[copied,setCopied]=useState(false);
  const PAGE_SIZE=40;
  useEffect(()=>setPage(0),[filters]);
  useEffect(()=>{
    let valid=true;setLoading(true);setError('');
    listLines(filters,page,PAGE_SIZE).then(({rows,count})=>{if(valid){setLines(rows);setCount(count);}})
      .catch(e=>{if(valid)setError(e.message);}).finally(()=>{if(valid)setLoading(false);});
    return ()=>{valid=false;};
  },[filters,page,revision]);
  const totalPages=Math.max(1,Math.ceil(count/PAGE_SIZE));
  function cell(v){const raw=String(v??'');return /^[=+\-@]/.test(raw)?`'${raw}`:raw;}
  async function copyForms(){
    setCopying(true);setError('');setCopied(false);
    try{
      const data=await fetchAllLines(filters);
      const forms=[...new Set(data.map(row=>String(row.forms_code||'').trim()).filter(Boolean))];
      if(!forms.length)throw new Error('Não há Forms nos resultados filtrados para copiar.');
      if(!navigator.clipboard?.writeText)throw new Error('A cópia automática não está disponível neste navegador. Abra o sistema em HTTPS ou copie os Forms pela tabela.');
      await navigator.clipboard.writeText(forms.join('\n'));
      setCopied(true);window.setTimeout(()=>setCopied(false),2200);
    }catch(e){setError(e.message);}finally{setCopying(false);}
  }
  async function downloadCsv(){
    setDownloading(true);setError('');
    try{
      const data=await fetchAllLines(filters);
      const cols=[['Data','requested_on'],['Site','site_name'],['Centro físico','center_code'],['Código SAP','sap_code'],['Forms','forms_code'],['Descrição','material'],['Processo','process'],['Quantidade','quantity'],['Valor unitário','unit_price'],['Total','total'],['Status','status'],['Número NF','invoice_note_number'],['Chave NF','invoice_access_key'],['Data da NF','invoice_issued_on'],['Observações','notes']];
      const csv=(row)=>row.map(x=>`"${cell(x).replace(/"/g,'""')}"`).join(';');
      const lines=[csv(cols.map(x=>x[0])),...data.map(x=>csv(cols.map(([_,key])=>key==='status'?STATUSES[x.status]?.label:key==='process'?PROCESSES[x.process]:key==='invoice_note_number'?(x.invoice_note_number||x.note_number):['quantity','unit_price','total'].includes(key)?String(x[key]).replace('.',','):x[key])))];
      const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'}),link=document.createElement('a');
      const href=URL.createObjectURL(blob);link.href=href;link.download=`notaflow-${today()}.csv`;link.click();window.setTimeout(()=>URL.revokeObjectURL(href),1000);
    }catch(e){setError(e.message);}finally{setDownloading(false);}
  }
  return <div className="surface-card table-panel">
    <div className="table-panel-head"><div className="record-count"><FileSpreadsheet size={18}/><strong>{count.toLocaleString('pt-BR')}</strong> {count===1?'item encontrado':'itens encontrados'}<span>• clique em uma linha para {canEdit?'editar':'visualizar'}</span></div><div className="table-head-actions">{queryMode&&<button onClick={copyForms} className="btn btn-quiet" disabled={copying||count===0}>{copying?<Loader2 className="spin" size={16}/>:copied?<Check size={16}/>:<Copy size={16}/>} {copied?'Forms copiados!':'Copiar Forms'}</button>}<button onClick={downloadCsv} className="btn btn-quiet" disabled={downloading}>{downloading?<Loader2 className="spin" size={16}/>:<Download size={16}/>} Exportar CSV</button></div></div>
    <ErrorBanner message={error} onClose={()=>setError('')}/>
    <LinesTable rows={lines} loading={loading} onSelect={onOpen} showNF={showNF} emptyText={queryMode?'Nenhum SAP ou Forms corresponde à pesquisa.':'Nenhum pedido encontrado com estes filtros.'}/>
    {count>0&&<div className="pagination"><span>Mostrando {page*PAGE_SIZE+1}–{Math.min(count,(page+1)*PAGE_SIZE)} de {count.toLocaleString('pt-BR')}</span><div className="pagination-controls"><button disabled={page===0} onClick={()=>setPage(x=>x-1)} aria-label="Página anterior"><ChevronLeft size={18}/></button><span>Página {page+1} de {totalPages}</span><button disabled={page>=totalPages-1} onClick={()=>setPage(x=>x+1)} aria-label="Próxima página"><ChevronRight size={18}/></button></div></div>}
  </div>;
}

function SiteSettings({sites,onChange,readOnly=false}){
  const [editing,setEditing]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const empty={name:'',center_code:'',carrier_info:'',region:''};
  async function save(e){e.preventDefault();setBusy(true);setError('');try{await saveSite(editing);setEditing(null);await onChange();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function remove(id){if(!window.confirm('Excluir este site? Se houver pedidos associados, a exclusão será bloqueada.'))return;setBusy(true);setError('');try{await deleteSite(id);await onChange();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <div className="page-content"><div className="settings-intro"><div className="intro-icon"><MapPin size={24}/></div><div><h2>Cadastro de sites</h2><p>{readOnly?'Consulte os centros físicos e dados das unidades.':'Gerencie o centro físico e os dados de transportadora. Eles ficam associados aos pedidos.'}</p></div>{!readOnly&&<button className="btn btn-primary" onClick={()=>setEditing({...empty})}><Plus size={17}/> Adicionar site</button>}</div>
    <ErrorBanner message={error} onClose={()=>setError('')}/>
    <div className="site-cards">{sites.map(s=><div className="site-card" key={s.id}><div className="site-card-top"><span className="site-card-icon"><MapPin size={20}/></span>{!readOnly&&<button title="Editar site" onClick={()=>setEditing({...s})}><Pencil size={17}/></button>}</div><h3>{s.name}</h3><div className="site-data"><span>Centro físico</span><strong>{s.center_code||'Não informado'}</strong></div><div className="site-data"><span>Transportadora / região</span><strong>{s.carrier_info||'Não informado'}</strong></div><div className="site-data"><span>Observação de região</span><strong>{s.region||'—'}</strong></div></div>)}</div>
    {!readOnly&&editing&&<div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setEditing(null);}}><form className="small-modal" onSubmit={save}><div className="modal-head"><h3>{editing.id?'Editar site':'Novo site'}</h3><button type="button" className="icon-button" onClick={()=>setEditing(null)}><X size={20}/></button></div><div className="modal-body"><FormField label="Nome do site *"><input required autoFocus value={editing.name} onChange={e=>setEditing(x=>({...x,name:e.target.value}))} placeholder="Ex.: Valinhos"/></FormField><FormField label="Centro físico"><input value={editing.center_code} onChange={e=>setEditing(x=>({...x,center_code:e.target.value}))} placeholder="Ex.: 3178"/></FormField><FormField label="Transportadora / código"><input value={editing.carrier_info} onChange={e=>setEditing(x=>({...x,carrier_info:e.target.value}))} placeholder="Ex.: 10083071 | Nordeste"/></FormField><FormField label="Região ou observação"><input value={editing.region} onChange={e=>setEditing(x=>({...x,region:e.target.value}))} placeholder="Opcional"/></FormField></div><div className="modal-footer">{editing.id&&<button type="button" className="btn btn-danger" onClick={()=>{const id=editing.id;setEditing(null);remove(id);}}><Trash2 size={16}/> Excluir</button>}<button type="button" className="btn btn-secondary" onClick={()=>setEditing(null)}>Cancelar</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy?<Loader2 className="spin" size={16}/>:<Save size={16}/>} Salvar site</button></div></form></div>}
  </div>;
}

function parsePasted(text){
  const rows=text.split(/\r?\n/).filter(x=>x.trim());
  return rows.map((row,i)=>{
    const parts=row.includes('\t')?row.split('\t'):row.split(';');
    const [sap,forms,material,process,quantity,unit_price]=parts.map(x=>String(x||'').trim());
    if(i===0 && /^(sap|c[oó]digo sap)$/i.test(sap))return null;
    const parsedProcess=/cnc/i.test(process)?'cnc':/3d|impress[aã]o/i.test(process)?'3d':/outro/i.test(process)?'outro':'indefinido';
    return {...blankItem(),sap_code:sap||'',forms_code:forms||'',material:material||'',process:parsedProcess,quantity:quantity||'1',unit_price:unit_price||'0'};
  }).filter(x=>x&&(x.sap_code||x.forms_code));
}
function RequestEditor({requestId,sites,onClose,onSaved}){
  const [form,setForm]=useState({site_id:sites[0]?.id||'',requested_on:today(),status:'rascunho',note_number:'',notes:''});
  const [items,setItems]=useState([blankItem()]);
  const [history,setHistory]=useState([]),[activity,setActivity]=useState([]),[loading,setLoading]=useState(Boolean(requestId)),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [pasteOpen,setPasteOpen]=useState(false),[pasteText,setPasteText]=useState('');
  useEffect(()=>{if(!requestId)return;let active=true;getRequest(requestId).then(data=>{if(active){setForm(data.request);setItems(data.items.map(i=>({...i,_key:i.id})));setHistory(data.history||[]);setActivity(data.activity||[]);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return ()=>{active=false;};},[requestId]);
  useEffect(()=>{const handle=e=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);},[onClose]);
  const total=useMemo(()=>items.reduce((a,x)=>a+dateNum(x.quantity)*dateNum(x.unit_price),0),[items]);
  const duplicateCodes=useMemo(()=>{
    const find=(field,label)=>{const counts=new Map();items.forEach(it=>{const value=String(it[field]||'').trim();if(value)counts.set(value,(counts.get(value)||0)+1);});return [...counts].filter(([,count])=>count>1).map(([value])=>`${label} ${value}`);};
    return [...find('sap_code','SAP'),...find('forms_code','Forms')];
  },[items]);
  const change=(key,val)=>setForm(f=>({...f,[key]:val}));
  const changeItem=(idx,key,val)=>setItems(it=>it.map((x,i)=>i===idx?{...x,[key]:val}:x));
  function importPaste(){const imported=parsePasted(pasteText);if(!imported.length){setError('Não encontrei linhas válidas. Confira as colunas SAP, Forms, Descrição, Processo, Quantidade e Valor unitário.');return;}setItems(it=>[...it.filter(x=>x.sap_code||x.forms_code),...imported]);setPasteOpen(false);setPasteText('');setError('');}
  async function submit(e){e.preventDefault();setSaving(true);setError('');try{
    const data=items.filter(x=>x.sap_code?.trim()||x.forms_code?.trim()).map(({_key,total,created_at,...x},idx)=>{
      const quantity=parseDecimal(x.quantity),unit_price=parseDecimal(x.unit_price);
      const validQuantity=quantity,validPrice=unit_price===null?0:unit_price;
      if(validQuantity===null||!Number.isFinite(validQuantity)||validQuantity<=0)throw new Error(`A quantidade da linha ${idx+1} deve ser um número maior que zero.`);
      if(!Number.isFinite(validPrice)||validPrice<0)throw new Error(`O valor unitário da linha ${idx+1} deve ser um número igual ou maior que zero.`);
      return {...x,quantity:validQuantity,unit_price:validPrice};
    });
    await saveRequest(form,data);onSaved();
  }catch(e){setError(e.message);}finally{setSaving(false);}}
  async function remove(){if(hasInvoicedItems){setError('Este pedido contém materiais vinculados a uma nota fiscal. Desvincule ou exclua a nota na tela Notas fiscais antes de excluir o pedido.');return;}if(!window.confirm('Excluir este pedido e todos os itens? Esta ação não pode ser desfeita. A trilha de auditoria será preservada.'))return;setSaving(true);setError('');try{await deleteRequest(requestId);onSaved();}catch(e){setError(e.message);}finally{setSaving(false);}}
  return <div className="drawer-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><form className="editor-drawer" onSubmit={submit}>
    <div className="drawer-header"><div><span className="eyebrow">{requestId?'EDITAR PEDIDO':'NOVO LANÇAMENTO'}</span><h2>{requestId?'Detalhes do pedido':'Novo pedido de nota'}</h2><p>Organize os materiais para solicitar a nota e consultar depois.</p></div><button type="button" aria-label="Fechar" className="close-button" onClick={onClose}><X size={22}/></button></div>
    <div className="drawer-scroll">{loading?<div className="drawer-loader"><Loader2 className="spin" size={25}/> Carregando pedido...</div>:<>
      <ErrorBanner message={error} onClose={()=>setError('')}/>
      <section className="edit-section"><div className="edit-title"><span className="edit-number">1</span><div><h3>Informações do pedido</h3><p>Identificação, site, dia e situação da solicitação</p></div></div>
      <div className="edit-fields"><FormField label="Site / fábrica *"><select required disabled={hasInvoicedItems} value={form.site_id} onChange={e=>change('site_id',e.target.value)}><option value="">Selecione um site</option>{sites.map(s=><option value={s.id} key={s.id}>{s.name} {s.center_code?`(${s.center_code})`:''}</option>)}</select></FormField><FormField label="Data do pedido *"><input required disabled={hasInvoicedItems} type="date" value={form.requested_on||''} onChange={e=>change('requested_on',e.target.value)}/></FormField><FormField label="Situação"><select value={form.status} onChange={e=>change('status',e.target.value)}>{Object.entries(STATUSES).map(([v,s])=><option value={v} key={v}>{s.label}</option>)}</select></FormField><div className="invoice-workflow-hint"><Receipt size={17}/><span>O número e a chave da nota são registrados na seção <strong>Notas fiscais</strong>, vinculados aos materiais selecionados.</span></div></div>{hasInvoicedItems&&<div className="invoice-lock-warning"><LockKeyhole size={16}/> Este pedido possui material faturado. Site, data e linhas já vinculadas estão bloqueados para preservar os dados fiscais.</div>}</section>
      <section className="edit-section"><div className="edit-title edit-title-row"><span className="edit-number">2</span><div><h3>Materiais do pedido</h3><p>Adicione os códigos e valores. O total é automático.</p></div><div className="edit-title-actions"><button className="btn btn-quiet" type="button" disabled={hasInvoicedItems} onClick={()=>setPasteOpen(x=>!x)}><Copy size={16}/> Colar do Excel</button><button type="button" className="btn btn-secondary" disabled={hasInvoicedItems} onClick={()=>setItems(x=>[...x,blankItem()])}><Plus size={16}/> Linha</button></div></div>
      {pasteOpen&&<div className="paste-panel"><div><strong>Importação rápida do Excel</strong><p>Copie as colunas nesta ordem: <b>SAP | Forms | Descrição | Processo | Quantidade | Valor unitário</b>. Cole as linhas abaixo, separadas por tabulação (padrão do Excel).</p></div><textarea autoFocus rows={5} value={pasteText} onChange={e=>setPasteText(e.target.value)} placeholder={'10083071\tFRM-859\tSuporte\t3D\t2\t45,90\n10083072\tFRM-860\tGabarito\tCNC\t1\t100,00'}/><div className="paste-actions"><button type="button" className="btn btn-secondary" onClick={()=>setPasteOpen(false)}>Cancelar</button><button type="button" className="btn btn-primary" onClick={importPaste}><Check size={16}/> Adicionar linhas</button></div></div>}
      {duplicateCodes.length>0&&<div className="duplicate-warning"><AlertCircle size={17}/><div><strong>Confira possíveis duplicidades</strong><span>{duplicateCodes.join(' · ')} aparecem mais de uma vez neste pedido. Isso é apenas um aviso; confirme se está correto.</span></div></div>}
      <div className="items-edit-scroll"><div className="items-grid items-grid-head"><span>Código SAP</span><span>Forms</span><span>Descrição</span><span>Processo</span><span>Qtd.</span><span>Unitário (R$)</span><span>Total</span><span></span></div>{items.map((it,i)=>{const locked=Boolean(it.invoice_id);return <div className={`items-grid items-grid-row ${locked?'invoice-locked-row':''}`} key={it._key||it.id||i}>
        <input aria-label={`SAP item ${i+1}`} title={locked?`Vinculado à NF ${it.invoice_note_number||''}`:''} disabled={locked} placeholder="Código SAP" value={it.sap_code??''} onChange={e=>changeItem(i,'sap_code',e.target.value)}/>
        <input aria-label={`Forms item ${i+1}`} title={locked?`Vinculado à NF ${it.invoice_note_number||''}`:''} disabled={locked} placeholder="Ex.: 859" value={it.forms_code??''} onChange={e=>changeItem(i,'forms_code',e.target.value)}/>
        <input aria-label={`Descrição item ${i+1}`} disabled={locked} placeholder="Material / peça" value={it.material??''} onChange={e=>changeItem(i,'material',e.target.value)}/>
        <select aria-label={`Processo item ${i+1}`} disabled={locked} value={it.process??'indefinido'} onChange={e=>changeItem(i,'process',e.target.value)}>{Object.entries(PROCESSES).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        <input aria-label={`Quantidade item ${i+1}`} disabled={locked} inputMode="decimal" value={it.quantity??''} onChange={e=>changeItem(i,'quantity',e.target.value)}/>
        <input aria-label={`Unitário item ${i+1}`} disabled={locked} inputMode="decimal" value={it.unit_price??''} onChange={e=>changeItem(i,'unit_price',e.target.value)}/>
        <span className="computed-total">{money(dateNum(it.quantity)*dateNum(it.unit_price))}</span>
        <button type="button" className="delete-item" disabled={locked} aria-label={`Remover item ${i+1}`} title={locked?`Vinculado à NF ${it.invoice_note_number||''}`:'Excluir linha'} onClick={()=>setItems(v=>v.length===1?[blankItem()]:v.filter((_,idx)=>idx!==i))}><Trash2 size={16}/></button>
      </div>})}</div><div className="order-total"><span>{items.length} {items.length===1?'linha':'linhas'} no pedido</span><div><span>Total do pedido</span><strong>{money(total)}</strong></div></div></section>
      <section className="edit-section"><div className="edit-title"><span className="edit-number">3</span><div><h3>Observações e histórico</h3><p>Deixe instruções e consulte as alterações feitas neste pedido e nos materiais.</p></div></div><textarea className="notes-input" value={form.notes||''} onChange={e=>change('notes',e.target.value)} rows={3} placeholder="Ex.: pedido urgente, motivo de compra, fornecedor..."/>
        {requestId&&<div className="history"><strong>Histórico de atividades</strong>{displayActivity(activity,history).length===0?<p className="muted">Sem atividades registradas.</p>:displayActivity(activity,history).map(a=><div className="history-line" key={a.id}><span className="history-bullet"/><div><strong>{activitySummary(a.summary||'Alteração registrada')}</strong><small>{new Date(a.changed_at).toLocaleString('pt-BR')}{a.changed_by_email?` · ${a.changed_by_email}`:''}</small></div></div>)}</div>}
      </section>
    </>}</div>
    <div className="drawer-footer"><div>{requestId&&<button type="button" className="btn btn-danger" onClick={remove} disabled={saving||loading||hasInvoicedItems} title={hasInvoicedItems?'Desvincule a nota fiscal antes de excluir':''}><Trash2 size={16}/> Excluir pedido</button>}</div><div><button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button><button className="btn btn-primary" type="submit" disabled={saving||loading}>{saving?<Loader2 className="spin" size={17}/>:<Save size={17}/>} {requestId?'Salvar alterações':'Salvar pedido'}</button></div></div>
  </form></div>;
}


// Apenas consulta: campos exibidos como texto. Não há ações de gravação nesta tela.
function RequestViewer({requestId,sites,onClose}){
  const [data,setData]=useState(null),[error,setError]=useState('');
  useEffect(()=>{let alive=true;getRequest(requestId).then(d=>{if(alive)setData(d);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[requestId]);
  const r=data?.request;
  const site=sites.find(s=>s.id===r?.site_id);
  const total=data?.items?.reduce((sum,x)=>sum+Number(x.total||x.quantity*x.unit_price),0)||0;
  return <div className="drawer-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="editor-drawer readonly-drawer" role="dialog" aria-modal="true" aria-label="Consultar pedido">
    <div className="drawer-header"><div><span className="eyebrow"><Eye size={13}/> SOMENTE LEITURA</span><h2>Detalhes do pedido</h2><p>Você pode consultar os dados, sem alterar o pedido.</p></div><button type="button" aria-label="Fechar" className="close-button" onClick={onClose}><X size={22}/></button></div>
    <div className="drawer-scroll">
      <ErrorBanner message={error} onClose={()=>setError('')}/>
      {!data?<div className="drawer-loader"><Loader2 className="spin" size={24}/> Carregando...</div>:<>
        <section className="edit-section"><h3>Informações do pedido</h3><div className="readonly-info"><div><small>Site / centro</small><strong>{site?.name||'—'} — {site?.center_code||'—'}</strong></div><div><small>Data</small><strong>{formatDate(r.requested_on)}</strong></div><div><small>Status</small>{statusBadge(r.status)}</div><div><small>Número NF</small><strong>{r.note_number||'—'}</strong></div></div></section>
        <section className="edit-section"><h3>Materiais</h3><div className="table-wrap"><table className="data-table"><thead><tr><th>SAP</th><th>Forms</th><th>Descrição</th><th>Processo</th><th>Qtd.</th><th>Unitário</th><th>Total</th><th>Nota fiscal</th></tr></thead><tbody>{data.items.map(it=><tr key={it.id}><td className="mono-code">{it.sap_code||'—'}</td><td className="mono-code">{it.forms_code||'—'}</td><td>{it.material||'—'}</td><td>{processBadge(it.process)}</td><td>{number(it.quantity)}</td><td>{money(it.unit_price)}</td><td>{money(it.total||it.quantity*it.unit_price)}</td><td className="mono-code">{it.invoice_note_number||'—'}</td></tr>)}</tbody></table></div><div className="order-total"><span>{data.items.length} itens</span><div><span>Total</span><strong>{money(total)}</strong></div></div></section>
        {r.notes&&<section className="edit-section"><h3>Observações</h3><p>{r.notes}</p></section>}
        <section className="edit-section"><h3>Histórico de atividades</h3><div className="history">{displayActivity(data.activity,data.history).length?displayActivity(data.activity,data.history).map(a=><div className="history-line" key={a.id}><span className="history-bullet"/><div><strong>{activitySummary(a.summary||'Alteração registrada')}</strong><small>{new Date(a.changed_at).toLocaleString('pt-BR')}{a.changed_by_email?` · ${a.changed_by_email}`:''}</small></div></div>):<p className="muted">Sem eventos registrados.</p>}</div></section>
      </>}
    </div><div className="drawer-footer"><span className="viewer-hint"><LockKeyhole size={15}/> Visualizador: sem permissão para editar</span><button className="btn btn-secondary" onClick={onClose}>Fechar</button></div>
  </div></div>;
}

function AppearanceSettings({config,onChange}){
  const [form,setForm]=useState({...config}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(false);
  useEffect(()=>setForm({...config}),[config]);
  async function submit(e){e.preventDefault();setBusy(true);setError('');setSuccess(false);try{await saveAppConfig(form);await onChange();setSuccess(true);}catch(e){setError(e.message);}finally{setBusy(false);}}
  const update=(k,v)=>setForm(f=>({...f,[k]:v}));
  return <div className="page-content"><div className="settings-intro"><div className="intro-icon"><Palette size={24}/></div><div><h2>Personalização do site</h2><p>Altere textos e cor do aplicativo sem abrir o VS Code. Apenas o administrador consegue salvar.</p></div></div>
    <div className="appearance-grid"><form className="surface-card appearance-editor" onSubmit={submit}><div className="section-heading"><div><h3>Editor visual</h3><p>As modificações ficam salvas no banco e aparecem para todos.</p></div><Pencil size={19}/></div>
      <ErrorBanner message={error} onClose={()=>setError('')}/>
      <FormField label="Nome do sistema"><input maxLength={36} required value={form.product_name} onChange={e=>update('product_name',e.target.value)}/></FormField>
      <FormField label="Subtítulo"><input maxLength={60} required value={form.subtitle} onChange={e=>update('subtitle',e.target.value)}/></FormField>
      <FormField label="Título inicial"><input maxLength={90} required value={form.dashboard_title} onChange={e=>update('dashboard_title',e.target.value)}/></FormField>
      <FormField label="Descrição inicial"><textarea rows={4} maxLength={280} required value={form.dashboard_message} onChange={e=>update('dashboard_message',e.target.value)}/></FormField>
      <FormField label="Cor de destaque"><div className="color-setting"><input type="color" value={form.accent_color} onChange={e=>update('accent_color',e.target.value)}/><input aria-label="Código hexadecimal" maxLength={7} value={form.accent_color} onChange={e=>update('accent_color',e.target.value)} pattern="#[0-9a-fA-F]{6}"/></div></FormField>
      <button className="btn btn-primary" disabled={busy} type="submit">{busy?<Loader2 className="spin" size={16}/>:<Save size={16}/>} Salvar visual do site</button>{success&&<span className="settings-success"><CheckCircle2 size={16}/> Configuração salva!</span>}
    </form><div className="surface-card appearance-preview"><div className="section-heading"><div><h3>Prévia</h3><p>Veja os textos e a cor escolhidos.</p></div><Eye size={18}/></div><div className="preview-brand"><div className="preview-logo" style={{background:form.accent_color}}><Layers3 size={23}/></div><div><strong>{form.product_name||'Nome do sistema'}</strong><span>{form.subtitle||'Subtítulo'}</span></div></div><div className="preview-hero"><h2>{form.dashboard_title||'Título'}</h2><p>{form.dashboard_message||'Descrição inicial'}</p></div><div className="preview-button" style={{background:form.accent_color}}>Botão principal</div><p className="muted">Para mudar páginas, funcionalidades ou código-fonte, abra o projeto no VS Code e publique pelo GitHub.</p></div></div>
  </div>;
}

function maskAccessKey(value='') {
  const digits=String(value||'').replace(/\D/g,'');
  if(digits.length<=8)return digits||'—';
  return `${digits.slice(0,4)} •••• •••• •••• •••• •••• •••• •••• •••• ${digits.slice(-4)}`;
}
async function copyText(value) {
  const text=String(value||'');
  if(!text)throw new Error('Não há conteúdo para copiar.');
  if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return;}
  const field=document.createElement('textarea');field.value=text;field.style.position='fixed';field.style.opacity='0';document.body.appendChild(field);field.select();
  const ok=document.execCommand('copy');field.remove();if(!ok)throw new Error('Não foi possível copiar automaticamente neste navegador.');
}

function InvoiceableItemsTable({sites,filters,onFiltersChange,selectedItems,onToggle,revision,canEdit,onCreate}) {
  const [page,setPage]=useState(0),[rows,setRows]=useState([]),[count,setCount]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const pageSize=15;
  useEffect(()=>setPage(0),[filters]);
  useEffect(()=>{let live=true;setLoading(true);setError('');listInvoiceableLines(filters,page,pageSize).then(result=>{if(live){setRows(result.rows);setCount(result.count);}}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[filters,page,revision]);
  const selectedIds=new Set(selectedItems.map(item=>item.item_id));
  const pages=Math.max(1,Math.ceil(count/pageSize));
  return <section className="surface-card invoice-pending-card">
    <div className="section-heading"><div><h3>Materiais aguardando nota fiscal</h3><p>Selecione até quatro materiais que pertencem à nota que você recebeu.</p></div><span className="invoice-counter"><Boxes size={16}/>{count.toLocaleString('pt-BR')} disponíveis</span></div>
    <FilterBar filters={filters} onChange={onFiltersChange} sites={sites}/>
    <ErrorBanner message={error} onClose={()=>setError('')}/>
    <div className="invoice-selection-bar"><div><span className="selection-count">{selectedItems.length}<small>/4</small></span><div><strong>{selectedItems.length===1?'material selecionado':'materiais selecionados'}</strong><small>Valor selecionado: {money(selectedItems.reduce((sum,item)=>sum+Number(item.total||0),0))}</small></div></div>{canEdit?<button className="btn btn-primary" disabled={!selectedItems.length} onClick={onCreate}><Receipt size={17}/> Registrar nota para {selectedItems.length} {selectedItems.length===1?'material':'materiais'}</button>:<span className="viewer-hint"><Eye size={15}/> Acesso somente para consulta</span>}</div>
    <div className="table-wrap"><table className="data-table invoice-select-table"><thead><tr><th>Selecionar</th><th>Dia do pedido</th><th>Site</th><th>SAP</th><th>Forms</th><th>Material</th><th className="align-right">Qtd.</th><th className="align-right">Unitário</th><th className="align-right">Total</th></tr></thead><tbody>
      {loading?<tr><td colSpan="9"><div className="table-loading"><Loader2 className="spin" size={20}/> Carregando materiais...</div></td></tr>:rows.length===0?<tr><td colSpan="9"><div className="table-loading muted">Nenhum material aguardando nota com esses filtros.</div></td></tr>:rows.map(row=>{const checked=selectedIds.has(row.item_id);const disabled=!canEdit||(!checked&&selectedItems.length>=4);return <tr key={row.item_id} className={checked?'invoice-row-selected':''}><td><input className="invoice-checkbox" aria-label={`Selecionar Forms ${row.forms_code}, SAP ${row.sap_code}`} type="checkbox" checked={checked} disabled={disabled} onChange={()=>onToggle(row)}/></td><td className="date-col">{formatDate(row.requested_on)}</td><td><span className="site-name">{row.site_name}</span><span className="site-sub">{row.center_code}</span></td><td className="mono-code">{row.sap_code||'—'}</td><td className="mono-code form-code">{row.forms_code||'—'}</td><td className="material-col">{row.material||'—'}<span className="site-sub">{processBadge(row.process)}</span></td><td className="align-right num">{number(row.quantity)}</td><td className="align-right num">{money(row.unit_price)}</td><td className="align-right total-cell num">{money(row.total)}</td></tr>;})}
    </tbody></table></div>
    {count>0&&<div className="pagination"><span>Mostrando {page*pageSize+1}–{Math.min(count,(page+1)*pageSize)} de {count.toLocaleString('pt-BR')}</span><div className="pagination-controls"><button disabled={page===0} onClick={()=>setPage(value=>value-1)} aria-label="Página anterior"><ChevronLeft size={18}/></button><span>Página {page+1} de {pages}</span><button disabled={page>=pages-1} onClick={()=>setPage(value=>value+1)} aria-label="Próxima página"><ChevronRight size={18}/></button></div></div>}
  </section>;
}

function InvoiceEditorModal({invoice,initialItems=[],readOnly=false,onClose,onSaved,onDeleted}) {
  const [form,setForm]=useState({note_number:invoice?.note_number||'',access_key:invoice?.access_key||'',issued_on:invoice?.issued_on||today(),notes:invoice?.notes||invoice?.invoice_notes||''});
  const [selected,setSelected]=useState(initialItems.length?initialItems:(invoice?.items||[]));
  const [availableSearch,setAvailableSearch]=useState(''),[available,setAvailable]=useState([]),[loadingAvailable,setLoadingAvailable]=useState(false);
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[copyState,setCopyState]=useState(false);
  const selectedIds=new Set(selected.map(item=>item.item_id||item.id));
  const total=selected.reduce((sum,item)=>sum+Number(item.total||Number(item.quantity||0)*Number(item.unit_price||0)),0);
  useEffect(()=>{if(readOnly)return;let live=true;const timer=setTimeout(()=>{setLoadingAvailable(true);listInvoiceableLines({search:availableSearch},0,8).then(result=>{if(live)setAvailable(result.rows.filter(row=>!selectedIds.has(row.item_id)));}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoadingAvailable(false);});},220);return()=>{live=false;clearTimeout(timer);};},[availableSearch,readOnly,selected.map(item=>item.item_id||item.id).join('|')]);
  function update(key,value){setForm(current=>({...current,[key]:value}));}
  function addItem(item){if(selected.length>=4){setError('O limite é de quatro materiais por nota fiscal.');return;}if(selectedIds.has(item.item_id||item.id))return;setSelected(current=>[...current,item]);setError('');}
  function removeItem(item){setSelected(current=>current.filter(row=>(row.item_id||row.id)!==(item.item_id||item.id)));}
  async function copyKey(){try{await copyText(form.access_key);setCopyState(true);setTimeout(()=>setCopyState(false),1800);}catch(e){setError(e.message);}}
  async function submit(e){e.preventDefault();if(readOnly)return;setSaving(true);setError('');try{await saveInvoice({...form,id:invoice?.id||null},selected.map(item=>item.item_id||item.id));await onSaved();}catch(e){setError(e.message);}finally{setSaving(false);}}
  async function removeInvoice(){if(!invoice||readOnly)return;if(!window.confirm(`Excluir a nota fiscal ${invoice.note_number}? Os materiais continuarão cadastrados, mas ficarão disponíveis para vincular a outra nota.`))return;setSaving(true);setError('');try{await deleteInvoice(invoice.id);await onDeleted();}catch(e){setError(e.message);}finally{setSaving(false);}}
  return <div className="modal-overlay invoice-modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><form className="invoice-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-label={readOnly?'Consultar nota fiscal':'Registrar nota fiscal'}>
    <div className="modal-head invoice-modal-head"><div className="invoice-modal-title-icon"><Receipt size={22}/></div><div className="invoice-modal-title"><span className="eyebrow">{readOnly?'CONSULTA DE NOTA FISCAL':invoice?'EDITAR NOTA FISCAL':'VINCULAR NOTA FISCAL'}</span><h3>{invoice?`Nota fiscal ${invoice.note_number}`:'Registrar nota fiscal'}</h3><p>Só precisa informar o número e a chave. A data de emissão já vem preenchida e pode ser ajustada.</p></div><button type="button" className="close-button" aria-label="Fechar" onClick={onClose}><X size={20}/></button></div>
    <div className="invoice-modal-scroll"><ErrorBanner message={error} onClose={()=>setError('')}/>
      <section className="invoice-form-section"><div className="invoice-form-grid"><FormField label="Número da nota fiscal *"><input required maxLength={60} disabled={readOnly} value={form.note_number} onChange={e=>update('note_number',e.target.value)} placeholder="Ex.: 20231"/></FormField><FormField label="Data de emissão (automática)"><input type="date" disabled={readOnly} value={form.issued_on} onChange={e=>update('issued_on',e.target.value)}/></FormField><FormField label="Chave de acesso da NF-e (44 dígitos) *"><div className="invoice-key-input"><input required inputMode="numeric" autoComplete="off" disabled={readOnly} maxLength={44} value={form.access_key} onChange={e=>update('access_key',e.target.value.replace(/\D/g,'').slice(0,44))} placeholder="Cole os 44 números da chave"/><button type="button" className="icon-action" title="Copiar chave" onClick={copyKey} disabled={!form.access_key}>{copyState?<Check size={16}/>:<Copy size={16}/>}</button></div><small className={form.access_key.length===44?'key-valid':'key-counter'}>{form.access_key.length}/44 dígitos{form.access_key.length===44?' · chave completa':''}</small></FormField></div><FormField label="Observações (opcional)"><textarea className="notes-input" rows={2} disabled={readOnly} value={form.notes} onChange={e=>update('notes',e.target.value)} placeholder="Observações sobre a nota fiscal..."/></FormField></section>
      <section className="invoice-selected-section"><div className="section-heading"><div><h3>Materiais vinculados ({selected.length}/4)</h3><p>Esses dados vêm dos lançamentos já cadastrados.</p></div><strong className="invoice-total">{money(total)}</strong></div>
        {[...new Set(selected.map(item=>item.site_id).filter(Boolean))].length>1&&<div className="invoice-lock-warning"><AlertCircle size={16}/> Os materiais selecionados pertencem a sites diferentes. Confira se todos realmente fazem parte da mesma nota fiscal.</div>}
        {selected.length===0?<div className="invoice-empty-selected">Selecione pelo menos um material para registrar a nota.</div>:<div className="table-wrap"><table className="data-table invoice-modal-items"><thead><tr><th>Forms / SAP</th><th>Site</th><th>Data do pedido</th><th>Processo</th><th className="align-right">Qtd.</th><th className="align-right">Unitário</th><th className="align-right">Total</th>{!readOnly&&<th></th>}</tr></thead><tbody>{selected.map(item=><tr key={item.item_id||item.id}><td><strong className="mono-code form-code">{item.forms_code||'—'}</strong><span className="site-sub">SAP {item.sap_code||'—'}</span><span className="site-sub">{item.material||''}</span></td><td>{item.site_name||'—'}<span className="site-sub">{item.center_code||''}</span></td><td>{formatDate(item.requested_on)}</td><td>{processBadge(item.process)}</td><td className="align-right num">{number(item.quantity)}</td><td className="align-right num">{money(item.unit_price)}</td><td className="align-right total-cell num">{money(item.total||Number(item.quantity)*Number(item.unit_price))}</td>{!readOnly&&<td><button type="button" className="delete-item" title="Remover da seleção" aria-label="Remover material" onClick={()=>removeItem(item)}><X size={16}/></button></td>}</tr>)}</tbody></table></div>}
      </section>
      {!readOnly&&<section className="invoice-add-section"><div className="section-heading"><div><h3>Adicionar material</h3><p>Busque por SAP, Forms, site ou descrição. Só aparecem materiais ainda sem nota.</p></div><Search size={18}/></div><div className="invoice-add-search"><Search size={17}/><input value={availableSearch} onChange={e=>setAvailableSearch(e.target.value)} placeholder="Buscar SAP, Forms, site..."/><span>{selected.length>=4?'Limite atingido':`${4-selected.length} vaga(s)`}</span></div><div className="invoice-available-list">{loadingAvailable?<div className="table-loading"><Loader2 className="spin" size={18}/> Buscando materiais...</div>:available.length===0?<p className="muted">Nenhum material disponível para adicionar com essa busca.</p>:available.map(item=><div className="invoice-available-row" key={item.item_id}><div><strong>{item.forms_code||'Forms não informado'}</strong><span>SAP {item.sap_code||'—'} · {item.site_name} · {formatDate(item.requested_on)}</span></div><strong>{money(item.total)}</strong><button type="button" className="btn btn-secondary btn-small" disabled={selected.length>=4} onClick={()=>addItem(item)}><Plus size={14}/> Adicionar</button></div>)}</div></section>}
      {invoice?.activities?.length>0&&<section className="invoice-history-section"><div className="section-heading"><div><h3>Histórico da nota</h3><p>Alterações e vínculos registrados no sistema.</p></div><Clock3 size={17}/></div><div className="history">{invoice.activities.map(activity=><div className="history-line" key={activity.id}><span className="history-bullet"/><div><strong>{activity.summary}</strong><small>{new Date(activity.changed_at).toLocaleString('pt-BR')}{activity.changed_by_email?` · ${activity.changed_by_email}`:''}</small></div></div>)}</div></section>}
    </div>
    <div className="modal-footer invoice-modal-footer">{!readOnly&&invoice&&<button type="button" className="btn btn-danger" onClick={removeInvoice} disabled={saving}><Trash2 size={15}/> Excluir nota</button>}<div><button type="button" className="btn btn-secondary" onClick={onClose}>{readOnly?'Fechar':'Cancelar'}</button>{!readOnly&&<button type="submit" className="btn btn-primary" disabled={saving||selected.length<1||selected.length>4||form.access_key.length!==44||!form.note_number.trim()}>{saving?<Loader2 className="spin" size={16}/>:<Save size={16}/>} {invoice?'Salvar alterações':'Salvar nota fiscal'}</button>}</div></div>
  </form></div>;
}

function InvoicesPage({sites,revision,canEdit,onChanged}) {
  const [filters,setFilters]=useState({...noFilters}),[selectedItems,setSelectedItems]=useState([]);
  const [invoices,setInvoices]=useState([]),[invoiceCount,setInvoiceCount]=useState(0),[invoicePage,setInvoicePage]=useState(0),[invoiceSearch,setInvoiceSearch]=useState(''),[searchDraft,setSearchDraft]=useState('');
  const [loadingInvoices,setLoadingInvoices]=useState(true),[error,setError]=useState(''),[modalOpen,setModalOpen]=useState(false),[editingInvoice,setEditingInvoice]=useState(null),[readOnly,setReadOnly]=useState(false),[copyingId,setCopyingId]=useState(''),[downloading,setDownloading]=useState(false);
  const invoicePageSize=20;
  useEffect(()=>{const timer=setTimeout(()=>{setInvoiceSearch(searchDraft.trim());setInvoicePage(0);},250);return()=>clearTimeout(timer);},[searchDraft]);
  useEffect(()=>{let live=true;setLoadingInvoices(true);setError('');listInvoices(invoiceSearch,invoicePage,invoicePageSize).then(result=>{if(live){setInvoices(result.rows);setInvoiceCount(result.count);}}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoadingInvoices(false);});return()=>{live=false;};},[invoiceSearch,invoicePage,revision]);
  const selectedTotal=selectedItems.reduce((sum,item)=>sum+Number(item.total||0),0);
  const pageTotal=invoices.reduce((sum,invoice)=>sum+Number(invoice.total_value||0),0);
  const pageItemCount=invoices.reduce((sum,invoice)=>sum+Number(invoice.item_count||0),0);
  function toggleItem(row){setSelectedItems(current=>{const exists=current.some(item=>item.item_id===row.item_id);if(exists)return current.filter(item=>item.item_id!==row.item_id);if(current.length>=4)return current;return [...current,row];});}
  function openCreate(){setEditingInvoice(null);setReadOnly(false);setModalOpen(true);}
  function openInvoice(invoice){setEditingInvoice(invoice);setReadOnly(!canEdit);setModalOpen(true);}
  async function copyKey(invoice){setCopyingId(invoice.id);setError('');try{await copyText(invoice.access_key);}catch(e){setError(e.message);}finally{setCopyingId('');}}
  async function exportInvoices(){
    setDownloading(true);setError('');
    try{
      const all=[];
      for(let page=0;;page++){
        const result=await listInvoices(invoiceSearch,page,500);
        all.push(...result.rows);
        if(result.rows.length<500)break;
      }
      if(!all.length)throw new Error('Não há notas fiscais para exportar.');
      const safe=value=>{const raw=String(value??'');return /^[=+\-@]/.test(raw)?`'${raw}`:raw;};
      const cols=[['Número NF','note_number'],['Data de emissão','issued_on'],['Chave de acesso','access_key'],['Sites','site_names'],['Forms','forms_codes'],['SAP','sap_codes'],['Quantidade de itens','item_count'],['Valor total','total_value'],['Observações','notes']];
      const csv=row=>row.map(value=>`"${safe(value).replace(/"/g,'""')}"`).join(';');
      const content=[csv(cols.map(([label])=>label)),...all.map(inv=>csv(cols.map(([_,key])=>['forms_codes','sap_codes'].includes(key)?(inv[key]||[]).join(', '):key==='total_value'?Number(inv[key]||0).toFixed(2).replace('.',','):inv[key])))].join('\r\n');
      const blob=new Blob(['\ufeff'+content],{type:'text/csv;charset=utf-8;'});
      const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`notaflow-notas-${today()}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setError(e.message);}finally{setDownloading(false);}
  }
  async function completeInvoice(message='Nota fiscal salva e vinculada aos materiais.'){setModalOpen(false);setSelectedItems([]);setEditingInvoice(null);await onChanged(message);}
  const pages=Math.max(1,Math.ceil(invoiceCount/invoicePageSize));
  return <div className="page-content invoices-page">
    <div className="invoice-page-hero"><div className="invoice-page-icon"><Receipt size={28}/></div><div><span className="welcome-kicker">CONTROLE FISCAL</span><h2>Vincule a nota aos materiais sem redigitar os dados.</h2><p>Selecione até quatro materiais já cadastrados. Ao informar número, chave e data da NF-e, o NotaFlow associa automaticamente os dados de SAP, Forms, site, quantidade e valores.</p></div></div>
    <ErrorBanner message={error} onClose={()=>setError('')}/>
    <div className="invoice-stats-grid"><div className="invoice-stat"><span>Notas nesta página</span><strong>{loadingInvoices?'—':number(invoices.length)}</strong><small>de {invoiceCount.toLocaleString('pt-BR')} cadastradas</small></div><div className="invoice-stat"><span>Materiais vinculados</span><strong>{loadingInvoices?'—':number(pageItemCount)}</strong><small>na página atual</small></div><div className="invoice-stat"><span>Valor total nesta página</span><strong>{loadingInvoices?'—':money(pageTotal)}</strong><small>Soma dos itens das notas listadas</small></div></div>
    <InvoiceableItemsTable sites={sites} filters={filters} onFiltersChange={setFilters} selectedItems={selectedItems} onToggle={toggleItem} revision={revision} canEdit={canEdit} onCreate={openCreate}/>
    {canEdit&&<div className="invoice-floating-selection"><div><span className="selection-count">{selectedItems.length}<small>/4</small></span><div><strong>{selectedItems.length?'Pronto para registrar':'Selecione materiais acima'}</strong><small>{selectedItems.length?`${money(selectedTotal)} em materiais selecionados`:'Você pode selecionar no máximo quatro linhas por nota.'}</small></div></div><div className="invoice-selection-actions">{selectedItems.length>0&&<button className="btn btn-quiet" onClick={()=>setSelectedItems([])}>Limpar seleção</button>}<button className="btn btn-primary" disabled={!selectedItems.length} onClick={openCreate}><Receipt size={17}/> Informar número e chave</button></div></div>}
    <section className="surface-card invoice-register-card"><div className="section-heading"><div><h3>Notas fiscais registradas</h3><p>Histórico de notas, materiais vinculados e valores calculados automaticamente.</p></div><Receipt size={19}/></div>
      <div className="invoice-list-toolbar"><div className="filter-search"><Search size={17}/><input value={searchDraft} onChange={e=>setSearchDraft(e.target.value)} placeholder="Buscar número da nota ou chave de acesso..." aria-label="Buscar notas fiscais"/></div><div className="invoice-list-toolbar-actions"><span className="record-count">{invoiceCount.toLocaleString('pt-BR')} {invoiceCount===1?'nota':'notas'}</span><button className="btn btn-quiet" onClick={exportInvoices} disabled={downloading||invoiceCount===0}>{downloading?<Loader2 className="spin" size={15}/>:<Download size={15}/>} Exportar CSV</button></div></div>
      <ErrorBanner message={error} onClose={()=>setError('')}/>
      <div className="table-wrap"><table className="data-table invoice-register-table"><thead><tr><th>Nota / emissão</th><th>Chave de acesso</th><th>Forms / SAP</th><th>Site</th><th>Itens</th><th className="align-right">Valor total</th><th>Ações</th></tr></thead><tbody>
        {loadingInvoices?<tr><td colSpan="7"><div className="table-loading"><Loader2 className="spin" size={20}/> Carregando notas fiscais...</div></td></tr>:invoices.length===0?<tr><td colSpan="7"><div className="table-loading muted">{invoiceSearch?'Nenhuma nota corresponde à busca.':'Ainda não há notas fiscais registradas.'}</div></td></tr>:invoices.map(invoice=><tr key={invoice.id} className="invoice-list-row" onClick={()=>openInvoice(invoice)}><td><strong className="invoice-number">{invoice.note_number}</strong><span className="site-sub">Emissão: {formatDate(invoice.issued_on)}</span></td><td><span className="mono-code invoice-key-mask">{maskAccessKey(invoice.access_key)}</span><button type="button" className="copy-key-btn" title="Copiar chave completa" onClick={e=>{e.stopPropagation();copyKey(invoice);}}>{copyingId===invoice.id?<Loader2 className="spin" size={14}/>:<Copy size={14}/>} Copiar chave</button></td><td><strong className="invoice-code-list">{invoice.forms_codes?.join(', ')||'—'}</strong><span className="site-sub">SAP {invoice.sap_codes?.join(', ')||'—'}</span></td><td>{invoice.site_names||'—'}</td><td><span className="invoice-item-count">{invoice.item_count}/4</span></td><td className="align-right total-cell num">{money(invoice.total_value)}</td><td><button type="button" className="btn btn-quiet invoice-open-btn" onClick={e=>{e.stopPropagation();openInvoice(invoice);}}>{canEdit?<Pencil size={15}/>:<Eye size={15}/>} {canEdit?'Editar':'Ver'}</button></td></tr>)}
      </tbody></table></div>
      {invoiceCount>0&&<div className="pagination"><span>Mostrando {invoicePage*invoicePageSize+1}–{Math.min(invoiceCount,(invoicePage+1)*invoicePageSize)} de {invoiceCount.toLocaleString('pt-BR')}</span><div className="pagination-controls"><button disabled={invoicePage===0} onClick={()=>setInvoicePage(value=>value-1)} aria-label="Página anterior"><ChevronLeft size={18}/></button><span>Página {invoicePage+1} de {pages}</span><button disabled={invoicePage>=pages-1} onClick={()=>setInvoicePage(value=>value+1)} aria-label="Próxima página"><ChevronRight size={18}/></button></div></div>}
    </section>
    {modalOpen&&<InvoiceEditorModal key={editingInvoice?.id||'new-invoice'} invoice={editingInvoice} initialItems={editingInvoice?[]:selectedItems} readOnly={readOnly} onClose={()=>setModalOpen(false)} onSaved={()=>completeInvoice('Nota fiscal salva e vinculada aos materiais.')} onDeleted={()=>completeInvoice('Nota fiscal excluída; os materiais foram liberados para novo vínculo.')}/>}
  </div>;
}

const NAV_ITEMS=[{key:'dashboard',label:'Visão geral',Icon:LayoutDashboard},{key:'records',label:'Lançamentos',Icon:ClipboardList},{key:'invoices',label:'Notas fiscais',Icon:Receipt},{key:'search',label:'Consultar SAP / Forms',Icon:Search},{key:'sites',label:'Sites e centros',Icon:MapPin},{key:'appearance',label:'Aparência do site',Icon:Palette,adminOnly:true}];
const pageTitles={dashboard:['Visão geral','Resumo das solicitações e materiais.'],records:['Lançamentos','Todos os registros, com filtros e histórico.'],invoices:['Notas fiscais','Vincule os materiais já cadastrados à nota fiscal recebida.'],search:['Consultar SAP / Forms','Encontre o Forms associado a um SAP, mesmo em pedidos antigos.'],sites:['Sites e centros','Dados das unidades e centros físicos.'],appearance:['Aparência do site','Edite textos e cores pela interface de administrador.']};
function App(){
  const [session,setSession]=useState(null),[sessionReady,setSessionReady]=useState(isDemo);
  const [role,setRole]=useState(isDemo?'admin':'viewer'),[roleReady,setRoleReady]=useState(isDemo),[demoPreview,setDemoPreview]=useState(false);
  const [config,setConfig]=useState({...DEFAULT_CONFIG});
  const [tab,setTab]=useState('dashboard'),[mobileMenu,setMobileMenu]=useState(false),[sites,setSites]=useState([]);
  const [filters,setFilters]=useState({...noFilters}),[lookup,setLookup]=useState({...noFilters});
  const [editorId,setEditorId]=useState(undefined),[editorOpen,setEditorOpen]=useState(false),[viewerOpen,setViewerOpen]=useState(false);
  const [revision,setRevision]=useState(0),[toast,setToast]=useState('');
  const [stats,setStats]=useState({requests_total:0,items_total:0,pending_total:0,total_value:0}),[summary,setSummary]=useState([]),[recent,setRecent]=useState([]),[dashLoading,setDashLoading]=useState(true),[globalError,setGlobalError]=useState('');
  useEffect(()=>{if(isDemo)return;let live=true;supabase.auth.getSession().then(({data,error})=>{if(live){if(error)setGlobalError(error.message);setSession(data.session);setSessionReady(true);}});const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{if(live){setSession(next);setSessionReady(true);}});return()=>{live=false;subscription.unsubscribe();};},[]);
  useEffect(()=>{
    if(!isDemo&&!session){setRoleReady(false);return;}
    let active=true;setRoleReady(isDemo);
    Promise.all([getMyRole(session?.user?.id),getAppConfig()]).then(([r,c])=>{
      if(active){setRole(r);setConfig(c);setRoleReady(true);}
    }).catch(e=>{if(active){setGlobalError(`Erro ao verificar permissões: ${e.message}`);setRole('viewer');setRoleReady(true);}});
    return()=>{active=false;};
  },[session]);
  const canEdit=isDemo?!demoPreview:role==='admin';
  async function refreshConfig(){const c=await getAppConfig();setConfig(c);}
  useEffect(()=>{if(!isDemo&&!session)return;let active=true;listSites().then(x=>{if(active)setSites(x);}).catch(e=>{if(active)setGlobalError(e.message);});return()=>{active=false;};},[session,revision]);
  useEffect(()=>{if((!isDemo&&!session)||tab!=='dashboard')return;let active=true;setDashLoading(true);Promise.all([getDashboard(),getSiteSummary(),listLines({},0,7)]).then(([s,sitesData,r])=>{if(active){setStats(s);setSummary(sitesData);setRecent(r.rows);}}).catch(e=>{if(active)setGlobalError(e.message);}).finally(()=>{if(active)setDashLoading(false);});return()=>{active=false;};},[session,tab,revision]);
  function openEditor(id){if(!canEdit){if(id){setEditorId(id);setViewerOpen(true);}return;}setEditorId(id||null);setEditorOpen(true);}
  function saved(){setEditorOpen(false);setRevision(v=>v+1);setToast('Pedido salvo com sucesso!');setTimeout(()=>setToast(''),3500);}
  function navigate(t){setTab(t);setMobileMenu(false);setGlobalError('');}
  async function refreshSites(){const sitesNew=await listSites();setSites(sitesNew);setRevision(v=>v+1);setToast('Site atualizado!');setTimeout(()=>setToast(''),3500);}
  async function logout(){if(!isDemo){await supabase.auth.signOut();navigate('dashboard');}}
  if(!sessionReady||(!isDemo&&session&&!roleReady))return <div className="center-loading"><Loader2 className="spin" size={30}/><p>Verificando acesso...</p></div>;
  if(!isDemo&&!session)return <Login sessionReady={sessionReady}/>;
  return <div className="app-layout" style={{'--brand-accent': /^#[0-9a-f]{6}$/i.test(config.accent_color)?config.accent_color:DEFAULT_CONFIG.accent_color}}>
    {mobileMenu&&<div className="mobile-backdrop" onClick={()=>setMobileMenu(false)}/>}
    <aside className={`sidebar ${mobileMenu?'sidebar-open':''}`}><div className="brand"><div className="brand-mark"><Layers3 size={23}/></div><div className="brand-title"><strong>{config.product_name}</strong><span>{config.subtitle}</span></div></div><div className="nav-caption">MENU PRINCIPAL</div><nav className="main-nav">{NAV_ITEMS.filter(item=>!item.adminOnly||canEdit).map(({key,label,Icon})=><button key={key} className={tab===key?'nav-item active':'nav-item'} onClick={()=>navigate(key)}><Icon size={19}/><span>{label}</span>{tab===key&&<span className="active-pip"/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="side-info"><Database size={19}/><div><strong>{isDemo?'Modo demonstração':'Banco conectado'}</strong><span>{isDemo?'Dados neste navegador':'Supabase PostgreSQL'}</span></div><span className={`connection-dot ${isDemo?'demo':''}`}/></div><div className="sidebar-profile"><div className="avatar">{isDemo?'D':session?.user?.email?.charAt(0)?.toUpperCase()||'U'}</div><div><strong>{isDemo?(canEdit?'Demo · Admin':'Demo · Leitor'):(canEdit?'Administrador':'Visualizador')}</strong><span title={session?.user?.email}>{isDemo?'Teste sem banco online':session?.user?.email}</span></div>{!isDemo&&<button className="side-logout" title="Sair" onClick={logout}><LogOut size={18}/></button>}</div></div>
    </aside>
    <main className="main-area"><header className="topbar"><div className="topbar-start"><button className="mobile-menu" onClick={()=>setMobileMenu(true)} aria-label="Abrir menu"><Menu size={22}/></button><div className="breadcrumb"><span>Workspace</span><ChevronRight size={15}/><strong>{pageTitles[tab][0]}</strong></div></div><div className="topbar-end">{isDemo&&<button className="demo-toggle" onClick={()=>{setDemoPreview(v=>!v);setEditorOpen(false);setViewerOpen(false);navigate('dashboard');}}>{demoPreview?'Voltar ao admin':'Testar visualizador'}</button>}{isDemo&&<span className="demo-pill"><span/> DEMONSTRAÇÃO</span>}{!isDemo&&<span className="access-pill">{canEdit?<ShieldCheck size={14}/>:<Eye size={14}/>} {canEdit?'Admin':'Leitura'}</span>}<div className="topbar-date"><CalendarDays size={16}/>{new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'})}</div></div></header>
      <div className="page-heading"><div><h1>{pageTitles[tab][0]}</h1><p>{pageTitles[tab][1]}</p></div><div className="heading-actions"><button title="Atualizar" className="icon-action" onClick={()=>setRevision(v=>v+1)}><RefreshCw size={19}/></button>{canEdit&&tab!=='sites'&&tab!=='appearance'&&tab!=='invoices'&&<button className="btn btn-primary new-action" onClick={()=>openEditor(null)}><Plus size={18}/> Novo pedido</button>}</div></div>
      <ErrorBanner message={globalError} onClose={()=>setGlobalError('')}/>
      {isDemo&&<div className="demo-alert"><Info size={18}/><span><strong>Modo de demonstração.</strong> Os registros aqui são fictícios e ficam apenas neste navegador. Configure o Supabase para ter um banco online e login.</span></div>}
      {tab==='dashboard'&&<Dashboard stats={stats} summary={summary} recent={recent} loading={dashLoading} onOpen={id=>id?openEditor(id):navigate('records')} onNew={()=>openEditor(null)} canEdit={canEdit} config={config}/>}
      {tab==='records'&&<div className="page-content"><div className="control-intro"><span className="control-icon"><ListFilter size={19}/></span><div><h3>Planilha de lançamentos</h3><p>Filtre por site, data, SAP, Forms, status ou processo.</p></div></div><FilterBar filters={filters} onChange={setFilters} sites={sites}/><PaginatedTable filters={filters} sites={sites} onOpen={openEditor} revision={revision} canEdit={canEdit}/></div>}
      {tab==='invoices'&&<InvoicesPage sites={sites} revision={revision} canEdit={canEdit} onChanged={async(message='Nota fiscal salva e vinculada aos materiais.')=>{setRevision(v=>v+1);setToast(message);setTimeout(()=>setToast(''),3500);}}/>}
      {tab==='search'&&<div className="page-content"><div className="lookup-hero"><div className="lookup-symbol"><Search size={29}/></div><div><span>LOCALIZADOR DE MATERIAIS</span><h2>De SAP para Forms, sem retrabalho.</h2><p>Digite o código SAP da nota fiscal para encontrar os Forms correspondentes, a data do pedido e o site. Se houver mais de um Forms para o mesmo SAP, todos os resultados serão exibidos.</p></div></div><FilterBar filters={lookup} onChange={setLookup} sites={sites}/><PaginatedTable filters={lookup} sites={sites} onOpen={openEditor} revision={revision} canEdit={canEdit} showNF queryMode/></div>}
      {tab==='sites'&&<SiteSettings sites={sites} onChange={refreshSites} readOnly={!canEdit}/>}
      {tab==='appearance'&&canEdit&&<AppearanceSettings config={config} onChange={refreshConfig}/>} 
      <footer className="app-footer">{config.product_name} • Controle interno de pedidos e materiais <span>Os valores e códigos de demonstração são fictícios.</span></footer>
    </main>
    {viewerOpen&&<RequestViewer key={editorId} requestId={editorId} sites={sites} onClose={()=>setViewerOpen(false)}/>}
    {editorOpen&&canEdit&&<RequestEditor key={editorId||'new'} requestId={editorId} sites={sites} onClose={()=>setEditorOpen(false)} onSaved={saved}/>}
    {toast&&<div role="status" className="toast"><CheckCircle2 size={18}/>{toast}</div>}
  </div>;
}
export default App;
