# Configuração de corrida — revisão visual

O painel usa cartões de escolha para formato (corrida/contrarrelógio), condição, transmissão e adversários. As opções ficam visíveis, com ícones, marcação de seleção e navegação por setas, Home/End e Tab. Os valores e eventos dos selects originais continuam sendo a fonte da configuração do jogo.

A dificuldade usa um seletor maior, com descrição e indicador de nível em cada opção. O menu abre acima ou abaixo conforme o espaço disponível. Enter confirma, Escape fecha sem alterar e Tab segue para o próximo controle.

A distância da corrida reúne campo numérico, botões +/−, barra de ajuste e atalhos de 3, 10, 20, 40 e 80 voltas. Continua aceitando todos os inteiros de 3 a 80. O painel mostra também a distância total em quilômetros para a pista selecionada. Alterar um controle sincroniza os outros.

O cartão de circuito e a busca do catálogo acompanham o acabamento dos demais inputs. A coluna de configuração ficou mais larga em desktop; os grupos se adaptam a telas estreitas. Não há alteração na física, IA, pistas, recordes ou regras de corrida nesta revisão.

Validação: build, testes existentes de paddock e controles, e roteiro de navegador `scripts/test_session_controls.browser.js` atualizado para os cartões e o ajuste de voltas. A revisão visual cobre desktop, tela de 390 px e menu de dificuldade próximo à borda inferior. Capturas temporárias ficam em `artifacts/`.
