import {createClient} from '@supabase/supabase-js';
import {id,today,transitionOnLink,transitionOnUnlink,validateInvoiceSelection} from './domain.js';

const url=import.meta.env.VITE_SUPABASE_URL?.trim();
const key=import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
export const cloud=Boolean(url && key && !url.includes('SEU-PROJETO'));
export const supabase=cloud?createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true}}):null;
const KEY='notaflow-v2-demo-v1';
const empty=()=>({sites:[],blocks:[],materials:[],invoices:[],invoice_materials:[],activity:[]});
const now=()=>new Date().toISOString();
let memory=null;
const read=()=>{if(memory)return memory;try{const data=JSON.parse(localStorage.getItem(KEY));memory={...empty(),...data};}catch{memory=empty();}return memory;};
const write=()=>localStorage.setItem(KEY,JSON.stringify(memory));
const log=(entity,entity_id,action,summary)=>{const db=read();db.activity.unshift({id:id(),entity,entity_id,action,summary,author_id:null,happened_at:now()});};
const names={sites:'nf_sites',blocks:'nf_blocks',materials:'nf_materials',invoices:'nf_invoices',invoice_materials:'nf_invoice_materials',activity:'nf_activity'};
const fail=error=>{if(error)throw new Error(error.message||String(error));};
async function fetchAll(table){
  const all=[];for(let page=0;page<100;page++){
    const {data,error}=await supabase.from(names[table]).select('*').range(page*750,(page+1)*750-1);
    fail(error);all.push(...(data||[]));if((data||[]).length<750)return all;
  }
  throw new Error(`Limite de leitura alcançado em ${table}. Entre em contato com o administrador.`);
}
export async function loadAll(){
  if(!cloud)return structuredClone(read());
  const tables=Object.keys(names);
  const responses=await Promise.all(tables.map(fetchAll));
  return Object.fromEntries(tables.map((t,i)=>[t,responses[i]]));
}
export async function getRole(userId){
  if(!cloud)return 'admin';
  const {data,error}=await supabase.from('nf_profiles').select('role').eq('user_id',userId).maybeSingle();fail(error);return data?.role||'viewer';
}
export async function saveRow(table,payload){
  const row={...payload};
  if(!cloud){const db=read();if(table==='materials'&&row.status==='nota_recebida'&&!db.invoice_materials.some(l=>l.material_id===row.id))throw new Error('Nota recebida só pode ser definida pelo vínculo com uma NF.');const list=db[table];const original=list.find(x=>x.id===row.id);
    if(table==='materials'&&original&&db.invoice_materials.some(l=>l.material_id===row.id)&&['sap_code','forms_code','description','quantity','unit_price','site_id','requested_on'].some(k=>String(row[k])!==String(original[k])))throw new Error('Desvincule a nota fiscal antes de alterar os dados fiscais do material.');
    if(original){Object.assign(original,row,{updated_at:now()});log(table,row.id,'update',row.sap_code||row.name||row.number||'');}
    else{const created={id:id(),created_at:now(),...row};list.unshift(created);log(table,created.id,'insert',created.sap_code||created.name||created.number||'');}
    write();return structuredClone(original||list[0]);
  }
  const {data,error}=await supabase.from(names[table]).upsert(row).select('*').single();fail(error);return data;
}
export async function deleteRow(table,rowId){
  if(table==='invoices')return deleteInvoice(rowId);
  if(!cloud){const db=read();if(table==='sites'&&db.materials.some(x=>x.site_id===rowId))throw new Error('Site possui materiais vinculados.');if(table==='materials'&&db.invoice_materials.some(x=>x.material_id===rowId))throw new Error('Remova a nota fiscal antes de excluir o material.');
    if(table==='blocks')db.materials.forEach(m=>{if(m.block_id===rowId)m.block_id=null;});
    db[table]=db[table].filter(x=>x.id!==rowId);log(table,rowId,'delete','');write();return;
  }
  const {error}=await supabase.from(names[table]).delete().eq('id',rowId);fail(error);
}
export async function setMaterialStatus(materialIds,status){
  if(!materialIds.length)return;
  if(!cloud){const db=read();const chosen=db.materials.filter(m=>materialIds.includes(m.id));for(const m of chosen){const linked=db.invoice_materials.some(l=>l.material_id===m.id);if(linked&&!['nota_recebida','concluido'].includes(status))throw new Error('Material possui nota fiscal. Desvincule a nota primeiro.');if(status==='nota_recebida'&&!linked)throw new Error('Somente vincular uma nota fiscal pode definir Nota recebida.');}
    for(const m of chosen){m.status=status;m.updated_at=now();log('materials',m.id,'status',status);}
    write();return;}
  const {error}=await supabase.from('nf_materials').update({status}).in('id',materialIds);fail(error);
}
export async function moveMaterials(materialIds,blockId){
  if(!materialIds.length)return;
  if(!cloud){const db=read();db.materials.forEach(m=>{if(materialIds.includes(m.id))m.block_id=blockId||null;});write();return;}
  const {error}=await supabase.from('nf_materials').update({block_id:blockId||null}).in('id',materialIds);fail(error);
}
export async function saveManyMaterials(items){
  if(!items.length)return;
  if(!cloud){for(const item of items)await saveRow('materials',item);return;}
  const {error}=await supabase.from('nf_materials').insert(items);fail(error);
}
export async function saveInvoice(invoice,materialIds){
  if(!cloud){const db=read();const existing=invoice.id?db.invoices.find(x=>x.id===invoice.id):null;if(invoice.id&&!existing)throw new Error('Nota fiscal não encontrada.');if(!String(invoice.number||'').trim())throw new Error('Informe o número da nota.');if(invoice.access_key&&!/^\d{44}$/.test(invoice.access_key))throw new Error('Chave NF-e inválida: digite 44 números.');
    const unique=validateInvoiceSelection(materialIds,db.materials,existing?.id||null);
    const last=db.invoice_materials.filter(l=>l.invoice_id===existing?.id);
    for(const link of last.filter(l=>!unique.includes(l.material_id))){const m=db.materials.find(x=>x.id===link.material_id);Object.assign(m,transitionOnUnlink({...m,prior_status:link.prior_status}));}
    db.invoice_materials=db.invoice_materials.filter(l=>l.invoice_id!==existing?.id||unique.includes(l.material_id));
    const row={...invoice,id:existing?.id||id(),created_at:existing?.created_at||now(),updated_at:now()};
    if(existing)Object.assign(existing,row);else db.invoices.unshift(row);
    for(const mid of unique){if(db.invoice_materials.some(l=>l.invoice_id===row.id&&l.material_id===mid))continue;
      const m=db.materials.find(x=>x.id===mid);const old=m.status;Object.assign(m,transitionOnLink(m),{invoice_id:row.id});
      db.invoice_materials.push({invoice_id:row.id,material_id:mid,prior_status:old,added_at:now()});
    }
    log('invoices',row.id,existing?'update':'insert',row.number);write();return row.id;
  }
  const {data,error}=await supabase.rpc('nf_save_invoice',{p_id:invoice.id||null,p_number:invoice.number,p_access_key:invoice.access_key||'',p_issued_on:invoice.issued_on||today(),p_notes:invoice.notes||'',p_material_ids:materialIds});
  fail(error);return data;
}
export async function deleteInvoice(invoiceId){
  if(!cloud){const db=read();const links=db.invoice_materials.filter(l=>l.invoice_id===invoiceId);
    for(const link of links){const m=db.materials.find(x=>x.id===link.material_id);if(m)Object.assign(m,transitionOnUnlink({...m,prior_status:link.prior_status}));}
    db.invoice_materials=db.invoice_materials.filter(l=>l.invoice_id!==invoiceId);db.invoices=db.invoices.filter(i=>i.id!==invoiceId);log('invoices',invoiceId,'delete','');write();return;
  }
  const {error}=await supabase.from('nf_invoices').delete().eq('id',invoiceId);fail(error);
}
export function mergeView(raw){
  const siteMap=new Map(raw.sites.map(s=>[s.id,s]));const blockMap=new Map(raw.blocks.map(b=>[b.id,b]));const invoiceMap=new Map(raw.invoices.map(i=>[i.id,i]));
  const linkMap=new Map(raw.invoice_materials.map(l=>[l.material_id,l]));
  const materials=raw.materials.map(m=>{const link=linkMap.get(m.id),invoice=link&&invoiceMap.get(link.invoice_id);
    return {...m,invoice_id:link?.invoice_id||null,invoice_number:invoice?.number||'',site_name:siteMap.get(m.site_id)?.name||'',block_name:blockMap.get(m.block_id)?.name||''};
  });
  const invs=raw.invoices.map(i=>({...i,material_ids:raw.invoice_materials.filter(l=>l.invoice_id===i.id).map(l=>l.material_id)}));
  return {...raw,materials,invoices:invs};
}
