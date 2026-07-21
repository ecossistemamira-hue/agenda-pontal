# Agenda Jardins do Pontal · versão com Supabase

O app agora guarda tudo num banco de dados na nuvem (Supabase): cada pessoa entra com
seu e-mail e senha, as alterações aparecem em tempo real nos aparelhos de todos, e
ninguém sobrescreve o trabalho de ninguém.

## Configuração (uma vez só, ~10 minutos)

### 1. Criar as tabelas
No painel do Supabase: **SQL Editor → New query**, cole o conteúdo inteiro do arquivo
`supabase/schema.sql` e clique em **Run**.

### 2. Criar os usuários
**Authentication → Users → Add user** (marque **Auto Confirm User**):
- crie o seu (gestor) e o de cada corretor/atendente, com e-mail e senha.

Depois, ainda no **SQL Editor**, torne-se gestor (troque pelo seu e-mail):

```sql
update public.perfis set papel = 'gestor'
where id = (select id from auth.users where email = 'SEU_EMAIL_AQUI');
```

Os demais entram como "corretor" — dá para mudar o papel na aba **Equipe** do app.

### 3. Conectar o app
**Settings → API** no Supabase: copie a **Project URL** e a chave **anon public**,
e cole as duas no arquivo `config.js` desta pasta.
(A chave anon é feita para ficar no navegador — quem protege os dados é o login + as
regras criadas no passo 1. Nunca use a chave `service_role` aqui.)

### 4. Publicar o app
A pasta já está pronta para qualquer hospedagem de site estático. O caminho mais fácil:

1. Acesse https://app.netlify.com/drop (crie a conta grátis se pedir);
2. Arraste **a pasta `agenda-pontal` inteira** para a página;
3. Pronto — o site ganha um endereço (dá para renomear em Site settings) que
   funciona no celular de todo mundo. Salve na tela inicial do celular para
   virar um "aplicativo".

Alternativa: abrir o `index.html` direto no navegador também funciona para testar.

### 5. Trazer os dados
Entre no app como gestor → aba **Relatório** → **Importar dados (JSON)**:
- use o backup baixado do app antigo (botão "Backup (JSON)" no artifact), **ou**
- use o arquivo `dados-planilha.json` desta pasta (dados originais da planilha).

A importação pode ser rodada mais de uma vez sem duplicar nada.

## Dia a dia
- **Adicionar/remover pessoas ou trocar senha de alguém**: painel do Supabase → Authentication → Users.
- **Trocar a própria senha**: toque no seu nome no topo do app.
- **Backup**: aba Relatório → "Backup (JSON)" (o Supabase também guarda backups automáticos).

## Para desenvolver
```
npm install       # uma vez
npm run build     # gera dist/app.js
npm run dev       # recompila a cada alteração
```
