# Embalo pós-boost, contraesterço e instrumentos compactos

## Alterações

- Mantidos os limites de 320 km/h normal, 400 km/h com boost e 50 km/h de ré.
- Ao encerrar um boost acima da máxima normal, o carro preserva o embalo com menor resistência no asfalto. A perda volta progressivamente ao padrão na faixa dos últimos 20 km/h acima do limite. Não há corte instantâneo da velocidade nem energia de boost extra.
- O benefício exige embalo previamente obtido usando boost; frear, entrar em outra superfície, andar de ré ou voltar ao limite normal o cancela. Carga, recarga e regras de ativação permanecem.
- Contraesterço no sentido correto da deriva recupera autoridade do eixo dianteiro e reduz o crescimento do giro. Não alinha a velocidade à pista nem remove a derrapagem. Assistência desaparece em ângulos extremos: uma correção tardia ainda pode terminar em rodada.
- Grip base, perda de grip traseiro, limites de giro, força do motor, vácuo e coordenadas dos 24 circuitos preservados. Nenhuma alteração na lógica de IA.
- Velocidade e marcha menores; removido o bloco lateral do boost e posicionada sua barra imediatamente abaixo de RPM, com a mesma largura e indicação de carga/estado.

## Validação

- `node scripts/test_boost_gravel.js`: 15 verificações, incluindo liberação real após boost, embalo acima de 320, desaceleração gradual, freio e brita sem enfraquecimento.
- `node scripts/test_drift_recovery.js`: quatro verificações; recuperação no seco/molhado, entradas digitais de teclado, simetria, ausência de correção instantânea e drift sustentado com comandos dosados.
- `node scripts/test_ml22_final.js`: 35 verificações de lineage/fingerprint.
- Tração, vácuo, grid e apresentação/renderização também passaram.
- Navegador: 11 verificações de física RWD, 13 de boost/ESC/reinício e 15 de HUD em 1264×625; 16 em 390×844, incluindo ausência de sobreposição do atalho de reinício. Capturas locais em `artifacts/drift-hud-desktop.png` e `artifacts/drift-hud-mobile.png`.
- Gate ML2.2: 315 verificações e build de produção aprovados. Evidência local, sem benchmark novo de FPS, publicação ou homologação cloud.

O ajuste permite recuperação/drift nos cenários testados; o conforto e o tempo de reação devem ser avaliados jogando. O módulo online não foi iniciado nesta revisão. Sem commit/push, alteração de login ou ML3.
