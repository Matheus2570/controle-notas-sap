# NotaFlow — Controle Profissional de Pedidos de Nota SAP

Sistema web em **React + Vite + Supabase PostgreSQL**, com consultas rápidas por **SAP, Forms, site, período e status**.

## v1.3 — Registro de notas fiscais e vínculo automático com materiais

| Função | Administrador (você) | Visualizador |
|---|---|---|
| Consultar SAP/Forms, sites, datas e histórico | ✅ | ✅ |
| Filtrar e exportar dados | ✅ | ✅ |
| Criar/editar/excluir pedidos e seus itens | ✅ | ❌ |
| Mudar status do pedido | ✅ | ❌ |
| Registrar/editar número, chave de acesso e data da NF | ✅ | ❌ |
| Vincular até quatro materiais por nota, com valores preenchidos automaticamente | ✅ | ❌ |
| Consultar/copiar a chave da NF e ver histórico fiscal | ✅ | ✅ |
| Editar/gerenciar sites e centros | ✅ | ❌ |
| Alterar nome, textos e cor do site | ✅ | ❌ |
| Alterar o código-fonte do aplicativo | No VS Code / repositório, fora do sistema | ❌ |

**Segurança:** a permissão não depende apenas de esconder botões. O banco Supabase aplica políticas de **Row Level Security (RLS)** para impedir alterações via API por contas `viewer`. Os papéis ficam na tabela `app_users`; não há como se tornar admin alterando JavaScript do navegador. A configuração visual fica em `app_config` e só pode ser atualizada por admin. O salvamento de um pedido e de todos os seus materiais é feito por uma única função transacional do PostgreSQL. O registro de uma nota fiscal também é transacional: número, chave de acesso e até quatro vínculos de materiais são gravados juntos. O banco bloqueia a reutilização do mesmo material em outra nota e impede alterar dados fiscais de materiais já vinculados. Trilhas de auditoria guardam alterações dos pedidos, materiais e notas.

**Demonstração:** o botão **Testar visualizador** no topo permite pré-visualizar a experiência de leitura. Isso é apenas uma simulação local; a segurança real só existe após configurar o Supabase.

**Personalização sem programar:** admin > **Aparência do site** > editar nome, subtítulo, título inicial, descrição e cor > **Salvar visual do site**. Todos os usuários conectados verão o resultado após atualizar a página. O editor visual **não é um editor de código-fonte tipo VS Code**. Para alterar componentes, arquitetura ou layout avançado, edite `src/App.jsx` e `src/styles.css` pelo VS Code e publique com GitHub.

### Como configurar as duas contas no Supabase

1. Projeto novo: execute `supabase/schema.sql` (já inclui a versão 1.3). Banco existente: execute `supabase/roles_upgrade.sql` se ainda não aplicou a atualização de permissões da v1.2 e depois execute `supabase/invoice_workflow.sql` para adicionar notas fiscais.
2. Vá em **Supabase → Authentication → Users** e crie/convoque sua conta e a conta do(s) visualizador(es). Desative o cadastro público em **Authentication**.
3. No **SQL Editor** (não no código React), execute o comando abaixo **substituindo o endereço pelo e-mail da sua conta**:

   ```sql
   update public.app_users
   set role = 'admin'
   where user_id = (
     select id from auth.users where email = 'SEU-EMAIL@EXEMPLO.COM'
   );
   ```

4. Confira os papéis no SQL Editor:

   ```sql
   select email, role from public.app_users order by email;
   ```

5. A sua conta deve estar `admin`; a segunda conta e as próximas contas ficam automaticamente como `viewer` (somente leitura).
6. Teste **com duas sessões separadas** (por exemplo, janela anônima): admin altera um pedido, visualizador consulta; visualizador não tem botões de edição. **Teste também a proibição no banco**: como visualizador, uma tentativa de `update` pela API não deve alterar registros. Não compartilhe a senha do administrador.

**Importante:** contas de Auth são criadas pelo painel Supabase (ou um backend seguro), não diretamente pelo frontend. A chave `service_role` nunca deve ser copiada para o site.

## O que já está implementado

- **Visão geral** com quantidade de pedidos, itens, pedidos em aberto, valores e distribuição por site.
- **Lançamentos em formato de planilha**, com pesquisa, filtros e paginação (40 itens por página, inclusive com base volumosa).
- **Pedido por dia e site**, contendo vários itens. Cada item tem SAP, Forms, descrição, processo (3D/CNC/outro), quantidade, valor unitário e total calculado automaticamente.
- **Fluxo de status**: A pedir → Pedido → Nota recebida → Concluído (ou Cancelado). O status fica no pedido e se aplica aos itens desse pedido.
- **Consulta reversa**: buscar um SAP mostra todos os Forms correspondentes e os pedidos em que apareceu. Não pressupõe relação única entre SAP e Forms. Na tela de consulta, use **Copiar Forms** para copiar os Forms únicos de todos os resultados filtrados (não só da página atual).
- **Histórico completo de atividades** para pedidos e materiais: criação, edição, mudança de situação e exclusão, com data, hora e e-mail do usuário quando disponível. A trilha de auditoria sobrevive à exclusão do pedido.
- **Salvamento transacional** de pedido e materiais, para evitar pedidos parcialmente gravados quando ocorre um erro.
- **Aviso de possíveis duplicidades** de SAP/Forms dentro do mesmo pedido, sem bloquear situações legítimas.
- Tabelas navegáveis por teclado, mensagens de erro mais claras e validação de dados no banco.
- **Tela Notas fiscais:** selecione no máximo quatro materiais sem nota e informe o número da NF e a chave de acesso de 44 dígitos; a data de emissão já vem preenchida automaticamente e pode ser ajustada. SAP, Forms, site, dia do pedido, quantidade, valor unitário e total vêm dos lançamentos; o total da nota é calculado.
- **Vínculos fiscais seguros:** um material só pode pertencer a uma nota por vez; materiais faturados ficam protegidos contra alteração ou exclusão acidental. Quando todos os materiais de um pedido têm nota, o status avança automaticamente para “Nota recebida”.
- **Cadastro de sites**, centro físico, transportadora e região; editável na interface.
- **Importação por copiar e colar do Excel** para lançar vários materiais de uma só vez.
- **Exportação CSV** das linhas filtradas, com separador `;` e codificação UTF-8 compatível com Excel em português.
- **Login com e-mail e senha**, papéis `admin` e `viewer`, políticas RLS em todas as tabelas e consultas paginadas no banco.
- **Modo demonstração** com dados fictícios no armazenamento do navegador, disponível quando as variáveis do Supabase não estão configuradas.
- Layout adaptado para computador e celular.

## Como testar no seu computador (sem banco)

1. Instale [Node.js](https://nodejs.org/) versão 20.19+ ou 22.12+.
2. Abra a pasta do projeto no VS Code.
3. Abra o terminal e execute:

   ```bash
   npm install
   npm run dev
   ```

4. Acesse o endereço indicado pelo Vite (geralmente `http://localhost:5173`).
5. Você verá **Modo demonstração**. Os dados fictícios são salvos no **localStorage deste navegador**, não são compartilhados e não substituem o banco real.

## Como ativar o banco online (Supabase Free)

1. Em <https://supabase.com>, crie uma conta e um projeto, selecionando uma senha forte para o banco. Guarde os dados de acesso em local seguro.
2. No painel do projeto, entre em **SQL Editor** → **New query**.
3. Copie **todo o conteúdo** de `supabase/schema.sql`, cole no SQL Editor e execute com **Run**.
4. Confira se as tabelas foram criadas em **Table Editor**: `sites`, `requests`, `request_items`, `status_history`, `request_activity`, `app_users`, `app_config`, `invoices`, `invoice_items` e `invoice_activity`.
5. Vá a **Authentication → Users** e crie a conta **do administrador e do visualizador** (o painel pode mostrar *Add user* ou *Invite user*, conforme a versão). Confirme os e-mails, se exigido. Execute o SQL de promoção do administrador conforme o passo a passo desta seção.
6. **Essencial:** em **Authentication → Settings / General / Providers**, DESATIVE **Allow new users to sign up** (permitir novos cadastros). O app foi pensado para usuários cadastrados manualmente. **Contas viewer somente consultam; somente contas admin editam**, conforme as políticas RLS.
7. Em **Project Settings → API / API Keys**, copie a **Project URL** e a **publishable key** (ou chave `anon` legada).
8. Na raiz da pasta, crie um arquivo `.env` com:

   ```env
   VITE_SUPABASE_URL=https://seu-projeto.supabase.co
   VITE_SUPABASE_ANON_KEY=sua-chave-publica-publishable-ou-anon
   ```

9. Reinicie o `npm run dev`. O login aparecerá e os registros serão guardados no banco online.

**ATENÇÃO:** a chave do frontend precisa ser a **publishable/anon**. **NUNCA** use a chave `service_role`, `secret` ou a senha do banco em variáveis `VITE_` — esse conteúdo fica exposto no código do navegador. O acesso é protegido pelo Supabase Auth e pelas políticas RLS (Row Level Security) definidas no SQL.

## Como publicar gratuitamente — opção preferida para avaliar uso profissional

### Cloudflare Pages + Supabase

1. Crie um **repositório privado no GitHub** e envie todos os arquivos, **exceto `.env`** (já está no `.gitignore`).
2. Em <https://dash.cloudflare.com>, entre em **Workers & Pages** → **Create** → conecte seu repositório do GitHub (a interface pode variar).
3. Na configuração de build, use:
   - Framework: **Vite** (ou React/Vite).
   - Build command: **`npm run build`**.
   - Build output directory: **`dist`**.
   - Root directory: diretório-raiz deste projeto.
4. Em **Environment variables**, cadastre as mesmas duas variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com seus valores reais.
5. Faça o deploy. O endereço resultante será semelhante a `nome.pages.dev`.
6. Teste: login, criação de pedido e consulta por SAP; abra também em outra máquina/celular para validar a persistência no banco.

O arquivo `public/_redirects` permite que links internos do aplicativo funcionem ao atualizar a página no Cloudflare Pages. O arquivo `public/_headers` define cabeçalhos de segurança básicos.

### Vercel + Supabase

A mesma aplicação também é compatível com Vercel:

1. Importe o repositório em <https://vercel.com/new>.
2. Framework: **Vite**. Build: **`npm run build`**. Output: **`dist`**.
3. Configure as duas variáveis `VITE_...` em **Settings → Environment Variables** e faça o deploy.
4. **Atenção à licença de uso:** o plano **Vercel Hobby gratuito é exclusivo para uso pessoal e não comercial**, portanto pode não ser adequado a uma ferramenta de trabalho. Verifique o plano e as políticas adequados antes de usar em produção.

O arquivo `vercel.json` inclui a regra de fallback para a SPA e cabeçalhos de segurança básicos. O workflow `.github/workflows/build.yml` executa a compilação de produção quando você envia alterações ao GitHub. Consulte `SECURITY.md` antes de usar dados corporativos.

## Como copiar várias linhas do Excel

No painel, clique em **Novo pedido**, escolha site/data e clique **Colar do Excel**. Organize seu Excel com estas seis colunas na ordem abaixo:

| SAP | Forms | Descrição | Processo | Quantidade | Valor unitário |
|---|---|---|---|---:|---:|
| 10083071 | 859 | Suporte de sensor | 3D | 2 | 45,90 |
| 10122618 | 862 | Gabarito | CNC | 1 | 120,00 |

Selecione as células, copie, cole no campo de importação e clique **Adicionar linhas**. Confira e salve. É possível misturar itens 3D e CNC no mesmo pedido.

## Fluxo recomendado para registrar uma nota fiscal

1. Em **Lançamentos**, cadastre previamente os materiais com SAP, Forms, site, data do pedido, processo, quantidade e valor unitário.
2. Quando receber a nota, abra **Notas fiscais** e selecione de um a quatro materiais que aparecem nela. Use os filtros por SAP, Forms, site, data e status.
3. Clique em **Informar número e chave**. Os dados de cada material aparecem automaticamente. Preencha o número da nota e a chave NF-e de 44 dígitos. A data de emissão vem preenchida com o dia atual e pode ser ajustada; o dia do pedido, SAP, Forms, site e valores vêm dos lançamentos.
4. Salve. A nota passa a aparecer no histórico com os Forms, SAPs, sites, quantidades e valores relacionados. A chave pode ser copiada sem precisar redigitá-la.
5. Para corrigir a associação, edite a nota. Para liberar seus materiais e vinculá-los a outra nota, exclua a nota com cuidado; os lançamentos originais permanecem.

Uma mesma nota pode conter no máximo quatro materiais neste controle. A validação também ocorre no PostgreSQL, não só na tela. Materiais de pedidos cancelados não podem ser vinculados.

## Estrutura do banco

- `sites`: nome do site, centro físico, transportadora e região.
- `requests`: um pedido por lançamento, vinculado a site, data, situação e observações. O número de NF legado é mantido por compatibilidade; novas notas são registradas em `invoices`.
- `request_items`: vários itens do pedido, com códigos SAP e Forms, valores, quantidades e total calculado no PostgreSQL.
- `status_history`: histórico de situação (compatibilidade e consulta rápida).
- `request_activity`: trilha de auditoria de alterações de pedidos e materiais; sem chave estrangeira intencional para preservar eventos após exclusões.
- `invoices`: cabeçalho fiscal com número, chave de acesso de 44 dígitos, data de emissão e observações.
- `invoice_items`: relação entre uma nota fiscal e até quatro materiais já lançados; cada material pode ser associado a apenas uma nota por vez.
- `invoice_activity`: histórico de criação, edição, exclusão e alteração dos vínculos de uma nota fiscal.
- `save_invoice_with_items` / `delete_invoice`: funções PostgreSQL que validam e gravam as notas e os vínculos com proteção de permissões.
- `v_invoice_lines`: visualização dos dados fiscais e dos materiais, sem redigitação de SAP, Forms ou valores.
- `app_users`: papel de acesso do usuário. Novos usuários começam como `viewer`; promoção a `admin` apenas por SQL Editor com acesso administrativo ao projeto.
- `app_config`: textos e cor do aplicativo, configuráveis apenas pelo administrador.
- `save_request_with_items`: função PostgreSQL que salva o pedido e os itens de forma atômica, somente para admin.
- `v_request_lines`: visualização consolidada utilizada para consulta por SAP, Forms e filtros; respeita o acesso RLS.
- `dashboard_stats` e `site_summary`: funções do PostgreSQL que calculam os indicadores sem carregar todas as linhas no navegador.

Os registros de SAP e Forms são tratados como **texto**, preservando zeros à esquerda. Os valores monetários são armazenados como `numeric`, não como número de ponto flutuante.

### Sites iniciais da fotografia

| Site | Centro físico | Transportadora (conforme foto) |
|---|---|---|
| Valinhos | 3178 | 10083071 \| Nordeste |
| Vinhedo | 3166 | 10122618 \| Sudeste |
| Pouso Alegre | 5038 | — |
| Ipojuca | 3165 | — |
| Igarassu | 3181 | — |
| Garanhuns | 5029 | — |

Esses valores podem ser editados livremente em **Sites e centros**.

## Armazenamento, custos e cuidados

- O **Supabase Free** inclui **500 MB para o banco PostgreSQL** por projeto. Como aqui guardamos apenas textos, números e datas, essa capacidade pode servir a muitos registros, mas **não é ilimitada** e depende de índices e espaço usado pelo banco.
- Projetos gratuitos podem ser **pausados após uma semana de baixa atividade**. Se o controle for essencial para a operação, utilize uma plataforma/plano com garantias e suporte adequados.
- O plano gratuito do Supabase **não inclui backup automático gerenciado**. Exporte CSV periodicamente e combine com exportações/backup do banco. CSV é backup de consulta dos itens, **não** um dump integral do banco (não inclui necessariamente toda a auditoria nem metadados).
- O sistema é uma ferramenta de **organização e acompanhamento**, não cria pedidos no SAP e não emite notas fiscais automaticamente.
- **Não envie dados corporativos reais, valores ou códigos internos para serviços externos sem autorização da área de TI/Segurança da Informação e da empresa.** Faça um piloto com dados fictícios primeiro.
- O acesso separado **administrador / visualizador** já está incluído. Níveis extras (operador, gerente), aprovações, exportações automáticas ou integração oficial com SAP seriam melhorias futuras.
- O estado do aplicativo é atualizado via consultas ao banco quando você abre páginas, salva ou aperta **Atualizar**. Não há edição simultânea em tempo real (websocket) nem mecanismo de resolução de conflito entre vários editores. A gravação de cada pedido é atômica; se dois administradores editarem o mesmo pedido ao mesmo tempo, o último salvamento ainda poderá prevalecer, então combine o uso administrativo durante o piloto.

## Fontes técnicas / termos (verificados em outubro de 2026)

- [Supabase: preços e limites](https://supabase.com/pricing)
- [Supabase: pausa de projetos gratuitos](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase: configuração de autenticação](https://supabase.com/docs/guides/auth/general-configuration)
- [Cloudflare Pages: limites do plano gratuito](https://developers.cloudflare.com/pages/platform/limits/)
- [Vercel Hobby: restrição a uso não comercial](https://vercel.com/docs/plans/hobby)

---

**Nota:** esta entrega contém o **código-fonte completo**, não uma implantação ativa. É necessário fazer a configuração das contas, chaves e hospedagem acima. Não foi possível executar a instalação de dependências `npm` no ambiente em que o arquivo foi gerado (sem acesso ao registro npm); os arquivos JSX e CSS passaram por validação sintática estática.
