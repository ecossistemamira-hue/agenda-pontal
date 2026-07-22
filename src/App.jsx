import { useState, useEffect, useMemo, useRef } from "react";
import { initDb, db, carregarTudo, ops, assinar } from "./db.js";

const SITUACOES = [
  "AGENDAR","AGENDADA","CONFIRMADA","COMPARECEU",
  "NÃO COMPARECEU","DESMARCADA","REAGENDADA","SEM RESPOSTA",
];
const ST = {
  "AGENDAR":        { bg:"#EBE0F0", fg:"#5B2E7A", dot:"#8A55B0" },
  "AGENDADA":       { bg:"#DCE9F7", fg:"#1D4E7A", dot:"#2E6DA4" },
  "CONFIRMADA":     { bg:"#E3E4F5", fg:"#3B3E8F", dot:"#5A5ECC" },
  "COMPARECEU":     { bg:"#DCEFDB", fg:"#1F5C2D", dot:"#3B8A4E" },
  "NÃO COMPARECEU": { bg:"#F7DCDC", fg:"#8A2323", dot:"#C24545" },
  "DESMARCADA":     { bg:"#E8E6E1", fg:"#5F5B54", dot:"#8B867D" },
  "REAGENDADA":     { bg:"#F7ECCF", fg:"#7A5A12", dot:"#C99A2E" },
  "SEM RESPOSTA":   { bg:"#F5E3D3", fg:"#8A4E1D", dot:"#C97B3A" },
  "VENDEU":         { bg:"#F3E8C9", fg:"#6B4E0C", dot:"#B8860B" },
};
const C = {
  ink:"#22301F", verde:"#2C5E3F", verdeEsc:"#1E4230", papel:"#EFF2EA",
  card:"#FFFFFF", linha:"#DDE3D6", terra:"#8A6A3B", alerta:"#B03A2E", ouro:"#B8860B",
};
const ORIGENS = ["Indicação","Instagram","Facebook","WhatsApp","Placa / passou em frente","Rádio","Outro"];

/* ============ helpers ============ */
const isoDe = (dt) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
const hoje = () => isoDe(new Date());
const amanha = () => { const n = new Date(); n.setDate(n.getDate()+1); return isoDe(n); };
const fmtData = (iso) => { if(!iso) return "sem data"; const [y,m,d]=iso.split("-"); return `${d}/${m}/${y.slice(2)}`; };
const DIAS = ["dom","seg","ter","qua","qui","sex","sáb"];
const diaSemana = (iso) => { const [y,m,d]=iso.split("-").map(Number); return DIAS[new Date(y,m-1,d).getDay()]; };
const mesLabel = (ym) => { const [y,m]=ym.split("-"); return ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"][+m-1]+"/"+y.slice(2); };
const fmtTs = (ts) => { const d=new Date(ts); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
const soDigitos = (t) => (t||"").replace(/\D/g,"");
const waDigitos = (t) => { const d = soDigitos(t); if(!d) return ""; return (d.length===10 || d.length===11) ? "55"+d : d; };
const telSuspeito = (t) => { const d = soDigitos(t); return d.length>0 && d.length<10; };
const ehPendente = (v, h) => v.d && v.d < h && (v.situacao==="AGENDADA" || v.situacao==="CONFIRMADA");
const novoId = () => "x"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const fmtR$ = (n) => (Number(n)||0).toLocaleString("pt-BR",{ style:"currency", currency:"BRL", maximumFractionDigits:0 });
const msgConfirmacao = (nome, v) => {
  const quando = v.d===hoje() ? "hoje" : v.d===amanha() ? "amanhã" : "no dia "+fmtData(v.d);
  return encodeURIComponent(`Olá${nome ? ", "+nome.split(" ")[0] : ""}! Aqui é do Jardins do Pontal 🌿 Passando para confirmar sua visita ${quando}${v.h ? " às "+v.h : ""}. Podemos confirmar?`);
};

/* ============ migração de backups antigos (v1/v2/planilha) ============ */
function migrarLegado(base, agora) {
  const clientes = [], visitas = [], vendas = [];
  const porChave = new Map();
  const clienteDe = (n, t) => {
    const dig = soDigitos(t);
    const chave = dig.length >= 8 ? "t"+dig : "n"+(n||"").trim().toLowerCase();
    let c = porChave.get(chave);
    if (!c) {
      c = { id: novoId(), nome:(n||"").trim(), t:t||"", origem:"", obs:"", at:agora };
      porChave.set(chave, c); clientes.push(c);
    } else {
      if ((n||"").trim().length > (c.nome||"").length) c.nome = (n||"").trim();
      if (!c.t && t) c.t = t;
    }
    return c;
  };
  const mapa = {
    "AGENDADA":"AGENDADA", "CONFIRMAR":"AGENDADA", "COMPARECEU":"COMPARECEU",
    "NÃO COMPARECEU":"NÃO COMPARECEU", "DESMARCADA":"DESMARCADA", "REAGENDAR":"REAGENDADA",
    "NÃO RESPONDEU":"SEM RESPOSTA", "AGENDAR":"AGENDAR", "":"AGENDADA",
  };
  for (const v of base.visitas || []) {
    const c = clienteDe(v.n, v.t);
    const h = v.h==="00:00" ? "" : (v.h||"");
    if (v.s === "VENDEU") {
      visitas.push({ id:v.id||novoId(), clienteId:c.id, d:v.d||"", h, corretor:"", situacao:"COMPARECEU", obs:v.o||"" });
      vendas.push({ id:novoId(), clienteId:c.id, d:v.d||"", ch:v.ch||"", vl:v.vl||"", corretor:"", obs:"" });
    } else {
      let situacao = mapa[v.s] ?? "AGENDADA";
      if (!v.d && (situacao==="AGENDADA" || situacao==="CONFIRMADA")) situacao = "AGENDAR";
      visitas.push({ id:v.id||novoId(), clienteId:c.id, d:v.d||"", h, corretor:"", situacao, obs:v.o||"" });
    }
  }
  for (const r of base.retornos || []) {
    const c = clienteDe(r.n, r.t);
    c.obs = [c.obs, r.o].filter(Boolean).join(" · ");
    if (r.d) c.ultContato = r.d;
  }
  return { clientes, visitas, vendas };
}

/* ============ cálculos do relatório ============ */
function calcResumo(dados, de, ate) {
  const vs = dados.visitas.filter((v)=>v.d && v.d>=de && v.d<=ate);
  const cnt = (s) => vs.filter((v)=>v.situacao===s).length;
  const comp = cnt("COMPARECEU"), ncomp = cnt("NÃO COMPARECEU");
  const vendasP = dados.vendas.filter((v)=>v.d && v.d>=de && v.d<=ate);
  const valor = vendasP.reduce((s,v)=>s+(Number(v.vl)||0),0);
  return {
    total: vs.length, comp, ncomp,
    desm: cnt("DESMARCADA"), reag: cnt("REAGENDADA"), semResp: cnt("SEM RESPOSTA"),
    vendasP, valor,
    taxa: comp+ncomp ? Math.round(100*comp/(comp+ncomp)) : null,
    conv: comp ? Math.round(100*vendasP.length/comp) : null,
  };
}
function calcMensal(dados) {
  const m = {};
  const cel = (k) => (m[k] = m[k] || { t:0,c:0,n:0,d:0,r:0,v:0,vl:0 });
  for (const v of dados.visitas) {
    if (!v.d) continue;
    const x = cel(v.d.slice(0,7)); x.t++;
    if (v.situacao==="COMPARECEU") x.c++;
    if (v.situacao==="NÃO COMPARECEU") x.n++;
    if (v.situacao==="DESMARCADA") x.d++;
    if (v.situacao==="REAGENDADA") x.r++;
  }
  for (const vd of dados.vendas) {
    if (!vd.d) continue;
    const x = cel(vd.d.slice(0,7)); x.v++; x.vl += Number(vd.vl)||0;
  }
  return Object.entries(m).sort((a,b)=>a[0].localeCompare(b[0]));
}
function calcPorCorretor(dados, de, ate) {
  const m = {};
  const cel = (k) => (m[k] = m[k] || { ag:0,c:0,n:0,v:0 });
  for (const v of dados.visitas.filter((v)=>v.d && v.d>=de && v.d<=ate)) {
    const x = cel(v.corretor||"");
    x.ag++;
    if (v.situacao==="COMPARECEU") x.c++;
    if (v.situacao==="NÃO COMPARECEU") x.n++;
  }
  for (const vd of dados.vendas.filter((v)=>v.d && v.d>=de && v.d<=ate)) cel(vd.corretor||"").v++;
  return Object.entries(m).sort((a,b)=>b[1].ag-a[1].ag);
}

/* ============ componentes pequenos ============ */
function Badge({ s, onClick }) {
  const c = ST[s] || { bg:"#EEE", fg:"#555", dot:"#999" };
  if (!onClick) return (
    <span style={{ background:c.bg, color:c.fg }}
      className="px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide flex items-center gap-1.5 shrink-0">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background:c.dot }} />
      {s || "—"}
    </span>
  );
  return (
    <button onClick={onClick} style={{ background:c.bg, color:c.fg, border:`1.5px solid ${c.dot}`, minHeight:"40px" }}
      className="px-3 rounded-lg text-[13px] font-bold tracking-wide flex items-center gap-1.5 shrink-0">
      <span className="w-2 h-2 rounded-full" style={{ background:c.dot }} />
      {s || "—"}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
    </button>
  );
}

function Contato({ tel }) {
  const dig = waDigitos(tel);
  if (!soDigitos(tel)) return null;
  return (
    <span className="flex items-center gap-2 flex-wrap">
      <span className="text-sm" style={{ color:C.terra }}>{tel}</span>
      {telSuspeito(tel) && <span className="text-[13px] font-bold" style={{ color:C.alerta }}>⚠ nº incompleto?</span>}
      <a href={`https://wa.me/${dig}`} target="_blank" rel="noreferrer" title="WhatsApp"
        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
        style={{ background:"#3B8A4E" }}>W</a>
      <a href={`tel:+${dig}`} title="Ligar"
        className="w-7 h-7 rounded-full flex items-center justify-center text-xs"
        style={{ background:"#E8E6E1", color:C.ink }}>☎</a>
    </span>
  );
}

/* aviso grande no meio da tela, no lugar da caixinha padrão do navegador */
function Confirmar({ titulo, texto, rotuloSim, corSim, onSim, onNao }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-6" style={{ background:"rgba(30,45,28,.6)" }}>
      <div className="w-full max-w-sm rounded-2xl p-6 text-center shadow-xl" style={{ background:C.papel }}>
        <div className="font-bold text-[20px] leading-snug" style={{ color:C.verdeEsc, fontFamily:"'Archivo', sans-serif" }}>{titulo}</div>
        {texto && <div className="text-[15px] mt-2" style={{ color:"#57614F" }}>{texto}</div>}
        <div className="flex flex-col gap-2.5 mt-5">
          <button onClick={onSim} className="w-full rounded-xl text-white font-bold text-[16px]"
            style={{ background:corSim||C.alerta, minHeight:"52px" }}>{rotuloSim}</button>
          <button onClick={onNao} className="w-full rounded-xl font-bold text-[16px]"
            style={{ background:"#E1E5DA", color:C.ink, minHeight:"52px" }}>Voltar</button>
        </div>
      </div>
    </div>
  );
}

function BotaoConfirmar({ rotulo, aviso = "Tem certeza?", onOk, className, style }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button onClick={()=>setAberto(true)} className={className} style={style}>{rotulo}</button>
      {aberto && (
        <Confirmar titulo={aviso} texto="Esta ação não pode ser desfeita."
          rotuloSim={`Sim, ${rotulo.toLowerCase()}`}
          onSim={()=>{ setAberto(false); onOk(); }} onNao={()=>setAberto(false)} />
      )}
    </>
  );
}

const inp = "w-full rounded-lg border px-3 py-2 text-sm bg-white";
const bs = { borderColor:C.linha };
const lbl = { color:C.ink };
const Modal = ({ children }) => (
  <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background:"rgba(30,45,28,.55)" }}>
    <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto" style={{ background:C.papel }}>
      {children}
    </div>
  </div>
);
const Titulo = ({ children }) => (
  <h3 className="font-bold text-lg mb-4" style={{ color:C.verdeEsc, fontFamily:"'Archivo', sans-serif" }}>{children}</h3>
);

function CamposCliente({ f, setF, clientes }) {
  const ligado = f.clienteId ? clientes.find((c)=>c.id===f.clienteId) : null;
  const sugestoes = useMemo(() => {
    if (ligado) return [];
    const dig = soDigitos(f.tel);
    const nome = (f.nome||"").trim().toLowerCase();
    if (dig.length < 4 && nome.length < 3) return [];
    return clientes.filter((c) =>
      (dig.length >= 4 && soDigitos(c.t).includes(dig)) ||
      (nome.length >= 3 && (c.nome||"").toLowerCase().includes(nome))
    ).slice(0,3);
  }, [f.nome, f.tel, clientes, ligado]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  if (ligado) return (
    <div className="rounded-lg px-3 py-2.5 flex items-center justify-between gap-2" style={{ background:"#E4EDE2" }}>
      <div className="min-w-0">
        <div className="text-sm font-bold truncate" style={{ color:C.verdeEsc }}>{ligado.nome || "(sem nome)"}</div>
        <div className="text-xs" style={{ color:C.terra }}>{ligado.t}</div>
      </div>
      {!f.clienteFixo && (
        <button onClick={()=>setF({ ...f, clienteId:null })} className="text-xs font-bold shrink-0" style={{ color:C.alerta }}>trocar ✕</button>
      )}
    </div>
  );
  return (
    <>
      <label className="text-xs font-semibold" style={lbl}>Nome
        <input className={inp} style={bs} value={f.nome||""} onChange={set("nome")} placeholder="Nome do cliente" /></label>
      <label className="text-xs font-semibold" style={lbl}>Telefone
        <input className={inp} style={bs} value={f.tel||""} onChange={set("tel")} placeholder="(33) 99999-9999" />
        {telSuspeito(f.tel) && <span className="text-[13px] font-bold" style={{ color:C.alerta }}>⚠ telefone parece incompleto — confira o número</span>}
      </label>
      {sugestoes.length > 0 && (
        <div className="rounded-lg p-2 flex flex-col gap-1" style={{ background:"#F7ECCF" }}>
          <span className="text-[13px] font-bold uppercase" style={{ color:"#7A5A12" }}>Já cadastrado — tocar para usar:</span>
          {sugestoes.map((c) => (
            <button key={c.id} onClick={()=>setF({ ...f, clienteId:c.id })}
              className="text-left text-xs font-semibold rounded px-2 py-1.5" style={{ background:"#fff", color:C.ink }}>
              {c.nome || "(sem nome)"} · {c.t}
            </button>
          ))}
        </div>
      )}
      <label className="text-xs font-semibold" style={lbl}>Como conheceu
        <select className={inp} style={bs} value={f.origem||""} onChange={set("origem")}>
          <option value="">—</option>
          {ORIGENS.map((o)=><option key={o}>{o}</option>)}
        </select></label>
    </>
  );
}

const SelectCorretor = ({ f, setF, perfis }) => (
  <label className="text-xs font-semibold" style={lbl}>Corretor responsável
    <select className={inp} style={bs} value={f.corretor||""} onChange={(e)=>setF({ ...f, corretor:e.target.value })}>
      <option value="">—</option>
      {perfis.filter((p)=>p.papel!=="atendente").map((p)=><option key={p.id} value={p.id}>{p.nome}</option>)}
    </select></label>
);

/* ============ formulários ============ */
function FormVisita({ inicial, clientes, perfis, onSalvar, onCancelar, onExcluir }) {
  const [f, setF] = useState(inicial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const podeSalvar = f.clienteId || (f.nome||"").trim() || soDigitos(f.tel);
  return (
    <Modal>
      <Titulo>{inicial.id ? "Editar visita" : "Nova visita"}</Titulo>
      <div className="flex flex-col gap-3">
        <CamposCliente f={f} setF={setF} clientes={clientes} />
        <div className="flex gap-3">
          <label className="text-xs font-semibold flex-1" style={lbl}>Data
            <input type="date" className={inp} style={bs} value={f.d} onChange={set("d")} /></label>
          <label className="text-xs font-semibold w-28" style={lbl}>Hora
            <input type="time" className={inp} style={bs} value={f.h} onChange={set("h")} /></label>
        </div>
        <SelectCorretor f={f} setF={setF} perfis={perfis} />
        <label className="text-xs font-semibold" style={lbl}>Situação
          <select className={inp} style={bs} value={f.situacao} onChange={set("situacao")}>
            {(SITUACOES.includes(f.situacao) ? SITUACOES : [f.situacao, ...SITUACOES]).map((s)=><option key={s}>{s}</option>)}
          </select></label>
        <label className="text-xs font-semibold" style={lbl}>Observações
          <textarea className={inp} style={bs} rows={3} value={f.obs} onChange={set("obs")}
            placeholder="Interesse, quadra, combinados…" /></label>
      </div>
      <div className="flex gap-2 mt-5">
        <button onClick={()=>onSalvar(f)} disabled={!podeSalvar}
          className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm disabled:opacity-40"
          style={{ background:C.verde }}>Salvar</button>
        <button onClick={onCancelar} className="px-4 py-2.5 rounded-lg text-sm font-semibold"
          style={{ background:"#E1E5DA", color:C.ink }}>Cancelar</button>
        {inicial.id && (
          <BotaoConfirmar rotulo="Excluir" aviso="Excluir?" onOk={onExcluir}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold"
            style={{ background:"#F1DBD8", color:C.alerta }} />
        )}
      </div>
    </Modal>
  );
}

function FormCliente({ inicial, onSalvar, onCancelar }) {
  const [f, setF] = useState(inicial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal>
      <Titulo>{inicial.id ? "Editar cliente" : "Novo cliente"}</Titulo>
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold" style={lbl}>Nome
          <input className={inp} style={bs} value={f.nome||""} onChange={set("nome")} /></label>
        <label className="text-xs font-semibold" style={lbl}>Telefone
          <input className={inp} style={bs} value={f.t||""} onChange={set("t")} />
          {telSuspeito(f.t) && <span className="text-[13px] font-bold" style={{ color:C.alerta }}>⚠ telefone parece incompleto</span>}
        </label>
        <label className="text-xs font-semibold" style={lbl}>Como conheceu
          <select className={inp} style={bs} value={f.origem||""} onChange={set("origem")}>
            <option value="">—</option>
            {ORIGENS.map((o)=><option key={o}>{o}</option>)}
          </select></label>
        <label className="text-xs font-semibold" style={lbl}>Observações do cliente
          <textarea className={inp} style={bs} rows={3} value={f.obs||""} onChange={set("obs")}
            placeholder="Preferências, quem indicou, combinados…" /></label>
      </div>
      <div className="flex gap-2 mt-5">
        <button onClick={()=>onSalvar(f)} disabled={!(f.nome||"").trim() && !soDigitos(f.t)}
          className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm disabled:opacity-40"
          style={{ background:C.verde }}>Salvar</button>
        <button onClick={onCancelar} className="px-4 py-2.5 rounded-lg text-sm font-semibold"
          style={{ background:"#E1E5DA", color:C.ink }}>Cancelar</button>
      </div>
    </Modal>
  );
}

function FormVenda({ inicial, clientes, perfis, onSalvar, onCancelar, onExcluir }) {
  const [f, setF] = useState(inicial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const podeSalvar = f.clienteId || (f.nome||"").trim() || soDigitos(f.tel);
  return (
    <Modal>
      <Titulo>{inicial.id ? "Editar venda" : "Registrar venda"} 💰</Titulo>
      <div className="flex flex-col gap-3">
        <CamposCliente f={f} setF={setF} clientes={clientes} />
        <label className="text-xs font-semibold" style={lbl}>Data da venda
          <input type="date" className={inp} style={bs} value={f.d} onChange={set("d")} /></label>
        <div className="flex gap-3 rounded-lg p-3" style={{ background:"#F3E8C9" }}>
          <label className="text-xs font-bold flex-1" style={{ color:"#6B4E0C" }}>Chácara
            <input className={inp} style={bs} value={f.ch||""} onChange={set("ch")} placeholder="Ex.: 33G" /></label>
          <label className="text-xs font-bold flex-1" style={{ color:"#6B4E0C" }}>Valor (R$)
            <input type="number" className={inp} style={bs} value={f.vl||""} onChange={set("vl")} placeholder="60000" /></label>
        </div>
        <SelectCorretor f={f} setF={setF} perfis={perfis} />
        <label className="text-xs font-semibold" style={lbl}>Observações
          <textarea className={inp} style={bs} rows={2} value={f.obs||""} onChange={set("obs")} /></label>
      </div>
      <div className="flex gap-2 mt-5">
        <button onClick={()=>onSalvar(f)} disabled={!podeSalvar}
          className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm disabled:opacity-40"
          style={{ background:C.ouro }}>Salvar venda</button>
        <button onClick={onCancelar} className="px-4 py-2.5 rounded-lg text-sm font-semibold"
          style={{ background:"#E1E5DA", color:C.ink }}>Cancelar</button>
        {inicial.id && onExcluir && (
          <BotaoConfirmar rotulo="Excluir" aviso="Excluir?" onOk={onExcluir}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold"
            style={{ background:"#F1DBD8", color:C.alerta }} />
        )}
      </div>
    </Modal>
  );
}

/* ============ card de visita ============ */
function CardVisita({ v, c, h, podeVenda, nomeCorretor, onStatus, onEditar, onReagendar, onConfirmar, onVender }) {
  const [aberto, setAberto] = useState(false);
  const pend = ehPendente(v, h);
  const precisaConfirmar = v.situacao==="AGENDADA" && (v.d===h || v.d===amanha());
  return (
    <div className="rounded-xl p-3 flex flex-col gap-2"
      style={{ background: pend ? "#FBEAE7" : C.card, border:`1px solid ${pend ? "#E7B8B0" : C.linha}` }}>
      <div className="flex items-start justify-between gap-2">
        <button onClick={onEditar} className="text-left min-w-0">
          <div className="font-semibold text-[15px] leading-tight" style={{ color:C.ink }}>
            {v.h && <span className="font-bold mr-1.5" style={{ color:C.verde }}>{v.h}</span>}
            {c.nome || <em className="opacity-50">sem nome</em>}
          </div>
          {v.corretor && <div className="text-[13px]" style={{ color:"#7C8674" }}>corretor: {nomeCorretor(v.corretor)}</div>}
        </button>
        <Badge s={v.situacao} onClick={()=>setAberto(!aberto)} />
      </div>
      {aberto && (
        <div className="rounded-xl overflow-hidden" style={{ border:`1px solid ${C.linha}`, background:"#FFFFFF" }}>
          <div className="px-3 py-2 text-[13px] font-bold" style={{ background:"#F0EEE6", color:"#6B7263" }}>
            O que aconteceu com esta visita? Toque para escolher:
          </div>
          {SITUACOES.map((s) => (
            <button key={s} onClick={()=>{ onStatus(s); setAberto(false); }}
              className="w-full flex items-center gap-2.5 px-3 text-left text-[15px] font-semibold"
              style={{ minHeight:"48px", color:ST[s].fg, background: s===v.situacao ? ST[s].bg : "#FFFFFF", borderTop:`1px solid ${C.linha}` }}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background:ST[s].dot }} />
              {s}
              {s===v.situacao && <span className="ml-auto text-[17px] font-bold">✓</span>}
            </button>
          ))}
          {podeVenda && (
            <button onClick={()=>{ onVender(); setAberto(false); }}
              className="w-full flex items-center gap-2.5 px-3 text-left text-[15px] font-bold"
              style={{ minHeight:"48px", background:ST.VENDEU.bg, color:ST.VENDEU.fg, borderTop:`1px solid ${C.linha}` }}>
              💰 VENDEU
            </button>
          )}
          <button onClick={()=>{ onReagendar(); setAberto(false); }}
            className="w-full flex items-center gap-2.5 px-3 text-left text-[15px] font-bold"
            style={{ minHeight:"48px", background:"#E1E5DA", color:C.ink, borderTop:`1px solid ${C.linha}` }}>
            ↻ Fechar e marcar nova data
          </button>
        </div>
      )}
      <Contato tel={c.t} />
      {v.obs && <div className="text-xs leading-snug" style={{ color:"#57614F" }}>{v.obs}</div>}
      {precisaConfirmar && (
        <div className="flex gap-2">
          <a href={`https://wa.me/${waDigitos(c.t)}?text=${msgConfirmacao(c.nome, v)}`} target="_blank" rel="noreferrer"
            className="px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background:"#3B8A4E" }}>
            💬 Enviar confirmação</a>
          <button onClick={onConfirmar} className="px-3 py-1.5 rounded-lg text-xs font-bold"
            style={{ background:"#E3E4F5", color:"#3B3E8F" }}>✓ Confirmada</button>
        </div>
      )}
      {pend && <div className="text-[13px] font-bold" style={{ color:C.alerta }}>Visita passou — marque o que aconteceu</div>}
    </div>
  );
}

/* ============ aba AGENDA ============ */
function Agenda({ dados, acoes, perfil }) {
  const podeVenda = perfil.papel !== "atendente";
  const h = hoje(), am = amanha();
  const [filtro, setFiltro] = useState("proximas");
  const [busca, setBusca] = useState("");
  const [edit, setEdit] = useState(null);
  const [venda, setVenda] = useState(null);

  const cliMap = useMemo(()=>new Map(dados.clientes.map((c)=>[c.id,c])), [dados.clientes]);
  const cli = (id) => cliMap.get(id) || { nome:"(cliente removido)", t:"" };
  const nomeCorretor = (id) => dados.perfis.find((p)=>p.id===id)?.nome || "—";

  const nPend = dados.visitas.filter((v)=>ehPendente(v,h)).length;
  const nConf = dados.visitas.filter((v)=>v.situacao==="AGENDADA" && (v.d===h || v.d===am)).length;
  const nAg = dados.visitas.filter((v)=>!v.d).length;
  const nSemResp = dados.visitas.filter((v)=>v.situacao==="SEM RESPOSTA").length;

  const lista = useMemo(() => {
    let l = dados.visitas;
    if (busca.trim()) {
      const q = busca.trim().toLowerCase(), qd = soDigitos(q);
      l = l.filter((v) => {
        const c = cli(v.clienteId);
        return (c.nome||"").toLowerCase().includes(q) ||
          (qd && soDigitos(c.t).includes(qd)) ||
          (v.obs||"").toLowerCase().includes(q);
      });
    }
    else if (filtro==="proximas") l = l.filter((v)=>v.d >= h);
    else if (filtro==="confirmar") l = l.filter((v)=>v.situacao==="AGENDADA" && (v.d===h || v.d===am));
    else if (filtro==="pendentes") l = l.filter((v)=>ehPendente(v,h));
    else if (filtro==="agendar") l = l.filter((v)=>!v.d);
    else if (filtro==="semresp") l = l.filter((v)=>v.situacao==="SEM RESPOSTA");
    const dir = filtro==="todas" || filtro==="semresp" ? -1 : 1;
    return [...l].sort((a,b) => {
      if (!a.d && !b.d) return 0;
      if (!a.d) return 1; if (!b.d) return -1;
      return a.d===b.d ? (a.h||"").localeCompare(b.h||"") : dir*(a.d<b.d?-1:1);
    });
  }, [dados, filtro, busca, h]);

  const grupos = useMemo(() => {
    const g = [];
    for (const v of lista) {
      const k = v.d || "";
      if (!g.length || g[g.length-1].k !== k) g.push({ k, itens:[] });
      g[g.length-1].itens.push(v);
    }
    return g;
  }, [lista]);

  const chips = [
    ["proximas","Próximas"],
    ["confirmar", nConf ? `Confirmar (${nConf})` : "Confirmar"],
    ["pendentes", nPend ? `Pendentes (${nPend})` : "Pendentes"],
    ["agendar", nAg ? `A agendar (${nAg})` : "A agendar"],
    ["semresp", nSemResp ? `Sem resposta (${nSemResp})` : "Sem resposta"],
    ["todas","Todas"],
  ];

  return (
    <div className="flex flex-col gap-3">
      {nPend > 0 && filtro !== "pendentes" && (
        <button onClick={()=>setFiltro("pendentes")}
          className="rounded-xl px-4 py-3 text-left text-sm font-semibold text-white"
          style={{ background:C.alerta }}>
          ⚠ {nPend} visita{nPend>1?"s":""} já passou e ninguém marcou o que aconteceu — toque para ver
        </button>
      )}
      {nConf > 0 && filtro !== "confirmar" && (
        <button onClick={()=>setFiltro("confirmar")}
          className="rounded-xl px-4 py-3 text-left text-sm font-semibold text-white"
          style={{ background:C.verde }}>
          📞 {nConf} visita{nConf>1?"s":""} de hoje/amanhã para confirmar — toque para ver
        </button>
      )}
      <input value={busca} onChange={(e)=>setBusca(e.target.value)} placeholder="Buscar nome, telefone ou observação…"
        className="w-full rounded-lg border px-3 py-2.5 text-sm bg-white" style={bs} />
      <div className="flex gap-2 flex-wrap">
        {chips.map(([k, lab]) => {
          const on = filtro===k && !busca;
          return (
            <button key={k} onClick={()=>{ setFiltro(k); setBusca(""); }}
              className="px-4 rounded-full text-[14px] font-bold"
              style={ on
                ? { background:C.verdeEsc, color:"#fff", minHeight:"44px" }
                : { background:"#E1E5DA", color:C.ink, minHeight:"44px" }}>
              {on ? "✓ " : ""}{lab}
            </button>
          );
        })}
      </div>

      {grupos.length === 0 && (
        <div className="text-center rounded-xl px-6 py-10" style={{ background:C.card, border:`1px dashed ${C.linha}` }}>
          <div className="text-[36px] mb-2">📅</div>
          <div className="text-[16px] font-bold" style={{ color:C.ink }}>
            {busca.trim() ? "Nenhuma visita encontrada nesta busca." : "Nenhuma visita aqui."}
          </div>
          {busca.trim() ? (
            <div className="text-[15px] mt-1" style={{ color:"#7C8674" }}>Confira se o nome ou telefone foi digitado certo.</div>
          ) : (
            <div className="text-[15px] mt-1 leading-snug" style={{ color:"#7C8674" }}>
              Para agendar, toque no botão verde<br/>
              <b style={{ color:C.verde }}>+ Nova visita</b>, ali embaixo à direita.
            </div>
          )}
        </div>
      )}
      {grupos.map((g) => (
        <div key={g.k || "semdata"} className="flex flex-col gap-2">
          <div className="text-[13px] font-bold uppercase tracking-widest pt-1"
            style={{ color: g.k===h ? C.verde : "#7C8674", fontFamily:"'Archivo', sans-serif" }}>
            {g.k ? `${diaSemana(g.k)} · ${fmtData(g.k)}${g.k===h ? " · HOJE" : g.k===am ? " · AMANHÃ" : ""}` : "Sem data marcada"}
          </div>
          {g.itens.map((v) => (
            <CardVisita key={v.id} v={v} c={cli(v.clienteId)} h={h} podeVenda={podeVenda} nomeCorretor={nomeCorretor}
              onStatus={(s)=>acoes.statusVisita(v, s)}
              onEditar={()=>setEdit({ ...v, clienteFixo:true })}
              onReagendar={()=>{ const nova = acoes.reagendarVisita(v); setEdit({ ...nova, clienteFixo:true }); }}
              onConfirmar={()=>acoes.statusVisita(v, "CONFIRMADA")}
              onVender={()=>setVenda({ clienteId:v.clienteId, clienteFixo:true, visitaId:v.id, d:h, ch:"", vl:"", corretor:v.corretor||"", obs:"" })} />
          ))}
        </div>
      ))}

      <button onClick={()=>setEdit({ d:h, h:"", clienteId:null, nome:"", tel:"", origem:"", corretor: perfil.papel==="corretor" ? perfil.id : "", situacao:"AGENDADA", obs:"" })}
        className="fixed bottom-24 right-5 rounded-full px-6 py-4 text-white font-bold text-base shadow-lg z-40"
        style={{ background:C.verde }}>+ Nova visita</button>

      {edit && (
        <FormVisita inicial={edit} clientes={dados.clientes} perfis={dados.perfis}
          onCancelar={()=>setEdit(null)}
          onSalvar={(f)=>{ acoes.salvarVisita(f); setEdit(null); }}
          onExcluir={()=>{ acoes.excluirVisita(edit); setEdit(null); }} />
      )}
      {venda && (
        <FormVenda inicial={venda} clientes={dados.clientes} perfis={dados.perfis}
          onCancelar={()=>setVenda(null)}
          onSalvar={(f)=>{ acoes.salvarVenda(f); setVenda(null); }} />
      )}
    </div>
  );
}

/* ============ aba CLIENTES ============ */
function Clientes({ dados, acoes, perfil }) {
  const podeVenda = perfil.papel !== "atendente";
  const [busca, setBusca] = useState("");
  const [chip, setChip] = useState("todos");
  const [sel, setSel] = useState(null);
  const [editCli, setEditCli] = useState(null);
  const [editVis, setEditVis] = useState(null);
  const [editVenda, setEditVenda] = useState(null);

  const info = useMemo(() => {
    const m = new Map();
    for (const c of dados.clientes) m.set(c.id, { visitas:[], vendas:[] });
    for (const v of dados.visitas) m.get(v.clienteId)?.visitas.push(v);
    for (const vd of dados.vendas) m.get(vd.clienteId)?.vendas.push(vd);
    for (const x of m.values()) x.visitas.sort((a,b)=>(b.d||"").localeCompare(a.d||""));
    return m;
  }, [dados]);

  const lista = useMemo(() => {
    let l = [...dados.clientes];
    if (busca.trim()) {
      const q = busca.trim().toLowerCase(), qd = soDigitos(q);
      l = l.filter((c)=>(c.nome||"").toLowerCase().includes(q) || (qd && soDigitos(c.t).includes(qd)));
    } else if (chip==="semvisita") l = l.filter((c)=>!(info.get(c.id)?.visitas.length));
    else if (chip==="compradores") l = l.filter((c)=>info.get(c.id)?.vendas.length);
    return l.sort((a,b)=>(a.nome||"").localeCompare(b.nome||"", "pt-BR"));
  }, [dados.clientes, busca, chip, info]);

  const selC = sel ? dados.clientes.find((c)=>c.id===sel) : null;
  const selInfo = selC ? info.get(selC.id) : null;
  const nomeCorretor = (id) => dados.perfis.find((p)=>p.id===id)?.nome || "—";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs" style={{ color:"#57614F" }}>
        Cada pessoa aparece uma única vez, com todo o histórico de visitas. “Sem visita” são os contatos que ainda não agendaram.
      </p>
      <input value={busca} onChange={(e)=>setBusca(e.target.value)} placeholder="Buscar nome ou telefone…"
        className="w-full rounded-lg border px-3 py-2.5 text-sm bg-white" style={bs} />
      <div className="flex gap-1.5 flex-wrap">
        {[["todos","Todos"],["semvisita","Sem visita"],["compradores","Compradores"]].map(([k,lab]) => (
          <button key={k} onClick={()=>{ setChip(k); setBusca(""); }}
            className="px-3 py-1.5 rounded-full text-xs font-semibold"
            style={ chip===k && !busca ? { background:C.verdeEsc, color:"#fff" } : { background:"#E1E5DA", color:C.ink }}>
            {lab}
          </button>
        ))}
      </div>

      {lista.map((c) => {
        const i = info.get(c.id) || { visitas:[], vendas:[] };
        const ult = i.visitas[0];
        return (
          <button key={c.id} onClick={()=>setSel(c.id)} className="rounded-xl p-3 text-left flex flex-col gap-1.5"
            style={{ background:C.card, border:`1px solid ${i.vendas.length ? "#E2CE8F" : C.linha}` }}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[15px] truncate" style={{ color:C.ink }}>
                {c.nome || <em className="opacity-50">sem nome</em>}
                {i.vendas.length > 0 && <span className="ml-1.5">💰</span>}
              </span>
              {ult ? <Badge s={ult.situacao} /> :
                <span className="text-[13px] shrink-0 font-semibold" style={{ color:"#8A55B0" }}>sem visita</span>}
            </div>
            <div className="text-xs flex flex-wrap gap-x-3" style={{ color:"#7C8674" }}>
              {c.t && <span style={{ color:C.terra }}>{c.t}</span>}
              {c.origem && <span>via {c.origem}</span>}
              {ult?.d ? <span>última: {fmtData(ult.d)}</span> :
                c.ultContato ? <span>último contato: {fmtData(c.ultContato)}</span> : null}
            </div>
          </button>
        );
      })}
      {lista.length === 0 && (
        <div className="text-center rounded-xl px-6 py-10" style={{ background:C.card, border:`1px dashed ${C.linha}` }}>
          <div className="text-[36px] mb-2">👥</div>
          <div className="text-[16px] font-bold" style={{ color:C.ink }}>Nenhum cliente aqui.</div>
          <div className="text-[15px] mt-1 leading-snug" style={{ color:"#7C8674" }}>
            Para cadastrar, toque no botão verde<br/>
            <b style={{ color:C.verde }}>+ Novo cliente</b>, ali embaixo à direita.
          </div>
        </div>
      )}

      <button onClick={()=>setEditCli({ nome:"", t:"", origem:"", obs:"" })}
        className="fixed bottom-24 right-5 rounded-full px-6 py-4 text-white font-bold text-base shadow-lg z-40"
        style={{ background:C.verde }}>+ Novo cliente</button>

      {selC && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background:"rgba(30,45,28,.55)" }}>
          <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto flex flex-col gap-3" style={{ background:C.papel }}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-bold text-lg leading-tight" style={{ color:C.verdeEsc, fontFamily:"'Archivo', sans-serif" }}>
                  {selC.nome || "(sem nome)"}
                </h3>
                {selC.origem && <div className="text-xs" style={{ color:"#7C8674" }}>via {selC.origem}</div>}
              </div>
              <button onClick={()=>setSel(null)} className="text-sm font-bold px-2" style={{ color:C.ink }}>✕</button>
            </div>
            <Contato tel={selC.t} />
            {selC.obs && <div className="text-xs leading-snug" style={{ color:"#57614F" }}>{selC.obs}</div>}
            <div className="flex gap-2 flex-wrap">
              <button onClick={()=>setEditVis({ d:hoje(), h:"", clienteId:selC.id, clienteFixo:true, corretor: perfil.papel==="corretor" ? perfil.id : "", situacao:"AGENDADA", obs:"" })}
                className="px-3 py-2 rounded-lg text-xs font-bold text-white" style={{ background:C.verde }}>+ Visita</button>
              {podeVenda && (
                <button onClick={()=>setEditVenda({ clienteId:selC.id, clienteFixo:true, d:hoje(), ch:"", vl:"", corretor:"", obs:"" })}
                  className="px-3 py-2 rounded-lg text-xs font-bold text-white" style={{ background:C.ouro }}>💰 Venda</button>
              )}
              <button onClick={()=>setEditCli(selC)}
                className="px-3 py-2 rounded-lg text-xs font-bold" style={{ background:"#E1E5DA", color:C.ink }}>Editar</button>
              <BotaoConfirmar rotulo="Excluir" aviso="Excluir tudo?" onOk={()=>{ acoes.excluirCliente(selC); setSel(null); }}
                className="px-3 py-2 rounded-lg text-xs font-bold" style={{ background:"#F1DBD8", color:C.alerta }} />
            </div>

            {selInfo.vendas.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="text-[13px] font-bold uppercase tracking-widest" style={{ color:C.ouro }}>Compras</div>
                {selInfo.vendas.map((vd) => (
                  <button key={vd.id} onClick={()=>podeVenda && setEditVenda({ ...vd, clienteFixo:true })}
                    className="rounded-lg p-2.5 text-left text-xs font-semibold"
                    style={{ background:C.card, border:"1px solid #E2CE8F", color:C.ink }}>
                    {vd.ch ? `Chácara ${vd.ch}` : "Chácara não informada"}
                    {podeVenda && vd.vl ? ` · ${fmtR$(vd.vl)}` : ""} · {fmtData(vd.d)}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <div className="text-[13px] font-bold uppercase tracking-widest" style={{ color:"#7C8674" }}>
                Histórico de visitas ({selInfo.visitas.length})
              </div>
              {selInfo.visitas.length === 0 && (
                <div className="text-xs py-2" style={{ color:"#7C8674" }}>Nenhuma visita registrada ainda.</div>
              )}
              {selInfo.visitas.map((v) => (
                <button key={v.id} onClick={()=>setEditVis({ ...v, clienteFixo:true })}
                  className="rounded-lg p-2.5 text-left flex items-center justify-between gap-2"
                  style={{ background:C.card, border:`1px solid ${C.linha}` }}>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold" style={{ color:C.ink }}>
                      {v.d ? `${fmtData(v.d)}${v.h ? " · "+v.h : ""}` : "sem data"}
                      {v.corretor && <span className="font-normal" style={{ color:"#7C8674" }}> · {nomeCorretor(v.corretor)}</span>}
                    </div>
                    {v.obs && <div className="text-[13px] truncate" style={{ color:"#7C8674" }}>{v.obs}</div>}
                  </div>
                  <Badge s={v.situacao} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {editCli && (
        <FormCliente inicial={editCli}
          onCancelar={()=>setEditCli(null)}
          onSalvar={(f)=>{ acoes.salvarCliente(f); setEditCli(null); }} />
      )}
      {editVis && (
        <FormVisita inicial={editVis} clientes={dados.clientes} perfis={dados.perfis}
          onCancelar={()=>setEditVis(null)}
          onSalvar={(f)=>{ acoes.salvarVisita(f); setEditVis(null); }}
          onExcluir={()=>{ acoes.excluirVisita(editVis); setEditVis(null); }} />
      )}
      {editVenda && (
        <FormVenda inicial={editVenda} clientes={dados.clientes} perfis={dados.perfis}
          onCancelar={()=>setEditVenda(null)}
          onSalvar={(f)=>{ acoes.salvarVenda(f); setEditVenda(null); }}
          onExcluir={editVenda.id ? ()=>{ acoes.excluirVenda(editVenda); setEditVenda(null); } : null} />
      )}
    </div>
  );
}

/* ============ aba VENDAS (só gestor) ============ */
function Vendas({ dados, acoes }) {
  const [edit, setEdit] = useState(null);
  const cliMap = useMemo(()=>new Map(dados.clientes.map((c)=>[c.id,c])), [dados.clientes]);
  const cli = (id) => cliMap.get(id) || { nome:"(cliente removido)", t:"" };
  const nomeCorretor = (id) => dados.perfis.find((p)=>p.id===id)?.nome || "";
  const vendas = useMemo(()=>[...dados.vendas].sort((a,b)=>(b.d||"").localeCompare(a.d||"")), [dados.vendas]);
  const total = vendas.reduce((s,v)=>s+(Number(v.vl)||0), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl p-3" style={{ background:C.verdeEsc }}>
          <div className="text-2xl font-bold text-white" style={{ fontFamily:"'Archivo', sans-serif" }}>{vendas.length}</div>
          <div className="text-[13px] font-semibold uppercase tracking-wide" style={{ color:"#9DBFA6" }}>chácaras vendidas</div>
        </div>
        <div className="rounded-xl p-3" style={{ background:C.ouro }}>
          <div className="text-2xl font-bold text-white" style={{ fontFamily:"'Archivo', sans-serif" }}>{fmtR$(total)}</div>
          <div className="text-[13px] font-semibold uppercase tracking-wide text-white opacity-80">valor total</div>
        </div>
      </div>
      {vendas.length === 0 && (
        <div className="text-center py-10 text-sm" style={{ color:"#7C8674" }}>
          Nenhuma venda registrada ainda.
        </div>
      )}
      {vendas.map((vd) => {
        const c = cli(vd.clienteId);
        return (
          <button key={vd.id} onClick={()=>setEdit({ ...vd, clienteFixo:true })} className="rounded-xl p-3 text-left flex flex-col gap-1"
            style={{ background:C.card, border:"1px solid #E2CE8F" }}>
            <div className="flex justify-between items-baseline gap-2">
              <span className="font-semibold text-[15px]" style={{ color:C.ink }}>{c.nome || "(sem nome)"}</span>
              <span className="font-bold text-sm" style={{ color:C.ouro }}>{vd.vl ? fmtR$(vd.vl) : "valor a definir"}</span>
            </div>
            <div className="text-xs" style={{ color:"#57614F" }}>
              {vd.ch ? `Chácara ${vd.ch}` : "Chácara não informada"} · {fmtData(vd.d)}
              {vd.corretor && nomeCorretor(vd.corretor) && ` · ${nomeCorretor(vd.corretor)}`}
            </div>
            {vd.obs && <div className="text-xs" style={{ color:"#7C8674" }}>{vd.obs}</div>}
          </button>
        );
      })}
      <button onClick={()=>setEdit({ clienteId:null, nome:"", tel:"", origem:"", d:hoje(), ch:"", vl:"", corretor:"", obs:"" })}
        className="fixed bottom-24 right-5 rounded-full px-6 py-4 text-white font-bold text-base shadow-lg z-40"
        style={{ background:C.ouro }}>+ Nova venda</button>
      {edit && (
        <FormVenda inicial={edit} clientes={dados.clientes} perfis={dados.perfis}
          onCancelar={()=>setEdit(null)}
          onSalvar={(f)=>{ acoes.salvarVenda(f); setEdit(null); }}
          onExcluir={edit.id ? ()=>{ acoes.excluirVenda(edit); setEdit(null); } : null} />
      )}
    </div>
  );
}

/* ============ documento de relatório para impressão/PDF ============ */
function ReportDoc({ dados, de, ate, onVoltar }) {
  const r = calcResumo(dados, de, ate);
  const mensal = calcMensal(dados);
  const porCorretor = calcPorCorretor(dados, de, ate);
  const cliMap = new Map(dados.clientes.map((c)=>[c.id,c]));
  const nomeCorretor = (id) => id ? (dados.perfis.find((p)=>p.id===id)?.nome || "—") : "—";

  const linhas = [
    ["Agendamentos no período", r.total],
    ["Visitaram (compareceram)", r.comp],
    ["Não compareceram", r.ncomp],
    ["Desmarcaram", r.desm],
    ["Reagendaram", r.reag],
    ["Sem resposta", r.semResp],
    ["Vendas no período", r.vendasP.length],
    ["Valor vendido", fmtR$(r.valor)],
    ["Taxa de comparecimento", r.taxa===null ? "—" : r.taxa+"%"],
    ["Conversão (vendas ÷ visitas)", r.conv===null ? "—" : r.conv+"%"],
  ];
  const th = { border:"1px solid #999", padding:"5px 8px", background:"#1E4230", color:"#fff", textAlign:"left", fontSize:"11px" };
  const td = { border:"1px solid #bbb", padding:"4px 8px", fontSize:"11px" };
  const agora = new Date();

  return (
    <div style={{ background:"#fff", minHeight:"100vh", color:"#111", fontFamily:"Arial, sans-serif" }}>
      <style>{`@media print { .no-print { display:none !important } body { background:#fff } }`}</style>
      <div className="no-print" style={{ background:"#1E4230", padding:"10px 16px", display:"flex", gap:"10px", justifyContent:"center" }}>
        <button onClick={()=>window.print()}
          style={{ background:"#9DBFA6", color:"#1E4230", fontWeight:700, border:"none", borderRadius:"8px", padding:"10px 18px", fontSize:"14px" }}>
          🖨 Imprimir / Salvar em PDF</button>
        <button onClick={onVoltar}
          style={{ background:"transparent", color:"#B9CFC0", fontWeight:700, border:"1px solid #4A6B57", borderRadius:"8px", padding:"10px 18px", fontSize:"14px" }}>
          ← Voltar</button>
      </div>
      <div style={{ maxWidth:"720px", margin:"0 auto", padding:"28px 24px" }}>
        <div style={{ borderBottom:"3px solid #1E4230", paddingBottom:"10px", marginBottom:"18px", display:"flex", alignItems:"center", gap:"14px" }}>
          <img src="./logo.svg" alt="" style={{ width:"64px" }} />
          <div>
            <div style={{ fontSize:"20px", fontWeight:800, color:"#1E4230", letterSpacing:"-0.3px" }}>JARDINS DO PONTAL</div>
            <div style={{ fontSize:"12px", color:"#555" }}>Relatório de visitas e vendas · período de {fmtData(de)} a {fmtData(ate)}</div>
          </div>
        </div>

        <table style={{ borderCollapse:"collapse", width:"100%", marginBottom:"22px" }}>
          <tbody>
            {linhas.map(([lab, val]) => (
              <tr key={lab}>
                <td style={{ ...td, width:"60%" }}>{lab}</td>
                <td style={{ ...td, fontWeight:700 }}>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {porCorretor.length > 0 && (
          <>
            <div style={{ fontSize:"13px", fontWeight:800, color:"#1E4230", margin:"0 0 6px" }}>Por corretor (período)</div>
            <table style={{ borderCollapse:"collapse", width:"100%", marginBottom:"22px" }}>
              <thead><tr>
                {["Corretor","Agend.","Visitou","Faltou","Vendas"].map((t)=><th key={t} style={th}>{t}</th>)}
              </tr></thead>
              <tbody>
                {porCorretor.map(([u, m]) => (
                  <tr key={u||"—"}>
                    <td style={{ ...td, fontWeight:700 }}>{nomeCorretor(u)}</td>
                    <td style={td}>{m.ag}</td><td style={td}>{m.c}</td><td style={td}>{m.n}</td>
                    <td style={{ ...td, fontWeight:700 }}>{m.v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {r.vendasP.length > 0 && (
          <>
            <div style={{ fontSize:"13px", fontWeight:800, color:"#1E4230", margin:"0 0 6px" }}>Vendas no período</div>
            <table style={{ borderCollapse:"collapse", width:"100%", marginBottom:"22px" }}>
              <thead><tr>
                <th style={th}>Data</th><th style={th}>Cliente</th><th style={th}>Chácara</th><th style={th}>Corretor</th><th style={th}>Valor</th>
              </tr></thead>
              <tbody>
                {r.vendasP.map((vd) => (
                  <tr key={vd.id}>
                    <td style={td}>{fmtData(vd.d)}</td>
                    <td style={td}>{cliMap.get(vd.clienteId)?.nome || "—"}</td>
                    <td style={td}>{vd.ch || "—"}</td>
                    <td style={td}>{nomeCorretor(vd.corretor)}</td>
                    <td style={td}>{vd.vl ? fmtR$(vd.vl) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div style={{ fontSize:"13px", fontWeight:800, color:"#1E4230", margin:"0 0 6px" }}>Histórico mês a mês (todo o período)</div>
        <table style={{ borderCollapse:"collapse", width:"100%" }}>
          <thead><tr>
            {["Mês","Agend.","Visitou","Faltou","Desm.","Reag.","Vendas","R$ vendido"].map((t)=><th key={t} style={th}>{t}</th>)}
          </tr></thead>
          <tbody>
            {mensal.map(([k, m]) => (
              <tr key={k}>
                <td style={{ ...td, fontWeight:700 }}>{mesLabel(k)}</td>
                <td style={td}>{m.t}</td><td style={td}>{m.c}</td><td style={td}>{m.n}</td>
                <td style={td}>{m.d}</td><td style={td}>{m.r}</td>
                <td style={{ ...td, fontWeight:700 }}>{m.v}</td>
                <td style={td}>{m.vl ? fmtR$(m.vl) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop:"20px", fontSize:"10px", color:"#888" }}>
          Gerado em {String(agora.getDate()).padStart(2,"0")}/{String(agora.getMonth()+1).padStart(2,"0")}/{agora.getFullYear()} · Agenda Jardins do Pontal
        </div>
      </div>
    </div>
  );
}

/* ============ aba RELATÓRIO (só gestor) ============ */
function Relatorio({ dados, onPdf, onImportar }) {
  const h = hoje();
  const [de, setDe] = useState(h.slice(0,8)+"01");
  const [ate, setAte] = useState(h);
  const [msgImport, setMsgImport] = useState("");
  const r = calcResumo(dados, de, ate);
  const mensal = useMemo(()=>calcMensal(dados).reverse(), [dados]);
  const porCorretor = useMemo(()=>calcPorCorretor(dados, de, ate), [dados, de, ate]);
  const nomeCorretor = (id) => id ? (dados.perfis.find((p)=>p.id===id)?.nome || "—") : "—";
  const fileRef = useRef(null);

  const cards = [
    ["Agendamentos", r.total, C.verdeEsc],
    ["Visitaram", r.comp, "#3B8A4E"],
    ["Não compareceram", r.ncomp, "#C24545"],
    ["Desmarcaram", r.desm, "#8B867D"],
    ["Reagendaram", r.reag, "#C99A2E"],
    ["Vendas", r.vendasP.length, C.ouro],
    ["Valor vendido", fmtR$(r.valor), C.ouro],
    ["Taxa de comparecimento", r.taxa===null ? "—" : r.taxa+"%", C.terra],
    ["Conversão (vendas ÷ visitas)", r.conv===null ? "—" : r.conv+"%", C.terra],
  ];

  const cliMap = new Map(dados.clientes.map((c)=>[c.id,c]));
  const baixarBackup = () => {
    const { clientes, visitas, vendas } = dados;
    const blob = new Blob([JSON.stringify({ clientes, visitas, vendas }, null, 1)], { type:"application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `agenda-jardins-do-pontal-${h}.json`;
    a.click();
  };
  const baixarCSV = () => {
    const linhas = [["Data","Hora","Cliente","Telefone","Corretor","Situação","Origem","Observações"]];
    const vs = dados.visitas.filter((v)=>v.d && v.d>=de && v.d<=ate)
      .sort((a,b)=>a.d===b.d ? (a.h||"").localeCompare(b.h||"") : a.d.localeCompare(b.d));
    for (const v of vs) {
      const c = cliMap.get(v.clienteId) || {};
      linhas.push([fmtData(v.d), v.h||"", c.nome||"", c.t||"", nomeCorretor(v.corretor), v.situacao, c.origem||"", (v.obs||"").replace(/\r?\n/g," ")]);
    }
    const csv = "﻿" + linhas.map((l)=>l.map((x)=>`"${String(x??"").replace(/"/g,'""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type:"text/csv;charset=utf-8" }));
    a.download = `visitas-${de}-a-${ate}.csv`;
    a.click();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-2">
        <label className="text-xs font-semibold flex-1" style={lbl}>De
          <input type="date" className={inp} style={bs} value={de} onChange={(e)=>setDe(e.target.value)} /></label>
        <label className="text-xs font-semibold flex-1" style={lbl}>Até
          <input type="date" className={inp} style={bs} value={ate} onChange={(e)=>setAte(e.target.value)} /></label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map(([lab2, val, cor]) => (
          <div key={lab2} className="rounded-xl p-3" style={{ background:C.card, border:`1px solid ${C.linha}` }}>
            <div className="text-xl font-bold leading-tight" style={{ color:cor, fontFamily:"'Archivo', sans-serif" }}>{val}</div>
            <div className="text-[13px] font-semibold uppercase tracking-wide" style={{ color:"#7C8674" }}>{lab2}</div>
          </div>
        ))}
      </div>

      {porCorretor.length > 0 && (
        <div>
          <div className="text-[13px] font-bold uppercase tracking-widest mb-2"
            style={{ color:"#7C8674", fontFamily:"'Archivo', sans-serif" }}>Por corretor (no período)</div>
          <div className="rounded-xl overflow-x-auto" style={{ border:`1px solid ${C.linha}` }}>
            <table className="w-full text-xs" style={{ background:C.card }}>
              <thead>
                <tr style={{ background:C.verdeEsc, color:"#fff" }}>
                  {["Corretor","Agend.","Visitou","Faltou","Vendas"].map((t)=>(
                    <th key={t} className="py-2 px-1.5 text-left font-semibold whitespace-nowrap">{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {porCorretor.map(([u, m], i) => (
                  <tr key={u||"—"} style={{ background: i%2 ? "#F6F8F2" : "#fff" }}>
                    <td className="py-1.5 px-1.5 font-semibold" style={{ color:C.ink }}>{nomeCorretor(u)}</td>
                    <td className="px-1.5">{m.ag}</td>
                    <td className="px-1.5" style={{ color:"#3B8A4E" }}>{m.c}</td>
                    <td className="px-1.5" style={{ color:"#C24545" }}>{m.n}</td>
                    <td className="px-1.5 font-bold" style={{ color:C.ouro }}>{m.v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <div className="text-[13px] font-bold uppercase tracking-widest mb-2"
          style={{ color:"#7C8674", fontFamily:"'Archivo', sans-serif" }}>Mês a mês (histórico completo)</div>
        <div className="rounded-xl overflow-x-auto" style={{ border:`1px solid ${C.linha}` }}>
          <table className="w-full text-xs" style={{ background:C.card }}>
            <thead>
              <tr style={{ background:C.verdeEsc, color:"#fff" }}>
                {["Mês","Agend.","Visitou","Faltou","Desm.","Reag.","Vendas","R$ vendido"].map((t)=>(
                  <th key={t} className="py-2 px-1.5 text-left font-semibold whitespace-nowrap">{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mensal.map(([k, m], i) => (
                <tr key={k} style={{ background: i%2 ? "#F6F8F2" : "#fff" }}>
                  <td className="py-1.5 px-1.5 font-semibold" style={{ color:C.ink }}>{mesLabel(k)}</td>
                  <td className="px-1.5">{m.t}</td>
                  <td className="px-1.5" style={{ color:"#3B8A4E" }}>{m.c}</td>
                  <td className="px-1.5" style={{ color:"#C24545" }}>{m.n}</td>
                  <td className="px-1.5">{m.d}</td>
                  <td className="px-1.5">{m.r}</td>
                  <td className="px-1.5 font-bold" style={{ color:C.ouro }}>{m.v}</td>
                  <td className="px-1.5 whitespace-nowrap" style={{ color:C.ouro }}>{m.vl ? fmtR$(m.vl) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={()=>onPdf(de, ate)} className="flex-1 py-2.5 rounded-lg text-sm font-bold text-white"
          style={{ background:C.verde }}>📄 Relatório em PDF</button>
        <button onClick={baixarCSV} className="px-4 py-2.5 rounded-lg text-xs font-bold"
          style={{ background:"#E1E5DA", color:C.ink }}>Exportar CSV</button>
        <button onClick={baixarBackup} className="px-4 py-2.5 rounded-lg text-xs font-bold"
          style={{ background:"#E1E5DA", color:C.ink }}>Backup (JSON)</button>
        <button onClick={()=>fileRef.current?.click()} className="px-4 py-2.5 rounded-lg text-xs font-bold"
          style={{ background:"#E4EDE2", color:C.verdeEsc }}>Importar dados (JSON)</button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
          onChange={(e) => {
            const arq = e.target.files?.[0];
            if (!arq) return;
            const leitor = new FileReader();
            leitor.onload = async () => {
              setMsgImport("Importando…");
              try {
                const n = await onImportar(String(leitor.result));
                setMsgImport(`Importação concluída: ${n.clientes} clientes, ${n.visitas} visitas, ${n.vendas} vendas.`);
              } catch (err) {
                setMsgImport("Erro na importação: " + (err?.message || "arquivo inválido"));
              }
            };
            leitor.readAsText(arq);
            e.target.value = "";
          }} />
      </div>
      {msgImport && (
        <div className="text-xs font-semibold rounded-lg px-3 py-2" style={{ background:"#E4EDE2", color:C.verdeEsc }}>{msgImport}</div>
      )}
      <p className="text-[13px] leading-snug" style={{ color:"#7C8674" }}>
        “Importar dados” aceita o backup do app antigo (artifact) ou o arquivo <b>dados-planilha.json</b> — registros repetidos
        são atualizados, nada é apagado. Rode uma vez só, na primeira configuração.
      </p>
    </div>
  );
}

/* ============ aba EQUIPE (só gestor) ============ */
function Equipe({ dados, acoes, perfil }) {
  const [msg, setMsg] = useState("");
  const lixeira = [...dados.excluidos].filter((e)=>e.dado).sort((a,b)=>b.ts-a.ts).slice(0,20);
  const rotuloLixo = (e) => {
    if (e.tipo==="cliente") return `cliente ${e.dado.nome||e.dado.t||"?"}`;
    if (e.tipo==="visita") return `visita de ${fmtData(e.dado.d)}`;
    if (e.tipo==="venda") return `venda ${e.dado.ch ? "chácara "+e.dado.ch : ""}`.trim();
    return e.tipo;
  };

  return (
    <div className="flex flex-col gap-4">
      {msg && <div className="text-xs font-semibold rounded-lg px-3 py-2" style={{ background:"#E4EDE2", color:C.verdeEsc }}>{msg}</div>}
      <div>
        <div className="text-[13px] font-bold uppercase tracking-widest mb-2"
          style={{ color:"#7C8674", fontFamily:"'Archivo', sans-serif" }}>Equipe</div>
        <div className="flex flex-col gap-2">
          {dados.perfis.map((p) => (
            <div key={p.id} className="rounded-xl p-3 flex items-center justify-between gap-2" style={{ background:C.card, border:`1px solid ${C.linha}` }}>
              <div className="min-w-0">
                <span className="font-semibold text-sm" style={{ color:C.ink }}>{p.nome}</span>
                {p.id===perfil.id && <span className="text-xs ml-1.5" style={{ color:"#7C8674" }}>(você)</span>}
              </div>
              <select className="rounded-lg border px-2 py-1.5 text-xs bg-white" style={bs} value={p.papel}
                onChange={(e)=>{ acoes.mudarPapel(p, e.target.value); setMsg(`${p.nome} agora é ${e.target.value}.`); }}>
                <option value="atendente">atendente</option>
                <option value="corretor">corretor</option>
                <option value="gestor">gestor</option>
              </select>
            </div>
          ))}
        </div>
        <p className="text-[13px] leading-snug mt-2" style={{ color:"#7C8674" }}>
          Para <b>adicionar</b> alguém: painel do Supabase → Authentication → Users → “Add user” (marque
          “Auto Confirm User”). A pessoa aparece aqui no primeiro acesso, como corretor — ajuste o papel acima.
          Para <b>trocar a senha</b> de alguém: mesmo lugar, no menu do usuário.
        </p>
      </div>

      {lixeira.length > 0 && (
        <div>
          <div className="text-[13px] font-bold uppercase tracking-widest mb-2"
            style={{ color:"#7C8674", fontFamily:"'Archivo', sans-serif" }}>Lixeira (últimos 30 dias)</div>
          <div className="flex flex-col gap-1.5">
            {lixeira.map((e) => (
              <div key={e.id} className="rounded-lg px-3 py-2 flex items-center justify-between gap-2 text-xs"
                style={{ background:C.card, border:`1px solid ${C.linha}` }}>
                <span style={{ color:C.ink }}>{rotuloLixo(e)} <span style={{ color:"#7C8674" }}>· {fmtTs(e.ts)}</span></span>
                <button onClick={()=>acoes.restaurarExcluido(e)} className="font-bold shrink-0" style={{ color:C.verde }}>restaurar</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-[13px] font-bold uppercase tracking-widest mb-2"
          style={{ color:"#7C8674", fontFamily:"'Archivo', sans-serif" }}>Atividade recente</div>
        <div className="flex flex-col gap-1">
          {dados.log.slice(0,30).map((l) => (
            <div key={l.id ?? l.ts+l.tx} className="text-[13px] px-1" style={{ color:"#57614F" }}>
              <span className="font-semibold" style={{ color:"#7C8674" }}>{fmtTs(l.ts)}</span> · <b>{l.u}</b> {l.tx}
            </div>
          ))}
          {dados.log.length === 0 && <div className="text-xs" style={{ color:"#7C8674" }}>Nenhuma atividade registrada ainda.</div>}
        </div>
      </div>

      <p className="text-[13px] leading-snug" style={{ color:"#7C8674" }}>
        <b>Gestor</b>: acesso total — vendas, relatório, equipe, lixeira. <b>Corretor</b>: Agenda e Clientes, registra a
        venda (com chácara e valor), mas não vê os painéis de Vendas, Relatório e Equipe. <b>Atendente</b>: agenda,
        confirma e atualiza visitas e clientes; não registra vendas nem vê valores.
      </p>
    </div>
  );
}

/* ============ minha senha ============ */
function MinhaSenha({ onFechar }) {
  const [s1, setS1] = useState("");
  const [s2, setS2] = useState("");
  const [msg, setMsg] = useState("");
  const trocar = async () => {
    if (s1.length < 6) { setMsg("A senha precisa de pelo menos 6 caracteres."); return; }
    if (s1 !== s2) { setMsg("As senhas não conferem."); return; }
    try { await ops.trocarMinhaSenha(s1); setMsg("Senha alterada!"); setTimeout(onFechar, 900); }
    catch { setMsg("Não foi possível trocar a senha agora."); }
  };
  return (
    <Modal>
      <Titulo>Trocar minha senha</Titulo>
      <div className="flex flex-col gap-3">
        <input type="password" placeholder="nova senha" className={inp} style={bs} value={s1} onChange={(e)=>setS1(e.target.value)} />
        <input type="password" placeholder="repetir nova senha" className={inp} style={bs} value={s2} onChange={(e)=>setS2(e.target.value)} />
        {msg && <div className="text-xs font-semibold" style={{ color:C.verdeEsc }}>{msg}</div>}
      </div>
      <div className="flex gap-2 mt-5">
        <button onClick={trocar} className="flex-1 py-2.5 rounded-lg text-white font-semibold text-sm" style={{ background:C.verde }}>Trocar</button>
        <button onClick={onFechar} className="px-4 py-2.5 rounded-lg text-sm font-semibold" style={{ background:"#E1E5DA", color:C.ink }}>Fechar</button>
      </div>
    </Modal>
  );
}

/* ============ login ============ */
function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const entrar = async () => {
    setOcupado(true); setErro("");
    const { error } = await db().auth.signInWithPassword({ email: email.trim(), password: senha });
    setOcupado(false);
    if (error) setErro(/credentials/i.test(error.message) ? "E-mail ou senha incorretos." : error.message);
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background:C.verdeEsc }}>
      <div className="w-full max-w-xs">
        <div className="mx-auto mb-4 w-28 h-24 rounded-2xl flex items-center justify-center" style={{ background:C.papel }}>
          <img src="./logo.svg" alt="Jardins do Pontal" className="w-20" />
        </div>
        <h1 className="text-white font-extrabold text-2xl tracking-tight text-center"
          style={{ fontFamily:"'Archivo', sans-serif", fontStretch:"112%" }}>JARDINS DO PONTAL</h1>
        <p className="text-center text-[13px] font-semibold tracking-[0.3em] mb-8" style={{ color:"#9DBFA6" }}>
          AGENDA DE VISITAS</p>
        <div className="flex flex-col gap-3">
          <input placeholder="e-mail" type="email" autoCapitalize="none" className="rounded-lg px-3 py-2.5 text-sm"
            value={email} onChange={(e)=>{setEmail(e.target.value); setErro("");}} />
          <input placeholder="senha" type="password" className="rounded-lg px-3 py-2.5 text-sm"
            value={senha} onChange={(e)=>{setSenha(e.target.value); setErro("");}}
            onKeyDown={(e)=>e.key==="Enter"&&entrar()} />
          {erro && <div className="text-xs font-semibold text-center" style={{ color:"#F0A8A0" }}>{erro}</div>}
          <button onClick={entrar} disabled={ocupado} className="py-2.5 rounded-lg font-bold text-sm disabled:opacity-50"
            style={{ background:"#9DBFA6", color:C.verdeEsc }}>{ocupado ? "Entrando…" : "Entrar"}</button>
        </div>
      </div>
    </div>
  );
}

/* ============ tela de configuração pendente ============ */
function Configurar() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background:C.verdeEsc }}>
      <div className="w-full max-w-md rounded-2xl p-6" style={{ background:C.papel }}>
        <h2 className="font-bold text-lg mb-3" style={{ color:C.verdeEsc }}>Falta configurar o Supabase</h2>
        <ol className="text-sm flex flex-col gap-2 list-decimal ml-4" style={{ color:C.ink }}>
          <li>No painel do Supabase, abra <b>Settings → API</b>.</li>
          <li>Copie a <b>Project URL</b> e a chave <b>anon public</b>.</li>
          <li>Abra o arquivo <b>config.js</b> (na pasta do app) e cole os dois valores.</li>
          <li>Recarregue esta página.</li>
        </ol>
      </div>
    </div>
  );
}

/* ============ app ============ */
export default function App() {
  const cfg = (typeof window !== "undefined" && window.PONTAL_CONFIG) || {};
  const configurado = (cfg.SUPABASE_URL||"").startsWith("https://") && (cfg.SUPABASE_ANON_KEY||"").length > 20;

  const [sessao, setSessao] = useState(undefined); // undefined = carregando
  const [perfil, setPerfil] = useState(null);
  const [dados, setDados] = useState(null);
  const [erroCarga, setErroCarga] = useState(false);
  const [aba, setAba] = useState("agenda");
  const [salvo, setSalvo] = useState("ok");
  const [pdf, setPdf] = useState(null);
  const [senhaAberta, setSenhaAberta] = useState(false);
  const refetchTimer = useRef(null);

  useEffect(() => {
    if (!configurado) return;
    initDb(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    db().auth.getSession().then(({ data })=>setSessao(data.session));
    const { data: sub } = db().auth.onAuthStateChange((_e, s)=>setSessao(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const recarregar = async () => {
    try {
      const d = await carregarTudo();
      setDados(d);
      setErroCarga(false);
      return d;
    } catch { setErroCarga(true); }
  };
  const agendarRefetch = () => {
    clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(recarregar, 700);
  };

  /* avisa quando a internet cai e recarrega quando volta */
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const ficouOnline = () => { setOnline(true); agendarRefetch(); };
    const ficouOffline = () => setOnline(false);
    window.addEventListener("online", ficouOnline);
    window.addEventListener("offline", ficouOffline);
    return () => { window.removeEventListener("online", ficouOnline); window.removeEventListener("offline", ficouOffline); };
  }, []);

  useEffect(() => {
    if (!sessao?.user) { setDados(null); setPerfil(null); return; }
    let ativo = true;
    (async () => {
      const d = await recarregar();
      if (!ativo || !d) return;
      const meu = d.perfis.find((p)=>p.id===sessao.user.id);
      setPerfil(meu || { id:sessao.user.id, nome:(sessao.user.email||"").split("@")[0], papel:"corretor" });
      ops.limparLixeiraAntiga();
    })();
    const des = assinar(agendarRefetch);
    const onVis = () => { if (document.visibilityState === "visible") agendarRefetch(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { ativo = false; des(); document.removeEventListener("visibilitychange", onVis); };
  }, [sessao?.user?.id]);

  /* executa uma operação: atualiza a tela na hora, grava no banco por trás */
  const exec = (novoDados, operacao, logTx) => {
    if (logTx) novoDados = { ...novoDados, log: [{ ts:Date.now(), u:perfil?.nome||"?", tx:logTx }, ...novoDados.log].slice(0,80) };
    setDados(novoDados);
    setSalvo("salvando");
    (async () => {
      try {
        await operacao();
        if (logTx) await ops.log(perfil?.nome||"?", logTx);
        setSalvo("ok");
      } catch { setSalvo("erro"); agendarRefetch(); }
    })();
  };

  const d0 = dados;
  const cliNome = (id) => d0?.clientes.find((c)=>c.id===id)?.nome || "cliente";
  const resolverCliente = (f) => {
    if (f.clienteId) return { clienteId:f.clienteId, clientes:d0.clientes, novo:null, nome:cliNome(f.clienteId) };
    const novo = { id:novoId(), nome:(f.nome||"").trim(), t:f.tel||"", origem:f.origem||"", obs:"", at:Date.now() };
    return { clienteId:novo.id, clientes:[...d0.clientes, novo], novo, nome:novo.nome||novo.t };
  };

  const acoes = {
    salvarVisita(f) {
      const { clienteId, clientes, novo, nome } = resolverCliente(f);
      let situacao = f.situacao;
      if (!f.d && (situacao==="AGENDADA" || situacao==="CONFIRMADA")) situacao = "AGENDAR";
      if (f.d && situacao==="AGENDAR") situacao = "AGENDADA";
      const vis = { id:f.id||novoId(), clienteId, d:f.d||"", h:f.h||"", corretor:f.corretor||"", situacao, obs:f.obs||"", at:Date.now() };
      const existe = d0.visitas.some((v)=>v.id===vis.id);
      exec(
        { ...d0, clientes, visitas: existe ? d0.visitas.map((v)=>v.id===vis.id ? vis : v) : [...d0.visitas, vis] },
        async () => { if (novo) await ops.upsertCliente(novo); await ops.upsertVisita(vis); },
        `${existe ? "editou" : "criou"} visita de ${nome}${vis.d ? " ("+fmtData(vis.d)+(vis.h ? " "+vis.h : "")+")" : ""}`
      );
    },
    statusVisita(v, s) {
      const vis = { ...v, situacao:s, at:Date.now() };
      exec(
        { ...d0, visitas: d0.visitas.map((x)=>x.id===v.id ? vis : x) },
        () => ops.upsertVisita(vis),
        `marcou ${cliNome(v.clienteId)} (${fmtData(v.d)}) → ${s}`
      );
    },
    reagendarVisita(v) {
      const fechada = { ...v, situacao:"REAGENDADA", at:Date.now() };
      const nova = { id:novoId(), clienteId:v.clienteId, d:"", h:"", corretor:v.corretor||"", situacao:"AGENDAR", obs:"", at:Date.now() };
      exec(
        { ...d0, visitas: [...d0.visitas.map((x)=>x.id===v.id ? fechada : x), nova] },
        async () => { await ops.upsertVisita(fechada); await ops.upsertVisita(nova); },
        `reagendou ${cliNome(v.clienteId)} (visita de ${fmtData(v.d)})`
      );
      return nova;
    },
    excluirVisita(v) {
      exec(
        { ...d0,
          visitas: d0.visitas.filter((x)=>x.id!==v.id),
          excluidos: [{ id:v.id, tipo:"visita", ts:Date.now(), dado:v }, ...d0.excluidos] },
        async () => { await ops.tombstone([{ id:v.id, tipo:"visita", dado:v }]); await ops.deletar("visitas", v.id); },
        `excluiu visita de ${cliNome(v.clienteId)} (${fmtData(v.d)})`
      );
    },
    salvarCliente(f) {
      const c = { id:f.id||novoId(), nome:(f.nome||"").trim(), t:f.t||"", origem:f.origem||"", obs:f.obs||"", ultContato:f.ultContato||"", at:Date.now() };
      const existe = d0.clientes.some((x)=>x.id===c.id);
      exec(
        { ...d0, clientes: existe ? d0.clientes.map((x)=>x.id===c.id ? c : x) : [...d0.clientes, c] },
        () => ops.upsertCliente(c),
        `${existe ? "editou" : "criou"} cliente ${c.nome||c.t}`
      );
    },
    excluirCliente(c) {
      const ts = Date.now();
      const visDele = d0.visitas.filter((v)=>v.clienteId===c.id);
      const venDele = d0.vendas.filter((v)=>v.clienteId===c.id);
      const tombs = [
        { id:c.id, tipo:"cliente", dado:c },
        ...visDele.map((v)=>({ id:v.id, tipo:"visita", dado:v })),
        ...venDele.map((v)=>({ id:v.id, tipo:"venda", dado:v })),
      ];
      exec(
        { ...d0,
          clientes: d0.clientes.filter((x)=>x.id!==c.id),
          visitas: d0.visitas.filter((v)=>v.clienteId!==c.id),
          vendas: d0.vendas.filter((v)=>v.clienteId!==c.id),
          excluidos: [...tombs.map((t)=>({ ...t, ts })), ...d0.excluidos] },
        async () => { await ops.tombstone(tombs); await ops.deletar("clientes", c.id); }, // o banco apaga visitas/vendas junto
        `excluiu cliente ${c.nome||c.t} (com ${visDele.length} visita(s))`
      );
    },
    salvarVenda(f) {
      const { clienteId, clientes, novo, nome } = resolverCliente(f);
      const vd = { id:f.id||novoId(), clienteId, d:f.d||"", ch:f.ch||"", vl:f.vl||"", corretor:f.corretor||"", obs:f.obs||"", at:Date.now() };
      const existe = d0.vendas.some((x)=>x.id===vd.id);
      const visAtualizada = f.visitaId ? d0.visitas.find((v)=>v.id===f.visitaId) : null;
      const visNova = visAtualizada ? { ...visAtualizada, situacao:"COMPARECEU", at:Date.now() } : null;
      exec(
        { ...d0, clientes,
          vendas: existe ? d0.vendas.map((x)=>x.id===vd.id ? vd : x) : [...d0.vendas, vd],
          visitas: visNova ? d0.visitas.map((v)=>v.id===visNova.id ? visNova : v) : d0.visitas },
        async () => {
          if (novo) await ops.upsertCliente(novo);
          await ops.upsertVenda(vd);
          if (visNova) await ops.upsertVisita(visNova);
        },
        `registrou venda${vd.ch ? " chácara "+vd.ch : ""}${vd.vl ? " · "+fmtR$(vd.vl) : ""} (${nome})`
      );
    },
    excluirVenda(vd) {
      exec(
        { ...d0,
          vendas: d0.vendas.filter((x)=>x.id!==vd.id),
          excluidos: [{ id:vd.id, tipo:"venda", ts:Date.now(), dado:vd }, ...d0.excluidos] },
        async () => { await ops.tombstone([{ id:vd.id, tipo:"venda", dado:vd }]); await ops.deletar("vendas", vd.id); },
        `excluiu venda${vd.ch ? " chácara "+vd.ch : ""} (${cliNome(vd.clienteId)})`
      );
    },
    restaurarExcluido(e) {
      const tabela = { cliente:"clientes", visita:"visitas", venda:"vendas" }[e.tipo];
      if (!tabela || !e.dado) return;
      const chave = { cliente:"clientes", visita:"visitas", venda:"vendas" }[e.tipo];
      const up = { cliente:ops.upsertCliente, visita:ops.upsertVisita, venda:ops.upsertVenda }[e.tipo];
      exec(
        { ...d0, [chave]: [...d0[chave], e.dado], excluidos: d0.excluidos.filter((x)=>x.id!==e.id) },
        async () => { await up(e.dado); await ops.removerTombstone(e.id); },
        `restaurou ${e.tipo} da lixeira`
      );
    },
    mudarPapel(p, papel) {
      exec(
        { ...d0, perfis: d0.perfis.map((x)=>x.id===p.id ? { ...x, papel } : x) },
        () => ops.mudarPerfil(p.id, { papel }),
        `mudou o papel de ${p.nome} para ${papel}`
      );
    },
  };

  const importarDados = async (texto) => {
    const j = JSON.parse(texto);
    let pacote;
    if (j.clientes) pacote = { clientes:j.clientes, visitas:j.visitas||[], vendas:j.vendas||[] };
    else if (j.visitas) pacote = migrarLegado(j, Date.now());
    else throw new Error("Formato não reconhecido.");
    await ops.importarLote(pacote);
    await ops.log(perfil?.nome||"?", `importou ${pacote.clientes.length} clientes e ${pacote.visitas.length} visitas`);
    await recarregar();
    return { clientes:pacote.clientes.length, visitas:pacote.visitas.length, vendas:pacote.vendas.length };
  };

  const sair = () => db().auth.signOut();
  const [sairAberto, setSairAberto] = useState(false);

  if (!configurado) return <Configurar />;
  if (sessao === undefined) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background:C.papel }}>
      <div className="text-sm font-semibold" style={{ color:C.verdeEsc }}>Carregando a agenda…</div>
    </div>
  );
  if (!sessao) return <Login />;
  if (!dados || !perfil) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background:C.papel }}>
      <div className="text-sm font-semibold" style={{ color:C.verdeEsc }}>
        {erroCarga ? "Não foi possível carregar. Verifique a internet e recarregue a página." : "Carregando a agenda…"}
      </div>
    </div>
  );

  const gestor = perfil.papel === "gestor";

  if (pdf && gestor) {
    return <ReportDoc dados={dados} de={pdf.de} ate={pdf.ate} onVoltar={()=>setPdf(null)} />;
  }

  const abas = gestor
    ? [["agenda","Agenda","cal"],["clientes","Clientes","users"],["vendas","Vendas","coin"],["relatorio","Relatório","chart"],["equipe","Equipe","team"]]
    : [["agenda","Agenda","cal"],["clientes","Clientes","users"]];
  const tituloAba = (abas.find(([k])=>k===aba)||[])[1] || "";

  return (
    <div className="min-h-screen" style={{ background:C.papel }}>
      <header className="sticky top-0 z-40 px-4" style={{ background:C.verdeEsc, paddingTop:"calc(env(safe-area-inset-top) + 14px)", paddingBottom:"12px" }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-11 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background:C.papel }}>
              <img src="./logo.svg" alt="" className="w-8" />
            </div>
            <h1 className="text-white font-extrabold text-lg tracking-tight leading-tight"
              style={{ fontFamily:"'Archivo', sans-serif", fontStretch:"112%" }}>
              JARDINS DO PONTAL
              <span className="block text-[13px] font-semibold tracking-[0.22em]" style={{ color:"#9DBFA6" }}>
                AGENDA DE VISITAS
              </span>
            </h1>
          </div>
          <div className="text-right">
            <div className="text-[14px] font-semibold mb-0.5" style={{ color: (!online || salvo==="erro") ? "#F0A8A0" : "#9DBFA6" }}>
              {!online ? "sem internet ⚠" : salvo==="salvando" ? "salvando…" : salvo==="erro" ? "erro ao salvar" : "tudo salvo ✓"}
            </div>
            <button onClick={()=>setSenhaAberta(true)} className="text-[15px] font-bold py-1" style={{ color:"#DCE7DE" }}>
              {perfil.nome}</button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-4 pb-28">
        {!online && (
          <div className="rounded-xl px-4 py-3 mb-3 text-[15px] font-semibold leading-snug"
            style={{ background:"#FBEAE7", color:C.alerta, border:"1px solid #E7B8B0" }}>
            ⚠ Sem internet. Dá para ver os dados, mas o que for alterado agora <u>não será salvo</u> — faça a alteração de novo quando a conexão voltar.
          </div>
        )}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-extrabold text-2xl" style={{ color:C.verdeEsc, fontFamily:"'Archivo', sans-serif" }}>{tituloAba}</h2>
            {aba==="relatorio" && (
              <div className="text-[15px] font-semibold" style={{ color:C.verde }}>números e PDF</div>
            )}
          </div>
          <button onClick={()=>setSairAberto(true)} className="flex items-center gap-2 text-[16px] font-bold px-4 rounded-xl"
            style={{ color:C.verde, background:"#E4EDE2", minHeight:"48px" }}>
            <IconeAba nome="exit" cor={C.verde} /> Sair
          </button>
        </div>
        {aba==="agenda" && <Agenda dados={dados} acoes={acoes} perfil={perfil} />}
        {aba==="clientes" && <Clientes dados={dados} acoes={acoes} perfil={perfil} />}
        {gestor && aba==="vendas" && <Vendas dados={dados} acoes={acoes} />}
        {gestor && aba==="relatorio" && <Relatorio dados={dados} onPdf={(de, ate)=>setPdf({ de, ate })} onImportar={importarDados} />}
        {gestor && aba==="equipe" && <Equipe dados={dados} acoes={acoes} perfil={perfil} />}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 flex"
        style={{ background:"#FFFFFF", borderTop:"1px solid "+C.linha, paddingBottom:"env(safe-area-inset-bottom)" }}>
        <div className="max-w-2xl mx-auto w-full flex">
          {abas.map(([k, lab, ic]) => {
            const on = aba===k;
            return (
              <button key={k} onClick={()=>setAba(k)}
                className="relative flex-1 flex flex-col items-center justify-center gap-1 pt-3 pb-2.5"
                style={{ color: on ? C.verdeEsc : "#8A9487", background: on ? "#EAF1E8" : "transparent", minHeight:"64px" }}>
                {on && <span className="absolute top-0 rounded-b-full" style={{ width:"44px", height:"4px", background:C.ouro }} />}
                <IconeAba nome={ic} cor={on ? C.ouro : "#8A9487"} />
                <span className="text-[14px]" style={{ fontWeight: on ? 800 : 600 }}>{lab}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {senhaAberta && <MinhaSenha onFechar={()=>setSenhaAberta(false)} />}
      {sairAberto && (
        <Confirmar titulo="Deseja sair do aplicativo?"
          texto="Para entrar de novo, você vai precisar do seu e-mail e senha."
          rotuloSim="Sim, sair" onSim={sair} onNao={()=>setSairAberto(false)} />
      )}
    </div>
  );
}

/* ============ ícones do menu (SVG simples, sem dependências) ============ */
function IconeAba({ nome, cor="#1E4230" }) {
  const p = { width:26, height:26, viewBox:"0 0 24 24", fill:"none", stroke:cor, strokeWidth:2, strokeLinecap:"round", strokeLinejoin:"round" };
  if (nome==="cal") return (<svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>);
  if (nome==="users") return (<svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>);
  if (nome==="coin") return (<svg {...p}><circle cx="12" cy="12" r="9"/><path d="M14.5 9a2.5 2 0 0 0-2.5-1.5c-1.4 0-2.5.7-2.5 1.8 0 2.7 5 1.3 5 4 0 1.2-1.2 1.9-2.5 1.9A2.7 2 0 0 1 9.3 15M12 6v1.5M12 16.5V18"/></svg>);
  if (nome==="chart") return (<svg {...p}><path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6"/><rect x="12" y="7" width="3" height="10"/><rect x="17" y="13" width="3" height="4"/></svg>);
  if (nome==="team") return (<svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><circle cx="19" cy="8" r="2.2"/><path d="M23 21v-1.5a3 3 0 0 0-2.5-2.9"/></svg>);
  if (nome==="exit") return (<svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>);
  return null;
}
