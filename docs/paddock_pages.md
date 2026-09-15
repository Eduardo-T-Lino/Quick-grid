# Páginas do paddock e sinalização de curvas

## Navegação

- **Início:** imagem principal dominante, atalhos empilhados e cartão do circuito abaixo.
- **Corrida rápida:** configuração em página própria. Valores continuam preservados ao alternar páginas.
- **Online:** entrada, lobby, votação e resultados dentro da mesma página, sem modal. ESC durante a corrida abre essa página sem pausar o servidor; **VOLTAR À PISTA** devolve o controle. Teclas de direção ficam neutralizadas enquanto a página está aberta.
- **Recordes:** tabela e busca existentes, mantendo armazenamento local. As quatro abas aceitam setas/Home/End e a navegação suporta voltar/avançar do navegador.

Conta e controles permanecem como diálogos auxiliares, acessíveis no cabeçalho. O offline não exige conta. Online exige sessão válida no cliente **e no servidor**, inclusive na reconexão. Na prévia Vite as contas são temporárias; nenhum recurso cloud ou migration foi criado.

## Placas

`src/brakingBoards.js` analisa a linha central já gerada, usando distância acumulada em metros e mudança de direção em uma janela de 30 m. Descarta pequenas ondulações da spline e identifica entradas de curvas relevantes. Curvas muito próximas compartilham a aproximação da primeira curva do conjunto, evitando séries conflitantes.

Cada aproximação recebe **300, 250, 200, 150, 100 e 50 m**, medidos ao longo do traçado até a entrada detectada (inclusive atravessando a linha de chegada). As placas ficam do lado externo da curva, a cinco metros além da meia largura da pista, com seta de direção. É uma sinalização visual baseada na geometria do jogo, não uma reprodução homologada das posições reais da FIA. Não altera física, colisões, coordenadas, IA ou ponto de frenagem dos bots.

A análise é reaproveitada por identidade do traçado em WeakMap. A renderização percorre apenas a pequena lista de placas e descarta as fora da câmera; não reanalisa a pista por quadro. Nos 24 circuitos atuais são 6–10 aproximações e 36–60 placas por pista.

## Validação reproduzível local

- `npm run test:boards`: distâncias, ordem, posição lateral, cache e imutabilidade dos 24 traçados/perfis de velocidade.
- `npm run test:online-auth`: ticket, uso único, expiração, origem, cookie de produção, identidade, limite por conta, reconexão e revogação real HTTP/WebSocket.
- `npm run test:ml22:gate`: regressão local, autenticação, controles, sinalização e build.
- Com Vite em `http://127.0.0.1:5185/`, `npm run test:paddock:browser`: dois contextos Chromium com contas distintas criadas pela interface; páginas, mobile, votação, corrida, boost, ESC, logout e offline convidado. Capturas em `artifacts/paddock-*`.
- `node scripts/test_controls_browser.js`: regressão de controles personalizados, agora com os dois participantes autenticados.
- `node scripts/test_online.browser.js` é um alias Node para o novo roteiro completo; não deve mais ser colado no console do navegador. O antigo cenário com iframe/convidados foi substituído porque compartilhava cookies.
- `node scripts/run_online_browser_checks.js`: roteiro completo, amostra de carga com uma página renderizada e sete contas de protocolo, e regressão offline de boost. Usa contas temporárias e respeita o limite de cadastro; sucessivas execuções na mesma prévia podem atingir o rate limit.

Resultados locais não comprovam latência WAN, desempenho em oito computadores ou persistência PostgreSQL/cloud. Nenhum deploy/commit/push faz parte desta alteração.
