<?php
// ============================================================
//  Licença do app: pede a chave só na primeira vez, confere a cada
//  10 minutos no servidor de licenças (Apps Script) e trava só se
//  o desenvolvedor bloquear.
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

// Estado atual da licença: ativa | sem_licenca | bloqueada | offline_demais
function licEstado(bool $forcar = false): array {
  if (licUrl() === '') return ['status' => 'ativa', 'livre' => true]; // sem servidor configurado = sem trava (uso interno/testes)
  $l = licLer();
  if (empty($l['chave'])) return ['status' => 'sem_licenca'];
  $agora = time();
  if ($forcar || $agora - ($l['conferido'] ?? 0) >= LIC_INTERVALO) {
    $l['conferido'] = $agora;
    try {
      $r = licChamar('verificar', $l['chave']);
      if (($r['status'] ?? '') === 'ativa') { $l['status'] = 'ativa'; $l['ultimo_ok'] = $agora; $l['cliente'] = $r['cliente'] ?? ''; }
      elseif (in_array($r['status'] ?? '', ['bloqueada', 'outra_maquina', 'invalida'], true)) { $l['status'] = $r['status'] === 'bloqueada' ? 'bloqueada' : 'invalida'; $l['msg'] = $r['msg'] ?? ($r['erro'] ?? ''); }
      $l['contato'] = $r['contato'] ?? ($l['contato'] ?? '');
    } catch (Throwable $e) { /* sem internet: continua com o último estado conhecido */ }
    licGravar($l);
  }
  $st = $l['status'] ?? 'ativa';
  if ($st === 'ativa' && $agora - ($l['ultimo_ok'] ?? $agora) > LIC_TOLERANCIA_OFFLINE * 86400) $st = 'offline_demais';
  return ['status' => $st, 'cliente' => $l['cliente'] ?? '', 'msg' => $l['msg'] ?? '', 'contato' => $l['contato'] ?? '', 'chave' => mascarar($l['chave'])];
}
function mascarar(string $c): string { return substr($c, 0, 4) . '-••••-••••-' . substr($c, -4); }

function licAtivar(string $chave): array {
  $chave = strtoupper(trim($chave));
  if (!preg_match('/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/', $chave)) throw new Exception('A chave tem o formato XXXX-XXXX-XXXX-XXXX.');
  try { $r = licChamar('ativar', $chave); }
  catch (Throwable $e) { throw new Exception('Sem internet. Para ativar a primeira vez o computador precisa estar conectado.'); }
  if (($r['status'] ?? '') === 'bloqueada') throw new Exception('Esta chave está bloqueada. ' . ($r['contato'] ? 'Contato: ' . $r['contato'] : ''));
  if (empty($r['ok']) || ($r['status'] ?? '') !== 'ativa') throw new Exception($r['erro'] ?? 'Não foi possível ativar.');
  licGravar(['chave' => $chave, 'status' => 'ativa', 'ultimo_ok' => time(), 'conferido' => time(), 'cliente' => $r['cliente'] ?? '', 'contato' => $r['contato'] ?? '']);
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
  if (is_array($r) && ($r['status'] ?? '') === 'bloqueada') { $l['status'] = 'bloqueada'; $l['conferido'] = time(); licGravar($l); }
}
