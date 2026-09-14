# Vácuo, aderência e aceleração

- Aderência básica 0.052 → 0.047 (~9,6% menor); mantém pneus, chuva e tração traseira.
- Força do motor por marcha parcialmente restaurada: +29–43% sobre a revisão RWD anterior. Não retorna à aceleração inicial. Teto de força do motor continua em ~241 km/h na escala existente.
- Carros visualmente 10% maiores, incluindo rodas e luzes. Sem alteração do raio de colisão, grid ou traçado.
- Esteira aerodinâmica comum a jogador e bots: depende de velocidade, direção, distância e deslocamento lateral. Até 70 m, com atenuação lateral/longitudinal e filtro temporal; carros parados, concluídos, em sentido contrário ou com grande diferença de altura não geram benefício.
- O maior efeito individual é usado, sem soma ilimitada num pelotão. Atualização antes de integrar qualquer carro, evitando dependência da ordem do grid. Pausa e largada não avançam o filtro.
- No máximo teórico, reduz 28% do arrasto aerodinâmico e 40% da parcela aerodinâmica da aderência. Não remove 40% de toda a aderência nem aumenta potência. Não altera o limitador do motor. O HUD mostra vácuo e perda de carga aero; sair da esteira recupera gradualmente o ar limpo.

Referência conceitual: a turbulência de outro carro prejudica a carga aerodinâmica ([glossário oficial da F1](https://www.formula1.com/en/latest/article/f1-glossary-a-e.1MFONigMlQSbSQtpP7YCy2)). Os coeficientes acima são escolhas de gameplay, não medições de um GT3 real.

Verificação: `npm run test:wake` (7 verificações), testes de tração e apresentação, gate ML2.2 e build. `scripts/test_rwd_physics.browser.js` tem 10 verificações com `Car.update` real: aceleração parcialmente restaurada, redução de arrasto aumentando a velocidade em reta, perda de carga aumentando derrapagem na mesma condição de curva, rodada, recuperação e comportamento idêntico de motor para jogador/bot. Traçados e perfis das 24 pistas continuam passando no fingerprint anterior. O custo da busca é limitado ao grid atual (20 carros); não foi medido um novo benchmark de FPS.

Runtime `0.5.0-ml2`, física `1.7.0-gt3-wake`. Baseline histórico de dados preservado separadamente; sem publicação nem reclassificação dos dados anteriores.
