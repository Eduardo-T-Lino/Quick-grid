# Fundação de Telemetria para Machine Learning (ML1) — Quick-grid

## 1. Propósito do Sistema

O módulo de telemetria ML do Quick-grid foi projetado para capturar pares de alta fidelidade:
$$\text{OBSERVATION STATE} \implies \text{DRIVER ACTION}$$

Permite construir datasets padronizados de **Imitation Learning (Behavioral Cloning)** a partir de voltas pilotadas por humanos (Player) ou pelo baseline determinístico (Bots), aprendendo a mapear o estado físico e geométrico do carro diretamente para os comandos dos atuadores:
$$\text{State}(t) \longrightarrow (\text{steering}, \text{throttle}, \text{brake})$$

---

## 2. Estrutura Modular dos Arquivos

```
src/
  ml/
    telemetry/
      telemetrySchema.js     # Validação de integridade, ranges e factory de samples V1
      telemetrySession.js    # Gerenciador de sessão, ring buffer e resumos de voltas
      telemetryCollector.js  # Timer de amostragem a 10 Hz fixos e lookup de curvaturas físicas
      telemetryExport.js     # Serializador JSONL e utilitário de download no browser
      index.js               # Ponto de entrada e bindings no window
```

---

## 3. Tabela de Features e Unidades Físicas Reais (Schema V1)

| Grupo | Campo | Tipo | Unidade Real | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| **Metadata** | `schemaVersion` | `number` | inteiro (1) | Versão do schema de telemetria |
| | `sessionId` | `string` | texto | Identificador único e anônimo da sessão ativa |
| | `sampleIndex` | `number` | inteiro (0+) | Índice sequencial da amostra na sessão |
| | `timestamp` | `number` | milissegundos | Relógio de alta precisão da simulação (`performance.now()`) |
| | `trackId` | `number` | ID F1 | ID do circuito (ex: `21` = Interlagos, `14` = Spa) |
| | `lapNumber` | `number` | inteiro (1+) | Número da volta atual do participante |
| | `driverType` | `string` | `'PLAYER'` \| `'BOT'` | Categoria do piloto gerador do dado |
| | `participantId` | `string` | texto anônimo | Nome do piloto no grid (ex: `'A. Senna'`) |
| **Track State** | `trackProgress` | `number` | $[0.0, 1.0]$ | Progresso percentual relativo ao longo da volta |
| | `pathIndex` | `number` | índice | Índice do ponto mais próximo na malha da pista |
| | `currentCurvature` | `number` | $\text{rad/m}$ | Curvatura geométrica física instantânea ($\kappa = \|\Delta \theta\| / \Delta s$) |
| | `futureCurvature5m` | `number` | $\text{rad/m}$ | Curvatura física no ponto a **+5 metros reais** à frente |
| | `futureCurvature10m` | `number` | $\text{rad/m}$ | Curvatura física no ponto a **+10 metros reais** à frente |
| | `futureCurvature20m` | `number` | $\text{rad/m}$ | Curvatura física no ponto a **+20 metros reais** à frente |
| | `futureCurvature40m` | `number` | $\text{rad/m}$ | Curvatura física no ponto a **+40 metros reais** à frente |
| | `targetSpeed` | `number` | $\text{m/frame}$ (a 60 Hz) | Limite analítico seguro de velocidade ($1.35 \text{ m/frame} \approx 285 \text{ km/h}$) |
| | `distanceToLeftEdge` | `number` | metros | Distância física perpendicular até a borda esquerda do asfalto |
| | `distanceToRightEdge`| `number` | metros | Distância física perpendicular até a borda direita do asfalto |
| | `surface` | `string` | enum | Superfície atual: `'TARMAC'`, `'KERB'`, `'RUNOFF'`, `'GRAVEL'` |
| **Car State** | `speed` | `number` | $\text{m/frame}$ | Velocidade escalar interna ($1.0 \text{ m/frame} \approx 216 \text{ km/h}$) |
| | `forwardVelocity` | `number` | $\text{m/frame}$ | Velocidade no eixo longitudinal do veículo |
| | `lateralVelocity` | `number` | $\text{m/frame}$ | Velocidade no eixo transversal do veículo |
| | `heading` | `number` | radianos | Ângulo de guinada do carro no espaço de mundo $[-\pi, \pi]$ |
| | `headingError` | `number` | radianos | Diferença angular entre a orientação do carro e a tangente da pista |
| | `yawRate` | `number` | $\text{rad/frame}$ | Taxa de rotação angular instantânea |
| | `slipAngle` | `number` | radianos | Ângulo de deriva ($\text{atan2}(v_{lat}, |v_{fwd}| + 0.001)$) |
| | `crossTrackError` | `number` | metros | Desvio lateral em relação à linha de referência |
| | `steeringAngle` | `number` | $[-1.0, 1.0]$ | Posição física atual das rodas dianteiras |
| **Driver Action** | `steering` | `number` | $[-1.0, 1.0]$ | **Label ML:** Comando de esterço consumido pela física |
| | `throttle` | `number` | $[0.0, 1.0]$ | **Label ML:** Comando de acelerador consumido pela física |
| | `brake` | `number` | $[0.0, 1.0]$ | **Label ML:** Comando de freio consumido pela física |
| **Event State** | `offTrack` | `boolean` | `true`/`false` | Indicador de saída de pista (zebra/brita/runoff) |
| | `collision` | `boolean` | `true`/`false` | Indicador de contato físico com outro veículo |
| | `spin` | `boolean` | `true`/`false` | Indicador de rodada ($|slipAngle| > 0.40 \text{ rad} \approx 23^\circ$) |
| | `isRecovering` | `boolean` | `true`/`false` | Indicador de veículo em retorno à pista |

---

## 4. Frequência de Amostragem (10 Hz) e Independência de FPS

- **Período de Amostragem:** $100\text{ ms}$ fixos ($10\text{ Hz}$).
- **Mecanismo de Acumulador Temporal:** Em vez de depender do número de frames renderizados, o `TelemetryCollector` utiliza o relógio de simulação (`performance.now()`) com acumulador residual:
  - Em 30 FPS $\implies$ 10.0 Hz (~101 samples em 10s).
  - Em 60 FPS $\implies$ 10.0 Hz (~101 samples em 10s).
  - Em 144 FPS $\implies$ 10.0 Hz (~101 samples em 10s).
- **Custo Computacional Zero:** Quando `enabled === false` (padrão em produção), o loop executa uma única checagem booleana em $O(1)$ sem alocação de memória ou chamadas de função.

---

## 5. Curvatura Futura em Metros Físicos e Tratamento de Wrap

- As features `futureCurvature5m`, `futureCurvature10m`, `futureCurvature20m` e `futureCurvature40m` **acumulam a distância física real** ($\sum segmentLength$) a partir da posição do carro.
- **Tratamento de Wrap na Linha de Chegada:** Ao cruzar o último ponto da pista ($idx = N - 1$), o algoritmo continua acumulando a distância a partir do ponto $idx = 0$, inspecionando corretamente as primeiras curvas da volta seguinte (ex: 'S' do Senna / Curva 1).

---

## 6. APIs de Desenvolvimento (Console do Browser)

| Comando | Descrição |
| :--- | :--- |
| `window.startMLTelemetry({ scope: 'PLAYER_ONLY' })` | Inicia a gravação de telemetria com escopo (`'PLAYER_ONLY'`, `'BOT_ONLY'`, `'ALL'`) |
| `window.stopMLTelemetry()` | Pausa/encerra a gravação ativa |
| `window.getMLTelemetryStats()` | Exibe estatísticas de memória, contagem de samples e voltas |
| `window.exportMLTelemetry(trackId)` | Dispara o download dos arquivos `.jsonl` de telemetria e `.json` de resumos de volta |
| `window.clearMLTelemetry()` | Limpa a memória do buffer de telemetria |

---

## 7. Estimativa de Volume de Dados e Política de Buffer

- **Tamanho Médio por Amostra JSONL:** $\approx 805\text{ bytes/sample}$.
- **Taxa por Piloto (10 Hz):** $10\text{ samples/s} = 600\text{ samples/min} = 36.000\text{ samples/hora}$.
- **Volume Horário (1 Player):** $\approx 27.64\text{ MB/hora}$.
- **Volume Horário (Grid Completo de 20 Carros):** $\approx 552.88\text{ MB/hora}$.
- **Política de Ring Buffer:** Limite padrão em memória de $30.000\text{ samples}$ ($\approx 50\text{ minutos}$ de gravação contínua para 1 carro). Ao atingir o limite, os dados mais antigos são descartados progressivamente, prevenindo qualquer vazamento de memória.
