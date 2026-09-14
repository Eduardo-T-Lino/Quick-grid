# Controles personalizados

Abra **Controles** no menu inicial, **Configurar controles** no menu de pausa ou **CONTROLES** dentro da sala online.

1. Escolha o layout **WASD** ou **SETAS**, ou clique na tecla da ação que deseja alterar.
2. Pressione uma tecla. ESC cancela a captura; teclas duplicadas e atalhos reservados são recusados.
3. Clique em **SALVAR CONTROLES**. Fechar sem salvar descarta o rascunho.
4. **Restaurar padrão** prepara o layout original; salve para confirmar.

Personalizáveis: acelerar, frear/ré, esquerda, direita, boost, subir e reduzir marcha. No layout de setas, E/Q controlam as marchas. No WASD original, ←/→ continuam como alternativas de direção, salvo quando explicitamente atribuídas a outra ação. ESC e R são reservados aos menus. A troca manual só funciona com transmissão manual.

As preferências ficam no armazenamento local deste navegador/origem, não na conta nem no servidor. Outra máquina/perfil configura suas próprias teclas; abas da mesma origem compartilham a preferência salva, mas a configuração ativa de uma aba não é alterada durante uma corrida por outra aba. Se o armazenamento estiver bloqueado, as escolhas funcionam só até recarregar. Não precisa de login. Suporte a teclado; gamepad, volante, mouse e toque não fazem parte desta alteração.

As teclas são identificadas por posição física (`KeyboardEvent.code`). As dicas do menu e do boost acompanham as escolhas. Física, força da direção, IA, coordenadas, limites de velocidade e protocolo da corrida não foram recalibrados. O cliente converte as teclas físicas para os comandos canônicos existentes; o servidor continua recebendo apenas comandos de pilotagem e calculando a corrida.

Abrir controles na pausa mantém o offline pausado. No online, abrir menus solta os comandos, mas não pausa os outros jogadores. Capturar uma tecla nunca dirige, muda marcha ou reinicia a partida. Ao voltar, é necessário pressionar os comandos novamente.

## Validação local

- `npm run test:controls`: 10 testes de validação, persistência/fallback, atalhos reservados, teclas duplicadas, tradução para física, liberação de comandos e marchas online/offline.
- `node scripts/test_controls_browser.js`: 20 verificações no Chromium, com prévia em `127.0.0.1:5185`, incluindo recarregar preferências, perfis independentes, captura real de teclado, HUD, pausa, presets, boost e marcha remapeados em WebSocket real. Sem autenticação ou telemetria ML.
- `npm run test:ml22:gate`: 343 testes aprovados e build aprovado.
- Regressão de navegador existente: online e boost offline, 17 + 13 verificações.
- Diálogo inspecionado em desktop e em 390 × 844, sem overflow horizontal. Navegadores usados nos testes são isolados e descartados.
