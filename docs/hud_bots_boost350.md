# HUD, bots e boost 350

- Motor normal limitado a 320 km/h; boost pode alcançar 350 km/h, com sexta marcha alongada. A força positiva usa o teto ativo. Ao soltar ou esgotar, não há truncamento instantâneo da velocidade; arrasto e resistência desaceleram o carro.
- Permanecem duração de 3 s, espera de 2 s, recarga de 12 s, ativação com 20% e os bloqueios de superfície/freio/pausa.
- Cadastro aceita de 6 a 128 caracteres, inclusive senha formada por seis números. Login existente continua compatível com senhas longas. Reduzir o mínimo enfraquece a proteção de senhas curtas; interface recomenda usar uma senha longa. Scrypt, salts, limites de tentativa e sessões HttpOnly foram preservados.
- HUD: velocidade e marcha maiores, contraste reforçado, painel de boost destacado, classificação e dados de volta organizados. Leituras de pneus e TC/ABS permanecem no painel; mensagens flutuantes de perda de aderência foram removidas. Minimapa se adapta à largura disponível sem mudar a pista.
- Bots: mesmo componente visual das voltas, com valor numérico, botões −/+, slider e presets 1/3/7/12/19. Todos os inteiros de 1–19 são válidos. Contrarrelógio desabilita os controles e continua com somente o jogador; o valor anterior é preservado para voltar à corrida.
- Testes locais: `test_boost_gravel.js`, `test_auth.js`, `test_auth.browser.js`, `test_hud_bots.browser.js`, regressão ML2.2, testes de apresentação, desempenho e controles. Cadastro em navegador usa backend temporário isolado; não comprova persistência PostgreSQL ou deploy cloud.
