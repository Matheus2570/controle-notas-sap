import {STATUS_NAMES,PROCESS_NAMES,itemTotal,matches,sortMaterials} from './domain.js';

const navy='17263F',blue='335FEA',pale='EFF4FC';
const text=value=>value==null?'':String(value);
const date=value=>{if(!value)return '';const d=new Date(String(value).length===10?`${value}T12:00:00Z`:value);return Number.isNaN(d.getTime())?'':d;};
const unique=items=>[...new Set(items)].join(' | ');
export function reportData(raw,{filtered=false,filters={},sort='recent',invoiceSearch=''}={}){
  const sites=new Map(raw.sites.map(s=>[s.id,s])),blocks=new Map(raw.blocks.map(b=>[b.id,b])),invoices=new Map(raw.invoices.map(i=>[i.id,i]));
  const links=new Map(raw.invoice_materials.map(l=>[l.material_id,l]));
  const searchInvoices=new Set();
  if(invoiceSearch){const query=invoiceSearch.toLocaleLowerCase('pt-BR');for(const nf of invoices.values())if([nf.number,nf.access_key].some(v=>text(v).toLocaleLowerCase('pt-BR').includes(query)))searchInvoices.add(nf.id);for(const m of raw.materials)if([m.sap_code,m.forms_code,m.description].some(v=>text(v).toLocaleLowerCase('pt-BR').includes(query)))searchInvoices.add(links.get(m.id)?.invoice_id);}
  let materials=[...new Map(raw.materials.map(m=>[m.id,m])).values()].map(m=>{
    const link=links.get(m.id),nf=invoices.get(link?.invoice_id),site=sites.get(m.site_id);
    return {...m,site_name:site?.name||'',block_name:blocks.get(m.block_id)?.name||'',invoice_id:nf?.id||null,invoice_number:nf?.number||'',site,invoice:nf,link};
  });
  if(filtered)materials=materials.filter(m=>matches(m,filters,raw.sites)&&(!invoiceSearch||Boolean(m.invoice_id)&&searchInvoices.has(m.invoice_id)));
  materials=sortMaterials(materials,sort);
  const selected=new Set(materials.map(m=>m.invoice_id).filter(Boolean));
  const members=new Map();for(const m of materials){if(!members.has(m.invoice_id))members.set(m.invoice_id,[]);members.get(m.invoice_id).push(m);}
  const notes=[...invoices.values()].filter(i=>!filtered||selected.has(i.id)).map(i=>({...i,items:members.get(i.id)||[]}));
  return {materials,notes};
}
export async function buildWorkbook(raw,options={}){
  const ExcelJS=(await import('exceljs')).default;
  const book=new ExcelJS.Workbook();book.creator='NotaFlow';book.created=options.now||new Date();
  const {materials,notes}=reportData(raw,options);
  const total=items=>items.reduce((sum,m)=>sum+itemTotal(m),0);
  const originalById=new Map(raw.materials.map(m=>[m.id,m]));
  const invoiceByMaterial=new Map(raw.invoice_materials.map(l=>[l.material_id,l.invoice_id]));
  const invoiceTotals=new Map();
  for(const m of originalById.values()){const nf=invoiceByMaterial.get(m.id);if(nf)invoiceTotals.set(nf,(invoiceTotals.get(nf)||0)+itemTotal(m));}
  const stamp=book.created.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  function sheet(name,columns,values){
    const ws=book.addWorksheet(name,{views:[{state:'frozen',ySplit:4}],properties:{defaultRowHeight:24}});
    ws.columns=columns.map(([header,width=24,type='text'])=>({width,style:{numFmt:type==='money'?'"R$" #,##0.00':type==='number'?'#,##0.###':type==='date'?'dd/mm/yyyy':type==='datetime'?'dd/mm/yyyy hh:mm':'@'}}));
    ws.mergeCells(1,1,1,columns.length);ws.getCell(1,1).value='NOTAFLOW — RELATÓRIO DE MATERIAIS';ws.getRow(1).height=34;
    ws.getCell(1,1).fill={type:'pattern',pattern:'solid',fgColor:{argb:navy}};ws.getCell(1,1).font={name:'Calibri',size:18,bold:true,color:{argb:'FFFFFF'}};
    ws.mergeCells(2,1,2,columns.length);ws.getCell(2,1).value=`Exportado em ${stamp} (Brasília) · ${options.filtered?'Dados filtrados':'Relatório completo'}`;
    ws.getCell(2,1).font={name:'Calibri',size:11,color:{argb:'61738E'}};
    ws.addTable({name:`Tabela${book.worksheets.length}`,ref:'A4',headerRow:true,style:{theme:'TableStyleMedium2',showRowStripes:true},columns:columns.map(([name])=>({name,filterButton:true})),rows:values});
    ws.getRow(4).height=30;
    ws.getRow(4).eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:blue}};c.font={bold:true,color:{argb:'FFFFFF'}};});
    for(let r=5;r<5+values.length;r++)ws.getRow(r).eachCell({includeEmpty:true},c=>{c.alignment={vertical:'top',wrapText:true};c.border={bottom:{style:'hair',color:{argb:'DDE5F0'}}};if(r%2===1)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:pale}};});
    ws.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};
    return ws;
  }
  const cols=[['ID material',38],['SAP',22],['Forms',22],['Descrição',55],['Processo',22],['Quantidade',16,'number'],['Valor unitário',20,'money'],['Valor total',20,'money'],['Status',20],['Observações material',50],['Site',28],['Centro físico',20],['Região',22],['Transportadora',40],['Data lançamento',22,'datetime'],['Data pedido',18,'date'],['Solicitação SAP registrada',24,'datetime'],['Última atualização',22,'datetime'],['Bloco atual',30],['ID bloco',38],['ID site',38],['Usuário responsável (ID)',38],['Número NF',24],['Chave NF-e',54],['Emissão NF',18,'date'],['Observações NF',50],['ID NF',38],['Total materiais da NF',24,'money'],['Vínculo fiscal criado',22,'datetime'],['Status anterior NF',22],['NF criada em',22,'datetime'],['NF atualizada em',22,'datetime'],['Responsável NF (ID)',38],['Dados originais material (JSON)',60],['Dados originais site (JSON)',60],['Dados originais NF (JSON)',60],['Dados originais vínculo (JSON)',60]];
  const materialRows=materials.map(m=>{
    const nf=m.invoice,s=m.site,original=originalById.get(m.id);
    return [text(m.id),text(m.sap_code),text(m.forms_code),text(m.description),PROCESS_NAMES[m.process]||text(m.process),Number(m.quantity||0),Number(m.unit_price||0),itemTotal(m),STATUS_NAMES[m.status]||text(m.status),text(m.notes),text(s?.name),text(s?.center_code),text(s?.region),text(s?.carrier_info),date(m.created_at),date(m.requested_on),date(m.sap_requested_at),date(m.updated_at),m.block_name,text(m.block_id),text(m.site_id),text(m.created_by),text(nf?.number),text(nf?.access_key),date(nf?.issued_on),text(nf?.notes),text(nf?.id),nf?invoiceTotals.get(nf.id)||0:'',date(m.link?.added_at),STATUS_NAMES[m.link?.prior_status]||text(m.link?.prior_status),date(nf?.created_at),date(nf?.updated_at),text(nf?.created_by),JSON.stringify(original),s?JSON.stringify(s):'',nf?JSON.stringify(nf):'',m.link?JSON.stringify(m.link):''];
  });
  const main=sheet('TODOS OS MATERIAIS',cols,materialRows);
  materials.forEach((m,i)=>{for(const [col,color] of [[5,m.process==='cnc'?'DDEAFF':m.process==='3d'?'DDF5E8':'EDEEF3'],[9,m.status==='concluido'?'DDF5E8':m.status==='cancelado'?'FFE4E8':m.status==='solicitado'?'FFF1D5':'E8EEFC']])main.getCell(i+5,col).fill={type:'pattern',pattern:'solid',fgColor:{argb:color}};});
  const totals=main.addRow(['TOTAL',...Array(5).fill(''),'',total(materials)]);totals.font={bold:true,color:{argb:blue}};totals.getCell(8).numFmt='"R$" #,##0.00';
  sheet('NOTAS FISCAIS',[['Número NF',24],['Chave NF-e',54],['Data emissão',18,'date'],['Qtd materiais exportados',24,'number'],['SAP',45],['Forms',45],['Sites',45],['Valor materiais exportados',26,'money'],['Observações',55],['ID NF',38],['Criada em',22,'datetime'],['Atualizada em',22,'datetime'],['Responsável (ID)',38],['IDs materiais exportados',60],['Dados originais NF (JSON)',60]],notes.map(n=>[text(n.number),text(n.access_key),date(n.issued_on),n.items.length,unique(n.items.map(m=>text(m.sap_code))),unique(n.items.map(m=>text(m.forms_code))),unique(n.items.map(m=>m.site_name)),total(n.items),text(n.notes),text(n.id),date(n.created_at),date(n.updated_at),text(n.created_by),n.items.map(m=>m.id).join(' | '),JSON.stringify(Object.fromEntries(Object.entries(n).filter(([k])=>k!=='items')))]));
  const summary=[['Total de materiais',materials.length,total(materials)],['Total de notas fiscais',notes.length,'']];
  for(const [title,key,names] of [['Processo','process',PROCESS_NAMES],['Situação','status',STATUS_NAMES]])for(const [code,label] of Object.entries(names)){const items=materials.filter(m=>m[key]===code);summary.push([`${title}: ${label}`,items.length,total(items)]);}
  for(const site of new Set(materials.map(m=>m.site_name||'Não informado'))){const items=materials.filter(m=>(m.site_name||'Não informado')===site);summary.push([`Site: ${site}`,items.length,total(items)]);}
  const dashboard=sheet('RESUMO GERAL',[['Indicador / agrupamento',58],['Quantidade',22,'number'],['Valor dos materiais',28,'money']],summary);
  dashboard.getRow(5).height=38;dashboard.getRow(5).font={size:16,bold:true,color:{argb:blue}};
  return book;
}
export async function downloadWorkbook(raw,options={}){
  const book=await buildWorkbook(raw,options),buffer=await book.xlsx.writeBuffer();
  const url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const a=document.createElement('a');a.href=url;a.download=`NotaFlow_Relatorio_${options.filtered?'Filtrado':'Completo'}_${new Date().toLocaleDateString('en-CA')}.xlsx`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
