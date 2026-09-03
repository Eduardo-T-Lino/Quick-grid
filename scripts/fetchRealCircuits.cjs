// Script de Normalização e Geração de Alta Fidelidade 1:1 para as 24 Pistas da F1
// Garante escala métrica real (1 unidade = 1 metro) com comprimento oficial exato da FIA

const fs = require('fs');
const path = require('path');

const CIRCUITS = [
  { id: 1,  file: 'bh-2002', name: 'Bahrain International Circuit', location: 'Sakhir, Bahrain 🇧🇭', officialLenM: 5412, width: 24, kerbP: '#d32f2f', kerbS: '#ffffff', escape: 'gravel_asphalt', elev: [0, 2, 5, 8, 12, 16, 18, 14, 10, 6, 3] },
  { id: 2,  file: 'sa-2021', name: 'Jeddah Corniche Circuit', location: 'Jeddah, Arábia Saudita 🇸🇦', officialLenM: 6174, width: 22, kerbP: '#006c35', kerbS: '#ffffff', escape: 'walls', elev: [0, 1, 2, 3, 4, 5, 3, 2, 1] },
  { id: 3,  file: 'au-1953', name: 'Albert Park Circuit', location: 'Melbourne, Austrália 🇦🇺', officialLenM: 5278, width: 24, kerbP: '#0055a5', kerbS: '#ffffff', escape: 'gravel', elev: [0, 1, 2, 3, 4, 5, 6, 5, 3, 2, 1] },
  { id: 4,  file: 'jp-1962', name: 'Suzuka Circuit', location: 'Suzuka, Japão 🇯🇵', officialLenM: 5807, width: 24, kerbP: '#c62828', kerbS: '#ffffff', escape: 'gravel', elev: [5, 0, 6, 14, 22, 28, 24, 18, 25, 32, 38, 40, 30, 18, 10] },
  { id: 5,  file: 'cn-2004', name: 'Shanghai International Circuit', location: 'Xangai, China 🇨🇳', officialLenM: 5451, width: 24, kerbP: '#d32f2f', kerbS: '#ffd700', escape: 'asphalt_gravel', elev: [0, 2, 4, 6, 8, 10, 12, 10, 8, 4, 2] },
  { id: 6,  file: 'us-2022', name: 'Miami International Autodrome', location: 'Miami Gardens, EUA 🇺🇸', officialLenM: 5412, width: 24, kerbP: '#00b4d8', kerbS: '#ffffff', escape: 'asphalt', elev: [0, 1, 2, 3, 5, 7, 5, 3, 1] },
  { id: 7,  file: 'it-1953', name: 'Autodromo Enzo e Dino Ferrari', location: 'Ímola, Itália 🇮🇹', officialLenM: 4909, width: 22, kerbP: '#1b5e20', kerbS: '#ffffff', escape: 'gravel', elev: [0, 4, 10, 20, 34, 28, 20, 12, 2] },
  { id: 8,  file: 'mc-1929', name: 'Circuit de Monaco', location: 'Monte Carlo, Mônaco 🇲🇨', officialLenM: 3337, width: 20, kerbP: '#d32f2f', kerbS: '#ffffff', escape: 'barriers', elev: [0, 2, 24, 42, 38, 28, 18, 10, 2, 1, 0, 0, 0] },
  { id: 9,  file: 'ca-1978', name: 'Circuit Gilles Villeneuve', location: 'Montreal, Canadá 🇨🇦', officialLenM: 4361, width: 24, kerbP: '#c62828', kerbS: '#ffffff', escape: 'asphalt_walls', elev: [0, 1, 2, 2, 3, 4, 5, 3, 1, 0] },
  { id: 10, file: 'es-1991', name: 'Circuit de Barcelona-Catalunya', location: 'Montmeló, Espanha 🇪🇸', officialLenM: 4657, width: 24, kerbP: '#d32f2f', kerbS: '#ffd700', escape: 'gravel_asphalt', elev: [0, 4, 8, 14, 22, 30, 24, 28, 18, 10, 4] },
  { id: 11, file: 'at-1969', name: 'Red Bull Ring', location: 'Spielberg, Áustria 🇦🇹', officialLenM: 4318, width: 24, kerbP: '#d32f2f', kerbS: '#ffffff', escape: 'asphalt_gravel', elev: [0, 15, 65, 62, 45, 30, 15, 5] },
  { id: 12, file: 'gb-1948', name: 'Silverstone Circuit', location: 'Silverstone, Reino Unido 🇬🇧', officialLenM: 5891, width: 24, kerbP: '#1565c0', kerbS: '#ffffff', escape: 'asphalt_gravel', elev: [0, 2, 3, 4, 6, 8, 6, 7, 9, 12, 8, 4, 1] },
  { id: 13, file: 'hu-1986', name: 'Hungaroring', location: 'Budapeste, Hungria 🇭🇺', officialLenM: 4381, width: 22, kerbP: '#c62828', kerbS: '#2e7d32', escape: 'gravel', elev: [0, 5, 15, 28, 38, 30, 22, 15, 8, 2] },
  { id: 14, file: 'be-1925', name: 'Circuit de Spa-Francorchamps', location: 'Stavelot, Bélgica 🇧🇪', officialLenM: 7004, width: 25, kerbP: '#d32f2f', kerbS: '#ffd700', escape: 'asphalt_gravel', elev: [0, 2, 10, 28, 85, 102, 88, 65, 40, 25, 12, 2] },
  { id: 15, file: 'nl-1948', name: 'Circuit Zandvoort', location: 'Zandvoort, Holanda 🇳🇱', officialLenM: 4259, width: 22, kerbP: '#e65100', kerbS: '#ffffff', escape: 'gravel', elev: [0, 2, 5, 8, 12, 15, 10, 4, 2] },
  { id: 16, file: 'it-1922', name: 'Autodromo Nazionale Monza', location: 'Monza, Itália 🇮🇹', officialLenM: 5793, width: 24, kerbP: '#1b5e20', kerbS: '#ffffff', escape: 'gravel', elev: [0, 2, 4, 6, 8, 10, 12, 8, 4, 2] },
  { id: 17, file: 'az-2016', name: 'Baku City Circuit', location: 'Baku, Azerbaijão 🇦🇿', officialLenM: 6003, width: 22, kerbP: '#0092bc', kerbS: '#e03c31', escape: 'barriers', elev: [0, 2, 4, 8, 14, 24, 20, 10, 2] },
  { id: 18, file: 'sg-2008', name: 'Marina Bay Street Circuit', location: 'Marina Bay, Cingapura 🇸🇬', officialLenM: 4940, width: 22, kerbP: '#e53935', kerbS: '#ffffff', escape: 'walls', elev: [0, 1, 2, 4, 5, 6, 8, 6, 3, 1] },
  { id: 19, file: 'us-2012', name: 'Circuit of the Americas (COTA)', location: 'Austin, Texas, EUA 🇺🇸', officialLenM: 5513, width: 24, kerbP: '#c62828', kerbS: '#1565c0', escape: 'asphalt_gravel', elev: [0, 41, 30, 18, 10, 4, 2, 8, 14, 18, 6] },
  { id: 20, file: 'mx-1962', name: 'Autódromo Hermanos Rodríguez', location: 'Cidade do México, México 🇲🇽', officialLenM: 4304, width: 24, kerbP: '#2e7d32', kerbS: '#ffffff', escape: 'asphalt_gravel', elev: [0, 1, 2, 3, 4, 5, 4, 2, 0] },
  { id: 21, file: 'br-1940', name: 'Autódromo de Interlagos', location: 'São Paulo, Brasil 🇧🇷', officialLenM: 4309, width: 24, kerbP: '#fbc02d', kerbS: '#2e7d32', escape: 'asphalt_gravel', elev: [20, 28, 12, 5, 0, 8, 20, 26, 30, 32, 25, 22, 35] },
  { id: 22, file: 'us-2023', name: 'Las Vegas Strip Circuit', location: 'Las Vegas, EUA 🇺🇸', officialLenM: 6201, width: 24, kerbP: '#d32f2f', kerbS: '#ffffff', escape: 'walls', elev: [0, 1, 2, 3, 4, 5, 6, 4, 2] },
  { id: 23, file: 'qa-2004', name: 'Lusail International Circuit', location: 'Lusail, Catar 🇶🇦', officialLenM: 5419, width: 24, kerbP: '#6a1b9a', kerbS: '#ffffff', escape: 'asphalt_gravel', elev: [0, 1, 3, 5, 7, 8, 6, 4, 2] },
  { id: 24, file: 'ae-2009', name: 'Yas Marina Circuit', location: 'Abu Dhabi, Emirados Árabes 🇦🇪', officialLenM: 5281, width: 24, kerbP: '#00838f', kerbS: '#ffffff', escape: 'asphalt_walls', elev: [0, 1, 3, 5, 6, 8, 10, 7, 4, 1] }
];

function gpsToLocalMeters(coords, centerLat) {
  const DEG_TO_M_LAT = 111320;
  const DEG_TO_M_LNG = 111320 * Math.cos(centerLat * Math.PI / 180);

  let cx = 0, cy = 0;
  for (const c of coords) { cx += c[0]; cy += c[1]; }
  cx /= coords.length; cy /= coords.length;

  return coords.map(c => ({
    x: (c[0] - cx) * DEG_TO_M_LNG,
    y: -(c[1] - cy) * DEG_TO_M_LAT
  }));
}

function calculatePathLength(points) {
  let len = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    len += Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }
  return len;
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
    return { ...p, z: Math.round(z * 10) / 10 };
  });
}

async function main() {
  console.log('🏁 Processando 24 pistas oficiais com escala 1:1 METROS REAIS...');
  const tracks = [];

  for (const item of CIRCUITS) {
    const url = `https://raw.githubusercontent.com/bacinger/f1-circuits/master/circuits/${item.file}.geojson`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const geo = await resp.json();

      let coords = [];
      if (geo.geometry && geo.geometry.coordinates) {
        coords = geo.geometry.coordinates;
      } else if (geo.features && geo.features[0]) {
        coords = geo.features[0].geometry.coordinates;
      }

      const centerLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      let localPoints = gpsToLocalMeters(coords, centerLat);

      // Calcular comprimento atual medido do GPS
      const rawLengthM = calculatePathLength(localPoints);

      // Fator de escala exato para calibrar com a extensão métrica oficial da FIA
      const scaleFactor = item.officialLenM / rawLengthM;

      // Re-escalar coordenadas para bater 100% com o comprimento métrico real
      localPoints = localPoints.map(p => ({
        x: p.x * scaleFactor,
        y: p.y * scaleFactor
      }));

      // Offset positivo para centralizar no espaço cartesiano (com margem de segurança de 300m)
      let minX = Infinity, minY = Infinity;
      for (const p of localPoints) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; }
      localPoints = localPoints.map(p => ({
        x: Math.round((p.x - minX + 300) * 10) / 10,
        y: Math.round((p.y - minY + 300) * 10) / 10
      }));

      // Atribuir elevação 3D real
      localPoints = assignElevations(localPoints, item.elev);

      const maxElev = Math.max(...item.elev);

      tracks.push({
        id: item.id,
        name: item.name,
        location: item.location,
        lengthKm: `${(item.officialLenM / 1000).toFixed(3)} km`,
        lengthMeters: item.officialLenM,
        elevationDiff: `${maxElev} m`,
        trackWidth: item.width, // Largura real em metros (12m a 14m)
        kerbColors: { primary: item.kerbP, secondary: item.kerbS },
        escapeType: item.escape,
        waypoints: localPoints
      });

      console.log(`  ✅ [${item.id}/24] ${item.name} -> Extensão Real: ${item.officialLenM}m | Largura: ${item.width}m (${localPoints.length} waypoints)`);
    } catch (e) {
      console.error(`  ❌ Erro em ${item.file}:`, e.message);
    }
  }

  tracks.sort((a, b) => a.id - b.id);

  let jsOutput = `// Catálogo Oficial das 24 Pistas da Fórmula 1 em ESCALA REAL 1:1 (METROS)\n`;
  jsOutput += `// Coordenadas métricas em espaço cartesiano de mundo com elevação Z e extensões FIA exatas.\n\n`;
  jsOutput += `export const F1_TRACKS = ${JSON.stringify(tracks, null, 2)};\n`;

  const outPath = path.join(__dirname, '..', 'src', 'f1Tracks.js');
  fs.writeFileSync(outPath, jsOutput, 'utf-8');
  console.log(`\n🎉 Gerado com sucesso em escala real 1:1: ${outPath}`);
}

main().catch(err => { console.error('Erro fatal:', err); process.exit(1); });
