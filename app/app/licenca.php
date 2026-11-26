<?php
// ============================================================
//  Acesso do app: o cliente faz o cadastro da empresa, o app manda
//  o pedido para o servidor (Apps Script) e espera você autorizar na
//  área restrita. Depois confere a cada 10 minutos e trava se você
//  bloquear ou se a vigência acabar.
// ============================================================
const LIC_INTERVALO = 600;          // confere a cada 10 minutos
const LIC_TOLERANCIA_OFFLINE = 30;  // dias que funciona sem conseguir falar com o servidor
const APP_VERSAO = '1.0';

function licUrl(): string {
  $f = dirname(__DIR__) . '/app/licenca_url.txt';
  return file_exists($f) ? trim((string)file_get_contents($f)) : '';
}
function licArquivo(): string { return DADOS . '/licenca.json'; }
function licLer(): array { $f = licArquivo(); return file_exists($f) ? (json_decode((string)file_get_contents($f), true) ?: []) : []; }
function licGravar(array $l): void { file_put_contents(licArquivo(), json_encode($l, JSON_UNESCAPED_UNICODE)); }

// Identificação do computador (nome do PC + código gerado na instalação)
function maquinaId(): string {
  $f = DADOS . '/.maquina';
  if (!file_exists($f)) file_put_contents($f, bin2hex(random_bytes(16)));
  return strtoupper(substr(hash('sha256', strtolower((string)gethostname()) . '|' . trim((string)file_get_contents($f))), 0, 24));
}

function licChamar(string $acao, string $chave): array {
  $url = licUrl();
  $ch = curl_init($url);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ['Content-Type: text/plain'],
    CURLOPT_POSTFIELDS => json_encode(['acao' => $acao, 'chave' => $chave, 'maquina' => maquinaId(), 'nome_pc' => gethostname(), 'versao' => APP_VERSAO])]);
  $r = curl_exec($ch); curl_close($ch);
  if ($r === false) throw new Exception('sem_conexao');
  $j = json_decode((string)$r, true);
  if (!is_array($j)) throw new Exception('sem_conexao');
  return $j;
}

// Estado atual: ativa | sem_licenca | pendente | bloqueada | vencida | invalida | offline_demais
function licEstado(bool $forcar = false): array {
  if (licUrl() === '') return ['status' => 'ativa', 'livre' => true]; // sem servidor configurado = sem trava (uso interno/testes)
  $l = licLer();
  if (empty($l['chave'])) return ['status' => 'sem_licenca', 'msg' => $l['msg'] ?? ''];
  $agora = time();
  $intervalo = ($l['status'] ?? '') === 'pendente' ? 15 : LIC_INTERVALO; // esperando liberação: confere mais vezes
  if ($forcar || $agora - ($l['conferido'] ?? 0) >= $intervalo) {
    $l['conferido'] = $agora;
    try { $l = licAplicar($l, licChamar('verificar', $l['chave'])); } catch (Throwable $e) { /* sem internet: continua com o último estado conhecido */ }
    licGravar($l);
  }
  $st = $l['status'] ?? 'ativa';
  if ($st === 'ativa' && !empty($l['vence']) && date('Y-m-d') > $l['vence']) $st = 'vencida'; // vale mesmo sem internet
  if ($st === 'ativa' && $agora - ($l['ultimo_ok'] ?? $agora) > LIC_TOLERANCIA_OFFLINE * 86400) $st = 'offline_demais';
  $msg = $l['msg'] ?? '';
  if ($st === 'vencida' && !$msg) $msg = 'O acesso venceu em ' . date('d/m/Y', strtotime($l['vence'])) . '. Entre em contato para renovar.';
  return ['status' => $st, 'cliente' => $l['cliente'] ?? '', 'msg' => $msg, 'contato' => $l['contato'] ?? '', 'vence' => $l['vence'] ?? '',
    'empresa' => cfg('emp_fantasia') ?: cfg('emp_razao'), 'cnpj' => cfg('emp_cnpj')];
}
// Aplica a resposta do servidor ao estado salvo no computador
function licAplicar(array $l, array $r): array {
  $st = $r['status'] ?? '';
  if (in_array($st, ['ativa', 'pendente', 'bloqueada', 'vencida'], true)) {
    $l['status'] = $st; $l['msg'] = $r['msg'] ?? '';
    if ($st === 'ativa') { $l['ultimo_ok'] = time(); }
    if (array_key_exists('vence', $r)) $l['vence'] = (string)$r['vence'];
  } elseif (in_array($st, ['outra_maquina', 'invalida'], true)) {
    // o pedido foi recusado/excluído: esquece a chave para poder pedir de novo
    return ['msg' => $st === 'invalida' ? 'O pedido de acesso não foi encontrado (pode ter sido recusado). Envie de novo.' : ($r['erro'] ?? ''), 'contato' => $r['contato'] ?? ($l['contato'] ?? '')];
  }
  if (!empty($r['cliente'])) $l['cliente'] = $r['cliente'];
  $l['contato'] = $r['contato'] ?? ($l['contato'] ?? '');
  return $l;
}
// Manda o pedido de acesso com os dados do cadastro da empresa
function licSolicitar(): array {
  if (licUrl() === '') return licEstado();
  if (cfg('configurado') !== '1') throw new Exception('Termine o cadastro da empresa primeiro.');
  $dados = ['cnpj' => cfg('emp_cnpj'), 'razao' => cfg('emp_razao'), 'fantasia' => cfg('emp_fantasia'), 'fone' => cfg('emp_fone'),
    'municipio' => cfg('emp_municipio'), 'uf' => cfg('emp_uf'), 'emissao' => cfg('emissao', 'nfce')];
  $url = licUrl();
  $ch = curl_init($url);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ['Content-Type: text/plain'],
    CURLOPT_POSTFIELDS => json_encode(['acao' => 'solicitar', 'maquina' => maquinaId(), 'nome_pc' => gethostname(), 'versao' => APP_VERSAO, 'dados' => $dados])]);
  $r = json_decode((string)curl_exec($ch), true); curl_close($ch);
  if (!is_array($r)) throw new Exception('Sem internet. Conecte o computador para enviar o pedido de acesso.');
  if (empty($r['chave'])) throw new Exception($r['erro'] ?? 'Não foi possível enviar o pedido.');
  $l = licAplicar(['chave' => $r['chave'], 'conferido' => time()], $r);
  $l['chave'] = $r['chave'];
  licGravar($l);
  return licEstado();
}
function mascarar(string $c): string { return substr($c, 0, 4) . '-••••-••••-' . substr($c, -4); }

function licAtivar(string $chave): array {
  $chave = strtoupper(trim($chave));
  if (!preg_match('/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/', $chave)) throw new Exception('A chave tem o formato XXXX-XXXX-XXXX-XXXX.');
  try { $r = licChamar('ativar', $chave); }
  catch (Throwable $e) { throw new Exception('Sem internet. Para ativar a primeira vez o computador precisa estar conectado.'); }
  if (($r['status'] ?? '') === 'bloqueada') throw new Exception('Esta chave está bloqueada. ' . ($r['contato'] ? 'Contato: ' . $r['contato'] : ''));
  if (empty($r['ok']) || ($r['status'] ?? '') !== 'ativa') throw new Exception($r['erro'] ?? 'Não foi possível ativar.');
  licGravar(['chave' => $chave, 'status' => 'ativa', 'ultimo_ok' => time(), 'conferido' => time(), 'cliente' => $r['cliente'] ?? '', 'contato' => $r['contato'] ?? '', 'vence' => (string)($r['vence'] ?? '')]);
  return licEstado();
}

// Avisa o servidor de licenças sobre uma entrada (login, abertura de caixa...). Nunca trava o app.
function licEvento(string $evento, string $usuario = ''): void {
  if (licUrl() === '') return;
  $l = licLer(); if (empty($l['chave'])) return;
  $ch = curl_init(licUrl());
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 4, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ['Content-Type: text/plain'],
    CURLOPT_POSTFIELDS => json_encode(['acao' => 'evento', 'chave' => $l['chave'], 'maquina' => maquinaId(), 'nome_pc' => gethostname(), 'evento' => $evento, 'usuario' => $usuario])]);
  $r = json_decode((string)curl_exec($ch), true); curl_close($ch);
  if (is_array($r) && in_array($r['status'] ?? '', ['bloqueada', 'vencida'], true)) { $l = licAplicar($l, $r); $l['conferido'] = time(); licGravar($l); }
}
