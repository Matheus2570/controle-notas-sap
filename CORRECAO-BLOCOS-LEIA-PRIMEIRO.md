# Correção dos blocos temporários do NotaFlow

Para atualizar seu banco existente, execute **somente** [`supabase/CORRIGIR_BLOCOS_TEMPORARIOS.sql`](supabase/CORRIGIR_BLOCOS_TEMPORARIOS.sql) no SQL Editor do projeto Supabase correto. Faça isso antes de publicar o novo React. O SQL não é executado automaticamente pelo aplicativo nem pelo build.

Não execute `BANCO.sql` nem o script de reset para atualizar a instalação atual. `BANCO.sql` foi sincronizado com a correção para futuras instalações novas.

## Causa encontrada

No SQL anterior, o gatilho `nf_autogroup_after_insert` executava `nf_autogroup_materials()` após qualquer INSERT. Essa função selecionava **todos** os materiais com `block_id IS NULL`, sem excluir materiais com NF, concluídos ou cancelados. Excluir um bloco apenas deixava seus materiais sem bloco; no cadastro seguinte, a varredura os agrupava novamente.

O modo demonstração repetia a mesma lógica em `saveRow()` e `groupUnassignedDemo()`. A numeração dependia de `max(position)+1`, misturando nome e ordem. O cabeçalho da interface também mostrava uma numeração calculada pela posição, que podia divergir do nome salvo.

Foram analisadas as funções, gatilhos, FKs e políticas presentes em `supabase/BANCO.sql`, além das telas, store, domínio, estilos, testes e configuração do projeto. As definições do servidor remoto não foram consultadas nem alteradas nesta entrega.

Se quiser conferir as definições efetivamente instaladas antes de migrar, estas consultas são somente leitura:

```sql
select pg_get_functiondef('public.nf_autogroup_materials()'::regprocedure);
select pg_get_functiondef('public.nf_autogroup_on_insert()'::regprocedure);
select tgname, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid = 'public.nf_materials'::regclass and not tgisinternal;
```

## Regras após a correção

- O gatilho usa `REFERENCING NEW TABLE` para receber somente os IDs inseridos naquela operação. Funciona também com lotes e não trata um UPSERT que apenas atualiza como material novo. O núcleo `nf_group_materials(ids)` sempre exige uma lista explícita de IDs. [Referência PostgreSQL](https://www.postgresql.org/docs/current/sql-createtrigger.html).
- O cadastro organiza automaticamente somente materiais novos sem bloco, em **A pedir** ou **Pedido**, sem vínculo em `nf_invoice_materials`. Materiais com NF, **Nota recebida**, **Concluído** ou **Cancelado** ficam fora.
- O preenchimento automático mantém site, processo e etapa iguais e respeita quatro materiais. Não usa blocos manuais, renomeados, mistos ou com materiais faturados. Não move materiais que já estavam alocados.
- O campo **Bloco** diferencia **Organizar automaticamente** de **Sem bloco**, tanto no cadastro quanto na importação. A escolha Sem bloco é respeitada desde o primeiro salvamento.
- Retirar materiais, excluir ou encerrar um bloco não provoca agrupamento futuro. O botão **Organizar sem bloco** é uma decisão manual: nesse momento ele pode agrupar novamente materiais abertos que você havia separado. Continua excluindo os faturados, concluídos e cancelados.
- Os nomes automáticos usam o primeiro número livre entre os blocos existentes. Nomes legados como `BLOCO 001 — CNC` também reservam o número 001. A posição não determina o número. Sem blocos existentes, o próximo nome é `BLOCO 001`.
- Nenhum bloco existente é renomeado pela atualização. Ao editar um nome, o bloco passa a ser manual e a automação deixa de preenchê-lo. Os controles de ordem salvam a posição dos blocos dentro de cada etapa, sem reconstruir seus nomes.
- Movimentações manuais permitem CNC, 3D e outros processos no mesmo bloco. A etiqueta **Misto** é calculada pelo conteúdo, sem substituir o nome. O limite é validado na interface de dados e no banco, inclusive em acesso direto pela API.

## Encerrar ou excluir um bloco

As duas ações pedem confirmação e usam o mesmo encerramento transacional. `nf_close_block(id)` desvincula `block_id` dos materiais e remove somente a linha correspondente em `nf_blocks`. Não altera status, SAP, Forms, dados fiscais, notas ou vínculos fiscais. Os gatilhos existentes continuam registrando a alteração no histórico.

Materiais faturados e concluídos aparecem em **Notas recebidas**, uma consulta filtrada por materiais, sem criar nenhum bloco físico. A tabela mostra SAP, Forms, descrição, processo, site, número da NF, data e status. Agrupamentos já inteiramente recebidos aparecem nessa área com a opção de encerrar. Blocos parcialmente faturados continuam nas etapas de trabalho e informam quantos itens já têm nota.

As telas Lançamentos, Notas fiscais e Consulta SAP / Forms continuam lendo os materiais pelos próprios IDs. Seus filtros e ordenações foram mantidos. A nota continua consultável e editável mesmo depois de encerrar o bloco. No modo demonstração, operações novas também preservam as atividades antigas além dos 1.000 eventos; a tela continua carregando somente os 150 mais recentes.

## O que o SQL modifica

Adiciona a coluna `nf_materials.auto_group_on_insert` e atualiza apenas funções e gatilhos de blocos. Inclui RPCs de encerramento e ordem, validação de nomes automáticos e o núcleo de agrupamento por IDs.

Não reorganiza nenhum registro no momento da migração. Não remove materiais, notas, vínculos, sites ou atividades. Não altera usuários, perfis ou políticas RLS. As funções expostas usam `SECURITY INVOKER`, respeitam as políticas existentes e verificam o administrador; suas permissões de execução ficam restritas ao papel autenticado, como nos RPCs anteriores. A capacidade de quatro e o RPC de movimentação existentes permanecem ativos.

## Como testar antes de publicar na Vercel

1. Execute `npm ci`, `npm test` e `npm run build`. No PowerShell com scripts bloqueados, use `npm.cmd` no lugar de `npm`.
2. Execute `npm run test:e2e` para repetir o fluxo completo no navegador, em desktop e celular. Os testes forçam modo demonstração, usam contextos de navegador isolados e não utilizam as credenciais do `.env.local`. No Windows usam o Edge instalado; em outros sistemas instale o navegador de testes com `npx playwright install chromium`.
3. Para testar manualmente sem nuvem no PowerShell, abra um terminal e execute:

   ```powershell
   $env:VITE_SUPABASE_URL=''
   $env:VITE_SUPABASE_ANON_KEY=''
   npm.cmd run dev
   ```

   Cadastre um site de teste. Feche esse terminal ao terminar, para restaurar as variáveis originais em outros terminais.
4. Em um projeto Supabase de homologação com a estrutura atual, aplique a migração incremental e teste com contas separadas de administrador e visualizador. Não use o reset no banco que contém seus dados.
5. Repita os oito cenários abaixo e confirme a NF na tela Notas fiscais depois do encerramento. Só depois aplique a mesma migração no projeto de produção e publique o código na Vercel com suas variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` habituais.

| Cenário | Resultado esperado |
| --- | --- |
| Cadastrar 4 CNC e 1 3D | Dois grupos por processo, até quatro por grupo. |
| Excluir um bloco e cadastrar outro material | Os materiais antigos continuam sem bloco; somente o novo é organizado. Um número livre pode ser reutilizado por um novo ID. |
| Remover manualmente ou escolher Sem bloco no cadastro | Permanecem sem bloco após novos cadastros e recargas, até ação manual. |
| Registrar NF e encerrar o bloco | Material e nota mantêm seus IDs, vínculos e status; apenas o agrupamento desaparece. |
| Cadastrar novos itens depois de faturar | Os faturados e concluídos não são reorganizados, inclusive pelo botão manual. |
| Excluir todos os blocos e cadastrar outro | Novo agrupamento com nome BLOCO 001, sem renomear materiais ou restaurar blocos antigos. |
| Renomear para Misto — Pt2 e misturar CNC/3D | Nome preservado; etiqueta Misto; quinta entrada rejeitada sem movimentação parcial. |
| Recarregar e acessar pelo celular | Mesmos nomes, ordem, conteúdos, notas e seções; sem rolagem horizontal da página Blocos. |

Os testes automatizados executam o SQL em PostgreSQL local em memória (PGlite), incluindo RLS admin/viewer, integridade das NFs, reaplicação da migração e preservação de todas as tabelas de negócio. Essa execução não substitui a validação das configurações específicas de seu Supabase de homologação.

## Arquivos da entrega

- `src/App.jsx`, `src/store.js`, `src/domain.js`, `src/styles.css`: fluxo, regras e apresentação.
- `supabase/CORRIGIR_BLOCOS_TEMPORARIOS.sql`: migração para sua instalação existente.
- `supabase/BANCO.sql`: mesmas regras para instalações novas.
- `tests/blocks-demo.test.mjs`, `tests/blocks-postgres.test.mjs`, `tests/e2e/blocks.spec.mjs`, `playwright.config.js`: testes locais e de navegador.
- `tests/integration-v25.test.mjs`: mantém os testes de histórico e armazenamento, agora apontando para o SQL consolidado que existe no repositório.
- `package.json`, `package-lock.json`, `.github/workflows/build.yml`, `.gitignore`: dependências de teste, comando de navegador, verificações de CI e exclusão de artefatos temporários.
- `README.md` e este documento: instruções atualizadas.
