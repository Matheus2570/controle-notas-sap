import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {buildWorkbook,reportData} from '../src/excel.js';
const key='05261101615814006215550010002120271079311173';
const raw={sites:[{id:'s',name:'Fábrica',center_code:'001',region:'Sul',carrier_info:'Transportadora'}],blocks:[],materials:Array.from({length:125},(_,i)=>({id:`m${i}`,sap_code:`00${i}`,forms_code:`000${i}`,description:i===0?'=HYPERLINK("bad")':'Peça completa',process:i%2?'cnc':'3d',status:['rascunho','solicitado','nota_recebida','concluido','cancelado'][i%5],quantity:2,unit_price:10,site_id:'s',requested_on:'2026-11-11',created_at:'2026-11-11T15:30:00Z',block_id:null})),invoices:[{id:'nf',number:'000123',access_key:key,issued_on:'2026-11-11',notes:'Preservar'}],invoice_materials:[{material_id:'m2',invoice_id:'nf'},{material_id:'m3',invoice_id:'nf'}]};
test('XLSX real: todos os status, materiais sem NF, IDs únicos e NF sem bloco',async()=>{
 const before=structuredClone(raw);const book=await buildWorkbook(raw,{sort:'sap'});const buffer=await book.xlsx.writeBuffer();assert.equal(buffer[0],80);assert.equal(buffer[1],75);
 const parsed=new ExcelJS.Workbook();await parsed.xlsx.load(buffer);assert.equal(parsed.worksheets.length,3);
 const sheet=parsed.getWorksheet('TODOS OS MATERIAIS');assert.equal(sheet.rowCount,130);assert.equal(sheet.getCell('B5').value,'000');assert.equal(sheet.getCell('B5').numFmt,'@');assert.equal(sheet.getCell('D5').type,ExcelJS.ValueType.String);
 assert.equal(sheet.getCell('X7').value,key);assert.equal(sheet.getCell('X7').type,ExcelJS.ValueType.String);assert.equal(sheet.getCell('W7').value,'000123');assert.equal(sheet.getCell('W5').value,'');
 assert.equal(sheet.getCell('H5').type,ExcelJS.ValueType.Number);assert.equal(sheet.getCell('P5').numFmt,'dd/mm/yyyy');assert.ok(sheet.getCell('P5').value instanceof Date);assert.equal(sheet.views[0].ySplit,4);
 assert.equal(parsed.getWorksheet('NOTAS FISCAIS').rowCount,5);assert.equal(parsed.getWorksheet('NOTAS FISCAIS').getCell('H5').value,40);
 assert.equal(parsed.getWorksheet('RESUMO GERAL').getCell('C5').value,2500);assert.deepEqual(raw,before);
});
test('filtros atuam em todos os 125 materiais e totais fiscais refletem somente os exportados',async()=>{
 const data=reportData(raw,{filtered:true,filters:{status:'nota_recebida',process:'3d'}});assert.equal(data.materials.length,13);assert.ok(data.materials.some(m=>m.id==='m122'));
 const book=await buildWorkbook(raw,{filtered:true,filters:{search:'002'}});assert.equal(book.getWorksheet('NOTAS FISCAIS').getCell('D5').value,1);assert.equal(book.getWorksheet('NOTAS FISCAIS').getCell('H5').value,20);
});
test('exportação filtrada vazia gera arquivo XLSX legível',async()=>{const book=await buildWorkbook(raw,{filtered:true,filters:{search:'inexistente'}});const parsed=new ExcelJS.Workbook();await parsed.xlsx.load(await book.xlsx.writeBuffer());assert.equal(parsed.getWorksheet('RESUMO GERAL').getCell('B5').value,0);});
