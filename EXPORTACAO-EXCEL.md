# Chave NF-e e relatório Excel

Este complemento mantém a correção dos blocos temporários. Não exige SQL adicional, não altera dados ou permissões e não executa gravações durante a exportação.

O campo da chave remove separadores antes de validar os 44 dígitos. O limite HTML de caracteres foi retirado: espaços colados não cortam os últimos dígitos. A chave permanece string, inclusive quando começa com zero. Chaves com quantidade inválida de dígitos não são salvas. As chaves já armazenadas não são reescritas.

Em Lançamentos, Consulta SAP / Forms e Notas fiscais, clique em **Exportar Excel**:

- **Completo** lê todos os materiais e notas acessíveis ao usuário, independentemente dos filtros ou página atual.
- **Filtrado** reaplica os filtros da tela sobre todos os materiais lidos. Na tela de notas, também respeita a pesquisa por número, chave e materiais da NF. Na aba fiscal, quantidades e valores são relativos aos materiais exportados; a coluna de total da NF na aba principal mantém o contexto completo dos materiais acessíveis daquela NF.

As consultas usam a sessão normal do Supabase, respeitam RLS e percorrem páginas de 750 registros, com ordenação estável por ID, até o fim. O relatório é gerado no navegador com ExcelJS carregado sob demanda. O CSV continua disponível.

O arquivo contém **TODOS OS MATERIAIS**, **NOTAS FISCAIS** e **RESUMO GERAL**, com tabelas filtráveis, linhas alternadas, cabeçalho congelado, cores por processo/status, quebra de linha, datas brasileiras e valores em reais. SAP, Forms, número, chave e IDs são strings em células de texto; textos que começam por `=` continuam strings, sem fórmula. Quantidades e valores são números.

Os vínculos são obtidos de `nf_invoice_materials.material_id`, sem depender de blocos. As colunas finais com JSON preservam os demais atributos originais acessíveis de material, site, NF e vínculo. Responsáveis aparecem pelo ID real disponível; não são inventados nomes de usuários. A data específica de solicitação SAP fica vazia quando não há `sap_requested_at`; ela não é deduzida do status ou da última atualização.

Execute `npm test`, `npm run test:e2e` e `npm run build`. Os testes de planilha geram e reabrem o binário XLSX e verificam tipos, totais, filtros em 125 materiais e relatório vazio. Os testes de navegador colam uma chave formatada iniciada por zero, salvam a NF, encerram o bloco, baixam e reabrem o relatório em desktop e celular simulado. A abertura manual no Microsoft Excel deve ser conferida no computador do usuário; o teste automatizado usa o leitor ExcelJS.

Arquivos deste complemento: `src/App.jsx`, `src/store.js`, `src/excel.js`, `package.json`, `package-lock.json`, `tests/excel.test.mjs`, `tests/e2e/blocks.spec.mjs`, este documento e `README.md`. Os demais arquivos modificados no workspace pertencem à correção anterior dos blocos.
