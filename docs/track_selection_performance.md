# Seleção de circuitos e custo de renderização

## Escopo

- Catálogo visual dos 24 circuitos, com traçados reais do catálogo existente, extensão e desnível.
- Busca por nome oficial/apelido, cidade ou país, sem diferenciar acentos e maiúsculas.
- Filtro de oito destaques, indicação da seleção, recuperação de busca vazia e layout responsivo.
- Diálogo nativo: foco na busca ao abrir, Escape para voltar e retorno do foco ao botão de origem.
- O `trackSelect` original continua sendo a fonte de verdade para `startGame`; a seleção visual dispara seu evento `change`. O select nativo só é ocultado depois da inicialização do catálogo.
- Não foram alterados física, controles, câmera, decisões da IA, colisões, geração da pista, número de bots ou frequência da simulação (60 Hz).
- Sem dependências novas, commit, push ou deploy.

## Otimizações estritamente visuais

1. `renderGeometry.js`: cinco `Path2D` por geometria da pista, reaproveitados para asfalto, limites e guardrails. Todos os pontos são mantidos, sem simplificação de curvas. O cache usa `WeakMap`, muda quando a pista/largura/tipo de barreira muda e não modifica os pontos da simulação.
2. `track.js`: deixa de emitir comandos de desenho para zebras, relevo e postes totalmente fora da câmera. Os limites usam os quatro cantos inversamente transformados, incluindo rotação e offset vertical de 50 px, com margem conservadora. Não afeta atualizações ou colisões dos carros, nem remove detalhes visíveis.
3. `minimap.js`: projeção e traçado calculados uma vez por pista, com posição relativa para acompanhar redimensionamento. Os marcadores de jogador, bots e ghost continuam atualizados a cada quadro.
4. `ui.js`: evita reescrever textos/placar idênticos. Nenhuma redução de frequência das informações do HUD.

## Evidências locais — 04/09/2026

Edge headless, viewport 1440 × 900, Interlagos (2.869 pontos), 19 bots + jogador, seco, dificuldade profissional, transmissão manual, jogador sem acelerar. Telemetria online desativada; backend legado indisponível na linha de base e respostas locais vazias na verificação posterior. Dois intervalos de 12 segundos, com temporização de `Car.update`/`Car.draw` igual nas duas amostras:

| Métrica | Antes | Depois |
| --- | ---: | ---: |
| CPU média dentro do callback de quadro | 9,048 ms | 0,959 ms |
| CPU do quadro, percentil 95 | 10,4 ms | 1,3 ms |
| Atualizações de carros no intervalo | 14.440 | 14.420 |
| FPS médio entregue pelo navegador | 60,00 | 56,92 |

O custo de CPU medido caiu aproximadamente 89%. **Isso não é uma medição de ganho de FPS:** a amostra posterior teve intervalos esporádicos maiores de RAF (p99 de 49,9 ms), apesar do callback mais curto. Escalonamento do navegador, rasterização, GC e carga da máquina não são isolados por essa métrica. Não foi reproduzida uma queda contínua de FPS nesta máquina e não há promessa de eliminar todo lag em outros dispositivos.

Uma segunda amostra posterior de 12 segundos, numa sessão de instrumentação nova e sem wrappers de `Car.update`/`Car.draw`, confirmou CPU média de 0,959 ms, 59,67 FPS e RAF p99 de 16,8 ms. O fluxo do seletor foi repetido nessa sessão: 19 verificações aprovadas e nenhum erro de página registrado.

Benchmark isolado de desenho, cena parada e zoom 6, três lotes de 120 chamadas:

- Pista antes: 11,101 / 10,555 / 10,531 ms por chamada.
- Pista depois: 1,979 / 2,093 / 1,847 ms por chamada.
- Minimapa antes: 0,065 / 0,079 / 0,074 ms; depois: 0,013 / 2,423 / 0,013 ms (um lote posterior teve um outlier; não foi descartado).
- HUD antes: 0,032 / 0,033 / 0,035 ms; depois: 0,013 / 0,008 / 0,007 ms.

O benchmark isolado mede submissão repetida de comandos, não uma corrida completa nem FPS.

## Validação

- `npm run test:ml22:gate`: 303 testes aprovados e build aprovado.
- `node scripts/test_paddock.js`: 28 testes aprovados.
- `node scripts/test_track_presentation.js`: 12 testes aprovados, incluindo busca, preservação dos dados, invalidação dos caches, contornos exatos, câmera rotacionada e marcadores dinâmicos.
- `scripts/test_track_picker.browser.js`: 19 verificações aprovadas no navegador, incluindo busca, filtros, foco, escolha de Spa, corrida com 19 bots, troca para Monaco e contrarrelógio.
- Escape real testado: fecha o diálogo, atualiza `aria-expanded` e restaura foco.
- Catálogo inspecionado em 1440 × 900 e 390 × 844. Axe no diálogo: zero violações reportadas; três elementos pequenos/ícone exigiram inspeção manual de contraste.
- Comparação com o renderizador anterior (`8082823`): Interlagos, Spa, Monaco e Monza; seco/molhado; três posições por circuito. **24 cenas com zero pixels diferentes na pista.** Minimapa estático: 36 pixels com diferença máxima de 4/255, compatível com arredondamento da projeção; nenhum pixel acima de 16/255.

Capturas e scripts temporários de comparação estão em `artifacts/track-picker/` (ignorado pelo Git). A comparação visual importou cópias do renderizador anterior apenas para o navegador de teste; o jogo não contém dois renderizadores.

### Repetir os testes do seletor

1. Iniciar o Vite local e abrir uma página nova. Reiniciar o Vite após edições se for instrumentar módulos por `import()`; versões HMR com timestamps podem criar instâncias diferentes do estado na instrumentação.
2. Executar `scripts/test_track_picker.browser.js` com `agent-browser eval --stdin` no contexto dessa página. O teste usa fixtures de API somente nessa página e restaura `fetch` ao terminar.
3. Conferir o catálogo, selecionar outra pista, iniciar a corrida e testar Escape no teclado. Não habilitar telemetria para esse teste de apresentação.
