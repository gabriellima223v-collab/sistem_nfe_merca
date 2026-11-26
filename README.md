# PDV

Caixa com NFC-e (produtos, biblioteca gratuita sped-nfe) e NFS-e nacional (serviços, API Sefin Nacional), estoque, fiado e painel do dono — com licença controlada pelo site.

```
app/        sistema do caixa (PHP local + interface) — vira o instalador .exe
site/       site da Vercel: botão "Baixe aqui" + área restrita (licenças e entradas)
licencas/   servidor de licenças (Apps Script + Planilha Google)
.github/    monta o instalador sozinho e publica em Releases
```

## Configuração (uma vez só)

### 1. Servidor de licenças (Apps Script)
1. Crie uma **Planilha Google** (conta pessoal, não a da Shopee) chamada `PDV Licenças`.
2. **Extensões → Apps Script**, apague o conteúdo e cole o `licencas/Codigo.gs`.
3. Na linha `SENHA_INICIAL`, troque pela sua senha de administrador. Salve.
4. Selecione a função **configurarSenha** e clique em **Executar** (autorize).
5. **Implantar → Nova implantação → App da Web**: executar como **Eu**, acesso **Qualquer pessoa**. Copie a URL (termina com `/exec`).

### 2. GitHub (instalador automático)
1. **Settings → Secrets and variables → Actions → aba Variables → New repository variable**  
   Nome `LICENCA_URL`, valor: a URL `/exec` do passo 1.
2. **Actions → Gerar instalador → Run workflow**. Em ~5 min o `PDV-Setup.exe` aparece em **Releases**.
3. O repositório precisa ser **público** para o link de download funcionar para os clientes
   (nada sensível fica no código: a senha e as licenças ficam no Google).

### 3. Vercel (site)
1. Edite `site/config.js` e cole a URL do Apps Script em `API_URL`.
2. Na Vercel: **Add New → Project → Import** este repositório → **Root Directory: `site`** → Deploy.

## Uso
- O cliente instala, faz o cadastro da empresa e o pedido chega na área restrita (canto superior direito do site) como **Aguardando liberação**. **Autorizar** pede a data de vigência; depois dela o app trava sozinho até você **Renovar**. Também tem **Bloquear/Desbloquear**, **Recusar** e a aba **Entradas** (pedidos, autorizações, logins, abertura/fechamento de caixa, tentativas bloqueadas).
- O app não pede chave: abre junto com o Windows e trava se você bloquear (em até 10 minutos) ou se a vigência acabar (vale mesmo sem internet).
  Sem internet ele continua funcionando por até 30 dias (para ninguém escapar do bloqueio desligando a internet).
- Toda mudança na pasta `app/` gera uma versão nova do instalador automaticamente.

## Segurança e antifraude
- **App do caixa:** só aceita comandos do próprio PDV (bloqueia outros sites, outros programas e DNS rebinding), sessão com cookie protegido, política de conteúdo (CSP) contra scripts injetados, senha travada por 5 min após 5 erros.
- **Caixa:** preço sempre do cadastro, etiqueta de balança conferida com peso × preço, formas de pagamento fixas. Desconto, tirar item, cancelar venda, sangria e fiado acima do limite pedem a senha do gerente e ficam na tela **Auditoria** com quem fez e quem autorizou (também alteração de preço/estoque e senhas erradas).
- **Licença:** vigência vale mesmo sem internet; atrasar o relógio do PC trava o sistema (confere com o horário do servidor).
- **Servidor de licenças:** texto vindo de fora nunca vira fórmula na planilha, limite de pedidos por hora, área restrita trava após 8 senhas erradas, comparação de token em tempo constante.
- **Site:** cabeçalhos de segurança (CSP, anti-iframe, HSTS).
