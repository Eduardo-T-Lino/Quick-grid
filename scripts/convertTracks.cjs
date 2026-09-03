// Script de conversão: GeoJSON GPS real → coordenadas de jogo
// Executa com: node scripts/convertTracks.js

const fs = require('fs');
const path = require('path');

const GEOJSON_URL = 'https://raw.githubusercontent.com/bacinger/f1-circuits/master/f1-circuits.geojson';

// Mapeamento de IDs do GeoJSON para dados do calendário F1 2024
const TRACK_META = {
  'bh-2002':  { id: 1,  calName: 'Bahrain International Circuit',    flag: '🇧🇭', elev: [0, 2, 5, 8, 12, 16, 18, 14, 10, 6, 3], kerbP: '#d32f2f', kerbS: '#ffffff', escape: 'gravel_asphalt', width: 130 },
  'au-1953':  { id: 3,  calName: 'Albert Park Circuit',              flag: '🇦🇺', elev: [0, 1, 2, 3, 4, 5, 6, 5, 3, 2, 1], kerbP: '#0055a5', kerbS: '#ffffff', escape: 'gravel', width: 125 },
  'cn-2004':  { id: 5,  calName: 'Shanghai International Circuit',   flag: '🇨🇳', elev: [0, 2, 4, 6, 8, 10, 12, 10, 8, 4, 2], kerbP: '#d32f2f', kerbS: '#ffd700', escape: 'asphalt_gravel', width: 130 },
  'jp-1962':  { id: 4,  calName: 'Suzuka Circuit',                    flag: '🇯🇵', elev: [5, 0, 6, 14, 22, 28, 24, 18, 25, 32, 38, 40, 30, 18, 10], kerbP: '#c62828', kerbS: '#ffffff', escape: 'gravel', width: 120 },
  'es-1991':  { id: 10, calName: 'Circuit de Barcelona-Catalunya',    flag: '🇪🇸', elev: [0, 4, 8, 14, 22, 30, 24, 28, 18, 10, 4], kerbP: '#d32f2f', kerbS: '#ffd700', escape: 'gravel_asphalt', width: 125 },
  'mc-1929':  { id: 8,  calName: 'Circuit de Monaco',                 flag: '🇲🇨', elev: [0, 2, 24, 42, 38, 28, 18, 10, 2, 1, 0, 0, 0], kerbP: '#d32f2f', kerbS: '#ffffff', escape: 'barriers', width: 100 },
  'ca-1978':  { id: 9,  calName: 'Circuit Gilles Villeneuve',         flag: '🇨🇦', elev: [0, 1, 2, 2, 3, 4, 5, 3, 1, 0], kerbP: '#c62828', kerbS: '#ffffff', escape: 'asphalt_walls', width: 120 },
  'at-1969':  { id: 11, calName: 'Red Bull Ring',                     flag: '🇦🇹', elev: [0, 15, 65, 62, 45, 30, 15, 5], kerbP: '#d32f2f', kerbS: '#ffffff', escape: 'asphalt_gravel', width: 125 },
  'gb-1948':  { id: 12, calName: 'Silverstone Circuit',               flag: '🇬🇧', elev: [0, 2, 3, 4, 6, 8, 6, 7, 9, 12, 8, 4, 1], kerbP: '#1565c0', kerbS: '#ffffff', escape: 'asphalt_gravel', width: 130 },
  'hu-1986':  { id: 13, calName: 'Hungaroring',                       flag: '🇭🇺', elev: [0, 5, 15, 28, 38, 30, 22, 15, 8, 2], kerbP: '#c62828', kerbS: '#2e7d32', escape: 'gravel', width: 115 },
  'be-1925':  { id: 14, calName: 'Circuit de Spa-Francorchamps',      flag: '🇧🇪', elev: [0, 2, 10, 28, 85, 102, 88, 65, 40, 25, 12, 2], kerbP: '#d32f2f', kerbS: '#ffd700', escape: 'asphalt_gravel', width: 130 },
  'it-1922':  { id: 16, calName: 'Autodromo Nazionale Monza',         flag: '🇮🇹', elev: [0, 2, 4, 6, 8, 10, 12, 8, 4, 2], kerbP: '#1b5e20', kerbS: '#ffffff', escape: 'gravel', width: 135 },
  'sg-2008':  { id: 18, calName: 'Marina Bay Street Circuit',         flag: '🇸🇬', elev: [0, 1, 2, 4, 5, 6, 8, 6, 3, 1], kerbP: '#e53935', kerbS: '#ffffff', escape: 'walls', width: 115 },
  'us-2012':  { id: 19, calName: 'Circuit of the Americas (COTA)',    flag: '🇺🇸', elev: [0, 41, 30, 18, 10, 4, 2, 8, 14, 18, 6], kerbP: '#c62828', kerbS: '#1565c0', escape: 'asphalt_gravel', width: 130 },
  'mx-1962':  { id: 20, calName: 'Autódromo Hermanos Rodríguez',     flag: '🇲🇽', elev: [0, 1, 2, 3, 4, 5, 4, 2, 0], kerbP: '#2e7d32', kerbS: '#ffffff', escape: 'asphalt_gravel', width: 125 },
  'br-1940':  { id: 21, calName: 'Autódromo de Interlagos',           flag: '🇧🇷', elev: [20, 28, 12, 5, 0, 8, 20, 26, 30, 32, 25, 22, 35], kerbP: '#fbc02d', kerbS: '#2e7d32', escape: 'asphalt_gravel', width: 130 },
  'ae-2009':  { id: 24, calName: 'Yas Marina Circuit',                flag: '🇦🇪', elev: [0, 1, 3, 5, 6, 8, 10, 7, 4, 1], kerbP: '#00838f', kerbS: '#ffffff', escape: 'asphalt_walls', width: 130 },
  'it-1953':  { id: 7,  calName: 'Autodromo Enzo e Dino Ferrari',    flag: '🇮🇹', elev: [0, 4, 10, 20, 34, 28, 20, 12, 2], kerbP: '#1b5e20', kerbS: '#ffffff', escape: 'gravel', width: 120 },
  'de-1927':  { id: 99, calName: 'Nürburgring',                       flag: '🇩🇪', elev: [0, 5, 12, 20, 30, 22, 15, 8, 2], kerbP: '#d32f2f', kerbS: '#ffffff', escape: 'gravel', width: 125 },
};

// Circuitos adicionais que NÃO estão no GeoJSON (adicionados manualmente com dados aproximados de mapas oficiais da FIA)
const MANUAL_TRACKS = [
  {
    id: 2, name: 'Jeddah Corniche Circuit', location: 'Jeddah, Arábia Saudita 🇸🇦',
    lengthKm: '6.174 km', elevationDiff: '5 m', trackWidth: 115,
    kerbColors: { primary: '#006c35', secondary: '#ffffff' }, escapeType: 'walls',
    rawCoords: [[39.1044,21.6322],[39.1048,21.6340],[39.1052,21.6355],[39.1058,21.6370],[39.1063,21.6382],[39.1070,21.6395],[39.1078,21.6405],[39.1088,21.6415],[39.1095,21.6418],[39.1100,21.6415],[39.1105,21.6405],[39.1108,21.6395],[39.1110,21.6382],[39.1108,21.6368],[39.1102,21.6355],[39.1098,21.6345],[39.1092,21.6335],[39.1085,21.6330],[39.1078,21.6328],[39.1070,21.6330],[39.1062,21.6335],[39.1055,21.6340],[39.1050,21.6335],[39.1048,21.6328],[39.1044,21.6322]],
    elevations: [0,1,1,2,2,3,3,3,2,2,1,1]
  },
  {
    id: 6, name: 'Miami International Autodrome', location: 'Miami Gardens, EUA 🇺🇸',
    lengthKm: '5.412 km', elevationDiff: '7 m', trackWidth: 125,
    kerbColors: { primary: '#00b4d8', secondary: '#ffffff' }, escapeType: 'asphalt',
    rawCoords: [[-80.2388,25.9581],[-80.2378,25.9581],[-80.2368,25.9578],[-80.2360,25.9572],[-80.2355,25.9565],[-80.2350,25.9555],[-80.2348,25.9545],[-80.2350,25.9535],[-80.2355,25.9528],[-80.2362,25.9522],[-80.2370,25.9518],[-80.2380,25.9515],[-80.2390,25.9518],[-80.2398,25.9522],[-80.2405,25.9530],[-80.2408,25.9540],[-80.2405,25.9550],[-80.2400,25.9560],[-80.2395,25.9570],[-80.2388,25.9581]],
    elevations: [0,1,2,3,4,5,7,5,4,3,2,1]
  },
  {
    id: 15, name: 'Circuit Zandvoort', location: 'Zandvoort, Holanda 🇳🇱',
    lengthKm: '4.259 km', elevationDiff: '15 m', trackWidth: 120,
    kerbColors: { primary: '#e65100', secondary: '#ffffff' }, escapeType: 'gravel',
    rawCoords: [[4.5405,52.3888],[4.5415,52.3885],[4.5430,52.3878],[4.5438,52.3870],[4.5442,52.3860],[4.5440,52.3850],[4.5432,52.3842],[4.5420,52.3838],[4.5408,52.3840],[4.5398,52.3845],[4.5390,52.3855],[4.5385,52.3865],[4.5388,52.3875],[4.5395,52.3883],[4.5405,52.3888]],
    elevations: [0,2,5,8,12,15,10,4,2]
  },
  {
    id: 17, name: 'Baku City Circuit', location: 'Baku, Azerbaijão 🇦🇿',
    lengthKm: '6.003 km', elevationDiff: '24 m', trackWidth: 110,
    kerbColors: { primary: '#0092bc', secondary: '#e03c31' }, escapeType: 'barriers',
    rawCoords: [[49.8422,40.3722],[49.8445,40.3722],[49.8470,40.3725],[49.8490,40.3730],[49.8500,40.3738],[49.8505,40.3748],[49.8502,40.3758],[49.8495,40.3765],[49.8485,40.3770],[49.8475,40.3768],[49.8465,40.3762],[49.8455,40.3755],[49.8445,40.3750],[49.8435,40.3745],[49.8428,40.3738],[49.8422,40.3730],[49.8422,40.3722]],
    elevations: [0,0,2,4,8,14,24,20,10,2]
  },
  {
    id: 22, name: 'Las Vegas Strip Circuit', location: 'Las Vegas, EUA 🇺🇸',
    lengthKm: '6.201 km', elevationDiff: '6 m', trackWidth: 125,
    kerbColors: { primary: '#d32f2f', secondary: '#ffffff' }, escapeType: 'walls',
    rawCoords: [[-115.1720,36.1200],[-115.1700,36.1200],[-115.1680,36.1195],[-115.1665,36.1185],[-115.1660,36.1170],[-115.1665,36.1155],[-115.1680,36.1145],[-115.1700,36.1140],[-115.1730,36.1142],[-115.1750,36.1150],[-115.1760,36.1165],[-115.1755,36.1180],[-115.1740,36.1192],[-115.1720,36.1200]],
    elevations: [0,1,2,3,4,5,6,4,2]
  },
  {
    id: 23, name: 'Lusail International Circuit', location: 'Lusail, Catar 🇶🇦',
    lengthKm: '5.419 km', elevationDiff: '8 m', trackWidth: 130,
    kerbColors: { primary: '#6a1b9a', secondary: '#ffffff' }, escapeType: 'asphalt_gravel',
    rawCoords: [[51.4890,25.4900],[51.4910,25.4895],[51.4925,25.4885],[51.4935,25.4872],[51.4938,25.4858],[51.4932,25.4845],[51.4920,25.4838],[51.4905,25.4835],[51.4890,25.4840],[51.4878,25.4850],[51.4872,25.4865],[51.4875,25.4880],[51.4882,25.4892],[51.4890,25.4900]],
    elevations: [0,1,3,5,7,8,6,4,2]
  },
];

function gpsToLocalXY(coords, centerLat) {
  const DEG_TO_M_LAT = 111320;
  const DEG_TO_M_LNG = 111320 * Math.cos(centerLat * Math.PI / 180);
  
  let cx = 0, cy = 0;
  for (const c of coords) { cx += c[0]; cy += c[1]; }
  cx /= coords.length; cy /= coords.length;
  
  return coords.map(c => ({
    x: (c[0] - cx) * DEG_TO_M_LNG,
    y: -(c[1] - cy) * DEG_TO_M_LAT // Y invertido (para cima = negativo em GPS, positivo em tela)
  }));
}

function downsample(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  const result = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(points[Math.floor(i * step)]);
  }
  return result;
}

function assignElevations(points, elevProfile) {
  if (!elevProfile || elevProfile.length === 0) return points;
  const n = points.length;
  return points.map((p, i) => {
    const t = i / n;
    const idx = t * (elevProfile.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, elevProfile.length - 1);
    const frac = idx - lo;
    const z = elevProfile[lo] * (1 - frac) + elevProfile[hi] * frac;
    return { ...p, z: Math.round(z * 100) / 100 };
  });
}

async function main() {
  console.log('Baixando GeoJSON das pistas F1...');
  const resp = await fetch(GEOJSON_URL);
  const geojson = await resp.json();
  
  const tracks = [];

  // Processar pistas do GeoJSON
  for (const feature of geojson.features) {
    const propId = feature.properties.id;
    const meta = TRACK_META[propId];
    if (!meta) continue;
    
    const coords = feature.geometry.coordinates;
    const centerLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    
    let localPoints = gpsToLocalXY(coords, centerLat);
    
    // Centralizar e adicionar offset para evitar coordenadas negativas
    let minX = Infinity, minY = Infinity;
    for (const p of localPoints) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; }
    localPoints = localPoints.map(p => ({ x: Math.round((p.x - minX + 200) * 10) / 10, y: Math.round((p.y - minY + 200) * 10) / 10 }));
    
    // Downsample para performance (máximo ~180 pontos por pista)
    localPoints = downsample(localPoints, 180);
    
    // Atribuir elevações
    localPoints = assignElevations(localPoints, meta.elev);
    
    const lengthM = feature.properties.length;
    const maxElev = meta.elev ? Math.max(...meta.elev) : 0;
    
    tracks.push({
      id: meta.id,
      name: meta.calName,
      location: `${feature.properties.Location}, ${meta.flag}`,
      lengthKm: `${(lengthM / 1000).toFixed(3)} km`,
      elevationDiff: `${maxElev} m`,
      trackWidth: meta.width,
      kerbColors: { primary: meta.kerbP, secondary: meta.kerbS },
      escapeType: meta.escape,
      waypoints: localPoints
    });
    
    console.log(`  ✓ ${meta.calName} (${localPoints.length} pontos, ${(lengthM/1000).toFixed(1)}km)`);
  }
  
  // Processar pistas manuais (circuitos mais novos)
  for (const manual of MANUAL_TRACKS) {
    const coords = manual.rawCoords;
    const centerLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    
    let localPoints = gpsToLocalXY(coords, centerLat);
    
    let minX = Infinity, minY = Infinity;
    for (const p of localPoints) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; }
    localPoints = localPoints.map(p => ({ x: Math.round((p.x - minX + 200) * 10) / 10, y: Math.round((p.y - minY + 200) * 10) / 10 }));
    
    localPoints = assignElevations(localPoints, manual.elevations);
    
    tracks.push({
      id: manual.id,
      name: manual.name,
      location: manual.location,
      lengthKm: manual.lengthKm,
      elevationDiff: manual.elevationDiff,
      trackWidth: manual.trackWidth,
      kerbColors: manual.kerbColors,
      escapeType: manual.escapeType,
      waypoints: localPoints
    });
    
    console.log(`  ✓ ${manual.name} (Manual, ${localPoints.length} pontos)`);
  }
  
  // Ordenar por ID
  tracks.sort((a, b) => a.id - b.id);
  
  // Gerar arquivo JS
  let jsOutput = `// Catálogo REAL das Pistas Oficiais da Fórmula 1\n`;
  jsOutput += `// Gerado automaticamente a partir de dados GeoJSON GPS reais (bacinger/f1-circuits)\n`;
  jsOutput += `// Coordenadas convertidas de WGS84 para espaço de jogo em metros.\n\n`;
  jsOutput += `export const F1_TRACKS = ${JSON.stringify(tracks, null, 2)};\n`;
  
  const outPath = path.join(__dirname, '..', 'src', 'f1Tracks.js');
  fs.writeFileSync(outPath, jsOutput, 'utf-8');
  console.log(`\n✅ Gerado ${outPath} com ${tracks.length} pistas!`);
}

main().catch(err => { console.error('Erro:', err); process.exit(1); });
