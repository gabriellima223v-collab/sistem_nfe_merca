<?php
// ============================================================
//  Módulo fiscal - NFC-e (modelo 65)
//  Modo "demo": simula a SEFAZ (para apresentar o sistema)
//  Modo "homologacao"/"producao": usa a biblioteca gratuita sped-nfe (NFePHP)
// ============================================================
use NFePHP\Common\Certificate;
use NFePHP\NFe\Tools;
use NFePHP\NFe\Make;
use NFePHP\NFe\Complements;
use NFePHP\NFe\Common\Standardize;

const CUF = ['RO'=>11,'AC'=>12,'AM'=>13,'RR'=>14,'PA'=>15,'AP'=>16,'TO'=>17,'MA'=>21,'PI'=>22,'CE'=>23,'RN'=>24,'PB'=>25,'PE'=>26,'AL'=>27,'SE'=>28,'BA'=>29,'MG'=>31,'ES'=>32,'RJ'=>33,'SP'=>35,'PR'=>41,'SC'=>42,'RS'=>43,'MS'=>50,'MT'=>51,'GO'=>52,'DF'=>53];
// Códigos de pagamento da NFC-e (tPag)
const TPAG = ['dinheiro'=>'01','credito'=>'03','debito'=>'04','fiado'=>'05','pix'=>'17','outros'=>'99'];

function ambiente(): string { return cfg('ambiente', 'demo'); } // demo | homologacao | producao
function soDigitos($s): string { return preg_replace('/\D/', '', (string)$s); }
function n2($v): string { return number_format((float)$v, 2, '.', ''); }
function n4($v): string { return number_format((float)$v, 4, '.', ''); }

function bibliotecaInstalada(): bool {
  $auto = dirname(__DIR__) . '/vendor/autoload.php';
  if (!file_exists($auto)) return false;
  require_once $auto;
  return class_exists(Make::class);
}

// ---------- Certificado ----------
function certificadoInfo(string $pfx, string $senha): array {
  if (!bibliotecaInstalada()) {
    // leitura direta com OpenSSL (funciona mesmo sem a biblioteca)
    $certs = [];
    if (!openssl_pkcs12_read($pfx, $certs, $senha)) {
      $erro = openssl_error_string() ?: '';
      if (stripos($erro, 'unsupported') !== false) throw new Exception('Certificado em formato antigo. Veja no LEIA-ME a seção "Certificado não abre".');
      throw new Exception('Senha do certificado incorreta ou arquivo inválido.');
    }
    $x = openssl_x509_parse($certs['cert']);
    $cn = $x['subject']['CN'] ?? '';
    preg_match('/(\d{14})/', $cn, $m);
    return ['nome' => $cn, 'cnpj' => $m[1] ?? '', 'validade' => date('Y-m-d', $x['validTo_time_t'])];
  }
  $c = Certificate::readPfx($pfx, $senha);
  return ['nome' => $c->getCompanyName(), 'cnpj' => $c->getCnpj(), 'validade' => $c->getValidTo()->format('Y-m-d')];
}

function tools(): Tools {
  if (!bibliotecaInstalada()) throw new Exception('Biblioteca fiscal não instalada. Gere o instalador de novo com o gerar-instalador.bat (veja o LEIA-ME).');
  $pfxPath = DADOS . '/certificado/certificado.pfx';
  if (!file_exists($pfxPath)) throw new Exception('Certificado A1 não configurado.');
  $conf = [
    'atualizacao' => date('Y-m-d H:i:s'),
    'tpAmb' => ambiente() === 'producao' ? 1 : 2,
    'razaosocial' => cfg('emp_razao'),
    'cnpj' => soDigitos(cfg('emp_cnpj')),
    'siglaUF' => cfg('emp_uf'),
    'schemes' => pacoteSchemas(),
    'versao' => '4.00',
    'tokenIBPT' => '',
    'CSC' => cfg('csc'),
    'CSCid' => cfg('csc_id'),
  ];
  $t = new Tools(json_encode($conf), Certificate::readPfx(file_get_contents($pfxPath), segredo(cfg('cert_senha', ''), false)));
  $t->model('65');
  return $t;
}

// Usa o pacote de schemas mais novo que veio com a biblioteca (acompanha as Notas Técnicas)
function pacoteSchemas(): string {
  if (cfg('schemes')) return cfg('schemes');
  $dirs = glob(dirname(__DIR__) . '/vendor/nfephp-org/sped-nfe/schemes/PL_*', GLOB_ONLYDIR) ?: [];
  $nomes = array_map('basename', $dirs); natsort($nomes);
  return $nomes ? end($nomes) : 'PL_009_V4';
}

// Guarda a senha do certificado embaralhada com uma chave local (não fica em texto puro no banco)
function chaveLocal(): string {
  $f = DADOS . '/.chave';
  if (!file_exists($f)) file_put_contents($f, bin2hex(random_bytes(32)));
  return hex2bin(trim(file_get_contents($f)));
}
function segredo(string $v, bool $cifrar): string {
  if ($v === '') return '';
  if ($cifrar) { $iv = random_bytes(16); return base64_encode($iv . openssl_encrypt($v, 'aes-256-cbc', chaveLocal(), OPENSSL_RAW_DATA, $iv)); }
  $b = base64_decode($v); return (string)openssl_decrypt(substr($b, 16), 'aes-256-cbc', chaveLocal(), OPENSSL_RAW_DATA, substr($b, 0, 16));
}

function sefazStatus(): array {
  if (ambiente() === 'demo') return ['ok' => true, 'msg' => 'Modo demonstração: SEFAZ simulada respondendo normalmente.'];
  $std = (new Standardize(tools()->sefazStatus()))->toStd();
  return ['ok' => (int)$std->cStat === 107, 'msg' => "{$std->cStat} - {$std->xMotivo}"];
}

// ---------- Chave de acesso ----------
function digitoChave(string $c43): int {
  $peso = 2; $soma = 0;
  for ($i = strlen($c43) - 1; $i >= 0; $i--) { $soma += (int)$c43[$i] * $peso; $peso = $peso === 9 ? 2 : $peso + 1; }
  $r = $soma % 11; return $r < 2 ? 0 : 11 - $r;
}

function proximoNumero(): int { return (int)cfg('nfce_numero', 1); }
function consumirNumero(int $n): void { cfgSet(['nfce_numero' => $n + 1]); }

// ---------- Emissão ----------
// $v = venda (array), $itens, $pags. Retorna campos para atualizar a venda.
function emitirNFCe(array $v, array $itens, array $pags, bool $forcarContingencia = false): array {
  $numero = proximoNumero();
  $serie = (int)cfg('nfce_serie', 1);
  if (ambiente() === 'demo') return emitirDemo($v, $itens, $pags, $numero, $serie);

  $tpEmis = $forcarContingencia ? 9 : 1;
  try {
    $xml = montarXML($v, $itens, $pags, $numero, $serie, $tpEmis);
    $t = tools();
    $assinado = $t->signNFe($xml);
    if ($tpEmis === 9) return salvarContingencia($assinado, $numero, $serie);
    $resp = $t->sefazEnviaLote([$assinado], str_pad((string)mt_rand(1, 999999999), 15, '0', STR_PAD_LEFT), 1);
  } catch (\Throwable $e) {
    // Sem internet / SEFAZ fora do ar -> contingência offline (permitida para NFC-e)
    if ($tpEmis === 1 && erroDeConexao($e->getMessage())) return emitirNFCe($v, $itens, $pags, true);
    return ['nfce_status' => 'rejeitada', 'motivo' => traduzErro($e->getMessage())];
  }
  $std = (new Standardize($resp))->toStd();
  $prot = $std->protNFe->infProt ?? null;
  if ((int)$std->cStat === 104 && $prot && in_array((int)$prot->cStat, [100, 150])) {
    $aut = Complements::toAuthorize($assinado, $resp);
    $chave = $prot->chNFe;
    $path = salvarXML($aut, $chave);
    consumirNumero($numero);
    [$qr, $url] = lerQR($aut);
    return ['nfce_status' => 'autorizada', 'chave' => $chave, 'numero' => $numero, 'serie' => $serie, 'protocolo' => $prot->nProt,
            'qrcode' => $qr, 'url_chave' => $url, 'xml_path' => $path, 'tpemis' => 1, 'motivo' => $prot->xMotivo];
  }
  $cStat = $prot->cStat ?? $std->cStat; $mot = $prot->xMotivo ?? $std->xMotivo;
  if (in_array((int)$cStat, [108, 109])) return emitirNFCe($v, $itens, $pags, true); // serviço paralisado
  return ['nfce_status' => 'rejeitada', 'motivo' => "Rejeição $cStat: $mot"];
}

function erroDeConexao(string $m): bool {
  return (bool)preg_match('/curl|timed? ?out|could not resolve|connection|conex|resolve host|SSL connect|falha na comunica/i', $m);
}
function traduzErro(string $m): string {
  if (stripos($m, 'certificado') !== false && stripos($m, 'venc') !== false) return 'Certificado digital vencido. Renove o A1 com a certificadora.';
  if (stripos($m, 'CSC') !== false) return 'CSC inválido. Confira o CSC e o ID do CSC em Configurações.';
  return $m;
}

function salvarContingencia(string $assinado, int $numero, int $serie): array {
  $dom = new DOMDocument(); $dom->loadXML($assinado);
  $chave = substr($dom->getElementsByTagName('infNFe')->item(0)->getAttribute('Id'), 3);
  file_put_contents(DADOS . "/xml/contingencia/$chave.xml", $assinado);
  consumirNumero($numero);
  [$qr, $url] = lerQR($assinado);
  return ['nfce_status' => 'contingencia', 'chave' => $chave, 'numero' => $numero, 'serie' => $serie, 'qrcode' => $qr, 'url_chave' => $url,
          'tpemis' => 9, 'xml_path' => "xml/contingencia/$chave.xml", 'motivo' => 'Emitida em contingência offline. Será transmitida automaticamente quando a internet voltar.'];
}

// Transmite notas emitidas em contingência (chamado automaticamente pelo PDV a cada minuto)
function transmitirContingencias(): array {
  if (ambiente() === 'demo') return ['enviadas' => 0, 'pendentes' => 0];
  $pend = q("SELECT * FROM vendas WHERE nfce_status='contingencia' AND status='ok'");
  if (!$pend) return ['enviadas' => 0, 'pendentes' => 0];
  $t = tools(); $ok = 0;
  foreach ($pend as $v) {
    try {
      $xml = file_get_contents(DADOS . '/' . $v['xml_path']);
      $resp = $t->sefazEnviaLote([$xml], str_pad((string)mt_rand(1, 999999999), 15, '0', STR_PAD_LEFT), 1);
      $std = (new Standardize($resp))->toStd(); $prot = $std->protNFe->infProt ?? null;
      if ($prot && in_array((int)$prot->cStat, [100, 150])) {
        $aut = Complements::toAuthorize($xml, $resp); $path = salvarXML($aut, $v['chave']);
        @unlink(DADOS . '/' . $v['xml_path']);
        ex("UPDATE vendas SET nfce_status='autorizada', protocolo=?, xml_path=?, motivo=? WHERE id=?", [$prot->nProt, $path, 'Autorizada (transmitida após contingência)', $v['id']]);
        $ok++;
      } elseif ($prot) {
        ex('UPDATE vendas SET motivo=? WHERE id=?', ["Contingência rejeitada {$prot->cStat}: {$prot->xMotivo}", $v['id']]);
      }
    } catch (\Throwable $e) { if (erroDeConexao($e->getMessage())) break; }
  }
  return ['enviadas' => $ok, 'pendentes' => count($pend) - $ok];
}

function salvarXML(string $xml, string $chave): string {
  $dir = 'xml/' . date('Y-m'); if (!is_dir(DADOS . "/$dir")) mkdir(DADOS . "/$dir", 0775, true);
  file_put_contents(DADOS . "/$dir/$chave-nfce.xml", $xml);
  return "$dir/$chave-nfce.xml";
}
function lerQR(string $xml): array {
  $d = new DOMDocument(); $d->loadXML($xml);
  $q = $d->getElementsByTagName('qrCode')->item(0); $u = $d->getElementsByTagName('urlChave')->item(0);
  return [$q ? trim($q->nodeValue) : '', $u ? trim($u->nodeValue) : ''];
}

function montarXML(array $v, array $itens, array $pags, int $numero, int $serie, int $tpEmis): string {
  $homolog = ambiente() !== 'producao';
  $uf = cfg('emp_uf');
  $nfe = new Make();
  $nfe->taginfNFe((object)['versao' => '4.00', 'Id' => null, 'pk_nItem' => null]);
  $cNF = str_pad((string)mt_rand(1, 99999999), 8, '0', STR_PAD_LEFT);
  if ($cNF === str_pad((string)$numero, 8, '0', STR_PAD_LEFT)) $cNF = str_pad((string)(((int)$cNF + 7) % 99999999), 8, '0', STR_PAD_LEFT);
  $ide = (object)[
    'cUF' => CUF[$uf], 'cNF' => $cNF, 'natOp' => 'VENDA', 'mod' => 65, 'serie' => $serie, 'nNF' => $numero,
    'dhEmi' => date('Y-m-d\TH:i:sP'), 'dhSaiEnt' => null, 'tpNF' => 1, 'idDest' => 1, 'cMunFG' => cfg('emp_cmun'), 'tpImp' => 4,
    'tpEmis' => $tpEmis, 'cDV' => 0, 'tpAmb' => $homolog ? 2 : 1, 'finNFe' => 1, 'indFinal' => 1, 'indPres' => 1, 'indIntermed' => 0,
    'procEmi' => 0, 'verProc' => 'PDV 1.0',
  ];
  if ($tpEmis === 9) { $ide->dhCont = date('Y-m-d\TH:i:sP'); $ide->xJust = 'Sem comunicacao com a SEFAZ no momento da venda'; }
  $nfe->tagide($ide);
  $nfe->tagemit((object)['xNome' => cfg('emp_razao'), 'xFant' => cfg('emp_fantasia'), 'IE' => soDigitos(cfg('emp_ie')), 'CRT' => (int)cfg('emp_crt', 1), 'CNPJ' => soDigitos(cfg('emp_cnpj'))]);
  $nfe->tagenderEmit((object)['xLgr' => cfg('emp_logradouro'), 'nro' => cfg('emp_numero', 'SN'), 'xCpl' => cfg('emp_complemento'), 'xBairro' => cfg('emp_bairro'),
    'cMun' => cfg('emp_cmun'), 'xMun' => cfg('emp_municipio'), 'UF' => $uf, 'CEP' => soDigitos(cfg('emp_cep')), 'cPais' => '1058', 'xPais' => 'Brasil', 'fone' => soDigitos(cfg('emp_fone'))]);
  if (!empty($v['cpf'])) $nfe->tagdest((object)['CPF' => soDigitos($v['cpf']), 'indIEDest' => 9]);

  $vProd = 0; $vDesc = 0; $vTrib = 0; $i = 0;
  foreach ($itens as $it) {
    $i++;
    $total = round($it['qtd'] * $it['preco'], 2);
    $desc = round((float)$it['desconto'], 2);
    $ean = preg_match('/^\d{8}$|^\d{12,14}$/', (string)$it['codigo']) && $it['codigo'][0] !== '2' ? $it['codigo'] : 'SEM GTIN';
    $nome = ($homolog && $i === 1) ? 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : mb_substr($it['nome'], 0, 120);
    $p = (object)['item' => $i, 'cProd' => $it['produto_id'] ?: $it['codigo'], 'cEAN' => $ean, 'xProd' => $nome, 'NCM' => $it['ncm'] ?: '00000000',
      'CFOP' => $it['cfop'] ?: '5102', 'uCom' => $it['unidade'] ?: 'UN', 'qCom' => n4($it['qtd']), 'vUnCom' => number_format($it['preco'], 4, '.', ''),
      'vProd' => n2($total), 'cEANTrib' => $ean, 'uTrib' => $it['unidade'] ?: 'UN', 'qTrib' => n4($it['qtd']), 'vUnTrib' => number_format($it['preco'], 4, '.', ''),
      'indTot' => 1];
    if ($desc > 0) $p->vDesc = n2($desc);
    $nfe->tagprod($p);
    if (!empty($it['cest'])) $nfe->tagCEST((object)['item' => $i, 'CEST' => $it['cest']]);
    $trib = round(($total - $desc) * (float)$it['trib_aprox'] / 100, 2);
    $nfe->tagimposto((object)['item' => $i, 'vTotTrib' => n2($trib)]);
    $nfe->tagICMSSN((object)['item' => $i, 'orig' => $it['origem'] ?? '0', 'CSOSN' => $it['csosn'] ?: '102']);
    $nfe->tagPIS((object)['item' => $i, 'CST' => '49', 'vBC' => '0.00', 'pPIS' => '0.0000', 'vPIS' => '0.00']);
    $nfe->tagCOFINS((object)['item' => $i, 'CST' => '49', 'vBC' => '0.00', 'pCOFINS' => '0.0000', 'vCOFINS' => '0.00']);
    $vProd += $total; $vDesc += $desc; $vTrib += $trib;
  }
  $vNF = round($vProd - $vDesc, 2);
  $nfe->tagICMSTot((object)['vBC' => '0.00', 'vICMS' => '0.00', 'vICMSDeson' => '0.00', 'vFCP' => '0.00', 'vBCST' => '0.00', 'vST' => '0.00', 'vFCPST' => '0.00',
    'vFCPSTRet' => '0.00', 'vProd' => n2($vProd), 'vFrete' => '0.00', 'vSeg' => '0.00', 'vDesc' => n2($vDesc), 'vII' => '0.00', 'vIPI' => '0.00', 'vIPIDevol' => '0.00',
    'vPIS' => '0.00', 'vCOFINS' => '0.00', 'vOutro' => '0.00', 'vNF' => n2($vNF), 'vTotTrib' => n2($vTrib)]);
  $nfe->tagtransp((object)['modFrete' => 9]);
  $nfe->tagpag((object)['vTroco' => n2($v['troco'] ?? 0)]);
  foreach ($pags as $pg) {
    $d = (object)['indPag' => 0, 'tPag' => TPAG[$pg['forma']] ?? '99', 'vPag' => n2($pg['valor'] + ($pg['forma'] === 'dinheiro' ? ($v['troco'] ?? 0) : 0))];
    if ($pg['forma'] === 'fiado') $d->xPag = 'Fiado / crediario';
    if (in_array($pg['forma'], ['credito', 'debito', 'pix'])) {
      $d->tpIntegra = $pg['integrado'] ? 1 : 2;
      if (!empty($pg['cnpj_cred'])) $d->CNPJ = soDigitos($pg['cnpj_cred']);
      if (!empty($pg['bandeira'])) $d->tBand = codBandeira($pg['bandeira']);
      if (!empty($pg['autorizacao'])) $d->cAut = $pg['autorizacao'];
    }
    $nfe->tagdetPag($d);
  }
  $nfe->taginfAdic((object)['infCpl' => 'Val Aprox Tributos R$ ' . number_format($vTrib, 2, ',', '.') . ' Fonte: IBPT']);
  if (cfg('resp_cnpj')) $nfe->taginfRespTec((object)['CNPJ' => soDigitos(cfg('resp_cnpj')), 'xContato' => cfg('resp_nome'), 'email' => cfg('resp_email'), 'fone' => soDigitos(cfg('resp_fone'))]);
  try { return $nfe->getXML(); }
  catch (\Throwable $e) { throw new Exception('Erro ao montar a nota: ' . implode('; ', $nfe->getErrors() ?: [$e->getMessage()])); }
}

function codBandeira(string $b): string {
  $m = ['visa' => '01', 'master' => '02', 'mastercard' => '02', 'amex' => '03', 'sorocred' => '04', 'diners' => '05', 'elo' => '06', 'hipercard' => '07', 'aura' => '08', 'cabal' => '09'];
  return $m[strtolower($b)] ?? '99';
}

function emitirDemo(array $v, array $itens, array $pags, int $numero, int $serie): array {
  $uf = cfg('emp_uf', 'SP');
  $c43 = CUF[$uf] . date('ym') . str_pad(soDigitos(cfg('emp_cnpj', '00000000000000')), 14, '0', STR_PAD_LEFT) . '65' .
         str_pad((string)$serie, 3, '0', STR_PAD_LEFT) . str_pad((string)$numero, 9, '0', STR_PAD_LEFT) . '1' . str_pad((string)mt_rand(1, 99999999), 8, '0', STR_PAD_LEFT);
  $chave = $c43 . digitoChave($c43);
  $prot = '1' . CUF[$uf] . date('y') . str_pad((string)mt_rand(0, 9999999999), 10, '0', STR_PAD_LEFT);
  $url = 'https://www.sefaz.' . strtolower($uf) . '.gov.br/nfce/consulta';
  $qr = $url . '?p=' . $chave . '|3|2';
  $xml = '<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00"><!-- SIMULACAO - SEM VALOR FISCAL --><NFe><infNFe Id="NFe' . $chave . '"><ide><mod>65</mod><serie>' . $serie . '</serie><nNF>' . $numero . '</nNF><dhEmi>' . date('c') . '</dhEmi></ide><total><vNF>' . n2($v['total']) . '</vNF></total></infNFe></NFe><protNFe><infProt><chNFe>' . $chave . '</chNFe><nProt>' . $prot . '</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>';
  $path = salvarXML($xml, $chave);
  consumirNumero($numero);
  return ['nfce_status' => 'demo', 'chave' => $chave, 'numero' => $numero, 'serie' => $serie, 'protocolo' => $prot, 'qrcode' => $qr, 'url_chave' => $url,
          'xml_path' => $path, 'tpemis' => 1, 'motivo' => 'Simulação (modo demonstração) - sem valor fiscal'];
}

function cancelarNFCe(array $v, string $just): array {
  if (in_array($v['nfce_status'], ['demo', 'rejeitada', 'sem_nota', null, ''], true)) return ['ok' => true, 'msg' => 'Cancelada.'];
  if ($v['nfce_status'] === 'contingencia') return ['ok' => false, 'msg' => 'Aguarde a nota em contingência ser transmitida para cancelar.'];
  if (mb_strlen($just) < 15) return ['ok' => false, 'msg' => 'A justificativa precisa ter pelo menos 15 caracteres.'];
  $resp = tools()->sefazCancela($v['chave'], $just, $v['protocolo']);
  $std = (new Standardize($resp))->toStd();
  $inf = $std->retEvento->infEvento ?? null;
  if ($inf && in_array((int)$inf->cStat, [135, 155])) {
    $xml = Complements::toAuthorize(file_get_contents(DADOS . '/' . $v['xml_path']), $resp);
    file_put_contents(DADOS . '/' . str_replace('-nfce.xml', '-cancelada.xml', $v['xml_path']), $xml);
    return ['ok' => true, 'msg' => 'NFC-e cancelada na SEFAZ.'];
  }
  return ['ok' => false, 'msg' => 'SEFAZ recusou o cancelamento: ' . ($inf->xMotivo ?? $std->xMotivo ?? 'erro')];
}
