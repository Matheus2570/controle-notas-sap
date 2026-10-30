import test from 'node:test';
import assert from 'node:assert/strict';
import {sortMaterials,matches,parseExcel,validateInvoiceSelection,itemTotal,transitionOnLink,transitionOnUnlink,toCsv} from '../src/domain.js';
const fixtures=[
 {id:'a',sap_code:'100',forms_code:'859',description:'Gabarito',quantity:2,unit_price:3,status:'solicitado',process:'cnc',site_id:'s1',requested_on:'2026-10-27',created_at:'2026-10-27T12:00:00Z',block_id:'b1'},
 {id:'b',sap_code:'200',forms_code:'860',description:'Suporte',quantity:1,unit_price:20,status:'rascunho',process:'3d',site_id:'s1',requested_on:'2026-10-29',created_at:'2026-10-29T12:00:00Z',block_id:'b2'},
 {id:'c',sap_code:'300',forms_code:'862',description:'Suporte 3D',quantity:1,unit_price:8,status:'solicitado',process:'3d',site_id:'s2',requested_on:'2026-10-28',created_at:'2026-10-28T12:00:00Z',block_id:'b1'}
];
test('ordena todos os registros antes de paginar, por valor',()=>assert.deepEqual(sortMaterials(fixtures,'value_desc').map(x=>x.id),['b','c','a']));
test('filtro pesquisa por SAP/Forms/descrição sem depender do bloco',()=>assert.deepEqual(fixtures.filter(m=>matches(m,{search:'862',process:'3d'},[])).map(x=>x.id),['c']));
test('status é dado individual de cada material e blocos são identificados por ID',()=>{const edited=fixtures.map(m=>m.block_id==='b1'?{...m,status:'concluido'}:m);assert.equal(edited[1].status,'rascunho');assert.deepEqual(edited.filter(x=>x.status==='concluido').map(x=>x.id),['a','c']);});
test('link de nota e exclusão restauram o status original',()=>{const linked=transitionOnLink(fixtures[0]);assert.equal(linked.status,'nota_recebida');assert.equal(transitionOnUnlink(linked).status,'solicitado');});
test('impede quinta linha e material com outra nota',()=>{assert.throws(()=>validateInvoiceSelection(['a','b','c','d','e'],fixtures),/1 a 4/);assert.throws(()=>validateInvoiceSelection(['a'],[{...fixtures[0],invoice_id:'nf1'}],'nf2'),/outra nota/);});
test('importação por colagem tabulada mantém preço brasileiro',()=>{const [a]=parseExcel('100\t859\tPeça\tcnc\t2\t45,90');assert.equal(a.unit_price,45.9);assert.equal(itemTotal(a),91.8);});
test('CSV inclui Forms e SAP',()=>{const csv=toCsv([fixtures[0]]);assert.match(csv,/859/);assert.match(csv,/100/);});
test('nota só aceita materiais previamente solicitados no SAP',()=>{
 assert.throws(()=>validateInvoiceSelection(['b'],fixtures),/Solicite o material/);
 assert.deepEqual(validateInvoiceSelection(['a','c'],fixtures),['a','c']);
});
test('filtro por valor total, faixa e ordenação de SAP, Forms e preço',()=>{
 assert.deepEqual(fixtures.filter(m=>matches(m,{min_value:'7',max_value:'20'},[])).map(m=>m.id),['b','c']);
 assert.deepEqual(sortMaterials(fixtures,'unit_desc').map(m=>m.id),['b','c','a']);
 assert.deepEqual(sortMaterials(fixtures,'forms').map(m=>m.id),['a','b','c']);
 assert.deepEqual(sortMaterials(fixtures,'quantity_desc').map(m=>m.id),['a','b','c']);
});
