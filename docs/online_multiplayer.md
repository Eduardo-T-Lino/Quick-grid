# Online privado e torneios — primeira versão

## Jogar

1. Abra **JOGAR ONLINE** no cabeçalho. Conta não é obrigatória; informe seu nome de piloto e transmissão.
2. Escolha pista, voltas (3–80) e clima no menu normal antes de criar a sala.
3. Crie uma corrida única ou um torneio de **2–12 etapas**. Compartilhe o código de seis caracteres.
4. Amigos abrem o jogo no **mesmo servidor** e usam **ENTRAR NA SALA**. Até oito pilotos; sem bots online nesta versão.
5. Todos marcam **ESTOU PRONTO**. O anfitrião inicia.
6. Em torneios, cada etapa oferece três pistas sorteadas, sem repetir pistas já escolhidas. Cada piloto tem um voto e pode mudá-lo. A votação termina quando todos os conectados votarem ou após 20 segundos; empate/ausência de votos é resolvido por sorteio no servidor.
7. Após carregar a pista, a largada é comandada pelo servidor. Pontuação: 25, 18, 15, 12, 10, 8, 6 e 4. DNF não pontua. No resultado, o anfitrião inicia a votação da próxima etapa; a última encerra o torneio com classificação acumulada.

ESC/R abre o menu online **sem pausar os demais**. Sair abandona a participação; o anfitrião é transferido para outro conectado. Uma queda temporária pode reconectar por até 20 segundos, mantendo a aba aberta. Recarregar/fechar a aba não preserva o ticket da sala nesta primeira versão.

## Rodar localmente / rede doméstica confiável

- `npm run dev`: jogo + contas temporárias + servidor de salas, na URL local exibida pelo Vite. Duas abas/documentos podem testar convidados separados.
- Para amigos na mesma rede: execute `npm run build`, depois `npm run online:lan`. Todos acessam `http://IP-LOCAL-DO-COMPUTADOR:4173/` (não `localhost` no computador do amigo).
- A máquina que roda o comando precisa ficar ligada; a rede/firewall precisa permitir essa conexão. Esta alteração não abriu portas no firewall nem configurou roteador. Não encaminhe a prévia para a internet pública.
- Salas, resultados de torneio e convidados ficam em memória e desaparecem quando o processo reinicia. A prévia local não fornece persistência de contas PostgreSQL.

## Arquitetura e limites

- Servidor autoritativo: clientes enviam somente W/S/A/D, boost e troca manual. Física, colisões, vácuo, largada, checkpoints, voltas, colocação e pontuação são calculados no servidor.
- Reutiliza `Car.update` e a geometria existentes, sem recalibrar física/IA. Um adaptador instala/restaura o contexto de cada sala em ticks síncronos a 60 Hz; não pode conter operações assíncronas.
- Envio de snapshots a até 20 Hz, com cadência compensada e timestamp da simulação; histórico limitado a 32 snapshots, janela visual de 100 ms e extrapolação apenas visual limitada a 80 ms para cobrir atrasos curtos. A câmera e os carros usam a mesma amostra temporal; os valores interpolados nunca voltam para a física. Ainda não há predição local/reconciliação de comandos: a janela visual acrescenta atraso e latência de rede afeta a resposta. Não há homologação WAN nem benchmark de capacidade cloud.
- Protocolo versionado pelo fingerprint atual da física. Incompatibilidade pede atualizar a página. Não envia nem coleta demonstrações ML das partidas online e não mistura recordes offline com torneios.
- Até 16 salas / 128 conexões por processo, 16 conexões por endereço de origem de rede; essas cotas são uma proteção básica, não uma garantia de capacidade. Salas em memória exigem instância única; não há Redis, persistência, matchmaking público, chat ou antiabuso distribuído.
- Mensagens limitadas a 2 KB, rate limit, sequência de inputs, limite de fila de saída, validação de origem, heartbeat e ticket de reconexão aleatório mantido apenas na memória da aba. Nomes de convidado não são identidades autenticadas.
- Integração WebSocket anexada ao listener HTTP do backend existente e ao Vite local. Produção continua exigindo configuração/DB/migrações válidas antes de escutar; nenhuma validação de TLS/segredo foi removida.

## Internet — ainda não publicado

Esta validação é local e não publica serviços. Para o site publicado, será necessário publicar esse backend e compilar o frontend com `VITE_ONLINE_URL=wss://SEU-BACKEND/online`, além de permitir a origem HTTPS exata em `CORS_ALLOWED_ORIGINS`. A URL é configuração pública, nunca uma credencial. O navegador conecta diretamente ao backend; não depende de proxy WebSocket do frontend.

O Render aceita WebSockets no serviço HTTP, mas cada conexão é atribuída a uma instância: salas em memória não podem ser distribuídas entre instâncias sem coordenação adicional. Referência: [Render — WebSockets](https://render.com/docs/websocket). Implementação de upgrade, heartbeat e limites de payload baseada em [ws — documentação oficial](https://github.com/websockets/ws/blob/master/doc/ws.md).

## Evidência desta implementação

- `npm run test:online`: 18 verificações, incluindo jitter, limite de histórico, descarte de snapshots fora de ordem, extrapolação limitada, teleporte, duas salas isoladas, cap de jogadores, origem rejeitada, clientes WebSocket reais, votos, reconexão, dados não confiáveis, duas etapas, pontos idempotentes e encerramento.
- A conclusão de duas etapas usa fixtures de checkpoints no servidor com a implementação real de voltas; não representa duas corridas humanas completas.
- `scripts/test_online.browser.js`: 17 verificações com dois documentos independentes, UI e servidor reais: cartões de formato/transmissão, limites do seletor de etapas, criar/entrar como convidados, votar preservando foco, carregar, largar, acelerar, boost replicado, posição local forjada corrigida, transmissão manual, ESC sem pausa e transferência de anfitrião. Nenhuma autenticação/rede online foi simulada nesse roteiro.
- Gate local ML2.2 com suíte online: 333 testes passaram; build passou. Verificações de tração, drift e geometria continuam disponíveis e foram preservadas.
- Regressão offline no navegador: `scripts/test_boost.browser.js`, 13 verificações de boost, largada, HUD, pausa, foco e reinício passaram após a integração online.
- Prévia do build em localhost: dois convidados criaram/entraram na sala e chegaram à votação real de três pistas. Menu e votação inspecionados visualmente; entrada também conferida em 390 × 844. Nenhum erro de página registrado nessa verificação. Isso não substitui um teste entre computadores em LAN/WAN.
- Auditoria de dependências: `ws` instalado sem scripts; existe um alerta moderado em `qs`, dependência transitiva preexistente de Express. Nenhum `audit fix` amplo foi aplicado; reavaliar antes de publicação pública.

Sem ML3, serviços cloud novos ou alterações de login nesta etapa.

## Correção de solavancos e revisão visual — 14/09/2026

- Sala redesenhada com transmissão/formato em botões acessíveis, etapas com +/−, código de convite destacado, grid lateral com pontos, prévia do circuito e cartões de votação com contagem e cronômetro. Caminhos SVG são reaproveitados e votar não recria os cartões nem remove o foco. Lista de pilotos rola em janelas baixas; entrada conferida em 390 × 844 sem overflow horizontal.
- Causa reproduzida: a interpolação antiga recomeçava um tween fixo de 50 ms a cada pacote, mesmo quando a entrega demorava mais. Na captura inicial, foram 65 quadros de movimento quase nulo entre 285 amostras com velocidade física acima de 0,15 unidade/tick, apesar de 600 quadros renderizados em 10 s.
- `node scripts/run_online_browser_checks.js` executa a medição, os 17 testes online e os 13 testes offline em Chromium isolado. Usa Playwright como alternativa à ferramenta CLI que perdeu o contexto da aba. Capturas e relatório ficam em `artifacts/online-*`; nenhuma telemetria ML é habilitada.
- Captura final: oito conexões locais, **apenas uma página renderizando**, sete convidados de protocolo, 10 s em Interlagos. 599 quadros, p95 de 16,7 ms, nenhum quadro acima de 50 ms; 0 quadros de movimento quase nulo em 278 amostras elegíveis. p95 do intervalo entre snapshots: 69,1 ms; nenhum quadro precisou extrapolar. A execução intermediária teve p95 de 33,3 ms e também zero paradas visuais; não há promessa de FPS fixo.
- As capturas inicial/final ocorreram em execuções e ferramentas distintas: são evidência da correção reproduzida, não um benchmark controlado de ganho percentual. Não representam oito navegadores simultâneos, conexão WAN, partida humana completa nem capacidade do Render. Atrasos prolongados ainda congelam a apresentação por segurança e exibem aviso de conexão instável.
