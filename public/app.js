import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ============================================================================
// 1. FIREBASE INITIALIZATION (dbaeztts / project-526674425669)
// ============================================================================
const firebaseConfig = {
  apiKey: "AIzaSyBswt-wFNnRyUEtPb98BMd4MgZBRdrnw5Y",
  authDomain: "dbaeztts.firebaseapp.com",
  projectId: "dbaeztts",
  storageBucket: "dbaeztts.firebasestorage.app",
  messagingSenderId: "526674425669",
  appId: "1:526674425669:web:8bc4b7c7e4f0439e46702c"
};

let firebaseApp = null;
let auth = null;
let db = null;
let currentUser = null;

try {
  firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
} catch (err) {
  console.warn("Firebase init warning:", err);
}

// ============================================================================
// 2. APPLICATION STATE
// ============================================================================
const state = {
  voices: [],
  downloadableModels: [],
  favorites: new Set(),
  customVoices: [],
  history: [],
  paths: {},
  selectedVoice: null,
  activeModelId: "v3",
  activeEmotionJson: "",
  activeEmotionPitchMod: 0,
  activeEmotionRateMod: 0,
  outputFormat: "mp3",
  hasNoizApiKey: false,
  activeModalTab: "explore",
  targetDialogueBlockIndex: null, // null = main block, >= 0 = dialogue block index
  dialogueBlocks: [],
  quickAgeCursor: {},
  liveExploreSkip: 20,
  filters: {
    search: "",
    language: "es",
    gender: "all",
    age: "all",
    style: null
  },
  currentlyPlayingVoiceId: null,
  previewAudio: new Audio(),
  lastGeneratedResult: null
};

// ============================================================================
// 3. SMART IIS / LOCAL API FETCH & HELPERS
// ============================================================================
const API_BASE = window.location.port === "3000" ? "" : "http://localhost:3000";

async function apiFetch(endpoint, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, options);
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return res;
    }
    throw new Error("Non-JSON response");
  } catch (err) {
    if (API_BASE !== "") {
      return fetch(endpoint, options);
    }
    throw err;
  }
}

function showToast(message) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 4200);
}

function parseHz(pitchStr) {
  if (!pitchStr) return 0;
  const m = String(pitchStr).match(/([+-]?\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parsePct(rateStr) {
  if (!rateStr) return 0;
  const m = String(rateStr).match(/([+-]?\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// ============================================================================
// 4. FIREBASE AUTH & FIRESTORE SYNC
// ============================================================================
async function syncToFirestore() {
  if (!currentUser || !db) return;
  try {
    await setDoc(
      doc(db, "users", currentUser.uid),
      {
        email: currentUser.email || "",
        displayName: currentUser.displayName || "",
        favorites: Array.from(state.favorites),
        customVoices: state.customVoices,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );
  } catch (e) {
    console.warn("Firestore sync info:", e.message);
  }
}

async function loadFromFirestore(uid) {
  if (!db) return;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data.favorites)) {
        data.favorites.forEach(id => state.favorites.add(id));
      }
      if (Array.isArray(data.customVoices) && data.customVoices.length > 0) {
        const existingIds = new Set(state.voices.map(v => v.id));
        data.customVoices.forEach(cv => {
          if (!existingIds.has(cv.id)) {
            state.voices.unshift(cv);
            state.customVoices.push(cv);
          }
        });
      }
      renderVoiceModal();
    }
  } catch (e) {
    console.warn("Firestore read info:", e.message);
  }
}

function setupFirebaseAuth() {
  const btnLogin = document.getElementById("btnGoogleLogin");
  const profileChip = document.getElementById("userProfileChip");
  const avatarImg = document.getElementById("userAvatarImg");
  const nameLabel = document.getElementById("userNameLabel");
  const btnLogout = document.getElementById("btnLogout");

  if (!auth) return;

  onAuthStateChanged(auth, user => {
    currentUser = user;
    if (user) {
      btnLogin.classList.add("hidden");
      profileChip.classList.remove("hidden");
      avatarImg.src = user.photoURL || "https://noiz.ai/resource/img/tts/final_es_podcast_open.webp";
      nameLabel.textContent = user.displayName || user.email || "Usuario";
      loadFromFirestore(user.uid);
    } else {
      btnLogin.classList.remove("hidden");
      profileChip.classList.add("hidden");
    }
  });

  btnLogin.addEventListener("click", async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      showToast(`¡Bienvenido ${result.user.displayName || result.user.email}! Conectado a dbaeztts.`);
      await syncToFirestore();
    } catch (err) {
      console.error("Google Auth error:", err);
      showToast("Recuerda autorizar tu dominio en Firebase Console > Authentication > Settings. (Modo Local activo)");
    }
  });

  btnLogout.addEventListener("click", async () => {
    await signOut(auth);
    showToast("Sesión cerrada. Tus datos siguen guardados en local.");
  });
}

// ============================================================================
// 5. LOAD CATALOG FROM LOCAL BACKEND OR STATIC CATALOG.JSON
// ============================================================================
async function initCatalog() {
  try {
    let data = null;
    try {
      const res = await apiFetch("/api/catalog");
      data = await res.json();
    } catch (_) {
      const staticRes = await fetch("/catalog.json");
      data = await staticRes.json();
      try {
        const udRes = await fetch("/data/userdata.json");
        if (udRes.ok) data.userData = await udRes.json();
      } catch (_) {}
    }

    state.voices = data.voices || [];
    state.downloadableModels = data.downloadableModels || [];
    state.paths = data.paths || {
      audioDownloads: "C:\\db\\Github\\tts\\descargas_audio",
      voicePacks: "C:\\db\\Github\\tts\\voces_descargadas",
      onnxModels: "C:\\db\\Github\\tts\\modelos_onnx"
    };

    if (data.userData) {
      state.favorites = new Set(data.userData.favorites || []);
      state.customVoices = data.userData.customVoices || [];
      state.history = data.userData.history || [];
      state.hasNoizApiKey = Boolean(data.userData.hasNoizApiKey);
      updateApiKeyBadge();
    }

    document.getElementById("navTotalVoicesCount").textContent = state.voices.length;
    if (state.paths.audioDownloads) {
      document.getElementById("pathAudioDir").textContent = state.paths.audioDownloads;
      document.getElementById("pathVoicesDir").textContent = state.paths.voicePacks;
      document.getElementById("pathModelsDir").textContent = state.paths.onnxModels;
    }

    // Select default voice ("Coco" c0750aac, matching user's preferred voice)
    const defaultVoice =
      state.voices.find(v => v.noizVoiceId === "c0750aac") ||
      state.voices.find(v => v.noizVoiceId === "b0a1531a") ||
      state.voices[0];

    if (defaultVoice) {
      selectActiveVoice(defaultVoice, false);
    }

    populateDesignerBaseVoices();
    renderVoiceModal();
    renderHistory();
    renderDownloadableModels();
  } catch (err) {
    console.error("Failed to load catalog:", err);
    showToast("Error cargando el catálogo local de voces.");
  }
}

function updateApiKeyBadge() {
  const badge = document.getElementById("apiKeyStatusBadge");
  if (!badge) return;
  if (state.hasNoizApiKey) {
    badge.textContent = "Conectada ✓";
    badge.style.background = "rgba(34, 197, 94, 0.2)";
    badge.style.color = "#86efac";
  } else {
    badge.textContent = "10k Gratis";
  }
}

// ============================================================================
// 6. SELECT ACTIVE VOICE & UPDATE STUDIO / DIALOGUE BLOCKS
// ============================================================================
function selectActiveVoice(voice, closeAfter = true) {
  if (state.targetDialogueBlockIndex !== null && state.dialogueBlocks[state.targetDialogueBlockIndex]) {
    state.dialogueBlocks[state.targetDialogueBlockIndex].voice = voice;
    state.targetDialogueBlockIndex = null;
    renderDialogueBlocks();
    if (closeAfter) {
      document.getElementById("voiceSelectorModal").classList.add("hidden");
      showToast(`Voz asignada al bloque de diálogo: ${voice.name}`);
    }
    return;
  }

  state.selectedVoice = voice;

  document.getElementById("currentVoiceAvatar").src = voice.avatar;
  document.getElementById("currentVoiceName").textContent = voice.name;
  document.getElementById("currentVoiceIdBadge").textContent = `ID: ${voice.noizVoiceId || voice.shortName}`;
  document.getElementById("currentVoiceAgeBadge").textContent = voice.age || "Adulto";
  document.getElementById("currentVoiceGenderBadge").textContent = voice.gender || "Femenino";
  document.getElementById("currentVoiceSubtitle").textContent = voice.subtitle || `${voice.age} · ${voice.gender}`;

  document.getElementById("inspectorVoiceImg").src = voice.avatar;
  document.getElementById("inspectorVoiceName").textContent = voice.name;
  document.getElementById("inspectorVoiceTags").textContent = `${voice.age} · ${voice.gender} · ${(voice.styles || []).join(", ")}`;

  document.getElementById("activeSpeakerEngineLabel").textContent =
    `⚡ Locutor Asignado: ${voice.shortName} (${voice.noizVoiceId ? "Noiz ID: " + voice.noizVoiceId : "Directo"})`;

  const hz = parseHz(voice.pitch);
  const pct = parsePct(voice.rate);
  const pitchRange = document.getElementById("pitchRange");
  const rateRange = document.getElementById("rateRange");
  pitchRange.value = hz;
  rateRange.value = pct;
  document.getElementById("pitchValueLabel").textContent = `${hz >= 0 ? "+" : ""}${hz}Hz`;
  const speedMult = (1 + pct / 100).toFixed(2);
  document.getElementById("rateValueLabel").textContent = `${speedMult}x (${pct >= 0 ? "+" : ""}${pct}%)`;

  const dspSelect = document.getElementById("dspProfileSelect");
  if (voice.dspProfile && Array.from(dspSelect.options).some(o => o.value === voice.dspProfile)) {
    dspSelect.value = voice.dspProfile;
  } else {
    dspSelect.value = "natural";
  }

  if (closeAfter) {
    document.getElementById("voiceSelectorModal").classList.add("hidden");
    showToast(`Voz activa: ${voice.name} (${voice.age} · ${voice.gender})`);
  }
}

// ============================================================================
// 7. RENDER NOIZ AI VOICE SELECTOR MODAL ("SELECCIONAR VOZ")
// ============================================================================
function getFilteredVoices() {
  return state.voices.filter(v => {
    if (state.activeModalTab === "my-voices" && !v.isCustom) return false;
    if (state.activeModalTab === "favorites" && !state.favorites.has(v.id)) return false;

    if (state.filters.language !== "all") {
      if (state.filters.language === "es") {
        if (v.language !== "es" && v.language !== "multi") return false;
      } else if (v.language !== state.filters.language) {
        return false;
      }
    }

    if (state.filters.gender !== "all" && v.gender !== state.filters.gender) {
      return false;
    }

    if (state.filters.age !== "all" && v.age !== state.filters.age) {
      return false;
    }

    if (state.filters.style) {
      if (!Array.isArray(v.styles) || !v.styles.includes(state.filters.style)) {
        return false;
      }
    }

    if (state.filters.search.trim()) {
      const q = state.filters.search.toLowerCase();
      const haystack = `${v.name} ${v.subtitle} ${v.country} ${v.age} ${v.gender} ${(v.styles || []).join(" ")} ${(v.labels || []).join(" ")} ${v.noizVoiceId || ""} ${v.shortName}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });
}

function renderVoiceModal() {
  const myCount = state.voices.filter(v => v.isCustom).length;
  document.getElementById("myVoicesCountBadge").textContent = myCount;
  document.getElementById("favVoicesCountBadge").textContent = state.favorites.size;

  // Featured Section (Coco + 4 Featured Stars: Bienvenida Isabela, Pasión Inma, Energía Mateo, Sebastián)
  const featuredSection = document.getElementById("featuredSection");
  const featuredRow = document.getElementById("featuredCardsRow");
  const featuredVoices = state.voices.filter(v => v.category === "featured").slice(0, 5);

  if (state.activeModalTab === "explore" && !state.filters.search && state.filters.age === "all" && state.filters.gender === "all") {
    featuredSection.classList.remove("hidden");
    featuredRow.innerHTML = featuredVoices
      .map(
        v => `
      <div class="noiz-featured-card" data-voice-id="${v.id}">
        <img src="${v.featuredImage || v.avatar}" alt="${v.name}" loading="lazy" onerror="this.src='https://noiz.ai/resource/img/tts/voice_clone_poster_1.jpg'" />
        <div class="noiz-featured-overlay">
          <button class="featured-use-btn" data-action="use" data-voice-id="${v.id}">Usar voz</button>
          <button class="featured-play-btn" data-action="preview" data-voice-id="${v.id}" title="Escuchar audio original de Noiz.ai">
            ${state.currentlyPlayingVoiceId === v.id ? "⏹" : "▶"}
          </button>
          <div class="featured-title">${v.displayNameClean || v.name}</div>
          <div class="featured-tags">
            <span class="featured-lang-pill">ES Español</span>
            <span class="featured-lang-pill">${v.age}</span>
          </div>
        </div>
      </div>
    `
      )
      .join("");
  } else {
    featuredSection.classList.add("hidden");
  }

  // Main Filtered Grid
  const filtered = getFilteredVoices();
  document.getElementById("filteredVoicesCount").textContent = filtered.length;

  const gridContainer = document.getElementById("voicesGridContainer");
  if (filtered.length === 0) {
    gridContainer.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 36px; color: #9ea3b5;">
        No se encontraron voces en caché local con ese filtro. Pulsa el botón <strong>"🌐 Buscar en Noiz.ai Live"</strong> arriba para buscar entre las 15,612 voces en el servidor de Noiz.ai.
      </div>
    `;
  } else {
    gridContainer.innerHTML = filtered.slice(0, 120).map(v => renderVoiceCardHTML(v)).join("");
  }

  // Recent Section ("Recién añadidas")
  const recentSection = document.getElementById("recentSection");
  const recentGrid = document.getElementById("recentVoicesGrid");
  const recentVoices = state.voices.filter(v => v.category === "recent");

  if (state.activeModalTab === "explore" && !state.filters.search && state.filters.age === "all") {
    recentSection.classList.remove("hidden");
    recentGrid.innerHTML = recentVoices.map(v => renderVoiceCardHTML(v)).join("");
  } else {
    recentSection.classList.add("hidden");
  }
}

function renderVoiceCardHTML(v) {
  const isFav = state.favorites.has(v.id);
  const isPlaying = state.currentlyPlayingVoiceId === v.id;
  const hasRealAudio = Boolean(v.realAudioUrl || v.fallbackAudioUrl);

  return `
    <div class="noiz-voice-card" data-voice-id="${v.id}">
      <div class="voice-card-left">
        <div class="voice-avatar-box ${isPlaying ? "playing" : ""}" data-action="preview" data-voice-id="${v.id}" title="${hasRealAudio ? "Escuchar grabación original real de Noiz.ai" : "Escuchar muestra neuronal"}">
          <img src="${v.avatar}" alt="${v.name}" loading="lazy" onerror="this.src='https://noiz.ai/resource/img/tts/voice_clone_poster_2.jpg'" />
          <div class="voice-play-overlay">${isPlaying ? "⏹" : "▶"}</div>
        </div>
        <div class="voice-meta">
          <div class="voice-name" title="${v.name}">${v.name}</div>
          <div class="voice-badges-row">
            ${hasRealAudio ? `<span class="voice-mini-tag real-noiz" title="Grabación real original de Noiz.ai">✓ Noiz Real</span>` : `<span class="voice-mini-tag">${v.flag || "🇪🇸"} ES</span>`}
            <span class="voice-mini-tag age-${v.age}">${v.age}</span>
            <span class="voice-mini-tag">${v.gender === "Femenino" ? "♀ Fem" : "♂ Masc"}</span>
          </div>
          <div class="voice-stats-row">
            <span>ılı ${v.plays || "1.4k"}</span>
            <button class="btn-fav-heart ${isFav ? "favorited" : ""}" data-action="fav" data-voice-id="${v.id}" title="Guardar en Favoritos">
              ${isFav ? "♥" : "♡"} ${(v.likes || 5) + (isFav ? 1 : 0)}
            </button>
          </div>
        </div>
      </div>
      <div class="voice-card-actions">
        <button class="btn-usar-voice" data-action="use" data-voice-id="${v.id}">Usar</button>
        <button class="btn-dl-voice-icon" data-action="download-voice" data-voice-id="${v.id}" title="Descargar audio original de esta voz en mi PC">⬇</button>
      </div>
    </div>
  `;
}

// ============================================================================
// 8. PLAY REAL NOIZ AI SAMPLE AUDIO & SYNTHESIS ACTIONS
// ============================================================================
async function previewVoice(voice, forceSynthesize = false) {
  if (!voice) return;

  if (state.currentlyPlayingVoiceId === voice.id) {
    state.previewAudio.pause();
    state.currentlyPlayingVoiceId = null;
    renderVoiceModal();
    return;
  }

  state.currentlyPlayingVoiceId = voice.id;
  renderVoiceModal();

  // 1. Play REAL original Noiz AI recording if available and not forcing synthesis!
  const realUrl = voice.realAudioUrl || voice.fallbackAudioUrl;
  if (!forceSynthesize && realUrl) {
    showToast(`🔊 Reproduciendo voz original Noiz.ai: "${voice.name}" (${voice.age})`);
    state.previewAudio.src = realUrl;
    state.previewAudio.onended = () => {
      state.currentlyPlayingVoiceId = null;
      renderVoiceModal();
    };
    state.previewAudio.onerror = async () => {
      if (voice.fallbackAudioUrl && state.previewAudio.src !== voice.fallbackAudioUrl) {
        state.previewAudio.src = voice.fallbackAudioUrl;
        state.previewAudio.play().catch(() => previewVoice(voice, true));
      } else {
        previewVoice(voice, true);
      }
    };
    try {
      await state.previewAudio.play();
      return;
    } catch (_) {
      // Fallback to synthesis if direct audio blocked
    }
  }

  // 2. Synthesize preview with unique speaker + pitch/rate prosody
  showToast(`Sintetizando muestra de "${voice.name}" (${voice.shortName})...`);
  try {
    const res = await apiFetch("/api/tts/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: voice.sampleText || `Hola, soy ${voice.name}, una voz ${voice.age.toLowerCase()} lista para tus proyectos.`,
        voiceId: voice.id,
        noizVoiceId: voice.noizVoiceId,
        voiceName: voice.name,
        shortName: voice.shortName,
        pitch: voice.pitch || "+0Hz",
        rate: voice.rate || "+0%",
        dspProfile: voice.dspProfile || "natural",
        isPreview: true
      })
    });
    const data = await res.json();
    if (!res.ok || !data.audioUrl) {
      throw new Error(data.error || "Error al generar vista previa");
    }

    state.previewAudio.src = data.audioUrl;
    state.previewAudio.onended = () => {
      state.currentlyPlayingVoiceId = null;
      renderVoiceModal();
    };
    await state.previewAudio.play();
  } catch (err) {
    state.currentlyPlayingVoiceId = null;
    renderVoiceModal();
    showToast(`Aviso en vista previa: ${err.message}`);
  }
}

async function synthesizeMainText() {
  const text = document.getElementById("ttsTextInput").value.trim();
  if (!text) {
    showToast("Por favor escribe algún texto en el editor para convertir a voz.");
    return;
  }

  const voice = state.selectedVoice || state.voices[0];
  const baseHz = parseInt(document.getElementById("pitchRange").value, 10) || 0;
  const basePct = parseInt(document.getElementById("rateRange").value, 10) || 0;
  const finalHz = Math.max(-50, Math.min(60, baseHz + state.activeEmotionPitchMod));
  const finalPct = Math.max(-45, Math.min(55, basePct + state.activeEmotionRateMod));

  const pitch = `${finalHz >= 0 ? "+" : ""}${finalHz}Hz`;
  const rate = `${finalPct >= 0 ? "+" : ""}${finalPct}%`;
  const speed = Number((1 + finalPct / 100).toFixed(2));
  const dspProfile = document.getElementById("dspProfileSelect").value;
  const engineMode = document.getElementById("engineModeSelect").value;
  const trimSilence = document.getElementById("chkTrimSilence").checked;
  const similarityEnh = document.getElementById("chkSimilarityEnh").checked;

  const btn = document.getElementById("btnSynthesizeMain");
  const btnText = document.getElementById("btnSynthesizeText");
  btn.disabled = true;
  btnText.textContent = "Sintetizando voz...";

  try {
    const res = await apiFetch("/api/tts/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voiceId: voice.id,
        noizVoiceId: voice.noizVoiceId,
        voiceName: voice.name,
        shortName: voice.shortName,
        pitch,
        rate,
        speed,
        modelId: state.activeModelId,
        emo: state.activeEmotionJson,
        outputFormat: state.outputFormat,
        trimSilence,
        similarityEnh,
        dspProfile,
        engineMode,
        isPreview: false
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Fallo en la síntesis");

    displayGeneratedAudioResult(data, `${voice.name} (${voice.age} · ${voice.gender})`);
  } catch (err) {
    showToast(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btnText.textContent = "Speak It · Generar Voz";
  }
}

function displayGeneratedAudioResult(data, titleText) {
  state.lastGeneratedResult = data;
  state.history.unshift(data);
  renderHistory();

  const card = document.getElementById("audioResultCard");
  card.classList.remove("hidden");
  document.getElementById("resultSourceBadge").textContent = `✓ ${data.usedEngine || "Audio Generado"}`;
  document.getElementById("resultVoiceTitle").textContent = titleText;
  document.getElementById("resultFilePathLabel").textContent = `Guardado en: ${data.localPath}`;

  const dlMp3 = document.getElementById("btnDownloadMp3");
  dlMp3.href = data.audioUrl;
  dlMp3.download = data.filename;

  const mainAudio = document.getElementById("mainAudioElement");
  mainAudio.src = data.audioUrl;
  mainAudio.play().catch(() => {});
  drawWaveformAnimation(mainAudio);

  showToast(`✓ Audio guardado en ${data.localPath}`);
}

// ============================================================================
// 9. MULTI-SPEAKER DIALOGUE BLOCKS & SYNTHESIS
// ============================================================================
function addDialogueBlock(customVoice = null, initialText = "") {
  const ageRotation = ["Niño", "Mayor", "Adolescente", "Adulto", "Joven"];
  const targetAge = ageRotation[state.dialogueBlocks.length % ageRotation.length];
  const fallbackVoice =
    customVoice ||
    state.voices.find(v => v.age === targetAge && v.id !== (state.selectedVoice && state.selectedVoice.id)) ||
    state.voices[(state.dialogueBlocks.length + 1) % state.voices.length];

  state.dialogueBlocks.push({
    id: `blk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    voice: fallbackVoice,
    text: initialText || `Hola, soy ${fallbackVoice.displayNameClean || fallbackVoice.name} y esta es mi intervención en el diálogo.`
  });

  renderDialogueBlocks();
}

function renderDialogueBlocks() {
  const container = document.getElementById("dialogueBlocksList");
  const btnGenDlg = document.getElementById("btnSynthesizeDialogue");

  if (state.dialogueBlocks.length === 0) {
    container.innerHTML = "";
    btnGenDlg.classList.add("hidden");
    return;
  }

  btnGenDlg.classList.remove("hidden");
  container.innerHTML = state.dialogueBlocks
    .map(
      (b, idx) => `
    <div class="dialogue-item-card" data-dlg-idx="${idx}">
      <div class="dialogue-item-header">
        <div class="dialogue-item-voice" data-change-dlg-voice="${idx}" title="Cambiar la voz de este interlocutor">
          <img src="${b.voice.avatar}" alt="${b.voice.name}" onerror="this.src='https://noiz.ai/resource/img/tts/voice_clone_poster_3.jpg'" />
          <div>
            <strong style="font-size:0.86rem;">Párrafo #${idx + 2}: ${b.voice.name}</strong>
            <div style="font-size:0.72rem; color:#9ea3b5;">${b.voice.age} · ${b.voice.gender} · ${b.voice.shortName} ▾</div>
          </div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn-ghost-sm" data-preview-dlg="${idx}">▶ Probar este párrafo</button>
          <button class="btn-ghost-sm" data-remove-dlg="${idx}" style="color:#fca5a5;">✕ Quitar</button>
        </div>
      </div>
      <textarea class="dialogue-textarea" rows="3" data-dlg-textarea="${idx}">${b.text}</textarea>
    </div>
  `
    )
    .join("");
}

async function synthesizeFullDialogue() {
  const mainVoice = state.selectedVoice || state.voices[0];
  const mainText = document.getElementById("ttsTextInput").value.trim();

  const blocks = [];
  if (mainText) {
    blocks.push({
      voiceName: mainVoice.displayNameClean || mainVoice.name,
      shortName: mainVoice.shortName,
      pitch: mainVoice.pitch || "+0Hz",
      rate: mainVoice.rate || "+0%",
      text: mainText
    });
  }

  state.dialogueBlocks.forEach(b => {
    if (b.text && b.text.trim()) {
      blocks.push({
        voiceName: b.voice.displayNameClean || b.voice.name,
        shortName: b.voice.shortName,
        pitch: b.voice.pitch || "+0Hz",
        rate: b.voice.rate || "+0%",
        text: b.text.trim()
      });
    }
  });

  if (blocks.length === 0) {
    showToast("Escribe texto en al menos un bloque para generar el diálogo.");
    return;
  }

  const btn = document.getElementById("btnSynthesizeDialogue");
  btn.disabled = true;
  btn.textContent = "⏳ Generando diálogo multi-voz...";

  try {
    const res = await apiFetch("/api/tts/synthesize-dialogue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al generar diálogo");

    displayGeneratedAudioResult(data, data.voiceName);
  } catch (err) {
    showToast(`Error en diálogo: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "🎬 Generar Diálogo Multi-Voz Completo";
  }
}

// ============================================================================
// 10. LIVE NOIZ.AI EXPLORE SEARCH (15,612+ VOICES)
// ============================================================================
async function searchLiveNoizCatalog(appendMore = false) {
  const q = state.filters.search.trim();
  const skip = appendMore ? state.liveExploreSkip : 0;
  showToast(`🌐 Consultando servidor de Noiz.ai en tiempo real (${q || "Español"})...`);

  try {
    const params = new URLSearchParams({
      skip: String(skip),
      limit: "24",
      language_type: state.filters.language === "all" ? "" : state.filters.language || "es",
      keyword: q
    });
    const res = await apiFetch(`/api/noiz/explore?${params.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.voices) throw new Error(data.error || "Sin respuesta");

    const existingIds = new Set(state.voices.map(v => v.id));
    let added = 0;
    data.voices.forEach(v => {
      if (!existingIds.has(v.id)) {
        state.voices.push(v);
        existingIds.add(v.id);
        added++;
      }
    });

    state.liveExploreSkip = skip + 24;
    document.getElementById("navTotalVoicesCount").textContent = state.voices.length;
    renderVoiceModal();
    showToast(`✓ ${added} nuevas voces reales traídas en vivo de Noiz.ai (Total disponibles en servidor: ${data.totalCount || "15,612"}).`);
  } catch (err) {
    showToast(`Aviso Live Noiz.ai: ${err.message}`);
  }
}

// ============================================================================
// 11. WAVEFORM ANIMATION & DSP WAV EXPORT
// ============================================================================
function drawWaveformAnimation(audioEl) {
  const canvas = document.getElementById("waveformCanvas");
  const ctx = canvas.getContext("2d");
  const playBtn = document.getElementById("btnPlayPauseResult");
  const timeLabel = document.getElementById("audioTimeLabel");

  let animId = null;
  const bars = 68;

  function renderFrame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const progress = audioEl.duration ? audioEl.currentTime / audioEl.duration : 0;

    for (let i = 0; i < bars; i++) {
      const x = (i / bars) * canvas.width;
      const barWidth = canvas.width / bars - 3;
      const isPlayed = i / bars <= progress;
      const pulse = !audioEl.paused
        ? Math.abs(Math.sin(Date.now() * 0.009 + i * 0.45)) * 0.72 + 0.22
        : 0.32 + Math.abs(Math.sin(i * 0.5)) * 0.45;
      const barHeight = Math.max(6, pulse * (canvas.height - 10));
      const y = (canvas.height - barHeight) / 2;

      ctx.fillStyle = isPlayed ? "#7c5cfc" : "rgba(255,255,255,0.22)";
      ctx.beginPath();
      ctx.roundRect(x + 2, y, barWidth, barHeight, 4);
      ctx.fill();
    }

    const sec = Math.floor(audioEl.currentTime || 0);
    const mins = String(Math.floor(sec / 60)).padStart(2, "0");
    const secs = String(sec % 60).padStart(2, "0");
    timeLabel.textContent = `${mins}:${secs}`;

    if (!audioEl.paused) {
      playBtn.textContent = "⏸";
      animId = requestAnimationFrame(renderFrame);
    } else {
      playBtn.textContent = "▶";
    }
  }

  audioEl.onplay = () => {
    cancelAnimationFrame(animId);
    renderFrame();
  };
  audioEl.onpause = () => {
    cancelAnimationFrame(animId);
    renderFrame();
  };
  audioEl.onended = () => {
    cancelAnimationFrame(animId);
    renderFrame();
  };

  renderFrame();
}

function audioBufferToWavBase64(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new ArrayBuffer(length);
  const view = new DataView(out);
  const channels = [];
  let sample;
  let offset = 0;
  let pos = 0;

  function setUint16(data) {
    view.setUint16(pos, data, true);
    pos += 2;
  }
  function setUint32(data) {
    view.setUint32(pos, data, true);
    pos += 4;
  }

  setUint32(0x46464952);
  setUint32(length - 8);
  setUint32(0x45564157);
  setUint32(0x20746d66);
  setUint32(16);
  setUint16(1);
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2);
  setUint16(16);
  setUint32(0x61746164);
  setUint32(length - pos - 4);

  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (pos < length) {
    for (let i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  const bytes = new Uint8Array(out);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function exportDspWavFile() {
  if (!state.lastGeneratedResult || !state.lastGeneratedResult.audioUrl) {
    showToast("Primero genera un audio para exportarlo en WAV.");
    return;
  }

  const dspProfile = document.getElementById("dspProfileSelect").value;
  showToast(`Procesando audio WAV con perfil acústico "${dspProfile}"...`);

  try {
    const response = await fetch(state.lastGeneratedResult.audioUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);

    const offlineCtx = new OfflineAudioContext(
      decoded.numberOfChannels,
      decoded.length,
      decoded.sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = decoded;

    const filter = offlineCtx.createBiquadFilter();
    if (dspProfile === "child") {
      filter.type = "peaking";
      filter.frequency.value = 2600;
      filter.gain.value = 6.5;
    } else if (dspProfile === "teen") {
      filter.type = "highshelf";
      filter.frequency.value = 3200;
      filter.gain.value = 4.5;
    } else if (dspProfile === "elder") {
      filter.type = "lowshelf";
      filter.frequency.value = 240;
      filter.gain.value = 5.5;
    } else if (dspProfile === "horror") {
      filter.type = "lowpass";
      filter.frequency.value = 1750;
    } else if (dspProfile === "telephone") {
      filter.type = "bandpass";
      filter.frequency.value = 1200;
      filter.Q.value = 2.0;
    } else if (dspProfile === "warm" || dspProfile === "broadcast") {
      filter.type = "lowshelf";
      filter.frequency.value = 180;
      filter.gain.value = 4.5;
    } else {
      filter.type = "allpass";
    }

    source.connect(filter);
    filter.connect(offlineCtx.destination);
    source.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    const base64Wav = audioBufferToWavBase64(renderedBuffer);

    const saveRes = await apiFetch("/api/tts/save-wav", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base64Wav,
        voiceName: state.lastGeneratedResult.voiceName
      })
    });
    const savedData = await saveRes.json();

    if (savedData.audioUrl) {
      const a = document.createElement("a");
      a.href = savedData.audioUrl;
      a.download = savedData.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast(`✓ WAV guardado en: ${savedData.localPath}`);
    }
  } catch (err) {
    showToast(`Error exportando WAV: ${err.message}`);
  }
}

// ============================================================================
// 12. DOWNLOAD REAL NOIZ VOICE PACKS & ONNX MODELS TO LOCAL PC
// ============================================================================
async function downloadSingleVoicePack(voice) {
  showToast(`⬇ Descargando audio original de "${voice.name}" en C:\\db\\Github\\tts\\voces_descargadas...`);
  try {
    const res = await apiFetch("/api/voices/download-pack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const a = document.createElement("a");
    a.href = data.mp3Url;
    a.download = `${voice.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.${data.mp3Url.endsWith(".wav") ? "wav" : "mp3"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    showToast(`✓ ${data.downloadedRealNoiz ? "Audio original de Noiz.ai" : "Muestra"} guardado en ${data.localMp3Path}`);
  } catch (err) {
    showToast(`Error al descargar voz: ${err.message}`);
  }
}

async function downloadBatchVoicesByAge(ageGroup) {
  const voicesToDownload = state.voices.filter(v => v.age === ageGroup && v.language === "es").slice(0, 12);
  showToast(`Descargando pack de ${voicesToDownload.length} voces (${ageGroup}) en tu disco local...`);
  try {
    const res = await apiFetch("/api/voices/download-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voices: voicesToDownload })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(`✓ ${data.count} voces (${ageGroup}) descargadas en: ${data.folderPath}`);
  } catch (err) {
    showToast(`Error descargando pack: ${err.message}`);
  }
}

function renderDownloadableModels() {
  const grid = document.getElementById("onnxModelsGrid");
  if (!grid) return;

  grid.innerHTML = state.downloadableModels
    .map(m => {
      const prog = m.progress;
      const isDownloading = prog && prog.status === "downloading";
      const isDone = m.isDownloaded || (prog && prog.status === "completed");
      const pct = isDone ? 100 : isDownloading ? prog.percent || 15 : 0;

      return `
      <div class="model-card">
        <div class="model-card-header">
          <h4>${m.name}</h4>
          <span class="model-size-badge">${m.size}</span>
        </div>
        <div class="voice-badges-row">
          <span class="voice-mini-tag">${m.engine}</span>
          <span class="voice-mini-tag">${m.language}</span>
          <span class="voice-mini-tag">${m.gender}</span>
        </div>
        <p class="model-desc">${m.description}</p>
        <div class="model-progress-bar">
          <div class="model-progress-fill" style="width: ${pct}%"></div>
        </div>
        <div style="font-size: 0.72rem; color: #9ea3b5; font-family: monospace;">
          ${
            isDone
              ? `✓ Descargado en: ${m.localPath}`
              : isDownloading
              ? `⏳ Descargando a disco... ${pct}% (${prog.downloadedMB || 0} MB / ${prog.totalMB || "?"} MB)`
              : `Destino local: C:\\db\\Github\\tts\\modelos_onnx\\${m.filename}`
          }
        </div>
        <div class="model-actions">
          <button class="btn-usar-voice" data-model-dl="${m.id}" ${isDownloading ? "disabled" : ""}>
            ${isDone ? "✓ Re-descargar ONNX en Local" : isDownloading ? "Descargando..." : "⬇ Descargar Modelo ONNX a mi PC"}
          </button>
          <a href="${m.onnxUrl}" target="_blank" rel="noopener" class="btn-ghost-sm" style="text-decoration:none; display:inline-flex; align-items:center;">
            HuggingFace ↗
          </a>
        </div>
      </div>
    `;
    })
    .join("");
}

let modelPollInterval = null;
async function startModelDownload(modelId) {
  try {
    const res = await apiFetch("/api/models/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`Descarga iniciada hacia ${data.localPath}`);
    if (!modelPollInterval) {
      modelPollInterval = setInterval(async () => {
        const stRes = await apiFetch("/api/models/status");
        const stData = await stRes.json();
        let anyActive = false;
        state.downloadableModels.forEach(m => {
          m.progress = stData.progress[m.id] || null;
          m.isDownloaded = (stData.downloadedFiles || []).includes(m.filename);
          if (m.progress && m.progress.status === "downloading") anyActive = true;
        });
        renderDownloadableModels();
        if (!anyActive) {
          clearInterval(modelPollInterval);
          modelPollInterval = null;
        }
      }, 1200);
    }
  } catch (err) {
    showToast(`Error al descargar modelo: ${err.message}`);
  }
}

// ============================================================================
// 13. RENDER HISTORY & DESIGNER BASE VOICES
// ============================================================================
function renderHistory() {
  const list = document.getElementById("historyList");
  const badge = document.getElementById("historyCountBadge");
  badge.textContent = state.history.length;

  if (state.history.length === 0) {
    list.innerHTML = `<p class="empty-hint" style="font-size:0.78rem; color:#6c7286;">Tus audios generados aparecerán aquí con descarga directa.</p>`;
    return;
  }

  list.innerHTML = state.history
    .slice(0, 25)
    .map(
      item => `
    <div class="history-item">
      <div class="history-item-top">
        <span>${item.voiceName}</span>
        <span style="font-size:0.68rem; color:#86efac;">${item.sizeKB || 18} KB</span>
      </div>
      <div class="history-item-text">"${item.text}"</div>
      <div class="history-item-actions">
        <button data-play-url="${item.audioUrl}">▶ Reproducir</button>
        <a href="${item.audioUrl}" download="${item.filename}">⬇ Descargar</a>
      </div>
    </div>
  `
    )
    .join("");
}

function populateDesignerBaseVoices() {
  const select = document.getElementById("designBaseVoiceSelect");
  const uniqueShortNames = new Map();
  state.voices.forEach(v => {
    if (v.shortName && !uniqueShortNames.has(v.shortName)) {
      uniqueShortNames.set(v.shortName, v);
    }
  });
  select.innerHTML = Array.from(uniqueShortNames.values())
    .map(v => `<option value="${v.shortName}">${v.shortName} (${v.country} · ${v.gender})</option>`)
    .join("");
}

// ============================================================================
// 14. EVENT LISTENERS & INTERACTIVE WORKFLOWS
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  setupFirebaseAuth();
  initCatalog();

  // Left Sidebar View Switching
  document.querySelectorAll(".sidebar-nav-item[data-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sidebar-nav-item").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const viewName = btn.getAttribute("data-view");
      document.querySelectorAll(".view-section").forEach(s => s.classList.remove("active"));
      document.getElementById(`view-${viewName}`).classList.add("active");
    });
  });

  // Right Inspector Tabs (Settings / History)
  document.querySelectorAll(".inspector-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".inspector-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.getAttribute("data-inspector-tab");
      document.querySelectorAll(".inspector-tab-content").forEach(c => c.classList.remove("active"));
      document.getElementById(`inspector-${target}`).classList.add("active");
    });
  });

  // Model Selector Cards (v3, v2, v1)
  document.querySelectorAll(".model-option-card").forEach(card => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".model-option-card").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      state.activeModelId = card.getAttribute("data-model-id");
      const emoGroup = document.getElementById("emotionalIntensityGroup");
      if (state.activeModelId === "v1") {
        emoGroup.classList.add("hidden");
      } else {
        emoGroup.classList.remove("hidden");
      }
      showToast(`Modelo activo: ${card.querySelector("strong").textContent}`);
    });
  });

  // Output format pills (.MP3 / .WAV)
  document.querySelectorAll(".format-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".format-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      state.outputFormat = pill.getAttribute("data-format");
    });
  });

  // V2 Emotion Chips
  document.querySelectorAll(".emo-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".emo-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      state.activeEmotionJson = chip.getAttribute("data-emo") || "";
      state.activeEmotionPitchMod = parseInt(chip.getAttribute("data-pitch-mod") || "0", 10);
      state.activeEmotionRateMod = parseInt(chip.getAttribute("data-rate-mod") || "0", 10);
      showToast(`Emoción aplicada: ${chip.textContent}`);
    });
  });

  // V3 Expressive Tag Chips (insert at cursor in active textarea)
  document.querySelectorAll(".v3-tag-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const tag = chip.getAttribute("data-insert-tag");
      const textarea = document.getElementById("ttsTextInput");
      const start = textarea.selectionStart || textarea.value.length;
      const end = textarea.selectionEnd || textarea.value.length;
      const before = textarea.value.slice(0, start);
      const after = textarea.value.slice(end);
      textarea.value = `${before} ${tag} ${after}`.replace(/\s+/g, " ");
      document.getElementById("charCount").textContent = textarea.value.length;
      textarea.focus();
    });
  });

  // Auto-Emotion Enhance Button
  ["btnEmotionEnhance", "btnEmotionEnhanceTop"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("click", async () => {
        const textarea = document.getElementById("ttsTextInput");
        if (!textarea.value.trim()) return;
        showToast("🎭 Analizando texto e insertando etiquetas expresivas V3...");
        try {
          const res = await apiFetch("/api/noiz/emotion-enhance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: textarea.value })
          });
          const data = await res.json();
          if (data.enhancedText) {
            textarea.value = data.enhancedText;
            document.getElementById("charCount").textContent = textarea.value.length;
            showToast("✓ Etiquetas expresivas V3 añadidas automáticamente.");
          }
        } catch (err) {
          showToast(`Error en Auto-Emociones: ${err.message}`);
        }
      });
    }
  });

  // Quick Age & Gender Selector Bar (Cycles through all voices in that group + plays real Noiz sample!)
  document.querySelectorAll(".quick-age-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".quick-age-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const age = btn.getAttribute("data-quick-age");
      const gender = btn.getAttribute("data-quick-gender");
      const key = `${age}-${gender}`;

      const pool = state.voices.filter(v => v.language === "es" && v.age === age && v.gender === gender);
      if (pool.length > 0) {
        const idx = state.quickAgeCursor[key] || 0;
        const chosen = pool[idx % pool.length];
        state.quickAgeCursor[key] = idx + 1;
        selectActiveVoice(chosen, false);
        previewVoice(chosen, false);
      }
    });
  });

  // Professional Script Templates
  document.querySelectorAll(".template-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const type = chip.getAttribute("data-template");
      const input = document.getElementById("ttsTextInput");

      if (type === "coco") {
        const v = state.voices.find(x => x.noizVoiceId === "c0750aac") || state.voices[0];
        if (v) {
          selectActiveVoice(v, false);
          previewVoice(v, false);
        }
        input.value = "María madre de gracias, madre de piedad y misericordia, en la vida y en la muerte ampáranos gran señora. Amén. Oh Jesús mío, perdona nuestras culpas y pecados, líbranos del fuego del infierno, lleva al cielo a todas las almas.";
      } else if (type === "podcast") {
        const v = state.voices.find(x => x.noizVoiceId === "b0a1531a") || state.voices[0];
        if (v) selectActiveVoice(v, false);
        input.value = "[Clear_throat] Bienvenidos a un nuevo episodio. [Chuckles] Hoy tenemos una conversación muy especial que llevo semanas preparando. Así que ponte cómodo, porque esto va a ser increíble.";
      } else if (type === "kids") {
        const v = state.voices.find(x => x.noizVoiceId === "95a123f0") || state.voices.find(x => x.age === "Niño");
        if (v) selectActiveVoice(v, false);
        input.value = "[Giggle] ¡Mira mamá! Había una vez en un bosque mágico un pequeño dragón que en lugar de lanzar fuego, lanzaba burbujas de colores brillantes.";
      } else if (type === "teen") {
        const v = state.voices.find(x => x.age === "Adolescente") || state.voices[3];
        if (v) selectActiveVoice(v, false);
        input.value = "[Laugh] ¡Qué pasa gente! No se vayan a perder este reto épico que estamos probando hoy en directo, quédense hasta el final del video.";
      } else if (type === "elder") {
        const v = state.voices.find(x => x.noizVoiceId === "4439e68a") || state.voices.find(x => x.age === "Mayor");
        if (v) selectActiveVoice(v, false);
        input.value = "[Sigh] Siéntate a mi lado, hijo. A lo largo de ochenta inviernos he aprendido que los recuerdos más valiosos se guardan en el corazón.";
      } else if (type === "horror") {
        const v = state.voices.find(x => x.noizVoiceId === "9ecc8449") || state.voices.find(x => x.name.includes("Terror"));
        if (v) selectActiveVoice(v, false);
        input.value = "[Whisper] No mires detrás de la puerta a medianoche... [Pause 1.0s] porque lo que habita en la oscuridad ya conoce tu nombre. [Sigh]";
      } else if (type === "dialogue") {
        const isabela = state.voices.find(x => x.noizVoiceId === "b0a1531a") || state.voices[0];
        const kid = state.voices.find(x => x.age === "Niño" && x.gender === "Femenino") || state.voices[10];
        const elder = state.voices.find(x => x.age === "Mayor" && x.gender === "Masculino") || state.voices[20];
        if (isabela) selectActiveVoice(isabela, false);
        input.value = "Esta tarde, en la vieja biblioteca del pueblo, la pequeña Sofía encontró un libro cubierto de polvo dorado.";
        state.dialogueBlocks = [
          { id: "d1", voice: kid, text: "[Giggle] ¡Abuelo, mira este libro! ¡Las páginas brillan cuando las toco!" },
          { id: "d2", voice: elder, text: "[Chuckles] Con cuidado, pequeña. Ese libro guarda los secretos de nuestros antepasados." }
        ];
        renderDialogueBlocks();
        showToast("🎬 Modo Diálogo Multi-Voz cargado con 3 locutores distintos.");
      }

      document.getElementById("charCount").textContent = input.value.length;
    });
  });

  // Use voice's original prompt button
  document.getElementById("btnUseVoicePrompt").addEventListener("click", () => {
    if (state.selectedVoice && state.selectedVoice.sampleText) {
      const input = document.getElementById("ttsTextInput");
      input.value = state.selectedVoice.sampleText;
      document.getElementById("charCount").textContent = input.value.length;
    }
  });

  // Preview Real Original Noiz Audio in Studio
  document.getElementById("btnPreviewOriginalNoiz").addEventListener("click", () => {
    if (state.selectedVoice) {
      previewVoice(state.selectedVoice, false);
    }
  });

  // Preview Synthesized Voice in Studio
  document.getElementById("btnPreviewCurrentVoice").addEventListener("click", () => {
    if (state.selectedVoice) {
      previewVoice(state.selectedVoice, true);
    }
  });

  // Speech-to-Text Dictation Mic
  document.getElementById("btnDictateMic").addEventListener("click", () => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast("Tu navegador no soporta dictado por voz directo.");
      return;
    }
    const rec = new SpeechRec();
    rec.lang = "es-ES";
    showToast("🎤 Escuchando... habla ahora por tu micrófono.");
    rec.onresult = ev => {
      const transcript = ev.results[0][0].transcript;
      const input = document.getElementById("ttsTextInput");
      input.value = `${input.value} ${transcript}`.trim();
      document.getElementById("charCount").textContent = input.value.length;
      showToast("✓ Texto dictado añadido.");
    };
    rec.start();
  });

  // Add Dialogue Speaker Block buttons
  ["btnAddSpeakerBlock", "btnAddAnotherSpeaker", "btnAddDialogueMode"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("click", () => {
        addDialogueBlock();
        showToast("➕ Añadido nuevo bloque de locutor al diálogo.");
      });
    }
  });

  // Delegated events on Dialogue Blocks List
  document.getElementById("dialogueBlocksList").addEventListener("click", e => {
    const changeBtn = e.target.closest("[data-change-dlg-voice]");
    if (changeBtn) {
      state.targetDialogueBlockIndex = parseInt(changeBtn.getAttribute("data-change-dlg-voice"), 10);
      document.getElementById("voiceSelectorModal").classList.remove("hidden");
      renderVoiceModal();
      return;
    }
    const prevBtn = e.target.closest("[data-preview-dlg]");
    if (prevBtn) {
      const idx = parseInt(prevBtn.getAttribute("data-preview-dlg"), 10);
      const blk = state.dialogueBlocks[idx];
      if (blk) {
        previewVoice({ ...blk.voice, sampleText: blk.text }, true);
      }
      return;
    }
    const remBtn = e.target.closest("[data-remove-dlg]");
    if (remBtn) {
      const idx = parseInt(remBtn.getAttribute("data-remove-dlg"), 10);
      state.dialogueBlocks.splice(idx, 1);
      renderDialogueBlocks();
    }
  });

  document.getElementById("dialogueBlocksList").addEventListener("input", e => {
    const ta = e.target.closest("[data-dlg-textarea]");
    if (ta) {
      const idx = parseInt(ta.getAttribute("data-dlg-textarea"), 10);
      if (state.dialogueBlocks[idx]) {
        state.dialogueBlocks[idx].text = ta.value;
      }
    }
  });

  // Synthesize Full Multi-Speaker Dialogue
  document.getElementById("btnSynthesizeDialogue").addEventListener("click", synthesizeFullDialogue);

  // Open Voice Selector Modal
  const voiceModal = document.getElementById("voiceSelectorModal");
  ["btnOpenVoiceSelectorNav", "btnChangeVoiceCard", "btnOpenModalMain", "btnOpenVoiceModalTop", "btnOpenModalHeader"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("click", () => {
        state.targetDialogueBlockIndex = null;
        voiceModal.classList.remove("hidden");
        renderVoiceModal();
      });
    }
  });

  document.getElementById("btnCloseVoiceModal").addEventListener("click", () => {
    voiceModal.classList.add("hidden");
    state.previewAudio.pause();
    state.currentlyPlayingVoiceId = null;
  });

  // Textarea counter & clear
  const ttsInput = document.getElementById("ttsTextInput");
  ttsInput.addEventListener("input", () => {
    document.getElementById("charCount").textContent = ttsInput.value.length;
  });
  document.getElementById("btnClearText").addEventListener("click", () => {
    ttsInput.value = "";
    state.dialogueBlocks = [];
    renderDialogueBlocks();
    document.getElementById("charCount").textContent = "0";
  });

  // Sliders in Right Inspector
  const emoRange = document.getElementById("emoIntensityRange");
  emoRange.addEventListener("input", () => {
    const val = (parseInt(emoRange.value, 10) / 100).toFixed(2);
    document.getElementById("emoIntensityLabel").textContent = `${val >= 0.7 ? "Alta" : val >= 0.4 ? "Media" : "Baja"} (${val})`;
  });

  const pitchRange = document.getElementById("pitchRange");
  pitchRange.addEventListener("input", () => {
    const v = parseInt(pitchRange.value, 10);
    document.getElementById("pitchValueLabel").textContent = `${v >= 0 ? "+" : ""}${v}Hz`;
  });

  const rateRange = document.getElementById("rateRange");
  rateRange.addEventListener("input", () => {
    const v = parseInt(rateRange.value, 10);
    const mult = (1 + v / 100).toFixed(2);
    document.getElementById("rateValueLabel").textContent = `${mult}x (${v >= 0 ? "+" : ""}${v}%)`;
  });

  // Synthesize Main Button
  document.getElementById("btnSynthesizeMain").addEventListener("click", synthesizeMainText);

  // Play/Pause result button
  document.getElementById("btnPlayPauseResult").addEventListener("click", () => {
    const audioEl = document.getElementById("mainAudioElement");
    if (audioEl.paused) audioEl.play();
    else audioEl.pause();
  });

  // Export WAV DSP button
  document.getElementById("btnDownloadWavDsp").addEventListener("click", exportDspWavFile);

  // Open local folder buttons
  document.getElementById("btnOpenAudioFolder").addEventListener("click", () => {
    apiFetch("/api/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderType: "audio" })
    });
    showToast("Abriendo carpeta C:\\db\\Github\\tts\\descargas_audio en Windows Explorer...");
  });

  document.querySelectorAll("[data-folder]").forEach(btn => {
    btn.addEventListener("click", () => {
      const folderType = btn.getAttribute("data-folder");
      apiFetch("/api/open-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderType })
      });
      showToast("Abriendo carpeta local en el Explorador de Windows...");
    });
  });

  // History list clicks
  document.getElementById("historyList").addEventListener("click", e => {
    const playBtn = e.target.closest("[data-play-url]");
    if (playBtn) {
      const url = playBtn.getAttribute("data-play-url");
      const mainAudio = document.getElementById("mainAudioElement");
      document.getElementById("audioResultCard").classList.remove("hidden");
      mainAudio.src = url;
      mainAudio.play();
      drawWaveformAnimation(mainAudio);
    }
  });

  // Modal Tabs
  document.querySelectorAll(".noiz-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".noiz-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      state.activeModalTab = tab.getAttribute("data-modal-tab");
      renderVoiceModal();
    });
  });

  // Modal Search & Live Noiz Search
  const searchInput = document.getElementById("voiceSearchInput");
  const clearSearchBtn = document.getElementById("btnClearSearch");
  searchInput.addEventListener("input", () => {
    state.filters.search = searchInput.value;
    clearSearchBtn.classList.toggle("hidden", !searchInput.value);
    renderVoiceModal();
  });
  searchInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      searchLiveNoizCatalog(false);
    }
  });
  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    state.filters.search = "";
    clearSearchBtn.classList.add("hidden");
    renderVoiceModal();
  });

  document.getElementById("btnSearchLiveNoiz").addEventListener("click", () => searchLiveNoizCatalog(false));
  document.getElementById("btnLoadMoreLiveNoiz").addEventListener("click", () => searchLiveNoizCatalog(true));

  // Modal Dropdown Filters
  document.getElementById("filterLanguage").addEventListener("change", e => {
    state.filters.language = e.target.value;
    renderVoiceModal();
  });

  document.getElementById("filterGender").addEventListener("change", e => {
    state.filters.gender = e.target.value;
    renderVoiceModal();
  });

  document.getElementById("filterAge").addEventListener("change", e => {
    state.filters.age = e.target.value;
    document.querySelectorAll(".age-pill").forEach(p => {
      p.classList.toggle("active", p.getAttribute("data-age-pill") === state.filters.age);
    });
    renderVoiceModal();
  });

  document.querySelectorAll(".age-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".age-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      const ageVal = pill.getAttribute("data-age-pill");
      state.filters.age = ageVal;
      document.getElementById("filterAge").value = ageVal;
      renderVoiceModal();
    });
  });

  document.querySelectorAll(".noiz-style-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const style = chip.getAttribute("data-style");
      if (state.filters.style === style) {
        state.filters.style = null;
        chip.classList.remove("active");
      } else {
        document.querySelectorAll(".noiz-style-chip").forEach(c => c.classList.remove("active"));
        state.filters.style = style;
        chip.classList.add("active");
      }
      renderVoiceModal();
    });
  });

  document.getElementById("btnResetFilters").addEventListener("click", () => {
    state.filters = { search: "", language: "es", gender: "all", age: "all", style: null };
    searchInput.value = "";
    document.getElementById("filterLanguage").value = "es";
    document.getElementById("filterGender").value = "all";
    document.getElementById("filterAge").value = "all";
    document.querySelectorAll(".noiz-style-chip").forEach(c => c.classList.remove("active"));
    document.querySelectorAll(".age-pill").forEach(p => {
      p.classList.toggle("active", p.getAttribute("data-age-pill") === "all");
    });
    renderVoiceModal();
    showToast("Filtros restablecidos.");
  });

  document.getElementById("btnSeeAllVoices").addEventListener("click", () => {
    searchLiveNoizCatalog(true);
  });

  document.getElementById("btnDownloadVisibleVoices").addEventListener("click", async () => {
    const visible = getFilteredVoices().slice(0, 10);
    if (visible.length === 0) return;
    showToast(`Descargando ${visible.length} voces originales a C:\\db\\Github\\tts\\voces_descargadas...`);
    const res = await apiFetch("/api/voices/download-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voices: visible })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`✓ ${data.count} audios originales + perfiles JSON guardados en ${data.folderPath}`);
    }
  });

  // Delegated clicks inside Voice Selector Modal
  voiceModal.addEventListener("click", async e => {
    const actionEl = e.target.closest("[data-action]");
    if (!actionEl) return;

    const action = actionEl.getAttribute("data-action");
    const voiceId = actionEl.getAttribute("data-voice-id");
    const voice = state.voices.find(v => v.id === voiceId);
    if (!voice) return;

    if (action === "preview") {
      e.stopPropagation();
      previewVoice(voice, false);
    } else if (action === "use") {
      e.stopPropagation();
      selectActiveVoice(voice, true);
    } else if (action === "fav") {
      e.stopPropagation();
      if (state.favorites.has(voiceId)) state.favorites.delete(voiceId);
      else state.favorites.add(voiceId);
      renderVoiceModal();
      await apiFetch("/api/userdata/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId })
      });
      syncToFirestore();
    } else if (action === "download-voice") {
      e.stopPropagation();
      downloadSingleVoicePack(voice);
    }
  });

  // Download Center Batch Pack Buttons
  document.querySelectorAll("[data-pack-age]").forEach(btn => {
    btn.addEventListener("click", () => {
      const age = btn.getAttribute("data-pack-age");
      downloadBatchVoicesByAge(age);
    });
  });

  // Download Center ONNX Model Buttons
  document.getElementById("onnxModelsGrid").addEventListener("click", e => {
    const dlBtn = e.target.closest("[data-model-dl]");
    if (dlBtn) {
      const modelId = dlBtn.getAttribute("data-model-dl");
      startModelDownload(modelId);
    }
  });

  // Import Script Modal
  const importModal = document.getElementById("importScriptModal");
  ["btnOpenImportScript", "btnOpenImportScriptSidebar"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", () => importModal.classList.remove("hidden"));
  });
  document.getElementById("btnCloseImportModal").addEventListener("click", () => {
    importModal.classList.add("hidden");
  });
  document.getElementById("btnProcessImportedScript").addEventListener("click", () => {
    const raw = document.getElementById("importScriptTextarea").value.trim();
    if (!raw) return;
    const lines = raw.split(/\n+/).map(l => l.trim()).filter(Boolean);
    state.dialogueBlocks = [];

    lines.forEach((line, idx) => {
      const parts = line.split(":");
      const speakerHint = parts.length > 1 ? parts[0].trim().toLowerCase() : "";
      const content = parts.length > 1 ? parts.slice(1).join(":").trim() : line;

      let matchedVoice = state.voices.find(v => v.name.toLowerCase().includes(speakerHint));
      if (!matchedVoice) {
        if (speakerHint.includes("niño") || speakerHint.includes("niña")) {
          matchedVoice = state.voices.find(v => v.age === "Niño");
        } else if (speakerHint.includes("abuel") || speakerHint.includes("mayor")) {
          matchedVoice = state.voices.find(v => v.age === "Mayor");
        } else if (speakerHint.includes("adolesc") || speakerHint.includes("joven")) {
          matchedVoice = state.voices.find(v => v.age === "Adolescente");
        } else {
          matchedVoice = state.voices[(idx * 5) % state.voices.length];
        }
      }

      if (idx === 0) {
        if (matchedVoice) selectActiveVoice(matchedVoice, false);
        document.getElementById("ttsTextInput").value = content;
        document.getElementById("charCount").textContent = content.length;
      } else {
        addDialogueBlock(matchedVoice, content);
      }
    });

    importModal.classList.add("hidden");
    showToast(`✓ Guion importado con ${lines.length} bloques de locutor.`);
  });

  // API Key Modal
  const apiKeyModal = document.getElementById("apiKeyModal");
  document.getElementById("btnOpenApiKeyModal").addEventListener("click", () => {
    apiKeyModal.classList.remove("hidden");
  });
  document.getElementById("btnCloseApiKeyModal").addEventListener("click", () => {
    apiKeyModal.classList.add("hidden");
  });
  document.getElementById("btnSaveApiKey").addEventListener("click", async () => {
    const apiKey = document.getElementById("noizApiKeyInput").value.trim();
    const res = await apiFetch("/api/userdata/apikey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey })
    });
    const data = await res.json();
    state.hasNoizApiKey = Boolean(data.hasNoizApiKey);
    updateApiKeyBadge();
    apiKeyModal.classList.add("hidden");
    showToast(state.hasNoizApiKey ? "✓ API Key de Noiz.ai conectada y guardada en local." : "API Key eliminada (usando modo local ilimitado).");
  });

  // Voice Designer Modal
  const designerModal = document.getElementById("voiceDesignerModal");
  ["btnOpenVoiceDesigner", "btnOpenDesignerTop", "btnShortcutClone", "btnShortcutDesign"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", () => designerModal.classList.remove("hidden"));
  });
  document.getElementById("btnCloseDesignerModal").addEventListener("click", () => {
    designerModal.classList.add("hidden");
  });

  document.getElementById("designVoiceAge").addEventListener("change", e => {
    const age = e.target.value;
    const pSlider = document.getElementById("designPitchRange");
    const rSlider = document.getElementById("designRateRange");
    const dspSel = document.getElementById("designDspProfile");

    if (age === "Niño") {
      pSlider.value = 36;
      rSlider.value = 7;
      dspSel.value = "child";
    } else if (age === "Adolescente") {
      pSlider.value = 18;
      rSlider.value = 6;
      dspSel.value = "teen";
    } else if (age === "Mayor") {
      pSlider.value = -22;
      rSlider.value = -12;
      dspSel.value = "elder";
    } else {
      pSlider.value = 0;
      rSlider.value = 0;
      dspSel.value = "natural";
    }
    document.getElementById("designPitchLabel").textContent = `${pSlider.value >= 0 ? "+" : ""}${pSlider.value}Hz`;
    document.getElementById("designRateLabel").textContent = `${rSlider.value >= 0 ? "+" : ""}${rSlider.value}%`;
  });

  document.getElementById("designPitchRange").addEventListener("input", e => {
    const v = parseInt(e.target.value, 10);
    document.getElementById("designPitchLabel").textContent = `${v >= 0 ? "+" : ""}${v}Hz`;
  });

  document.getElementById("designRateRange").addEventListener("input", e => {
    const v = parseInt(e.target.value, 10);
    document.getElementById("designRateLabel").textContent = `${v >= 0 ? "+" : ""}${v}%`;
  });

  document.getElementById("btnTestDesignedVoice").addEventListener("click", () => {
    const p = parseInt(document.getElementById("designPitchRange").value, 10);
    const r = parseInt(document.getElementById("designRateRange").value, 10);
    previewVoice(
      {
        id: "temp-design",
        name: document.getElementById("designVoiceName").value || "Voz Diseñada",
        age: document.getElementById("designVoiceAge").value,
        shortName: document.getElementById("designBaseVoiceSelect").value,
        pitch: `${p >= 0 ? "+" : ""}${p}Hz`,
        rate: `${r >= 0 ? "+" : ""}${r}%`,
        sampleText: document.getElementById("designSampleText").value
      },
      true
    );
  });

  document.getElementById("btnSaveDesignedVoice").addEventListener("click", async () => {
    const name = document.getElementById("designVoiceName").value.trim() || "Mi Voz Personalizada";
    const subtitle = document.getElementById("designVoiceSubtitle").value.trim();
    const gender = document.getElementById("designVoiceGender").value;
    const age = document.getElementById("designVoiceAge").value;
    const shortName = document.getElementById("designBaseVoiceSelect").value;
    const dspProfile = document.getElementById("designDspProfile").value;
    const p = parseInt(document.getElementById("designPitchRange").value, 10);
    const r = parseInt(document.getElementById("designRateRange").value, 10);
    const sampleText = document.getElementById("designSampleText").value.trim();

    const res = await apiFetch("/api/userdata/custom-voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voice: {
          name,
          subtitle,
          gender,
          age,
          shortName,
          dspProfile,
          pitch: `${p >= 0 ? "+" : ""}${p}Hz`,
          rate: `${r >= 0 ? "+" : ""}${r}%`,
          sampleText
        }
      })
    });
    const data = await res.json();
    if (data.success && data.voice) {
      state.voices.unshift(data.voice);
      state.customVoices.unshift(data.voice);
      await syncToFirestore();
      designerModal.classList.add("hidden");
      selectActiveVoice(data.voice, false);
      renderVoiceModal();
      showToast(`¡Voz "${data.voice.name}" guardada en "Mi voz" y sincronizada con Firebase!`);
    }
  });
});
