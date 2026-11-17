const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { buildFullCatalog, transformRealNoizVoice } = require('./voices_catalog');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and Private Network Access (so https://tts.laantillana.com in IIS can call http://localhost:3000 seamlessly)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});
app.use(cors());
app.use(express.json({ limit: '35mb' }));

// Local directories
const DIRS = {
  root: __dirname,
  public: path.join(__dirname, 'public'),
  audioDownloads: path.join(__dirname, 'descargas_audio'),
  voicePacks: path.join(__dirname, 'voces_descargadas'),
  onnxModels: path.join(__dirname, 'modelos_onnx'),
  data: path.join(__dirname, 'data')
};

Object.values(DIRS).forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Serve static frontend from root (for IIS compatibility) and public, plus downloaded files
app.use(express.static(DIRS.root));
app.use(express.static(DIRS.public));
app.use('/downloads', express.static(DIRS.audioDownloads));
app.use('/descargas_audio', express.static(DIRS.audioDownloads));
app.use('/voice-packs', express.static(DIRS.voicePacks));
app.use('/voces_descargadas', express.static(DIRS.voicePacks));
app.use('/onnx-models', express.static(DIRS.onnxModels));
app.use('/modelos_onnx', express.static(DIRS.onnxModels));

// User data persistence
const USER_DATA_FILE = path.join(DIRS.data, 'userdata.json');
function loadUserData() {
  try {
    if (fs.existsSync(USER_DATA_FILE)) {
      return JSON.parse(fs.readFileSync(USER_DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading userdata.json:', e.message);
  }
  return {
    favorites: ['noiz-b0a1531a', 'noiz-217fe9eb', 'noiz-212d0ec6', 'noiz-5449d91f', 'noiz-95a123f0', 'noiz-4439e68a'],
    customVoices: [],
    history: [],
    noizApiKey: ''
  };
}

function saveUserData(data) {
  fs.writeFileSync(USER_DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Build catalog in memory
const catalogData = buildFullCatalog();
const modelDownloadProgress = {};

// Expressive V3 tag processor for local neural synthesis
function preprocessV3ExpressiveText(rawText) {
  if (!rawText) return '';
  return rawText
    .replace(/\[Laugh\]/gi, ' ¡ja, ja, ja! ')
    .replace(/\[Chuckles\]/gi, ' je, je ')
    .replace(/\[Giggle\]/gi, ' ji, ji, ji ')
    .replace(/\[Sigh\]/gi, ' ... ay ... ')
    .replace(/\[Whisper\]/gi, ' ... ')
    .replace(/\[Breathy\]/gi, ' ... ')
    .replace(/\[Emphasis\]/gi, ' ')
    .replace(/\[Tired\]/gi, ' ... uff ... ')
    .replace(/\[Teasing\]/gi, ' ')
    .replace(/\[Menacing\]/gi, ' ... ')
    .replace(/\[Begging\]/gi, ' por favor, ')
    .replace(/\[Embarrassed\]/gi, ' eh... ')
    .replace(/\[Clear_throat\]|\[Clear throat\]/gi, ' ejem, ')
    .replace(/\[Cough\]/gi, ' ¡cof, cof! ')
    .replace(/\[Yawn\]|\[Yawning\]/gi, ' ... aah ... ')
    .replace(/\[Sniffles\]|\[Sniffing\]/gi, ' ... snif ... ')
    .replace(/\[Groan\]/gi, ' ... mmm ... ')
    .replace(/\[Panting\]/gi, ' ... ah, ah ... ')
    .replace(/\[Pause\s*[\d.]+s?\]/gi, ' ... ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Synthesize MP3 buffer with MsEdgeTTS
async function synthesizeEdgeMp3(text, voiceShortName, pitch = '+0Hz', rate = '+0%', volume = '+0%') {
  const cleanText = preprocessV3ExpressiveText(text);
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(
      voiceShortName || 'es-CO-SalomeNeural',
      OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
    );
    const { audioStream } = tts.toStream(cleanText || 'Hola', {
      pitch: pitch || '+0Hz',
      rate: rate || '+0%',
      volume: volume || '+0%'
    });
    const chunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on('data', chunk => chunks.push(chunk));
      audioStream.on('end', resolve);
      audioStream.on('error', reject);
    });
    return Buffer.concat(chunks);
  } finally {
    try {
      tts.close();
    } catch (_) {}
  }
}

// Call Official Noiz AI TTS API (/v1/text-to-speech or /v1/guest/text-to-speech)
async function synthesizeViaNoizCloud({
  text,
  noizVoiceId,
  apiKey,
  modelId = 'v2',
  speed = 1.0,
  outputFormat = 'mp3',
  emo = '',
  filterType = 'studio',
  trimSilence = false,
  similarityEnh = false,
  useGuest = false
}) {
  const form = new FormData();
  form.append('text', text);
  form.append('output_format', outputFormat === 'wav' ? 'wav' : 'mp3');
  form.append('speed', String(speed || 1.0));

  let endpoint = 'https://noiz.ai/v1/text-to-speech';
  const headers = {};

  if (useGuest || !apiKey) {
    endpoint = 'https://noiz.ai/v1/guest/text-to-speech';
    form.append('text', text.slice(0, 400));
    if (filterType && ['telephone', 'radio', 'hall', 'studio'].includes(filterType)) {
      form.append('filter_type', filterType);
    }
  } else {
    headers['Authorization'] = apiKey.trim();
    if (noizVoiceId) form.append('voice_id', noizVoiceId);
    if (modelId && ['v1', 'v2', 'v3'].includes(modelId)) {
      form.append('model_id', modelId);
    }
    if (emo) form.append('emo', typeof emo === 'string' ? emo : JSON.stringify(emo));
    if (trimSilence) form.append('trim_silence', 'true');
    if (similarityEnh) form.append('similarity_enh', 'true');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: form
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Noiz Cloud API HTTP ${response.status}: ${errText.slice(0, 180)}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const json = await response.json();
    throw new Error(json.message || json.error || JSON.stringify(json));
  }

  const arrBuf = await response.arrayBuffer();
  return Buffer.from(arrBuf);
}

// Follow redirects to download a file to disk
function downloadFileWithRedirects(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const request = (currentUrl, redirectCount = 0) => {
      if (redirectCount > 10) {
        return reject(new Error('Too many redirects'));
      }
      https.get(currentUrl, { headers: { 'User-Agent': 'Mozilla/5.0 NoizLocalStudio/2.0' } }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const nextUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, currentUrl).toString();
          res.resume();
          return request(nextUrl, redirectCount + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} al descargar ${currentUrl}`));
        }
        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        const fileStream = fs.createWriteStream(destPath);

        res.on('data', chunk => {
          downloadedBytes += chunk.length;
          if (onProgress) {
            onProgress(downloadedBytes, totalBytes);
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => resolve({ downloadedBytes, totalBytes }));
        });

        fileStream.on('error', err => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }).on('error', reject);
    };
    request(url);
  });
}

// GET /api/catalog
app.get('/api/catalog', (req, res) => {
  const userData = loadUserData();
  const downloadedPacks = fs.existsSync(DIRS.voicePacks)
    ? fs.readdirSync(DIRS.voicePacks).filter(f => f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.json'))
    : [];
  const downloadedModels = fs.existsSync(DIRS.onnxModels)
    ? fs.readdirSync(DIRS.onnxModels)
    : [];
  const downloadedAudios = fs.existsSync(DIRS.audioDownloads)
    ? fs.readdirSync(DIRS.audioDownloads).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'))
    : [];

  res.json({
    voices: [...userData.customVoices, ...catalogData.voices],
    models: catalogData.models,
    emotions: catalogData.emotions,
    totals: catalogData.totals,
    downloadableModels: catalogData.downloadableModels.map(m => ({
      ...m,
      isDownloaded: downloadedModels.includes(m.filename),
      localPath: path.join(DIRS.onnxModels, m.filename),
      progress: modelDownloadProgress[m.id] || null
    })),
    paths: {
      root: __dirname,
      audioDownloads: DIRS.audioDownloads,
      voicePacks: DIRS.voicePacks,
      onnxModels: DIRS.onnxModels
    },
    stats: {
      totalVoices: catalogData.voices.length + userData.customVoices.length,
      noizSpanishTotal: 15612,
      downloadedAudiosCount: downloadedAudios.length,
      downloadedPacksCount: Math.floor(downloadedPacks.length / 2),
      downloadedModelsCount: downloadedModels.filter(f => f.endsWith('.onnx')).length
    },
    userData: {
      ...userData,
      hasNoizApiKey: Boolean(userData.noizApiKey && userData.noizApiKey.trim())
    }
  });
});

// GET /api/noiz/explore — Live proxy to https://noiz.ai/api/v1/voice-library/explore (15,612+ Spanish voices)
app.get('/api/noiz/explore', async (req, res) => {
  try {
    const {
      skip = 0,
      limit = 24,
      language_type = 'es',
      keyword = '',
      age = '',
      gender = '',
      scene = '',
      emotion = ''
    } = req.query;

    const params = new URLSearchParams({
      skip: String(skip),
      limit: String(limit),
      language_type: String(language_type)
    });
    if (keyword) params.set('keyword', String(keyword));
    if (age && age !== 'all') params.set('age', String(age));
    if (gender && gender !== 'all') params.set('gender', String(gender));
    if (scene) params.set('scene', String(scene));
    if (emotion) params.set('emotion', String(emotion));

    const url = `https://noiz.ai/api/v1/voice-library/explore?${params.toString()}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    const json = await response.json();
    const rawList = (json.data && json.data.voices) || json.voices || [];
    const totalCount = (json.data && json.data.total_count) || json.total_count || rawList.length;

    const transformed = rawList.map((v, i) => transformRealNoizVoice(v, i + Number(skip)));

    res.json({
      success: true,
      totalCount,
      voices: transformed
    });
  } catch (err) {
    res.status(500).json({ error: 'Error consultando biblioteca en vivo de Noiz.ai: ' + err.message });
  }
});

// POST /api/noiz/emotion-enhance — Auto-annotate script with Noiz AI V3 expressive tags
app.post('/api/noiz/emotion-enhance', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Texto vacío.' });
    }

    const userData = loadUserData();
    if (userData.noizApiKey && userData.noizApiKey.trim()) {
      try {
        const cloudRes = await fetch('https://noiz.ai/v1/emotion-enhance', {
          method: 'POST',
          headers: {
            'Authorization': userData.noizApiKey.trim(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ text: text.trim() })
        });
        if (cloudRes.ok) {
          const data = await cloudRes.json();
          const enhanced = (data.data && data.data.text) || data.text;
          if (enhanced) {
            return res.json({ success: true, enhancedText: enhanced, source: 'noiz-cloud' });
          }
        }
      } catch (_) {}
    }

    // Intelligent local V3 expressive tag enhancer
    const sentences = text.trim().split(/(?<=[.!?¡¿])\s+/);
    const enhancedSentences = sentences.map((s, idx) => {
      const lower = s.toLowerCase();
      if (lower.includes('ja, ja') || lower.includes('jaja') || lower.includes('divertid') || lower.includes('increíble') || lower.includes('feliz')) {
        return `[Chuckles] ${s}`;
      }
      if (lower.includes('secreto') || lower.includes('silencio') || lower.includes('oscuridad') || lower.includes('noche') || lower.includes('miedo')) {
        return `[Whisper] ${s} [Sigh]`;
      }
      if (lower.includes('triste') || lower.includes('recuerdo') || lower.includes('años') || lower.includes('jamás')) {
        return `[Sigh] ${s}`;
      }
      if (s.includes('¡') || s.includes('!')) {
        return `[Emphasis] ${s}`;
      }
      if (idx === 0) {
        return `[Clear_throat] ${s}`;
      }
      return s;
    });

    res.json({
      success: true,
      enhancedText: enhancedSentences.join(' '),
      source: 'local-ai'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tts/synthesize — Single block or full text synthesis
app.post('/api/tts/synthesize', async (req, res) => {
  try {
    const {
      text,
      voiceId,
      noizVoiceId,
      voiceName,
      shortName,
      pitch = '+0Hz',
      rate = '+0%',
      speed = 1.0,
      volume = '+0%',
      modelId = 'v2',
      emo = '',
      filterType = 'studio',
      outputFormat = 'mp3',
      trimSilence = false,
      similarityEnh = false,
      dspProfile = 'natural',
      engineMode = 'auto', // 'auto' | 'noiz-cloud' | 'noiz-guest' | 'local-neural'
      isPreview = false
    } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'El texto no puede estar vacío.' });
    }

    const userData = loadUserData();
    const apiKey = req.body.apiKey || userData.noizApiKey || '';

    let audioBuffer = null;
    let usedEngine = 'local-neural';
    let ext = 'mp3';

    // Try Noiz Cloud API if requested or if API Key is configured
    if ((engineMode === 'noiz-cloud' || (engineMode === 'auto' && apiKey)) && apiKey) {
      try {
        audioBuffer = await synthesizeViaNoizCloud({
          text: text.trim(),
          noizVoiceId: noizVoiceId || (voiceId ? voiceId.replace(/^noiz-/, '') : ''),
          apiKey,
          modelId,
          speed,
          outputFormat,
          emo,
          filterType,
          trimSilence,
          similarityEnh,
          useGuest: false
        });
        usedEngine = `noiz-cloud-${modelId}`;
        ext = outputFormat === 'wav' ? 'wav' : 'mp3';
      } catch (cloudErr) {
        console.warn('Noiz Cloud fallback to local neural:', cloudErr.message);
      }
    } else if (engineMode === 'noiz-guest') {
      try {
        audioBuffer = await synthesizeViaNoizCloud({
          text: text.trim(),
          apiKey: '',
          speed,
          outputFormat: 'mp3',
          filterType,
          useGuest: true
        });
        usedEngine = 'noiz-guest';
      } catch (guestErr) {
        console.warn('Noiz Guest fallback to local neural:', guestErr.message);
      }
    }

    // Unlimited Local Neural Engine (with 56 distinct speakers + V3 tag processor + speed/pitch/emotion prosody)
    if (!audioBuffer) {
      let computedRate = rate || '+0%';
      if (speed && speed !== 1.0 && (!rate || rate === '+0%')) {
        const pct = Math.round((Number(speed) - 1.0) * 100);
        computedRate = `${pct >= 0 ? '+' : ''}${pct}%`;
      }
      audioBuffer = await synthesizeEdgeMp3(text.trim(), shortName, pitch, computedRate, volume);
      usedEngine = 'local-neural';
      ext = 'mp3';
    }

    const safeVoiceName = (voiceName || voiceId || 'voz')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 32);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const prefix = isPreview ? 'preview' : 'tts';
    const filename = `${prefix}_${safeVoiceName}_${timestamp}.${ext}`;
    const filePath = path.join(DIRS.audioDownloads, filename);

    fs.writeFileSync(filePath, audioBuffer);

    const historyEntry = {
      id: `gen-${Date.now()}`,
      text: text.trim().slice(0, 400),
      voiceId: voiceId || shortName,
      noizVoiceId: noizVoiceId || null,
      voiceName: voiceName || shortName,
      shortName,
      modelId,
      pitch,
      rate,
      speed,
      dspProfile,
      usedEngine,
      filename,
      audioUrl: `/descargas_audio/${filename}`,
      localPath: filePath,
      sizeKB: Math.round((audioBuffer.length / 1024) * 10) / 10,
      createdAt: new Date().toISOString(),
      isPreview
    };

    if (!isPreview) {
      userData.history.unshift(historyEntry);
      userData.history = userData.history.slice(0, 100);
      saveUserData(userData);
    }

    res.json({
      success: true,
      ...historyEntry
    });
  } catch (error) {
    console.error('Error en síntesis TTS:', error);
    res.status(500).json({
      error: 'Error al sintetizar la voz: ' + (error.message || 'Error desconocido')
    });
  }
});

// POST /api/tts/synthesize-dialogue — Multi-paragraph / Multi-speaker dialogue synthesis
app.post('/api/tts/synthesize-dialogue', async (req, res) => {
  try {
    const { blocks } = req.body;
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return res.status(400).json({ error: 'No hay bloques de diálogo para generar.' });
    }

    const buffers = [];
    const speakerNames = [];

    for (const b of blocks) {
      if (!b.text || !b.text.trim()) continue;
      const buf = await synthesizeEdgeMp3(
        b.text.trim(),
        b.shortName || 'es-CO-SalomeNeural',
        b.pitch || '+0Hz',
        b.rate || '+0%'
      );
      buffers.push(buf);
      if (b.voiceName && !speakerNames.includes(b.voiceName)) {
        speakerNames.push(b.voiceName);
      }
    }

    if (buffers.length === 0) {
      return res.status(400).json({ error: 'Escribe texto en al menos un bloque de diálogo.' });
    }

    const combinedBuffer = Buffer.concat(buffers);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `dialogo_multivoz_${timestamp}.mp3`;
    const filePath = path.join(DIRS.audioDownloads, filename);
    fs.writeFileSync(filePath, combinedBuffer);

    const historyEntry = {
      id: `dlg-${Date.now()}`,
      text: blocks.map(b => `[${b.voiceName}]: ${b.text}`).join(' | ').slice(0, 400),
      voiceId: 'multi-speaker',
      voiceName: `Diálogo (${speakerNames.slice(0, 3).join(', ')})`,
      shortName: 'multi',
      modelId: 'v3',
      usedEngine: 'multi-speaker-studio',
      filename,
      audioUrl: `/descargas_audio/${filename}`,
      localPath: filePath,
      sizeKB: Math.round((combinedBuffer.length / 1024) * 10) / 10,
      createdAt: new Date().toISOString(),
      isPreview: false
    };

    const userData = loadUserData();
    userData.history.unshift(historyEntry);
    userData.history = userData.history.slice(0, 100);
    saveUserData(userData);

    res.json({
      success: true,
      ...historyEntry
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tts/save-wav — Save client-side DSP processed WAV file directly into descargas_audio
app.post('/api/tts/save-wav', (req, res) => {
  try {
    const { base64Wav, voiceName } = req.body;
    if (!base64Wav) {
      return res.status(400).json({ error: 'No se recibió audio WAV.' });
    }
    const cleanBase64 = base64Wav.replace(/^data:audio\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const safeName = (voiceName || 'voz_dsp').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `tts_dsp_${safeName}_${timestamp}.wav`;
    const filePath = path.join(DIRS.audioDownloads, filename);
    fs.writeFileSync(filePath, buffer);

    res.json({
      success: true,
      filename,
      audioUrl: `/descargas_audio/${filename}`,
      localPath: filePath,
      sizeKB: Math.round((buffer.length / 1024) * 10) / 10
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/voices/download-pack — Download REAL Noiz AI original audio (if available) + synthesized sample + JSON profile to voces_descargadas
app.post('/api/voices/download-pack', async (req, res) => {
  try {
    const { voice } = req.body;
    if (!voice) {
      return res.status(400).json({ error: 'Datos de voz inválidos.' });
    }

    const safeId = (voice.id || voice.noizVoiceId || voice.shortName || 'voz').replace(/[^a-zA-Z0-9_-]/g, '_');
    const jsonFilename = `${safeId}_perfil.json`;
    const jsonPath = path.join(DIRS.voicePacks, jsonFilename);

    let savedAudioFilename = `${safeId}_noiz_original.mp3`;
    let savedAudioPath = path.join(DIRS.voicePacks, savedAudioFilename);
    let downloadedRealNoiz = false;

    // 1. First try downloading the REAL original Noiz AI audio file from storage.googleapis.com / noiz.ai
    const realUrl = voice.realAudioUrl || voice.fallbackAudioUrl;
    if (realUrl && realUrl.startsWith('http')) {
      try {
        const ext = realUrl.includes('.wav') ? 'wav' : 'mp3';
        savedAudioFilename = `${safeId}_noiz_original.${ext}`;
        savedAudioPath = path.join(DIRS.voicePacks, savedAudioFilename);
        await downloadFileWithRedirects(realUrl, savedAudioPath);
        downloadedRealNoiz = true;
      } catch (dlErr) {
        console.warn('Fallback to local synthesis for voice pack:', dlErr.message);
      }
    }

    // 2. If no remote audio or download failed, synthesize local sample
    if (!downloadedRealNoiz) {
      savedAudioFilename = `${safeId}_muestra.mp3`;
      savedAudioPath = path.join(DIRS.voicePacks, savedAudioFilename);
      const sampleText = voice.sampleText || `Hola, soy ${voice.name}. Esta es mi muestra de voz descargada en local.`;
      const mp3Buffer = await synthesizeEdgeMp3(
        sampleText,
        voice.shortName,
        voice.pitch || '+0Hz',
        voice.rate || '+0%'
      );
      fs.writeFileSync(savedAudioPath, mp3Buffer);
    }

    fs.writeFileSync(jsonPath, JSON.stringify({
      ...voice,
      downloadedRealNoizAudio: downloadedRealNoiz,
      downloadedAt: new Date().toISOString(),
      localAudioFile: savedAudioPath
    }, null, 2), 'utf8');

    res.json({
      success: true,
      voiceId: voice.id,
      downloadedRealNoiz,
      mp3Url: `/voces_descargadas/${savedAudioFilename}`,
      jsonUrl: `/voces_descargadas/${jsonFilename}`,
      localMp3Path: savedAudioPath,
      localJsonPath: jsonPath,
      folderPath: DIRS.voicePacks
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/voices/download-batch — Download a batch of voices (including their real Noiz AI audio files) to local folder
app.post('/api/voices/download-batch', async (req, res) => {
  try {
    const { voices } = req.body;
    if (!Array.isArray(voices) || voices.length === 0) {
      return res.status(400).json({ error: 'Lista de voces vacía.' });
    }

    const results = [];
    for (const voice of voices.slice(0, 12)) {
      try {
        const safeId = (voice.id || voice.noizVoiceId || voice.shortName).replace(/[^a-zA-Z0-9_-]/g, '_');
        const realUrl = voice.realAudioUrl || voice.fallbackAudioUrl;
        const ext = realUrl && realUrl.includes('.wav') ? 'wav' : 'mp3';
        const audioFilename = `${safeId}_noiz.${ext}`;
        const jsonFilename = `${safeId}_perfil.json`;
        const audioPath = path.join(DIRS.voicePacks, audioFilename);
        const jsonPath = path.join(DIRS.voicePacks, jsonFilename);

        if (!fs.existsSync(audioPath)) {
          if (realUrl && realUrl.startsWith('http')) {
            try {
              await downloadFileWithRedirects(realUrl, audioPath);
            } catch (_) {
              const buf = await synthesizeEdgeMp3(
                voice.sampleText || `Hola, soy ${voice.name}.`,
                voice.shortName,
                voice.pitch || '+0Hz',
                voice.rate || '+0%'
              );
              fs.writeFileSync(audioPath, buf);
            }
          } else {
            const buf = await synthesizeEdgeMp3(
              voice.sampleText || `Hola, soy ${voice.name}.`,
              voice.shortName,
              voice.pitch || '+0Hz',
              voice.rate || '+0%'
            );
            fs.writeFileSync(audioPath, buf);
          }
        }

        fs.writeFileSync(jsonPath, JSON.stringify({
          ...voice,
          downloadedAt: new Date().toISOString(),
          localSamplePath: audioPath
        }, null, 2), 'utf8');
        results.push({ id: voice.id, name: voice.name, audioPath });
      } catch (innerErr) {
        console.warn(`Warning skipping voice ${voice.id}:`, innerErr.message);
      }
    }

    res.json({
      success: true,
      count: results.length,
      folderPath: DIRS.voicePacks,
      results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/models/download — Download ONNX model from HuggingFace to modelos_onnx
app.post('/api/models/download', async (req, res) => {
  const { modelId } = req.body;
  const model = catalogData.downloadableModels.find(m => m.id === modelId);
  if (!model) {
    return res.status(404).json({ error: 'Modelo no encontrado en el catálogo.' });
  }

  const onnxDest = path.join(DIRS.onnxModels, model.filename);
  const configDest = path.join(DIRS.onnxModels, `${model.filename}.json`);

  if (modelDownloadProgress[modelId] && modelDownloadProgress[modelId].status === 'downloading') {
    return res.json({ status: 'downloading', progress: modelDownloadProgress[modelId] });
  }

  modelDownloadProgress[modelId] = {
    status: 'downloading',
    percent: 0,
    downloadedMB: 0,
    totalMB: 0,
    localPath: onnxDest
  };

  (async () => {
    try {
      if (model.configUrl) {
        await downloadFileWithRedirects(model.configUrl, configDest);
      }
      await downloadFileWithRedirects(model.onnxUrl, onnxDest, (downloaded, total) => {
        const pct = total > 0 ? Math.min(99, Math.round((downloaded / total) * 100)) : 50;
        modelDownloadProgress[modelId] = {
          status: 'downloading',
          percent: pct,
          downloadedMB: Math.round((downloaded / (1024 * 1024)) * 10) / 10,
          totalMB: Math.round((total / (1024 * 1024)) * 10) / 10,
          localPath: onnxDest
        };
      });
      modelDownloadProgress[modelId] = {
        status: 'completed',
        percent: 100,
        localPath: onnxDest
      };
    } catch (err) {
      console.error('Error downloading ONNX model:', err);
      modelDownloadProgress[modelId] = {
        status: 'error',
        error: err.message
      };
    }
  })();

  res.json({
    started: true,
    modelId,
    localPath: onnxDest,
    progress: modelDownloadProgress[modelId]
  });
});

// GET /api/models/status
app.get('/api/models/status', (req, res) => {
  const downloadedModels = fs.existsSync(DIRS.onnxModels)
    ? fs.readdirSync(DIRS.onnxModels)
    : [];
  res.json({
    progress: modelDownloadProgress,
    downloadedFiles: downloadedModels,
    folderPath: DIRS.onnxModels
  });
});

// POST /api/userdata/apikey — Save Noiz AI API Key
app.post('/api/userdata/apikey', (req, res) => {
  const { apiKey } = req.body;
  const userData = loadUserData();
  userData.noizApiKey = (apiKey || '').trim();
  saveUserData(userData);
  res.json({
    success: true,
    hasNoizApiKey: Boolean(userData.noizApiKey)
  });
});

// POST /api/userdata/favorite
app.post('/api/userdata/favorite', (req, res) => {
  const { voiceId } = req.body;
  const userData = loadUserData();
  const idx = userData.favorites.indexOf(voiceId);
  if (idx >= 0) {
    userData.favorites.splice(idx, 1);
  } else {
    userData.favorites.push(voiceId);
  }
  saveUserData(userData);
  res.json({ favorites: userData.favorites });
});

// POST /api/userdata/custom-voice
app.post('/api/userdata/custom-voice', (req, res) => {
  const { voice } = req.body;
  if (!voice || !voice.name) {
    return res.status(400).json({ error: 'Nombre de voz requerido.' });
  }
  const userData = loadUserData();
  const newVoice = {
    id: `custom-${Date.now()}`,
    noizVoiceId: voice.noizVoiceId || null,
    name: voice.name,
    subtitle: voice.subtitle || `Voz personalizada · ${voice.age} · ${voice.gender}`,
    shortName: voice.shortName || 'es-CO-SalomeNeural',
    language: voice.language || 'es',
    locale: voice.locale || 'es-ES',
    country: voice.country || 'Personalizada',
    flag: '✨',
    gender: voice.gender || 'Femenino',
    age: voice.age || 'Adulto',
    styles: voice.styles || ['Cálido'],
    category: 'custom',
    avatar: voice.avatar || 'https://noiz.ai/resource/img/tts/voice_clone_poster_1.jpg',
    realAudioUrl: voice.realAudioUrl || null,
    pitch: voice.pitch || '+0Hz',
    rate: voice.rate || '+0%',
    dspProfile: voice.dspProfile || 'natural',
    plays: '1',
    likes: 1,
    isCustom: true,
    sampleText: voice.sampleText || `Hola, soy ${voice.name}, tu nueva voz personalizada creada en Noiz Studio.`
  };
  userData.customVoices.unshift(newVoice);
  saveUserData(userData);
  res.json({ success: true, voice: newVoice, customVoices: userData.customVoices });
});

// POST /api/open-folder
app.post('/api/open-folder', (req, res) => {
  const { folderType } = req.body;
  let targetDir = DIRS.audioDownloads;
  if (folderType === 'voices') targetDir = DIRS.voicePacks;
  else if (folderType === 'models') targetDir = DIRS.onnxModels;
  else if (folderType === 'root') targetDir = __dirname;

  if (process.platform === 'win32') {
    exec(`explorer.exe "${targetDir}"`);
  }
  res.json({ success: true, openedPath: targetDir });
});

app.listen(PORT, () => {
  console.log(`\n=============================================================`);
  console.log(`🎙️  NOIZ AI PRO STUDIO LOCAL (dbaeztts) ACTIVO`);
  console.log(`🌐 URL Local:           http://localhost:${PORT}`);
  console.log(`🌐 URL IIS:             https://tts.laantillana.com`);
  console.log(`📂 Audios Descargados:  ${DIRS.audioDownloads}`);
  console.log(`📦 Voces Descargadas:   ${DIRS.voicePacks}`);
  console.log(`🧠 Modelos ONNX Local:  ${DIRS.onnxModels}`);
  console.log(`=============================================================\n`);
});
