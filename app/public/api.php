<?php
// ============================================================
//  API local do PDV - todas as ações passam por aqui
// ============================================================
declare(strict_types=1);
date_default_timezone_set('America/Sao_Paulo');
ini_set('display_errors', '0');
session_start();
// Se o PHP quebrar (ex.: extensão faltando), devolve o erro real em vez de uma tela vazia
register_shutdown_function(function () {
  $e = error_get_last();
  if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
    if (!headers_sent()) { http_response_code(500); header('Content-Type: application/json; charset=utf-8'); }
    echo json_encode(['ok' => false, 'erro' => 'Erro interno: ' . $e['message']], JSON_UNESCAPED_UNICODE);
  }
});
if (!extension_loaded('pdo_sqlite')) {
  http_response_code(500); header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['ok' => false, 'erro' => 'O PHP não carregou a extensão do banco (pdo_sqlite). Rode o instalar.bat de novo. Pasta atual: ' . dirname(__DIR__) . ' | php.ini: ' . (php_ini_loaded_file() ?: 'nenhum')], JSON_UNESCAPED_UNICODE);
  exit;
}
require dirname(__DIR__) . '/app/db.php';
require dirname(__DIR__) . '/app/fiscal.php';
require dirname(__DIR__) . '/app/extras.php';
require dirname(__DIR__) . '/app/licenca.php';

header('Content-Type: application/json; charset=utf-8');
$acao = $_GET['acao'] ?? '';
$in = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
$in = array_merge($_GET, $_POST, $in);

function ok($d = []) { echo json_encode(['ok' => true] + (is_array($d) ? $d : ['dados' => $d]), JSON_UNESCAPED_UNICODE); exit; }
function erro(string $m, int $code = 400) { http_response_code($code); echo json_encode(['ok' => false, 'erro' => $m], JSON_UNESCAPED_UNICODE); exit; }
function usuario(): array { if (empty($_SESSION['u'])) erro('Faça login novamente.', 401); return $_SESSION['u']; }
function gerente(?string $pin = null): array {
  $u = usuario();
  if ($u['perfil'] === 'gerente') return $u;
  if ($pin) foreach (q("SELECT * FROM usuarios WHERE perfil='gerente' AND ativo=1") as $g) if (password_verify($pin, $g['pin'])) return $g;
  erro('Precisa da senha do gerente.', 403);
}

try {
  // ---------------- Licença (trava do app) ----------------
  if ($acao === 'licenca_estado') ok(['licenca' => licEstado(!empty($in['forcar']))]);
  if ($acao === 'licenca_ativar') ok(['licenca' => licAtivar((string)($in['chave'] ?? ''))]);
  $lic = licEstado();
  if ($lic['status'] !== 'ativa') { http_response_code(402); echo json_encode(['ok' => false, 'erro' => 'Licença: ' . $lic['status'], 'licenca' => $lic], JSON_UNESCAPED_UNICODE); exit; }

  switch ($acao) {
  // ---------------- Sessão e configuração ----------------
  case 'estado':
    ok(['configurado' => cfg('configurado') === '1', 'usuario' => $_SESSION['u'] ?? null, 'ambiente' => ambiente(),
        'empresa' => cfg('emp_fantasia') ?: cfg('emp_razao'), 'biblioteca' => bibliotecaInstalada(), 'config' => (!empty($_SESSION['u']) || cfg('configurado') !== '1') ? configPublica() : ['emp_fantasia' => cfg('emp_fantasia'), 'emp_razao' => cfg('emp_razao'), 'ambiente' => ambiente()]]);
  case 'login':
    foreach (q('SELECT * FROM usuarios WHERE ativo=1') as $u) if (password_verify((string)($in['pin'] ?? ''), $u['pin'])) {
      $_SESSION['u'] = ['id' => $u['id'], 'nome' => $u['nome'], 'perfil' => $u['perfil']]; logar($u['nome'], 'login'); licEvento('Entrou no sistema', $u['nome']); ok(['usuario' => $_SESSION['u']]);
    }
    erro('Senha incorreta.');
  case 'sair': session_destroy(); ok();
  case 'config_salvar':
    if (cfg('configurado') === '1') gerente();
    $perm = ['emp_cnpj','emp_razao','emp_fantasia','emp_ie','emp_crt','emp_logradouro','emp_numero','emp_complemento','emp_bairro','emp_cmun','emp_municipio','emp_uf','emp_cep','emp_fone',
      'csc','csc_id','ambiente','nfce_serie','nfce_numero','maquininha','mp_token','mp_terminal','balanca_cod_ini','balanca_cod_len','balanca_val_ini','balanca_val_len','balanca_tipo',
      'resp_cnpj','resp_nome','resp_email','resp_fone','stone_sk','stone_parceiro','stone_serial','whats_dono','impressao_auto','cnpj_credenciadora','configurado','msg_cupom'];
    $vals = array_intersect_key($in, array_flip($perm));
    if (isset($vals['stone_sk'])) { if (str_contains($vals['stone_sk'], '•')) unset($vals['stone_sk']); else $vals['stone_sk'] = segredo(trim($vals['stone_sk']), true); }
    if (isset($vals['mp_token'])) { if (str_contains($vals['mp_token'], '•')) unset($vals['mp_token']); else $vals['mp_token'] = segredo(trim($vals['mp_token']), true); }
    if (isset($vals['ambiente']) && $vals['ambiente'] === 'producao' && !file_exists(DADOS . '/certificado/certificado.pfx')) erro('Para produção, envie o certificado A1 primeiro.');
    cfgSet($vals); ok(['config' => configPublica()]);
  case 'cnpj_consulta': ok(['dados' => consultarCNPJ((string)$in['cnpj'])]);
  case 'certificado':
    if (cfg('configurado') === '1') gerente();
    if (empty($_FILES['arquivo']['tmp_name'])) erro('Escolha o arquivo do certificado (.pfx).');
    $pfx = file_get_contents($_FILES['arquivo']['tmp_name']);
    $info = certificadoInfo($pfx, (string)($in['senha'] ?? ''));
    if (strtotime($info['validade']) < time()) erro('Este certificado venceu em ' . date('d/m/Y', strtotime($info['validade'])) . '.');
    file_put_contents(DADOS . '/certificado/certificado.pfx', $pfx);
    cfgSet(['cert_senha' => segredo((string)$in['senha'], true), 'cert_validade' => $info['validade'], 'cert_nome' => $info['nome'], 'cert_cnpj' => $info['cnpj']]);
    ok(['info' => $info]);
  case 'validar_gerente': gerente((string)($in['pin'] ?? '')); ok();
  case 'sefaz_status': ok(sefazStatus());
  case 'zerar_dados':
    // Zera o sistema: apaga vendas, produtos, configuração e certificado, mas mantém a licença ativada
    $g = gerente((string)($in['pin'] ?? ''));
    if (($in['confirmacao'] ?? '') !== 'ZERAR') erro('Digite ZERAR para confirmar.');
    $pdo = db(); $pdo->exec('PRAGMA wal_checkpoint(TRUNCATE)');
    foreach (['vendas', 'venda_itens', 'venda_pag', 'produtos', 'clientes', 'fiado_mov', 'caixas', 'caixa_mov', 'entradas', 'conciliacao', 'log', 'config', 'usuarios'] as $t) $pdo->exec("DELETE FROM $t");
    $pdo->exec("INSERT INTO usuarios (nome,pin,perfil) VALUES ('Gerente','" . password_hash('1234', PASSWORD_DEFAULT) . "','gerente')");
    $pdo->exec('VACUUM');
    $apagar = function ($dir) use (&$apagar) { foreach (glob($dir . '/*') ?: [] as $f) { is_dir($f) ? ($apagar($f) || @rmdir($f)) : @unlink($f); } };
    $apagar(DADOS . '/xml'); $apagar(DADOS . '/certificado');
    @mkdir(DADOS . '/xml/contingencia', 0775, true); @mkdir(DADOS . '/certificado', 0775, true);
    session_destroy(); ok();
  case 'usuarios': gerente(); ok(['lista' => q('SELECT id,nome,perfil,ativo FROM usuarios')]);
  case 'usuario_salvar':
    gerente();
    if (!empty($in['id'])) {
      ex('UPDATE usuarios SET nome=?, perfil=?, ativo=? WHERE id=?', [$in['nome'], $in['perfil'], (int)($in['ativo'] ?? 1), $in['id']]);
      if (!empty($in['pin'])) ex('UPDATE usuarios SET pin=? WHERE id=?', [password_hash((string)$in['pin'], PASSWORD_DEFAULT), $in['id']]);
    } else {
      if (strlen((string)($in['pin'] ?? '')) < 4) erro('A senha precisa ter pelo menos 4 números.');
      ex('INSERT INTO usuarios (nome,pin,perfil) VALUES (?,?,?)', [$in['nome'], password_hash((string)$in['pin'], PASSWORD_DEFAULT), $in['perfil'] ?? 'operador']);
    }
    ok();

  // ---------------- Produtos ----------------
  case 'produtos':
    usuario(); $t = '%' . ($in['busca'] ?? '') . '%';
    ok(['lista' => q('SELECT * FROM produtos WHERE ativo=1 AND (nome LIKE ? OR codigo LIKE ? OR categoria LIKE ?) ORDER BY nome LIMIT 500', [$t, $t, $t])]);
  case 'produto_codigo': usuario(); ok(buscarPorCodigo(trim((string)$in['codigo'])));
  case 'produto_salvar':
    $u = gerente($in['pin'] ?? null);
    $c = ['codigo','cod_balanca','nome','unidade','preco','custo','estoque','minimo','validade','ncm','cfop','csosn','cest','origem','trib_aprox','categoria','promo_qtd','promo_preco'];
    $d = []; foreach ($c as $k) $d[$k] = isset($in[$k]) && $in[$k] !== '' ? $in[$k] : null;
    if (!$d['nome']) erro('Informe o nome do produto.');
    if ($d['codigo'] && qv('SELECT id FROM produtos WHERE codigo=? AND ativo=1 AND id<>?', [$d['codigo'], (int)($in['id'] ?? 0)])) erro('Já existe um produto com esse código de barras.');
    $d['atualizado'] = agora();
    if (!empty($in['id'])) { $set = implode(',', array_map(fn($k) => "$k=?", array_keys($d))); ex("UPDATE produtos SET $set WHERE id=?", [...array_values($d), $in['id']]); $id = (int)$in['id']; }
    else { $id = ex('INSERT INTO produtos (' . implode(',', array_keys($d)) . ') VALUES (' . rtrim(str_repeat('?,', count($d)), ',') . ')', array_values($d)); }
    logar($u['nome'], 'produto_salvar', (string)$id); ok(['id' => $id]);
  case 'produto_excluir': gerente($in['pin'] ?? null); ex('UPDATE produtos SET ativo=0 WHERE id=?', [$in['id']]); ok();
  case 'produtos_importar': gerente(); ok(importarCSV((string)$in['csv']));

  // ---------------- Entrada de notas do fornecedor (XML) ----------------
  case 'entrada_ler':
    gerente();
    if (empty($_FILES['arquivo']['tmp_name'])) erro('Escolha o XML da nota do fornecedor.');
    ok(lerXMLFornecedor(file_get_contents($_FILES['arquivo']['tmp_name'])));
  case 'entrada_confirmar': $u = gerente(); ok(confirmarEntrada($in, $u));
  case 'entradas': gerente(); ok(['lista' => q('SELECT * FROM entradas ORDER BY id DESC LIMIT 100')]);

  // ---------------- Caixa ----------------
  case 'caixa_atual':
    usuario(); $cx = q1("SELECT * FROM caixas WHERE status='aberto' ORDER BY id DESC LIMIT 1");
    ok(['caixa' => $cx, 'resumo' => $cx ? resumoCaixa((int)$cx['id']) : null]);
  case 'caixa_abrir':
    $u = usuario(); if (qv("SELECT id FROM caixas WHERE status='aberto'")) erro('Já existe um caixa aberto.');
    $id = ex('INSERT INTO caixas (abertura,operador,valor_inicial) VALUES (?,?,?)', [agora(), $u['nome'], (float)($in['valor'] ?? 0)]);
    logar($u['nome'], 'caixa_abrir', (string)$id); licEvento('Abriu o caixa', $u['nome']); ok(['id' => $id]);
  case 'caixa_mov':
    $u = ($in['tipo'] ?? '') === 'sangria' ? gerente($in['pin'] ?? null) : usuario();
    $cx = qv("SELECT id FROM caixas WHERE status='aberto'"); if (!$cx) erro('Abra o caixa primeiro.');
    ex('INSERT INTO caixa_mov (caixa_id,data,tipo,valor,obs,operador) VALUES (?,?,?,?,?,?)', [$cx, agora(), $in['tipo'], abs((float)$in['valor']), $in['obs'] ?? '', $u['nome']]);
    ok();
  case 'caixa_fechar':
    $u = usuario(); $cx = q1("SELECT * FROM caixas WHERE status='aberto'"); if (!$cx) erro('Nenhum caixa aberto.');
    $r = resumoCaixa((int)$cx['id']);
    ex("UPDATE caixas SET status='fechado', fechamento=?, valor_contado=? WHERE id=?", [agora(), (float)($in['contado'] ?? 0), $cx['id']]);
    logar($u['nome'], 'caixa_fechar', (string)$cx['id']); licEvento('Fechou o caixa (' . $r['vendas'] . ' vendas)', $u['nome']);
    ok(['resumo' => $r, 'contado' => (float)($in['contado'] ?? 0), 'diferenca' => round((float)($in['contado'] ?? 0) - $r['dinheiro_esperado'], 2), 'whats' => textoFechamento($cx, $r, (float)($in['contado'] ?? 0))]);

  // ---------------- Vendas ----------------
  case 'venda_finalizar': $u = usuario(); ok(finalizarVenda($in, $u));
  case 'venda_reemitir':
    usuario(); $v = q1('SELECT * FROM vendas WHERE id=?', [$in['id']]);
    if (!$v || $v['nfce_status'] !== 'rejeitada') erro('Esta venda não precisa ser reemitida.');
    $itens = q('SELECT * FROM venda_itens WHERE venda_id=?', [$v['id']]); $pags = q('SELECT * FROM venda_pag WHERE venda_id=?', [$v['id']]);
    $r = emitirNFCe($v, $itens, $pags); atualizarVendaFiscal((int)$v['id'], $r); ok(['venda' => vendaCompleta((int)$v['id'])]);
  case 'venda': usuario(); ok(['venda' => vendaCompleta((int)$in['id'])]);
  case 'vendas':
    usuario(); $de = ($in['de'] ?? date('Y-m-d')) . ' 00:00:00'; $ate = ($in['ate'] ?? date('Y-m-d')) . ' 23:59:59';
    ok(['lista' => q("SELECT v.*, (SELECT GROUP_CONCAT(forma,', ') FROM venda_pag WHERE venda_id=v.id) formas FROM vendas v WHERE data BETWEEN ? AND ? ORDER BY id DESC", [$de, $ate])]);
  case 'venda_cancelar': $g = gerente($in['pin'] ?? null); ok(cancelarVenda((int)$in['id'], (string)($in['justificativa'] ?? ''), $g));
  case 'contingencia_transmitir': usuario(); ok(transmitirContingencias());
  case 'xml_exportar':
    gerente(); $arq = exportarXML((string)$in['mes']);
    header('Content-Type: application/zip'); header('Content-Disposition: attachment; filename="' . basename($arq) . '"'); readfile($arq); exit;

  // ---------------- Clientes e fiado ----------------
  case 'clientes': usuario(); $t = '%' . ($in['busca'] ?? '') . '%'; ok(['lista' => q('SELECT * FROM clientes WHERE nome LIKE ? OR telefone LIKE ? OR cpf LIKE ? ORDER BY nome', [$t, $t, $t])]);
  case 'cliente_salvar':
    usuario(); if (!trim((string)($in['nome'] ?? ''))) erro('Informe o nome.');
    if (!empty($in['id'])) ex('UPDATE clientes SET nome=?,telefone=?,cpf=?,limite=? WHERE id=?', [$in['nome'], $in['telefone'] ?? '', $in['cpf'] ?? '', (float)($in['limite'] ?? 0), $in['id']]);
    else ex('INSERT INTO clientes (nome,telefone,cpf,limite,criado) VALUES (?,?,?,?,?)', [$in['nome'], $in['telefone'] ?? '', $in['cpf'] ?? '', (float)($in['limite'] ?? 0), agora()]);
    ok();
  case 'cliente_extrato': usuario(); ok(['cliente' => q1('SELECT * FROM clientes WHERE id=?', [$in['id']]), 'movs' => q('SELECT * FROM fiado_mov WHERE cliente_id=? ORDER BY id DESC LIMIT 200', [$in['id']])]);
  case 'fiado_receber':
    $u = usuario(); $val = round((float)$in['valor'], 2); if ($val <= 0) erro('Valor inválido.');
    ex('INSERT INTO fiado_mov (cliente_id,data,tipo,valor,obs) VALUES (?,?,?,?,?)', [$in['id'], agora(), 'pagamento', $val, ($in['forma'] ?? 'dinheiro') . ' - ' . $u['nome']]);
    ex('UPDATE clientes SET saldo=ROUND(saldo-?,2) WHERE id=?', [$val, $in['id']]);
    if (($in['forma'] ?? 'dinheiro') === 'dinheiro' && ($cx = qv("SELECT id FROM caixas WHERE status='aberto'")))
      ex('INSERT INTO caixa_mov (caixa_id,data,tipo,valor,obs,operador) VALUES (?,?,?,?,?,?)', [$cx, agora(), 'recebimento_fiado', $val, 'Fiado cliente #' . $in['id'], $u['nome']]);
    ok();

  // ---------------- Maquininha (Mercado Pago Point) ----------------
  case 'mp_terminais': gerente(); ok(['lista' => mpTerminais()]);
  case 'mp_cobrar': usuario(); ok(mpCobrar((float)$in['valor'], (string)$in['tipo'], (string)($in['ref'] ?? '')));
  case 'mp_status': usuario(); ok(mpStatus((string)$in['id']));
  case 'mp_cancelar': usuario(); ok(mpCancelar((string)$in['id']));

  // ---------------- Maquininha Stone (Stone Connect) ----------------
  case 'stone_cobrar': usuario(); ok(stoneCobrar((float)$in['valor'], (string)$in['tipo'], (string)($in['ref'] ?? '')));
  case 'stone_status': usuario(); ok(stoneStatus((string)$in['id']));
  case 'stone_cancelar': usuario(); ok(stoneCancelar((string)$in['id']));

  // ---------------- Conciliação e relatórios ----------------
  case 'conciliar': gerente(); ok(conciliar((string)$in['csv'], (int)($in['janela'] ?? 10)));
  case 'painel': usuario(); ok(painel((string)($in['de'] ?? date('Y-m-01')), (string)($in['ate'] ?? date('Y-m-d'))));
  case 'alertas': usuario(); ok(alertas());
  case 'backup':
    gerente(); $f = DADOS . '/backup/pdv-' . date('Ymd-His') . '.sqlite'; db()->exec("VACUUM INTO " . db()->quote($f));
    header('Content-Type: application/octet-stream'); header('Content-Disposition: attachment; filename="' . basename($f) . '"'); readfile($f); exit;
  default: erro('Ação desconhecida.', 404);
  }
} catch (Throwable $e) {
  erro($e->getMessage(), 500);
}

function configPublica(): array {
  $c = []; foreach (q('SELECT k,v FROM config') as $r) $c[$r['k']] = $r['v'];
  unset($c['cert_senha']); $c['mp_token'] = !empty($c['mp_token']) ? '••••••••' : ''; $c['stone_sk'] = !empty($c['stone_sk']) ? '••••••••' : '';
  $c['cert_ok'] = file_exists(DADOS . '/certificado/certificado.pfx');
  return $c;
}
