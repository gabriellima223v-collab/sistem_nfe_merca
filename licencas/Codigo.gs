/**
 * PDV - Servidor de licenças
 * Planilha Google + Apps Script (implantar como App da Web, acesso: "Qualquer pessoa")
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
  aba_();
  Logger.log('Senha configurada. Agora implante como App da Web.');
}

// ---------------------------------------------------------------- roteamento
function doGet(e) { return saida_(rotear_((e && e.parameter) || {})); }
function doPost(e) {
  let d = {};
  try { d = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (x) {}
  return saida_(rotear_(Object.assign({}, (e && e.parameter) || {}, d)));
}
function saida_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function rotear_(p) {
  try {
    switch (p.acao) {
      // públicas
      case 'site': return { ok: true, download: PROPS.getProperty('DOWNLOAD_URL') || '', versao: PROPS.getProperty('VERSAO') || '1.0', contato: PROPS.getProperty('CONTATO') || '' };
      case 'ativar': return validar_(p, true);
      case 'verificar': return validar_(p, false);
      case 'admin_login': return login_(p.senha);
      case 'evento': return evento_(p);
      // administrador
      case 'admin_listar': adm_(p); return { ok: true, lista: listar_() };
      case 'admin_salvar': adm_(p); return salvar_(p.dados || {});
      case 'admin_status': adm_(p); return mudar_(p.chave, { Status: p.status === 'Bloqueada' ? 'Bloqueada' : 'Ativa' });
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
function aba_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ABA);
  if (!sh) {
    sh = ss.insertSheet(ABA);
    sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold').setBackground('#0f2a1d').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
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
  Object.keys(campos).forEach(c => { const col = COLS.indexOf(c); if (col >= 0) sh.getRange(linha, col + 1).setValue(campos[c]); });
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
    const campos = { 'Ultimo contato': agora_(), Versao: p.versao || '' };
    if (!l.Maquina) { campos.Maquina = maq; campos['Nome do PC'] = p.nome_pc || ''; campos.Ativada = agora_(); registrar_(l.Chave, l.Cliente, 'App ativado', '', p.nome_pc); }
    if (l.Status !== 'Ativa') campos.Status = 'Ativa';
    gravar_(l._linha, campos);
    return { ok: true, status: 'ativa', cliente: l.Cliente, contato: contato };
  } finally { trava.releaseLock(); }
}

// ---------------------------------------------------------------- registro de entradas (acessos)
function abaAcessos_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
  return { ok: true, status: l.Status === 'Bloqueada' ? 'bloqueada' : 'ativa' };
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
