# Tração traseira e ritmo reduzido

O motor já consumia a aderência do eixo traseiro. Esta revisão torna a perda desse eixo efetiva: demanda lateral considera também a deriva na posição das rodas traseiras; saturação por força motriz ou carga lateral aumenta o estado de derrapagem. A perda reduz a sustentação traseira e a estabilização automática de giro. O sentido da reação usa a deriva do eixo, não apenas a tecla pressionada: contraesterço não apaga instantaneamente a rodada.

O estado de derrapagem recupera gradualmente. Ângulo efetivo, velocidade angular e ganho em baixa velocidade são limitados para evitar giro sem fim quando o carro para. Acelerar reto não introduz um giro arbitrário. A física é compartilhada com os bots, sem alteração de suas decisões.

Força por marcha reduzida, principalmente nas baixas, e relações encurtadas. O corte de força do motor ocorre em 1.14 m/tick (~241 km/h na escala existente); não é um clamp de velocidade para colisões ou descidas. Não foram modificados traçados, geração de geometria, perfis de velocidade das pistas, câmera ou filtro de direção. Recordes antigos são preservados, mas não representam tempos obtidos sob a nova física.

Validação: `node scripts/test_corner_traction.js`, `node scripts/test_ml22_final.js`, `node scripts/test_session_controls.js`, `npm run test:ml3:inventory` (somente teste local do inventário existente), `npm run test:ml22:gate` e build. O script `scripts/test_rwd_physics.browser.js` executa `Car.update` no navegador com uma pista plana de teste, sem rede/telemetria/recordes: reta, limite do motor, sobrecarga no molhado, simetria, contraesterço, carro parado e equivalência de motor do jogador/bot. Não substitui avaliação humana da sensação de pilotagem.

Lineage atualizada para `0.4.0-ml2` / `1.6.0-gt3-rwd`. O baseline histórico permanece separado; sem publicação cloud nem modificação de dados históricos.

Resultado local: 315 verificações do gate, 31 de lineage, 25 do inventário, 8 de controles, 9 de apresentação e 6 de tração aprovadas; build aprovado. No Chromium: 7 verificações da física real em fixture e 16 da largada normal com 19 bots aprovadas. Na fixture plana a máxima observada foi 241 km/h (estabilizando perto de 240); a sobrecarga no molhado ultrapassou 90 graus entre velocidade e orientação, enquanto a recuperação controlada terminou com derrapagem e giro próximos de zero. Os cenários não são uma homologação de desempenho/FPS nem de sensação humana.
