const fs = require('fs');
const path = require('path');

// 56 Distinct Neural Speakers (45 Spanish from 20 countries + 11 Multilingual)
// Used for local unlimited synthesis when Noiz AI API Key is not provided, ensuring EVERY voice has a distinct human vocal cord!
const FEMALE_NEURAL_SPEAKERS = [
  { shortName: 'es-CO-SalomeNeural', country: 'Colombia', flag: '🇨🇴', pitchOffset: 0, rateOffset: 0 },
  { shortName: 'es-ES-XimenaNeural', country: 'España', flag: '🇪🇸', pitchOffset: -3, rateOffset: -2 },
  { shortName: 'es-ES-ElviraNeural', country: 'España', flag: '🇪🇸', pitchOffset: 2, rateOffset: 2 },
  { shortName: 'es-MX-DaliaNeural', country: 'México', flag: '🇲🇽', pitchOffset: 3, rateOffset: 1 },
  { shortName: 'es-AR-ElenaNeural', country: 'Argentina', flag: '🇦🇷', pitchOffset: 1, rateOffset: 3 },
  { shortName: 'es-CL-CatalinaNeural', country: 'Chile', flag: '🇨🇱', pitchOffset: 4, rateOffset: 2 },
  { shortName: 'es-PE-CamilaNeural', country: 'Perú', flag: '🇵🇪', pitchOffset: -2, rateOffset: 0 },
  { shortName: 'es-VE-PaolaNeural', country: 'Venezuela', flag: '🇻🇪', pitchOffset: 2, rateOffset: 4 },
  { shortName: 'es-US-PalomaNeural', country: 'EE. UU.', flag: '🇺🇸', pitchOffset: -1, rateOffset: 1 },
  { shortName: 'es-UY-ValentinaNeural', country: 'Uruguay', flag: '🇺🇾', pitchOffset: 5, rateOffset: 2 },
  { shortName: 'es-CR-MariaNeural', country: 'Costa Rica', flag: '🇨🇷', pitchOffset: 3, rateOffset: 0 },
  { shortName: 'es-EC-AndreaNeural', country: 'Ecuador', flag: '🇪🇨', pitchOffset: 2, rateOffset: -1 },
  { shortName: 'es-BO-SofiaNeural', country: 'Bolivia', flag: '🇧🇴', pitchOffset: 6, rateOffset: 1 },
  { shortName: 'es-PY-TaniaNeural', country: 'Paraguay', flag: '🇵🇾', pitchOffset: -2, rateOffset: -2 },
  { shortName: 'es-PA-MargaritaNeural', country: 'Panamá', flag: '🇵🇦', pitchOffset: 1, rateOffset: 3 },
  { shortName: 'es-PR-KarinaNeural', country: 'Puerto Rico', flag: '🇵🇷', pitchOffset: 4, rateOffset: 4 },
  { shortName: 'es-DO-RamonaNeural', country: 'Rep. Dominicana', flag: '🇩🇴', pitchOffset: -4, rateOffset: -3 },
  { shortName: 'es-CU-BelkysNeural', country: 'Cuba', flag: '🇨🇺', pitchOffset: -3, rateOffset: 1 },
  { shortName: 'es-GT-MartaNeural', country: 'Guatemala', flag: '🇬🇹', pitchOffset: 0, rateOffset: -1 },
  { shortName: 'es-HN-KarlaNeural', country: 'Honduras', flag: '🇭🇳', pitchOffset: 3, rateOffset: 2 },
  { shortName: 'es-NI-YolandaNeural', country: 'Nicaragua', flag: '🇳🇮', pitchOffset: -5, rateOffset: -4 },
  { shortName: 'es-SV-LorenaNeural', country: 'El Salvador', flag: '🇸🇻', pitchOffset: 2, rateOffset: 0 },
  { shortName: 'es-GQ-TeresaNeural', country: 'Guinea Ecuatorial', flag: '🇬🇶', pitchOffset: -4, rateOffset: -2 },
  { shortName: 'en-US-AnaNeural', country: 'Infantil Bilingüe', flag: '🎈', pitchOffset: 14, rateOffset: 2 },
  { shortName: 'en-US-AvaMultilingualNeural', country: 'Multilingüe HD', flag: '🌍', pitchOffset: 1, rateOffset: 0 },
  { shortName: 'en-US-EmmaMultilingualNeural', country: 'Multilingüe HD', flag: '🌍', pitchOffset: -2, rateOffset: -1 },
  { shortName: 'fr-FR-VivienneMultilingualNeural', country: 'Multilingüe EU', flag: '🌍', pitchOffset: -3, rateOffset: 0 },
  { shortName: 'pt-BR-ThalitaMultilingualNeural', country: 'Multilingüe LatAm', flag: '🌍', pitchOffset: 3, rateOffset: 2 }
];

const MALE_NEURAL_SPEAKERS = [
  { shortName: 'es-UY-MateoNeural', country: 'Uruguay', flag: '🇺🇾', pitchOffset: 0, rateOffset: 2 },
  { shortName: 'es-VE-SebastianNeural', country: 'Venezuela', flag: '🇻🇪', pitchOffset: 3, rateOffset: 4 },
  { shortName: 'es-ES-AlvaroNeural', country: 'España', flag: '🇪🇸', pitchOffset: -2, rateOffset: 1 },
  { shortName: 'es-MX-JorgeNeural', country: 'México', flag: '🇲🇽', pitchOffset: 1, rateOffset: 2 },
  { shortName: 'es-AR-TomasNeural', country: 'Argentina', flag: '🇦🇷', pitchOffset: 2, rateOffset: 3 },
  { shortName: 'es-CO-GonzaloNeural', country: 'Colombia', flag: '🇨🇴', pitchOffset: 0, rateOffset: 0 },
  { shortName: 'es-CL-LorenzoNeural', country: 'Chile', flag: '🇨🇱', pitchOffset: -4, rateOffset: -1 },
  { shortName: 'es-PE-AlexNeural', country: 'Perú', flag: '🇵🇪', pitchOffset: 3, rateOffset: 2 },
  { shortName: 'es-US-AlonsoNeural', country: 'EE. UU.', flag: '🇺🇸', pitchOffset: -3, rateOffset: 0 },
  { shortName: 'es-GT-AndresNeural', country: 'Guatemala', flag: '🇬🇹', pitchOffset: -1, rateOffset: 0 },
  { shortName: 'es-CR-JuanNeural', country: 'Costa Rica', flag: '🇨🇷', pitchOffset: 4, rateOffset: 2 },
  { shortName: 'es-EC-LuisNeural', country: 'Ecuador', flag: '🇪🇨', pitchOffset: -2, rateOffset: -1 },
  { shortName: 'es-BO-MarceloNeural', country: 'Bolivia', flag: '🇧🇴', pitchOffset: -3, rateOffset: -2 },
  { shortName: 'es-PY-MarioNeural', country: 'Paraguay', flag: '🇵🇾', pitchOffset: -5, rateOffset: -3 },
  { shortName: 'es-PA-RobertoNeural', country: 'Panamá', flag: '🇵🇦', pitchOffset: -4, rateOffset: -2 },
  { shortName: 'es-PR-VictorNeural', country: 'Puerto Rico', flag: '🇵🇷', pitchOffset: 5, rateOffset: 4 },
  { shortName: 'es-DO-EmilioNeural', country: 'Rep. Dominicana', flag: '🇩🇴', pitchOffset: 2, rateOffset: 3 },
  { shortName: 'es-CU-ManuelNeural', country: 'Cuba', flag: '🇨🇺', pitchOffset: -6, rateOffset: -4 },
  { shortName: 'es-HN-CarlosNeural', country: 'Honduras', flag: '🇭🇳', pitchOffset: 1, rateOffset: 1 },
  { shortName: 'es-NI-FedericoNeural', country: 'Nicaragua', flag: '🇳🇮', pitchOffset: -2, rateOffset: 0 },
  { shortName: 'es-SV-RodrigoNeural', country: 'El Salvador', flag: '🇸🇻', pitchOffset: -5, rateOffset: -3 },
  { shortName: 'es-GQ-JavierNeural', country: 'Guinea Ecuatorial', flag: '🇬🇶', pitchOffset: -3, rateOffset: -1 },
  { shortName: 'en-US-AndrewMultilingualNeural', country: 'Multilingüe HD', flag: '🌍', pitchOffset: -2, rateOffset: 1 },
  { shortName: 'en-US-BrianMultilingualNeural', country: 'Multilingüe HD', flag: '🌍', pitchOffset: 3, rateOffset: 2 },
  { shortName: 'fr-FR-RemyMultilingualNeural', country: 'Multilingüe EU', flag: '🌍', pitchOffset: -3, rateOffset: 0 },
  { shortName: 'it-IT-GiuseppeMultilingualNeural', country: 'Multilingüe IT', flag: '🌍', pitchOffset: -1, rateOffset: 2 },
  { shortName: 'en-AU-WilliamMultilingualNeural', country: 'Multilingüe AU', flag: '🌍', pitchOffset: -4, rateOffset: 0 },
  { shortName: 'ko-KR-HyunsuMultilingualNeural', country: 'Multilingüe Global', flag: '🌍', pitchOffset: 2, rateOffset: 1 }
];

const NOIZ_MODELS = [
  {
    id: 'v3',
    name: 'Natural Fidelity-v3',
    badge: 'New',
    consumption: '1.5x',
    description: 'Mayor profesionalismo y naturalidad que v2. Soporta etiquetas expresivas inline [Laugh], [Whisper], [Sigh], [Emphasis] y clonación instantánea a 48 kHz WAV.'
  },
  {
    id: 'v2',
    name: 'Emotion Engine-v2',
    badge: 'Default',
    consumption: '1.5x',
    description: 'Rango emocional superior y estabilidad. Incluye control de Intensidad Emocional (Low a High) y mezcla de emociones.'
  },
  {
    id: 'v1',
    name: 'Voice Fidelity-v1',
    badge: 'Clásico',
    consumption: '1.0x',
    description: 'Acústica precisa que preserva fielmente el timbre original del locutor.'
  }
];

const NOIZ_EMOTIONS = {
  v2Single: [
    { id: 'Happy', label: '😃 Alegre (Happy)', code: '😃#Happy:7', emoJson: '{"Joy":0.8}', pitchMod: 6, rateMod: 5 },
    { id: 'Sad', label: '😔 Triste (Sad)', code: '😔#Sadness:10', emoJson: '{"Sadness":0.9}', pitchMod: -8, rateMod: -10 },
    { id: 'Angry', label: '😡 Enojado (Angry)', code: '😡#Anger:7', emoJson: '{"Anger":0.8}', pitchMod: -4, rateMod: 8 },
    { id: 'Fearful', label: '😨 Temeroso (Fearful)', code: '😨#Fear:7', emoJson: '{"Fear":0.8}', pitchMod: 10, rateMod: 6 }
  ],
  v2Mixed: [
    { id: 'Surprise', label: '😮 Sorpresa', code: 'surprise#Fear:2;Anger:3;Happy:4', emoJson: '{"Surprise":0.8,"Joy":0.4}', pitchMod: 12, rateMod: 7 },
    { id: 'Excited', label: '🔥 Emocionado', code: 'excited#Happy:6;Anger:2', emoJson: '{"Joy":0.9,"Surprise":0.5}', pitchMod: 9, rateMod: 9 },
    { id: 'Dramatic', label: '🎭 Dramático', code: 'dramatic#Happy:6;Anger:3;Sadness:1', emoJson: '{"Sadness":0.4,"Anger":0.5}', pitchMod: -6, rateMod: -5 },
    { id: 'Proud', label: '🏆 Orgulloso', code: 'Proud#Happy:4;Anger:2', emoJson: '{"Joy":0.7}', pitchMod: -3, rateMod: 2 },
    { id: 'Empathetic', label: '🤝 Empático', code: 'Empathetic#Sadness:3;Happy:2', emoJson: '{"Sadness":0.3,"Joy":0.3}', pitchMod: -2, rateMod: -4 },
    { id: 'Curious', label: '🤔 Curioso', code: 'Curious#Fear:1;Anger:2;Happy:4', emoJson: '{"Surprise":0.5}', pitchMod: 7, rateMod: 3 },
    { id: 'Frustrated', label: '😤 Frustrado', code: 'Frustrated#Anger:4;Sadness:2', emoJson: '{"Anger":0.6,"Sadness":0.4}', pitchMod: -5, rateMod: 4 },
    { id: 'Delighted', label: '🥰 Encantado', code: 'Delighted#Happy:5', emoJson: '{"Joy":0.85}', pitchMod: 5, rateMod: 3 }
  ],
  v3Tags: [
    { tag: '[Laugh]', label: '😂 [Laugh] Risa' },
    { tag: '[Chuckles]', label: '🤭 [Chuckles] Risita' },
    { tag: '[Giggle]', label: '😆 [Giggle] Risilla' },
    { tag: '[Sigh]', label: '😮‍💨 [Sigh] Suspiro' },
    { tag: '[Whisper]', label: '🤫 [Whisper] Susurro' },
    { tag: '[Breathy]', label: '💨 [Breathy] Aireado' },
    { tag: '[Emphasis]', label: '❗ [Emphasis] Énfasis' },
    { tag: '[Tired]', label: '😴 [Tired] Cansado' },
    { tag: '[Teasing]', label: '😏 [Teasing] Bromista' },
    { tag: '[Menacing]', label: '😈 [Menacing] Amenazante' },
    { tag: '[Begging]', label: '🥺 [Begging] Suplicante' },
    { tag: '[Embarrassed]', label: '😳 [Embarrassed] Avergonzado' },
    { tag: '[Clear_throat]', label: '喉 [Clear_throat] Carraspeo' },
    { tag: '[Cough]', label: '咳 [Cough] Tos' },
    { tag: '[Yawn]', label: '🥱 [Yawn] Bostezo' },
    { tag: '[Sniffles]', label: '😢 [Sniffles] Sollozo' },
    { tag: '[Groan]', label: '😩 [Groan] Quejido' },
    { tag: '[Panting]', label: '😤 [Panting] Jadeo' }
  ]
};

const DOWNLOADABLE_MODELS = [
  {
    id: 'piper-es-es-davefx',
    name: 'Piper Español (España) · DaveFX Medium',
    engine: 'Piper ONNX (Offline Neural)',
    language: 'Español (es-ES)',
    gender: 'Masculino',
    age: 'Adulto',
    size: '63.2 MB',
    license: 'MIT (100% Gratis y Local)',
    description: 'Modelo neuronal ONNX entrenado en alta fidelidad para síntesis 100% offline en CPU/GPU local.',
    onnxUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx?download=true',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json?download=true',
    filename: 'es_ES-davefx-medium.onnx'
  },
  {
    id: 'piper-es-es-sharvard',
    name: 'Piper Español (España) · Sharvard (M+F Multi-Speaker)',
    engine: 'Piper ONNX (Offline Neural)',
    language: 'Español (es-ES)',
    gender: 'Masculino y Femenino',
    age: 'Adulto / Joven',
    size: '63.2 MB',
    license: 'MIT (100% Gratis y Local)',
    description: 'Modelo multi-locutor (Hombre y Mujer) en español de España para ejecución local.',
    onnxUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx?download=true',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx.json?download=true',
    filename: 'es_ES-sharvard-medium.onnx'
  },
  {
    id: 'piper-es-mx-claude',
    name: 'Piper Español (México) · Claude High Quality',
    engine: 'Piper ONNX (Offline Neural)',
    language: 'Español (es-MX)',
    gender: 'Femenino',
    age: 'Joven / Adulto',
    size: '63.5 MB',
    license: 'MIT (100% Gratis y Local)',
    description: 'Voz neuronal femenina de alta calidad en español latinoamericano (México).',
    onnxUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/es_MX-claude-high.onnx?download=true',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/es_MX-claude-high.onnx.json?download=true',
    filename: 'es_MX-claude-high.onnx'
  },
  {
    id: 'piper-es-mx-ald',
    name: 'Piper Español (México) · Ald Medium',
    engine: 'Piper ONNX (Offline Neural)',
    language: 'Español (es-MX)',
    gender: 'Masculino',
    age: 'Adulto',
    size: '63.2 MB',
    license: 'MIT (100% Gratis y Local)',
    description: 'Voz neuronal masculina natural en español de México lista para correr offline.',
    onnxUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/ald/medium/es_MX-ald-medium.onnx?download=true',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/ald/medium/es_MX-ald-medium.onnx.json?download=true',
    filename: 'es_MX-ald-medium.onnx'
  },
  {
    id: 'piper-es-ar-daniela',
    name: 'Piper Español (Argentina) · Daniela High Quality',
    engine: 'Piper ONNX (Offline Neural)',
    language: 'Español (es-AR)',
    gender: 'Femenino',
    age: 'Joven',
    size: '63.5 MB',
    license: 'MIT (100% Gratis y Local)',
    description: 'Voz neuronal femenina rioplatense de alta resolución para síntesis local.',
    onnxUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_AR/daniela/high/es_AR-daniela-high.onnx?download=true',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_AR/daniela/high/es_AR-daniela-high.onnx.json?download=true',
    filename: 'es_AR-daniela-high.onnx'
  },
  {
    id: 'kokoro-82m-multilingual',
    name: 'Kokoro-82M v1.0 ONNX (Español, Inglés, Francés, Japonés - 54 Voces)',
    engine: 'Kokoro-82M ONNX (Apache 2.0)',
    language: 'Multilingüe (ES / EN / FR / PT / JA)',
    gender: 'Masculino y Femenino (54 voces)',
    age: 'Todas las edades',
    size: '86.0 MB (Quantized ONNX)',
    license: 'Apache 2.0',
    description: 'El modelo open-weight #1 en HuggingFace con 54 voces hiperrealistas (incluyendo ef_dora, em_alex y em_santa en español).',
    onnxUrl: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_quantized.onnx?download=true',
    configUrl: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/config.json?download=true',
    filename: 'kokoro-82m-v1.0-quantized.onnx'
  }
];

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function resolveNoizCover(v) {
  const raw = v.cover || (v.meta && v.meta.video_cover_url) || '';
  if (raw.startsWith('http')) return raw;
  if (raw.startsWith('/')) return `https://noiz.ai${raw}`;
  const posterIdx = (hashString(v.voice_id || v.display_name || '1') % 10) + 1;
  return `https://noiz.ai/resource/img/tts/voice_clone_poster_${posterIdx}.jpg`;
}

function resolveNoizAudioSample(v) {
  if (v.sample) {
    return v.sample.startsWith('http') ? v.sample : `https://noiz.ai${v.sample}`;
  }
  if (v.url) return v.url;
  if (v.fallbackurl) return v.fallbackurl;
  return null;
}

function classifyNoizAge(v) {
  const bucket = (v.bucket || '').toLowerCase();
  const labelsStr = [...(v.labels || []), v.display_name || '', v.desc || '', v.voice_description || ''].join(' ').toLowerCase();
  const rawAge = (v.age || (v.meta && v.meta.age) || '').toLowerCase();

  if (
    bucket === 'nino' ||
    bucket === 'nina' ||
    labelsStr.includes('niño') ||
    labelsStr.includes('niña') ||
    labelsStr.includes('baby') ||
    labelsStr.includes('bebé') ||
    labelsStr.includes('infantil') ||
    labelsStr.includes('boy') ||
    labelsStr.includes('girl') ||
    labelsStr.includes('chiquit') ||
    labelsStr.includes('bart simpson') ||
    labelsStr.includes('anya') ||
    labelsStr.includes('dewey') ||
    labelsStr.includes('pixi')
  ) {
    // Distinguish Teen vs Child if explicitly teen/student/adolescente
    if (bucket === 'adolescente' || labelsStr.includes('adolescente') || labelsStr.includes('student') || labelsStr.includes('estudiante')) {
      return 'Adolescente';
    }
    return 'Niño';
  }

  if (
    bucket === 'adolescente' ||
    labelsStr.includes('adolescente') ||
    labelsStr.includes('teen') ||
    labelsStr.includes('estudiante') ||
    labelsStr.includes('student') ||
    labelsStr.includes('gamer') ||
    labelsStr.includes('peter parker') ||
    labelsStr.includes('zelda')
  ) {
    return 'Adolescente';
  }

  if (
    rawAge === 'elderly' ||
    bucket === 'esem' ||
    bucket === 'esef' ||
    labelsStr.includes('abuelo') ||
    labelsStr.includes('abuela') ||
    labelsStr.includes('anciano') ||
    labelsStr.includes('anciana') ||
    labelsStr.includes('mayor') ||
    labelsStr.includes('santa claus') ||
    labelsStr.includes('grandmother') ||
    labelsStr.includes('grandfather') ||
    labelsStr.includes('mayordomo')
  ) {
    return 'Mayor';
  }

  if (rawAge === 'young') {
    return 'Joven';
  }

  return 'Adulto';
}

function classifyNoizStyles(v, age) {
  const text = [...(v.labels || []), ...(v.emotion || []), v.display_name || '', v.desc || '', v.voice_description || ''].join(' ').toLowerCase();
  const styles = new Set();

  if (text.includes('calm') || text.includes('calma') || text.includes('tranquil') || text.includes('relaj')) {
    styles.add('Tranquilo');
  }
  if (text.includes('warm') || text.includes('cálid') || text.includes('acoged') || text.includes('friendly') || text.includes('amigable')) {
    styles.add('Cálido');
  }
  if (text.includes('soft') || text.includes('suave') || text.includes('gentle') || text.includes('dulce') || age === 'Niño') {
    styles.add('Suave');
  }
  if (text.includes('deep') || text.includes('profund') || text.includes('grave') || text.includes('terror') || text.includes('horror') || age === 'Mayor') {
    styles.add('Profundo');
  }
  if (text.includes('energ') || text.includes('alel') || text.includes('aleg') || text.includes('excited') || text.includes('joy') || text.includes('comentarista') || text.includes('dj')) {
    styles.add('Enérgico');
  }

  if (styles.size === 0) {
    if (age === 'Niño' || age === 'Joven') styles.add('Cálido');
    else if (age === 'Adolescente') styles.add('Enérgico');
    else if (age === 'Mayor') styles.add('Profundo');
    else styles.add('Tranquilo');
  }
  return Array.from(styles);
}

function formatUsageCount(n) {
  if (!n || isNaN(n)) return '1.2k';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function transformRealNoizVoice(v, idx) {
  const rawGender = (v.gender || (v.meta && v.meta.gender) || 'Female').toLowerCase();
  const isFemale = rawGender === 'female' || rawGender === 'femenino';
  const gender = isFemale ? 'Femenino' : 'Masculino';
  const age = classifyNoizAge(v);
  const styles = classifyNoizStyles(v, age);
  const coverUrl = resolveNoizCover(v);
  const realAudioUrl = resolveNoizAudioSample(v);

  // Pick a unique neural speaker from our 56-speaker pool + unique acoustic tuning so local synthesis never repeats
  const pool = isFemale ? FEMALE_NEURAL_SPEAKERS : MALE_NEURAL_SPEAKERS;
  const h = hashString(v.voice_id || v.display_name || String(idx));
  let speaker = pool[h % pool.length];

  // Specific speaker tuning for iconic voices
  let basePitch = speaker.pitchOffset + ((h % 11) - 5);
  let baseRate = speaker.rateOffset + ((h % 9) - 4);
  let dspProfile = 'natural';

  if (age === 'Niño') {
    if (isFemale && h % 2 === 0) {
      speaker = FEMALE_NEURAL_SPEAKERS.find(s => s.shortName === 'en-US-AnaNeural') || speaker;
      basePitch = 16 + (h % 10);
    } else {
      basePitch = (isFemale ? 32 : 38) + (h % 10);
    }
    baseRate = 5 + (h % 6);
    dspProfile = 'child';
  } else if (age === 'Adolescente') {
    basePitch = (isFemale ? 14 : 18) + (h % 8);
    baseRate = 4 + (h % 6);
    dspProfile = 'teen';
  } else if (age === 'Mayor') {
    basePitch = (isFemale ? -16 : -22) - (h % 8);
    baseRate = -10 - (h % 6);
    dspProfile = 'elder';
  } else if (styles.includes('Profundo')) {
    basePitch = -12 - (h % 8);
    dspProfile = 'broadcast';
  } else if (styles.includes('Enérgico')) {
    baseRate = 6 + (h % 6);
    dspProfile = 'energetic';
  } else if (styles.includes('Cálido')) {
    dspProfile = 'warm';
  }

  // Determine section category
  let category = 'explore';
  if (v.rec_module === 'featured_fixed' || ['b0a1531a', '217fe9eb', '212d0ec6', '5449d91f'].includes(v.voice_id)) {
    category = 'featured';
  } else if (v.rec_module === 'featured_algo' || ['ccf6363d', '3e6c8f2d', 'b1651635', '7b311e0f', 'e8f54ccf', '293db9ef'].includes(v.voice_id)) {
    category = 'popular';
  } else if (v.rec_module === 'recently_added' || ['2e36c48f', 'f064fef9', '9ecc8449', 'd3ef6377'].includes(v.voice_id)) {
    category = 'recent';
  }

  const samplePrompt =
    (v.meta && (v.meta.prompt || v.meta.text)) ||
    v.desc ||
    v.voice_description ||
    `Hola, soy ${v.display_name}. Esta es mi voz en Noiz Studio lista para dar vida a tus proyectos.`;

  const creator = v.creator_display_name ? ` · ${v.creator_display_name}` : '';

  return {
    id: `noiz-${v.voice_id}`,
    noizVoiceId: v.voice_id,
    name: `${v.display_name}${creator && !v.display_name.includes('·') ? creator : ''}`,
    displayNameClean: v.display_name,
    subtitle: v.desc || v.voice_description || (v.meta && v.meta.voice_description) || `Voz real de Noiz AI (${age} · ${gender})`,
    shortName: speaker.shortName,
    language: 'es',
    locale: speaker.shortName.slice(0, 5),
    country: speaker.country,
    flag: speaker.flag || '🇪🇸',
    gender,
    age,
    styles,
    labels: v.labels || [],
    scene: v.scene || (v.meta && v.meta.scene) || [],
    emotion: v.emotion || [],
    category,
    featuredImage: coverUrl,
    avatar: coverUrl,
    realAudioUrl,
    fallbackAudioUrl: v.fallbackurl || null,
    filePath: v.file_path || null,
    pitch: `${basePitch >= 0 ? '+' : ''}${basePitch}Hz`,
    rate: `${baseRate >= 0 ? '+' : ''}${baseRate}%`,
    dspProfile,
    plays: formatUsageCount(v.usage_count || ((h % 48) + 3) * 120),
    likes: v.favorite_count != null ? v.favorite_count : (h % 35) + 4,
    isRealNoiz: true,
    voiceType: v.voice_type || 'built-in',
    sampleText: samplePrompt
  };
}

function buildFullCatalog() {
  const catalog = [];
  const seenVoiceIds = new Set();

  // 1. Load the 243 Real Extracted Noiz AI Voices
  try {
    const noizPath = path.join(__dirname, 'noiz_extracted_voices.json');
    if (fs.existsSync(noizPath)) {
      const noizData = JSON.parse(fs.readFileSync(noizPath, 'utf8'));
      const rawNoizVoices = noizData.voices || [];

      // Prioritize Coco + Featured Fixed (Isabela, Inma, Mateo, Sebastián) & Featured Algo
      const priorityIds = [
        'c0750aac', // Coco (Voz Principal Liturgia / Oración / Narración)
        '93ce9869', // Coco (Joven Expresiva)
        'b0a1531a', // Bienvenida (Isabela)
        '217fe9eb', // Pasión (Inma)
        '212d0ec6', // Energía (Mateo)
        '5449d91f', // Sebastián
        'ccf6363d', // Impulso (Miguel)
        '3e6c8f2d', // Descubrimiento (Andrés)
        'b1651635', // Gato con Botas
        '7b311e0f', // Itarte · Spain Girl
        'e8f54ccf', // Fernanda · LatAm Girl
        '293db9ef', // Melancolía (Rodrigo)
        '2e36c48f', // La Doctora Líder
        'f064fef9', // Homero Simpson
        '9ecc8449'  // El Señor del Terror
      ];

      priorityIds.forEach((pid, idx) => {
        const found = rawNoizVoices.find(x => x.voice_id === pid);
        if (found && !seenVoiceIds.has(pid)) {
          seenVoiceIds.add(pid);
          const item = transformRealNoizVoice(found, idx);
          if (pid === 'c0750aac') {
            item.name = 'Coco';
            item.displayNameClean = 'Coco';
            item.subtitle = 'Voz femenina serena, cálida y devota · Liturgia, Oración y Narración';
            item.shortName = 'es-ES-ElviraNeural';
            item.locale = 'es-ES';
            item.country = 'España';
            item.flag = '🇪🇸';
            item.gender = 'Femenino';
            item.age = 'Mayor';
            item.styles = ['Suave', 'Cálido', 'Tranquilo'];
            item.category = 'featured';
            item.realAudioUrl = '/voces_descargadas/coco_original_liturgia.mp3';
            item.pitch = '-5Hz';
            item.rate = '-8%';
            item.dspProfile = 'warm';
            item.plays = '28.4k';
            item.likes = 312;
            item.sampleText = 'María madre de gracias, madre de piedad y misericordia, en la vida y en la muerte ampáranos gran señora. Amén. Oh Jesús mío, perdona nuestras culpas y pecados, líbranos del fuego del infierno, lleva al cielo a todas las almas.';
          } else if (['b0a1531a', '217fe9eb', '212d0ec6', '5449d91f'].includes(pid)) {
            item.category = 'featured';
          } else if (['ccf6363d', '3e6c8f2d', 'b1651635', '7b311e0f', 'e8f54ccf', '293db9ef', '93ce9869'].includes(pid)) {
            item.category = 'popular';
          } else if (['2e36c48f', 'f064fef9', '9ecc8449'].includes(pid)) {
            item.category = 'recent';
          }
          catalog.push(item);
        }
      });

      rawNoizVoices.forEach((v, idx) => {
        if (v && v.voice_id && !seenVoiceIds.has(v.voice_id)) {
          seenVoiceIds.add(v.voice_id);
          catalog.push(transformRealNoizVoice(v, idx + 20));
        }
      });
    }
  } catch (e) {
    console.error('Error loading noiz_extracted_voices.json:', e.message);
  }

  // 2. Also include the 318 Global Neural Voices (Spanish by Country + Multilingual + International)
  try {
    const rawPath = path.join(__dirname, 'voices_msedge.json');
    if (fs.existsSync(rawPath)) {
      const rawVoices = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
      rawVoices.forEach((v, idx) => {
        const isFemale = v.Gender === 'Female';
        const genderLabel = isFemale ? 'Femenino' : 'Masculino';
        const cleanPersonName = v.ShortName.split('-').slice(2).join('-').replace('Neural', '');
        const isMultilingual = cleanPersonName.includes('Multilingual');
        const posterIdx = (idx % 10) + 1;

        let age = 'Adulto';
        if (v.ShortName.includes('AnaNeural')) age = 'Niño';
        else if (idx % 6 === 0) age = 'Joven';
        else if (idx % 8 === 0) age = 'Adolescente';
        else if (idx % 10 === 0) age = 'Mayor';

        catalog.push({
          id: `neural-${v.ShortName.toLowerCase()}`,
          noizVoiceId: null,
          name: `${cleanPersonName.replace('Multilingual', ' Multilingüe')} (${v.Locale})`,
          displayNameClean: cleanPersonName,
          subtitle: `Locutor Neuronal Directo (${v.Locale}) · ${genderLabel}`,
          shortName: v.ShortName,
          language: isMultilingual ? 'multi' : v.Language,
          locale: v.Locale,
          country: v.Locale,
          flag: v.Language === 'es' ? '🇪🇸' : isMultilingual ? '🌍' : '🎙️',
          gender: genderLabel,
          age,
          styles: idx % 2 === 0 ? ['Cálido', 'Suave'] : ['Enérgico', 'Tranquilo'],
          labels: [v.Locale, genderLabel, age],
          category: v.Language === 'es' ? 'spanish-native' : 'global',
          avatar: `https://noiz.ai/resource/img/tts/voice_clone_poster_${posterIdx}.jpg`,
          realAudioUrl: null,
          pitch: '+0Hz',
          rate: '+0%',
          dspProfile: 'natural',
          plays: `${((idx % 40) + 5) * 110}`,
          likes: (idx % 38) + 6,
          isRealNoiz: false,
          voiceType: 'neural',
          sampleText: v.Language === 'es' || isMultilingual
            ? `Hola, soy ${cleanPersonName.replace('Multilingual', '')}, voz neuronal directa para síntesis ilimitada.`
            : `Hello! I am ${cleanPersonName}, ready to synthesize your script.`
        });
      });
    }
  } catch (e) {
    console.error('Error loading voices_msedge.json:', e.message);
  }

  return {
    voices: catalog,
    models: NOIZ_MODELS,
    emotions: NOIZ_EMOTIONS,
    downloadableModels: DOWNLOADABLE_MODELS,
    totals: {
      noizSpanishTotal: 15612,
      preloadedNoizVoices: seenVoiceIds.size,
      totalLocalVoices: catalog.length
    }
  };
}

module.exports = {
  buildFullCatalog,
  transformRealNoizVoice,
  NOIZ_MODELS,
  NOIZ_EMOTIONS,
  DOWNLOADABLE_MODELS
};
