<?php
// ============================================================
//  Regras de negócio: vendas, caixa, estoque, fiado, entrada de XML,
//  maquininha Mercado Pago, conciliação e painel
// ============================================================

// ---------- Consulta de CNPJ (BrasilAPI - gratuita) ----------
function http(string $metodo, string $url, $corpo = null, array $headers = []): array {
  $ch = curl_init($url);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_CUSTOMREQUEST => $metodo,
    CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/json', 'User-Agent: PDV'], $headers)]);
  if ($corpo !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($corpo) ? $corpo : json_encode($corpo));
  $r = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch);
  if ($r === false) throw new Exception('Sem conexão com a internet (' . $err . ').');
  return [$code, json_decode((string)$r, true)];
}
function consultarCNPJ(string $cnpj): array {
  $cnpj = soDigitos($cnpj); if (strlen($cnpj) !== 14) throw new Exception('CNPJ deve ter 14 números.');
  [$c, $d] = http('GET', "https://brasilapi.com.br/api/cnpj/v1/$cnpj");
  if ($c !== 200) throw new Exception($d['message'] ?? 'CNPJ não encontrado.');
  return ['emp_razao' => $d['razao_social'] ?? '', 'emp_fantasia' => $d['nome_fantasia'] ?: ($d['razao_social'] ?? ''),
    'emp_logradouro' => trim(($d['descricao_tipo_de_logradouro'] ?? '') . ' ' . ($d['logradouro'] ?? '')), 'emp_numero' => $d['numero'] ?? '',
    'emp_complemento' => $d['complemento'] ?? '', 'emp_bairro' => $d['bairro'] ?? '', 'emp_cmun' => (string)($d['codigo_municipio_ibge'] ?? ''),
    'emp_municipio' => $d['municipio'] ?? '', 'emp_uf' => $d['uf'] ?? '', 'emp_cep' => $d['cep'] ?? '', 'emp_fone' => $d['ddd_telefone_1'] ?? '',
    'emp_crt' => !empty($d['opcao_pelo_simples']) || !empty($d['opcao_pelo_mei']) ? '1' : '3', 'situacao' => $d['descricao_situacao_cadastral'] ?? ''];
}

// ---------- Produtos ----------
function buscarPorCodigo(string $cod): array {
  $cod = preg_replace('/\s/', '', $cod);
  $p = q1('SELECT * FROM produtos WHERE codigo=? AND ativo=1', [$cod]);
  if ($p) return ['produto' => $p, 'qtd' => null];
  // Etiqueta de balança (EAN-13 começando com 2)
  if (strlen($cod) === 13 && $cod[0] === '2') {
    $ci = (int)cfg('balanca_cod_ini', 2); $cl = (int)cfg('balanca_cod_len', 4);
    $vi = (int)cfg('balanca_val_ini', 8); $vl = (int)cfg('balanca_val_len', 5);
    $cb = ltrim(substr($cod, $ci - 1, $cl), '0'); $val = (int)substr($cod, $vi - 1, $vl);
    foreach (q("SELECT * FROM produtos WHERE ativo=1 AND cod_balanca IS NOT NULL AND cod_balanca<>''") as $p)
      if (ltrim($p['cod_balanca'], '0') === $cb) {
        if (cfg('balanca_tipo', 'preco') === 'peso') return ['produto' => $p, 'qtd' => round($val / 1000, 3)];
        $total = $val / 100; return ['produto' => $p, 'qtd' => $p['preco'] > 0 ? round($total / $p['preco'], 3) : 1, 'total_etiqueta' => $total];
      }
    throw new Exception("Etiqueta de balança: código $cb não cadastrado (preencha 'Código na balança' no produto).");
  }
  throw new Exception("Produto $cod não encontrado.");
}

function importarCSV(string $csv): array {
  $csv = preg_replace('/^\xEF\xBB\xBF/', '', $csv); // BOM do Excel
  $linhas = array_values(array_filter(preg_split('/\r?\n/', trim($csv)), fn($l) => trim($l, " \t;,") !== ''));
  if (count($linhas) < 2) throw new Exception('Planilha vazia.');
  // separador: tab (colado do Excel), ponto e vírgula ou vírgula
  $amostra = implode("\n", array_slice($linhas, 0, 5));
  $cont = ["\t" => substr_count($amostra, "\t"), ';' => substr_count($amostra, ';'), ',' => substr_count($amostra, ',')];
  arsort($cont); $sep = array_key_first($cont);
  $norm = fn($h) => trim(preg_replace('/[^a-z0-9]+/', ' ', strtolower(iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', (string)$h) ?: (string)$h)));
  // acha a linha do cabeçalho (relatórios costumam ter título nas primeiras linhas)
  $ehNome = fn($h) => (bool)preg_match('/^(nome|descricao|produto|mercadoria|item)\b|\bdescricao\b/', $h);
  $ini = 0;
  foreach (array_slice($linhas, 0, 15, true) as $i => $l) { foreach (str_getcsv($l, $sep) as $h) if ($ehNome($norm($h))) { $ini = $i; break 2; } }
  $cab = array_map($norm, str_getcsv($linhas[$ini], $sep));
  // regras em ordem de prioridade: [campo, regex]
  $regras = [
    ['minimo', '/\b(estoque|qtd|quantidade) (minim|min)\b|^minimo$|^est min$/'],
    ['codigo', '/\b(ean|gtin|barras?|cod barras?|codigo de barras|ean13)\b/'],
    ['nome', '/^(nome|descricao|produto|mercadoria|item)\b|\bdescricao\b/'],
    ['custo', '/\bcusto\b|preco de compra|preco compra|vlr compra/'],
    ['preco', '/\b(preco|valor|vlr|pr)\b.*\bvenda\b|^venda$|^preco$|^valor$|^preco unit|^vlr unit|^p venda$/'],
    ['estoque', '/\b(estoque|saldo|quantidade|qtd|qtde|quant)\b/'],
    ['ncm', '/\bncm\b/'], ['cest', '/\bcest\b/'], ['cfop', '/\bcfop\b/'], ['csosn', '/\b(csosn|cst)\b/'],
    ['unidade', '/^(un|und|unid|unidade|medida|unidade de medida)$/'],
    ['categoria', '/\b(categoria|grupo|secao|departamento|familia)\b/'],
    ['codigo_int', '/^(codigo|cod|cod produto|codigo produto|referencia|ref)$/'],
  ];
  $idx = [];
  foreach ($regras as [$campo, $re]) foreach ($cab as $i => $h) if ($h !== '' && !in_array($i, $idx, true) && preg_match($re, $h)) { $idx[$campo] = $i; break; }
  if (!isset($idx['codigo']) && isset($idx['codigo_int'])) $idx['codigo'] = $idx['codigo_int']; // sem coluna de barras: usa o código que tiver
  if (!isset($idx['nome'])) throw new Exception('Não achei a coluna com o nome do produto. Deixe na primeira linha um título como "nome" ou "descricao".');
  $num = function ($v) { $v = preg_replace('/[^\d,.-]/', '', (string)$v); if (strpos($v, ',') !== false) $v = str_replace(',', '.', str_replace('.', '', $v)); return (float)$v; };
  $novos = 0; $atual = 0;
  db()->beginTransaction();
  foreach (array_slice($linhas, $ini + 1) as $l) {
    if (!trim($l)) continue; $c = str_getcsv($l, $sep);
    $g = fn($k) => isset($idx[$k]) ? trim($c[$idx[$k]] ?? '') : null;
    $cod = $g('codigo'); if ($cod !== null && preg_match('/^\d+([.,]0+)?$/', $cod)) $cod = preg_replace('/[.,]0+$/', '', $cod);
    $d = ['nome' => $g('nome'), 'codigo' => $cod, 'unidade' => strtoupper($g('unidade') ?: 'UN'), 'ncm' => ($n = soDigitos($g('ncm'))) ? str_pad($n, 8, '0', STR_PAD_LEFT) : '00000000',
      'cest' => ($ce = soDigitos($g('cest'))) ? str_pad($ce, 7, '0', STR_PAD_LEFT) : '', 'cfop' => soDigitos($g('cfop')) ?: '5102', 'csosn' => soDigitos($g('csosn')) ?: '102', 'categoria' => $g('categoria')];
    foreach (['preco', 'custo', 'estoque', 'minimo'] as $k) $d[$k] = $g($k) !== null && $g($k) !== '' ? $num($g($k)) : 0;
    if (!$d['nome'] || preg_match('/^total\b/i', $d['nome'])) continue;
    $id = $d['codigo'] ? qv('SELECT id FROM produtos WHERE codigo=? AND ativo=1', [$d['codigo']]) : qv('SELECT id FROM produtos WHERE nome=? AND ativo=1', [$d['nome']]);
    if ($id) { // atualiza só as colunas que vieram na planilha
      $set = ['nome=?']; $par = [$d['nome']];
      foreach (['preco', 'custo', 'estoque', 'minimo', 'ncm', 'unidade', 'cest', 'cfop', 'csosn', 'categoria'] as $k) if (isset($idx[$k]) && $g($k) !== '') { $set[] = "$k=?"; $par[] = $d[$k]; }
      $par[] = agora(); $par[] = $id;
      ex('UPDATE produtos SET ' . implode(',', $set) . ',atualizado=? WHERE id=?', $par); $atual++; }
    else { ex('INSERT INTO produtos (codigo,nome,unidade,preco,custo,estoque,minimo,ncm,cest,cfop,csosn,categoria,atualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [$d['codigo'], $d['nome'], $d['unidade'], $d['preco'], $d['custo'], $d['estoque'], $d['minimo'], $d['ncm'], $d['cest'], $d['cfop'], $d['csosn'], $d['categoria'], agora()]); $novos++; }
  }
  db()->commit();
  $nomes = ['codigo' => 'código', 'nome' => 'nome', 'preco' => 'preço', 'custo' => 'custo', 'estoque' => 'estoque', 'ncm' => 'NCM', 'unidade' => 'unidade', 'minimo' => 'mínimo', 'categoria' => 'categoria', 'cest' => 'CEST', 'cfop' => 'CFOP', 'csosn' => 'CSOSN'];
  return ['novos' => $novos, 'atualizados' => $atual, 'colunas' => array_values(array_intersect_key($nomes, $idx))];
}

// ---------- Entrada por XML da NF-e do fornecedor ----------
function lerXMLFornecedor(string $xml): array {
  $xml = preg_replace('/xmlns="[^"]+"/', '', $xml);
  $x = @simplexml_load_string($xml); if (!$x) throw new Exception('Arquivo XML inválido.');
  $inf = $x->NFe->infNFe ?? $x->infNFe ?? null; if (!$inf) throw new Exception('Este XML não é uma NF-e.');
  $chave = (string)($x->protNFe->infProt->chNFe ?? substr((string)$inf['Id'], 3));
  $itens = [];
  foreach ($inf->det as $det) {
    $p = $det->prod; $ean = (string)$p->cEAN; if (!preg_match('/^\d{8,14}$/', $ean)) $ean = '';
    $prod = $ean ? q1('SELECT id,nome,preco,custo,estoque FROM produtos WHERE codigo=? AND ativo=1', [$ean]) : null;
    $custo = (float)$p->vProd / max((float)$p->qCom, 0.0001);
    $itens[] = ['codigo' => $ean, 'cprod' => (string)$p->cProd, 'nome' => (string)$p->xProd, 'ncm' => (string)$p->NCM, 'cest' => (string)($p->CEST ?? ''),
      'unidade' => (string)$p->uCom, 'qtd' => (float)$p->qCom, 'custo_un' => round($custo, 4), 'total' => (float)$p->vProd, 'fator' => 1,
      'produto' => $prod, 'preco_sugerido' => $prod ? (float)$prod['preco'] : round($custo * 1.3, 2)];
  }
  return ['chave' => $chave, 'ja_lancada' => (bool)qv('SELECT id FROM entradas WHERE chave=?', [$chave]), 'fornecedor' => (string)$inf->emit->xNome,
    'cnpj' => (string)$inf->emit->CNPJ, 'numero' => (string)$inf->ide->nNF, 'total' => (float)$inf->total->ICMSTot->vNF, 'itens' => $itens];
}
function confirmarEntrada(array $in, array $u): array {
  if (qv('SELECT id FROM entradas WHERE chave=?', [$in['chave']])) throw new Exception('Essa nota já foi lançada.');
  db()->beginTransaction(); $n = 0;
  foreach ($in['itens'] as $it) {
    if (!empty($it['ignorar'])) continue;
    $fator = max((float)($it['fator'] ?? 1), 0.0001); $qtd = (float)$it['qtd'] * $fator; $custo = (float)$it['custo_un'] / $fator;
    if (!empty($it['produto_id'])) {
      ex('UPDATE produtos SET estoque=estoque+?, custo=?, preco=?, atualizado=? WHERE id=?', [$qtd, round($custo, 4), (float)$it['preco_venda'], agora(), $it['produto_id']]);
    } else {
      ex('INSERT INTO produtos (codigo,nome,unidade,preco,custo,estoque,ncm,cest,atualizado) VALUES (?,?,?,?,?,?,?,?,?)',
        [$it['codigo'] ?: null, $it['nome'], $fator > 1 ? 'UN' : ($it['unidade'] ?: 'UN'), (float)$it['preco_venda'], round($custo, 4), $qtd, $it['ncm'] ?: '00000000', $it['cest'] ?: null, agora()]);
    }
    $n++;
  }
  ex('INSERT INTO entradas (data,fornecedor,cnpj,numero,chave,total,itens) VALUES (?,?,?,?,?,?,?)', [agora(), $in['fornecedor'], $in['cnpj'], $in['numero'], $in['chave'], (float)$in['total'], $n]);
  db()->commit(); logar($u['nome'], 'entrada_xml', (string)$in['chave']);
  return ['itens' => $n];
}

// ---------- Caixa ----------
function resumoCaixa(int $id): array {
  $cx = q1('SELECT * FROM caixas WHERE id=?', [$id]);
  $formas = []; foreach (q("SELECT p.forma, SUM(p.valor) t, COUNT(*) n FROM venda_pag p JOIN vendas v ON v.id=p.venda_id WHERE v.caixa_id=? AND v.status='ok' GROUP BY p.forma", [$id]) as $r) $formas[$r['forma']] = round((float)$r['t'], 2);
  $mov = []; foreach (q('SELECT tipo, SUM(valor) t FROM caixa_mov WHERE caixa_id=? GROUP BY tipo', [$id]) as $r) $mov[$r['tipo']] = round((float)$r['t'], 2);
  $vendas = q1("SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM vendas WHERE caixa_id=? AND status='ok'", [$id]);
  $esperado = (float)$cx['valor_inicial'] + ($formas['dinheiro'] ?? 0) + ($mov['suprimento'] ?? 0) + ($mov['recebimento_fiado'] ?? 0) - ($mov['sangria'] ?? 0);
  return ['formas' => $formas, 'mov' => $mov, 'vendas' => (int)$vendas['n'], 'total' => round((float)$vendas['t'], 2), 'valor_inicial' => (float)$cx['valor_inicial'],
    'canceladas' => (int)qv("SELECT COUNT(*) FROM vendas WHERE caixa_id=? AND status='cancelada'", [$id]), 'dinheiro_esperado' => round($esperado, 2)];
}
function textoFechamento(array $cx, array $r, float $contado): string {
  $f = fn($v) => 'R$ ' . number_format((float)$v, 2, ',', '.');
  $nomes = ['dinheiro' => 'Dinheiro', 'pix' => 'PIX', 'debito' => 'Débito', 'credito' => 'Crédito', 'fiado' => 'Fiado'];
  $t = "*Fechamento de caixa - " . (cfg('emp_fantasia') ?: 'PDV') . "*\n" . date('d/m/Y H:i') . " | Operador: {$cx['operador']}\n\n";
  $t .= "Vendas: {$r['vendas']} | Total: " . $f($r['total']) . "\n";
  foreach ($r['formas'] as $k => $v) $t .= '• ' . ($nomes[$k] ?? $k) . ': ' . $f($v) . "\n";
  if (!empty($r['mov']['sangria'])) $t .= 'Sangrias: ' . $f($r['mov']['sangria']) . "\n";
  $t .= "\nDinheiro esperado: " . $f($r['dinheiro_esperado']) . "\nContado: " . $f($contado) . "\nDiferença: " . $f($contado - $r['dinheiro_esperado']);
  if ($r['canceladas']) $t .= "\nVendas canceladas: {$r['canceladas']}";
  return $t;
}

// ---------- Venda ----------
function finalizarVenda(array $in, array $u): array {
  $cx = q1("SELECT * FROM caixas WHERE status='aberto'"); if (!$cx) throw new Exception('Abra o caixa antes de vender.');
  if (empty($in['itens'])) throw new Exception('Nenhum item na venda.');
  $itens = []; $sub = 0;
  foreach ($in['itens'] as $i) {
    $p = q1('SELECT * FROM produtos WHERE id=?', [(int)$i['produto_id']]); if (!$p) throw new Exception('Produto não encontrado: ' . ($i['nome'] ?? ''));
    $qtd = round((float)$i['qtd'], 3); if ($qtd <= 0) continue;
    $preco = (float)$p['preco'];
    if ($p['promo_qtd'] && $qtd >= (float)$p['promo_qtd'] && $p['promo_preco']) $preco = (float)$p['promo_preco'];
    $tot = round($qtd * $preco, 2);
    if (!empty($i['total_etiqueta'])) { $tot = round((float)$i['total_etiqueta'], 2); $preco = round($tot / $qtd, 4); } // valor exato impresso pela balança
    $itens[] = ['produto_id' => $p['id'], 'codigo' => $p['codigo'] ?: $p['id'], 'nome' => $p['nome'], 'unidade' => $p['unidade'], 'qtd' => $qtd, 'preco' => $preco, 'total' => $tot,
      'desconto' => 0, 'custo' => (float)$p['custo'], 'ncm' => $p['ncm'], 'cfop' => $p['cfop'], 'csosn' => $p['csosn'], 'origem' => $p['origem'], 'cest' => $p['cest'], 'trib_aprox' => (float)$p['trib_aprox'],
      'tipo' => ($p['tipo'] ?? 'produto') === 'servico' ? 'servico' : 'produto', 'ctribnac' => $p['ctribnac'] ?? '', 'nbs' => $p['nbs'] ?? ''];
    $sub += $tot;
  }
  $sub = round($sub, 2);
  $temProd = (bool)array_filter($itens, fn($i) => $i['tipo'] === 'produto'); $temServ = (bool)array_filter($itens, fn($i) => $i['tipo'] === 'servico');
  if ($temProd && !emiteNFCe()) throw new Exception('Esta empresa está configurada para emitir só nota de SERVIÇO (NFS-e). Cadastre o item como serviço ou mude o tipo de emissão em Configurações.');
  if ($temServ && !emiteNFSe()) throw new Exception('Esta empresa está configurada para emitir só nota de PRODUTO (NFC-e). Mude o tipo de emissão em Configurações para vender serviços.');
  $desc = round(max(0, (float)($in['desconto'] ?? 0)), 2);
  if ($desc > 0 && $u['perfil'] !== 'gerente') gerente($in['pin'] ?? null);
  if ($desc >= $sub) throw new Exception('Desconto maior que o total.');
  // rateio do desconto entre os itens (exigido pela NFC-e)
  $rest = $desc; foreach ($itens as $k => $it) { $d = $k === count($itens) - 1 ? $rest : round($desc * $it['total'] / $sub, 2); $itens[$k]['desconto'] = $d; $rest = round($rest - $d, 2); }
  $total = round($sub - $desc, 2);
  $pags = []; $soma = 0; $din = 0;
  foreach ($in['pagamentos'] ?? [] as $p) {
    $val = round((float)$p['valor'], 2); if ($val <= 0) continue;
    $pags[] = ['forma' => $p['forma'], 'valor' => $val, 'integrado' => !empty($p['integrado']) ? 1 : 0, 'bandeira' => $p['bandeira'] ?? null, 'nsu' => $p['nsu'] ?? null,
      'autorizacao' => $p['autorizacao'] ?? null, 'cnpj_cred' => $p['cnpj_cred'] ?? (in_array($p['forma'], ['credito', 'debito', 'pix']) ? cfg('cnpj_credenciadora') : null)];
    $soma += $val; if ($p['forma'] === 'dinheiro') $din += $val;
  }
  $soma = round($soma, 2);
  if ($soma + 0.001 < $total) throw new Exception('Pagamento menor que o total da venda.');
  $troco = round($soma - $total, 2);
  if ($troco > $din + 0.001) throw new Exception('Troco só pode sair de pagamento em dinheiro.');
  if ($troco > 0) foreach ($pags as $k => $p) if ($p['forma'] === 'dinheiro') { $pags[$k]['valor'] = round($p['valor'] - $troco, 2); break; } // guarda o valor líquido
  $fiado = array_sum(array_map(fn($p) => $p['forma'] === 'fiado' ? $p['valor'] : 0, $pags));
  $cli = null;
  if ($fiado > 0) {
    $cli = q1('SELECT * FROM clientes WHERE id=?', [(int)($in['cliente_id'] ?? 0)]); if (!$cli) throw new Exception('Escolha o cliente do fiado.');
    if ($cli['limite'] > 0 && $cli['saldo'] + $fiado > $cli['limite'] + 0.001 && $u['perfil'] !== 'gerente') { gerente($in['pin'] ?? null); }
  }

  db()->beginTransaction();
  $vid = ex('INSERT INTO vendas (data,caixa_id,operador,subtotal,desconto,total,troco,cpf,cliente_id,nfce_status) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [agora(), $cx['id'], $u['nome'], $sub, $desc, $total, $troco, soDigitos($in['cpf'] ?? '') ?: null, $cli['id'] ?? null, 'pendente']);
  $si = db()->prepare('INSERT INTO venda_itens (venda_id,produto_id,codigo,nome,unidade,qtd,preco,desconto,total,custo,ncm,cfop,csosn,origem,cest,trib_aprox,tipo,ctribnac,nbs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  $se = db()->prepare('UPDATE produtos SET estoque=estoque-? WHERE id=?');
  foreach ($itens as $it) {
    $si->execute([$vid, $it['produto_id'], $it['codigo'], $it['nome'], $it['unidade'], $it['qtd'], $it['preco'], $it['desconto'], $it['total'], $it['custo'], $it['ncm'], $it['cfop'], $it['csosn'], $it['origem'], $it['cest'], $it['trib_aprox'], $it['tipo'], $it['ctribnac'], $it['nbs']]);
    if ($it['tipo'] === 'produto') $se->execute([$it['qtd'], $it['produto_id']]); // serviço não mexe no estoque
  }
  $sp = db()->prepare('INSERT INTO venda_pag (venda_id,forma,valor,integrado,bandeira,nsu,autorizacao,cnpj_cred,data) VALUES (?,?,?,?,?,?,?,?,?)');
  foreach ($pags as $p) $sp->execute([$vid, $p['forma'], $p['valor'], $p['integrado'], $p['bandeira'], $p['nsu'], $p['autorizacao'], $p['cnpj_cred'], agora()]);
  if ($fiado > 0) {
    ex('INSERT INTO fiado_mov (cliente_id,data,tipo,valor,venda_id) VALUES (?,?,?,?,?)', [$cli['id'], agora(), 'compra', $fiado, $vid]);
    ex('UPDATE clientes SET saldo=ROUND(saldo+?,2) WHERE id=?', [$fiado, $cli['id']]);
  }
  db()->commit();

  // Emissão da NFC-e (fora da transação: a venda nunca se perde, mesmo se a SEFAZ falhar)
  $venda = q1('SELECT * FROM vendas WHERE id=?', [$vid]);
  $prods = array_values(array_filter($itens, fn($i) => $i['tipo'] === 'produto'));
  $servs = array_values(array_filter($itens, fn($i) => $i['tipo'] === 'servico'));
  // NFC-e: só os produtos. Numa venda mista, o pagamento é dividido proporcionalmente entre as duas notas.
  if ($prods) {
    $vProd = round(array_sum(array_map(fn($i) => $i['total'] - $i['desconto'], $prods)), 2);
    $vendaNota = $venda; $pagsNota = $pags;
    if ($servs) {
      $vendaNota['troco'] = 0; $f = $total > 0 ? $vProd / $total : 1; $acum = 0;
      foreach ($pagsNota as $k => $pg) { $pagsNota[$k]['valor'] = $k === count($pagsNota) - 1 ? round($vProd - $acum, 2) : round($pg['valor'] * $f, 2); $acum += $pagsNota[$k]['valor']; }
      $pagsNota = array_values(array_filter($pagsNota, fn($pg) => $pg['valor'] > 0));
    }
    try { $r = emitirNFCe($vendaNota, $prods, $pagsNota); } // montarXML soma o troco de volta no pagamento em dinheiro
    catch (Throwable $e) { $r = ['nfce_status' => 'rejeitada', 'motivo' => $e->getMessage()]; }
    atualizarVendaFiscal($vid, $r);
  } else {
    atualizarVendaFiscal($vid, ['nfce_status' => 'sem_nota', 'motivo' => 'Venda só de serviços (NFS-e)']);
  }
  // NFS-e: os serviços (uma nota por código de serviço)
  if ($servs) { try { emitirNFSeVenda($venda, $servs, $cli); } catch (Throwable $e) { /* o erro fica registrado na NFS-e */ } }
  return ['venda' => vendaCompleta($vid)];
}
function atualizarVendaFiscal(int $id, array $r): void {
  $campos = ['nfce_status', 'chave', 'numero', 'serie', 'protocolo', 'qrcode', 'url_chave', 'motivo', 'tpemis', 'xml_path'];
  $d = array_intersect_key($r, array_flip($campos)); if (!$d) return;
  ex('UPDATE vendas SET ' . implode(',', array_map(fn($k) => "$k=?", array_keys($d))) . ' WHERE id=?', [...array_values($d), $id]);
}
function vendaCompleta(int $id): array {
  $v = q1('SELECT * FROM vendas WHERE id=?', [$id]); if (!$v) throw new Exception('Venda não encontrada.');
  $v['itens'] = q('SELECT * FROM venda_itens WHERE venda_id=?', [$id]);
  $v['pagamentos'] = q('SELECT * FROM venda_pag WHERE venda_id=?', [$id]);
  $v['cliente'] = $v['cliente_id'] ? q1('SELECT id,nome,saldo FROM clientes WHERE id=?', [$v['cliente_id']]) : null;
  $v['nfse'] = q('SELECT * FROM nfse WHERE venda_id=? ORDER BY id', [$id]);
  $u = nfseUrls(); foreach ($v['nfse'] as $k => $n) $v['nfse'][$k]['url_consulta'] = $n['chave'] ? $u['consulta'] . $n['chave'] : '';
  return $v;
}
function cancelarVenda(int $id, string $just, array $g): array {
  $v = q1('SELECT * FROM vendas WHERE id=?', [$id]); if (!$v || $v['status'] === 'cancelada') throw new Exception('Venda já cancelada ou inexistente.');
  $r = cancelarNFCe($v, $just ?: 'Cancelamento solicitado pelo cliente no caixa');
  if (!$r['ok']) throw new Exception($r['msg']);
  foreach (q("SELECT * FROM nfse WHERE venda_id=? AND status<>'cancelada'", [$id]) as $n) {
    $rn = nfseCancelar($n, $just ?: 'Cancelamento solicitado pelo cliente no caixa');
    if (!$rn['ok']) throw new Exception($rn['msg']);
  }
  db()->beginTransaction();
  foreach (q('SELECT * FROM venda_itens WHERE venda_id=?', [$id]) as $it) ex('UPDATE produtos SET estoque=estoque+? WHERE id=?', [$it['qtd'], $it['produto_id']]);
  $fiado = (float)qv("SELECT COALESCE(SUM(valor),0) FROM venda_pag WHERE venda_id=? AND forma='fiado'", [$id]);
  if ($fiado > 0 && $v['cliente_id']) {
    ex('INSERT INTO fiado_mov (cliente_id,data,tipo,valor,venda_id,obs) VALUES (?,?,?,?,?,?)', [$v['cliente_id'], agora(), 'estorno', $fiado, $id, 'Venda cancelada']);
    ex('UPDATE clientes SET saldo=ROUND(saldo-?,2) WHERE id=?', [$fiado, $v['cliente_id']]);
  }
  ex("UPDATE vendas SET status='cancelada', motivo=? WHERE id=?", ['Cancelada por ' . $g['nome'] . ': ' . $just, $id]);
  db()->commit(); logar($g['nome'], 'venda_cancelar', (string)$id);
  $temCartao = (bool)qv("SELECT COUNT(*) FROM venda_pag WHERE venda_id=? AND forma IN ('credito','debito','pix')", [$id]);
  return ['msg' => $r['msg'] . ($temCartao ? ' Lembre de estornar o pagamento na maquininha/PIX.' : '')];
}
function exportarXML(string $mes): string {
  if (!preg_match('/^\d{4}-\d{2}$/', $mes)) throw new Exception('Mês inválido.');
  if (!class_exists('ZipArchive')) throw new Exception('Ative a extensão zip no php.ini (veja o LEIA-ME).');
  $arq = DADOS . "/backup/xmls-nfce-$mes.zip"; @unlink($arq);
  $z = new ZipArchive(); $z->open($arq, ZipArchive::CREATE);
  foreach (glob(DADOS . "/xml/$mes/*.xml") ?: [] as $f) $z->addFile($f, basename($f));
  if ($z->numFiles === 0) $z->addFromString('LEIA.txt', 'Nenhuma NFC-e emitida neste mês.');
  $z->close(); return $arq;
}

// ---------- Mercado Pago Point (API Orders) ----------
function mp(string $metodo, string $path, $corpo = null): array {
  $tok = segredo((string)cfg('mp_token', ''), false); if (!$tok) throw new Exception('Configure o token do Mercado Pago em Configurações.');
  $h = ['Authorization: Bearer ' . $tok]; if ($metodo === 'POST') $h[] = 'X-Idempotency-Key: ' . bin2hex(random_bytes(16));
  [$c, $d] = http($metodo, 'https://api.mercadopago.com' . $path, $corpo, $h);
  if ($c >= 400) throw new Exception('Mercado Pago: ' . ($d['message'] ?? $d['errors'][0]['message'] ?? "erro $c"));
  return $d ?: [];
}
function mpTerminais(): array {
  $d = mp('GET', '/terminals/v1/list?limit=50');
  return array_map(fn($t) => ['id' => $t['id'], 'modo' => $t['operating_mode'] ?? ''], $d['data']['terminals'] ?? []);
}
function mpCobrar(float $valor, string $tipo, string $ref): array {
  $term = cfg('mp_terminal'); if (!$term) throw new Exception('Escolha a maquininha em Configurações.');
  $d = mp('POST', '/v1/orders', ['type' => 'point', 'external_reference' => $ref ?: 'pdv-' . time(), 'expiration_time' => 'PT5M', 'description' => cfg('emp_fantasia', 'Venda'),
    'transactions' => ['payments' => [['amount' => n2($valor)]]],
    'config' => ['point' => ['terminal_id' => $term, 'print_on_terminal' => 'no_ticket'], 'payment_method' => ['default_type' => $tipo === 'debito' ? 'debit_card' : 'credit_card']]]);
  return ['id' => $d['id'] ?? '', 'status' => $d['status'] ?? ''];
}
function mpStatus(string $id): array {
  $d = mp('GET', '/v1/orders/' . rawurlencode($id));
  $pg = $d['transactions']['payments'][0] ?? [];
  $st = $d['status'] ?? '';
  return ['status' => $st, 'aprovado' => in_array($st, ['processed', 'at_terminal_processed'], true) || ($pg['status'] ?? '') === 'processed',
    'falhou' => in_array($st, ['canceled', 'expired', 'failed', 'refunded'], true), 'bandeira' => $pg['payment_method']['id'] ?? '',
    'tipo' => $pg['payment_method']['type'] ?? '', 'autorizacao' => $pg['authorization_code'] ?? ($pg['reference_id'] ?? ''), 'nsu' => $pg['id'] ?? ''];
}
function mpCancelar(string $id): array { mp('POST', '/v1/orders/' . rawurlencode($id) . '/cancel'); return ['cancelado' => true]; }

// ---------- Conciliação da maquininha (extrato CSV x vendas) ----------
function conciliar(string $csv, int $janela): array {
  $linhas = array_filter(preg_split('/\r?\n/', trim($csv))); $trans = [];
  foreach ($linhas as $l) {
    if (!preg_match('/(\d{2})\/(\d{2})\/(\d{4})[ T,;]*(\d{2}):(\d{2})|(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/', $l, $m)) continue;
    $dt = !empty($m[1]) ? "$m[3]-$m[2]-$m[1] $m[4]:$m[5]:00" : "$m[6]-$m[7]-$m[8] $m[9]:$m[10]:00";
    $resto = str_replace($m[0], '', $l);
    if (!preg_match('/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2})(?!\d)/', $resto, $vm)) continue;
    $val = strpos($vm[1], ',') !== false ? (float)str_replace(',', '.', str_replace('.', '', $vm[1])) : (float)$vm[1];
    $forma = preg_match('/d[eé]bito/iu', $l) ? 'debito' : (preg_match('/pix/i', $l) ? 'pix' : (preg_match('/cr[eé]dito/iu', $l) ? 'credito' : ''));
    $trans[] = ['data' => $dt, 'valor' => $val, 'forma' => $forma, 'linha' => trim($l)];
  }
  if (!$trans) throw new Exception('Não encontrei transações. O arquivo precisa ter data/hora e valor em cada linha.');
  usort($trans, fn($a, $b) => strcmp($a['data'], $b['data']));
  $ini = date('Y-m-d H:i:s', strtotime($trans[0]['data']) - 3600); $fim = date('Y-m-d H:i:s', strtotime(end($trans)['data']) + 3600);
  $pags = q("SELECT p.*, v.data vdata, v.id vid FROM venda_pag p JOIN vendas v ON v.id=p.venda_id WHERE v.status='ok' AND p.forma IN ('credito','debito','pix') AND v.data BETWEEN ? AND ?", [$ini, $fim]);
  $usado = []; $bateu = []; $semVenda = [];
  foreach ($trans as $t) {
    $melhor = null; $dif = PHP_INT_MAX;
    foreach ($pags as $p) {
      if (isset($usado[$p['id']]) || abs($p['valor'] - $t['valor']) > 0.009) continue;
      if ($t['forma'] && $t['forma'] !== $p['forma']) continue;
      $d = abs(strtotime($p['vdata']) - strtotime($t['data']));
      if ($d <= $janela * 60 && $d < $dif) { $dif = $d; $melhor = $p; }
    }
    if ($melhor) { $usado[$melhor['id']] = 1; ex('UPDATE venda_pag SET conciliado=1 WHERE id=?', [$melhor['id']]); $bateu[] = $t + ['venda' => $melhor['vid'], 'min' => round($dif / 60)]; }
    else $semVenda[] = $t;
  }
  $semPag = array_values(array_filter($pags, fn($p) => !isset($usado[$p['id']])));
  return ['total' => count($trans), 'bateu' => $bateu, 'sem_venda' => $semVenda, 'sem_pagamento' => array_map(fn($p) => ['venda' => $p['vid'], 'data' => $p['vdata'], 'valor' => (float)$p['valor'], 'forma' => $p['forma']], $semPag)];
}

// ---------- Painel do dono ----------
function painel(string $de, string $ate): array {
  $a = "$de 00:00:00"; $b = "$ate 23:59:59";
  $tot = q1("SELECT COUNT(*) n, COALESCE(SUM(total),0) fat, COALESCE(SUM(desconto),0) desc FROM vendas WHERE status='ok' AND data BETWEEN ? AND ?", [$a, $b]);
  $custo = (float)qv("SELECT COALESCE(SUM(i.qtd*i.custo),0) FROM venda_itens i JOIN vendas v ON v.id=i.venda_id WHERE v.status='ok' AND v.data BETWEEN ? AND ?", [$a, $b]);
  $hoje = q1("SELECT COUNT(*) n, COALESCE(SUM(total),0) fat FROM vendas WHERE status='ok' AND date(data)=date('now','localtime')");
  $ontem = (float)qv("SELECT COALESCE(SUM(total),0) FROM vendas WHERE status='ok' AND date(data)=date('now','localtime','-1 day')");
  $dias = q("SELECT date(data) d, ROUND(SUM(total),2) t, COUNT(*) n FROM vendas WHERE status='ok' AND data BETWEEN ? AND ? GROUP BY date(data) ORDER BY d", [$a, $b]);
  $horas = q("SELECT CAST(strftime('%H',data) AS INT) h, ROUND(SUM(total),2) t, COUNT(*) n FROM vendas WHERE status='ok' AND data BETWEEN ? AND ? GROUP BY h ORDER BY h", [$a, $b]);
  $formas = q("SELECT p.forma, ROUND(SUM(p.valor),2) t FROM venda_pag p JOIN vendas v ON v.id=p.venda_id WHERE v.status='ok' AND v.data BETWEEN ? AND ? GROUP BY p.forma ORDER BY t DESC", [$a, $b]);
  $prods = q("SELECT i.produto_id, i.nome, ROUND(SUM(i.qtd),3) qtd, ROUND(SUM(i.total-i.desconto),2) fat, ROUND(SUM(i.total-i.desconto-i.qtd*i.custo),2) lucro
              FROM venda_itens i JOIN vendas v ON v.id=i.venda_id WHERE v.status='ok' AND v.data BETWEEN ? AND ? GROUP BY i.produto_id ORDER BY fat DESC", [$a, $b]);
  // Curva ABC: A = 80% do faturamento, B = próximos 15%, C = resto
  $fatT = array_sum(array_column($prods, 'fat')) ?: 1; $acc = 0;
  foreach ($prods as $k => $p) { $acc += $p['fat']; $prods[$k]['abc'] = $acc / $fatT <= 0.8 ? 'A' : ($acc / $fatT <= 0.95 ? 'B' : 'C'); }
  $parados = q("SELECT id,nome,estoque,custo,ROUND(estoque*custo,2) parado FROM produtos p WHERE ativo=1 AND estoque>0 AND NOT EXISTS
               (SELECT 1 FROM venda_itens i JOIN vendas v ON v.id=i.venda_id WHERE i.produto_id=p.id AND v.status='ok' AND v.data>=datetime('now','localtime','-30 days')) ORDER BY parado DESC LIMIT 10");
  return ['faturamento' => round((float)$tot['fat'], 2), 'vendas' => (int)$tot['n'], 'ticket' => $tot['n'] ? round($tot['fat'] / $tot['n'], 2) : 0,
    'lucro' => round($tot['fat'] - $custo, 2), 'margem' => $tot['fat'] > 0 ? round(($tot['fat'] - $custo) / $tot['fat'] * 100, 1) : 0, 'descontos' => round((float)$tot['desc'], 2),
    'hoje' => ['fat' => round((float)$hoje['fat'], 2), 'n' => (int)$hoje['n'], 'ontem' => round($ontem, 2)],
    'dias' => $dias, 'horas' => $horas, 'formas' => $formas, 'top' => array_slice($prods, 0, 15), 'abc' => array_count_values(array_column($prods, 'abc')),
    'parados' => $parados, 'fiado_receber' => round((float)qv('SELECT COALESCE(SUM(saldo),0) FROM clientes WHERE saldo>0'), 2),
    'estoque_valor' => round((float)qv('SELECT COALESCE(SUM(estoque*custo),0) FROM produtos WHERE ativo=1 AND estoque>0'), 2)];
}
function alertas(): array {
  $baixo = q("SELECT p.id,p.nome,p.estoque,p.minimo,p.unidade,
     (SELECT COALESCE(SUM(i.qtd),0)/30.0 FROM venda_itens i JOIN vendas v ON v.id=i.venda_id WHERE i.produto_id=p.id AND v.status='ok' AND v.data>=datetime('now','localtime','-30 days')) media
     FROM produtos p WHERE ativo=1 AND minimo>0 AND estoque<=minimo ORDER BY estoque/minimo LIMIT 50");
  foreach ($baixo as $k => $p) $baixo[$k]['comprar'] = max(ceil($p['media'] * 15 + $p['minimo'] - $p['estoque']), ceil($p['minimo'] * 2 - $p['estoque']));
  $val = q("SELECT id,nome,validade,estoque FROM produtos WHERE ativo=1 AND estoque>0 AND validade IS NOT NULL AND validade<>'' AND validade<=date('now','localtime','+15 days') ORDER BY validade");
  $cert = cfg('cert_validade'); $diasCert = $cert ? (int)floor((strtotime($cert) - time()) / 86400) : null;
  return ['estoque_baixo' => $baixo, 'validade' => $val, 'cert_dias' => $diasCert,
    'contingencia' => (int)qv("SELECT COUNT(*) FROM vendas WHERE status='ok' AND nfce_status='contingencia'"),
    'rejeitadas' => (int)qv("SELECT COUNT(*) FROM vendas WHERE status='ok' AND nfce_status='rejeitada'")];
}

// ---------- Stone Connect (Pagar.me) ----------
// Cobrança enviada direto para a maquininha Stone. O resultado chega por webhook no Apps Script
// (servidor de licenças) e o PDV consulta lá; a consulta direta à Stone fica só de reserva.
function stone(string $metodo, string $path, $corpo = null): array {
  $sk = segredo((string)cfg('stone_sk', ''), false);
  if (!$sk) throw new Exception('Configure a Secret Key da Stone em Configurações.');
  $h = ['Authorization: Basic ' . base64_encode($sk . ':')];
  if (cfg('stone_parceiro')) $h[] = 'ServiceRefererName: ' . cfg('stone_parceiro');
  [$c, $d] = http($metodo, 'https://api.pagar.me/core/v5' . $path, $corpo, $h);
  if ($c >= 400) throw new Exception('Stone: ' . ($d['message'] ?? (isset($d['errors']) ? json_encode($d['errors'], JSON_UNESCAPED_UNICODE) : "erro $c")));
  return $d ?: [];
}
function stoneCobrar(float $valor, string $tipo, string $ref): array {
  $serial = trim((string)cfg('stone_serial', '')); if (!$serial) throw new Exception('Informe o número de série da maquininha Stone em Configurações.');
  $tipos = ['credito' => 'credit', 'debito' => 'debit', 'pix' => 'pix'];
  $setup = ['type' => $tipos[$tipo] ?? 'credit'];
  if (in_array($setup['type'], ['credit', 'pix'], true)) { $setup['installments'] = 1; $setup['installment_type'] = 'merchant'; }
  $d = stone('POST', '/orders/', [
    'code' => $ref ?: 'pdv-' . time(),
    'customer' => ['name' => cfg('emp_fantasia', 'Consumidor'), 'email' => 'consumidor@pdv.local'],
    'items' => [['amount' => (int)round($valor * 100), 'description' => 'Venda PDV', 'quantity' => 1, 'code' => 'VENDA']],
    'closed' => false,
    'poi_payment_settings' => ['visible' => true, 'display_name' => 'Caixa', 'print_order_receipt' => false,
      'devices_serial_number' => [$serial], 'payment_setup' => $setup],
  ]);
  return ['id' => $d['id'] ?? '', 'status' => $d['status'] ?? ''];
}
function stoneLerPedido(array $o): array {
  $ch = $o['charges'][0] ?? []; $tx = $ch['last_transaction'] ?? [];
  $st = strtolower((string)($o['status'] ?? ''));
  $chst = strtolower((string)($ch['status'] ?? ''));
  return ['status' => $st ?: $chst, 'aprovado' => $st === 'paid' || $chst === 'paid',
    'falhou' => in_array($st, ['canceled', 'failed'], true) || in_array($chst, ['failed', 'canceled', 'not_authorized'], true),
    'bandeira' => strtolower((string)($tx['card']['brand'] ?? ($tx['brand'] ?? ''))),
    'autorizacao' => (string)($tx['acquirer_auth_code'] ?? ''), 'nsu' => (string)($tx['acquirer_nsu'] ?? ($tx['id'] ?? ''))];
}
function stoneStatus(string $id): array {
  // 1º: aviso que a Stone mandou para o Apps Script (webhook)
  if (licUrl() !== '') {
    try {
      $ch = curl_init(licUrl());
      curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 6, CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: text/plain'], CURLOPT_POSTFIELDS => json_encode(['acao' => 'stone_status', 'pedido' => $id])]);
      $r = json_decode((string)curl_exec($ch), true); curl_close($ch);
      if (!empty($r['pedido'])) {
        $res = stoneLerPedido($r['pedido']);
        // aprovado pelo aviso: confirma uma vez direto na Stone antes de fechar a venda (ninguém consegue forjar um "pago")
        if ($res['aprovado']) { $conf = stoneLerPedido(stone('GET', '/orders/' . rawurlencode($id))); return $conf['aprovado'] ? array_merge($res, array_filter($conf)) : $conf; }
        return $res;
      }
    } catch (Throwable $e) {}
  }
  // 2º (reserva): consulta direta, no máximo a cada 8 segundos por pedido
  $k = DADOS . '/.stone_' . preg_replace('/\W/', '', $id);
  if (file_exists($k) && time() - filemtime($k) < 8) return ['status' => 'pending', 'aprovado' => false, 'falhou' => false];
  touch($k);
  return stoneLerPedido(stone('GET', '/orders/' . rawurlencode($id)));
}
function stoneCancelar(string $id): array { stone('PATCH', '/orders/' . rawurlencode($id) . '/closed/', ['status' => 'canceled']); return ['cancelado' => true]; }
