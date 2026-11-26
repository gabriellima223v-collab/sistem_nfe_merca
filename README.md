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
- Área restrita (canto superior direito do site): **Nova licença** gera a chave, **Bloquear/Desbloquear**, **Liberar troca de PC**, vencimento do plano e a aba **Entradas** (ativações, logins, abertura/fechamento de caixa, tentativas bloqueadas).
- O app pede a chave só na primeira vez, abre junto com o Windows e só trava se você bloquear (em até 10 minutos).
  Sem internet ele continua funcionando por até 30 dias (para ninguém escapar do bloqueio desligando a internet).
- Toda mudança na pasta `app/` gera uma versão nova do instalador automaticamente.
