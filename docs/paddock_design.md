# Quick-grid — identidade do paddock

Redesign de apresentação: vermelho de corrida `#f0443c`, azul `#477dff`, asfalto `#10131a` e branco quente `#f2f0e9`. Composição editorial, faixas diagonais, tipografia mecânica e contornos discretos. Não usa o padrão de cartões arredondados com brilho neon.

## Implementação

- `index.html`: hierarquia da abertura, formulário de corrida, ajuda acessível, consentimento opcional e resultado final.
- `src/styles/paddock.css`: identidade visual, HUD, layouts responsivos, hover e animação de volta no mapa.
- `src/paddock.js`: projeção dos waypoints do catálogo para SVG, resumo reativo, ajuda modal, pausa de animações e estado de preparação da largada.
- `src/main.js`: inicializa a apresentação após preencher os circuitos. IDs, valores e configurações padrão do jogo foram preservados.
- `scripts/test_paddock.js`: os 24 previews não mutam a geometria original; testa resumos e dados degenerados. Executar com `node scripts/test_paddock.js`.

O mapa usa coordenadas existentes, não uma imagem de circuito inventada. Nenhuma alteração em física, bots, telemetria, APIs ou migrations. Não habilita consentimento automaticamente. O menu se adapta a celulares; pilotagem continua exigindo teclado, sem promessa de novos controles touch.

Animações respeitam `prefers-reduced-motion` e podem ser pausadas no cabeçalho. Todos os selects permanecem nativos e rotulados. Ajuda usa `<dialog>`, com Escape e restauração nativa de foco. A largada bloqueia cliques duplicados e fornece status de carregamento/erro. A limpeza de recordes exige confirmação.

## Verificação local

- Regressão existente: 303 testes aprovados. Helpers de apresentação: 28 verificações aprovadas. Build Vite aprovado.
- Navegador isolado via agent-browser: desktop 1440 × 900 e 1366 × 768; celular 390 × 844, sem overflow horizontal.
- Seleção de Spa, condição molhada, contrarrelógio, volta única e transmissão automática atualiza mapa/resumo; troca para corrida reabilita adversários.
- Ajuda abre, fecha com Escape e restaura foco. Pausa do menu e preferência do sistema de movimento reduzido verificadas. Recusar telemetria mantém coleta online desativada.
- Largada local com três adversários: quatro carros, circuito selecionado, menu fechado e foco no canvas. APIs de recordes/bots simuladas no navegador; não valida backend cloud nem grava dados de produção.
- Tela de resultado acionada para teste visual e retorno ao menu conferido; não representa uma corrida humana concluída.
- Auditoria axe: zero violações automáticas após correção de dois contrastes. Textos sobre imagem/padrão e selects com ícone de fundo exigem inspeção visual complementar; não equivale a certificação completa de acessibilidade.
- Capturas locais em `artifacts/paddock/`, ignoradas pelo Git.

## Arte

Arquivo local: `public/images/paddock-gt3.png` (1844 × 853). Criado com a ferramenta integrada de geração de imagens, sem API/CLI externa. O original foi preservado fora do projeto. É arte conceitual de abertura, identificada na interface; não representa a renderização da corrida.

Prompt final utilizado:

> Use case: ads-marketing. Asset type: background hero artwork for the opening menu of Quick-grid, a GT3 racing game. Create an editorial motorsport photograph, ultrawide landscape composition. A single contemporary GT3 endurance race car in a vivid vermilion red livery with small electric cobalt blue panels, low front-three-quarter angle, car traveling toward left foreground on dark dry asphalt. Large rear wing, realistic racing slick tires, sculpted carbon splitter, credible race car proportions, white LED headlights. Car occupies the lower right and middle of frame, large and sharp; left third is dark negative space for overlaid typography. Background: blurred circuit pit wall and track at dusk, electric blue pit lighting, subtle warm red light on the asphalt. Sophisticated automotive campaign photography, tactile grain, true-to-life materials and restrained motion blur, deep midnight navy shadows. No people, no text, no lettering, no logos, no watermarks. Not a UI mockup, no buttons, no panels. Landscape wide framing with full car visible.
