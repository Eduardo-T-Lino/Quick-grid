# Contas de pilotos

Cadastro opcional com nome de usuário (3–24 letras ASCII, números ou `_`, único sem distinguir maiúsculas), nome de piloto (2–32 caracteres) e senha (6–128 caracteres). Entrar, criar conta e sair ficam no botão do cabeçalho. Continuar sem conta mantém o jogo disponível. O nome do piloto é usado na próxima corrida; recordes permanecem no navegador, sem migração para a conta. Não há e-mail, recuperação de senha, ranking online, papéis administrativos nem vinculação à telemetria nesta entrega.

## Segurança e armazenamento

- Senha protegida por scrypt N=131072, r=8, p=1, salt aleatório de 128 bits, comparação constante. Duas derivações simultâneas no máximo para limitar consumo de memória; sobrecarga retorna 503, não reduz o custo.
- Sessão opaca aleatória de 256 bits, validade absoluta de sete dias, hash SHA-256 do token no banco. Cookie HttpOnly/SameSite=Lax/Path=/; em produção usa Secure e prefixo `__Host-`. O token não vai para JSON nem localStorage.
- Login troca o token; logout revoga no servidor. Senha errada e usuário inexistente retornam o mesmo erro. Cadastro informa indisponibilidade do username, que é um identificador público.
- POST exige JSON, origem explicitamente aceita e cabeçalho próprio. Login/cadastro limitados por IP e username (15 tentativas/15 min, por processo), com mapa limitado. Não é proteção distribuída nem MFA.
- SQL parametrizado, cadastro e sessão na mesma transação; nomes exibidos como texto/escapados. Nenhum dado de conta é incluído em telemetria anônima.

Referências: [OWASP — Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) e [OWASP — Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Rodar localmente

Execute `npm run dev`: o Vite inclui a API real de contas na mesma origem. `npm run preview` também inclui esse serviço local. Não é necessário iniciar um segundo terminal para cadastro/login. Reinicie prévias antigas para carregar a configuração nova.

As contas da prévia Vite são temporárias em memória e a interface informa isso. Não usar senhas reais nessa demonstração. O backend independente (`npm run server`) mantém sua seleção de armazenamento: sem DATABASE_URL em desenvolvimento usa memória; com PostgreSQL usa o banco. `npm run migrate` cria `player_accounts` e `player_sessions` através da migration `002_player_accounts.sql`. Produção não aceita fallback em memória.

## Publicação futura

Nenhum deploy/push foi executado nesta alteração. `vercel.json` prepara o proxy de `/api/v1/auth/:path*` para o backend Render existente. É preciso publicar backend + migration primeiro e depois frontend, manter HTTPS e autorizar a origem exata do frontend em CORS_ALLOWED_ORIGINS. Conferir cookie Secure/HttpOnly, origem/CSRF, login após reload e persistência após reinício contra PostgreSQL real antes de homologar contas públicas. Os testes desta entrega não executam SQL no banco cloud.

O proxy evita depender de cookies de terceiros entre Vercel e Render. Ele não substitui as validações no backend. Não usar cache nas rotas de conta. Política de retenção, backup e recuperação de senha precisam de definição antes de uso público continuado.

## Evidência local

`npm run test:auth`: hash real, cookie de produção, rotação, expiração, logout, CSRF, rate limit e contratos/transações PostgreSQL com mocks. `scripts/test_auth.browser.js`: 12 verificações via interface e API real local com armazenamento temporário, sem mock de autenticação. Sessão após reload e layout em 390×844 também conferidos. Isso não é homologação PostgreSQL/cloud.
