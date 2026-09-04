# Fluidez com aceleração e 19 bots — 04/09/2026

## Escopo

Alterações locais de apresentação. Sem commit, push, deploy, ML3, mudanças de
aceleração/direção, regras dos bots, colisões ou coordenadas da pista.
O seletor de circuitos, a arte dos carros e a sequência de largada foram mantidos.

## Dois problemas identificados

1. O callback JavaScript era curto, mas isso não media a rasterização posterior.
   Os caminhos completos do circuito e centenas de detalhes estáticos eram
   processados novamente enquanto a câmera se deslocava, girava e mudava o zoom.
2. A física de 60 Hz era desenhada diretamente, sem interpolação. Em uma amostra
   real de quatro segundos, 101 de 217 quadros com intervalo abaixo de 25 ms
   tinham zero ou dois ticks físicos. Isso repetia uma posição e depois mostrava
   um salto, mais perceptível em alta velocidade. Não é a mesma coisa que FPS baixo.

## Implementação

- `renderGeometry.js`: recorte conservador por blocos de 32 segmentos, sem
  simplificar pontos. Retém segmentos que atravessam a tela mesmo com extremos
  fora dela e mantém a continuidade na linha de chegada.
- `trackTileCache.js` / `track.js`: regiões gráficas de 64 metros, 10 px/metro
  (acima do zoom máximo de 9,2), com sobreposição para evitar emendas ao girar.
  Asfalto, grama, zebras, barreiras e placas são reutilizados como imagens.
  No máximo 64 regiões retidas: aproximadamente 101,3 MiB de pixels RGBA;
  memória real do navegador/GPU inclui recursos adicionais e pode ser maior.
  Uma região adjacente é preparada por quadro, evitando preparar um anel inteiro
  de uma vez. Regiões visíveis são protegidas contra descarte prematuro.
  Troca de pista, clima ou estilo invalida o cache. Viewports enormes usam
  desenho vetorial exato, sem alocação ilimitada ou troca contínua do cache.
- `ui.js` / `styles/main.css`: conta-giros usa `scaleX`, sem animar a largura;
  textos de alertas/RPM só são reescritos quando realmente mudam.
- `renderPose.js`: guarda a posição anterior a cada tick e interpola somente
  o desenho e o alvo visual da câmera. Nenhum valor interpolado volta ao carro.
  Usa o arco curto ao cruzar +/- pi; teletransportes grandes não são interpolados.
  É interpolação entre o último par de estados, com atraso visual de até um tick
  (16,7 ms), não extrapolação nem mudança na resposta física dos controles.
- `game.js` / `car.js` / `carAppearance.js`: passam essa pose separadamente para
  o desenho; continuam usando a identidade original do carro no cache da arte.
  O culling usa a posição desenhada. Todos os bots continuam sendo simulados.

Não foram reduzidos frequência física, número de bots, detalhes dos carros,
resolução da tela, nem quantidade de amostras da pista.

## Evidência de desempenho e limites

Host: i5-14500, NVIDIA T400 4 GB, 16 GB RAM, tela 1920×1080/60 Hz. Chrome de teste
confirmou ANGLE/D3D11 na T400, sem `--disable-gpu`. Navegadores headless isolados;
APIs legadas locais tiveram fixtures vazias, sem habilitar telemetria online.

Comparação controlada de oito segundos, mesma trajetória de câmera a zoom 6,4,
mesmos 20 carros sempre visíveis, sem simulação de corrida durante esse teste:

| Medida | Antes | Cache gráfico |
| --- | ---: | ---: |
| Rasterização acumulada¹ | 4.579 ms | 632 ms |
| FPS médio entregue | 58,00 | 58,25 |
| Intervalo entre quadros, p99 | 50,1 ms | 43,8 ms |
| Callback JS médio | 0,844 ms | 1,110 ms |

¹ Soma dos eventos CDP `RasterDecoderImpl::DoRasterCHROMIUM` e
`RasterDecoderImpl::DoEndRasterCHROMIUM`, sem somar seus filhos novamente.
Redução aproximada de **86% desse trabalho de rasterização**, não 86% mais FPS.
O preparo incremental transfere parte do trabalho para callbacks ocasionais.
Esses perfis foram coletados antes da interpolação visual; ela é validada abaixo.

Também houve corridas reais de teste com jogador acelerando e 19 bots,
não apenas câmera seguindo bot estacionário: Chrome e Edge, manual/automático.
Continuaram existindo picos de entrega de quadros no ambiente headless; não há
garantia de 60 FPS travados nem alegação de que toda fonte de lag foi eliminada.
As médias de corrida após cache, antes da interpolação, foram 57,00 FPS no Chrome
e 54,38 FPS no Edge (sem baseline comparável do Edge nesta rodada).

O teste da interpolação no navegador aplica jitter controlado de +/-0,5 ms aos
timestamps RAF, sem acrescentar callbacks. Isso torna reproduzível a fronteira
de zero/dois ticks, que pode não ocorrer numa execução perfeitamente sincronizada.
Chrome: 23 quadros rápidos sem novo tick físico, zero posições visuais repetidas.
Edge: 22 quadros nessa situação, zero posições repetidas. Ambos simularam e
desenharam os 19 bots e preservaram os campos físicos do carro.
Esses são testes de continuidade, não benchmarks de FPS.

## Validação

- `npm run test:ml22:gate`: 303 testes e build.
- `node scripts/test_paddock.js`: 28 testes.
- `node scripts/test_track_presentation.js`: 12 testes.
- `node scripts/test_race_presentation.js`: 9 testes.
- `node scripts/test_render_performance.js`: 13 testes novos de recorte/cache/HUD.
- `node scripts/test_render_pose.js`: 10 testes novos de interpolação, incluindo
  60/120/144 Hz, RAF irregular, múltiplos ticks, reset, teletransporte, ângulos e
  preservação de carros congelados e da sequência aleatória da simulação.
- Total Node: **375 testes**, além do build.
- Navegador: catálogo (19 verificações), largada (16 por navegador), interpolação
  (8 por navegador). Executar os scripts `.browser.js` via `agent-browser eval
  --stdin`, em página local recém-carregada. O catálogo muda configurações de
  corrida durante o teste; recarregar antes de executar o teste da largada.
- Comparação de pixels com o desenho anterior em seis cenas, cobrindo cinco
  circuitos, seca/molhada e vários giros/zooms: erro médio por canal abaixo de
  0,85/255; menos de 0,2% dos pixels com diferença RGB somada maior que 90;
  nenhum pixel preto por falha de cobertura.
- O corpo de simulação de `Car` e a resolução de colisões foram comparados com
  a cópia de entrada: iguais. Acumulador e passo de física permanecem iguais.
- As 24 geometrias geradas e perfis de velocidade mantêm o SHA-256
  `4b37947beec2d0b072dc39122cd9e34bfb7a1430312af06ce44b8343e6b1c8da`.
- Nenhuma alteração em `ai.js`, `constants.js`, `camera.js`, `f1Tracks.js`, ML ou backend.

Artefatos diagnósticos locais ignorados pelo Git: `artifacts/race-visuals/`.
Incluem perfis `stress-before-trace.json` / `stress-after-trace.json`, comparador
de pixels e `cached-track-grid.png`. Não fazem parte do bundle publicado.

## Verificação humana

Abrir a prévia local atual, recarregar com Ctrl+F5 e largar com 19 bots.
Comparar aceleração em reta, câmera girando nas curvas e pelotão próximo.
Confirmar também que os comandos e o traçado continuam familiares.
Se houver queda restante, registrar resolução, instante da corrida e se ocorre
na prévia local ou numa versão publicada; os testes não substituem essa avaliação.

## Ajuste fino — reutilização das superfícies gráficas

Após o retorno de que restavam engasgos leves, foi medida novamente a mesma
trajetória de câmera, agora por 12 segundos, com 20 carros em 1920×1080 no Chrome.
O cache mantinha 64 tiles, mas continuava criando e destruindo canvases durante
o percurso. A correção recicla a superfície menos recentemente usada fora da
região visível, sem redimensioná-la nem alterar qualidade ou limite de memória.
O estado de pintura é isolado com save/restore, inclusive em falhas do painter.
Também saiu do laço de pontos a criação repetida de `Object.entries(offsets)`.

| Medida após aquecer a região inicial | Antes | Depois |
| --- | ---: | ---: |
| Regiões pintadas no percurso | 259 | 259 |
| Novos canvases alocados | 259 | 8 |
| Maior tempo de preparo de região num quadro | 3,8 ms | 1,7 ms |
| CPU do quadro, p99 | 3,7 ms | 2,8 ms |
| Intervalo RAF, p95 | 23,0 ms | 17,4 ms |
| Intervalo RAF, p99 | 60,5 ms | 33,4 ms |
| FPS médio | 56,31 | 58,67 |

As 8 alocações restantes completam o conjunto de 64 superfícies; depois disso,
novas regiões reutilizam as existentes. O teste unitário percorre mais de mil
regiões e confirma no máximo 64 alocações e nenhum redimensionamento na reciclagem.
Os números de tempo vêm de uma comparação headless, não garantem FPS constante.
Antes da mudança, quadros lentos também ocorreram sem preparar tiles; portanto
esta é a remoção de uma fonte de custo recorrente, não prova de que todo lag acabou.

Validação adicional:

- Testes de cache: agora 16 (3 novos); conjunto Node total: **378**, build aprovado.
- `scripts/test_track_tile_reuse.browser.js`: oito comparações com superfícies
  novas e recicladas, incluindo coordenadas negativas. Tolerância máxima de
  1/255 por canal e erro médio abaixo de 0,001, para arredondamento nas bordas;
  reset continua liberando as superfícies antigas e não há imagens residuais.
- Testes de interpolação e largada passaram, sem erros de console.
- Hashes de carro, loop, IA, constantes, câmera, pistas, desenho da pista,
  interpolação, HUD e partículas iguais aos da entrada desta rodada.
- Nesta rodada só mudaram `trackTileCache.js`, `renderGeometry.js`, testes e
  esta documentação. Sem commit, push ou deploy.
