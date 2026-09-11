# Velocidade restaurada e grid de largada

- Potência e relações de marchas restauradas aos valores anteriores à redução RWD; referência de limite do motor de 285 km/h no HUD. O desempenho real depende de curva, marcha, aderência e inclinação.
- Tração traseira, perda de aderência, vácuo, tamanho visual dos carros e login preservados.
- 20 posições numeradas, em duas colunas intercaladas: primeira a 6 m da linha, 8 m entre posições sucessivas (16 m na mesma coluna), deslocamento lateral de até 4,5 m. São escolhas de adaptação do jogo, não homologação de um regulamento real.
- `startingGrid.js` calcula os slots por comprimento dos segmentos, acompanhando orientação e altura do circuito. O mesmo resultado posiciona carros e marcações, corrigindo o desencontro anterior. O cálculo é cacheado por pista/largura e não roda a cada frame.
- O jogador mantém o último lugar de acordo com o número de bots; o semáforo existente libera todos juntos. Não há classificação ou volta de apresentação nova.
- Coordenadas, largura, checkpoints e perfis de velocidade das pistas não foram modificados.

Validação: `node scripts/test_starting_grid.js`, `node scripts/test_race_presentation.js`, `node scripts/test_corner_traction.js`, `npm run test:wake`, `node scripts/test_ml22_final.js`, scripts de navegador `test_rwd_physics.browser.js` e `test_race_start.browser.js`, e `npm run build`. Testes de física usam uma reta sintética; não substituem a avaliação humana da pilotagem.
