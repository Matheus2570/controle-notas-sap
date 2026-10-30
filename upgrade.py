from pathlib import Path
p=Path('/mnt/data/notaflow_v24/src/App.jsx'); text=p.read_text()
assert "const EMPTY_FILTERS={search:''" in text
text=text.replace("const EMPTY_FILTERS={search:'',status:'',process:'',site_id:'',from:'',to:'',invoice:''};", "const EMPTY_FILTERS={search:'',status:'',process:'',site_id:'',from:'',to:'',invoice:'',min_value:'',max_value:''};")
text=text.replace("['status','Status']];", "['status','Status'],['quantity_desc','Maior quantidade'],['quantity_asc','Menor quantidade'],['unit_desc','Maior preço unitário'],['unit_asc','Menor preço unitário'],['site','Site / fábrica'],['process','Processo']];")
# replace Filters component
start=text.index('function Filters(');end=text.index('function MaterialTable(',start)
text=text[:start]+'''function Filters({value,set,sites,invoice=false,compact=false,showSort=false,sort,setSort}){
 const update=(key,v)=>set(p=>({...p,[key]:v}));
 return <div className={`filters-wrap ${compact?'filters-compact':''}`}>
  <div className="filters">
   <div className="search-field"><Search size={17}/><TextInput aria-label="Pesquisar SAP, Forms ou descrição" placeholder="Buscar SAP, Forms, descrição, site..." value={value.search} onChange={v=>update('search',v)}/></div>
   <Select aria-label="Filtrar situação" value={value.status} onChange={v=>update('status',v)}><Opts items={STATUSES.map(s=>[s,STATUS_NAMES[s]])} blank="Todas as situações"/></Select>
   <Select aria-label="Filtrar processo" value={value.process} onChange={v=>update('process',v)}><Opts items={PROCESSES.map(s=>[s,PROCESS_NAMES[s]])} blank="CNC / 3D / Todos"/></Select>
   <Select aria-label="Filtrar site" value={value.site_id} onChange={v=>update('site_id',v)}><Opts items={sites.map(s=>[s.id,s.name])} blank="Todos os sites"/></Select>
   {invoice&&<Select aria-label="Filtrar vínculo de nota" value={value.invoice} onChange={v=>update('invoice',v)}><Opts items={[["with","Com nota"],["without","Sem nota"]]} blank="Todas as notas"/></Select>}
  </div>
  <div className="filters-extras">
   <label>Valor mínimo (R$) <TextInput aria-label="Valor total mínimo" inputMode="decimal" type="number" min="0" step="0.01" value={value.min_value} onChange={v=>update('min_value',v)} placeholder="0,00"/></label>
   <label>Valor máximo (R$) <TextInput aria-label="Valor total máximo" inputMode="decimal" type="number" min="0" step="0.01" value={value.max_value} onChange={v=>update('max_value',v)} placeholder="Sem limite"/></label>
   <label>De <TextInput aria-label="Data inicial" type="date" value={value.from} onChange={v=>update('from',v)}/></label>
   <label>Até <TextInput aria-label="Data final" type="date" value={value.to} onChange={v=>update('to',v)}/></label>
   {showSort&&<label>Ordenar por <Select aria-label="Ordenar materiais" value={sort} onChange={setSort}>{SORTS.map(([k,v])=><option key={k} value={k}>{v}</option>)}</Select></label>}
   <button type="button" className="clear-filters" onClick={()=>set({...EMPTY_FILTERS})}>Limpar filtros</button>
  </div>
 </div>;
}
function ProcessTag({process}){return <span className={`process-label process-label-${process==='cnc'?'cnc':process==='3d'?'3d':'other'}`}>{PROCESS_NAMES[process]||'Não definido'}</span>}
''' + text[end:]
# make process pill same colored
text=text.replace('<td><Pill>{PROCESS_NAMES[r.process]||\'Outro\'}</Pill></td>', '<td><ProcessTag process={r.process}/></td>')
# replace InvoiceEditor component
start=text.index('function InvoiceEditor(');end=text.index('function Login(',start)
text=text[:start]+'''function InvoiceEditor({invoice,materials,blocks,startBlockId='',onClose,onSave,busy}){
 const [form,setForm]=useState({number:invoice?.number||'',access_key:invoice?.access_key||'',issued_on:invoice?.issued_on||today(),notes:invoice?.notes||''});
 const allowed=m=>!m.invoice_id||m.invoice_id===invoice?.id;
 const canInvoice=m=>allowed(m)&&(m.status==='solicitado'||m.invoice_id===invoice?.id);
 const blockList=blocks.map(block=>({block,items:materials.filter(m=>m.block_id===block.id)}));
 const [chosenBlock,setChosenBlock]=useState(startBlockId||'');
 const suggested=materials.filter(m=>m.block_id===startBlockId&&canInvoice(m)).slice(0,4).map(m=>m.id);
 const [selected,setSelected]=useState(invoice?.material_ids||suggested);
 const [search,setSearch]=useState('');const [site,setSite]=useState('');const [process,setProcess]=useState('');const [order,setOrder]=useState('sap');
 const chooseBlock=blockId=>{
   setChosenBlock(blockId);
   if(!blockId){setSelected([]);return;}
   const items=materials.filter(m=>m.block_id===blockId&&canInvoice(m)).slice(0,4);
   setSelected(items.map(m=>m.id));
 };
 const targetBlock=blockList.find(b=>b.block.id===chosenBlock);
 const targetTotal=targetBlock?.items?.length||0;
 const targetReady=targetBlock?.items?.filter(canInvoice).length||0;
 const available=sortMaterials(materials.filter(canInvoice).filter(m=>(!chosenBlock||m.block_id===chosenBlock)&&(!search||[m.sap_code,m.forms_code,m.description,m.site_name].some(x=>String(x||'').toLowerCase().includes(search.toLowerCase())))&&(!site||m.site_id===site)&&(!process||m.process===process)),order);
 const siteOptions=[...new Map(materials.map(x=>[x.site_id,x.site_name])).entries()].filter(x=>x[0]);
 const toggle=materialId=>setSelected(prev=>prev.includes(materialId)?prev.filter(x=>x!==materialId):prev.length<4?[...prev,materialId]:prev);
 const selectedItems=materials.filter(m=>selected.includes(m.id));
 const submit=async e=>{e.preventDefault();if(!selected.length)return alert('Selecione de 1 a 4 materiais.');if(form.access_key&&!/^\\d{44}$/.test(form.access_key))return alert('A chave deve conter 44 dígitos ou ficar vazia.');await onSave({id:invoice?.id||null,...form},selected);};
 return <Modal title={invoice?'Editar nota fiscal':'Registrar nota fiscal'} onClose={onClose} wide><form onSubmit={submit}>
  <div className="workflow-hint"><ReceiptText size={20}/><div><strong>Etapa 3 — Nota recebida</strong><span>Primeiro solicite os materiais no SAP (status Pedido). Quando a NF chegar, selecione o bloco e informe número e chave. Só os materiais vinculados serão atualizados.</span></div></div>
  <div className="form-grid">
   <div className="span-2"><Field label="Carregar materiais de um bloco (até 4)"><Select value={chosenBlock} onChange={chooseBlock}><Opts blank="Escolher bloco ou selecionar manualmente" items={blockList.map(({block,items})=>[block.id,`${block.name} · ${[...new Set(items.map(m=>PROCESS_NAMES[m.process]))].join(' / ')||'Vazio'} · ${items.length}/4 · ${items.filter(canInvoice).length} disponível(is)`])}/></Select></Field></div>
   {chosenBlock&&<div className="span-2"><div className="block-ready-hint">{targetReady} de {targetTotal} material(is) deste bloco podem receber NF. {targetReady<targetTotal?'Os materiais em A pedir devem passar para Pedido antes de registrar a nota.':''}</div></div>}
   <Field label="Número da nota"><TextInput autoFocus required placeholder="Ex.: 123456" value={form.number} onChange={v=>setForm(p=>({...p,number:v}))}/></Field>
   <Field label="Data de emissão"><TextInput type="date" required value={form.issued_on} onChange={v=>setForm(p=>({...p,issued_on:v}))}/></Field>
   <div className="span-2"><Field label="Chave NF-e (44 dígitos, opcional)"><TextInput value={form.access_key} maxLength={44} onChange={v=>setForm(p=>({...p,access_key:v.replace(/\\D/g,''))})} placeholder="Digite ou cole a chave de acesso"/></Field></div>
  </div>
  <div className="subhead compact"><div><h2>Materiais desta nota</h2><p>Selecione até quatro materiais já solicitados no SAP.</p></div><span className={`count-badge ${selected.length===4?'full':''}`}>{selected.length} / 4</span></div>
  <div className="invoice-select-filters"><div className="search-field"><Search size={16}/><TextInput value={search} onChange={setSearch} placeholder="SAP / Forms / descrição"/></div><Select value={site} onChange={setSite}><Opts items={siteOptions} blank="Todos os sites"/></Select><Select value={process} onChange={setProcess}><Opts items={PROCESSES.map(x=>[x,PROCESS_NAMES[x]])} blank="Todos os processos"/></Select><Select value={order} onChange={setOrder}>{SORTS.map(([k,v])=><option key={k} value={k}>{v}</option>)}</Select></div>
  <div className="invoice-picker">{available.length?available.map(m=><label key={m.id} className={`invoice-choice ${selected.includes(m.id)?'chosen':''}`}><input type="checkbox" checked={selected.includes(m.id)} disabled={!selected.includes(m.id)&&selected.length>=4} onChange={()=>toggle(m.id)}/><span className="choice-content"><strong>{m.description||m.sap_code||m.forms_code}</strong><small>SAP {m.sap_code||'—'} · Forms {m.forms_code||'—'} · {m.site_name||'—'}</small><ProcessTag process={m.process}/></span><span className="num">{money(itemTotal(m))}</span></label>):<div className="picker-empty">Nenhum material em Pedido disponível. Solicite o bloco no SAP primeiro, ou altere os filtros.</div>}</div>
  <div className="invoice-total"><span>Total dos materiais selecionados</span><strong>{money(selectedItems.reduce((sum,m)=>sum+itemTotal(m),0))}</strong></div>
  <Field label="Observações"><textarea rows="2" value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))}/></Field>
  <div className="modal-actions"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" icon={Save} disabled={busy||!selected.length}>Salvar NF e marcar Nota recebida</Button></div>
 </form></Modal>;
}
''' + text[end:]
# New filters states
text=text.replace("const [invoiceSearch,setInvoiceSearch]=useState('');const [formsBatch,setFormsBatch]=useState('');", "const [invoiceSearch,setInvoiceSearch]=useState('');const [formsBatch,setFormsBatch]=useState('');const [blockFilters,setBlockFilters]=useState({...EMPTY_FILTERS});const [blockSort,setBlockSort]=useState('sap');const [invoiceFilters,setInvoiceFilters]=useState({...EMPTY_FILTERS});const [invoiceSort,setInvoiceSort]=useState('recent');const [activitySearch,setActivitySearch]=useState('');const [dashboardSearch,setDashboardSearch]=useState('');const [dashboardSort,setDashboardSort]=useState('recent');")
text=text.replace("const invoiceModal=(record=null)=>setModal({kind:'invoice',record});", "const invoiceModal=(record=null,blockId='')=>setModal({kind:'invoice',record,blockId});")
text=text.replace("const filterRows=(source)=>sortMaterials(source.filter(m=>!blockSearch||[m.description,m.sap_code,m.forms_code,PROCESS_NAMES[m.process]].some(v=>String(v||'').toLowerCase().includes(blockSearch.toLowerCase()))),'recent');", "const filterRows=(source)=>sortMaterials(source.filter(m=>matches(m,blockFilters,shown.sites)).filter(m=>!blockSearch||[m.description,m.sap_code,m.forms_code,PROCESS_NAMES[m.process],m.site_name].some(v=>String(v||'').toLowerCase().includes(blockSearch.toLowerCase()))),blockSort);")
text=text.replace("const latest=sortMaterials(shown.materials,'recent').slice(0,8);", "const latest=sortMaterials(shown.materials.filter(m=>!dashboardSearch||[m.sap_code,m.forms_code,m.description,m.site_name,PROCESS_NAMES[m.process]].some(v=>String(v||'').toLowerCase().includes(dashboardSearch.toLowerCase()))),dashboardSort).slice(0,8);")
# blocks line replace entire block page with multiline jsx
start=text.index("   {page==='blocks'&&");end=text.index("   {page==='invoices'&&",start)
text=text[:start]+'''   {page==='blocks'&&<>
    <Heading eyebrow="ORGANIZAÇÃO DE MATERIAIS" title="Blocos de trabalho" description="A pedir → Pedido no SAP → Nota recebida. Separação automática: CNC e impressão 3D, até quatro materiais por bloco." actions={canWrite&&<><Button variant="secondary" icon={Layers3} onClick={()=>run(autoGroupMaterials,'Itens sem bloco organizados automaticamente')}>Organizar sem bloco</Button><Button icon={Plus} onClick={()=>setModal({kind:'block'})}>Criar bloco</Button></>}/>
    <div className="workflow-steps"><span>1 · <b>A pedir</b> — aguardando solicitação</span><ChevronRight size={15}/><span>2 · <b>Pedido</b> — solicitado no SAP</span><ChevronRight size={15}/><span>3 · <b>Nota recebida</b> — cadastrar NF e chave</span></div>
    <section className="panel block-toolbar enhanced-block-toolbar">
      <div className="block-filters-full"><Filters value={blockFilters} set={setBlockFilters} sites={shown.sites} invoice showSort sort={blockSort} setSort={setBlockSort}/></div>
      {canWrite&&<div className="block-move-bar"><strong>{blockSelected.length} selecionado(s)</strong><Select value={targetBlock} onChange={setTargetBlock}><Opts items={orderedBlocks.map(b=>{const members=shown.materials.filter(m=>m.block_id===b.id);const types=[...new Set(members.map(m=>PROCESS_NAMES[m.process]||'Não definido'))];return [b.id,`${b.name} · ${types.join(' / ')||PROCESS_NAMES[b.process]||'Vazio'} · ${members.length}/4`];})} blank="Mover para Sem bloco"/></Select><Button variant="secondary" small icon={MoveRight} disabled={!blockSelected.length} onClick={()=>run(()=>moveMaterials(blockSelected,targetBlock),'Materiais movidos')}>Mover selecionados</Button></div>}
    </section>
    <div className="blocks-grid">{[...orderedBlocks,{id:null,name:'Sem bloco',position:999}].map(block=>{
      const allMembers=shown.materials.filter(m=>(m.block_id||null)===block.id);
      const children=filterRows(allMembers);
      const processTypes=[...new Set(allMembers.map(m=>m.process))];
      const isFilterActive=Object.values(blockFilters).some(Boolean)||Boolean(blockSearch);
      if(!children.length&&isFilterActive)return null;
      const pending=allMembers.filter(m=>m.status==='rascunho').length;
      const ready=allMembers.filter(m=>m.status==='solicitado').length;
      const receipted=allMembers.filter(m=>['nota_recebida','concluido'].includes(m.status)).length;
      return <section className={`panel block-panel colored-block ${processTypes.length===1?`block-type-${processTypes[0]}`:'block-type-mixed'}`} key={block.id||'unassigned'}>
       <div className="block-head"><div className="block-heading-main"><div className="block-index">{block.id?`BLOCO ${String(orderedBlocks.findIndex(b=>b.id===block.id)+1).padStart(3,'0')}`:'NÃO AGRUPADOS'}</div><h2>{block.name}</h2><div className="block-processes">{processTypes.map(proc=><ProcessTag key={proc} process={proc}/>)}{!processTypes.length&&block.process&&<ProcessTag process={block.process}/>}</div><span className="muted">{allMembers.length}{block.id?'/4':''} material(is) · {money(allMembers.reduce((a,m)=>a+itemTotal(m),0))}</span><div className="block-stage-stats"><span className="stage-draft">{pending} A pedir</span><span className="stage-requested">{ready} Pedido</span><span className="stage-invoiced">{receipted} com NF / concluído</span></div></div>
       {canWrite&&block.id&&<div className="inline-buttons"><button title="Renomear bloco" className="icon-button" onClick={()=>setModal({kind:'block',record:block})}><Pencil size={17}/></button><button title="Excluir bloco (sem excluir materiais)" className="icon-button" onClick={()=>removeConfirm('blocks',block,`o bloco ${block.name} (os materiais ficarão sem bloco)`)}><Trash2 size={17}/></button></div>}</div>
       {canWrite&&block.id&&allMembers.length>0&&<div className="block-primary-actions">
         <Button small variant="secondary" icon={Check} disabled={!pending||busy} onClick={()=>{const ids=allMembers.filter(m=>m.status==='rascunho').map(m=>m.id);if(window.confirm(`Confirmar solicitação no SAP de ${ids.length} material(is) do ${block.name}?`))run(()=>setMaterialStatus(ids,'solicitado'),`${ids.length} material(is) marcado(s) como Pedido`)}}>Solicitar no SAP ({pending})</Button>
         <Button small icon={ReceiptText} disabled={!ready||busy} onClick={()=>invoiceModal(null,block.id)}>Registrar NF deste bloco ({ready})</Button>
       </div>}
       {canWrite&&children.length>0&&<div className="block-operations"><label><input type="checkbox" checked={children.every(m=>blockSelected.includes(m.id))} onChange={e=>setBlockSelected(prev=>e.target.checked?[...new Set([...prev,...children.map(m=>m.id)])]:prev.filter(x=>!children.some(m=>m.id===x)))}/> Selecionar visíveis</label><div className="block-status-action"><select aria-label={`Status dos itens visíveis do ${block.name}`} defaultValue="solicitado"><option value="solicitado">Pedido</option><option value="rascunho">A pedir</option><option value="concluido">Concluído</option><option value="cancelado">Cancelado</option></select><Button variant="secondary" small onClick={e=>{const s=e.currentTarget.closest('.block-status-action')?.querySelector('select')?.value||'solicitado';run(()=>setMaterialStatus(children.map(x=>x.id),s),`Status atualizado: ${block.name}`)}}>Aplicar aos visíveis</Button></div></div>}
       <div className="block-items">{children.map(m=><div className={`block-item block-item-${m.process==='3d'?'3d':m.process==='cnc'?'cnc':'other'}`} key={m.id}>{canWrite&&<input type="checkbox" checked={blockSelected.includes(m.id)} onChange={e=>setBlockSelected(p=>e.target.checked?[...new Set([...p,m.id])]:p.filter(v=>v!==m.id))}/>}<div className="block-item-main"><strong>{m.description||m.sap_code||m.forms_code}</strong><small>SAP {m.sap_code||'—'} · Forms {m.forms_code||'—'} · {m.site_name||'—'}</small><small className="block-item-value">{money(itemTotal(m))}</small></div><ProcessTag process={m.process}/><Status value={m.status}/>{canWrite&&<button className="icon-button" title="Editar material" onClick={()=>materialModal(m)}><Pencil size={15}/></button>}</div>)}{!children.length&&<Empty title="Bloco vazio" description="Mova materiais para este grupo."/>}</div>
      </section>})}</div>
   </>}
''' +text[end:]
# invoices page entire replace
start=text.index("   {page==='invoices'&&");end=text.index("   {page==='lookup'&&",start)
text=text[:start]+'''   {page==='invoices'&&<>
     <Heading eyebrow="DOCUMENTOS FISCAIS" title="Notas fiscais" description="Após solicitar no SAP, escolha o bloco, informe número e chave da nota e vincule até quatro materiais." actions={canWrite&&<Button icon={Plus} onClick={()=>invoiceModal()}>Registrar NF</Button>}/>
     <section className="panel invoice-ready-panel"><Subhead title="Blocos aguardando nota" description="Você pode chamar os materiais já solicitados de um bloco diretamente aqui."/>
       <div className="invoice-block-grid">{orderedBlocks.map(block=>{const members=shown.materials.filter(m=>m.block_id===block.id);const pending=members.filter(m=>m.status==='solicitado'&&!m.invoice_id);if(!pending.length)return null;return <div className={`invoice-block-pick ${members.some(m=>m.process==='cnc')?'type-cnc':'type-3d'}`} key={block.id}><strong>{block.name}</strong><span className="muted">{pending.length} aguardando nota · {money(pending.reduce((s,m)=>s+itemTotal(m),0))}</span><div className="block-processes">{[...new Set(pending.map(m=>m.process))].map(p=><ProcessTag process={p} key={p}/>)}</div>{canWrite&&<Button small icon={ReceiptText} onClick={()=>invoiceModal(null,block.id)}>Chamar bloco para NF</Button>}</div>})}</div>
       {!shown.materials.some(m=>m.status==='solicitado'&&!m.invoice_id)&&<p className="muted">Nenhum material aguardando NF. Vá a Blocos e clique em “Solicitar no SAP”.</p>}
     </section>
     <section className="panel"><Subhead title="Notas cadastradas" description={`${shown.invoices.length} nota(s) cadastrada(s)`}/>
       <Filters value={invoiceFilters} set={setInvoiceFilters} sites={shown.sites} showSort={false}/>
       <div className="invoice-select-filters invoice-list-options"><div className="search-field"><Search size={17}/><TextInput value={invoiceSearch} onChange={setInvoiceSearch} placeholder="Número, chave, SAP ou Forms da NF"/></div><label>Ordenar notas <Select value={invoiceSort} onChange={setInvoiceSort}><option value="recent">Mais recentes</option><option value="oldest">Mais antigas</option><option value="number">Número da nota</option><option value="value_desc">Maior valor total</option><option value="value_asc">Menor valor total</option><option value="date_desc">Data da NF (recente)</option><option value="date_asc">Data da NF (antiga)</option></Select></label></div>
       <div className="invoice-cards">{[...shown.invoices].filter(invoice=>{const contents=shown.materials.filter(m=>invoice.material_ids.includes(m.id));return (!invoiceSearch||[invoice.number,invoice.access_key,...contents.flatMap(m=>[m.sap_code,m.forms_code,m.description])].some(x=>String(x||'').toLowerCase().includes(invoiceSearch.toLowerCase())))&&contents.some(m=>matches(m,invoiceFilters,shown.sites));}).sort((a,b)=>{const total=i=>shown.materials.filter(m=>i.material_ids.includes(m.id)).reduce((s,m)=>s+itemTotal(m),0);switch(invoiceSort){case 'oldest':return String(a.created_at).localeCompare(String(b.created_at));case 'number':return String(a.number).localeCompare(String(b.number),'pt-BR',{numeric:true});case 'value_desc':return total(b)-total(a);case 'value_asc':return total(a)-total(b);case 'date_desc':return String(b.issued_on).localeCompare(String(a.issued_on));case 'date_asc':return String(a.issued_on).localeCompare(String(b.issued_on));default:return String(b.created_at).localeCompare(String(a.created_at))}}).map(invoice=>{const contents=shown.materials.filter(m=>invoice.material_ids.includes(m.id));return <div className="invoice-card" key={invoice.id}><div className="invoice-card-top"><div><span className="eyebrow">NOTA FISCAL</span><h3>NF {invoice.number}</h3><p>Emitida em {dateLabel(invoice.issued_on)} · {contents.length} material(is)</p></div><strong className="invoice-value">{money(contents.reduce((s,m)=>s+itemTotal(m),0))}</strong></div><div className="invoice-tags">{contents.map(m=><span key={m.id} className="invoice-tag"><ProcessTag process={m.process}/>{m.sap_code||m.forms_code} · {m.description||'Material'}</span>)}</div>{invoice.access_key&&<div className="key-row"><span>Chave NF-e: <code>{invoice.access_key}</code></span><button className="icon-button" title="Copiar chave" onClick={()=>navigator.clipboard.writeText(invoice.access_key).then(()=>notify('Chave copiada')).catch(()=>notify('Não foi possível copiar',true))}><Copy size={16}/></button></div>}<div className="invoice-actions">{canWrite&&<><Button variant="secondary" small icon={Pencil} onClick={()=>invoiceModal(invoice)}>Editar nota</Button><Button variant="danger" small icon={Trash2} disabled={busy} onClick={()=>{if(window.confirm(`Excluir NF ${invoice.number}? Os materiais serão desvinculados e retornarão ao status anterior.`))run(()=>deleteInvoice(invoice.id),'Nota excluída, status recalculado')}}>Excluir</Button></>}</div></div>})}</div>{!shown.invoices.length&&<Empty icon={ReceiptText} title="Nenhuma nota fiscal registrada" description="Depois de solicitar no SAP, selecione o bloco para registrar a NF." action={canWrite&&<Button icon={Plus} onClick={()=>invoiceModal()}>Registrar nota</Button>}/>}</section>
   </>}
''' + text[end:]
# material editor and import: clarity
text=text.replace('Situação inicial', 'Etapa inicial (A pedir → Pedido)')
text=text.replace('title="Notas fiscais"', 'title="Notas fiscais"')
# update InvoiceEditor prop
text=text.replace('<InvoiceEditor invoice={modal.record} materials={shown.materials} busy={busy}', '<InvoiceEditor invoice={modal.record} materials={shown.materials} blocks={orderedBlocks} startBlockId={modal.blockId||\'\'} busy={busy}')
# dashboard latest controls after subhead
needle='<MaterialTable rows={latest} compact onEdit={canWrite?materialModal:null}/>'
text=text.replace(needle, '''<div className="dashboard-inline-filters"><div className="search-field"><Search size={15}/><TextInput value={dashboardSearch} onChange={setDashboardSearch} placeholder="Buscar SAP, Forms, material"/></div><Select value={dashboardSort} onChange={setDashboardSort}>{SORTS.map(([k,v])=><option key={k} value={k}>{v}</option>)}</Select></div>'''+needle)
# replace lookup Filters with sort incorporated; records currently sort included okay
p.write_text(text)
# domain filters and sorting
p=Path('/mnt/data/notaflow_v24/src/domain.js');s=p.read_text()
s=s.replace("  if(filters.invoice==='with'", "  if(filters.min_value!==''&&filters.min_value!=null&&itemTotal(m)<Number(filters.min_value))return false;\n  if(filters.max_value!==''&&filters.max_value!=null&&itemTotal(m)>Number(filters.max_value))return false;\n  if(filters.invoice==='with'")
s=s.replace("    case 'status':return cmp(a.status,b.status);", "    case 'status':return cmp(a.status,b.status);\n    case 'quantity_desc':return Number(b.quantity||0)-Number(a.quantity||0);\n    case 'quantity_asc':return Number(a.quantity||0)-Number(b.quantity||0);\n    case 'unit_desc':return Number(b.unit_price||0)-Number(a.unit_price||0);\n    case 'unit_asc':return Number(a.unit_price||0)-Number(b.unit_price||0);\n    case 'site':return cmp(a.site_name,b.site_name);\n    case 'process':return cmp(PROCESS_NAMES[a.process],PROCESS_NAMES[b.process]);")
s=s.replace("if(m.status==='cancelado')throw new Error('Material cancelado não pode receber nota.');", "if(m.status!=='solicitado'&&!(currentInvoiceId&&m.invoice_id===currentInvoiceId))throw new Error('Solicite o material no SAP (status Pedido) antes de vincular a nota fiscal.');")
p.write_text(s)
# demo saveInvoice status validates before linking; SQL migration
