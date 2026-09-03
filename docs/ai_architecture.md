# Arquitetura de IA e Baseline de Machine Learning — Quick-grid

## 1. Visão Geral e Pipeline Atual

A arquitetura do Quick-grid separa a geração da pista, o perfil físico global, a tomada de decisão do piloto e a simulação de dinâmica veicular GT3:

```
┌────────────────────────────────────────────────────────┐
│ 1. TRACK GEOMETRY & SPLINE GENERATION                  │
│    - Malha contínua a cada ~1.5m                       │
│    - Curvatura analítica em rad/m (kappa)              │
│    - Filtro conservador com preservação de picos       │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 2. GLOBAL SPEED PROFILE (Offline / Track Load)         │
│    - Limite centrípeto analítico com downforce GT3     │
│    - Backward Braking Pass físico (a_brake = 0.0155)   │
│    - Prevenção de freadas fantasmas (Forward Pass sep) │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 3. BOT DRIVER (IA / Baseline Determinístico)           │
│    - Space-aware traffic & crowding management         │
│    - Racing line geométrica com apex shift             │
│    - Pure Pursuit analítico com Ackermann Ratio        │
│    - Dynamic Yaw Damping (anti zig-zag)                │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 4. SAFETY & STABILITY ENVELOPE (TCS / Edge Buffer)     │
│    - Deriva controlada (4.2° ~ 6.5°)                   │
│    - Gerenciamento de Understeer e Oversteer           │
│    - Time-to-Edge preditivo (< 0.45s)                  │
└──────────────────────────┬─────────────────────────────┘
                           │  DriverInput { throttle, brake, steer }
┌──────────────────────────▼─────────────────────────────┐
│ 5. CAR PHYSICS (GT3 Dynamic Model in car.js)           │
│    - Círculo de atrito longitudinal/lateral            │
│    - Transferência dinâmica de carga                   │
│    - Yaw authority e saturação dianteira               │
└────────────────────────────────────────────────────────┘
```

---

## 2. Entradas e Saídas da IA (Baseline Determinístico)

### Entradas Observadas por Frame (State Observation)
1. **Posição e Cinemática:** $x, y, v_x, v_y, \text{angle}, \text{yawRate}, \text{rpm}, \text{gear}$.
2. **Geometria Local da Pista:** Ponto mais próximo $cp$, vetor normal $(\hat{n}_x, \hat{n}_y)$, curvatura $\kappa$, velocidade limite de frenagem $cp.safeBrakingLimit$.
3. **Dinâmica Lateral e Deriva:** Velocidade longitudinal $fwdVel$, velocidade transversal $latVel$, ângulo de deriva $slipAngle$, taxa de variação $\Delta slip / \Delta t$.
4. **Tráfego e Pelotão:** Distância até o carro à frente/atrás, delta de velocidade, espaço livre utilizável à esquerda vs direita ($spaceLeft$ vs $spaceRight$), contagem de carros no pelotão (`carsNearbyCount`).
5. **Bordas da Pista:** Distância métrica à borda dirigível ($distToOuterEdge$), velocidade em direção à borda ($latVelTowardEdge$), tempo estimado para cruzar a linha branca ($timeToEdge$).

### Saídas Geradas por Frame (DriverInput)
```typescript
interface DriverInput {
  throttleInput: number; // [0.0, 1.0] Acelerador com modulação TCS progressiva
  brakeInput: number;    // [0.0, 1.0] Freio com late-braking e trail-braking
  steerInput: number;    // [-1.0, 1.0] Comando de esterço Pure Pursuit com Yaw Damping
}
```

---

## 3. Ponto de Inserção para o Futuro `MLBotDriver`

A interface entre `Car` e o piloto é desacoplada. Em `src/car.js`:
```javascript
if (this.isBot) {
  if (this.brain) {
    const inputs = this.brain.computeInputs();
    throttleInput = inputs.throttleInput;
    brakeInput = inputs.brakeInput;
    steerInput = inputs.steerInput;
  }
}
```

### Feature Flag de Modo de Driver (`BOT_DRIVER_MODE`)
Configurada em `src/constants.js`:
- **`DETERMINISTIC` (Padrão Ativo):** Executa o baseline atual de alta performance com segurança e zero oscilações.
- **`ML_SHADOW`:** Executa o modelo de ML em paralelo gerando telemetria e comparando decisões com o baseline determinístico sem atuar fisicamente no carro.
- **`ML`:** O modelo de Machine Learning assume os atuadores (`throttle`, `brake`, `steer`), mantendo o baseline determinístico como **camada de validação de segurança e fallback de emergência**.

---

## 4. Garantia de Zero Mudança de Comportamento
- Nenhuma alteração numérica ou comportamental foi realizada no controle físico, speed profile ou no baseline da IA.
- O modo padrão permanece estritamente em `BOT_DRIVER_MODE.DETERMINISTIC`.
- `npm run build` compilado com sucesso (Exit Code 0).
