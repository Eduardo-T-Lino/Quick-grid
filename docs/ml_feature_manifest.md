# 📋 ML FEATURE MANIFEST — BEHAVIORAL CLONING MODEL V1

**Quick-grid Machine Learning Telemetry Foundation**  
**Versão do Schema Homologado:** `Schema V2 (Causal Standard: Observation(t) -> Action(t))`

---

## 1. Visão Geral

Este documento define o manifesto oficial de features e rótulos para o primeiro modelo de **Imitation Learning / Behavioral Cloning (BC)** do Quick-grid.

O objetivo do modelo é aprender a mapear a observação do estado instantâneo do veículo e da geometria da pista diretamente para os comandos de controle:

$$\pi_\theta: \text{Observation}(t) \longrightarrow \text{Action}(t) = (\text{steering}, \text{throttle}, \text{brake})$$

---

## 2. Rótulos de Treinamento (Target Action $A_t$)

O modelo treinado deve prever 3 saídas contínuas normalizadas:

| Ação | Tipo | Faixa Válida | Descrição |
| :--- | :--- | :--- | :--- |
| **`driverAction.steering`** | Contínuo | `[-1.0, 1.0]` | Comando de esterço do volante (-1 = esquerda total, +1 = direita total) |
| **`driverAction.throttle`** | Contínuo / Binário | `[0.0, 1.0]` | Posição do pedal de acelerador |
| **`driverAction.brake`** | Contínuo / Binário | `[0.0, 1.0]` | Posição do pedal de freio |

### 2.1. Recomendações de Treinamento (Fase ML1.5 Quality Gate)

1. **`STEERING` (Esterço do Volante)**:
   - **Target de Regressão Contínua**: Deve ser treinado via função de perda contínua (ex: MSE, Smooth L1 Loss ou Huber Loss). Mesmo com entradas via teclado, o filtro de rampa de esterço (`TAXA_ESTERCO_SUBIDA` / `TAXA_ESTERCO_RETORNO`) introduz suavização e dinâmica contínua.
2. **`THROTTLE` & `BRAKE` (Acelerador e Freio)**:
   - **Assinatura de Entrada (Teclado vs Analógico)**:
     - No dataset humano inicial (teclado), os labels de acelerador e freio são predominantemente binários ($\{0.0, 1.0\}$) com forte desbalanceamento (>80% full throttle, ~1% freio ativo).
     - **Recomendação para Modelagem (ML3 / Backend)**:
       - Avaliar arquiteturas com **Heads Classificatórias / BCE Loss (Binary Cross-Entropy)** com ponderação de classes (pos_weight / focal loss) para freio/acelerador de teclado;
       - OU utilizar **Heads de Regressão com Amostragem Ponderada / Resampling** caso suporte a controles analógicos (gamepad/volante) seja expandido.
   - **Labels Intactos**: Os dados brutos gravados na telemetria preservam estritamente o valor real acionado pelo piloto humano (sem inventar throttle parcial ou suavizar brake artificialmente no dataset).

---

## 3. Features de Entrada do Modelo V1 ($\text{Observation}_t$)

### 3.1. Features INCLUÍDAS no Treinamento Inicial

| Feature | Origem | Categoria | Faixa Típica | Função no Aprendizado |
| :--- | :--- | :--- | :--- | :--- |
| `carState.speed` | Físico | RAW PHYSICS | `[0.0, 1.45]` m/f (~0 a 300 km/h) | Magnitude da velocidade escalar do carro |
| `carState.forwardVelocity` | Físico | RAW PHYSICS | `[-0.2, 1.45]` m/f | Velocidade longitudinal no referencial do carro |
| `carState.lateralVelocity` | Físico | RAW PHYSICS | `[-0.4, 0.4]` m/f | Velocidade transversal de escorregamento |
| `carState.yawRate` | Físico | RAW PHYSICS | `[-0.15, 0.15]` rad/f | Velocidade angular de rotação em torno do eixo Z |
| `carState.slipAngle` | Físico | DERIVED PHYSICS | `[-0.4, 0.4]` rad | Ângulo de deriva ($\text{atan2}(v_{\text{lat}}, \|v_{\text{fwd}}\|)$) |
| `carState.steeringAngle` | Físico | RAW PHYSICS | `[-1.0, 1.0]` | Ângulo atual da direção/volante herdado |
| `carState.crossTrackError` | Geométrico | DERIVED PHYSICS | `[-15.0, 15.0]` m | Desvio lateral em relação à centerline/trajetória ideal |
| `carState.headingError` | Geométrico | DERIVED PHYSICS | `[-π, π]` rad | Erro angular entre o ângulo do carro e a tangente da pista |
| `trackState.distanceToLeftEdge` | Geométrico | TRACK GEOMETRY | `[0.0, 24.0]` m | Distância física até a borda esquerda do asfalto |
| `trackState.distanceToRightEdge` | Geométrico | TRACK GEOMETRY | `[0.0, 24.0]` m | Distância física até a borda direita do asfalto |
| `trackState.currentCurvature` | Geométrico | TRACK GEOMETRY | `[0.0, 0.12]` rad/m | Curvatura física no ponto perpendicular atual |
| `trackState.futureCurvature5m` | Geométrico | TRACK GEOMETRY | `[0.0, 0.12]` rad/m | Curvatura antecipada a 5 metros de distância física |
| `trackState.futureCurvature10m`| Geométrico | TRACK GEOMETRY | `[0.0, 0.12]` rad/m | Curvatura antecipada a 10 metros de distância física |
| `trackState.futureCurvature20m`| Geométrico | TRACK GEOMETRY | `[0.0, 0.12]` rad/m | Curvatura antecipada a 20 metros de distância física |
| `trackState.trackProgress` | Geométrico | TRACK GEOMETRY | `[0.0, 1.0)` | Progresso físico contínuo projetado ao longo da volta ($\text{distanceAlongTrack} / \text{totalTrackLength}$) |
| `trackState.surface` | Categórico | RAW PHYSICS | TARMAC / KERB / RUNOFF / GRAVEL | Tipo de piso sob o veículo (one-hot ou ordinal) |

---

### 3.2. Features EXCLUÍDAS do Treinamento Inicial (V1)

| Feature | Categoria | Motivo da Exclusão |
| :--- | :--- | :--- |
| **`carState.heading`** | RAW PHYSICS | Ângulo absoluto em coordenadas globais de mundo ($0$ a $2\pi$). Não possui invariância de rotação e prejudica a generalização em diferentes pistas. A orientação relativa é 100% capturada por `headingError`. |
| **`trackState.targetSpeed`** | DETERMINISTIC-AI | Limite derivado do planejador determinístico legado. Excluído do modelo V1 para garantir que a rede aprenda pilotagem humana genuína (e não imite o speed planner determinístico). Pode ser testado como feature adicional em ablações posteriores. |
| **`trackState.pathIndex`** | TRACK GEOMETRY | Índice discreto do waypoint. Não possui significado físico contínuo e varia por resolução de malha de pista. Substituído por `trackProgress` físico. |

---

## 4. Versionamento Semântico de Schemas

- **`Schema V1` (Legado / Não Causal):** Registrava $S_{t+1} \to A_t$ (estado após integração física com ação do frame). **REJEITADO PARA TREINAMENTO.**
- **`Schema V2` (Causal Homologado):** Registra $S_t \to A_t$ (snapshot atômica pré-física combinada com a ação consumida no mesmo tick). **PADRÃO ATUAL.**

---

## 5. Event Flags ($\text{Observation}_t$ vs $\text{Outcome}_{t+1}$)

Os event flags exportados no Schema V2 refletem a condição observada **no instante da tomada de decisão**:
- `eventState.offTrack`: Carro já estava fora do asfalto ao decidir o comando.
- `eventState.collision`: Carro possuía contato físico ativo ao decidir o comando.
- `eventState.spin`: Carro já estava em deriva severa ($|\text{slipAngle}| > 0.40\text{ rad}$) ao decidir o comando.
- `eventState.isRecovering`: Piloto em manobra de recuperação off-track.
