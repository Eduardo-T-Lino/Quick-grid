# 320 km/h, manobra na brita e boost

## Velocidade

O motor usa `GT3_TOP_SPEED = 1.35 * 320 / 285`, mantendo a conversão e os perfis das pistas intactos. Sexta marcha estendida para 1.72; potência normal e marchas 1–5 preservadas. A força positiva é limitada pela margem até 320 km/h. Colisões e descidas não têm velocidade truncada artificialmente.

## Brita

A combinação anterior de resistência de 12% por tick e amortecimento angular proporcional à velocidade sufocava o giro de manobra. A resistência passa de 1,5% em baixa velocidade para os mesmos 12% em velocidade alta. Somente na brita, abaixo de 0.18 unidades/tick, há transição suave para direção cinemática e mais esterço: o carro acompanha as rodas enquanto avança, mas não gira sozinho parado. Aderência continua baixa, e a brita continua desacelerando fortemente quem sai da pista em alta velocidade. Não muda o traçado nem a direção no asfalto.

## Boost do jogador

- Segurar **Espaço + W**, no asfalto, durante a corrida, sem frear.
- Multiplicador de 1,55 na força solicitada ao motor. Passa pelo controle de tração e limite dos pneus traseiros, sem aplicar velocidade diretamente ou aderência extra.
- Carga cheia dura até 3 segundos. Soltar Espaço inicia uma espera de 2 segundos, seguida de até 12 segundos para recarregar por completo.
- Pode reativar a partir de 20%. Ao esgotar, precisa soltar Espaço; não há pulsos infinitos segurando a tecla.
- Limite normal de 320 km/h e limite próprio de 350 km/h com boost. Ao soltar, a velocidade cai gradualmente. Não funciona na brita/zebra/escape, sem acelerador, freando ou antes do semáforo liberar.
- Pausa congela consumo e recarga; perder foco limpa teclas e pausa o jogo. Reinício cria uma carga nova.
- HUD exibe carga e estado; guia de controles explica o comando. Sem efeitos de partículas adicionais.
- Nesta versão é uma assistência manual do jogador; decisões dos bots não foram alteradas.

## Validação

`node scripts/test_boost_gravel.js` exercita a integração real de `Car.update()` em pistas sintéticas: máxima, aceleração extra, bloqueios, simetria, giro parado, saída da brita seca/molhada e desaceleração em alta velocidade. Há testes adicionais de navegador para teclado/HUD/pausa/reinício. Testes automatizados não substituem avaliação humana de pilotagem.

O novo fingerprint separa esta revisão dos dados antigos. O schema legado de ações não descreve boost: não misturar automaticamente sessões desta versão com demonstrações de treino anteriores.
