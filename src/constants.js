// ========== GT3 REAL-SCALE CONSTANTS (METRIC 1:1 SYSTEM) ==========
// 1 unidade = 1 metro do mundo real

export const MAX_SPEED_KMH = 285;
export const MAX_INTERNAL_SPEED = 1.35; // Metros por frame a 60 FPS (285 km/h no HUD)
export const TRACK_WIDTH = 24;          // 24 metros de largura média FIA ampliada
export const NUM_CHECKPOINTS = 16;       // Checkpoints para circuitos de 4 a 7 km
export const BOT_DRIVER_MODE = {
  DETERMINISTIC: 'DETERMINISTIC', // Baseline determinístico atual (Padrão ativo e fallback permanente)
  ML_SHADOW: 'ML_SHADOW',         // Modo Sombra: ML avalia o estado em paralelo sem assumir controle
  ML: 'ML'                        // Modo ML Ativo: ML atua nos comandos com fallback determinístico
};

// ========== ML VERSION METADATA (FASE ML2.0 DATA LINEAGE) ==========
export const TELEMETRY_VERSIONS = {
  SCHEMA_VERSION: 2,
  GAME_BUILD_VERSION: '0.2.0-ml2',
  TRACK_GEOMETRY_VERSION: '1.5.0-centripetal',
  PHYSICS_VERSION: '1.5.0-gt3',
  FEATURE_MANIFEST_VERSION: '2.1.0',
  CONSENT_VERSION: '1.0.0'
};

// Janela de desempenho GT3: slicks, downforce moderado e ajudas permitidas.
// As unidades são metros/frame²; a simulação usa 60 FPS fixos.
export const FORCA_TRACAO = 0.045;
export const RESISTENCIA_AR = 0.00105;
// Entrega de torque mais progressiva, típica de um GT3 com controle de tração.
export const TAXA_SUAVIZACAO_ACEL = 0.028;
export const TAXA_SUAVIZACAO_FREIO = 0.12;
export const FORCA_FREIO_MAX = 0.020;
export const GT3_WHEELBASE = 2.70;
export const GT3_BASE_GRIP = 0.052;
export const GT3_AERO_GRIP = 0.030;
export const GT3_TC_SLIP_LIMIT = 0.105;
export const GT3_ABS_SLIP_LIMIT = 0.165;

// Esterço Progressivo GT3
export const VELOCIDADE_ESTERCO_BASE = 0.8;
export const TAXA_ESTERCO_SUBIDA = 0.1;
export const TAXA_ESTERCO_RETORNO = 0.12;

// Caixa sequencial GT3 de 6 marchas (faixa aproximada de 0 a 285 km/h).
export const GEAR_SPEEDS = [0, 0.25, 0.46, 0.68, 0.90, 1.13, 1.38];
export const GEAR_POWER = [0, 0.028, 0.024, 0.021, 0.018, 0.016, 0.014];

// Pilotos Adversários da F1 / GT3 com Capacidades e Cores Reais (Grid Completo de 20 Pilotos)
export const BOT_CONFIGS = [
  { color: '#ffd700', name: 'A. Senna' },
  { color: '#3388ff', name: 'M. Verstappen' },
  { color: '#ff33ff', name: 'L. Hamilton' },
  { color: '#e10600', name: 'C. Leclerc' },
  { color: '#00e5ff', name: 'F. Alonso' },
  { color: '#ff8000', name: 'L. Norris' },
  { color: '#00d2be', name: 'G. Russell' },
  { color: '#ff3b30', name: 'C. Sainz' },
  { color: '#ff9500', name: 'O. Piastri' },
  { color: '#005aff', name: 'S. Perez' },
  { color: '#2b7fff', name: 'P. Gasly' },
  { color: '#ff69b4', name: 'E. Ocon' },
  { color: '#5ac8fa', name: 'Y. Tsunoda' },
  { color: '#00a3e0', name: 'A. Albon' },
  { color: '#34c759', name: 'V. Bottas' },
  { color: '#af52de', name: 'N. Hulkenberg' },
  { color: '#5856d6', name: 'L. Stroll' },
  { color: '#ffcc00', name: 'D. Ricciardo' },
  { color: '#ff2d55', name: 'M. Schumacher' },
  { color: '#007aff', name: 'A. Prost' }
];
