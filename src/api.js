import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
export const isDemo = !url || !key || url.includes('SEU-PROJETO') || key.includes('SUA_CHAVE');
export const supabase = isDemo ? null : createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

const DEMO_KEY = 'notaflow-demo-v1';
const demoSites = [
  { id: 'site-v', name: 'Valinhos', center_code: '3178', carrier_info: '10083071 | Nordeste', region: '' },
  { id: 'site-vi', name: 'Vinhedo', center_code: '3166', carrier_info: '10122618 | Sudeste', region: '' },
  { id: 'site-p', name: 'Pouso Alegre', center_code: '5038', carrier_info: '', region: '' },
  { id: 'site-ip', name: 'Ipojuca', center_code: '3165', carrier_info: '', region: '' },
  { id: 'site-ig', name: 'Igarassu', center_code: '3181', carrier_info: '', region: '' },
  { id: 'site-g', name: 'Garanhuns', center_code: '5029', carrier_info: '', region: '' },
];

function dayAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function seedDemo() {
  const names = ['Suporte de sensor', 'Engrenagem de reposição', 'Gabarito de montagem', 'Tampa de proteção', 'Abraçadeira técnica', 'Fixação de painel', 'Protetor lateral', 'Bucha adaptadora'];
  const requests = [], items = [], history = [];
  for (let j = 0; j < 12; j++) {
    const id = `pedido-${j+1}`;
    const status = ['rascunho','solicitado','solicitado','nota_recebida','concluido'][j % 5];
    requests.push({ id, site_id: demoSites[j%demoSites.length].id, requested_on: dayAgo(j*2), status, note_number: status === 'nota_recebida' || status === 'concluido' ? `NF-${3100+j}` : '', notes: j === 1 ? 'Prioridade para manutenção' : '', created_at: new Date().toISOString() });
    history.push({ id: `log-${j}`, request_id: id, previous_status: null, new_status: status, changed_at: new Date(Date.now()-j*86400000).toISOString() });
    for (let k=0;k<(j%3)+1;k++) {
      const n=(j*2+k)%8;
      const unit_price=+(38.9+n*47.35).toFixed(2);
      const quantity=k+1;
      items.push({ id:`item-${j}-${k}`, request_id:id, sap_code:`100${83070+n}`, forms_code:`FRM-${859+n*3}`, material:names[n], process:n%2===0?'3d':'cnc', quantity, unit_price, total:+(quantity*unit_price).toFixed(2), created_at: new Date().toISOString() });
    }
  }
  const activity = history.map(h => ({ id: h.id, request_id: h.request_id, entity_type: 'request', action: 'INSERT', summary: `Pedido criado · situação inicial: ${h.new_status}`, changed_at: h.changed_at, changed_by_email: 'Demonstração' }));
  return { sites: demoSites, requests, items, history, activity, invoices: [], invoice_items: [], invoice_activity: [] };
}
function readDemo() {
  try {
    const data = JSON.parse(localStorage.getItem(DEMO_KEY));
    if (data?.sites && data?.requests && data?.items && data?.history) {
    let changed = false;
    if (!Array.isArray(data.activity)) {
      data.activity = data.history.map(h => ({
        id: h.id, request_id: h.request_id, entity_type: 'request', action: 'INSERT',
        summary: `Pedido criado · situação inicial: ${h.new_status}`,
        changed_at: h.changed_at, changed_by_email: 'Demonstração',
      }));
      changed = true;
    }
    for (const key of ['invoices','invoice_items','invoice_activity']) {
      if (!Array.isArray(data[key])) { data[key] = []; changed = true; }
    }
    if (changed) saveDemo(data);
    return data;
  }
  } catch { /* rebuild demo */ }
  const data = seedDemo();
  localStorage.setItem(DEMO_KEY, JSON.stringify(data));
  return data;
}
function saveDemo(data) { localStorage.setItem(DEMO_KEY, JSON.stringify(data)); }
function friendlyError(error) {
  const code = error?.code || '';
  const message = String(error?.message || error || 'Ocorreu um erro inesperado.');
  if (code === '42501' || /row-level security|permission denied|apenas o administrador/i.test(message)) {
    return new Error('Seu perfil não tem permissão para fazer essa alteração. Se precisar editar, solicite acesso ao administrador.');
  }
  if (code === '23505' && /chave de acesso/i.test(message)) return new Error('Esta chave de acesso já está cadastrada em outra nota fiscal.');
  if (code === '23505' && /material já está vinculado/i.test(message)) return new Error(message);
  if (code === '23505') return new Error('Já existe um cadastro com esses dados. Confira se o nome do site, código ou nota fiscal já foi usado.');
  if (code === '23503' && /nota fiscal|material/i.test(message)) return new Error(message);
  if (code === '23503') return new Error('Não foi possível concluir: este registro está vinculado a outros dados.');
  if (code === 'P0002' && /material|nota fiscal/i.test(message)) return new Error(message);
  if (code === 'PGRST116' || code === 'P0002') return new Error('O registro não foi encontrado. Atualize a tela e tente novamente.');
  if (/failed to fetch|network request failed|fetch failed/i.test(message)) return new Error('Não foi possível conectar ao banco. Verifique sua internet e tente novamente.');
  if (/invalid input syntax for type uuid/i.test(message)) return new Error('Um código interno está inválido. Atualize a tela e tente novamente.');
  return new Error(message);
}
function check(result) { if (result.error) throw friendlyError(result.error); return result.data; }
function newId() { return crypto.randomUUID(); }
function localToday() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function flattenDemo(data) {
  const sites = new Map(data.sites.map(s=>[s.id,s]));
  const requests = new Map(data.requests.map(r=>[r.id,r]));
  const invoices = new Map((data.invoices||[]).map(inv=>[inv.id,inv]));
  const invoiceByItem = new Map((data.invoice_items||[]).map(link=>[link.request_item_id,invoices.get(link.invoice_id)]));
  return data.items.map(i=>{
    const r=requests.get(i.request_id), s=sites.get(r?.site_id), inv=invoiceByItem.get(i.id);
    return { ...i, item_id:i.id, site_id:s?.id, site_name:s?.name || '', center_code:s?.center_code || '', carrier_info:s?.carrier_info || '', requested_on:r?.requested_on, status:r?.status, notes:r?.notes, note_number:r?.note_number, invoice_id:inv?.id||null, invoice_note_number:inv?.note_number||'', invoice_access_key:inv?.access_key||'', invoice_issued_on:inv?.issued_on||'', search_text:[i.sap_code,i.forms_code,i.material,r?.note_number,inv?.note_number,inv?.access_key,s?.name,s?.center_code].join(' ') };
  }).filter(r=>r.requested_on);
}
function applyFilters(rows, f) {
  const search=(f.search||'').trim().toLocaleLowerCase('pt-BR');
  return rows.filter(r=>(!search || r.search_text.toLocaleLowerCase('pt-BR').includes(search))
    && (!f.site || r.site_id === f.site)
    && (!f.status || r.status === f.status)
    && (!f.process || r.process === f.process)
    && (!f.from || r.requested_on >= f.from)
    && (!f.to || r.requested_on <= f.to));
}
function filteredQuery(filters, invoiceableOnly=false) {
  let q = supabase.from('v_request_lines').select('*', { count:'exact' });
  if(filters.site) q=q.eq('site_id',filters.site);
  if(filters.status) q=q.eq('status',filters.status);
  if(filters.process) q=q.eq('process',filters.process);
  if(filters.from) q=q.gte('requested_on',filters.from);
  if(filters.to) q=q.lte('requested_on',filters.to);
  if(invoiceableOnly) q=q.is('invoice_id',null).neq('status','cancelado');
  const safe=(filters.search||'').trim().replace(/[%_\\]/g,'');
  if (safe) {
    // Códigos SAP/Forms vão por campos próprios; texto livre (descrição, site etc.) usa a busca ampla da view.
    const looksLikeCode = safe.length >= 4 && (/^\d+$/.test(safe) || safe.includes('-') || (/[A-Za-z]/.test(safe) && /\d/.test(safe)));
    if (looksLikeCode && /^[A-Za-z0-9-]+$/.test(safe)) {
      q=q.or(`sap_code.eq.${safe},forms_code.eq.${safe},sap_code.ilike.${safe}%,forms_code.ilike.${safe}%,note_number.eq.${safe},invoice_note_number.eq.${safe},invoice_access_key.eq.${safe},invoice_access_key.ilike.${safe}%,center_code.eq.${safe}`);
    } else {
      q=q.ilike('search_text',`%${safe}%`);
    }
  }
  return q.order('requested_on',{ascending:false}).order('created_at',{ascending:false}).order('item_id',{ascending:false});
}
export async function listSites() {
  if(isDemo) return [...readDemo().sites].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  return check(await supabase.from('sites').select('*').order('name'));
}
export async function listLines(filters={},page=0,size=40) {
  if(isDemo){
    const rows=applyFilters(flattenDemo(readDemo()),filters).sort((a,b)=>b.requested_on.localeCompare(a.requested_on));
    return { rows:rows.slice(page*size,(page+1)*size), count:rows.length };
  }
  const result=await filteredQuery(filters).range(page*size,(page+1)*size-1);
  check(result);
  return { rows:result.data||[], count:result.count||0 };
}
export async function listInvoiceableLines(filters={},page=0,size=15) {
  if(isDemo){
    const rows=applyFilters(flattenDemo(readDemo()),filters).filter(row=>!row.invoice_id&&row.status!=='cancelado').sort((a,b)=>b.requested_on.localeCompare(a.requested_on));
    return { rows:rows.slice(page*size,(page+1)*size), count:rows.length };
  }
  const result=await filteredQuery(filters,true).range(page*size,(page+1)*size-1);
  check(result);
  return { rows:result.data||[], count:result.count||0 };
}
function groupInvoiceRows(headers, lineRows, activities=[]) {
  return (headers||[]).map(inv=>{
    const items=(lineRows||[]).filter(line=>line.invoice_id===inv.id);
    const invoiceActivities=(activities||[]).filter(entry=>entry.invoice_id===inv.id);
    return {...inv, items, item_count:items.length,
      total_value:items.reduce((sum,item)=>sum+Number(item.total||0),0),
      site_names:[...new Set(items.map(item=>item.site_name).filter(Boolean))].join(', '),
      forms_codes:[...new Set(items.map(item=>String(item.forms_code||'').trim()).filter(Boolean))],
      sap_codes:[...new Set(items.map(item=>String(item.sap_code||'').trim()).filter(Boolean))],
      activities:invoiceActivities};
  });
}
export async function listInvoices(search='',page=0,size=20) {
  const term=String(search||'').trim().replace(/[^A-Za-z0-9\s.\/-]/g,'');
  if(isDemo){
    const d=readDemo();
    let headers=[...(d.invoices||[])].sort((a,b)=>String(b.issued_on).localeCompare(String(a.issued_on))||String(b.created_at).localeCompare(String(a.created_at)));
    if(term)headers=headers.filter(inv=>`${inv.note_number} ${inv.access_key} ${inv.notes}`.toLocaleLowerCase('pt-BR').includes(term.toLocaleLowerCase('pt-BR')));
    const count=headers.length;
    const pageHeaders=headers.slice(page*size,(page+1)*size);
    const lines=flattenDemo(d);
    const activities=d.invoice_activity||[];
    return {rows:groupInvoiceRows(pageHeaders,lines,activities),count};
  }
  let query=supabase.from('invoices').select('*',{count:'exact'}).order('issued_on',{ascending:false}).order('created_at',{ascending:false});
  if(term)query=query.or(`note_number.ilike.%${term}%,access_key.ilike.%${term}%`);
  const headersResult=await query.range(page*size,(page+1)*size-1);
  check(headersResult);
  const headers=headersResult.data||[];
  if(!headers.length)return {rows:[],count:headersResult.count||0};
  const ids=headers.map(inv=>inv.id);
  const [lineResult,activityResult]=await Promise.all([
    supabase.from('v_invoice_lines').select('*').in('invoice_id',ids).order('issued_on',{ascending:false}),
    supabase.from('invoice_activity').select('*').in('invoice_id',ids).order('changed_at',{ascending:false}),
  ]);
  check(lineResult);check(activityResult);
  return {rows:groupInvoiceRows(headers,lineResult.data||[],activityResult.data||[]),count:headersResult.count||0};
}
export async function saveInvoice(payload,itemIds) {
  const noteNumber=String(payload.note_number||'').trim();
  const accessKey=String(payload.access_key||'').replace(/\D/g,'');
  const issuedOn=String(payload.issued_on||localToday()).trim();
  const ids=[...new Set((itemIds||[]).filter(Boolean))];
  if(!noteNumber)throw new Error('Informe o número da nota fiscal.');
  if(accessKey.length!==44)throw new Error('A chave da NF-e deve conter exatamente 44 dígitos numéricos.');
  if(ids.length<1||ids.length>4)throw new Error('Selecione de um a quatro materiais para a nota fiscal.');
  const data={id:payload.id||null,note_number:noteNumber,access_key:accessKey,issued_on:issuedOn,notes:String(payload.notes||'').trim()};
  if(isDemo){
    const d=readDemo();
    const selected=d.items.filter(item=>ids.includes(item.id));
    if(selected.length!==ids.length)throw new Error('Um dos materiais selecionados não existe mais. Atualize a tela.');
    const requestById=new Map(d.requests.map(request=>[request.id,request]));
    if(selected.some(item=>requestById.get(item.request_id)?.status==='cancelado'))throw new Error('Não é possível vincular materiais de um pedido cancelado a uma nota fiscal.');
    const invoiceId=data.id||newId();
    const duplicate=d.invoices.find(inv=>inv.access_key===accessKey&&inv.id!==invoiceId);
    if(duplicate)throw new Error('Esta chave de acesso já está cadastrada em outra nota fiscal.');
    const conflict=d.invoice_items.find(link=>ids.includes(link.request_item_id)&&link.invoice_id!==invoiceId);
    if(conflict)throw new Error('Um dos materiais já está vinculado a outra nota fiscal. Atualize a tela.');
    const current=d.invoices.find(inv=>inv.id===invoiceId);
    const oldLinkedIds=new Set(d.invoice_items.filter(link=>link.invoice_id===invoiceId).map(link=>link.request_item_id));
    const oldRequestIds=new Set(d.items.filter(item=>oldLinkedIds.has(item.id)).map(item=>item.request_id));
    const now=new Date().toISOString();
    if(current)Object.assign(current,{...data,id:invoiceId,updated_at:now});
    else d.invoices.unshift({...data,id:invoiceId,created_at:now,updated_at:now});
    d.invoice_items=d.invoice_items.filter(link=>link.invoice_id!==invoiceId);
    ids.forEach(itemId=>d.invoice_items.push({invoice_id:invoiceId,request_item_id:itemId,created_at:now}));
    d.invoice_activity.unshift({id:newId(),invoice_id:invoiceId,action:current?'UPDATE':'INSERT',summary:current?`Dados da nota fiscal atualizados: ${noteNumber}`:`Nota fiscal registrada: ${noteNumber}`,changed_by_email:'Demonstração',changed_at:now});
    const linkedAfterSave=new Set(d.invoice_items.map(link=>link.request_item_id));
    for(const requestId of oldRequestIds){
      const request=d.requests.find(row=>row.id===requestId);
      const requestItems=d.items.filter(item=>item.request_id===requestId);
      if(request?.status==='nota_recebida'&&requestItems.some(item=>!linkedAfterSave.has(item.id))){
        const previous=request.status;request.status='solicitado';request.note_number='';
        d.history.push({id:newId(),request_id:request.id,previous_status:previous,new_status:'solicitado',changed_at:now});
        d.activity.push({id:newId(),request_id:request.id,entity_type:'request',action:'UPDATE',summary:'Situação alterada para solicitado após alterar os materiais vinculados à nota fiscal',changed_at:now,changed_by_email:'Demonstração'});
      }
    }
    for(const requestId of new Set(selected.map(item=>item.request_id))){
      const request=d.requests.find(r=>r.id===requestId);
      const requestItems=d.items.filter(item=>item.request_id===requestId);
      const links=new Map(d.invoice_items.map(link=>[link.request_item_id,link.invoice_id]));
      if(request&&requestItems.length&&requestItems.every(item=>links.has(item.id))){
        const invoiceIds=new Set(requestItems.map(item=>links.get(item.id)));
        const previous=request.status;
        if(['rascunho','solicitado'].includes(request.status)){
          request.status='nota_recebida';
          d.history.push({id:newId(),request_id:request.id,previous_status:previous,new_status:'nota_recebida',changed_at:now});
          d.activity.push({id:newId(),request_id:request.id,entity_type:'request',action:'UPDATE',summary:`Situação alterada: ${previous} → nota_recebida após vincular nota fiscal`,changed_at:now,changed_by_email:'Demonstração'});
        }
        request.note_number=invoiceIds.size===1?(d.invoices.find(inv=>inv.id===[...invoiceIds][0])?.note_number||''):'';
      }
    }
    saveDemo(d);return invoiceId;
  }
  const {data:result,error}=await supabase.rpc('save_invoice_with_items',{
    p_invoice_id:data.id,p_note_number:data.note_number,p_access_key:data.access_key,
    p_issued_on:data.issued_on,p_notes:data.notes,p_item_ids:ids,
  });
  if(error)throw friendlyError(error);
  return result;
}
export async function deleteInvoice(id) {
  if(isDemo){
    const d=readDemo(), invoice=d.invoices.find(inv=>inv.id===id);
    if(!invoice)throw new Error('A nota fiscal não foi encontrada.');
    const now=new Date().toISOString();
    const linkedItemIds=new Set(d.invoice_items.filter(link=>link.invoice_id===id).map(link=>link.request_item_id));
    const affectedRequestIds=new Set(d.items.filter(item=>linkedItemIds.has(item.id)).map(item=>item.request_id));
    d.invoice_activity.unshift({id:newId(),invoice_id:id,action:'DELETE',summary:`Nota fiscal excluída: ${invoice.note_number}`,changed_by_email:'Demonstração',changed_at:now});
    d.invoices=d.invoices.filter(inv=>inv.id!==id);
    d.invoice_items=d.invoice_items.filter(link=>link.invoice_id!==id);
    for(const requestId of affectedRequestIds){
      const request=d.requests.find(row=>row.id===requestId);
      const requestItems=d.items.filter(item=>item.request_id===requestId);
      const links=new Set(d.invoice_items.map(link=>link.request_item_id));
      if(request?.status==='nota_recebida'&&requestItems.some(item=>!links.has(item.id))){
        const previous=request.status;request.status='solicitado';request.note_number='';
        d.history.push({id:newId(),request_id:request.id,previous_status:previous,new_status:'solicitado',changed_at:now});
        d.activity.push({id:newId(),request_id:request.id,entity_type:'request',action:'UPDATE',summary:'Situação alterada para solicitado após excluir a nota fiscal vinculada',changed_at:now,changed_by_email:'Demonstração'});
      }
    }
    saveDemo(d);return;
  }
  const {error}=await supabase.rpc('delete_invoice',{p_invoice_id:id});
  if(error)throw friendlyError(error);
}
export async function getDashboard() {
  if(isDemo){
    const d=readDemo();
    return { requests_total:d.requests.length, items_total:d.items.length, pending_total:d.requests.filter(r=>['rascunho','solicitado'].includes(r.status)).length, total_value:d.items.reduce((a,i)=>a+Number(i.total),0) };
  }
  return check(await supabase.rpc('dashboard_stats'));
}
export async function getSiteSummary() {
  if(isDemo){
    const d=readDemo();
    return d.sites.map(s=>{
      const r=d.requests.filter(r=>r.site_id===s.id);
      const rIds=new Set(r.map(x=>x.id));
      const items=d.items.filter(x=>rIds.has(x.request_id));
      return { site_id:s.id, site_name:s.name, requests_total:r.length, items_total:items.length, total_value:items.reduce((a,i)=>a+Number(i.total),0) };
    }).sort((a,b)=>b.total_value-a.total_value);
  }
  return check(await supabase.rpc('site_summary'));
}
export async function getRequest(id) {
  if(isDemo){
    const d=readDemo();
    const request=d.requests.find(r=>r.id===id);
    if (!request) throw new Error('Pedido não encontrado. Atualize a lista e tente novamente.');
    const invoiceByItem=new Map((d.invoice_items||[]).map(link=>[link.request_item_id,(d.invoices||[]).find(inv=>inv.id===link.invoice_id)]));
    const items=d.items.filter(i=>i.request_id===id).map(item=>{const inv=invoiceByItem.get(item.id);return {...item,invoice_id:inv?.id||null,invoice_note_number:inv?.note_number||''};});
    return {
      request, items,
      history:d.history.filter(x=>x.request_id===id).sort((a,b)=>b.changed_at.localeCompare(a.changed_at)),
      activity:(d.activity||[]).filter(x=>x.request_id===id).sort((a,b)=>b.changed_at.localeCompare(a.changed_at)).slice(0,30),
    };
  }
  const [r,i,h,a]=await Promise.all([
    supabase.from('requests').select('*').eq('id',id).single(),
    supabase.from('request_items').select('*').eq('request_id',id).order('created_at'),
    supabase.from('status_history').select('*').eq('request_id',id).order('changed_at',{ascending:false}).order('id',{ascending:false}),
    supabase.from('request_activity').select('id,request_id,entity_type,entity_id,action,summary,changed_by_email,changed_at').eq('request_id',id).order('changed_at',{ascending:false}).order('id',{ascending:false}).limit(30),
  ]);
  const request = check(r);
  if (!request) throw new Error('Pedido não encontrado. Atualize a lista e tente novamente.');
  const items=check(i);
  let enrichedItems=items;
  if(items.length){
    const links=check(await supabase.from('invoice_items').select('request_item_id,invoice_id').in('request_item_id',items.map(item=>item.id)));
    const invoiceIds=[...new Set(links.map(link=>link.invoice_id))];
    const headers=invoiceIds.length?check(await supabase.from('invoices').select('id,note_number').in('id',invoiceIds)):[];
    const invoiceById=new Map(headers.map(inv=>[inv.id,inv]));
    const linkByItem=new Map(links.map(link=>[link.request_item_id,invoiceById.get(link.invoice_id)]));
    enrichedItems=items.map(item=>{const inv=linkByItem.get(item.id);return {...item,invoice_id:inv?.id||null,invoice_note_number:inv?.note_number||''};});
  }
  return { request, items:enrichedItems, history:check(h), activity:check(a) };
}
function normalizeItems(items,request_id) {
  return items.filter(i=>String(i.sap_code||'').trim() || String(i.forms_code||'').trim()).map(i=>{
    const q=Number(i.quantity), p=Number(i.unit_price);
    if(!Number.isFinite(q) || q<=0 || !Number.isFinite(p) || p<0) throw new Error('Confira a quantidade e o valor unitário dos itens.');
    return { ...(i.id?{id:i.id}:{}), request_id, sap_code:String(i.sap_code||'').trim(), forms_code:String(i.forms_code||'').trim(), material:String(i.material||'').trim(), process:i.process||'indefinido', quantity:q, unit_price:p };
  });
}
export async function saveRequest(payload,items) {
  const request={ site_id:payload.site_id, requested_on:payload.requested_on, status:payload.status, note_number:(payload.note_number||'').trim(), notes:(payload.notes||'').trim() };
  if(!request.site_id || !request.requested_on) throw new Error('Informe o site e a data.');
  const normalized = normalizeItems(items,payload.id||'pendente');
  if(!normalized.length) throw new Error('Adicione ao menos um item com SAP ou Forms.');

  if(isDemo){
    const d=readDemo(), id=payload.id||newId();
    const old=d.requests.find(x=>x.id===id);
    const previousStatus=old?.status??null;
    const oldItemIds=new Set(d.items.filter(item=>item.request_id===id).map(item=>item.id));
    if(old&&(old.site_id!==request.site_id||old.requested_on!==request.requested_on)&&d.invoice_items.some(link=>oldItemIds.has(link.request_item_id)))throw new Error('Este pedido contém materiais vinculados a uma nota fiscal. Desvincule primeiro na tela Notas fiscais para alterar site ou data.');
    if(old){ Object.assign(old,request); }
    else d.requests.unshift({ id,...request,created_at:new Date().toISOString() });
    const list=normalizeItems(items,id);
    const existingItems=d.items.filter(i=>i.request_id===id);
    const linkedIds=new Set(d.invoice_items.map(link=>link.request_item_id));
    for(const oldItem of existingItems.filter(item=>linkedIds.has(item.id))){
      const next=list.find(item=>item.id===oldItem.id);
      if(!next)throw new Error('Este material já está vinculado a uma nota fiscal. Desvincule a nota na tela Notas fiscais antes de removê-lo.');
      const fields=['sap_code','forms_code','material','process','quantity','unit_price'];
      if(fields.some(field=>String(next[field]??'')!==String(oldItem[field]??'')))throw new Error('Este material já está vinculado a uma nota fiscal e não pode ser alterado. Edite a nota na tela Notas fiscais primeiro.');
    }
    d.items=d.items.filter(i=>i.request_id!==id).concat(list.map(i=>({...i,id:i.id||newId(),total:+(i.quantity*i.unit_price).toFixed(2),created_at:new Date().toISOString()})));
    if(!Array.isArray(d.activity)) d.activity=[];
    const now=new Date().toISOString();
    let summary;
    if(!old) summary='Pedido criado';
    else if(previousStatus!==request.status) summary=`Situação alterada: ${previousStatus} → ${request.status}`;
    else summary='Pedido e materiais atualizados';
    d.activity.push({id:newId(),request_id:id,entity_type:'request',action:old?'UPDATE':'INSERT',summary,changed_at:now,changed_by_email:'Demonstração'});
    if(!old || previousStatus!==request.status) d.history.push({id:newId(),request_id:id,previous_status:previousStatus,new_status:request.status,changed_at:now});
    saveDemo(d); return id;
  }

  const rpcItems = normalized.map(({id,sap_code,forms_code,material,process,quantity,unit_price}) => ({
    ...(id ? {id} : {}), sap_code, forms_code, material, process, quantity, unit_price,
  }));
  const {data,error}=await supabase.rpc('save_request_with_items',{
    p_request_id:payload.id||null,
    p_site_id:request.site_id,
    p_requested_on:request.requested_on,
    p_status:request.status,
    p_note_number:request.note_number,
    p_notes:request.notes,
    p_items:rpcItems,
  });
  if(error) throw friendlyError(error);
  return data;
}
export async function deleteRequest(id){
  if(isDemo){ const d=readDemo(); const ids=new Set(d.items.filter(item=>item.request_id===id).map(item=>item.id)); if(d.invoice_items.some(link=>ids.has(link.request_item_id)))throw new Error('Este pedido contém materiais vinculados a uma nota fiscal. Desvincule ou exclua a nota na tela Notas fiscais antes de excluir o pedido.'); d.requests=d.requests.filter(x=>x.id!==id); d.items=d.items.filter(x=>x.request_id!==id); d.history=d.history.filter(x=>x.request_id!==id); /* a trilha de auditoria permanece como registro */ saveDemo(d);return; }
  check(await supabase.from('requests').delete().eq('id',id));
}
export async function saveSite(site){
  const data={name:site.name.trim(),center_code:(site.center_code||'').trim(),carrier_info:(site.carrier_info||'').trim(),region:(site.region||'').trim()};
  if(!data.name) throw new Error('Informe o nome do site.');
  if(isDemo){ const d=readDemo();if(site.id){const current=d.sites.find(x=>x.id===site.id);Object.assign(current,data);}else d.sites.push({id:newId(),...data});saveDemo(d);return; }
  if(site.id) check(await supabase.from('sites').update(data).eq('id',site.id));
  else check(await supabase.from('sites').insert(data));
}
export async function deleteSite(id){
  if(isDemo){const d=readDemo();if(d.requests.some(r=>r.site_id===id)) throw new Error('Este site possui pedidos. Você pode editar o nome, mas não excluir o histórico.');d.sites=d.sites.filter(s=>s.id!==id);saveDemo(d);return;}
  check(await supabase.from('sites').delete().eq('id',id));
}
export async function fetchAllLines(filters={}){
  const all=[];
  for(let page=0;;page++){
    const {rows}=await listLines(filters,page,500);
    all.push(...rows);
    if(rows.length<500) return all;
  }
}

// Papéis não são definidos por e-mail no frontend. A fonte de verdade é a RLS no Postgres.
export async function getMyRole(userId) {
  if (isDemo) return 'admin';
  if (!userId) return 'viewer';
  const {data,error}=await supabase.from('app_users').select('role').eq('user_id',userId).maybeSingle();
  if(error) throw friendlyError(error);
  return data?.role === 'admin' ? 'admin' : 'viewer';
}

export const DEFAULT_CONFIG = {
  product_name: 'NotaFlow', subtitle: 'CONTROLE SAP & FORMS',
  dashboard_title: 'Seu controle, tudo em um lugar.',
  dashboard_message: 'Acompanhe materiais, encontre Forms pelo SAP e gerencie pedidos de nota sem perder o histórico.',
  accent_color: '#17a89b',
};
const DEMO_CONFIG_KEY='notaflow-branding-v1';
export async function getAppConfig(){
  if(isDemo){
    try {return {...DEFAULT_CONFIG,...JSON.parse(localStorage.getItem(DEMO_CONFIG_KEY)||'{}')};}
    catch{return {...DEFAULT_CONFIG};}
  }
  const {data,error}=await supabase.from('app_config').select('product_name,subtitle,dashboard_title,dashboard_message,accent_color').eq('id',1).single();
  if(error)throw friendlyError(error);
  return data;
}
export async function saveAppConfig(input){
  const data={};
  for(const key of ['product_name','subtitle','dashboard_title','dashboard_message'])data[key]=String(input[key]??'').trim();
  data.accent_color=String(input.accent_color||'').trim();
  if(!data.product_name || !data.subtitle || !data.dashboard_title || !data.dashboard_message)throw new Error('Preencha todos os textos de personalização.');
  if(!/^#[0-9a-f]{6}$/i.test(data.accent_color))throw new Error('A cor deve estar em formato hexadecimal, como #17a89b.');
  if(isDemo){localStorage.setItem(DEMO_CONFIG_KEY,JSON.stringify(data));return;}
  const {error}=await supabase.from('app_config').update(data).eq('id',1);
  if(error)throw friendlyError(error);
}
