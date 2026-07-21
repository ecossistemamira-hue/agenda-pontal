-- ============================================================
-- Agenda Jardins do Pontal · esquema do banco (Supabase)
-- Cole este arquivo inteiro no SQL Editor do Supabase e execute.
-- Pode ser executado mais de uma vez sem problema.
-- ============================================================

-- ---------- perfis (um por usuário do Authentication) ----------
create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  papel text not null default 'corretor' check (papel in ('gestor','corretor','atendente')),
  criado_em timestamptz not null default now()
);

-- cria o perfil automaticamente quando um usuário é adicionado no Authentication
create or replace function public.criar_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil();

-- função auxiliar para as regras de acesso
create or replace function public.eh_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and papel = 'gestor')
$$;

-- ---------- dados da agenda ----------
create table if not exists public.clientes (
  id text primary key,
  nome text not null default '',
  tel text not null default '',
  origem text not null default '',
  obs text not null default '',
  ult_contato date,
  at timestamptz not null default now()
);

create table if not exists public.visitas (
  id text primary key,
  cliente_id text not null references public.clientes(id) on delete cascade,
  d date,
  h text not null default '',
  corretor text not null default '',   -- id do perfil responsável
  situacao text not null default 'AGENDADA',
  obs text not null default '',
  at timestamptz not null default now()
);

create table if not exists public.vendas (
  id text primary key,
  cliente_id text not null references public.clientes(id) on delete cascade,
  d date,
  ch text not null default '',
  vl numeric,
  corretor text not null default '',
  obs text not null default '',
  at timestamptz not null default now()
);

create table if not exists public.log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  u text not null default '',
  tx text not null default ''
);

create table if not exists public.excluidos (
  id text primary key,
  tipo text not null,
  ts timestamptz not null default now(),
  dado jsonb
);

create index if not exists visitas_d_idx on public.visitas (d);
create index if not exists visitas_cliente_idx on public.visitas (cliente_id);
create index if not exists vendas_cliente_idx on public.vendas (cliente_id);

-- atualiza o carimbo "at" automaticamente em toda alteração
create or replace function public.carimbar_at()
returns trigger language plpgsql as $$
begin new.at = now(); return new; end $$;

do $$ declare t text;
begin
  foreach t in array array['clientes','visitas','vendas'] loop
    execute format('drop trigger if exists carimbo_at on public.%I', t);
    execute format('create trigger carimbo_at before update on public.%I for each row execute function public.carimbar_at()', t);
  end loop;
end $$;

-- ---------- regras de acesso (RLS) ----------
alter table public.perfis    enable row level security;
alter table public.clientes  enable row level security;
alter table public.visitas   enable row level security;
alter table public.vendas    enable row level security;
alter table public.log       enable row level security;
alter table public.excluidos enable row level security;

-- perfis: todos os logados leem; só o gestor altera papéis/nomes
drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis for select to authenticated using (true);
drop policy if exists perfis_gestor on public.perfis;
create policy perfis_gestor on public.perfis for update to authenticated
  using (public.eh_gestor()) with check (public.eh_gestor());

-- dados: qualquer usuário logado da equipe lê e escreve; ninguém de fora acessa
do $$ declare t text;
begin
  foreach t in array array['clientes','visitas','vendas','excluidos'] loop
    execute format('drop policy if exists %I_equipe on public.%I', t, t);
    execute format('create policy %I_equipe on public.%I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- log: logados leem e inserem; ninguém edita ou apaga o histórico
drop policy if exists log_ler on public.log;
create policy log_ler on public.log for select to authenticated using (true);
drop policy if exists log_inserir on public.log;
create policy log_inserir on public.log for insert to authenticated with check (true);

-- ---------- tempo real (sincroniza os aparelhos na hora) ----------
do $$ declare t text;
begin
  foreach t in array array['clientes','visitas','vendas','log','excluidos','perfis'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ============================================================
-- DEPOIS DE EXECUTAR:
-- 1. Authentication → Users → Add user → crie seu usuário
--    (marque "Auto Confirm User") e os dos corretores/atendentes.
-- 2. Torne-se gestor rodando (troque pelo seu e-mail):
--    update public.perfis set papel = 'gestor'
--    where id = (select id from auth.users where email = 'SEU_EMAIL_AQUI');
-- Os demais usuários nascem como "corretor" — dá para mudar o papel
-- na aba Equipe do app ou nesta mesma tela SQL.
-- ============================================================
