# Corrida: apresentação, desempenho e largada

## Limites preservados

O seletor de circuitos foi mantido. Não foram alterados `f1Tracks.js`, `constants.js`, `ai.js` ou `camera.js`. No carro, apenas o desenho foi substituído: construtor, coordenadas de grid, raio de colisão, aceleração, pneus, direção e decisões continuam com o mesmo código. A geração de geometria, suavização e perfis de velocidade da pista também permaneceu idêntica ao código anterior.

Fingerprint SHA-256 da serialização de todos os pontos gerados das 24 pistas, incluindo os atributos calculados: `4b37947beec2d0b072dc39122cd9e34bfb7a1430312af06ce44b8343e6b1c8da`. O teste de apresentação protege esse valor e a imutabilidade dos dados do catálogo.

## Desenho

- Carro GT com carroceria fechada, pintura contrastante, número de grid, vidros, reflexos, faróis, espelhos, difusor e asa. A arte é desenhada em um canvas pequeno uma vez por carro e reaproveitada por `drawImage`; esterço e luzes de freio seguem os valores vivos do carro. Nenhum sprite define física/colisão.
- Materiais de asfalto seco/molhado, brita e grama com pequenas texturas repetidas fixas. O relevo visual foi suavizado para evitar faixas artificiais fortes. A pintura da faixa externa agora vem antes da brita e do escape: antes ela cobria ambos. Nenhuma largura ou coordenada de superfície mudou.
- Placar com cinco linhas DOM persistentes; só os textos/cores necessários mudam. Removido o desfoque do HUD sobre o canvas em movimento.
- Desenho de carros, partículas, marcas de pneus, placas e textos fora da câmera é evitado com margens conservadoras. Todos os carros e partículas continuam sendo atualizados; não se reduziu a quantidade nem a frequência dos bots.
- Um identificador explícito de `requestAnimationFrame` permite cancelar o loop ao voltar ao menu e evitar inícios duplicados enquanto já há uma corrida ativa.

## Largada

Base visual: [guia oficial da Fórmula 1](https://www.formula1.com/en/latest/article/the-beginners-guide-to-the-f1-weekend.5RFZzGXNhEi9AEuMXwo987), que descreve cinco luzes vermelhas sucessivas e o apagamento simultâneo como sinal de largada.

A adaptação do jogo usa cinco pares de luzes, acesos a intervalos de um segundo, seguidos de uma espera variável de 0,2–3 segundos. Essa faixa é uma escolha de apresentação do jogo, não uma afirmação sobre o regulamento atual. Não aparece luz verde. Não foram acrescentadas volta de apresentação, embreagem, penalidades por queima de largada ou novas regras de pilotagem.

Durante o semáforo, jogador e bots ficam no grid original: sem atualização física, aquecimento/desgaste, colisões, replay, coleta de amostras ou avanço dos cronômetros. O apagamento libera todos juntos, zera o acúmulo de tempo anterior e inicia os relógios de corrida/setor no mesmo instante. A lógica de IA permanece a mesma; seu relógio de setor exclui a espera. A variação da espera usa uma fonte separada de `Math.random`, para não consumir a sequência aleatória da simulação.

## Medição local — 04/09/2026

Comparação antes/depois no Edge headless com viewport 1440 × 900; Interlagos, 19 bots profissionais mais jogador; API substituída por resposta vazia somente no navegador de teste; telemetria desativada. Câmera de teste acompanha um bot em movimento sem alterar os controles ou os dados de nenhum carro. Seis segundos de aquecimento após a largada e 18 segundos de coleta. Não reproduz a configuração completa de uso do usuário.

| Medida | Antes desta alteração | Depois |
| --- | ---: | ---: |
| FPS médio | 58,89 | 59,72 |
| Intervalo de quadro p99 | 30,3 ms | 17,6 ms |
| CPU média do callback | 1,347 ms | 0,915 ms |
| CPU p95 | 2,2 ms | 1,5 ms |
| Reconstruções do placar | 1.056 | 0 |
| Chamadas de desenho de texto | 43.501 | 3.622 |
| Chamadas `lineTo` | 63.660 | 0 |
| Chamadas `fill` | 177.238 | 50.735 |

As amostras têm números ligeiramente diferentes de quadros (1.061 e 1.076) e estado aleatório dos bots/efeitos. Os contadores de desenho indicam trabalho evitado, não uma garantia de FPS em outro equipamento. O usuário relatou lag tanto no Chrome quanto no Edge; resolução, hardware e frequência da tela não foram informados. O teste mediu uma melhora de regularidade local, não estabelece eliminação de todo lag.

Validação adicional no **Chrome headless**, no mesmo cenário posterior às alterações: 58,83 FPS, CPU média de 1,083 ms, CPU p95 de 1,7 ms, intervalo de quadro p99 de 31,4 ms, zero reconstruções do placar e 3.747 chamadas de desenho de texto. Ainda houve intervalos pontuais maiores de RAF no Chrome; isso não permite afirmar que toda a irregularidade de apresentação foi eliminada. Não foi coletada uma linha de base anterior no Chrome, portanto não se apresenta ganho antes/depois para esse navegador.

## Validações

- `npm run test:ml22:gate`: 303 testes e build.
- `node scripts/test_paddock.js`: 28 testes.
- `node scripts/test_track_presentation.js`: 12 testes.
- `node scripts/test_race_presentation.js`: 9 testes (luzes/tempos/cancelamento, RNG separado, geometria, arte sem mutação, cache e DOM persistente).
- `scripts/test_race_start.browser.js`: 16 verificações aprovadas tanto no Edge quanto no Chrome, cobrindo 20 carros imobilizados, todos os estágios, liberação, cronômetros, comandos antes/depois, cancelamento e ausência de loop duplicado. Sessões limpas sem erros de página.
- O catálogo passou nas 19 verificações de `scripts/test_track_picker.browser.js`, incluindo troca de circuito e modo ghost.
- Composição da largada inspecionada em 1440 × 900 e 390 × 844; o semáforo permanece dentro da tela. Desfoque computado do HUD: `none`.

Capturas e medição ficam em `artifacts/race-visuals/`, ignorado pelo Git. Nenhuma dependência, recurso cloud, commit ou push foi criado nesta alteração.
