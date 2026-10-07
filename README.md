# Vaz Barber — marcações

Site de marcações com aprovação manual e lembretes por email.

- **Clientes** escolhem serviço, dia e hora e pedem a marcação (`index.html`).
- **A dona** recebe um email, entra na agenda (`admin.html`) e confirma ou recusa.
- **O cliente** recebe a confirmação com um ficheiro de calendário (o telemóvel avisa 1 dia e 2 horas antes) e um botão para o Google Calendar.
- **Lembrete por email** cerca de 24 horas antes.
- Na agenda também se bloqueiam folgas, férias ou horas soltas.
- **Privacidade:** o site público mostra só a zona (ex.: "Lisboa"). A morada exata só segue no email de confirmação.

Tudo em planos gratuitos: **GitHub Pages** (site), **Supabase** (base de dados, login e funções) e **Brevo** (emails, até 300 por dia).

> **Experimenta já:** sem configurar nada, o site abre em *modo demonstração* com dados de exemplo. Abre `index.html` e `admin.html` no browser para veres como funciona.

---

## Como funciona

```
 Cliente ──► index.html (GitHub Pages)
               │ vê vagas ─────────► Supabase: available_slots()
               │ pede marcação ────► função "book" ──► email ao cliente + à dona
 Dona ─────► admin.html (com login)
               │ confirmar/recusar ► função "manage-booking" ──► email ao cliente (+ .ics)
 Agendador (de hora a hora) ───────► função "send-reminders" ──► lembrete 24h antes
```

| Ficheiro | O que é |
|---|---|
| `config.js` | **O único ficheiro do site a editar**: nome, zona, telefone e chaves do Supabase |
| `index.html`, `admin.html`, `assets/` | O site |
| `supabase/schema.sql` | Tabelas, horário, serviços e regras de segurança |
| `supabase/cron.sql` | Agenda os lembretes automáticos |
| `supabase/functions/` | Código que corre no servidor (emails) |

---

## Instalação (≈ 30–45 min, uma vez só)

### 1. Supabase — base de dados

1. Cria conta em [supabase.com](https://supabase.com) e um **New project** (região: *West EU (Ireland)* ou *Central EU (Frankfurt)*).
2. Abre **SQL Editor → New query**, cola todo o `supabase/schema.sql` e **antes de correr**:
   - troca os valores marcados com ⚠️ (email de login e, no fim, a configuração privada: morada, emails e endereço do site);
   - já vem com **Corte de cabelo, 45 min, 10 €** e o horário **todos os dias, 10h–12h e 14h–16h**. Tudo isto se muda depois em **Table Editor** (ver *Afinar*).
3. Carrega em **Run**.
4. **Authentication → Users → Add user → Create new user**: o email dela e uma palavra-passe. Marca *Auto Confirm User*.
5. **Authentication → Sign In / Providers**: desliga **Allow new users to sign up** (assim ninguém mais cria conta).
6. Em **Project Settings → API** (ou *API Keys*) copia o **Project URL** e a chave **anon / publishable**.

### 2. Brevo — envio de emails

1. Cria conta grátis em [brevo.com](https://www.brevo.com).
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender**: o email de onde saem as mensagens. Confirma-o no link que recebes.
   - Funciona com um Gmail, mas **um domínio próprio** (ex.: `marcacoes@vazbarber.pt`, ~10 €/ano) faz com que os emails caiam muito menos no spam. Se tiveres domínio, autentica-o no Brevo (separador *Domains*).
3. **SMTP & API → API Keys → Generate a new API key**. Copia a chave (começa por `xkeysib-`).

### 3. Publicar as funções do servidor

Precisas de [Node.js](https://nodejs.org) instalado. Num terminal, dentro da pasta do projeto:

```bash
npx supabase login
npx supabase link --project-ref O-TEU-PROJETO     # o ID que aparece no URL do projeto
npx supabase functions deploy book --no-verify-jwt
npx supabase functions deploy manage-booking --no-verify-jwt
npx supabase functions deploy send-reminders --no-verify-jwt
```

Depois, em **Edge Functions → Secrets**, cria o secret `BREVO_API_KEY` com a chave do Brevo. Os restantes dados (morada, emails, endereço do site) ficam na tabela privada `app_settings` (preenchida no passo 1), por isso **nada pessoal fica no código, que é público no GitHub**.

(As funções verificam elas próprias quem as chama; o `--no-verify-jwt` só evita uma verificação duplicada.)

### 4. Lembretes automáticos

No **SQL Editor**, cola `supabase/cron.sql`, troca `O-TEU-PROJETO` e carrega em **Run**. O segredo do agendador é gerado sozinho no passo 1.

### 5. Site no GitHub Pages

1. Em `config.js`, preenche `SUPABASE_URL` e `SUPABASE_ANON_KEY` (zona e Instagram já estão preenchidos). (A chave *anon* é pública por natureza: a segurança está nas regras da base de dados.)
2. Cria um repositório no GitHub e envia todos os ficheiros.
3. **Settings → Pages → Build and deployment**: *Deploy from a branch*, branch `main`, pasta `/ (root)`.
4. Passado um minuto, o site está em `https://vazbarber.github.io/` e a agenda em `.../admin.html`.
5. No Supabase, **Authentication → URL Configuration**: põe esse endereço em **Site URL** e acrescenta `.../admin.html` em **Redirect URLs** (para o "esqueci-me da palavra-passe" funcionar).

### 6. Manter o Supabase acordado (recomendado)

O plano gratuito pausa projetos após **7 dias sem atividade**. Os lembretes de hora a hora já geram atividade, mas por segurança o repositório inclui `.github/workflows/keep-alive.yml`, que faz um pedido de 3 em 3 dias. Basta criar dois secrets em **GitHub → Settings → Secrets and variables → Actions**: `SUPABASE_URL` e `SUPABASE_ANON_KEY`.

### 7. Testar

1. Faz uma marcação no site com o teu email → recebes "Pedido recebido"; a tua irmã recebe "Nova marcação para aprovar".
2. Na agenda, carrega **Confirmar** → recebes a confirmação com o ficheiro `.ics`.
3. Se algum email não chegar: espreita o spam e depois **Supabase → Edge Functions → (função) → Logs**.

---

## Horário (definido na agenda)

O horário não é fixo: na agenda, secção **Horário**, a dona toca em cada dia para escolher **fechado**, **dia todo**, **só manhã** ou **só tarde**. Fica guardado logo.

- Dias sem nada definido ficam fechados para os clientes. A ideia é definir o mês seguinte durante o mês atual (em outubro define-se novembro, e assim por diante).
- A partir do dia 15, a agenda mostra um aviso se o mês seguinte ainda estiver vazio. A partir do dia 20, segue também um email (uma vez por mês).
- As horas de cada turno (manhã e tarde) mudam-se na mesma secção, em **Horas dos turnos**.
- Para fechar só parte de um turno (ex.: uma consulta), usa **Bloquear horas específicas**.
- Projetos novos: depois do `schema.sql`, corre também `supabase/disponibilidade.sql`.

## Afinar

- **Serviços, preços e durações** (com vários serviços, o site mostra automaticamente o passo de escolha): Supabase → Table Editor → `services` / `business_hours` (pode haver duas linhas no mesmo dia para a pausa de almoço; `weekday` 1 = segunda … 7 = domingo).
- **Horas propostas**: seguem a duração do serviço (45 min → 10:00, 10:45, 14:00, 14:45). Mudando a duração, as horas ajustam-se sozinhas.
- **Antecedência mínima e dias para a frente**: no início da função `available_slots` em `schema.sql` (volta a correr só essa função no SQL Editor).
- **Cores**: variáveis no topo de `assets/style.css` (tiradas do logo).
- **Logo**: `assets/logo.png` e `assets/favicon.png`.
- **Textos dos emails**: `supabase/functions/_shared/common.ts`, secção *Modelos de email* (depois volta a fazer `deploy` das funções).

## Alternativas de alojamento

O site são ficheiros estáticos, por isso funciona igual em **Cloudflare Pages**, **Netlify** ou **Vercel** (todos com plano gratuito e domínio próprio fácil). O GitHub Pages também aceita domínio próprio em *Settings → Pages → Custom domain*.

## Ideias para depois

- Lembrete por **SMS** ou **WhatsApp** (Brevo/Twilio, pago por mensagem): basta acrescentar o envio em `send-reminders`.
- Link no email para o cliente **cancelar sozinho**.
- Vários profissionais com agendas separadas.
