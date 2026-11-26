/**
 * PDV - Servidor de licenças
 * Planilha Google + Apps Script (implantar como App da Web, acesso: "Qualquer pessoa")
 * Fluxo: o cliente instala o PDV e faz o cadastro -> o pedido chega como "Pendente" ->
 * você autoriza na área restrita escolhendo a data de vigência -> o PDV do cliente abre sozinho.
 *
 * Primeira vez: rode a função "configurarSenha" (menu Executar) depois de trocar a senha abaixo.
 */
const SENHA_INICIAL = 'troque-esta-senha';   // <- coloque a sua senha de administrador e rode configurarSenha()

const PROPS = PropertiesService.getScriptProperties();
const ABA = 'Licencas';
const COLS = ['Chave', 'Cliente', 'Telefone', 'CNPJ', 'Status', 'Vencimento', 'Maquina', 'Nome do PC', 'Criada', 'Ativada', 'Ultimo contato', 'Versao', 'Obs'];

function configurarSenha() {
  PROPS.setProperty('ADMIN_SENHA', SENHA_INICIAL);
  if (!PROPS.getProperty('SEGREDO')) PROPS.setProperty('SEGREDO', Utilities.getUuid() + Utilities.getUuid());
  aba_(); abaAcessos_();
  Logger.log('Senha configurada. Planilha das licenças: ' + planilha_().getUrl());
  Logger.log('Agora clique em Implantar > Nova implantação > App da Web.');
}

// ---------------------------------------------------------------- roteamento
function doGet(e) { return saida_(rotear_((e && e.parameter) || {})); }
function doPost(e) {
  let d = {};
  try { d = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (x) {}
  if (!d.acao && d.type && d.data) return saida_(webhookStone_(d)); // aviso da Stone/Pagar.me
  return saida_(rotear_(Object.assign({}, (e && e.parameter) || {}, d)));
}
function saida_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function rotear_(p) {
  try {
    switch (p.acao) {
      // públicas
      case 'site': return { ok: true, download: PROPS.getProperty('DOWNLOAD_URL') || '', versao: PROPS.getProperty('VERSAO') || '1.0', contato: PROPS.getProperty('CONTATO') || '' };
      case 'solicitar': return solicitar_(p);
      case 'ativar': return validar_(p, true);
      case 'verificar': return validar_(p, false);
      case 'admin_login': return login_(p.senha);
      case 'evento': return evento_(p);
      case 'stone_status': { const c = CacheService.getScriptCache().get('st_' + String(p.pedido || '')); return { ok: true, pedido: c ? JSON.parse(c) : null }; }
      // administrador
      case 'admin_listar': adm_(p); return { ok: true, lista: listar_() };
      case 'admin_salvar': adm_(p); return salvar_(p.dados || {});
      case 'admin_status': adm_(p); return status_(p.chave, p.status === 'Bloqueada' ? 'Bloqueada' : 'Ativa');
      case 'admin_autorizar': adm_(p); return autorizar_(p.chave, p.vencimento);
      case 'admin_liberar_maquina': adm_(p); return mudar_(p.chave, { Maquina: '', 'Nome do PC': '' });
      case 'admin_excluir': adm_(p); return excluir_(p.chave);
      case 'admin_acessos': adm_(p); return { ok: true, lista: acessos_(p.chave) };
      case 'admin_config':
        adm_(p);
        if (p.dados) {
          ['DOWNLOAD_URL', 'VERSAO', 'CONTATO'].forEach(k => { if (p.dados[k] !== undefined) PROPS.setProperty(k, String(p.dados[k]).trim()); });
          if (p.dados.NOVA_SENHA) { if (String(p.dados.NOVA_SENHA).length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.'); PROPS.setProperty('ADMIN_SENHA', String(p.dados.NOVA_SENHA)); }
        }
        return { ok: true, config: { DOWNLOAD_URL: PROPS.getProperty('DOWNLOAD_URL') || '', VERSAO: PROPS.getProperty('VERSAO') || '1.0', CONTATO: PROPS.getProperty('CONTATO') || '' } };
      default: return { ok: false, erro: 'Ação inválida.' };
    }
  } catch (err) {
    return { ok: false, erro: String(err.message || err) };
  }
}

// ---------------------------------------------------------------- planilha
// Funciona tanto colado dentro de uma planilha quanto como projeto avulso (cria a planilha sozinho)
function planilha_() {
  const ativa = SpreadsheetApp.getActiveSpreadsheet();
  if (ativa) return ativa;
  const id = PROPS.getProperty('PLANILHA_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  const nova = SpreadsheetApp.create('PDV - Licenças');
  PROPS.setProperty('PLANILHA_ID', nova.getId());
  Logger.log('Planilha criada: ' + nova.getUrl());
  return nova;
}
function aba_() {
  const ss = planilha_();
  let sh = ss.getSheetByName(ABA);
  if (!sh) {
    sh = ss.insertSheet(ABA);
    sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold').setBackground('#0f2a1d').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange(1, COLS.indexOf('Vencimento') + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  }
  return sh;
}
function linhas_() {
  const sh = aba_();
  const v = sh.getDataRange().getValues();
  const cab = v.shift();
  return v.map((r, i) => { const o = { _linha: i + 2 }; cab.forEach((c, k) => o[c] = r[k] instanceof Date ? Utilities.formatDate(r[k], 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm') : r[k]); return o; });
}
function acharChave_(chave) {
  chave = String(chave || '').trim().toUpperCase();
  return linhas_().find(o => String(o.Chave).toUpperCase() === chave) || null;
}
function gravar_(linha, campos) {
  const sh = aba_();
  Object.keys(campos).forEach(c => { const col = COLS.indexOf(c); if (col < 0) return; const r = sh.getRange(linha, col + 1); if (c === 'Vencimento') r.setNumberFormat('@'); r.setValue(campos[c]); });
}
function agora_() { return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm'); }

// ---------------------------------------------------------------- app (ativar / verificar)
function validar_(p, ativando) {
  const trava = LockService.getScriptLock(); trava.waitLock(10000);
  try {
    const l = acharChave_(p.chave);
    if (!l) return { ok: false, status: 'invalida', erro: 'Chave de acesso não encontrada. Confira com quem instalou o sistema.' };
    const contato = PROPS.getProperty('CONTATO') || '';
    if (l.Status === 'Bloqueada') { gravar_(l._linha, { 'Ultimo contato': agora_() }); if (ativando) registrar_(l.Chave, l.Cliente, 'Tentou ativar (bloqueada)', '', p.nome_pc); return { ok: true, status: 'bloqueada', cliente: l.Cliente, contato: contato, msg: 'Acesso bloqueado. Entre em contato para regularizar.' }; }
    const maq = String(p.maquina || '').trim();
    if (!maq) return { ok: false, status: 'invalida', erro: 'Computador não identificado.' };
    if (l.Maquina && l.Maquina !== maq) { registrar_(l.Chave, l.Cliente, 'Tentou usar em outro PC', '', p.nome_pc); return { ok: false, status: 'outra_maquina', erro: 'Esta chave já está em uso em outro computador (' + (l['Nome do PC'] || '?') + '). Peça para liberar a troca de computador.', contato: contato }; }
    if (l.Status === 'Pendente') { gravar_(l._linha, { 'Ultimo contato': agora_(), Versao: p.versao || '' }); return { ok: true, status: 'pendente', cliente: l.Cliente, contato: contato }; }
    const vence = String(l.Vencimento || '').slice(0, 10);
    if (vence && vence < hoje_()) { gravar_(l._linha, { 'Ultimo contato': agora_() }); return { ok: true, status: 'vencida', cliente: l.Cliente, contato: contato, vence: vence, msg: 'O acesso venceu em ' + dataBR_(vence) + '. Entre em contato para renovar.' }; }
    const campos = { 'Ultimo contato': agora_(), Versao: p.versao || '' };
    if (!l.Maquina) { campos.Maquina = maq; campos['Nome do PC'] = p.nome_pc || ''; campos.Ativada = agora_(); registrar_(l.Chave, l.Cliente, 'App ativado', '', p.nome_pc); }
    if (l.Status !== 'Ativa') campos.Status = 'Ativa';
    gravar_(l._linha, campos);
    return { ok: true, status: 'ativa', cliente: l.Cliente, contato: contato, vence: vence };
  } finally { trava.releaseLock(); }
}

// O cliente instala, faz o cadastro da empresa e o app manda o pedido de acesso.
// Fica "Pendente" até você autorizar na área restrita (com a data de vigência).
function solicitar_(p) {
  const trava = LockService.getScriptLock(); trava.waitLock(10000);
  try {
    const maq = String(p.maquina || '').trim();
    if (!maq) return { ok: false, status: 'invalida', erro: 'Computador não identificado.' };
    const contato = PROPS.getProperty('CONTATO') || '';
    const d = p.dados || {};
    const ja = linhas_().find(o => String(o.Maquina) === maq);
    if (ja) {   // este computador já pediu antes: devolve a situação atual
      gravar_(ja._linha, { 'Ultimo contato': agora_(), Versao: p.versao || '' });
      return Object.assign(validarLinha_(ja), { ok: true, chave: ja.Chave, cliente: ja.Cliente, contato: contato });
    }
    let chave; do { chave = novaChave_(); } while (acharChave_(chave));
    const cidade = [d.municipio, d.uf].filter(Boolean).join('/');
    const emissao = { nfce: 'NFC-e (produtos)', nfse: 'NFS-e (serviços)', ambos: 'NFC-e e NFS-e' }[d.emissao] || '';
    const campos = { Chave: chave, Cliente: String(d.fantasia || d.razao || 'Sem nome').slice(0, 80), Telefone: String(d.fone || '').slice(0, 30), CNPJ: fmtCnpj_(d.cnpj), Status: 'Pendente',
      Maquina: maq, 'Nome do PC': p.nome_pc || '', Criada: agora_(), 'Ultimo contato': agora_(), Versao: p.versao || '',
      Obs: [d.razao && d.razao !== d.fantasia ? d.razao : '', cidade, emissao].filter(Boolean).join(' · ').slice(0, 200) };
    aba_().appendRow(COLS.map(c => campos[c] ?? ''));
    registrar_(chave, campos.Cliente, 'Pediu acesso (cadastro feito)', '', p.nome_pc);
    return { ok: true, status: 'pendente', chave: chave, cliente: campos.Cliente, contato: contato };
  } finally { trava.releaseLock(); }
}
function validarLinha_(l) {
  if (l.Status === 'Pendente') return { status: 'pendente' };
  if (l.Status === 'Bloqueada') return { status: 'bloqueada', msg: 'Acesso bloqueado. Entre em contato para regularizar.' };
  const vence = String(l.Vencimento || '').slice(0, 10);
  if (vence && vence < hoje_()) return { status: 'vencida', vence: vence, msg: 'O acesso venceu em ' + dataBR_(vence) + '. Entre em contato para renovar.' };
  return { status: 'ativa', vence: vence };
}
function autorizar_(chave, vencimento) {
  const v = String(vencimento || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Escolha a data de vigência.');
  const l = acharChave_(chave); if (!l) throw new Error('Cliente não encontrado.');
  const campos = { Vencimento: v };
  if (l.Status === 'Pendente') { campos.Status = 'Ativa'; campos.Ativada = agora_(); }
  gravar_(l._linha, campos);
  registrar_(l.Chave, l.Cliente, (l.Status === 'Pendente' ? 'Acesso autorizado' : 'Vigência alterada') + ' até ' + dataBR_(v), '', l['Nome do PC']);
  return { ok: true };
}
function status_(chave, st) {
  const l = acharChave_(chave); if (!l) throw new Error('Cliente não encontrado.');
  gravar_(l._linha, { Status: st });
  registrar_(l.Chave, l.Cliente, st === 'Bloqueada' ? 'Bloqueado por você' : 'Desbloqueado por você', '', l['Nome do PC']);
  return { ok: true };
}
function hoje_() { return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd'); }
function dataBR_(v) { const m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(v); }
function fmtCnpj_(c) { const n = String(c || '').replace(/\D/g, ''); return n.length === 14 ? n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : n; }

// ---------------------------------------------------------------- maquininha Stone (webhook)
// No painel Pagar.me, cadastre o webhook com a URL deste App da Web (eventos order.* e charge.*).
// O PDV pergunta aqui se a cobrança foi paga e confirma direto na Stone antes de fechar a venda.
function webhookStone_(w) {
  const d = w.data || {};
  let pedido;
  if (String(w.type).indexOf('order.') === 0) pedido = d;
  else { const id = (d.order && d.order.id) || d.order_id; if (!id) return { ok: true }; pedido = { id: id, status: d.status === 'paid' ? 'paid' : (d.status || ''), charges: [d] }; }
  if (!pedido || !pedido.id) return { ok: true };
  const enxuto = { id: pedido.id, status: pedido.status, charges: (pedido.charges || []).slice(0, 1).map(c => ({ status: c.status, last_transaction: c.last_transaction ? { card: c.last_transaction.card ? { brand: c.last_transaction.card.brand } : null, acquirer_auth_code: c.last_transaction.acquirer_auth_code, acquirer_nsu: c.last_transaction.acquirer_nsu, id: c.last_transaction.id } : null })) };
  CacheService.getScriptCache().put('st_' + pedido.id, JSON.stringify(enxuto), 21600);
  return { ok: true };
}

// ---------------------------------------------------------------- registro de entradas (acessos)
function abaAcessos_() {
  const ss = planilha_();
  let sh = ss.getSheetByName('Acessos');
  if (!sh) { sh = ss.insertSheet('Acessos'); sh.getRange(1, 1, 1, 6).setValues([['Data', 'Chave', 'Cliente', 'Evento', 'Usuario', 'Nome do PC']]).setFontWeight('bold').setBackground('#0f2a1d').setFontColor('#ffffff'); sh.setFrozenRows(1); }
  return sh;
}
function registrar_(chave, cliente, evento, usuario, pc) {
  try { abaAcessos_().appendRow([agora_(), chave, cliente || '', evento, usuario || '', pc || '']); } catch (e) {}
}
// O app avisa quando alguém entra (login), abre o caixa etc.
function evento_(p) {
  const l = acharChave_(p.chave);
  if (!l || (l.Maquina && l.Maquina !== String(p.maquina || ''))) return { ok: false, erro: 'Licença inválida.' };
  registrar_(l.Chave, l.Cliente, String(p.evento || '').slice(0, 60), String(p.usuario || '').slice(0, 60), p.nome_pc);
  gravar_(l._linha, { 'Ultimo contato': agora_() });
  return Object.assign({ ok: true }, validarLinha_(l));
}
function acessos_(chave) {
  const v = abaAcessos_().getDataRange().getValues(); v.shift();
  const fmt = d => d instanceof Date ? Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm') : d;
  return v.filter(r => !chave || r[1] === chave).slice(-300).reverse().map(r => ({ data: fmt(r[0]), chave: r[1], cliente: r[2], evento: r[3], usuario: r[4], pc: r[5] }));
}

// ---------------------------------------------------------------- administrador
function login_(senha) {
  const certa = PROPS.getProperty('ADMIN_SENHA');
  if (!certa) return { ok: false, erro: 'Rode a função configurarSenha no Apps Script primeiro.' };
  Utilities.sleep(400); // dificulta tentativa e erro
  if (String(senha || '') !== certa) return { ok: false, erro: 'Senha incorreta.' };
  const ts = String(Date.now());
  return { ok: true, token: ts + '.' + assinar_(ts) };
}
function assinar_(t) {
  const b = Utilities.computeHmacSha256Signature(t + '|' + PROPS.getProperty('ADMIN_SENHA'), PROPS.getProperty('SEGREDO') || 'x');
  return Utilities.base64EncodeWebSafe(b);
}
function adm_(p) {
  const [ts, sig] = String(p.token || '').split('.');
  if (!ts || !sig || sig !== assinar_(ts) || Date.now() - Number(ts) > 12 * 3600 * 1000) throw new Error('Sessão expirada. Entre de novo.');
}
function listar_() {
  return linhas_().map(o => { const c = Object.assign({}, o); delete c._linha; return c; }).reverse();
}
function novaChave_() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 16; i++) { s += a[Math.floor(Math.random() * a.length)]; if (i % 4 === 3 && i < 15) s += '-'; }
  return s;
}
function salvar_(d) {
  const trava = LockService.getScriptLock(); trava.waitLock(10000);
  try {
    if (!String(d.Cliente || '').trim()) throw new Error('Informe o nome do cliente.');
    const campos = { Cliente: d.Cliente, Telefone: d.Telefone || '', CNPJ: d.CNPJ || '', Vencimento: d.Vencimento || '', Obs: d.Obs || '' };
    if (d.Chave) {
      const l = acharChave_(d.Chave); if (!l) throw new Error('Licença não encontrada.');
      gravar_(l._linha, campos);
      return { ok: true, chave: l.Chave };
    }
    let chave; do { chave = novaChave_(); } while (acharChave_(chave));
    const sh = aba_();
    const linha = COLS.map(c => ({ Chave: chave, Status: 'Ativa', Criada: agora_() })[c] ?? campos[c] ?? '');
    sh.appendRow(linha);
    return { ok: true, chave: chave };
  } finally { trava.releaseLock(); }
}
function mudar_(chave, campos) {
  const l = acharChave_(chave); if (!l) throw new Error('Licença não encontrada.');
  gravar_(l._linha, campos); return { ok: true };
}
function excluir_(chave) {
  const l = acharChave_(chave); if (!l) throw new Error('Licença não encontrada.');
  aba_().deleteRow(l._linha); return { ok: true };
}
