# Menus, recordes e controle de sessão

Os seletores de modo, transmissão, condição, adversários e dificuldade usam listas estilizadas com navegação por teclado (setas, Home/End, Enter, Escape e Tab). Os selects originais continuam sendo a fonte dos valores e eventos. A escolha de pista mantém o catálogo existente.

O número de voltas aceita qualquer inteiro entre 3 e 80, por digitação ou pelos botões +/−. O limite é aplicado tanto na interface como na criação da corrida e no reinício.

A aba Recordes apresenta os tempos salvos neste navegador por circuito e número de voltas, com busca, milissegundos e estado vazio. Preserva os registros antigos de 1 e 2 voltas. Corridas comuns não precisam de uma trajetória de fantasma para que seu tempo seja reconhecido na próxima sessão. A aba não representa um ranking global.

Esc pausa/retoma; R abre a confirmação de reinício com as configurações da corrida atual. Se o reinício for cancelado a partir da pausa, volta ao menu de pausa. Se for aberto durante a corrida, cancelar retoma a corrida. Reiniciar preserva recordes e recria o grid e a sequência de luzes. Perder o foco pausa automaticamente.

Pausar cancela a animação do jogo e congela os carros, efeitos, fantasmas e amostragem. Ao retomar, compensa os relógios de volta/corrida, setores dos bots, resumos de telemetria, largada e prazo de chegada. Redimensionar durante a pausa redesenha a pista sem avançar esses estados.

Direção: a entrada humana passa de uma interpolação fixa de 0,10 por tick para 0,085 em baixa e 0,060 em alta velocidade. O limite de esterço humano varia de 100% em baixa a 88% em alta; retorno ao centro permanece em 0,12. Os comandos dos bots e o modelo de aderência permanecem iguais. A sensação final deve ser avaliada pilotando com o teclado.

Desempenho: a busca da superfície compara distâncias ao quadrado e extrai apenas uma raiz no fim. Foram comparadas 4.800 consultas nas 24 pistas com a versão anterior, preservando segmento, projeção e distância com tolerância de 1e-9. Em sete rodadas alternadas de 20.000 consultas, a mediana foi de 46,88 ms para 15,50 ms (aproximadamente 67% menos tempo **nessa operação**, não uma promessa de aumento equivalente no FPS). O carregamento de recordes e dados de bots agora ocorre em paralelo.

Visual: gramado com faixas de corte, materiais de asfalto ajustados, zebras com relevo, pintura lateral, marcas de borracha, árvores e arquibancadas. A decoração é determinística e pintada nos tiles existentes; não consome o RNG de corrida. As coordenadas e o perfil de velocidade dos 24 circuitos mantêm o fingerprint anterior. O limite do cache permanece em 64 superfícies.

Verificação: `npm run test:ml22:gate`, `node scripts/test_session_controls.js`, `node scripts/test_track_distance.js`, suítes existentes de apresentação/renderização e `npm run build`. O roteiro `scripts/test_session_controls.browser.js` roda em um preview local com agent-browser, usa fixtures de API e cobre os menus, pausa na largada/corrida, prazo de chegada, reinício, telemetria local e fantasmas. Screenshots de revisão ficam em `artifacts/` (ignorado pelo Git).

Resultado em 08/09/2026: gate com 303 testes aprovados; 83 verificações de apresentação/renderização e controles aprovadas; comparação das 4.800 consultas aprovada; build aprovado. Os 35 cenários de navegador passaram em Chromium e Microsoft Edge. Esc/R também foram exercitados com eventos reais de teclado. Layout revisado em 1440×1000 e 390×844, sem overflow horizontal do menu.
