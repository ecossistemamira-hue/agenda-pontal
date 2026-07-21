import { createClient } from "@supabase/supabase-js";

let sb = null;
export function initDb(url, key) {
  sb = createClient(url, key);
  return sb;
}
export const db = () => sb;

/* conversão entre o formato do app e as colunas do banco */
const deC = (r) => ({ id:r.id, nome:r.nome||"", t:r.tel||"", origem:r.origem||"", obs:r.obs||"", ultContato:r.ult_contato||"", at:r.at });
const paraC = (c) => ({ id:c.id, nome:c.nome||"", tel:c.t||"", origem:c.origem||"", obs:c.obs||"", ult_contato:c.ultContato||null });
const deV = (r) => ({ id:r.id, clienteId:r.cliente_id, d:r.d||"", h:r.h||"", corretor:r.corretor||"", situacao:r.situacao||"AGENDADA", obs:r.obs||"", at:r.at });
const paraV = (v) => ({ id:v.id, cliente_id:v.clienteId, d:v.d||null, h:v.h||"", corretor:v.corretor||"", situacao:v.situacao||"AGENDADA", obs:v.obs||"" });
const deVd = (r) => ({ id:r.id, clienteId:r.cliente_id, d:r.d||"", ch:r.ch||"", vl:r.vl==null ? "" : String(r.vl), corretor:r.corretor||"", obs:r.obs||"", at:r.at });
const paraVd = (v) => ({ id:v.id, cliente_id:v.clienteId, d:v.d||null, ch:v.ch||"", vl:(v.vl===""||v.vl==null) ? null : Number(v.vl), corretor:v.corretor||"", obs:v.obs||"" });

const ok = (r) => { if (r.error) throw r.error; return r.data; };

export async function carregarTudo() {
  const [c, v, vd, p, l, e] = await Promise.all([
    sb.from("clientes").select("*"),
    sb.from("visitas").select("*"),
    sb.from("vendas").select("*"),
    sb.from("perfis").select("*"),
    sb.from("log").select("*").order("ts", { ascending:false }).limit(80),
    sb.from("excluidos").select("*").order("ts", { ascending:false }).limit(60),
  ]);
  return {
    clientes: ok(c).map(deC),
    visitas: ok(v).map(deV),
    vendas: ok(vd).map(deVd),
    perfis: ok(p).map((r)=>({ id:r.id, nome:r.nome||"", papel:r.papel||"corretor" })),
    log: ok(l).map((r)=>({ id:r.id, ts:new Date(r.ts).getTime(), u:r.u, tx:r.tx })),
    excluidos: ok(e).map((r)=>({ id:r.id, tipo:r.tipo, ts:new Date(r.ts).getTime(), dado:r.dado })),
  };
}

export const ops = {
  upsertCliente: async (c) => ok(await sb.from("clientes").upsert(paraC(c))),
  upsertVisita: async (v) => ok(await sb.from("visitas").upsert(paraV(v))),
  upsertVenda: async (v) => ok(await sb.from("vendas").upsert(paraVd(v))),
  deletar: async (tabela, id) => ok(await sb.from(tabela).delete().eq("id", id)),
  tombstone: async (itens) =>
    ok(await sb.from("excluidos").upsert(itens.map((e)=>({ id:e.id, tipo:e.tipo, dado:e.dado })))),
  removerTombstone: async (id) => ok(await sb.from("excluidos").delete().eq("id", id)),
  log: async (u, tx) => ok(await sb.from("log").insert({ u, tx })),
  mudarPerfil: async (id, patch) => ok(await sb.from("perfis").update(patch).eq("id", id)),
  trocarMinhaSenha: async (senha) => {
    const { error } = await sb.auth.updateUser({ password: senha });
    if (error) throw error;
  },
  limparLixeiraAntiga: () => {
    const corte = new Date(Date.now() - 30*24*3600*1000).toISOString();
    sb.from("excluidos").delete().lt("ts", corte).then(()=>{});
  },
  importarLote: async ({ clientes, visitas, vendas }) => {
    const pedacos = (arr, n=200) => {
      const out = [];
      for (let i=0; i<arr.length; i+=n) out.push(arr.slice(i, i+n));
      return out;
    };
    for (const p of pedacos(clientes)) ok(await sb.from("clientes").upsert(p.map(paraC)));
    for (const p of pedacos(visitas)) ok(await sb.from("visitas").upsert(p.map(paraV)));
    for (const p of pedacos(vendas)) ok(await sb.from("vendas").upsert(p.map(paraVd)));
  },
};

/* assina alterações feitas por outros aparelhos (tempo real) */
export function assinar(onChange) {
  const canal = sb.channel("dados-pontal")
    .on("postgres_changes", { event:"*", schema:"public" }, onChange)
    .subscribe();
  return () => sb.removeChannel(canal);
}
