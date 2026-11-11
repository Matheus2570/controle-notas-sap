import {test,expect} from '@playwright/test';

const storageKey='notaflow-v2-demo-v1';
const state=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);
async function navigate(page,name){
  const menu=page.getByRole('button',{name:'Abrir menu',exact:true});
  if(await menu.isVisible())await menu.click();
  await page.locator('nav').getByRole('button',{name,exact:true}).click();
}
async function create(page,description,process='cnc',separate=false){
  await navigate(page,'Lançamentos');await page.getByRole('button',{name:'Novo material',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Novo lançamento'});
  await dialog.getByLabel('Código SAP',{exact:true}).fill(`SAP-${description}`);
  await dialog.getByLabel('Número do Forms',{exact:true}).fill(`F-${description}`);
  await dialog.getByLabel('Descrição do material',{exact:true}).fill(description);
  await dialog.getByRole('combobox',{name:'Processo',exact:true}).selectOption(process);
  if(separate)await dialog.getByRole('combobox',{name:/^Bloco/}).selectOption('');
  await dialog.getByRole('button',{name:'Salvar material',exact:true}).click();await expect(dialog).toBeHidden();
}
async function seedSite(page){
  await page.goto('/');await expect(page.getByText('Modo demonstração',{exact:true})).toBeAttached();
  await page.evaluate(async()=>{
    const store=await import('/src/store.js');if(store.cloud)throw new Error('Testes exigem modo demonstração');
    await store.saveRow('sites',{name:'Site de teste',center_code:'1000'});
  });await page.reload();
}

test('blocos temporários: agrupar, misturar, faturar, encerrar e recarregar preservam os dados',async({page},testInfo)=>{
  test.setTimeout(60000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await seedSite(page);await navigate(page,'Lançamentos');
  await page.getByRole('button',{name:'Colar do Excel'}).click();const importer=page.getByRole('dialog',{name:'Importar materiais do Excel'});
  await importer.locator('.paste-area').fill([
    ...Array.from({length:4},(_,i)=>`${100+i}\t${800+i}\tPeça CNC ${i+1}\tcnc\t1\t25,00`),
    '200\t900\tPeça 3D\t3d\t1\t30,00'
  ].join('\n'));
  await importer.getByRole('button',{name:'Conferir dados'}).click();await importer.getByRole('button',{name:'Importar 5 materiais'}).click();await expect(importer).toBeHidden();
  await navigate(page,'Blocos');
  const cnc=page.getByRole('region',{name:'BLOCO 001',exact:true});const threeD=page.getByRole('region',{name:'BLOCO 002',exact:true});
  await expect(cnc.locator('.block-item')).toHaveCount(4);await expect(threeD.locator('.block-item')).toHaveCount(1);
  await threeD.getByTitle('Renomear bloco',{exact:true}).click();const rename=page.getByRole('dialog',{name:'Editar bloco'});
  await rename.getByLabel('Nome do bloco').fill('Misto — Pt2');await rename.getByRole('button',{name:'Salvar bloco'}).click();await expect(rename).toBeHidden();
  const mixed=page.getByRole('region',{name:'Misto — Pt2',exact:true});
  await mixed.getByTitle('Mover bloco para cima',{exact:true}).click();
  await expect(page.getByRole('region',{name:'Blocos ativos aguardando solicitação',exact:true}).locator('h3')).toHaveText(['Misto — Pt2','BLOCO 001']);
  await page.reload();await navigate(page,'Blocos');
  await expect(page.getByRole('region',{name:'Blocos ativos aguardando solicitação',exact:true}).locator('h3')).toHaveText(['Misto — Pt2','BLOCO 001']);
  const mixedId=(await state(page)).blocks.find(b=>b.name==='Misto — Pt2').id;
  for(let i=1;i<=3;i++)await cnc.getByRole('checkbox',{name:`Selecionar Peça CNC ${i}`,exact:true}).check();
  await page.getByLabel('Bloco de destino',{exact:true}).selectOption(mixedId);await page.getByRole('button',{name:'Mover selecionados',exact:true}).click();
  await expect(mixed.locator('.block-item')).toHaveCount(4);await expect(mixed.getByText('Misto',{exact:true})).toBeVisible();await expect(cnc.locator('.block-item')).toHaveCount(1);
  await cnc.getByRole('checkbox',{name:'Selecionar Peça CNC 4',exact:true}).check();await page.getByRole('button',{name:'Mover selecionados',exact:true}).click();
  await expect(page.locator('.toast-error')).toContainText('máximo 4 materiais');await expect(mixed.locator('.block-item')).toHaveCount(4);await page.getByRole('button',{name:'Desmarcar',exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());await mixed.getByRole('button',{name:'Solicitar no SAP (4)',exact:true}).click();
  await expect(page.getByRole('region',{name:'Blocos já solicitados no SAP',exact:true}).getByRole('region',{name:'Misto — Pt2',exact:true})).toBeVisible();
  await mixed.getByRole('button',{name:'Registrar NF deste bloco (4)',exact:true}).click();const invoice=page.getByRole('dialog',{name:'Registrar nota fiscal',exact:true});
  await expect(invoice.locator('.invoice-choice input:checked')).toHaveCount(4);
  await invoice.getByLabel('Número da nota',{exact:true}).fill('123456');await invoice.getByLabel('Chave NF-e (44 dígitos, opcional)',{exact:true}).fill(('0'+'1'.repeat(43)).match(/.{1,4}/g).join(' '));
  await expect(invoice.getByLabel('Chave NF-e (44 dígitos, opcional)',{exact:true})).toHaveValue('0'+'1'.repeat(43));
  await invoice.getByRole('button',{name:'Salvar NF e marcar Nota recebida',exact:true}).click();await expect(invoice).toBeHidden();
  const received=page.getByRole('region',{name:'Notas recebidas',exact:true});await expect(received.locator('tbody tr')).toHaveCount(4);
  const before=await state(page);expect(before.invoices[0].access_key).toBe('0'+'1'.repeat(43));
  page.once('dialog',dialog=>dialog.dismiss());await mixed.getByRole('button',{name:'Encerrar bloco',exact:true}).click();await expect(mixed).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());await mixed.getByRole('button',{name:'Encerrar bloco',exact:true}).click();await expect(mixed).toHaveCount(0);
  await expect(received.locator('tbody tr')).toHaveCount(4);let after=await state(page);
  expect(after.invoices).toEqual(before.invoices);expect(after.invoice_materials).toEqual(before.invoice_materials);
  expect(after.materials.filter(m=>m.status==='nota_recebida').every(m=>!m.block_id)).toBeTruthy();
  await create(page,'Novo CNC');await navigate(page,'Blocos');await expect(cnc.locator('.block-item')).toHaveCount(2);
  page.once('dialog',dialog=>dialog.accept());await cnc.getByTitle('Excluir bloco (preservar materiais e notas)',{exact:true}).click();await expect(cnc).toHaveCount(0);
  await create(page,'Novo 3D','3d');await create(page,'Separado','cnc',true);await navigate(page,'Blocos');
  await expect(page.getByRole('region',{name:'BLOCO 001',exact:true}).locator('.block-item')).toHaveCount(1);
  const unassigned=page.getByRole('region',{name:'Sem bloco',exact:true});await expect(unassigned.locator('.block-item')).toHaveCount(3);
  await page.reload();await navigate(page,'Blocos');await expect(unassigned.locator('.block-item')).toHaveCount(3);await expect(received.locator('tbody tr')).toHaveCount(4);
  await page.getByRole('button',{name:'Organizar sem bloco',exact:true}).click();await expect(unassigned.locator('.block-item')).toHaveCount(0);await expect(received.locator('tbody tr')).toHaveCount(4);
  after=await state(page);expect(after.invoice_materials).toEqual(before.invoice_materials);expect(after.invoices).toEqual(before.invoices);
  expect(after.materials.filter(m=>m.status==='nota_recebida').every(m=>!m.block_id)).toBeTruthy();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:`test-results/blocos-${testInfo.project.name}.png`,fullPage:true});
  await navigate(page,'Notas fiscais');await expect(page.getByRole('heading',{name:'NF 123456',exact:true})).toBeVisible();await expect(page.locator('.invoice-tag')).toHaveCount(4);
  await page.getByRole('button',{name:'Editar nota',exact:true}).click();const existingInvoice=page.getByRole('dialog',{name:'Editar nota fiscal',exact:true});
  await expect(existingInvoice.locator('.invoice-choice input:checked')).toHaveCount(4);await expect(existingInvoice.getByLabel('Número da nota',{exact:true})).toHaveValue('123456');
  await existingInvoice.getByRole('button',{name:'Cancelar',exact:true}).click();
  await navigate(page,'Lançamentos');await page.getByRole('combobox',{name:'Filtrar situação',exact:true}).selectOption('nota_recebida');await expect(page.locator('tbody tr')).toHaveCount(4);
  await navigate(page,'Consulta SAP / Forms');await expect(page.locator('tbody tr')).toHaveCount(4);
  await page.getByRole('button',{name:'Exportar Excel',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Exportar Excel completo',exact:true}).click();
  const download=await downloadPromise;expect(download.suggestedFilename()).toMatch(/NotaFlow_Relatorio_Completo_.*\.xlsx$/);
  const ExcelJS=(await import('exceljs')).default;const report=new ExcelJS.Workbook();await report.xlsx.readFile(await download.path());
  expect(report.getWorksheet('TODOS OS MATERIAIS').rowCount).toBe(after.materials.length+5);
  expect(report.getWorksheet('NOTAS FISCAIS').getCell('B5').value).toBe('0'+'1'.repeat(43));
  expect(errors).toEqual([]);
});
