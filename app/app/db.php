<?php
// ============================================================
//  Banco de dados local (SQLite) - fica em /dados/pdv.sqlite
// ============================================================
define('DADOS', dirname(__DIR__) . '/dados');
if (!is_dir(DADOS)) mkdir(DADOS, 0775, true);
foreach (['xml', 'xml/contingencia', 'certificado', 'backup'] as $d) if (!is_dir(DADOS . "/$d")) mkdir(DADOS . "/$d", 0775, true);

function db(): PDO {
  static $pdo = null;
  if ($pdo) return $pdo;
  $pdo = new PDO('sqlite:' . DADOS . '/pdv.sqlite');
  $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
  $pdo->exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  criarTabelas($pdo);
  return $pdo;
}

function criarTabelas(PDO $pdo): void {
  $pdo->exec("
  CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY, nome TEXT, pin TEXT, perfil TEXT DEFAULT 'operador', ativo INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS produtos (
    id INTEGER PRIMARY KEY, codigo TEXT, cod_balanca TEXT, nome TEXT, unidade TEXT DEFAULT 'UN', preco REAL DEFAULT 0, custo REAL DEFAULT 0,
    estoque REAL DEFAULT 0, minimo REAL DEFAULT 0, validade TEXT, ncm TEXT DEFAULT '00000000', cfop TEXT DEFAULT '5102', csosn TEXT DEFAULT '102',
    cest TEXT, origem TEXT DEFAULT '0', trib_aprox REAL DEFAULT 0, categoria TEXT, promo_qtd REAL, promo_preco REAL, ativo INTEGER DEFAULT 1, atualizado TEXT);
  CREATE INDEX IF NOT EXISTS ix_prod_cod ON produtos(codigo);
  CREATE TABLE IF NOT EXISTS clientes (id INTEGER PRIMARY KEY, nome TEXT, telefone TEXT, cpf TEXT, limite REAL DEFAULT 0, saldo REAL DEFAULT 0, criado TEXT);
  CREATE TABLE IF NOT EXISTS fiado_mov (id INTEGER PRIMARY KEY, cliente_id INTEGER, data TEXT, tipo TEXT, valor REAL, venda_id INTEGER, obs TEXT);
  CREATE TABLE IF NOT EXISTS caixas (id INTEGER PRIMARY KEY, abertura TEXT, fechamento TEXT, operador TEXT, valor_inicial REAL DEFAULT 0, valor_contado REAL, status TEXT DEFAULT 'aberto');
  CREATE TABLE IF NOT EXISTS caixa_mov (id INTEGER PRIMARY KEY, caixa_id INTEGER, data TEXT, tipo TEXT, valor REAL, obs TEXT, operador TEXT);
  CREATE TABLE IF NOT EXISTS vendas (
    id INTEGER PRIMARY KEY, data TEXT, caixa_id INTEGER, operador TEXT, subtotal REAL, desconto REAL DEFAULT 0, total REAL, troco REAL DEFAULT 0,
    cpf TEXT, cliente_id INTEGER, status TEXT DEFAULT 'ok', nfce_status TEXT, chave TEXT, numero INTEGER, serie INTEGER, protocolo TEXT,
    qrcode TEXT, url_chave TEXT, motivo TEXT, tpemis INTEGER DEFAULT 1, xml_path TEXT);
  CREATE INDEX IF NOT EXISTS ix_vendas_data ON vendas(data);
  CREATE TABLE IF NOT EXISTS venda_itens (id INTEGER PRIMARY KEY, venda_id INTEGER, produto_id INTEGER, codigo TEXT, nome TEXT, unidade TEXT, qtd REAL, preco REAL, desconto REAL DEFAULT 0, total REAL, custo REAL DEFAULT 0, ncm TEXT, cfop TEXT, csosn TEXT, origem TEXT, cest TEXT, trib_aprox REAL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS ix_itens_venda ON venda_itens(venda_id);
  CREATE TABLE IF NOT EXISTS venda_pag (id INTEGER PRIMARY KEY, venda_id INTEGER, forma TEXT, valor REAL, integrado INTEGER DEFAULT 0, bandeira TEXT, nsu TEXT, autorizacao TEXT, cnpj_cred TEXT, conciliado INTEGER DEFAULT 0, data TEXT);
  CREATE TABLE IF NOT EXISTS entradas (id INTEGER PRIMARY KEY, data TEXT, fornecedor TEXT, cnpj TEXT, numero TEXT, chave TEXT UNIQUE, total REAL, itens INTEGER);
  CREATE TABLE IF NOT EXISTS conciliacao (id INTEGER PRIMARY KEY, importado TEXT, data TEXT, valor REAL, forma TEXT, bandeira TEXT, nsu TEXT, venda_pag_id INTEGER, situacao TEXT);
  CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY, data TEXT, usuario TEXT, acao TEXT, detalhe TEXT);
  ");
  // NFS-e (serviços) — tabela e colunas novas (atualiza instalações antigas)
  $pdo->exec("CREATE TABLE IF NOT EXISTS nfse (id INTEGER PRIMARY KEY, venda_id INTEGER, data TEXT, serie INTEGER, numero INTEGER, id_dps TEXT, ctribnac TEXT, nbs TEXT,
    descricao TEXT, valor REAL, desconto REAL DEFAULT 0, tomador_doc TEXT, tomador_nome TEXT, status TEXT, motivo TEXT, chave TEXT, nnfse TEXT, xml_path TEXT)");
  $pdo->exec('CREATE INDEX IF NOT EXISTS ix_nfse_venda ON nfse(venda_id)');
  $cols = array_column($pdo->query('PRAGMA table_info(produtos)')->fetchAll(), 'name');
  foreach (['tipo' => "TEXT DEFAULT 'produto'", 'ctribnac' => 'TEXT', 'nbs' => 'TEXT'] as $c => $t) if (!in_array($c, $cols, true)) $pdo->exec("ALTER TABLE produtos ADD COLUMN $c $t");
  $cols = array_column($pdo->query('PRAGMA table_info(venda_itens)')->fetchAll(), 'name');
  foreach (['tipo' => "TEXT DEFAULT 'produto'", 'ctribnac' => 'TEXT', 'nbs' => 'TEXT'] as $c => $t) if (!in_array($c, $cols, true)) $pdo->exec("ALTER TABLE venda_itens ADD COLUMN $c $t");
  if (!(int)$pdo->query('SELECT COUNT(*) FROM usuarios')->fetchColumn()) {
    $pdo->exec("INSERT INTO usuarios (nome,pin,perfil) VALUES ('Gerente','" . password_hash('1234', PASSWORD_DEFAULT) . "','gerente')");
  }
}

function cfg(string $k, $padrao = null) {
  static $cache = null;
  if ($cache === null || $k === '__reload') {
    $cache = [];
    foreach (db()->query('SELECT k,v FROM config') as $r) $cache[$r['k']] = $r['v'];
    if ($k === '__reload') return null;
  }
  return array_key_exists($k, $cache) && $cache[$k] !== '' ? $cache[$k] : $padrao;
}
function cfgSet(array $vals): void {
  $st = db()->prepare('INSERT INTO config (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v');
  foreach ($vals as $k => $v) $st->execute([$k, is_scalar($v) || $v === null ? (string)$v : json_encode($v)]);
  cfg('__reload');
}

function q(string $sql, array $p = []): array { $s = db()->prepare($sql); $s->execute($p); return $s->fetchAll(); }
function q1(string $sql, array $p = []) { $s = db()->prepare($sql); $s->execute($p); $r = $s->fetch(); return $r ?: null; }
function qv(string $sql, array $p = []) { $s = db()->prepare($sql); $s->execute($p); return $s->fetchColumn(); }
function ex(string $sql, array $p = []): int { $s = db()->prepare($sql); $s->execute($p); return (int)db()->lastInsertId(); }
function agora(): string { return date('Y-m-d H:i:s'); }
function logar(string $usuario, string $acao, string $det = ''): void { ex('INSERT INTO log (data,usuario,acao,detalhe) VALUES (?,?,?,?)', [agora(), $usuario, $acao, $det]); }
