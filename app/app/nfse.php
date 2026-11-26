<?php
// ============================================================
//  NFS-e Nacional (nota de serviço) — Sistema Nacional NFS-e
//  DPS layout 1.01, assinatura XMLDSig (rsa-sha1 + C14N) e envio
//  pela API Sefin Nacional com o certificado A1 da empresa (mTLS).
//  Não depende de biblioteca externa: só PHP (openssl, dom, curl, zlib).
// ============================================================
const NFSE_NS = 'http://www.sped.fazenda.gov.br/nfse';
const NFSE_VERSAO = '1.01';
const NFSE_VER_APLIC = 'PDV-1.0';

function emissaoTipo(): string { $e = cfg('emissao', 'nfce'); return in_array($e, ['nfce', 'nfse', 'ambos'], true) ? $e : 'nfce'; }
function emiteNFCe(): bool { return emissaoTipo() !== 'nfse'; }
function emiteNFSe(): bool { return emissaoTipo() !== 'nfce'; }

function nfseUrls(): array {
  $prod = ambiente() === 'producao';
  if ($t = cfg('nfse_url_teste')) return ['sefin' => $t, 'adn' => $t, 'consulta' => 'https://www.producaorestrita.nfse.gov.br/ConsultaPublica/?tpc=1&chave=']; // só para testes internos
  return [
    'sefin' => $prod ? 'https://sefin.nfse.gov.br/SefinNacional' : 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
    'adn' => $prod ? 'https://adn.nfse.gov.br' : 'https://adn.producaorestrita.nfse.gov.br',
    'consulta' => $prod ? 'https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=' : 'https://www.producaorestrita.nfse.gov.br/ConsultaPublica/?tpc=1&chave=',
  ];
}

// ---------- Certificado (PEM em memória a partir do .pfx) ----------
function nfseCertificado(): array {
  static $c = null; if ($c) return $c;
  $f = DADOS . '/certificado/certificado.pfx';
  if (!file_exists($f)) throw new Exception('Certificado A1 não configurado (Configurações > Nota fiscal).');
  $certs = [];
  if (!openssl_pkcs12_read(file_get_contents($f), $certs, segredo(cfg('cert_senha', ''), false))) throw new Exception('Não foi possível abrir o certificado A1. Envie o certificado de novo em Configurações.');
  $c = ['cert' => $certs['cert'], 'pkey' => $certs['pkey'], 'chain' => $certs['extracerts'] ?? [],
        'b64' => preg_replace('/-----[^-]+-----|\s/', '', $certs['cert'])];
  return $c;
}

// ---------- Assinatura XMLDSig enveloped (padrão do manual da NFS-e Nacional) ----------
function nfseAssinar(DOMDocument $doc, string $tag): string {
  $ds = 'http://www.w3.org/2000/09/xmldsig#'; $c14n = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
  $node = $doc->getElementsByTagName($tag)->item(0);
  $id = $node->getAttribute('Id'); $node->setIdAttribute('Id', true);
  $digest = base64_encode(sha1($node->C14N(true, false), true));
  $sig = $doc->createElementNS($ds, 'Signature'); $node->parentNode->appendChild($sig);
  $si = $doc->createElementNS($ds, 'SignedInfo'); $sig->appendChild($si);
  $e = $doc->createElementNS($ds, 'CanonicalizationMethod'); $e->setAttribute('Algorithm', $c14n); $si->appendChild($e);
  $e = $doc->createElementNS($ds, 'SignatureMethod'); $e->setAttribute('Algorithm', $ds . 'rsa-sha1'); $si->appendChild($e);
  $ref = $doc->createElementNS($ds, 'Reference'); $ref->setAttribute('URI', '#' . $id); $si->appendChild($ref);
  $tr = $doc->createElementNS($ds, 'Transforms'); $ref->appendChild($tr);
  $e = $doc->createElementNS($ds, 'Transform'); $e->setAttribute('Algorithm', $ds . 'enveloped-signature'); $tr->appendChild($e);
  $e = $doc->createElementNS($ds, 'Transform'); $e->setAttribute('Algorithm', $c14n); $tr->appendChild($e);
  $e = $doc->createElementNS($ds, 'DigestMethod'); $e->setAttribute('Algorithm', $ds . 'sha1'); $ref->appendChild($e);
  $ref->appendChild($doc->createElementNS($ds, 'DigestValue', $digest));
  $cert = nfseCertificado(); $valor = '';
  if (!openssl_sign($si->C14N(true, false), $valor, $cert['pkey'], OPENSSL_ALGO_SHA1)) throw new Exception('Falha ao assinar a nota com o certificado: ' . openssl_error_string());
  $sig->appendChild($doc->createElementNS($ds, 'SignatureValue', base64_encode($valor)));
  $ki = $doc->createElementNS($ds, 'KeyInfo'); $sig->appendChild($ki);
  $xd = $doc->createElementNS($ds, 'X509Data'); $ki->appendChild($xd);
  $xd->appendChild($doc->createElementNS($ds, 'X509Certificate', $cert['b64']));
  return $doc->saveXML();
}

function nfseTexto(string $t, int $max): string {
  $t = trim(preg_replace('/\s+/u', ' ', preg_replace('/[\x00-\x1F]/u', ' ', $t)));
  return mb_substr($t, 0, $max);
}

// ---------- Montagem da DPS ----------
// $s = ['numero','serie','ctribnac','descricao','valor','desconto','cpf','tomador','nbs']
function nfseMontarDps(array $s): DOMDocument {
  $cnpj = soDigitos(cfg('emp_cnpj')); $cmun = soDigitos(cfg('emp_cmun'));
  if (strlen($cnpj) !== 14) throw new Exception('CNPJ da empresa não configurado.');
  if (strlen($cmun) !== 7) throw new Exception('Código IBGE da cidade não configurado (Configurações > Empresa).');
  $ctrib = soDigitos($s['ctribnac'] ?? '');
  if (strlen($ctrib) !== 6) throw new Exception('Código de tributação nacional do serviço precisa ter 6 dígitos (cadastro do serviço).');
  $serie = (int)$s['serie']; $num = (int)$s['numero'];
  $id = 'DPS' . $cmun . '2' . $cnpj . str_pad((string)$serie, 5, '0', STR_PAD_LEFT) . str_pad((string)$num, 15, '0', STR_PAD_LEFT);
  $op = nfseOpSimpNac();

  $d = new DOMDocument('1.0', 'UTF-8'); $d->preserveWhiteSpace = false; $d->formatOutput = false;
  $raiz = $d->createElementNS(NFSE_NS, 'DPS'); $raiz->setAttribute('versao', NFSE_VERSAO); $d->appendChild($raiz);
  $el = function (DOMElement $pai, string $nome, ?string $valor = null) use ($d): DOMElement {
    $e = $d->createElementNS(NFSE_NS, $nome); if ($valor !== null) $e->appendChild($d->createTextNode($valor)); $pai->appendChild($e); return $e;
  };
  $inf = $el($raiz, 'infDPS'); $inf->setAttribute('Id', $id);
  $agora = new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo'));
  $el($inf, 'tpAmb', ambiente() === 'producao' ? '1' : '2');
  $el($inf, 'dhEmi', $agora->sub(new DateInterval('PT1M'))->format('Y-m-d\TH:i:sP')); // 1 min de folga para relógio do PC adiantado
  $el($inf, 'verAplic', NFSE_VER_APLIC);
  $el($inf, 'serie', (string)$serie);
  $el($inf, 'nDPS', (string)$num);
  $el($inf, 'dCompet', $agora->format('Y-m-d'));
  $el($inf, 'tpEmit', '1');
  $el($inf, 'cLocEmi', $cmun);
  $prest = $el($inf, 'prest'); $el($prest, 'CNPJ', $cnpj);
  if ($im = soDigitos(cfg('nfse_im', ''))) $el($prest, 'IM', $im);
  $rt = $el($prest, 'regTrib'); $el($rt, 'opSimpNac', (string)$op);
  if ($op === 3) $el($rt, 'regApTribSN', '1');
  $el($rt, 'regEspTrib', (string)(int)cfg('nfse_regesptrib', 0));
  $cpf = soDigitos($s['cpf'] ?? '');
  if (strlen($cpf) === 11 || strlen($cpf) === 14) {
    $toma = $el($inf, 'toma'); $el($toma, strlen($cpf) === 11 ? 'CPF' : 'CNPJ', $cpf);
    $el($toma, 'xNome', nfseTexto($s['tomador'] ?: 'Consumidor', 300));
  }
  $serv = $el($inf, 'serv');
  $loc = $el($serv, 'locPrest'); $el($loc, 'cLocPrestacao', $cmun);
  $cs = $el($serv, 'cServ'); $el($cs, 'cTribNac', $ctrib);
  $el($cs, 'xDescServ', nfseTexto($s['descricao'], 2000));
  if (strlen(soDigitos($s['nbs'] ?? '')) === 9) $el($cs, 'cNBS', soDigitos($s['nbs']));
  $val = $el($inf, 'valores');
  $vsp = $el($val, 'vServPrest'); $el($vsp, 'vServ', n2($s['valor']));
  if ((float)($s['desconto'] ?? 0) > 0) { $dc = $el($val, 'vDescCondIncond'); $el($dc, 'vDescIncond', n2($s['desconto'])); }
  $trib = $el($val, 'trib'); $tm = $el($trib, 'tribMun');
  $el($tm, 'tribISSQN', '1'); $el($tm, 'tpRetISSQN', '1');
  $tt = $el($trib, 'totTrib'); $el($tt, 'indTotTrib', '0');
  return $d;
}
function nfseOpSimpNac(): int { $crt = (string)cfg('emp_crt', '1'); return $crt === '4' ? 2 : ($crt === '1' ? 3 : 1); }

// ---------- Comunicação (mTLS com o certificado da empresa) ----------
function nfseHttp(string $metodo, string $url, ?array $corpo = null): array {
  $c = nfseCertificado();
  $tmp = DADOS . '/certificado/.tls-' . bin2hex(random_bytes(6));
  file_put_contents("$tmp.crt", $c['cert'] . "\n" . implode("\n", $c['chain'])); file_put_contents("$tmp.key", $c['pkey']);
  try {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $metodo, CURLOPT_TIMEOUT => 30, CURLOPT_CONNECTTIMEOUT => 10,
      CURLOPT_SSLCERT => "$tmp.crt", CURLOPT_SSLKEY => "$tmp.key", CURLOPT_SSLVERSION => CURL_SSLVERSION_TLSv1_2,
      CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json']]);
    if ($corpo !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($corpo));
    if (cfg('nfse_url_teste')) curl_setopt($ch, CURLOPT_NOPROXY, '*'); // simulador local (testes internos)
    $r = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch);
  } finally { @unlink("$tmp.crt"); @unlink("$tmp.key"); }
  if ($r === false) throw new Exception('sem_conexao: ' . $err);
  if ($code === 403 || $code === 496) throw new Exception('A Receita recusou o certificado (verifique se é o A1 da empresa e se está na validade).');
  return [$code, json_decode((string)$r, true) ?: [], (string)$r];
}
function nfseErros(array $d, string $bruto): string {
  $l = [];
  foreach (($d['erros'] ?? $d['Erros'] ?? []) as $e) $l[] = trim(($e['Codigo'] ?? $e['codigo'] ?? '') . ' - ' . ($e['Descricao'] ?? $e['descricao'] ?? '') . ' ' . ($e['Complemento'] ?? $e['complemento'] ?? ''));
  return $l ? implode(' | ', $l) : (mb_substr(strip_tags($bruto), 0, 300) ?: 'Erro desconhecido');
}
function gz64(string $xml): string { return base64_encode(gzencode($xml)); }
function ungz64(string $b): string { return (string)gzdecode(base64_decode($b)); }

// ---------- Emissão ----------
// Emite uma NFS-e (registro já criado na tabela nfse). Retorna o registro atualizado.
function nfseTransmitir(int $nid): array {
  $n = q1('SELECT * FROM nfse WHERE id=?', [$nid]);
  $u = nfseUrls();
  try {
    $doc = nfseMontarDps(['numero' => $n['numero'], 'serie' => $n['serie'], 'ctribnac' => $n['ctribnac'], 'nbs' => $n['nbs'], 'descricao' => $n['descricao'],
      'valor' => $n['valor'], 'desconto' => $n['desconto'], 'cpf' => $n['tomador_doc'], 'tomador' => $n['tomador_nome']]);
    $idDps = $doc->getElementsByTagName('infDPS')->item(0)->getAttribute('Id');
    $xml = nfseAssinar($doc, 'infDPS');
  } catch (Throwable $e) { ex("UPDATE nfse SET status='rejeitada', motivo=? WHERE id=?", [$e->getMessage(), $nid]); return q1('SELECT * FROM nfse WHERE id=?', [$nid]); }
  ex('UPDATE nfse SET id_dps=? WHERE id=?', [$idDps, $nid]);
  try {
    [$code, $d, $bruto] = nfseHttp('POST', $u['sefin'] . '/nfse', ['dpsXmlGZipB64' => gz64($xml)]);
    if ($code >= 500) { $rec = nfseRecuperar($idDps); if ($rec) return nfseAutorizada($nid, $rec[0], $rec[1]); }
    if ($code === 201 && !empty($d['chaveAcesso'])) return nfseAutorizada($nid, $d['chaveAcesso'], ungz64($d['nfseXmlGZipB64'] ?? ''));
    $motivo = nfseErros($d, $bruto);
    if (preg_match('/E0014|j[aá] existe|duplicid/i', $motivo) && ($rec = nfseRecuperar($idDps))) return nfseAutorizada($nid, $rec[0], $rec[1]);
    ex("UPDATE nfse SET status=?, motivo=? WHERE id=?", [$code >= 500 ? 'pendente' : 'rejeitada', "HTTP $code: $motivo", $nid]);
  } catch (Throwable $e) {
    $sem = str_starts_with($e->getMessage(), 'sem_conexao');
    if ($sem && ($rec = @nfseRecuperarSilencioso($idDps))) return nfseAutorizada($nid, $rec[0], $rec[1]);
    ex("UPDATE nfse SET status=?, motivo=? WHERE id=?", [$sem ? 'pendente' : 'rejeitada', $sem ? 'Sem internet: será enviada automaticamente quando a conexão voltar.' : $e->getMessage(), $nid]);
  }
  return q1('SELECT * FROM nfse WHERE id=?', [$nid]);
}
function nfseRecuperar(string $idDps): ?array {
  $u = nfseUrls();
  [$c, $d] = nfseHttp('GET', $u['sefin'] . '/dps/' . $idDps);
  if ($c !== 200 || empty($d['chaveAcesso'])) return null;
  [$c2, $d2] = nfseHttp('GET', $u['sefin'] . '/nfse/' . $d['chaveAcesso']);
  return [$d['chaveAcesso'], $c2 === 200 ? ungz64($d2['nfseXmlGZipB64'] ?? '') : ''];
}
function nfseRecuperarSilencioso(string $idDps): ?array { try { return nfseRecuperar($idDps); } catch (Throwable $e) { return null; } }
function nfseAutorizada(int $nid, string $chave, string $xml): array {
  $num = '';
  if ($xml !== '') { $dd = new DOMDocument(); if (@$dd->loadXML($xml) && ($e = $dd->getElementsByTagName('nNFSe')->item(0))) $num = trim($e->nodeValue); }
  $dir = 'xml/' . date('Y-m'); if (!is_dir(DADOS . "/$dir")) mkdir(DADOS . "/$dir", 0775, true);
  $path = "$dir/$chave-nfse.xml"; if ($xml !== '') file_put_contents(DADOS . '/' . $path, $xml);
  ex("UPDATE nfse SET status='autorizada', chave=?, nnfse=?, xml_path=?, motivo=? WHERE id=?", [$chave, $num, $path, 'Autorizada', $nid]);
  return q1('SELECT * FROM nfse WHERE id=?', [$nid]);
}

// Cria e envia as NFS-e de uma venda (uma por código de serviço, como exige o layout)
function emitirNFSeVenda(array $venda, array $itensServ, ?array $cliente): array {
  $grupos = [];
  foreach ($itensServ as $it) $grupos[$it['ctribnac'] ?: ''][] = $it;
  $res = [];
  foreach ($grupos as $ctrib => $its) {
    $valor = 0; $desc = 0; $partes = [];
    foreach ($its as $it) { $valor += $it['total']; $desc += $it['desconto']; $partes[] = ($it['qtd'] != 1 ? rtrim(rtrim(number_format($it['qtd'], 3, ',', ''), '0'), ',') . 'x ' : '') . $it['nome']; }
    $serie = (int)cfg('nfse_serie', 1); $num = (int)cfg('nfse_numero', 1);
    $nid = ex('INSERT INTO nfse (venda_id,data,serie,numero,ctribnac,nbs,descricao,valor,desconto,tomador_doc,tomador_nome,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [$venda['id'], agora(), $serie, $num, $ctrib, $its[0]['nbs'] ?? '', implode('; ', $partes), round($valor, 2), round($desc, 2), $venda['cpf'] ?? '', $cliente['nome'] ?? '', 'pendente']);
    $n = nfseTransmitir($nid);
    if (in_array($n['status'], ['autorizada', 'pendente'], true)) cfgSet(['nfse_numero' => $num + 1]); // número só é consumido se a DPS foi aceita ou está na fila
    $res[] = $n;
  }
  return $res;
}
function nfsePendentes(): array {
  $pend = q("SELECT n.id FROM nfse n JOIN vendas v ON v.id=n.venda_id WHERE n.status='pendente' AND v.status='ok'");
  $ok = 0;
  foreach ($pend as $p) { $r = nfseTransmitir((int)$p['id']); if ($r['status'] === 'autorizada') $ok++; elseif (str_contains((string)$r['motivo'], 'Sem internet')) break; }
  return ['enviadas' => $ok, 'pendentes' => count($pend) - $ok];
}
function nfseReemitir(int $nid): array {
  $n = q1('SELECT * FROM nfse WHERE id=?', [$nid]); if (!$n || $n['status'] === 'autorizada') throw new Exception('Esta NFS-e não precisa ser reemitida.');
  // usa o próximo número livre (a DPS rejeitada não gerou nota)
  $num = (int)cfg('nfse_numero', 1); ex('UPDATE nfse SET numero=?, serie=? WHERE id=?', [$num, (int)cfg('nfse_serie', 1), $nid]);
  $r = nfseTransmitir($nid);
  if (in_array($r['status'], ['autorizada', 'pendente'], true)) cfgSet(['nfse_numero' => $num + 1]);
  return $r;
}

// ---------- Cancelamento (evento e101101) ----------
function nfseMontarCancelamento(string $chave, string $just): DOMDocument {
  $d = new DOMDocument('1.0', 'UTF-8'); $d->preserveWhiteSpace = false;
  $raiz = $d->createElementNS(NFSE_NS, 'pedRegEvento'); $raiz->setAttribute('versao', NFSE_VERSAO); $d->appendChild($raiz);
  $inf = $d->createElementNS(NFSE_NS, 'infPedReg'); $inf->setAttribute('Id', 'PRE' . $chave . '101101'); $raiz->appendChild($inf);
  $add = function (DOMElement $pai, string $k, string $v) use ($d) { $e = $d->createElementNS(NFSE_NS, $k); $e->appendChild($d->createTextNode($v)); $pai->appendChild($e); return $e; };
  $add($inf, 'tpAmb', ambiente() === 'producao' ? '1' : '2'); $add($inf, 'verAplic', NFSE_VER_APLIC);
  $add($inf, 'dhEvento', (new DateTimeImmutable('-1 minute'))->format('Y-m-d\TH:i:sP'));
  $add($inf, 'CNPJAutor', soDigitos(cfg('emp_cnpj'))); $add($inf, 'chNFSe', $chave);
  $ev = $d->createElementNS(NFSE_NS, 'e101101'); $inf->appendChild($ev);
  $add($ev, 'xDesc', 'Cancelamento de NFS-e'); $add($ev, 'cMotivo', '2'); $add($ev, 'xMotivo', nfseTexto($just, 255));
  return $d;
}
function nfseCancelar(array $n, string $just): array {
  if ($n['status'] !== 'autorizada') { ex("UPDATE nfse SET status='cancelada' WHERE id=?", [$n['id']]); return ['ok' => true]; }
  $just = nfseTexto($just, 255); if (mb_strlen($just) < 15) return ['ok' => false, 'msg' => 'A justificativa precisa ter pelo menos 15 caracteres.'];
  $d = nfseMontarCancelamento($n['chave'], $just);
  $xml = nfseAssinar($d, 'infPedReg');
  [$code, $r, $bruto] = nfseHttp('POST', nfseUrls()['sefin'] . '/nfse/' . $n['chave'] . '/eventos', ['pedidoRegistroEventoXmlGZipB64' => gz64($xml)]);
  if ($code !== 201) return ['ok' => false, 'msg' => 'Receita recusou o cancelamento da NFS-e: ' . nfseErros($r, $bruto)];
  if (!empty($r['eventoXmlGZipB64'])) file_put_contents(DADOS . '/' . str_replace('-nfse.xml', '-nfse-cancelada.xml', $n['xml_path']), ungz64($r['eventoXmlGZipB64']));
  ex("UPDATE nfse SET status='cancelada', motivo=? WHERE id=?", ['Cancelada: ' . $just, $n['id']]);
  return ['ok' => true];
}

// ---------- Teste de conexão: o município aceita NFS-e nacional? ----------
function nfseTestar(): array {
  $cmun = soDigitos(cfg('emp_cmun'));
  if (strlen($cmun) !== 7) return ['ok' => false, 'msg' => 'Informe o código IBGE da cidade.'];
  [$c, $d, $bruto] = nfseHttp('GET', nfseUrls()['adn'] . '/parametrizacao/' . $cmun . '/convenio');
  if ($c !== 200) return ['ok' => false, 'msg' => "Não consegui consultar o município ($c): " . nfseErros($d, $bruto)];
  $ad = $d['parametrosConvenio']['aderenteAmbienteNacional'] ?? null;
  if ((string)$ad === '1') return ['ok' => true, 'msg' => 'Conectado. A prefeitura aceita a NFS-e nacional.'];
  return ['ok' => false, 'msg' => 'Conectado, mas a prefeitura ainda não aderiu ao emissor nacional. Confirme com a prefeitura como emitir a NFS-e.'];
}
