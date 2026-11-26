/* PDV - interface (roda no navegador, em modo aplicativo) */
{
// ======================= Utilidades =======================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const R = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const N2 = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const QT = (v, u) => u === 'KG' ? Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const num = s => { s = String(s ?? '').trim().replace(/[^\d,.-]/g, ''); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); return parseFloat(s) || 0; };
const hoje = () => new Date().toLocaleDateString('sv-SE');
const dataBR = s => s ? new Date(s.replace(' ', 'T')).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const diaBR = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '';
const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const guardar = (k, v) => { try { localStorage.setItem('pdv_' + k, JSON.stringify(v)); } catch (e) {} };
const ler = (k, p) => { try { const v = localStorage.getItem('pdv_' + k); return v ? JSON.parse(v) : p; } catch (e) { return p; } };

async function api(acao, dados = {}, arquivo = null) {
  const op = { method: 'POST', credentials: 'same-origin' };
  if (arquivo) { const f = new FormData(); f.append('arquivo', arquivo); for (const k in dados) f.append(k, dados[k]); op.body = f; }
  else { op.body = JSON.stringify(dados); op.headers = { 'Content-Type': 'application/json' }; }
  let r, j;
  try { r = await fetch('api.php?acao=' + acao, op); }
  catch (e) { throw new Error('O servidor do PDV não respondeu. Feche e abra o programa novamente.'); }
  const txt = await r.text();
  try { j = JSON.parse(txt); }
  catch (e) { throw new Error('Resposta inesperada do servidor (' + r.status + '): ' + (txt.replace(/<[^>]+>/g, ' ').trim().slice(0, 300) || 'vazia')); }
  if (!j.ok) { const e = new Error(j.erro || 'Erro'); e.code = r.status; if (r.status === 401) telaLogin(); if (r.status === 402) telaLicenca(j.licenca || {}); throw e; }
  return j;
}
function toast(msg, tipo = '') {
  const t = document.createElement('div'); t.className = 'toast ' + tipo; t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), tipo === 'er' ? 6000 : 3500);
}
function modal({ titulo, corpo, botoes = [], lg = false, aoAbrir, fechavel = true }) {
  const f = document.createElement('div'); f.className = 'fundo';
  f.innerHTML = `<div class="modal ${lg ? 'lg' : ''}" role="dialog"><header><h3>${titulo}</h3>${fechavel ? '<button class="btn gh sm" data-x>✕</button>' : ''}</header>
    <div class="corpo">${corpo}</div>${botoes.length ? '<footer></footer>' : ''}</div>`;
  const fechar = () => { f.remove(); document.removeEventListener('keydown', tecla, true); };
  const tecla = e => { if (e.key === 'Escape' && fechavel && $('#modais').lastElementChild === f) { e.stopPropagation(); fechar(); } };
  document.addEventListener('keydown', tecla, true);
  botoes.forEach(b => {
    const el = document.createElement('button'); el.className = 'btn ' + (b.cls || ''); el.innerHTML = b.txt;
    el.onclick = async () => { if (b.acao) { el.disabled = true; try { if (await b.acao(f) !== false) fechar(); } catch (e) { toast(e.message, 'er'); } el.disabled = false; } else fechar(); };
    $('footer', f).append(el);
  });
  f.addEventListener('click', e => { if (e.target.closest('[data-x]')) fechar(); });
  $('#modais').append(f); if (aoAbrir) aoAbrir(f, fechar);
  setTimeout(() => { const i = $('input:not([type=file]):not([readonly]),select,textarea', f); if (i && !i.dataset.nofoco) i.focus(); }, 30);
  return { el: f, fechar };
}
function pedirPIN(motivo) {
  return new Promise(res => {
    let feito = false;
    const m = modal({ titulo: 'Senha do gerente', corpo: `<p style="margin-top:0">${esc(motivo)}</p><input type="password" inputmode="numeric" id="pinG" placeholder="Senha" autocomplete="off">`,
      botoes: [{ txt: 'Cancelar' }, { txt: 'Confirmar', cls: 'pri', acao: f => { feito = true; res($('#pinG', f).value); } }] });
    $('#pinG', m.el).addEventListener('keydown', e => { if (e.key === 'Enter') $('footer .pri', m.el).click(); });
    new MutationObserver((_, o) => { if (!m.el.isConnected) { o.disconnect(); if (!feito) res(null); } }).observe($('#modais'), { childList: true });
  });
}
function confirmar(titulo, texto, ok = 'Confirmar', cls = 'pri') {
  return new Promise(res => {
    let feito = false;
    const m = modal({ titulo, corpo: `<p style="margin:0;font-size:16px">${texto}</p>`, botoes: [{ txt: 'Não' }, { txt: ok, cls, acao: () => { feito = true; res(true); } }] });
    new MutationObserver((_, o) => { if (!m.el.isConnected) { o.disconnect(); if (!feito) res(false); } }).observe($('#modais'), { childList: true });
  });
}
// tenta uma ação; se precisar de gerente, pede a senha e repete
async function comGerente(fn, motivo) {
  try { return await fn(null); }
  catch (e) { if (e.code !== 403) throw e; const pin = await pedirPIN(motivo || e.message); if (!pin) throw new Error('Operação cancelada.'); return fn(pin); }
}
function qrSVG(texto, tam = 150) {
  const q = new window.QRCodeLib(-1, window.QRLevel.M); q.addData(texto); q.make();
  const n = q.getModuleCount(); let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
  return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" width="${tam}" height="${tam}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ======================= Ícones =======================
const IC = {
  caixa: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"/><circle cx="10" cy="20.5" r="1"/><circle cx="17" cy="20.5" r="1"/>',
  painel: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  produtos: '<path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/>',
  entrada: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 18v-6M9 15l3 3 3-3"/>',
  clientes: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a5 5 0 0 0-4-5"/>',
  vendas: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4"/>',
  conciliacao: '<path d="M3 7h13l-3-3M21 17H8l3 3M7 11v2M17 11v2"/>',
  auditoria: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  dinheiro: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  pix: '<path d="M12 2l4 4-4 4-4-4zM12 14l4 4-4 4-4-4zM2 12l4-4 4 4-4 4zM14 12l4-4 4 4-4 4z"/>',
  debito: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  credito: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h2M11 15h2"/>',
  fiado: '<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4zM8 9h8M8 13h5"/>',
};
const ico = (n, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[n] || ''}</svg>`;
const FORMAS = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito', fiado: 'Fiado' };

// ======================= Estado =======================
const S = { est: null, u: null, cfg: {}, tela: ler('tela', 'caixa'), caixa: null, alertas: null,
  venda: ler('venda', null) || novaVenda() };
function novaVenda() { return { itens: [], desconto: 0, cpf: '', cliente: null, mult: 1, sel: -1 }; }
function salvarVenda() { guardar('venda', S.venda); }

const TELAS = [
  { id: 'caixa', nome: 'Caixa', ic: 'caixa', todos: true },
  { id: 'painel', nome: 'Painel do dono', ic: 'painel' },
  { id: 'produtos', nome: 'Produtos e estoque', ic: 'produtos' },
  { id: 'entrada', nome: 'Entrada de notas', ic: 'entrada' },
  { id: 'clientes', nome: 'Clientes e fiado', ic: 'clientes', todos: true },
  { id: 'vendas', nome: 'Vendas e NFC-e', ic: 'vendas', todos: true },
  { id: 'conciliacao', nome: 'Conciliação', ic: 'conciliacao' },
  { id: 'auditoria', nome: 'Auditoria', ic: 'auditoria' },
  { id: 'config', nome: 'Configurações', ic: 'config' },
];

// ======================= Início =======================
async function iniciar() {
  let l = null;
  try { l = (await api('licenca_estado')).licenca; } catch (e) { if (e.code === 402) return; }
  // Primeiro o cliente faz o cadastro da empresa; o pedido de acesso vai no final
  if (l && l.status !== 'ativa') {
    let est = null; try { est = await api('estado'); } catch (e) {}
    if (est && !est.configurado && ['sem_licenca', 'pendente'].includes(l.status)) { S.est = est; S.cfg = est.config; return assistente(); }
    if (l.status === 'sem_licenca' && !l.msg) return enviarPedido();
    return telaLicenca(l);
  }
  try { S.est = await api('estado'); } catch (e) { $('#cheia').innerHTML = `<div class="tela-cheia"><div class="login"><h2>Não foi possível iniciar</h2><p>${esc(e.message)}</p></div></div>`; return; }
  S.cfg = S.est.config;
  if (!S.est.configurado) return assistente();
  if (!S.est.usuario) return telaLogin();
  S.u = S.est.usuario; montarApp();
}

function telaLogin() {
  $('#app').classList.add('hide'); let pin = '';
  $('#cheia').innerHTML = `<div class="tela-cheia"><div class="login">
    <div class="marca" style="justify-content:center;border:0;padding:0;min-height:0"><div class="logo">${ico('caixa', 24).replace('currentColor', '#fff')}</div></div>
    <h2>${esc(S.cfg.emp_fantasia || 'PDV')}</h2><div style="color:var(--mut)">Digite sua senha</div>
    <div class="pinvis">${'<i></i>'.repeat(4)}</div>
    <div class="teclado">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-n="${n}">${n}</button>`).join('')}<button data-n="c" style="font-size:16px">Limpar</button><button data-n="0">0</button><button data-n="ok" style="background:var(--verde);color:#fff;font-size:16px">Entrar</button></div>
  </div></div>`;
  const vis = () => $$('.pinvis i').forEach((i, k) => i.classList.toggle('f', k < pin.length));
  const entrar = async () => {
    try { const r = await api('login', { pin }); S.u = r.usuario; S.est = await api('estado'); S.cfg = S.est.config; $('#cheia').innerHTML = ''; document.removeEventListener('keydown', tec); montarApp(); }
    catch (e) { pin = ''; vis(); toast(e.message, 'er'); }
  };
  const tecla = n => { if (n === 'c') pin = ''; else if (n === 'ok') return entrar(); else if (pin.length < 8) pin += n; vis(); if (pin.length >= 4 && n !== 'c') { /* espera Enter p/ senhas maiores */ } };
  $$('.teclado button').forEach(b => b.onclick = () => tecla(b.dataset.n));
  const tec = e => { if (/^\d$/.test(e.key)) tecla(e.key); else if (e.key === 'Enter') tecla('ok'); else if (e.key === 'Backspace') { pin = pin.slice(0, -1); vis(); } };
  document.addEventListener('keydown', tec);
}

function montarApp() {
  $('#app').classList.remove('hide'); $('#cheia').innerHTML = '';
  $('#app').classList.toggle('mini', ler('mini', false));
  $('#nomeLoja').textContent = S.cfg.emp_fantasia || S.cfg.emp_razao || 'PDV';
  $('#nomeUser').textContent = S.u.nome + (S.u.perfil === 'gerente' ? ' · gerente' : '');
  TELAS.find(t => t.id === 'produtos').nome = { nfce: 'Produtos e estoque', nfse: 'Serviços', ambos: 'Produtos e serviços' }[S.cfg.emissao || 'nfce'];
  TELAS.find(t => t.id === 'vendas').nome = { nfce: 'Vendas e NFC-e', nfse: 'Vendas e NFS-e', ambos: 'Vendas e notas' }[S.cfg.emissao || 'nfce'];
  $('#menu').innerHTML = TELAS.filter(t => t.todos || S.u.perfil === 'gerente').map(t => `<a href="#${t.id}" data-t="${t.id}" title="${t.nome}">${ico(t.ic)}<span>${t.nome}</span><em class="bdg hide" data-b="${t.id}"></em></a>`).join('');
  $$('#menu a').forEach(a => a.onclick = e => { e.preventDefault(); ir(a.dataset.t); });
  $('#btnMini').onclick = () => { const m = !$('#app').classList.contains('mini'); $('#app').classList.toggle('mini', m); guardar('mini', m); };
  $('#btnSair').onclick = async () => { await api('sair').catch(() => {}); S.u = null; telaLogin(); };
  const t = TELAS.find(x => x.id === S.tela && (x.todos || S.u.perfil === 'gerente')) ? S.tela : 'caixa';
  ir(t); atualizarStatus();
}
function ir(t) {
  S.tela = t; guardar('tela', t);
  $$('#menu a').forEach(a => a.classList.toggle('on', a.dataset.t === t));
  $('#titulo').textContent = TELAS.find(x => x.id === t).nome; $('#topoExtra').innerHTML = '';
  $('#tela').innerHTML = '<div class="vazio">Carregando…</div>';
  Promise.resolve(({ caixa: telaCaixa, painel: telaPainel, produtos: telaProdutos, entrada: telaEntrada, clientes: telaClientes, vendas: telaVendas, conciliacao: telaConciliacao, auditoria: telaAuditoria, config: telaConfig })[t]())
    .catch(e => { if (e.code !== 402 && e.code !== 401) { toast(e.message, 'er'); $('#tela').innerHTML = `<div class="vazio">${esc(e.message)}</div>`; } });
}
async function atualizarStatus() {
  try {
    const a = await api('alertas'); S.alertas = a; const amb = S.cfg.ambiente || 'homologacao';
    let p = amb === 'homologacao' ? '<span class="pill p-av"><i></i>NFC-e em teste (homologação)</span>' : '<span class="pill p-ok"><i></i>NFC-e produção</span>';
    if (a.contingencia) p += ` <span class="pill p-er" title="Serão transmitidas automaticamente"><i></i>${a.contingencia} em contingência</span>`;
    if (a.cert_dias !== null && a.cert_dias <= 30) p += ` <span class="pill p-er"><i></i>Certificado vence em ${a.cert_dias} dias</span>`;
    $('#pillFiscal').innerHTML = p;
    const bp = $('[data-b=produtos]'); const n = a.estoque_baixo.length + a.validade.length;
    if (bp) { bp.textContent = n; bp.classList.toggle('hide', !n); }
    const bv = $('[data-b=vendas]'); const m = a.contingencia + a.rejeitadas;
    if (bv) { bv.textContent = m; bv.classList.toggle('hide', !m); }
  } catch (e) {}
}
// Transmite notas de contingência sozinho quando a internet volta
setInterval(async () => {
  if (!S.u || !S.alertas?.contingencia) return;
  try { const r = await api('contingencia_transmitir'); if (r.enviadas) { toast(`${r.enviadas} nota(s) de contingência autorizadas pela SEFAZ.`, 'ok'); atualizarStatus(); } } catch (e) {}
}, 60000);

// ======================= Acesso (pedido / liberação / bloqueio) =======================
let esperaLib = null;
async function enviarPedido() {
  telaLicenca({ status: 'enviando' });
  try { const r = await api('licenca_solicitar'); if (r.licenca.status === 'ativa') { $('#cheia').innerHTML = ''; return iniciar(); } telaLicenca(r.licenca); }
  catch (e) { telaLicenca({ status: 'sem_licenca', msg: e.message, erroEnvio: true }); }
}
function telaLicenca(l) {
  clearInterval(esperaLib);
  $('#app').classList.add('hide'); $$('#modais .fundo').forEach(m => m.remove());
  const tel = String(l.contato || '').replace(/\D/g, '');
  const contato = l.contato ? `<p class="ajuda" style="margin-top:14px">Suporte: <b>${esc(l.contato)}</b>${tel.length >= 10 ? ` · <a href="https://wa.me/55${tel}" target="_blank">chamar no WhatsApp</a>` : ''}</p>` : '';
  const cnpj = String(l.cnpj || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  const empresa = l.empresa ? `<div class="lic-emp"><b>${esc(l.empresa)}</b>${cnpj ? `<span>CNPJ ${esc(cnpj)}</span>` : ''}</div>` : '';
  const ic = {
    relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    cadeado: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/>',
    envio: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>',
    calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
    wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0"/><circle cx="12" cy="19.5" r="1"/>'
  };
  const T = {
    enviando: ['envio', 'var(--verde)', 'Enviando o cadastro…', 'Só um instante.', ''],
    pendente: ['relogio', 'var(--verde)', 'Cadastro enviado!', 'Agora é só aguardar a liberação do acesso. Assim que for liberado, o sistema abre sozinho — pode deixar esta tela aberta.',
      `<div class="lic-espera"><i></i>Aguardando liberação</div><button class="btn lg" id="licV" style="width:100%">Verificar agora</button>`],
    sem_licenca: ['envio', 'var(--verde)', l.erroEnvio ? 'Não foi possível enviar' : 'Pedir acesso de novo', esc(l.msg || 'Envie o pedido de acesso.'), `<button class="btn pri lg" id="licE" style="width:100%">Enviar pedido de acesso</button>`],
    bloqueada: ['cadeado', 'var(--tomate)', 'Acesso bloqueado', 'O uso deste sistema foi suspenso. Entre em contato com o suporte para liberar.', `<button class="btn pri lg" id="licV" style="width:100%">Verificar de novo</button>`],
    vencida: ['calendario', 'var(--ambar)', 'Acesso vencido', esc(l.msg || 'A vigência do acesso terminou. Entre em contato para renovar.'), `<button class="btn pri lg" id="licV" style="width:100%">Já renovei, verificar</button>`],
    relogio: ['relogio', 'var(--tomate)', 'Relógio do computador errado', esc(l.msg || 'Acerte a data e a hora do Windows.'), `<button class="btn pri lg" id="licV" style="width:100%">Já acertei, verificar</button>`],
    offline_demais: ['wifi', 'var(--tomate)', 'Conecte à internet', 'Faz muitos dias que o sistema não consegue confirmar o acesso. Conecte este computador à internet e clique em Verificar.', `<button class="btn pri lg" id="licV" style="width:100%">Verificar de novo</button>`],
  }[l.status] || ['cadeado', 'var(--tomate)', 'Acesso', esc(l.msg || ''), `<button class="btn pri lg" id="licV" style="width:100%">Verificar de novo</button>`];
  $('#cheia').innerHTML = `<div class="tela-cheia"><div class="login" style="width:min(460px,100%)">
    <div style="color:${T[1]}"><svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic[T[0]]}</svg></div>
    <h2>${T[2]}</h2>${empresa}<p style="color:var(--mut)">${T[3]}</p>${T[4]}${contato}</div></div>`;
  const conferir = async (avisar) => {
    try { const r = await api('licenca_estado', { forcar: 1 }); const n = r.licenca;
      if (n.status === 'ativa') { clearInterval(esperaLib); toast('Acesso liberado!', 'ok'); $('#cheia').innerHTML = ''; return iniciar(); }
      if (n.status !== l.status || avisar) { if (avisar && n.status === l.status) toast(l.status === 'pendente' ? 'Ainda aguardando liberação.' : 'Ainda sem acesso.', 'er'); if (n.status !== l.status) telaLicenca(n); }
    } catch (e) { if (avisar) toast(e.message, 'er'); }
  };
  if ($('#licV')) $('#licV').onclick = () => conferir(true);
  if ($('#licE')) $('#licE').onclick = enviarPedido;
  if (l.status === 'pendente') esperaLib = setInterval(() => conferir(false), 20000);
}
// Confere a licença de tempos em tempos (o bloqueio vale em até 10 minutos)
setInterval(async () => { if (!S.u) return; try { const l = (await api('licenca_estado')).licenca; if (l.status !== 'ativa') telaLicenca(l); } catch (e) {} }, 5 * 60000);

// ======================= Assistente de configuração =======================
function assistente(passo = 1, dados = {}) {
  const nomes = ['Início', 'Empresa', 'Nota fiscal', 'Teste', 'Maquininha'];
  const c = { ...S.cfg, ...dados };
  const topo = `<div class="passos">${nomes.map((n, i) => i === 0 ? '' : `<div class="${i === passo ? 'on' : i < passo ? 'feito' : ''}">${i < passo ? '✓ ' : ''}${n}</div>`).join('')}</div>`;
  const campo = (k, rot, tipo = 'text', extra = '') => `<div class="campo"><label for="w_${k}">${rot}</label><input id="w_${k}" data-k="${k}" type="${tipo}" value="${esc(c[k] ?? '')}" ${extra}></div>`;
  let corpo = '';
  if (passo === 1) corpo = `<h2>Bem-vindo! Dados da empresa</h2><p class="ajuda" style="margin-bottom:14px">Digite o CNPJ e clique em Buscar: o resto é preenchido sozinho.</p>
    <div class="linha" style="align-items:flex-end"><div style="flex:1">${campo('emp_cnpj', 'CNPJ', 'text', 'inputmode="numeric" placeholder="00.000.000/0000-00"')}</div><button class="btn pri" id="wBusca" style="margin-bottom:12px">Buscar</button></div>
    <div class="grid g2">${campo('emp_razao', 'Razão social')}${campo('emp_fantasia', 'Nome fantasia (aparece no cupom)')}</div>
    <div class="grid g3">${campo('emp_ie', 'Inscrição Estadual', 'text', 'inputmode="numeric"')}
      <div class="campo"><label>Regime</label><select data-k="emp_crt"><option value="1">Simples Nacional</option><option value="4">MEI</option><option value="3">Regime normal</option></select></div>${campo('emp_fone', 'Telefone')}</div>
    <div class="grid g3">${campo('emp_logradouro', 'Endereço')}${campo('emp_numero', 'Número')}${campo('emp_bairro', 'Bairro')}</div>
    <div class="grid g4">${campo('emp_municipio', 'Cidade')}${campo('emp_uf', 'UF', 'text', 'maxlength="2"')}${campo('emp_cep', 'CEP')}${campo('emp_cmun', 'Cód. IBGE da cidade')}</div>`;
  const emi = c.emissao || 'nfce';
  if (passo === 2) corpo = `<h2>Nota fiscal</h2><p class="ajuda" style="margin-bottom:10px">O que a sua empresa vende? Isso define qual nota o sistema emite em cada venda.</p>
    <input type="hidden" data-k="emissao" id="wEmi" value="${emi}">
    <div class="escolha emi" style="grid-template-columns:repeat(3,minmax(0,1fr));margin:0 0 16px">
      <button type="button" data-e="nfce" class="${emi === 'nfce' ? 'on' : ''}"><b>Produtos</b><span>Nota de consumidor (NFC-e) — mercado, loja, padaria</span></button>
      <button type="button" data-e="nfse" class="${emi === 'nfse' ? 'on' : ''}"><b>Serviços</b><span>Nota de serviço (NFS-e) — barbearia, salão, clínica, oficina</span></button>
      <button type="button" data-e="ambos" class="${emi === 'ambos' ? 'on' : ''}"><b>Os dois</b><span>Vende produtos e presta serviços — cada um sai na sua nota</span></button>
    </div>
    <p class="ajuda" style="margin-bottom:10px">O certificado A1 serve para as duas notas e fica guardado só neste computador, com a senha criptografada.</p>
    <div class="card" style="box-shadow:none;border:1px solid var(--linha);margin-bottom:14px">
      <div class="grid g2"><div class="campo"><label>Certificado digital A1 (.pfx ou .p12)</label><input type="file" id="wCert" accept=".pfx,.p12"></div>
      <div class="campo"><label>Senha do certificado</label><input type="password" id="wSenha" autocomplete="off"></div></div>
      <button class="btn" id="wEnvCert">Validar certificado</button> <span id="wCertInfo" class="ajuda">${c.cert_validade ? '✓ Certificado válido até ' + c.cert_validade.split('-').reverse().join('/') : ''}</span>
    </div>
    <div class="campo" style="max-width:320px"><label>Ambiente</label><select data-k="ambiente"><option value="homologacao">Teste (homologação)</option><option value="producao">Produção (valendo)</option></select></div>
    <div id="wNfce" class="${emi === 'nfse' ? 'hide' : ''}"><h3 style="margin:6px 0 8px;font-size:16px">NFC-e (produtos)</h3>
      <div class="grid g2">${campo('csc', 'CSC (código de segurança do contribuinte)')}${campo('csc_id', 'ID do CSC', 'text', 'placeholder="ex.: 1 ou 000001"')}</div>
      <div class="grid g2">${campo('nfce_serie', 'Série da NFC-e', 'number', 'min="1"')}${campo('nfce_numero', 'Próximo número da NFC-e', 'number', 'min="1"')}</div>
      <p class="ajuda">Use uma série diferente da do sistema antigo (ex.: 2) enquanto os dois existirem. O CSC você pega com o contador ou no portal da SEFAZ do seu estado.</p></div>
    <div id="wNfse" class="${emi === 'nfce' ? 'hide' : ''}"><h3 style="margin:14px 0 8px;font-size:16px">NFS-e (serviços) — emissor nacional</h3>
      <div class="grid g3">${campo('nfse_im', 'Inscrição municipal (se tiver)')}${campo('nfse_serie', 'Série da DPS', 'number', 'min="1" max="49999" placeholder="1"')}${campo('nfse_numero', 'Próximo número da DPS', 'number', 'min="1" placeholder="1"')}</div>
      <p class="ajuda">A NFS-e sai pelo sistema nacional (nfse.gov.br), com o mesmo certificado A1. Se a empresa já emitia NFS-e por outro sistema, continue a numeração dele ou use outra série. O código de cada serviço é informado no cadastro do serviço.</p></div>`;
  if (passo === 3) corpo = `<h2>Testando tudo</h2><p class="ajuda" style="margin-bottom:14px">Conferindo se está tudo pronto para emitir.</p><div id="wChecks"></div><button class="btn" id="wRetestar">Testar de novo</button>`;
  if (passo === 4) corpo = `<h2>Maquininha de cartão</h2>
    <div class="campo"><label>Como você recebe cartão?</label><select data-k="maquininha" id="wMaq">
      <option value="manual">Maquininha separada (o caixa digita o valor e confirma no sistema)</option>
      <option value="stone">Stone integrada (o valor vai sozinho para a maquininha)</option>
      <option value="mp">Mercado Pago Point integrada (o valor vai sozinho para a maquininha)</option></select></div>
    <div id="wSt" class="${c.maquininha === 'stone' ? '' : 'hide'}">${campo('stone_sk', 'Secret Key da loja (Stone / Pagar.me)', 'password')}${campo('stone_parceiro', 'Seu ID de parceiro Stone')}${campo('stone_serial', 'Número de série da maquininha')}</div>
    <div id="wMp" class="${c.maquininha === 'mp' ? '' : 'hide'}">${campo('mp_token', 'Access Token do Mercado Pago (produção)', 'password')}
      <p class="ajuda">No site mercadopago.com.br/developers → Suas integrações → Criar aplicação → Credenciais de produção. Depois você escolhe a maquininha em Configurações.</p></div>
    <p class="ajuda">Ao concluir, o cadastro é enviado para liberação do acesso. A senha inicial do gerente é <b>1234</b> — troque em Configurações → Usuários depois de entrar.</p>`;
  $('#cheia').innerHTML = `<div class="tela-cheia"><div class="wiz">${topo}<div class="corpo">${corpo}</div>
    ${passo ? `<div class="linha" style="padding:0 26px 22px;justify-content:space-between"><button class="btn ${passo === 1 ? 'hide' : ''}" id="wVoltar">Voltar</button><button class="btn pri lg" id="wProx">${passo === 4 ? 'Concluir cadastro' : 'Continuar'}</button></div>` : ''}</div></div>`;
  $$('#cheia select[data-k]').forEach(s => { if (c[s.dataset.k]) s.value = c[s.dataset.k]; });
  const coletar = () => { $$('#cheia [data-k]').forEach(i => { dados[i.dataset.k] = i.value.trim(); }); return dados; };
  $('#wVoltar').onclick = () => assistente(passo - 1, coletar());
  if (passo === 1) {
    const buscar = async () => { try { const r = await api('cnpj_consulta', { cnpj: $('#w_emp_cnpj').value }); Object.assign(dados, r.dados, { emp_cnpj: $('#w_emp_cnpj').value });
      if (r.dados.situacao && r.dados.situacao !== 'ATIVA') toast('Atenção: situação do CNPJ é ' + r.dados.situacao, 'er'); assistente(1, dados); toast('Dados encontrados. Confira e complete a Inscrição Estadual.', 'ok'); } catch (e) { toast(e.message, 'er'); } };
    $('#wBusca').onclick = buscar; $('#w_emp_cnpj').onkeydown = e => { if (e.key === 'Enter') buscar(); };
  }
  if (passo === 2) {
    $$('.emi button').forEach(b => b.onclick = () => { $$('.emi button').forEach(x => x.classList.toggle('on', x === b)); $('#wEmi').value = b.dataset.e; $('#wNfce').classList.toggle('hide', b.dataset.e === 'nfse'); $('#wNfse').classList.toggle('hide', b.dataset.e === 'nfce'); });
    $('#wEnvCert').onclick = async () => {
      const f = $('#wCert').files[0]; if (!f) return toast('Escolha o arquivo do certificado.', 'er');
      try { const r = await api('certificado', { senha: $('#wSenha').value }, f); dados.cert_validade = r.info.validade;
        $('#wCertInfo').innerHTML = `<b style="color:var(--verde)">✓ ${esc(r.info.nome)} · válido até ${r.info.validade.split('-').reverse().join('/')}</b>`;
        if (r.info.cnpj && dados.emp_cnpj && r.info.cnpj !== dados.emp_cnpj.replace(/\D/g, '')) toast('Atenção: o CNPJ do certificado é diferente do CNPJ da empresa.', 'er');
      } catch (e) { toast(e.message, 'er'); }
    };
  }
  if (passo === 3) {
    const testar = async () => {
      const ck = (ok, t, d = '') => `<div class="check ${ok === null ? '' : ok ? 'ok' : 'er'}"><div class="ic">${ok === null ? '…' : ok ? '✓' : '!'}</div><div><b>${t}</b><div class="ajuda">${esc(d)}</div></div></div>`;
      const soServ = (c.emissao || 'nfce') === 'nfse';
      let h = ck(!!(c.emp_cnpj && c.emp_razao && (soServ || c.emp_ie) && c.emp_cmun), 'Dados da empresa', !c.emp_cmun ? 'Falta o código IBGE da cidade (use Buscar no passo anterior).' : (!soServ && !c.emp_ie ? 'Falta a Inscrição Estadual (obrigatória para NFC-e).' : ''));
      h += ck(!!c.cert_validade, 'Certificado A1', c.cert_validade ? 'Válido até ' + c.cert_validade.split('-').reverse().join('/') : 'Envie o certificado no passo anterior.');
      if ((c.emissao || 'nfce') !== 'nfse') h += ck(!!(c.csc && c.csc_id), 'CSC configurado (NFC-e)');
      if (!soServ) h += ck(!!S.est.biblioteca, 'Biblioteca fiscal da NFC-e (sped-nfe)', S.est.biblioteca ? 'Instalada' : 'Reinstale o PDV pelo site.');
      $('#wChecks').innerHTML = h + ck(null, 'Conexão com a Receita / SEFAZ', 'Testando…');
      try { const r = await api('sefaz_status'); $('#wChecks').lastElementChild.outerHTML = (r.itens || [{ tipo: 'Conexão', ok: r.ok, msg: r.msg }]).map(x => ck(x.ok, 'Conexão ' + x.tipo, x.msg)).join(''); }
      catch (e) { $('#wChecks').lastElementChild.outerHTML = ck(false, 'Conexão com a Receita / SEFAZ', e.message); }
    };
    $('#wRetestar').onclick = testar; testar();
  }
  if (passo === 4) $('#wMaq').onchange = e => { $('#wMp').classList.toggle('hide', e.target.value !== 'mp'); $('#wSt').classList.toggle('hide', e.target.value !== 'stone'); };
  $('#wProx').onclick = async () => {
    coletar();
    if (passo === 1 && (!dados.emp_cnpj || !dados.emp_razao || !dados.emp_uf)) return toast('Preencha CNPJ, razão social e UF.', 'er');
    if (passo === 1) dados.emp_uf = dados.emp_uf.toUpperCase();
    if (passo === 2 && !dados.nfce_serie) { dados.nfce_serie = '2'; }
    if (passo === 2 && !dados.nfce_numero) { dados.nfce_numero = '1'; }
    if (passo === 2 && !dados.nfse_serie) { dados.nfse_serie = '1'; }
    if (passo === 2 && !dados.nfse_numero) { dados.nfse_numero = '1'; }
    const envio = { ...dados }; delete envio.cert_validade; if (passo === 4) envio.configurado = '1';
    try { const r = await api('config_salvar', envio); S.cfg = r.config; } catch (e) { return toast(e.message, 'er'); }
    if (passo === 4) { location.reload(); return; }
    assistente(passo + 1, dados);
  };
}

// ======================= CAIXA (PDV) =======================
function precoItem(it) {
  if (it.total_etiqueta) return { unit: r2(it.total_etiqueta / it.qtd), total: r2(it.total_etiqueta) };
  const p = it.p; let u = +p.preco;
  if (p.promo_qtd && it.qtd >= +p.promo_qtd && p.promo_preco) u = +p.promo_preco;
  return { unit: u, total: r2(it.qtd * u) };
}
const subtotal = () => r2(S.venda.itens.reduce((s, i) => s + precoItem(i).total, 0));
const totalVenda = () => r2(subtotal() - (S.venda.desconto || 0));

async function telaCaixa() {
  try { const r = await api('caixa_atual'); S.caixa = r.caixa; S.resumo = r.resumo; } catch (e) { return; }
  if (!S.caixa) {
    $('#tela').innerHTML = `<div style="display:grid;place-items:center;height:100%"><div class="card" style="width:min(420px,100%);text-align:center;padding:30px">
      <div style="color:var(--verde)">${ico('caixa', 46)}</div><h2 style="font-size:22px;margin:10px 0 4px">Caixa fechado</h2><p class="ajuda" style="margin-bottom:18px">Informe o troco inicial (fundo de caixa) para começar a vender.</p>
      <input id="fundo" inputmode="decimal" placeholder="R$ 0,00" style="font-size:24px;text-align:center;margin-bottom:14px"><button class="btn pri lg" id="abrir" style="width:100%">Abrir caixa</button></div></div>`;
    const abrir = async () => { try { await api('caixa_abrir', { valor: num($('#fundo').value) }); toast('Caixa aberto. Boas vendas!', 'ok'); telaCaixa(); } catch (e) { toast(e.message, 'er'); } };
    $('#abrir').onclick = abrir; $('#fundo').onkeydown = e => { if (e.key === 'Enter') abrir(); }; $('#fundo').focus();
    return;
  }
  $('#topoExtra').innerHTML = `<button class="btn sm" id="tSup">+ Suprimento</button><button class="btn sm" id="tSan">Sangria</button><button class="btn sm" id="tFec">Fechar caixa</button>`;
  $('#tSup').onclick = () => movCaixa('suprimento'); $('#tSan').onclick = () => movCaixa('sangria'); $('#tFec').onclick = fecharCaixa;
  $('#tela').innerHTML = `<div class="pdv">
    <div class="esq">
      <div class="leitor"><span class="mult" id="mult"></span><input id="cod" placeholder="Passe o código de barras ou digite o nome do produto" autocomplete="off"><button class="btn" id="bBusca">Buscar <kbd>F2</kbd></button></div>
      <div class="cesta"><table><thead><tr><th style="width:34px">#</th><th>Produto</th><th class="r">Qtd</th><th class="r">Unitário</th><th class="r">Total</th></tr></thead><tbody id="itens"></tbody></table><div id="cestaVazia" class="vazio">Caixa livre. Passe o primeiro produto.</div></div>
    </div>
    <div class="dir">
      <div class="visor"><div class="rot">TOTAL A PAGAR</div><div class="tot" id="vTot">R$ 0,00</div><div class="ult" id="vUlt"><span style="opacity:.7">Nenhum item ainda</span></div></div>
      <div class="info-venda" id="vInfo"></div>
      <div class="atalhos">
        <button class="btn" data-a="qtd">Quantidade <kbd>F3</kbd></button><button class="btn" data-a="desc">Desconto <kbd>F4</kbd></button>
        <button class="btn" data-a="cpf">CPF / Cliente <kbd>F6</kbd></button><button class="btn" data-a="rem">Remover item <kbd>F8</kbd></button>
        <button class="btn" data-a="canc">Cancelar venda <kbd>F9</kbd></button><button class="btn" data-a="busca">Buscar produto <kbd>F2</kbd></button>
      </div>
      <button class="btn pri finalizar" data-a="pagar">Finalizar venda <kbd>F10</kbd></button>
    </div></div>`;
  $('#bBusca').onclick = () => buscarProduto('');
  $$('.atalhos .btn, .finalizar').forEach(b => b.onclick = () => acaoPDV(b.dataset.a));
  const cod = $('#cod');
  cod.onkeydown = async e => {
    if (e.key !== 'Enter') return;
    let v = cod.value.trim(); cod.value = '';
    if (!v) { if (S.venda.itens.length) acaoPDV('pagar'); return; }
    const m = v.match(/^(\d+(?:[.,]\d+)?)\s*[*xX]\s*(.*)$/);
    if (m) { S.venda.mult = num(m[1]) || 1; v = m[2].trim(); mostrarMult(); if (!v) return; }
    if (/^\d{3,14}$/.test(v)) {
      try { const r = await api('produto_codigo', { codigo: v }); adicionar(r.produto, r.qtd ?? S.venda.mult, r.total_etiqueta); }
      catch (err) { bip(false); toast(err.message, 'er'); }
    } else buscarProduto(v);
  };
  desenharCesta(); cod.focus();
}
function mostrarMult() { const el = $('#mult'); if (el) el.textContent = S.venda.mult !== 1 ? QT(S.venda.mult) + ' ×' : ''; }
function bip(ok = true) {
  try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(); const g = a.createGain(); o.connect(g); g.connect(a.destination);
    o.frequency.value = ok ? 1500 : 300; g.gain.value = .08; o.start(); o.stop(a.currentTime + (ok ? .07 : .25)); } catch (e) {}
}
function adicionar(p, qtd, totalEtiqueta) {
  qtd = +qtd || 1;
  const ult = S.venda.itens[S.venda.itens.length - 1];
  if (!totalEtiqueta && ult && ult.p.id === p.id && !ult.total_etiqueta && p.unidade !== 'KG') ult.qtd = r2(ult.qtd + qtd);
  else S.venda.itens.push({ p, qtd, total_etiqueta: totalEtiqueta || null });
  if (p.tipo !== 'servico' && p.estoque !== null && +p.estoque - qtd < 0 && p.unidade !== 'KG') toast(`Estoque de "${p.nome}" ficará negativo. Lance a entrada da nota depois.`);
  S.venda.mult = 1; S.venda.sel = S.venda.itens.length - 1; mostrarMult(); bip(); salvarVenda(); desenharCesta(true);
}
function desenharCesta(novo) {
  const tb = $('#itens'); if (!tb) return;
  const v = S.venda;
  tb.innerHTML = v.itens.map((it, k) => { const pr = precoItem(it); const promo = it.p.promo_qtd && it.qtd >= +it.p.promo_qtd && !it.total_etiqueta;
    return `<tr data-k="${k}" class="cl ${k === v.sel ? 'sel' : ''} ${novo && k === v.itens.length - 1 ? 'novo' : ''}"><td class="num" style="color:var(--mut)">${k + 1}</td>
    <td><div class="nome">${esc(it.p.nome)}${promo ? ' <span class="chip p-ok">promoção</span>' : ''}${it.p.tipo === 'servico' ? ' <span class="chip p-in">serviço</span>' : ''}</div><div class="cod">${esc(it.p.codigo || (it.p.tipo === 'servico' ? 'serviço' : 'balança ' + (it.p.cod_balanca || '')))}</div></td>
    <td class="r">${QT(it.qtd, it.p.unidade)} ${esc(it.p.unidade)}</td><td class="r">${N2(pr.unit)}</td><td class="r"><b>${N2(pr.total)}</b></td></tr>`; }).join('');
  $('#cestaVazia').classList.toggle('hide', v.itens.length > 0);
  $$('#itens tr').forEach(tr => tr.onclick = () => { v.sel = +tr.dataset.k; desenharCesta(); });
  const sel = $('#itens tr.sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
  $('#vTot').textContent = R(totalVenda());
  const u = v.itens[v.itens.length - 1];
  $('#vUlt').innerHTML = u ? `<b>${esc(u.p.nome)}</b>${QT(u.qtd, u.p.unidade)} ${esc(u.p.unidade)} × ${R(precoItem(u).unit)} = ${R(precoItem(u).total)}` : '<span style="opacity:.7">Nenhum item ainda</span>';
  const qtdItens = v.itens.reduce((s, i) => s + (i.p.unidade === 'KG' ? 1 : i.qtd), 0);
  $('#vInfo').innerHTML = `<div><span>Itens</span><b class="num">${QT(qtdItens)}</b></div><div><span>Subtotal</span><b class="num">${R(subtotal())}</b></div>
    ${v.desconto ? `<div><span>Desconto</span><b class="num desce">- ${R(v.desconto)}</b></div>` : ''}
    ${v.cpf ? `<div><span>CPF na nota</span><b>${esc(v.cpf)}</b></div>` : ''}${v.cliente ? `<div><span>Cliente</span><b>${esc(v.cliente.nome)}</b></div>` : ''}
    <div><span>Operador</span><span>${esc(S.u.nome)}</span></div>`;
}
document.addEventListener('keydown', e => {
  if (S.tela !== 'caixa' || !S.u || $('#modais').children.length || !$('#cod')) return;
  const mapa = { F2: 'busca', F3: 'qtd', F4: 'desc', F6: 'cpf', F8: 'rem', F9: 'canc', F10: 'pagar', F12: 'pagar' };
  if (mapa[e.key]) { e.preventDefault(); acaoPDV(mapa[e.key]); return; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const n = S.venda.itens.length; if (!n) return; S.venda.sel = Math.max(0, Math.min(n - 1, (S.venda.sel < 0 ? n : S.venda.sel) + (e.key === 'ArrowUp' ? -1 : 1))); desenharCesta(); return; }
  if (e.key === 'Escape') { $('#cod').value = ''; S.venda.mult = 1; mostrarMult(); }
  if (document.activeElement.tagName !== 'INPUT') $('#cod').focus();
});
async function acaoPDV(a) {
  const v = S.venda; const foco = () => setTimeout(() => $('#cod')?.focus(), 50);
  if (a === 'busca') return buscarProduto('');
  if (a === 'qtd') {
    if (v.sel < 0 || !v.itens[v.sel]) { // define multiplicador para o próximo item
      const m = modal({ titulo: 'Quantidade do próximo item', corpo: '<input id="q" inputmode="decimal" placeholder="Ex.: 6">', botoes: [{ txt: 'OK', cls: 'pri', acao: f => { v.mult = num($('#q', f).value) || 1; mostrarMult(); foco(); } }] });
      $('#q', m.el).onkeydown = e => { if (e.key === 'Enter') $('footer .pri', m.el).click(); }; return;
    }
    const it = v.itens[v.sel];
    const m = modal({ titulo: 'Alterar quantidade', corpo: `<p style="margin-top:0"><b>${esc(it.p.nome)}</b></p><input id="q" inputmode="decimal" value="${QT(it.qtd, it.p.unidade)}">`,
      botoes: [{ txt: 'Salvar', cls: 'pri', acao: f => { const q = num($('#q', f).value); if (q <= 0) throw new Error('Quantidade inválida.'); if (it.total_etiqueta) throw new Error('Item de balança: passe a etiqueta de novo.'); it.qtd = q; salvarVenda(); desenharCesta(); foco(); } }] });
    $('#q', m.el).select(); $('#q', m.el).onkeydown = e => { if (e.key === 'Enter') $('footer .pri', m.el).click(); }; return;
  }
  if (a === 'desc') {
    if (!v.itens.length) return;
    const m = modal({ titulo: 'Desconto na venda', corpo: `<div class="grid g2"><div class="campo"><label>Em reais</label><input id="dv" inputmode="decimal" value="${v.desconto ? N2(v.desconto) : ''}"></div><div class="campo"><label>ou em %</label><input id="dp" inputmode="decimal"></div></div><p class="ajuda">Subtotal: ${R(subtotal())}. Desconto pode pedir a senha do gerente ao finalizar.</p>`,
      botoes: [{ txt: 'Remover desconto', acao: () => { v.desconto = 0; salvarVenda(); desenharCesta(); foco(); } }, { txt: 'Aplicar', cls: 'pri', acao: f => { const p = num($('#dp', f).value); const d = p ? r2(subtotal() * p / 100) : num($('#dv', f).value); if (d >= subtotal()) throw new Error('Desconto maior que o total.'); v.desconto = d; salvarVenda(); desenharCesta(); foco(); } }] });
    $$('input', m.el).forEach(i => i.onkeydown = e => { if (e.key === 'Enter') $('footer .pri', m.el).click(); }); return;
  }
  if (a === 'cpf') {
    const m = modal({ titulo: 'CPF na nota / cliente', corpo: `<div class="campo"><label>CPF do consumidor (opcional)</label><input id="cpf" inputmode="numeric" value="${esc(v.cpf)}" placeholder="000.000.000-00"></div>
      <div class="campo"><label>Cliente cadastrado (para fiado)</label><input id="cb" placeholder="Digite o nome" data-nofoco="1"><div id="cl" style="max-height:220px;overflow:auto;margin-top:6px"></div></div>${v.cliente ? `<p>Cliente atual: <b>${esc(v.cliente.nome)}</b> <button class="btn sm" id="tiraCli">remover</button></p>` : ''}`,
      botoes: [{ txt: 'Salvar', cls: 'pri', acao: f => { const c = $('#cpf', f).value.replace(/\D/g, ''); if (c && !cpfValido(c)) throw new Error('CPF inválido.'); v.cpf = c ? c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : ''; salvarVenda(); desenharCesta(); foco(); } }] });
    const lista = async t => { const r = await api('clientes', { busca: t }); $('#cl', m.el).innerHTML = r.lista.slice(0, 20).map(c => `<div class="paglista"><div><span>${esc(c.nome)} <small class="ajuda">saldo ${R(c.saldo)}</small></span><button class="btn sm" data-id="${c.id}">Escolher</button></div></div>`).join('') || '<p class="ajuda">Nenhum cliente.</p>';
      $$('[data-id]', m.el).forEach(b => b.onclick = () => { v.cliente = r.lista.find(c => c.id == b.dataset.id); if (v.cliente.cpf && !$('#cpf', m.el).value) $('#cpf', m.el).value = v.cliente.cpf; toast('Cliente: ' + v.cliente.nome, 'ok'); salvarVenda(); desenharCesta(); }); };
    $('#cb', m.el).oninput = e => lista(e.target.value); lista('');
    if ($('#tiraCli', m.el)) $('#tiraCli', m.el).onclick = () => { v.cliente = null; salvarVenda(); desenharCesta(); m.fechar(); foco(); };
    $('#cpf', m.el).onkeydown = e => { if (e.key === 'Enter') $('footer .pri', m.el).click(); }; return;
  }
  if (a === 'rem') {
    if (v.sel < 0 || !v.itens[v.sel]) return toast('Selecione o item com as setas ↑ ↓ ou clicando nele.');
    const it = v.itens[v.sel];
    if (!await confirmar('Remover item', `Remover <b>${esc(it.p.nome)}</b> da venda?`, 'Remover', 'dan')) return foco();
    const det = `${it.p.nome} · ${String(it.qtd).replace('.', ',')} × ${R(it.preco ?? it.p.preco)}`;
    try { await comGerente(pin => api('caixa_ocorrencia', { tipo: 'item_removido', detalhe: det, pin }), `Remover "${it.p.nome}" da venda`); } catch (e) { toast(e.message, 'er'); return foco(); }
    v.itens.splice(v.sel, 1); v.sel = v.itens.length - 1; salvarVenda(); desenharCesta(); return foco();
  }
  if (a === 'canc') {
    if (!v.itens.length) return;
    if (!await confirmar('Cancelar venda', 'Limpar todos os itens desta venda?', 'Cancelar venda', 'dan')) return foco();
    const det = `${v.itens.length} itens · ${R(subtotal())}: ` + v.itens.slice(0, 8).map(i => i.p.nome).join(', ') + (v.itens.length > 8 ? '…' : '');
    try { await comGerente(pin => api('caixa_ocorrencia', { tipo: 'venda_limpa', detalhe: det, pin }), 'Cancelar a venda em andamento'); } catch (e) { toast(e.message, 'er'); return foco(); }
    S.venda = novaVenda(); salvarVenda(); desenharCesta(); mostrarMult(); return foco();
  }
  if (a === 'pagar') { if (!v.itens.length) return toast('Passe pelo menos um produto.'); return pagamento(); }
}
function cpfValido(c) {
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (let t = 9; t < 11; t++) { let s = 0; for (let i = 0; i < t; i++) s += c[i] * (t + 1 - i); if (((s * 10) % 11) % 10 != c[t]) return false; }
  return true;
}
function buscarProduto(texto) {
  const m = modal({ titulo: 'Buscar produto', lg: true, corpo: `<input id="bq" value="${esc(texto)}" placeholder="Nome, código ou categoria"><div class="tabela" style="max-height:55vh;margin-top:10px"><table><thead><tr><th>Produto</th><th>Código</th><th class="r">Preço</th><th class="r">Estoque</th></tr></thead><tbody id="br"></tbody></table></div><p class="ajuda">↑ ↓ para escolher, Enter para adicionar.</p>` });
  let lista = [], sel = 0;
  const desenha = () => { $('#br', m.el).innerHTML = lista.map((p, k) => `<tr class="cl ${k === sel ? 'sel' : ''}" data-k="${k}" style="${k === sel ? 'background:#fff7e0' : ''}"><td><b>${esc(p.nome)}</b> <small class="ajuda">${esc(p.categoria || '')}</small></td><td>${esc(p.codigo || (p.cod_balanca ? 'bal. ' + p.cod_balanca : ''))}</td><td class="r">${R(p.preco)}</td><td class="r ${+p.estoque <= +p.minimo ? 'desce' : ''}">${QT(p.estoque, p.unidade)}</td></tr>`).join('') || '<tr><td colspan="4" class="vazio">Nada encontrado</td></tr>';
    $$('#br tr[data-k]', m.el).forEach(tr => tr.onclick = () => escolhe(+tr.dataset.k)); $('#br tr.sel', m.el)?.scrollIntoView({ block: 'nearest' }); };
  const escolhe = k => { const p = lista[k]; if (!p) return; m.fechar();
    if (p.unidade === 'KG' && S.venda.mult === 1) { const q = modal({ titulo: 'Peso de ' + esc(p.nome), corpo: '<input id="kg" inputmode="decimal" placeholder="Ex.: 0,350 kg">', botoes: [{ txt: 'Adicionar', cls: 'pri', acao: f => { const kg = num($('#kg', f).value); if (kg <= 0) throw new Error('Informe o peso.'); adicionar(p, kg); setTimeout(() => $('#cod')?.focus(), 50); } }] }); $('#kg', q.el).onkeydown = e => { if (e.key === 'Enter') $('footer .pri', q.el).click(); }; }
    else { adicionar(p, S.venda.mult); setTimeout(() => $('#cod')?.focus(), 50); } };
  let tm; const carrega = () => { clearTimeout(tm); tm = setTimeout(async () => { lista = (await api('produtos', { busca: $('#bq', m.el).value })).lista; sel = 0; desenha(); }, 150); };
  $('#bq', m.el).oninput = carrega;
  $('#bq', m.el).onkeydown = e => { if (e.key === 'ArrowDown') { sel = Math.min(lista.length - 1, sel + 1); desenha(); e.preventDefault(); } if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); desenha(); e.preventDefault(); } if (e.key === 'Enter') escolhe(sel); };
  carrega();
}

// ----- Pagamento -----
function pagamento() {
  const total = totalVenda(); const pags = []; let forma = 'dinheiro';
  const pago = () => r2(pags.reduce((s, p) => s + p.valor, 0)); const falta = () => r2(Math.max(0, total - pago()));
  const m = modal({ titulo: 'Pagamento', lg: true, corpo: `
    <div class="pagtot"><div><div class="ajuda">Total da venda</div><div class="v num">${R(total)}</div></div><div style="text-align:right"><div class="ajuda">Falta pagar</div><div class="v num" id="pFalta" style="color:var(--tomate)">${R(total)}</div></div></div>
    <div class="formas">${Object.keys(FORMAS).map(f => `<button data-f="${f}" class="${f === forma ? 'on' : ''}">${ico(f)}${FORMAS[f]}</button>`).join('')}</div><p class="ajuda" style="margin:-6px 0 10px">Setas ↑ ↓ trocam a forma de pagamento · Enter lança o valor</p>
    <div class="linha"><input id="pVal" inputmode="decimal" style="flex:1;font-size:24px;font-weight:700"><button class="btn pri lg" id="pAdd">Lançar <kbd>Enter</kbd></button></div>
    <div id="pCli" class="ajuda" style="margin-top:6px"></div>
    <div class="paglista" id="pLista" style="margin-top:12px"></div><div id="pTroco" style="margin-top:10px;font-size:22px;font-weight:800;color:var(--verde)"></div>` });
  const val = $('#pVal', m.el);
  const desenha = () => {
    $$('.formas button', m.el).forEach(b => b.classList.toggle('on', b.dataset.f === forma));
    $('#pFalta', m.el).textContent = R(falta());
    $('#pLista', m.el).innerHTML = pags.map((p, k) => `<div><span>${ico(p.forma, 18)} ${FORMAS[p.forma]}${p.integrado ? ' <span class="chip p-ok">aprovado na maquininha</span>' : ''}${p.bandeira ? ' · ' + esc(p.bandeira) : ''}</span><span class="linha"><b class="num">${R(p.valor)}</b>${p.integrado ? '' : `<button class="btn sm gh" data-rm="${k}">✕</button>`}</span></div>`).join('');
    $$('[data-rm]', m.el).forEach(b => b.onclick = () => { pags.splice(+b.dataset.rm, 1); desenha(); });
    const troco = r2(pago() - total); $('#pTroco', m.el).textContent = troco > 0 ? 'Troco: ' + R(troco) : '';
    $('#pCli', m.el).innerHTML = forma === 'fiado' ? (S.venda.cliente ? `Fiado para <b>${esc(S.venda.cliente.nome)}</b> · saldo atual ${R(S.venda.cliente.saldo)}${+S.venda.cliente.limite ? ' · limite ' + R(S.venda.cliente.limite) : ''}` : '<span class="desce">Escolha o cliente antes (F6 no caixa).</span>') : forma === 'dinheiro' ? 'Digite quanto o cliente entregou para calcular o troco.' : '';
    val.value = falta() ? N2(falta()) : ''; val.select();
  };
  const lancar = async () => {
    const v = r2(num(val.value)); if (v <= 0) { if (falta() <= 0) return concluir(); return; }
    if (forma !== 'dinheiro' && v > falta() + 0.001) return toast('Só pagamento em dinheiro pode ser maior que o valor que falta.', 'er');
    if (forma === 'fiado' && !S.venda.cliente) return toast('Escolha o cliente do fiado (F6).', 'er');
    if (['debito', 'credito', 'pix'].includes(forma)) { const r = await cobrarMaquininha(forma, v); if (!r) return val.focus(); pags.push({ forma, valor: v, ...r }); }
    else pags.push({ forma, valor: v });
    desenha(); if (falta() <= 0) concluir();
  };
  const concluir = async () => {
    $('#pAdd', m.el).disabled = true;
    const dados = { itens: S.venda.itens.map(i => ({ produto_id: i.p.id, qtd: i.qtd, total_etiqueta: i.total_etiqueta })), pagamentos: pags, desconto: S.venda.desconto, cpf: S.venda.cpf, cliente_id: S.venda.cliente?.id };
    try {
      const r = await comGerente(pin => api('venda_finalizar', { ...dados, pin }), 'Esta venda tem desconto ou passa do limite do fiado.');
      m.fechar(); S.venda = novaVenda(); salvarVenda(); desenharCesta(); mostrarMult(); mostrarCupom(r.venda, true); atualizarStatus();
    } catch (e) { toast(e.message, 'er'); $('#pAdd', m.el).disabled = false; }
  };
  $$('.formas button', m.el).forEach(b => b.onclick = () => { forma = b.dataset.f; desenha(); });
  $('#pAdd', m.el).onclick = lancar;
  val.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); lancar(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const k = Object.keys(FORMAS); forma = k[(k.indexOf(forma) + (e.key === 'ArrowDown' ? 1 : k.length - 1)) % k.length]; desenha(); }
  };
  desenha();
}
// Maquininha: integrada (Mercado Pago) ou separada (manual)
function cobrarMaquininha(forma, valor) {
  const tipo = ['mp', 'stone'].includes(S.cfg.maquininha) ? S.cfg.maquininha : 'manual';
  return new Promise(res => {
    let fim = false; const fecha = (r, m) => { if (fim) return; fim = true; m.fechar(); res(r); };
    if (tipo === 'manual' || (tipo === 'mp' && forma === 'pix')) {
      const m = modal({ titulo: forma === 'pix' ? 'PIX' : 'Maquininha', corpo: `<div class="maq">${ico(forma, 54)}<h2 style="margin:10px 0 4px">${R(valor)}</h2><p style="font-size:17px">${forma === 'pix' ? 'Confirme que o PIX caiu na conta.' : `Digite <b>${R(valor)}</b> no <b>${FORMAS[forma]}</b> na maquininha.`}</p><p class="ajuda">Só confirme depois que aparecer <b>APROVADO</b>.</p></div>`,
        botoes: [{ txt: 'Não aprovou', acao: () => fecha(null, m) }, { txt: 'Aprovado ✓', cls: 'pri', acao: () => fecha({ integrado: 0 }, m) }] });
      new MutationObserver((_, o) => { if (!m.el.isConnected) { o.disconnect(); if (!fim) { fim = true; res(null); } } }).observe($('#modais'), { childList: true }); return;
    }
    const m = modal({ titulo: 'Maquininha', fechavel: false, corpo: `<div class="maq"><div class="anel"></div><h2 style="margin:0 0 4px">${R(valor)} · ${FORMAS[forma]}</h2><p id="mqMsg" style="font-size:17px">${forma === 'pix' ? 'Mostrando QR Code do PIX…' : 'Valor enviado. Peça para o cliente aproximar ou inserir o cartão.'}</p></div>`,
      botoes: [{ txt: 'Cancelar cobrança', acao: async () => { if (m.id) await api(tipo + '_cancelar', { id: m.id }).catch(() => {}); fecha(null, m); return false; } }] });
    api(tipo + '_cobrar', { valor, tipo: forma, ref: 'pdv-' + Date.now() }).then(r => {
      m.id = r.id; const t0 = Date.now();
      const poll = async () => {
        if (fim) return;
        try { const s = await api(tipo + '_status', { id: r.id });
          if (s.aprovado) return fecha({ integrado: 1, bandeira: s.bandeira, autorizacao: s.autorizacao, nsu: s.nsu }, m);
          if (s.falhou) { $('#mqMsg', m.el).textContent = 'Pagamento não aprovado (' + s.status + ').'; setTimeout(() => fecha(null, m), 2500); return; }
        } catch (e) {}
        if (Date.now() - t0 > 300000) return fecha(null, m);
        setTimeout(poll, 2000);
      }; poll();
    }).catch(e => { toast(e.message, 'er'); fecha(null, m); });
  });
}

// ----- Cupom (DANFCE) -----
function cupomHTML(v) {
  const c = S.cfg; const st = v.nfce_status;
  const prods = v.itens.filter(i => i.tipo !== 'servico'), servs = v.itens.filter(i => i.tipo === 'servico');
  const temNFCe = prods.length > 0 && st !== 'sem_nota';
  const homolog = c.ambiente === 'homologacao';
  const aviso = (homolog && st !== 'rejeitada') ? 'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL' : st === 'contingencia' ? 'EMITIDA EM CONTINGÊNCIA<br>Pendente de autorização' : '';
  const trib = prods.reduce((s, i) => s + (i.total - i.desconto) * (+i.trib_aprox || 0) / 100, 0);
  const pags = v.pagamentos.map(p => `<tr><td>${FORMAS[p.forma] || p.forma}</td><td style="text-align:right">${N2(p.valor + (p.forma === 'dinheiro' ? +v.troco : 0))}</td></tr>`).join('');
  const chave = (v.chave || '').replace(/(\d{4})/g, '$1 ').trim();
  const doc = d => { d = String(d || '').replace(/\D/g, ''); return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : d; };
  const lista = its => `<table><tr><td class="b">#</td><td class="b">DESCRIÇÃO</td><td class="b" style="text-align:right">TOTAL</td></tr>
    ${its.map((i, k) => `<tr><td>${k + 1}</td><td>${i.tipo === 'servico' ? '' : esc(i.codigo) + ' '}${esc(i.nome)}<br>${QT(i.qtd, i.unidade)} ${esc(i.unidade)} x ${N2(i.preco)}</td><td style="text-align:right">${N2(i.total)}</td></tr>`).join('')}</table>`;
  const somaP = prods.reduce((s, i) => s + +i.total, 0), descP = prods.reduce((s, i) => s + +i.desconto, 0);
  const blocoNFCe = !temNFCe ? '' : `
    <div class="c b">Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</div>${aviso ? `<div class="aviso">${aviso}</div>` : '<hr>'}
    ${lista(prods)}<hr>
    <table><tr><td>Qtde. total de itens</td><td style="text-align:right">${prods.length}</td></tr><tr><td>Valor total R$</td><td style="text-align:right">${N2(somaP)}</td></tr>
    ${descP ? `<tr><td>Descontos R$</td><td style="text-align:right">${N2(descP)}</td></tr>` : ''}<tr><td class="b">VALOR A PAGAR R$</td><td class="b" style="text-align:right">${N2(somaP - descP)}</td></tr></table><hr>
    ${st === 'rejeitada' || !v.chave ? `<div class="aviso">NFC-e NÃO EMITIDA<br><span style="font-weight:400">${esc(v.motivo || '')}</span></div>` : `
    <div class="c">Consulte pela Chave de Acesso em<br>${esc(v.url_chave)}</div><div class="c b" style="margin:4px 0">${chave}</div><hr>
    <div class="c">${v.cpf ? 'CONSUMIDOR CPF: ' + esc(doc(v.cpf)) : 'CONSUMIDOR NÃO IDENTIFICADO'}</div>
    <div class="c b">NFC-e nº ${String(v.numero).padStart(9, '0')} Série ${String(v.serie).padStart(3, '0')} ${dataBR(v.data)}</div>
    ${v.protocolo ? `<div class="c">Protocolo de autorização: ${esc(v.protocolo)}<br>Data de autorização ${dataBR(v.data)}</div>` : ''}
    <div class="qr">${qrSVG(v.qrcode || v.chave)}</div>`}
    <div class="c">Tributos totais incidentes (Lei Federal 12.741/2012) R$ ${N2(trib)}</div><hr>`;
  const blocoNFSe = (v.nfse || []).map(n => `
    <div class="c b">NFS-e — Nota Fiscal de Serviço Eletrônica</div>${homolog && n.status !== 'rejeitada' ? '<div class="aviso">EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL</div>' : '<hr>'}
    <table><tr><td colspan="2">${esc(n.descricao)}</td></tr><tr><td>Código do serviço</td><td style="text-align:right">${esc(String(n.ctribnac).replace(/(\d{2})(\d{2})(\d{2})/, '$1.$2.$3'))}</td></tr>
    <tr><td>Valor do serviço R$</td><td style="text-align:right">${N2(n.valor)}</td></tr>${+n.desconto ? `<tr><td>Desconto R$</td><td style="text-align:right">${N2(n.desconto)}</td></tr>` : ''}
    <tr><td class="b">VALOR LÍQUIDO R$</td><td class="b" style="text-align:right">${N2(n.valor - n.desconto)}</td></tr></table>
    <div class="c">${n.tomador_doc ? 'TOMADOR: ' + esc(n.tomador_nome || '') + ' ' + esc(doc(n.tomador_doc)) : 'TOMADOR NÃO IDENTIFICADO'}</div>
    ${n.status === 'autorizada' ? `<div class="c b">NFS-e nº ${esc(n.nnfse || '—')} · DPS ${esc(n.serie)}/${esc(n.numero)}</div><div class="c">Chave de acesso</div><div class="c b" style="margin:2px 0;font-size:10.5px">${esc(String(n.chave).replace(/(\d{5})/g, '$1 ').trim())}</div><div class="c">Consulte em nfse.gov.br/ConsultaPublica</div><div class="qr">${qrSVG(n.url_consulta)}</div>`
      : n.status === 'pendente' ? `<div class="aviso">NFS-e PENDENTE DE ENVIO<br><span style="font-weight:400">Será enviada automaticamente</span></div>`
      : n.status === 'cancelada' ? `<div class="aviso">NFS-e CANCELADA</div>` : `<div class="aviso">NFS-e NÃO EMITIDA<br><span style="font-weight:400">${esc(n.motivo || '')}</span></div>`}<hr>`).join('');
  const resumo = (servs.length || !temNFCe) ? `<div class="c b">RESUMO DA VENDA</div><table><tr><td>Total R$</td><td style="text-align:right">${N2(v.subtotal)}</td></tr>${+v.desconto ? `<tr><td>Descontos R$</td><td style="text-align:right">${N2(v.desconto)}</td></tr>` : ''}<tr><td class="b">TOTAL PAGO R$</td><td class="b" style="text-align:right">${N2(v.total)}</td></tr>` : '<table>';
  return `<div class="cupom">
    <div class="c b">${esc(c.emp_fantasia || c.emp_razao)}</div><div class="c">${esc(c.emp_razao)}</div>
    <div class="c">CNPJ ${esc(doc(c.emp_cnpj))}${c.emp_ie ? ' IE ' + esc(c.emp_ie) : ''}${c.nfse_im ? ' IM ' + esc(c.nfse_im) : ''}</div>
    <div class="c">${esc(c.emp_logradouro)}, ${esc(c.emp_numero)} - ${esc(c.emp_bairro)} - ${esc(c.emp_municipio)}/${esc(c.emp_uf)}</div><hr>
    ${blocoNFCe}${blocoNFSe}
    ${resumo}<tr><td class="b">FORMA PAGAMENTO</td><td class="b" style="text-align:right">VALOR PAGO</td></tr>${pags}${+v.troco ? `<tr><td>Troco R$</td><td style="text-align:right">${N2(v.troco)}</td></tr>` : ''}</table><hr>
    ${v.cliente && v.pagamentos.some(p => p.forma === 'fiado') ? `<div class="c">Fiado: ${esc(v.cliente.nome)} · saldo ${R(v.cliente.saldo)}<br><br>Assinatura: ____________________</div><hr>` : ''}
    <div class="c">${esc(c.msg_cupom || 'Obrigado pela preferência!')}</div><div class="c" style="font-size:10px;margin-top:4px">Venda ${v.id} · ${esc(v.operador)}${v.status === 'cancelada' ? '<br><b>VENDA CANCELADA</b>' : ''}</div>
  </div>`;
}
function imprimirCupom(v) { $('#impressao').innerHTML = cupomHTML(v); setTimeout(() => window.print(), 50); }
function situacaoNotas(v) {
  const l = [];
  const mapa = { autorizada: ['p-ok', 'autorizada'], contingencia: ['p-av', 'em contingência'], rejeitada: ['p-er', 'não emitida'], pendente: ['p-av', 'pendente'], cancelada: ['p-er', 'cancelada'] };
  if (v.nfce_status && v.nfce_status !== 'sem_nota') l.push(['NFC-e', ...(mapa[v.nfce_status] || ['p-in', v.nfce_status])]);
  (v.nfse || []).forEach(n => l.push(['NFS-e', ...(mapa[n.status] || ['p-in', n.status])]));
  return l;
}
function mostrarCupom(v, depoisVenda = false) {
  const botoes = [];
  if (v.nfce_status === 'rejeitada' && v.status === 'ok') botoes.push({ txt: 'Emitir NFC-e de novo', acao: async () => { const r = await api('venda_reemitir', { id: v.id }); mostrarCupom(r.venda, depoisVenda); atualizarStatus(); } });
  (v.nfse || []).filter(n => n.status === 'rejeitada' && v.status === 'ok').forEach(n => botoes.push({ txt: 'Emitir NFS-e de novo', acao: async () => { const r = await api('nfse_reemitir', { id: n.id }); mostrarCupom(r.venda, depoisVenda); atualizarStatus(); } }));
  if (!depoisVenda && v.status === 'ok') botoes.push({ txt: 'Cancelar venda', cls: 'dan', acao: () => { cancelarVendaUI(v); } });
  botoes.push({ txt: 'Imprimir <kbd>P</kbd>', acao: () => { imprimirCupom(v); return false; } });
  botoes.push({ txt: depoisVenda ? 'Nova venda <kbd>Enter</kbd>' : 'Fechar', cls: 'pri', acao: () => { setTimeout(() => $('#cod')?.focus(), 50); } });
  const troco = +v.troco ? `<div style="text-align:center;font-size:26px;font-weight:800;color:var(--verde);margin-bottom:12px">Troco: ${R(v.troco)}</div>` : '';
  const pills = situacaoNotas(v).map(([t, cls, txt]) => `<span class="pill ${cls}" style="margin-left:8px"><i></i>${t} ${txt}</span>`).join('');
  const erros = [v.nfce_status === 'rejeitada' ? 'NFC-e: ' + v.motivo : '', ...(v.nfse || []).filter(n => n.status === 'rejeitada').map(n => 'NFS-e: ' + n.motivo)].filter(Boolean);
  const m = modal({ titulo: `Venda ${v.id} ${pills}`, corpo: `${troco}${erros.map(e => `<p class="p-er" style="padding:10px;border-radius:10px">${esc(e)}</p>`).join('')}${cupomHTML(v)}`, botoes });
  m.el.addEventListener('keydown', e => { if (e.key.toLowerCase() === 'p' && e.target.tagName !== 'INPUT') imprimirCupom(v); if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') $('footer .pri', m.el).click(); });
  setTimeout(() => $('footer .pri', m.el)?.focus(), 60);
  if (depoisVenda && S.cfg.impressao_auto === '1') imprimirCupom(v);
}
async function cancelarVendaUI(v) {
  const m = modal({ titulo: 'Cancelar venda ' + v.id, corpo: `<p style="margin-top:0">Total ${R(v.total)}. O estoque volta e as notas são canceladas (a NFC-e só até 30 minutos após a emissão; a NFS-e conforme o prazo da prefeitura).</p><div class="campo"><label>Motivo (mín. 15 letras)</label><input id="jus" value="Cliente desistiu da compra no caixa"></div>`,
    botoes: [{ txt: 'Voltar' }, { txt: 'Cancelar venda', cls: 'dan', acao: async f => { const r = await comGerente(pin => api('venda_cancelar', { id: v.id, justificativa: $('#jus', f).value, pin }), 'Cancelar venda'); toast(r.msg, 'ok'); if (S.tela === 'vendas') telaVendas(); } }] });
}
async function movCaixa(tipo) {
  const m = modal({ titulo: tipo === 'sangria' ? 'Sangria (retirada de dinheiro)' : 'Suprimento (colocar troco)', corpo: `<div class="campo"><label>Valor</label><input id="mv" inputmode="decimal"></div><div class="campo"><label>Observação</label><input id="mo"></div>`,
    botoes: [{ txt: 'Confirmar', cls: 'pri', acao: async f => { await comGerente(pin => api('caixa_mov', { tipo, valor: num($('#mv', f).value), obs: $('#mo', f).value, pin }), 'Sangria'); toast('Registrado.', 'ok'); } }] });
}
async function fecharCaixa() {
  const r = await api('caixa_atual'); const s = r.resumo;
  const m = modal({ titulo: 'Fechar caixa', corpo: `<table>${Object.entries(s.formas).map(([k, v]) => `<tr><td>${FORMAS[k] || k}</td><td class="r">${R(v)}</td></tr>`).join('')}
    <tr><td>Fundo de caixa</td><td class="r">${R(s.valor_inicial)}</td></tr>${s.mov.suprimento ? `<tr><td>Suprimentos</td><td class="r">${R(s.mov.suprimento)}</td></tr>` : ''}${s.mov.sangria ? `<tr><td>Sangrias</td><td class="r">- ${R(s.mov.sangria)}</td></tr>` : ''}${s.mov.recebimento_fiado ? `<tr><td>Recebido de fiado</td><td class="r">${R(s.mov.recebimento_fiado)}</td></tr>` : ''}
    <tr><td><b>Total vendido (${s.vendas} vendas)</b></td><td class="r"><b>${R(s.total)}</b></td></tr></table>
    <div class="campo" style="margin-top:14px"><label>Quanto tem de dinheiro na gaveta? (conte antes de ver o esperado)</label><input id="cont" inputmode="decimal" style="font-size:22px"></div>`,
    botoes: [{ txt: 'Voltar' }, { txt: 'Fechar caixa', cls: 'pri', acao: async f => {
      const x = await api('caixa_fechar', { contado: num($('#cont', f).value) });
      const tel = (S.cfg.whats_dono || '').replace(/\D/g, '');
      modal({ titulo: 'Caixa fechado', corpo: `<div class="grid g3" style="text-align:center"><div><div class="ajuda">Esperado em dinheiro</div><b style="font-size:20px">${R(x.resumo.dinheiro_esperado)}</b></div><div><div class="ajuda">Contado</div><b style="font-size:20px">${R(x.contado)}</b></div><div><div class="ajuda">Diferença</div><b style="font-size:20px" class="${x.diferenca < 0 ? 'desce' : 'sobe'}">${R(x.diferenca)}</b></div></div>
        <pre style="white-space:pre-wrap;background:#f4f7f3;padding:12px;border-radius:10px;margin-top:14px">${esc(x.whats)}</pre>${tel ? `<a class="btn pri" target="_blank" href="https://wa.me/55${tel}?text=${encodeURIComponent(x.whats)}">Enviar no WhatsApp do dono</a>` : '<p class="ajuda">Cadastre o WhatsApp do dono em Configurações para enviar o resumo com um clique.</p>'}`, botoes: [{ txt: 'OK', cls: 'pri', acao: () => telaCaixa() }] });
    } }] });
}

// ======================= PAINEL =======================
async function telaPainel(per = ler('per', 'mes')) {
  const d = new Date(); const fmt = x => x.toLocaleDateString('sv-SE');
  const ini = { hoje: hoje(), '7d': fmt(new Date(d - 6 * 864e5)), mes: fmt(new Date(d.getFullYear(), d.getMonth(), 1)), '30d': fmt(new Date(d - 29 * 864e5)) }[per];
  $('#topoExtra').innerHTML = [['hoje', 'Hoje'], ['7d', '7 dias'], ['mes', 'Este mês'], ['30d', '30 dias']].map(([k, n]) => `<button class="btn sm ${k === per ? 'pri' : ''}" data-p="${k}">${n}</button>`).join('');
  $$('#topoExtra [data-p]').forEach(b => b.onclick = () => { guardar('per', b.dataset.p); telaPainel(b.dataset.p); });
  const [p, a] = await Promise.all([api('painel', { de: ini, ate: hoje() }), api('alertas')]);
  const varH = p.hoje.ontem ? Math.round((p.hoje.fat / p.hoje.ontem - 1) * 100) : null;
  const maxD = Math.max(...p.dias.map(x => x.t), 1); const horas = Array.from({ length: 24 }, (_, h) => p.horas.find(x => x.h === h) || { h, t: 0, n: 0 }).filter(x => x.h >= 6 && x.h <= 22);
  const maxH = Math.max(...horas.map(x => x.t), 1); const maxF = Math.max(...p.formas.map(x => x.t), 1);
  const lista = a.estoque_baixo.map(x => `• ${x.nome}: comprar ${x.comprar} ${x.unidade}`).join('\n');
  const tel = (S.cfg.whats_dono || '').replace(/\D/g, '');
  $('#tela').innerHTML = `
  <div class="grid g4">
    <div class="card kpi"><div class="rot">Vendido hoje</div><div class="val num">${R(p.hoje.fat)}</div><div class="var ${varH === null ? '' : varH >= 0 ? 'sobe' : 'desce'}">${varH === null ? p.hoje.n + ' vendas' : (varH >= 0 ? '▲ ' : '▼ ') + Math.abs(varH) + '% vs ontem (' + R(p.hoje.ontem) + ')'}</div></div>
    <div class="card kpi"><div class="rot">Faturamento no período</div><div class="val num">${R(p.faturamento)}</div><div class="var">${p.vendas} vendas · ticket médio ${R(p.ticket)}</div></div>
    <div class="card kpi"><div class="rot">Lucro bruto</div><div class="val num sobe">${R(p.lucro)}</div><div class="var">margem de ${String(p.margem).replace('.', ',')}% sobre o custo das mercadorias</div></div>
    <div class="card kpi"><div class="rot">Fiado a receber</div><div class="val num ${p.fiado_receber ? 'desce' : ''}">${R(p.fiado_receber)}</div><div class="var">estoque parado vale ${R(p.estoque_valor)}</div></div>
  </div>
  <div class="grid g2" style="margin-top:16px;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
    <div class="card"><h2>Faturamento por dia</h2><div class="barras">${p.dias.map(x => `<div class="b ${x.d === hoje() ? 'hj' : ''}" style="height:${x.t / maxD * 100}%"><span>${diaBR(x.d)}: ${R(x.t)} · ${x.n} vendas</span></div>`).join('') || '<div class="vazio" style="flex:1">Sem vendas no período</div>'}</div>
      <div class="eixo">${p.dias.map((x, i) => `<div>${p.dias.length > 16 && i % 2 ? '' : x.d.slice(8, 10)}</div>`).join('')}</div></div>
    <div class="card"><h2>Horários de movimento</h2><div class="barras" style="height:150px">${horas.map(x => `<div class="b" style="height:${x.t / maxH * 100}%;background:var(--azul)"><span>${x.h}h: ${R(x.t)} · ${x.n} vendas</span></div>`).join('')}</div><div class="eixo">${horas.map(x => `<div>${x.h % 2 ? '' : x.h + 'h'}</div>`).join('')}</div>
      <h2 style="margin-top:18px">Formas de pagamento</h2>${p.formas.map(f => `<div class="hbar"><span>${FORMAS[f.forma] || f.forma}</span><div class="t"><div style="width:${f.t / maxF * 100}%"></div></div><b class="r num">${R(f.t)}</b></div>`).join('')}</div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h2>Produtos que mais faturam</h2><div class="tabela" style="max-height:420px"><table><thead><tr><th>Produto</th><th>ABC</th><th class="r">Qtd</th><th class="r">Faturado</th><th class="r">Lucro</th></tr></thead><tbody>
      ${p.top.map(x => `<tr><td>${esc(x.nome)}</td><td><span class="chip ${x.abc === 'A' ? 'p-ok' : x.abc === 'B' ? 'p-av' : 'p-in'}">${x.abc}</span></td><td class="r">${QT(x.qtd)}</td><td class="r">${R(x.fat)}</td><td class="r sobe">${R(x.lucro)}</td></tr>`).join('')}</tbody></table></div>
      <p class="ajuda">Curva ABC: produtos <b>A</b> fazem 80% do faturamento — nunca podem faltar na prateleira. (${p.abc.A || 0} A · ${p.abc.B || 0} B · ${p.abc.C || 0} C)</p></div>
    <div class="grid" style="align-content:start">
      <div class="card"><h2>Comprar agora ${a.estoque_baixo.length ? `<span class="chip p-er">${a.estoque_baixo.length}</span>` : ''}</h2>
        ${a.estoque_baixo.length ? `<table><thead><tr><th>Produto</th><th class="r">Estoque</th><th class="r">Sugestão</th></tr></thead><tbody>${a.estoque_baixo.map(x => `<tr><td>${esc(x.nome)}</td><td class="r desce">${QT(x.estoque, x.unidade)}</td><td class="r"><b>${x.comprar} ${esc(x.unidade)}</b></td></tr>`).join('')}</tbody></table>
        <p class="ajuda">Sugestão = vendas médias de 15 dias + estoque mínimo.</p>${tel ? `<a class="btn sm" target="_blank" href="https://wa.me/55${tel}?text=${encodeURIComponent('*Lista de compras*\n' + lista)}">Mandar lista no WhatsApp</a>` : ''}` : '<p class="ajuda">Nenhum produto abaixo do mínimo. 👍</p>'}</div>
      <div class="card"><h2>Validade próxima (15 dias)</h2>${a.validade.length ? `<table><tbody>${a.validade.map(x => `<tr><td>${esc(x.nome)}</td><td class="r ${x.validade <= hoje() ? 'desce' : ''}">${x.validade.split('-').reverse().join('/')}</td><td class="r">${QT(x.estoque)} un</td></tr>`).join('')}</tbody></table><p class="ajuda">Dica: coloque em promoção antes de vencer.</p>` : '<p class="ajuda">Nada vencendo.</p>'}</div>
      <div class="card"><h2>Dinheiro parado (sem venda em 30 dias)</h2>${p.parados.length ? `<table><tbody>${p.parados.map(x => `<tr><td>${esc(x.nome)}</td><td class="r">${QT(x.estoque)} un</td><td class="r desce">${R(x.parado)}</td></tr>`).join('')}</tbody></table>` : '<p class="ajuda">Tudo girando.</p>'}</div>
    </div>
  </div>`;
}

// ======================= PRODUTOS =======================
async function telaProdutos() {
  $('#topoExtra').innerHTML = `<button class="btn sm" id="imp">Importar planilha</button><button class="btn sm pri" id="novo">+ Novo produto</button>`;
  $('#novo').onclick = () => editarProduto({}); $('#imp').onclick = importarPlanilha;
  if ((S.cfg.emissao || 'nfce') === 'nfse') $('#novo').textContent = '+ Novo serviço';
  $('#tela').innerHTML = `<div class="card"><div class="linha" style="margin-bottom:10px"><input id="pb" placeholder="Buscar por nome, código ou categoria" style="flex:1"><select id="pf" style="width:auto"><option value="">Todos</option><option value="baixo">Estoque baixo</option><option value="validade">Validade próxima</option><option value="semncm">Sem NCM</option></select></div>
    <div class="tabela"><table><thead><tr><th>Produto</th><th>Código</th><th class="r">Custo</th><th class="r">Preço</th><th class="r">Margem</th><th class="r">Estoque</th><th>Validade</th></tr></thead><tbody id="pl"></tbody></table></div></div>`;
  let tm; const carrega = async () => {
    const r = await api('produtos', { busca: $('#pb').value }); const f = $('#pf').value; const lim = new Date(Date.now() + 15 * 864e5).toLocaleDateString('sv-SE');
    const l = r.lista.filter(p => !f || (f === 'baixo' && +p.minimo && +p.estoque <= +p.minimo) || (f === 'validade' && p.validade && p.validade <= lim) || (f === 'semncm' && (!p.ncm || p.ncm === '00000000')));
    $('#pl').innerHTML = l.map(p => { const mg = +p.preco ? ((p.preco - p.custo) / p.preco * 100) : 0;
      return `<tr class="cl" data-id="${p.id}"><td><b>${esc(p.nome)}</b>${p.tipo === 'servico' ? ' <span class="chip p-in">serviço</span>' : ''}<div class="ajuda">${esc(p.categoria || '')}${p.promo_qtd ? ` · promoção: ${QT(p.promo_qtd)}+ por ${R(p.promo_preco)}` : ''}</div></td><td>${esc(p.codigo || (p.cod_balanca ? 'balança ' + p.cod_balanca : '—'))}</td>
      <td class="r">${R(p.custo)}</td><td class="r"><b>${R(p.preco)}</b></td><td class="r ${mg < 15 ? 'desce' : ''}">${mg.toFixed(0)}%</td>
      <td class="r ${+p.minimo && +p.estoque <= +p.minimo ? 'desce' : ''}">${p.tipo === 'servico' ? '—' : `<b>${QT(p.estoque, p.unidade)}</b> ${esc(p.unidade)}`}</td><td class="${p.validade && p.validade <= lim ? 'desce' : ''}">${p.validade ? p.validade.split('-').reverse().join('/') : ''}</td></tr>`; }).join('') || '<tr><td colspan="7" class="vazio">Nenhum produto</td></tr>';
    $$('#pl tr[data-id]').forEach(tr => tr.onclick = () => editarProduto(l.find(p => p.id == tr.dataset.id)));
  };
  $('#pb').oninput = () => { clearTimeout(tm); tm = setTimeout(carrega, 200); }; $('#pf').onchange = carrega; carrega();
}
function editarProduto(p) {
  const c = (k, rot, tipo = 'text', ex = '') => `<div class="campo"><label>${rot}</label><input data-k="${k}" type="${tipo}" value="${esc(p[k] ?? '')}" ${ex}></div>`;
  const emi = S.cfg.emissao || 'nfce';
  if (!p.id) p = { tipo: emi === 'nfse' ? 'servico' : 'produto', ctribnac: S.cfg.nfse_ctribnac_padrao || '', ...p };
  const m = modal({ titulo: p.id ? 'Editar item' : (emi === 'nfse' ? 'Novo serviço' : 'Novo produto'), lg: true, corpo: `
    ${emi === 'ambos' ? `<div class="campo" style="max-width:320px"><label>Tipo</label><select data-k="tipo" id="pTipo"><option value="produto">Produto (sai na NFC-e)</option><option value="servico">Serviço (sai na NFS-e)</option></select></div>` : `<input type="hidden" data-k="tipo" id="pTipo" value="${emi === 'nfse' ? 'servico' : 'produto'}">`}
    <div class="grid g2">${c('nome', 'Nome')}${c('codigo', 'Código de barras', 'text', 'placeholder="Bipe aqui (opcional para serviço)"')}</div>
    <div id="pServ" class="card" style="box-shadow:none;border:1px solid var(--linha);margin-bottom:12px"><b>Dados da NFS-e</b>
      <div class="grid g2" style="margin-top:8px">${c('ctribnac', 'Código de tributação nacional (6 números)', 'text', 'maxlength="9" placeholder="ex.: 060101"')}${c('nbs', 'Código NBS (opcional, 9 números)', 'text', 'maxlength="9"')}</div>
      <p class="ajuda">O código de tributação nacional vem da lista de serviços da Lei Complementar 116 (item + subitem + desdobro). Confirme com o contador: ele aparece também nas notas que a empresa já emite. Exemplos: 06.01.01 cabeleireiro/barbeiro, 06.02.01 manicure/esteticista, 14.01.01 manutenção de máquinas e equipamentos.</p></div>
    <div class="grid g4">${c('preco', 'Preço de venda', 'number', 'step="0.01"')}${c('custo', 'Custo', 'number', 'step="0.0001"')}<div class="campo"><label>Unidade</label><select data-k="unidade"><option>UN</option><option>KG</option><option>LT</option><option>CX</option><option>PCT</option><option>DZ</option></select></div>${c('categoria', 'Categoria')}</div>
    <div class="grid g4">${c('estoque', 'Estoque atual', 'number', 'step="0.001"')}${c('minimo', 'Estoque mínimo', 'number', 'step="0.001"')}${c('validade', 'Validade (lote atual)', 'date')}${c('cod_balanca', 'Código na balança', 'text', 'placeholder="só p/ etiqueta de peso"')}</div>
    <div class="grid g4">${c('promo_qtd', 'Promoção: a partir de (qtd)', 'number')}${c('promo_preco', 'Preço unitário na promoção', 'number', 'step="0.01"')}<div class="campo" style="grid-column:span 2"><label>Margem</label><div id="mg" style="font-size:20px;font-weight:800;padding-top:6px"></div></div></div>
    <details id="pFisc" ${p.id ? '' : 'open'}><summary style="cursor:pointer;font-weight:700;margin:6px 0 12px">Dados fiscais (NFC-e)</summary>
      <div class="grid g4">${c('ncm', 'NCM (8 dígitos)', 'text', 'maxlength="8"')}${c('cfop', 'CFOP', 'text', 'placeholder="5102"')}${c('csosn', 'CSOSN', 'text', 'placeholder="102"')}${c('cest', 'CEST')}</div>
      <div class="grid g4"><div class="campo"><label>Origem</label><select data-k="origem"><option value="0">0 - Nacional</option><option value="1">1 - Importado direto</option><option value="2">2 - Importado (mercado interno)</option></select></div>${c('trib_aprox', '% tributos aprox. (IBPT)', 'number', 'step="0.01"')}</div>
      <p class="ajuda">Confira NCM, CFOP e CSOSN com o contador. Itens com substituição tributária (bebidas, por exemplo) normalmente usam CSOSN 500 e CFOP 5405.</p></details>`,
    botoes: [...(p.id ? [{ txt: 'Excluir', cls: 'dan', acao: async () => { if (!await confirmar('Excluir', `Excluir <b>${esc(p.nome)}</b>?`, 'Excluir', 'dan')) return false; await comGerente(pin => api('produto_excluir', { id: p.id, pin })); toast('Excluído.', 'ok'); telaProdutos(); } }] : []),
      { txt: 'Salvar', cls: 'pri', acao: async f => { const d = { id: p.id }; $$('[data-k]', f).forEach(i => d[i.dataset.k] = i.value.trim()); await comGerente(pin => api('produto_salvar', { ...d, pin })); toast('Produto salvo.', 'ok'); if (S.tela === 'produtos') telaProdutos(); } }] });
  $$('select[data-k]', m.el).forEach(s => { if (p[s.dataset.k] != null) s.value = p[s.dataset.k]; });
  const tipo = () => { const sv = $('#pTipo', m.el).value === 'servico'; $('#pServ', m.el).classList.toggle('hide', !sv); $('#pFisc', m.el).classList.toggle('hide', sv);
    $$('[data-k=estoque],[data-k=minimo],[data-k=validade],[data-k=cod_balanca]', m.el).forEach(i => i.closest('.campo').classList.toggle('hide', sv)); };
  $('#pTipo', m.el).onchange = tipo; tipo();
  const mg = () => { const pr = +$('[data-k=preco]', m.el).value, cu = +$('[data-k=custo]', m.el).value; $('#mg', m.el).innerHTML = pr ? `${((pr - cu) / pr * 100).toFixed(1).replace('.', ',')}% <span class="ajuda">(lucro ${R(pr - cu)} por unidade)</span>` : '—'; };
  $('[data-k=preco]', m.el).oninput = mg; $('[data-k=custo]', m.el).oninput = mg; mg();
}
function importarPlanilha() {
  modal({ titulo: 'Importar produtos (Excel ou CSV)', lg: true, corpo: `<p style="margin-top:0">Escolha a planilha do sistema antigo: <b>Excel (.xlsx)</b> ou <b>CSV</b>. O sistema acha sozinho as colunas de código de barras, nome, preço, custo, estoque e NCM. Produto com o mesmo código é <b>atualizado</b>, não duplica.</p>
    <label for="csvF" id="csvDrop" class="drop-imp">${ico('entrada', 34)}<b>Clique ou arraste a planilha aqui</b><span>.xlsx, .csv ou .txt</span></label><input type="file" id="csvF" accept=".xlsx,.xlsm,.csv,.txt,.xls" class="hide">
    <div id="csvInfo" class="ajuda" style="margin:10px 0 6px"></div>
    <p class="ajuda">Ou copie as linhas no Excel (com o título das colunas) e cole aqui:</p><textarea id="csvT" placeholder="codigo;nome;preco;custo;estoque;ncm&#10;7891000100103;Arroz 5kg;27,90;21,50;40;10063021"></textarea>`,
    aoAbrir: f => {
      const carregar = async arq => {
        if (!arq) return;
        const info = $('#csvInfo', f); info.textContent = 'Lendo ' + arq.name + '…';
        try {
          const nome = arq.name.toLowerCase();
          if (/\.xls$/.test(nome)) throw new Error('Esse é o formato antigo do Excel (.xls). Abra no Excel e use Salvar como → "Pasta de Trabalho do Excel (.xlsx)".');
          let texto;
          if (/\.xls[xm]$/.test(nome)) { const pl = await lerXlsx(arq); texto = pl.linhas.map(l => l.map(celulaCSV).join(';')).join('\n'); info.innerHTML = `✓ <b>${esc(arq.name)}</b> · aba “${esc(pl.aba)}” · ${pl.linhas.length - 1} linhas`; }
          else { texto = await lerArquivoTexto(arq); info.innerHTML = `✓ <b>${esc(arq.name)}</b> · ${texto.trim().split(/\r?\n/).length - 1} linhas`; }
          $('#csvT', f).value = texto;
        } catch (e) { info.textContent = ''; toast(e.message, 'er'); }
      };
      $('#csvF', f).onchange = e => carregar(e.target.files[0]);
      const d = $('#csvDrop', f);
      d.ondragover = e => { e.preventDefault(); d.classList.add('sobre'); }; d.ondragleave = () => d.classList.remove('sobre');
      d.ondrop = e => { e.preventDefault(); d.classList.remove('sobre'); carregar(e.dataTransfer.files[0]); };
    },
    botoes: [{ txt: 'Importar', cls: 'pri', acao: async f => {
      if (!$('#csvT', f).value.trim()) { toast('Escolha a planilha ou cole as linhas.', 'er'); return false; }
      const r = await api('produtos_importar', { csv: $('#csvT', f).value });
      toast(`${r.novos} novos, ${r.atualizados} atualizados.${r.colunas ? ' Colunas usadas: ' + r.colunas.join(', ') + '.' : ''}`, 'ok'); telaProdutos(); } }] });
}
async function lerArquivoTexto(f) { const b = await f.arrayBuffer(); let t = new TextDecoder('utf-8').decode(b); if (t.includes('�')) t = new TextDecoder('windows-1252').decode(b); return t; }
const celulaCSV = v => { v = String(v ?? ''); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

// ---------- Leitor de Excel (.xlsx) sem biblioteca: o .xlsx é um zip com XMLs ----------
async function lerXlsx(arq) {
  const buf = new Uint8Array(await arq.arrayBuffer()), dv = new DataView(buf.buffer);
  let fim = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65600); i--) if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw new Error('Arquivo do Excel inválido ou corrompido.');
  const n = dv.getUint16(fim + 10, true); let p = dv.getUint32(fim + 16, true); const arqs = {};
  for (let k = 0; k < n; k++) {
    const metodo = dv.getUint16(p + 10, true), tam = dv.getUint32(p + 20, true), ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true), ini = dv.getUint32(p + 42, true);
    arqs[new TextDecoder().decode(buf.subarray(p + 46, p + 46 + ln))] = { metodo, tam, ini }; p += 46 + ln + le + lc;
  }
  const ler = async nome => {
    const e = arqs[nome]; if (!e) return null;
    const dados = e.ini + 30 + dv.getUint16(e.ini + 26, true) + dv.getUint16(e.ini + 28, true), bruto = buf.subarray(dados, dados + e.tam);
    if (e.metodo === 0) return new TextDecoder().decode(bruto);
    if (e.metodo !== 8) throw new Error('Compactação do Excel não suportada. Salve como CSV.');
    return await new Response(new Blob([bruto]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
  const xml = t => new DOMParser().parseFromString(t, 'application/xml');
  const tags = (el, nome) => [...el.getElementsByTagName(nome)];
  // textos compartilhados
  const ss = await ler('xl/sharedStrings.xml'); const textos = ss ? tags(xml(ss), 'si').map(si => tags(si, 't').map(t => t.textContent).join('')) : [];
  // primeira aba (na ordem do Excel)
  const wb = xml(await ler('xl/workbook.xml') || ''), rels = xml(await ler('xl/_rels/workbook.xml.rels') || '');
  const abas = tags(wb, 'sheet'); let alvo = 'xl/worksheets/sheet1.xml', nomeAba = abas[0]?.getAttribute('name') || 'Planilha1';
  for (const a of abas) {
    const rid = a.getAttribute('r:id') || a.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = tags(rels, 'Relationship').find(r => r.getAttribute('Id') === rid);
    if (rel) { const t = rel.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, ''); const cam = 'xl/' + t; if (arqs[cam]) { alvo = cam; nomeAba = a.getAttribute('name'); break; } }
  }
  const sh = await ler(alvo); if (!sh) throw new Error('Não achei a planilha dentro do arquivo.');
  const col = r => { let c = 0; for (const ch of r.replace(/\d+/g, '')) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
  const linhas = [];
  for (const row of tags(xml(sh), 'row')) {
    const l = [];
    tags(row, 'c').forEach((c, i) => {
      const t = c.getAttribute('t'), v = tags(c, 'v')[0]?.textContent ?? '';
      let val = t === 's' ? (textos[+v] ?? '') : t === 'inlineStr' ? tags(c, 't').map(x => x.textContent).join('') : t === 'b' ? (v === '1' ? 'SIM' : 'NÃO') : v;
      if ((!t || t === 'n') && /e/i.test(val) && isFinite(+val) && Number.isInteger(+val)) val = BigInt(Math.round(+val)).toString(); // código de barras em notação científica
      else if ((!t || t === 'n') && val !== '' && isFinite(+val)) val = String(+(+val).toFixed(6));
      l[c.getAttribute('r') ? col(c.getAttribute('r')) : i] = String(val).trim();
    });
    if (l.some(x => x)) linhas.push(Array.from(l, x => x ?? ''));
  }
  if (linhas.length < 2) throw new Error('A primeira aba da planilha está vazia.');
  return { aba: nomeAba, linhas };
}

// ======================= AUDITORIA (antifraude) =======================
const AUD = {
  item_removido: ['Item removido da venda', 'av'], venda_limpa: ['Venda em andamento cancelada', 'av'], venda_cancelar: ['Venda finalizada cancelada', 'er'],
  desconto: ['Desconto', 'av'], fiado_acima_limite: ['Fiado acima do limite', 'av'], sangria: ['Sangria', 'in'], suprimento: ['Suprimento', 'in'],
  produto_alterado: ['Produto alterado (preço/estoque)', 'av'], produto_excluido: ['Produto excluído', 'av'], produto_novo: ['Produto cadastrado', 'in'],
  etiqueta_divergente: ['Etiqueta de balança não confere', 'er'], senha_errada: ['Senha errada', 'av'], senha_bloqueada: ['Senha travada (muitas tentativas)', 'er'],
  login: ['Entrou no sistema', 'in'], caixa_abrir: ['Abriu o caixa', 'in'], caixa_fechar: ['Fechou o caixa', 'in'], entrada_xml: ['Entrada de nota (XML)', 'in'], produto_salvar: ['Produto salvo', 'in'],
};
async function telaAuditoria() {
  const hoje = new Date().toLocaleDateString('sv-SE'), semana = new Date(Date.now() - 6 * 864e5).toLocaleDateString('sv-SE');
  $('#tela').innerHTML = `<div class="card"><div class="linha" style="flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div class="campo" style="margin:0"><label>De</label><input type="date" id="ad" value="${semana}"></div><div class="campo" style="margin:0"><label>Até</label><input type="date" id="aa" value="${hoje}"></div>
      <div class="campo" style="margin:0;min-width:240px"><label>Mostrar</label><select id="af"><option value="risco">Só o que merece atenção</option><option value="">Tudo</option>${Object.entries(AUD).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></div>
      <button class="btn" id="ab" style="align-self:flex-end">Atualizar</button></div>
    <p class="ajuda" style="margin:0 0 10px">Tudo que pode virar desvio fica registrado aqui com quem fez e quem autorizou: itens tirados da venda, vendas canceladas, descontos, sangrias, mudança de preço e de estoque, senhas erradas.</p>
    <div id="ares"></div></div>`;
  const risco = ['item_removido', 'venda_limpa', 'venda_cancelar', 'desconto', 'fiado_acima_limite', 'sangria', 'produto_alterado', 'produto_excluido', 'etiqueta_divergente', 'senha_errada', 'senha_bloqueada'];
  const carregar = async () => {
    const f = $('#af').value; const r = await api('auditoria', { de: $('#ad').value, ate: $('#aa').value, tipo: f === 'risco' ? risco : f ? [f] : undefined });
    const cont = {}; r.lista.forEach(x => cont[x.acao] = (cont[x.acao] || 0) + 1);
    const resumo = risco.filter(k => cont[k]).map(k => `<span class="pill p-${AUD[k][1] === 'er' ? 'er' : 'av'}">${AUD[k][0]}: <b>${cont[k]}</b></span>`).join(' ');
    $('#ares').innerHTML = (resumo ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${resumo}</div>` : '') +
      `<div class="tabela" style="max-height:calc(100vh - 330px)"><table><thead><tr><th>Quando</th><th>O que</th><th>Quem</th><th>Detalhe</th></tr></thead><tbody>${r.lista.map(x => { const a = AUD[x.acao] || [x.acao, 'in'];
        return `<tr><td style="white-space:nowrap">${dataBR(x.data)}</td><td><span class="pill p-${a[1] === 'er' ? 'er' : a[1] === 'av' ? 'av' : 'in'}">${esc(a[0])}</span></td><td>${esc(x.usuario)}</td><td>${esc(x.detalhe || '')}</td></tr>`; }).join('') || '<tr><td colspan="4" class="vazio">Nada registrado no período.</td></tr>'}</tbody></table></div>`;
  };
  $('#ab').onclick = carregar; $('#af').onchange = carregar; $('#ad').onchange = carregar; $('#aa').onchange = carregar; await carregar();
}

// ======================= ENTRADA DE NOTAS =======================
async function telaEntrada() {
  const h = await api('entradas');
  $('#tela').innerHTML = `<div class="grid g2" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
    <div class="card"><h2>Lançar nota do fornecedor</h2><p class="ajuda" style="margin-bottom:12px">Peça o <b>XML</b> da nota para o fornecedor (vem no e-mail) e solte aqui. Estoque, custo e produtos novos entram sozinhos.</p>
      <label for="xf" id="drop" style="display:grid;place-items:center;border:2px dashed #b9c4bc;border-radius:16px;padding:36px;cursor:pointer;text-align:center;color:var(--mut)">${ico('entrada', 40)}<b style="color:var(--ink);margin-top:8px">Clique ou arraste o arquivo .xml</b></label><input type="file" id="xf" accept=".xml" class="hide"></div>
    <div class="card"><h2>Últimas entradas</h2><div class="tabela" style="max-height:340px"><table><thead><tr><th>Data</th><th>Fornecedor</th><th>Nota</th><th class="r">Total</th></tr></thead><tbody>${h.lista.map(e => `<tr><td>${dataBR(e.data)}</td><td>${esc(e.fornecedor)}</td><td>${esc(e.numero)}</td><td class="r">${R(e.total)}</td></tr>`).join('') || '<tr><td colspan="4" class="vazio">Nenhuma ainda</td></tr>'}</tbody></table></div></div></div><div id="prev" style="margin-top:16px"></div>`;
  const ler = async f => { try { const r = await api('entrada_ler', {}, f); previewEntrada(r); } catch (e) { toast(e.message, 'er'); } };
  $('#xf').onchange = e => e.target.files[0] && ler(e.target.files[0]);
  const d = $('#drop'); d.ondragover = e => { e.preventDefault(); d.style.borderColor = 'var(--verde)'; }; d.ondragleave = () => d.style.borderColor = ''; d.ondrop = e => { e.preventDefault(); d.style.borderColor = ''; if (e.dataTransfer.files[0]) ler(e.dataTransfer.files[0]); };
}
function previewEntrada(n) {
  const el = $('#prev');
  el.innerHTML = `<div class="card"><div class="linha" style="justify-content:space-between;margin-bottom:10px"><div><h2 style="margin:0">${esc(n.fornecedor)}</h2><div class="ajuda">NF ${esc(n.numero)} · ${n.itens.length} itens · ${R(n.total)}</div></div>${n.ja_lancada ? '<span class="pill p-er"><i></i>Esta nota já foi lançada</span>' : `<button class="btn pri lg" id="conf">Dar entrada no estoque</button>`}</div>
    <p class="ajuda">Se o fornecedor vende em caixa (ex.: caixa com 12) e você vende por unidade, coloque <b>12</b> em "Unid. por emb.".</p>
    <div class="tabela"><table><thead><tr><th>Produto na nota</th><th>Seu produto</th><th class="r">Qtd</th><th class="r">Custo nota</th><th style="width:90px">Unid. por emb.</th><th style="width:120px">Preço de venda</th><th>Entrar?</th></tr></thead><tbody>
    ${n.itens.map((i, k) => `<tr data-k="${k}"><td><b>${esc(i.nome)}</b><div class="ajuda">${esc(i.codigo || 'sem código de barras')} · NCM ${esc(i.ncm)}</div></td><td>${i.produto ? `<span class="chip p-ok">já cadastrado</span><div class="ajuda">${esc(i.produto.nome)}</div>` : '<span class="chip p-in">novo produto</span>'}</td>
      <td class="r">${QT(i.qtd)} ${esc(i.unidade)}</td><td class="r">${R(i.custo_un)}</td><td><input data-c="fator" type="number" min="1" value="1" style="min-height:36px"></td><td><input data-c="preco" inputmode="decimal" value="${N2(i.preco_sugerido)}" style="min-height:36px"></td><td><input data-c="ok" type="checkbox" checked style="width:22px;min-height:22px"></td></tr>`).join('')}</tbody></table></div></div>`;
  $$('#prev input[data-c=fator]').forEach(inp => inp.oninput = () => { const tr = inp.closest('tr'); const i = n.itens[tr.dataset.k]; const f = Math.max(1, +inp.value || 1); if (!i.produto) $('[data-c=preco]', tr).value = N2(i.custo_un / f * 1.3); });
  const b = $('#conf'); if (b) b.onclick = async () => {
    const itens = $$('#prev tr[data-k]').map(tr => { const i = n.itens[tr.dataset.k]; return { ...i, produto: undefined, produto_id: i.produto?.id, fator: +$('[data-c=fator]', tr).value || 1, preco_venda: num($('[data-c=preco]', tr).value), ignorar: !$('[data-c=ok]', tr).checked }; });
    try { const r = await api('entrada_confirmar', { chave: n.chave, fornecedor: n.fornecedor, cnpj: n.cnpj, numero: n.numero, total: n.total, itens }); toast(`${r.itens} itens lançados no estoque.`, 'ok'); telaEntrada(); atualizarStatus(); } catch (e) { toast(e.message, 'er'); }
  };
}

// ======================= CLIENTES / FIADO =======================
async function telaClientes() {
  $('#topoExtra').innerHTML = `<button class="btn sm pri" id="nc">+ Novo cliente</button>`; $('#nc').onclick = () => editarCliente({});
  $('#tela').innerHTML = `<div class="card"><input id="cb" placeholder="Buscar cliente" style="margin-bottom:10px"><div class="tabela"><table><thead><tr><th>Cliente</th><th>Telefone</th><th class="r">Limite</th><th class="r">Deve</th><th></th></tr></thead><tbody id="cl"></tbody></table></div></div>`;
  const carrega = async () => { const r = await api('clientes', { busca: $('#cb').value });
    $('#cl').innerHTML = r.lista.map(c => `<tr class="cl" data-id="${c.id}"><td><b>${esc(c.nome)}</b></td><td>${esc(c.telefone)}</td><td class="r">${+c.limite ? R(c.limite) : 'sem limite'}</td><td class="r ${+c.saldo > 0 ? 'desce' : ''}"><b>${R(c.saldo)}</b></td><td class="r"><button class="btn sm">Abrir</button></td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhum cliente</td></tr>';
    $$('#cl tr[data-id]').forEach(tr => tr.onclick = () => extrato(+tr.dataset.id)); };
  $('#cb').oninput = carrega; carrega();
}
function editarCliente(c) {
  modal({ titulo: c.id ? 'Editar cliente' : 'Novo cliente', corpo: `<div class="campo"><label>Nome</label><input id="cn" value="${esc(c.nome || '')}"></div><div class="grid g2"><div class="campo"><label>WhatsApp</label><input id="ct" value="${esc(c.telefone || '')}" placeholder="11999998888"></div><div class="campo"><label>CPF</label><input id="cc" value="${esc(c.cpf || '')}"></div></div><div class="campo"><label>Limite de fiado (0 = sem limite)</label><input id="cli" inputmode="decimal" value="${c.limite ? N2(c.limite) : ''}"></div>`,
    botoes: [{ txt: 'Salvar', cls: 'pri', acao: async f => { await api('cliente_salvar', { id: c.id, nome: $('#cn', f).value, telefone: $('#ct', f).value, cpf: $('#cc', f).value, limite: num($('#cli', f).value) }); toast('Salvo.', 'ok'); if (S.tela === 'clientes') telaClientes(); } }] });
}
async function extrato(id) {
  const r = await api('cliente_extrato', { id }); const c = r.cliente; const tel = (c.telefone || '').replace(/\D/g, '');
  const msg = `Olá ${c.nome.split(' ')[0]}! Aqui é do ${S.cfg.emp_fantasia || 'mercadinho'}. Seu saldo em aberto é de ${R(c.saldo)}. Quando puder passar para acertar, agradecemos! 😊`;
  modal({ titulo: esc(c.nome), lg: true, corpo: `<div class="grid g3" style="margin-bottom:14px"><div class="card kpi" style="box-shadow:none;border:1px solid var(--linha)"><div class="rot">Deve</div><div class="val ${+c.saldo > 0 ? 'desce' : ''}">${R(c.saldo)}</div></div><div class="card kpi" style="box-shadow:none;border:1px solid var(--linha)"><div class="rot">Limite</div><div class="val">${+c.limite ? R(c.limite) : '—'}</div></div>
    <div style="display:flex;flex-direction:column;gap:8px;justify-content:center">${tel && +c.saldo > 0 ? `<a class="btn" target="_blank" href="https://wa.me/55${tel}?text=${encodeURIComponent(msg)}">Cobrar no WhatsApp</a>` : ''}<button class="btn" id="edc">Editar cadastro</button></div></div>
    <div class="linha" style="margin-bottom:12px"><input id="rv" inputmode="decimal" placeholder="Valor recebido" style="flex:1"><select id="rf" style="width:auto"><option value="dinheiro">Dinheiro</option><option value="pix">PIX</option><option value="debito">Débito</option><option value="credito">Crédito</option></select><button class="btn pri" id="rec">Receber pagamento</button></div>
    <div class="tabela" style="max-height:300px"><table><thead><tr><th>Data</th><th>Movimento</th><th class="r">Valor</th></tr></thead><tbody>${r.movs.map(m => `<tr><td>${dataBR(m.data)}</td><td>${m.tipo === 'compra' ? 'Compra' + (m.venda_id ? ' (venda ' + m.venda_id + ')' : '') : m.tipo === 'pagamento' ? 'Pagamento · ' + esc(m.obs || '') : 'Estorno'}${m.obs && m.tipo === 'compra' ? ' · ' + esc(m.obs) : ''}</td><td class="r ${m.tipo === 'compra' ? 'desce' : 'sobe'}">${m.tipo === 'compra' ? '+' : '-'} ${R(m.valor)}</td></tr>`).join('') || '<tr><td colspan="3" class="vazio">Sem movimentos</td></tr>'}</tbody></table></div>`,
    aoAbrir: (f, fechar) => {
      $('#edc', f).onclick = () => { fechar(); editarCliente(c); };
      $('#rec', f).onclick = async () => { try { await api('fiado_receber', { id, valor: num($('#rv', f).value), forma: $('#rf', f).value }); toast('Pagamento registrado.', 'ok'); fechar(); extrato(id); if (S.tela === 'clientes') telaClientes(); } catch (e) { toast(e.message, 'er'); } };
    } });
}

// ======================= VENDAS E NFC-e =======================
async function telaVendas() {
  const de = ler('vde', hoje()), ate = ler('vate', hoje());
  $('#topoExtra').innerHTML = `<input type="date" id="vde" value="${de}" style="width:auto;min-height:36px"><input type="date" id="vate" value="${ate}" style="width:auto;min-height:36px">
    ${S.u.perfil === 'gerente' ? `<input type="month" id="vmes" value="${hoje().slice(0, 7)}" style="width:auto;min-height:36px"><button class="btn sm" id="vxml">Baixar XMLs do mês</button>` : ''}<button class="btn sm" id="vtx">Transmitir pendentes</button>`;
  $('#vde').onchange = $('#vate').onchange = () => { guardar('vde', $('#vde').value); guardar('vate', $('#vate').value); telaVendas(); };
  if ($('#vxml')) $('#vxml').onclick = () => { location.href = 'api.php?acao=xml_exportar&mes=' + $('#vmes').value; };
  $('#vtx').onclick = async () => { try { const r = await api('contingencia_transmitir'); toast(`${r.enviadas} enviadas, ${r.pendentes} pendentes.`, r.pendentes ? '' : 'ok'); telaVendas(); atualizarStatus(); } catch (e) { toast(e.message, 'er'); } };
  const r = await api('vendas', { de, ate }); const ok = r.lista.filter(v => v.status === 'ok');
  const stc = { demo: 'p-in', autorizada: 'p-ok', contingencia: 'p-av', rejeitada: 'p-er', pendente: 'p-av' };
  const stn = { demo: 'Simulada', autorizada: 'Autorizada', contingencia: 'Contingência', rejeitada: 'Não emitida', pendente: 'Pendente' };
  $('#tela').innerHTML = `<div class="grid g4" style="margin-bottom:16px"><div class="card kpi"><div class="rot">Vendas</div><div class="val">${ok.length}</div></div><div class="card kpi"><div class="rot">Total</div><div class="val">${R(ok.reduce((s, v) => s + +v.total, 0))}</div></div>
    <div class="card kpi"><div class="rot">Canceladas</div><div class="val">${r.lista.length - ok.length}</div></div><div class="card kpi"><div class="rot">Notas com problema</div><div class="val ${ok.some(v => v.nfce_status === 'rejeitada' || /rejeitada/.test(v.nfse_st || '')) ? 'desce' : ''}">${ok.filter(v => ['rejeitada', 'contingencia'].includes(v.nfce_status) || /rejeitada|pendente/.test(v.nfse_st || '')).length}</div></div></div>
    <div class="card"><div class="tabela"><table><thead><tr><th>Data</th><th>Venda</th><th>Nº NFC-e</th><th>Pagamento</th><th>Operador</th><th class="r">Total</th><th>Situação</th></tr></thead><tbody>
    ${r.lista.map(v => `<tr class="cl" data-id="${v.id}"><td>${dataBR(v.data)}</td><td>${v.id}</td><td>${v.numero ? v.numero + '/' + v.serie : '—'}</td><td>${esc((v.formas || '').split(', ').map(f => FORMAS[f] || f).join(', '))}</td><td>${esc(v.operador)}</td><td class="r"><b>${R(v.total)}</b></td>
      <td>${v.status === 'cancelada' ? '<span class="chip p-er">Cancelada</span>' : situacaoNotas({ nfce_status: v.nfce_status, nfse: (v.nfse_st || '').split(',').filter(Boolean).map(status => ({ status })) }).map(([t, cls, txt]) => `<span class="chip ${cls}" title="${esc(v.motivo || '')}" style="margin:1px">${t} ${txt}</span>`).join(' ') || '<span class="chip p-in">sem nota</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhuma venda no período</td></tr>'}</tbody></table></div></div>`;
  $$('#tela tr[data-id]').forEach(tr => tr.onclick = async () => mostrarCupom((await api('venda', { id: tr.dataset.id })).venda));
}

// ======================= CONCILIAÇÃO =======================
function telaConciliacao() {
  $('#tela').innerHTML = `<div class="card"><h2>Conferir maquininha × vendas</h2><p class="ajuda" style="margin-bottom:12px">Baixe o extrato de vendas no app/site da maquininha (Stone, Cielo, PagBank, Mercado Pago…) em CSV ou copie as linhas e cole aqui. O sistema cruza valor e horário com as vendas do caixa.</p>
    <div class="grid g2"><div><input type="file" id="cf" accept=".csv,.txt" style="margin-bottom:8px"><textarea id="ct" placeholder="25/11/2026 14:32;Crédito;Visa;R$ 23,50&#10;25/11/2026 14:40;Débito;Master;R$ 8,99"></textarea></div>
    <div><div class="campo"><label>Diferença de horário aceita (minutos)</label><input id="cj" type="number" value="10"></div><button class="btn pri lg" id="cgo">Conferir</button><p class="ajuda">Venda com cartão sem transação na maquininha pode ser erro de digitação ou desvio. Transação sem venda pode ser venda não registrada no caixa.</p></div></div></div><div id="cres" style="margin-top:16px"></div>`;
  $('#cf').onchange = async e => { $('#ct').value = await lerArquivoTexto(e.target.files[0]); };
  $('#cgo').onclick = async () => {
    try { const r = await api('conciliar', { csv: $('#ct').value, janela: +$('#cj').value });
      const tab = (l, cols) => `<table><tbody>${l.map(cols).join('') || '<tr><td class="vazio">Nenhum</td></tr>'}</tbody></table>`;
      $('#cres').innerHTML = `<div class="grid g3"><div class="card"><h2 class="sobe">✓ Bateram (${r.bateu.length})</h2><div class="tabela" style="max-height:400px">${tab(r.bateu, t => `<tr><td>${dataBR(t.data)}</td><td class="r">${R(t.valor)}</td><td>venda ${t.venda}</td></tr>`)}</div></div>
        <div class="card"><h2 class="desce">Na maquininha, sem venda (${r.sem_venda.length})</h2><div class="tabela" style="max-height:400px">${tab(r.sem_venda, t => `<tr><td>${dataBR(t.data)}</td><td>${FORMAS[t.forma] || ''}</td><td class="r">${R(t.valor)}</td></tr>`)}</div></div>
        <div class="card"><h2 class="desce">Venda no cartão, sem transação (${r.sem_pagamento.length})</h2><div class="tabela" style="max-height:400px">${tab(r.sem_pagamento, t => `<tr><td>${dataBR(t.data)}</td><td>venda ${t.venda} · ${FORMAS[t.forma]}</td><td class="r">${R(t.valor)}</td></tr>`)}</div></div></div>`;
    } catch (e) { toast(e.message, 'er'); }
  };
}

// ======================= CONFIGURAÇÕES =======================
async function telaConfig() {
  const est = await api('estado'); S.cfg = est.config; const c = S.cfg;
  const f = (k, rot, tipo = 'text', ex = '') => `<div class="campo"><label>${rot}</label><input data-k="${k}" type="${tipo}" value="${esc(c[k] ?? '')}" ${ex}></div>`;
  const sel = (k, rot, ops) => `<div class="campo"><label>${rot}</label><select data-k="${k}">${ops.map(([v, n]) => `<option value="${v}" ${String(c[k] ?? '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`;
  const u = await api('usuarios');
  $('#tela').innerHTML = `<div class="grid g2">
    <div class="card"><h2>Empresa</h2><div class="grid g2">${f('emp_cnpj', 'CNPJ')}${f('emp_ie', 'Inscrição Estadual')}</div><div class="grid g2">${f('emp_razao', 'Razão social')}${f('emp_fantasia', 'Nome fantasia')}</div>
      <div class="grid g3">${f('emp_logradouro', 'Endereço')}${f('emp_numero', 'Número')}${f('emp_bairro', 'Bairro')}</div><div class="grid g4">${f('emp_municipio', 'Cidade')}${f('emp_uf', 'UF')}${f('emp_cep', 'CEP')}${f('emp_cmun', 'Cód. IBGE')}</div>
      ${sel('emp_crt', 'Regime', [['1', 'Simples Nacional'], ['4', 'MEI'], ['3', 'Regime normal']])}</div>
    <div class="card"><h2>Nota fiscal</h2>${sel('emissao', 'O que a empresa emite', [['nfce', 'Só produtos (NFC-e)'], ['nfse', 'Só serviços (NFS-e)'], ['ambos', 'Produtos e serviços (NFC-e + NFS-e)']])}
      ${sel('ambiente', 'Ambiente', [['homologacao', 'Teste (homologação)'], ['producao', 'Produção (valendo)']])}
      <details ${(c.emissao || 'nfce') !== 'nfse' ? 'open' : ''}><summary style="cursor:pointer;font-weight:700;margin:4px 0 10px">NFC-e (produtos)</summary>
      <div class="grid g2">${f('nfce_serie', 'Série', 'number')}${f('nfce_numero', 'Próximo número', 'number')}</div><div class="grid g2">${f('csc', 'CSC', 'password')}${f('csc_id', 'ID do CSC')}</div></details>
      <details ${(c.emissao || 'nfce') !== 'nfce' ? 'open' : ''}><summary style="cursor:pointer;font-weight:700;margin:4px 0 10px">NFS-e (serviços)</summary>
      <div class="grid g3">${f('nfse_im', 'Inscrição municipal')}${f('nfse_serie', 'Série da DPS', 'number')}${f('nfse_numero', 'Próximo nº da DPS', 'number')}</div>
      ${sel('nfse_regesptrib', 'Regime especial de tributação', [['0', 'Nenhum'], ['1', 'Ato cooperado'], ['2', 'Estimativa'], ['3', 'Microempresa municipal'], ['4', 'Notário ou registrador'], ['5', 'Profissional autônomo'], ['6', 'Sociedade de profissionais'], ['9', 'Outros']])}</details>
      <div class="card" style="box-shadow:none;border:1px solid var(--linha);padding:12px;margin-bottom:12px"><b>Certificado A1</b> ${c.cert_validade ? `<span class="pill ${new Date(c.cert_validade) - Date.now() < 30 * 864e5 ? 'p-er' : 'p-ok'}"><i></i>válido até ${c.cert_validade.split('-').reverse().join('/')}</span>` : '<span class="pill p-av"><i></i>não enviado</span>'}
        <div class="linha" style="margin-top:8px"><input type="file" id="cfc" accept=".pfx,.p12" style="flex:1"><input type="password" id="cfs" placeholder="Senha" style="width:140px"><button class="btn" id="cfe">Enviar</button></div></div>
      <div class="linha"><button class="btn" id="tsf">Testar conexão</button><span id="tsr" class="ajuda"></span></div>
      ${est.biblioteca ? '' : '<p class="p-av" style="padding:10px;border-radius:10px;margin-top:10px">Biblioteca fiscal não encontrada: reinstale o PDV pelo botão <b>Baixe aqui</b> do site.</p>'}</div>
    <div class="card"><h2>Maquininha</h2>${sel('maquininha', 'Tipo', [['manual', 'Separada (caixa digita e confirma)'], ['stone', 'Stone integrada (Stone Connect)'], ['mp', 'Mercado Pago Point integrada']])}
      <details ${c.maquininha === 'stone' ? 'open' : ''}><summary style="cursor:pointer;font-weight:700;margin:4px 0 10px">Stone</summary>${f('stone_sk', 'Secret Key da loja (Partner Hub ou Pagar.me > Desenvolvimento > Chaves)', 'password')}${f('stone_parceiro', 'Seu ID de parceiro Stone (ServiceRefererName)')}${f('stone_serial', 'Número de série da maquininha (etiqueta atrás)')}
      <p class="ajuda">No painel Pagar.me, cadastre o webhook apontando para a URL do seu servidor de licenças (Apps Script), eventos de pedido e cobrança.</p></details>
      <details ${c.maquininha === 'mp' ? 'open' : ''}><summary style="cursor:pointer;font-weight:700;margin:4px 0 10px">Mercado Pago</summary>
      ${f('cnpj_credenciadora', 'CNPJ da credenciadora (opcional, vai na NFC-e)')}${f('mp_token', 'Access Token Mercado Pago', 'password')}
      <div class="linha"><select data-k="mp_terminal" id="mpt" style="flex:1"><option value="${esc(c.mp_terminal || '')}">${esc(c.mp_terminal || 'Nenhuma maquininha escolhida')}</option></select><button class="btn" id="mpb">Buscar maquininhas</button></div>
      <p class="ajuda">A maquininha precisa estar no modo PDV (no app do Mercado Pago).</p></details></div>
    <div class="card"><h2>Caixa e balança</h2>${sel('impressao_auto', 'Imprimir cupom automaticamente', [['0', 'Não (pergunta)'], ['1', 'Sim']])}${f('msg_cupom', 'Mensagem no fim do cupom')}${f('whats_dono', 'WhatsApp do dono (resumos e lista de compras)', 'text', 'placeholder="11999998888"')}
      ${sel('balanca_tipo', 'Etiqueta da balança traz', [['preco', 'Preço total'], ['peso', 'Peso (gramas)']])}<div class="grid g4">${f('balanca_cod_ini', 'Código: posição', 'number', 'placeholder="2"')}${f('balanca_cod_len', 'Código: dígitos', 'number', 'placeholder="4"')}${f('balanca_val_ini', 'Valor: posição', 'number', 'placeholder="8"')}${f('balanca_val_len', 'Valor: dígitos', 'number', 'placeholder="5"')}</div></div>
    <div class="card"><h2>Usuários</h2><table><tbody>${u.lista.map(x => `<tr><td><b>${esc(x.nome)}</b></td><td>${x.perfil === 'gerente' ? 'Gerente' : 'Caixa'}</td><td>${x.ativo == 1 ? '' : '<span class="chip p-er">inativo</span>'}</td><td class="r"><button class="btn sm" data-u="${x.id}">Editar</button></td></tr>`).join('')}</tbody></table><button class="btn" id="nu" style="margin-top:10px">+ Novo usuário</button></div>
    <div class="card"><h2>Responsável técnico e backup</h2><p class="ajuda" style="margin-bottom:10px">Alguns estados exigem os dados de quem fez o sistema na NFC-e.</p><div class="grid g2">${f('resp_cnpj', 'CNPJ do desenvolvedor')}${f('resp_nome', 'Nome de contato')}</div><div class="grid g2">${f('resp_email', 'E-mail')}${f('resp_fone', 'Telefone')}</div>
      <button class="btn" id="bk">Baixar cópia de segurança</button></div>
    <div class="card" style="border:2px solid var(--tomate-cl)"><h2>Zerar o sistema</h2><p class="ajuda" style="margin-bottom:10px">Apaga vendas, produtos, clientes, configurações e o certificado, e volta para o assistente de configuração. <b>A licença continua ativada.</b> A senha do gerente volta a ser 1234.</p><button class="btn dan" id="zr">Zerar todos os dados</button></div>
  </div><div style="position:sticky;bottom:0;padding:14px 0;text-align:right"><button class="btn pri lg" id="sv">Salvar configurações</button></div>`;
  $('#sv').onclick = async () => { const d = {}; $$('#tela [data-k]').forEach(i => d[i.dataset.k] = i.value.trim()); try { const r = await api('config_salvar', d); S.cfg = r.config; toast('Configurações salvas.', 'ok'); atualizarStatus(); $('#nomeLoja').textContent = S.cfg.emp_fantasia || S.cfg.emp_razao; } catch (e) { toast(e.message, 'er'); } };
  $('#cfe').onclick = async () => { const fl = $('#cfc').files[0]; if (!fl) return toast('Escolha o arquivo .pfx', 'er'); try { const r = await api('certificado', { senha: $('#cfs').value }, fl); toast('Certificado válido até ' + r.info.validade.split('-').reverse().join('/'), 'ok'); telaConfig(); } catch (e) { toast(e.message, 'er'); } };
  $('#tsf').onclick = async () => { $('#tsr').textContent = 'Testando… (salve antes se mudou algo)'; try { const r = await api('sefaz_status'); $('#tsr').innerHTML = (r.itens || []).map(x => `<b class="${x.ok ? 'sobe' : 'desce'}">${esc(x.tipo)}: ${esc(x.msg)}</b>`).join('<br>') || `<b>${esc(r.msg)}</b>`; } catch (e) { $('#tsr').innerHTML = `<b class="desce">${esc(e.message)}</b>`; } };
  $('#mpb').onclick = async () => { try { await api('config_salvar', { mp_token: $('[data-k=mp_token]').value }); const r = await api('mp_terminais'); $('#mpt').innerHTML = r.lista.map(t => `<option value="${esc(t.id)}">${esc(t.id)} (${esc(t.modo)})</option>`).join('') || '<option value="">Nenhuma encontrada</option>'; toast(r.lista.length + ' maquininha(s). Escolha e salve.', 'ok'); } catch (e) { toast(e.message, 'er'); } };
  $('#bk').onclick = () => { location.href = 'api.php?acao=backup'; };
  $('#zr').onclick = () => modal({ titulo: 'Zerar o sistema', corpo: `<p style="margin-top:0">Isso <b>apaga tudo</b> (vendas, produtos, clientes, configurações e certificado). Não tem como desfazer. <b>Baixe a cópia de segurança antes.</b></p><div class="campo"><label>Senha do gerente</label><input id="zp" type="password" inputmode="numeric"></div><div class="campo"><label>Digite ZERAR para confirmar</label><input id="zc" autocomplete="off"></div>`,
    botoes: [{ txt: 'Cancelar' }, { txt: 'Zerar', cls: 'dan', acao: async f => { await api('zerar_dados', { pin: $('#zp', f).value, confirmacao: $('#zc', f).value.trim().toUpperCase() }); try { localStorage.clear(); } catch (e) {} location.reload(); } }] });
  const edU = x => modal({ titulo: x.id ? 'Editar usuário' : 'Novo usuário', corpo: `<div class="campo"><label>Nome</label><input id="un" value="${esc(x.nome || '')}"></div><div class="grid g2"><div class="campo"><label>Senha (números)</label><input id="up" type="password" inputmode="numeric" placeholder="${x.id ? 'deixe em branco p/ manter' : 'mín. 4 números'}"></div><div class="campo"><label>Perfil</label><select id="uf"><option value="operador">Caixa</option><option value="gerente">Gerente</option></select></div></div>${x.id ? `<label><input type="checkbox" id="ua" ${x.ativo == 1 ? 'checked' : ''} style="width:auto;min-height:0"> Ativo</label>` : ''}`,
    aoAbrir: f => { if (x.perfil) $('#uf', f).value = x.perfil; },
    botoes: [{ txt: 'Salvar', cls: 'pri', acao: async f => { await api('usuario_salvar', { id: x.id, nome: $('#un', f).value, pin: $('#up', f).value, perfil: $('#uf', f).value, ativo: x.id ? ($('#ua', f).checked ? 1 : 0) : 1 }); toast('Usuário salvo.', 'ok'); telaConfig(); } }] });
  $('#nu').onclick = () => edU({}); $$('[data-u]').forEach(b => b.onclick = () => edU(u.lista.find(x => x.id == b.dataset.u)));
}

iniciar();
}
