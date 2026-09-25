// Diagnostic log overlay
window.addEventListener("error", function(e) {
  let errDiv = document.getElementById("diag-error-box");
  if (!errDiv) {
    errDiv = document.createElement("div");
    errDiv.id = "diag-error-box";
    errDiv.style.position = "fixed";
    errDiv.style.bottom = "20px";
    errDiv.style.right = "20px";
    errDiv.style.backgroundColor = "rgba(220, 53, 69, 0.95)";
    errDiv.style.color = "white";
    errDiv.style.padding = "15px";
    errDiv.style.borderRadius = "8px";
    errDiv.style.zIndex = "10000";
    errDiv.style.maxWidth = "450px";
    errDiv.style.fontFamily = "monospace";
    errDiv.style.fontSize = "12px";
    errDiv.style.boxShadow = "0 4px 15px rgba(0,0,0,0.5)";
    errDiv.style.border = "1px solid #ff8888";
    document.body.appendChild(errDiv);
  }
  errDiv.innerText = "Erro no Script:\n" + e.message + "\n\nArquivo: " + e.filename + "\nLinha: " + e.lineno;
});

window.addEventListener("unhandledrejection", function(e) {
  let errDiv = document.getElementById("diag-error-box");
  if (!errDiv) {
    errDiv = document.createElement("div");
    errDiv.id = "diag-error-box";
    errDiv.style.position = "fixed";
    errDiv.style.bottom = "20px";
    errDiv.style.right = "20px";
    errDiv.style.backgroundColor = "rgba(220, 53, 69, 0.95)";
    errDiv.style.color = "white";
    errDiv.style.padding = "15px";
    errDiv.style.borderRadius = "8px";
    errDiv.style.zIndex = "10000";
    errDiv.style.maxWidth = "450px";
    errDiv.style.fontFamily = "monospace";
    errDiv.style.fontSize = "12px";
    errDiv.style.boxShadow = "0 4px 15px rgba(0,0,0,0.5)";
    errDiv.style.border = "1px solid #ff8888";
    document.body.appendChild(errDiv);
  }
  errDiv.innerText = "Erro Assíncrono (Promessa Rejeitada):\n" + (e.reason ? (e.reason.message || e.reason) : e);
});

// Painel de diagnóstico desativado na tela principal
const diagPanel = document.createElement("div");
diagPanel.id = "diag-panel";
diagPanel.style.display = "none";

function logToDiag(msg, type = "info") {
  const container = document.getElementById("diag-panel-logs");
  if (!container) return;
  const line = document.createElement("div");
  line.style.marginBottom = "4px";
  line.style.wordBreak = "break-all";
  if (type === "error") {
    line.style.color = "#ff3333";
  } else if (type === "warn") {
    line.style.color = "#ffaa00";
  }
  line.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
  container.appendChild(line);
  diagPanel.scrollTop = diagPanel.scrollHeight;
}

// Interceptar console
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = function(...args) {
  originalLog.apply(console, args);
  logToDiag(args.join(" "), "info");
};
console.warn = function(...args) {
  originalWarn.apply(console, args);
  logToDiag(args.join(" "), "warn");
};
console.error = function(...args) {
  originalError.apply(console, args);
  logToDiag(args.join(" "), "error");
};

// ============================================================
// CONFIG — Ajustes finos do motor de IA (editáveis pelo painel)
// ============================================================
const CONFIG_DEFAULTS = {
  poseMinConfidence:       0.20,
  faceMinConfidence:       0.20,
  landmarkVisThreshold:    0.45,
  poseConfidenceFilter:    0.25,
  maxZoomSolo:             1.45,  // Permite aproximar sujeitos distantes mantendo máxima qualidade
  maxZoomGroup:            1.20,  // Permite melhor aproveitamento de grupos sem esmagar laterais
  subjectHeightTarget:     0.75,
  faceThirdPosition:       0.33,
  blurThreshold:           12,    // Calibrado com normalização de contraste: rejeita apenas borrões severos reais
  darkThreshold:           14,    // Tolerante: só rejeita fotos genuinamente irrecuperáveis
  brightThreshold:         245,   // Tolerante: só rejeita fotos totalmente queimadas
  faceDetectionEnabled:    true,  // FaceDetector BlazeFace ativado como apoio/fallback para retratos
  showAnnotations:         false, // Visualizacao de marcacoes faciais/esqueleto (desativada por padrao)
};
let CONFIG = { ...CONFIG_DEFAULTS };

// Thumbnail SVG de erro premium em caso de falha de carregamento ou arquivo corrompido
const ERROR_THUMBNAIL_SVG = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="450" height="450" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#1e1e2e"/>
  <path d="M50 25 L80 75 L20 75 Z" fill="none" stroke="#ff6600" stroke-width="4" stroke-linejoin="round"/>
  <text x="50" y="58" fill="#ff6600" font-family="Outfit, sans-serif" font-size="24" text-anchor="middle" font-weight="bold">!</text>
  <text x="50" y="85" fill="#a6adc8" font-family="Outfit, sans-serif" font-size="5" text-anchor="middle">Falha de Leitura / Conversão</text>
</svg>
`);

// Função para extrair diretamente a miniatura JPEG embutida de qualquer arquivo RAW através de file carving binário de duas passadas
async function carveJpegFromRaw(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const buffer = new Uint8Array(e.target.result);
        const len = buffer.length;
        
        const soiStack = [];
        let bestStart = -1;
        let bestEnd = -1;
        let bestSize = 0;
        
        // Passada 1 (Estrita): Varredura buscando cabeçalhos JPEG com assinaturas EXIF ou JFIF válidas
        // Isso evita falsos positivos gerados por dados aleatórios do sensor
        for (let i = 0; i < len - 10; i++) {
          if (buffer[i] === 0xFF) {
            // Início de Imagem JPEG (SOI): FF D8 FF
            if (buffer[i+1] === 0xD8 && buffer[i+2] === 0xFF) {
              const marker = buffer[i+3];
              // Marcadores APP0 até APP15 (geralmente E0 a EF)
              if (marker >= 0xE0 && marker <= 0xEF) {
                // Verificar assinatura "Exif" ou "JFIF" na área do cabeçalho
                const isExif = buffer[i+6] === 0x45 && buffer[i+7] === 0x78 && buffer[i+8] === 0x69 && buffer[i+9] === 0x66;
                const isJfif = buffer[i+6] === 0x4A && buffer[i+7] === 0x46 && buffer[i+8] === 0x49 && buffer[i+9] === 0x46;
                if (isExif || isJfif) {
                  soiStack.push(i);
                  i += 9; // Avança além do cabeçalho validado
                }
              }
            }
            // Fim de Imagem JPEG (EOI): FF D9
            else if (buffer[i+1] === 0xD9) {
              if (soiStack.length > 0) {
                const startIdx = soiStack.pop();
                const endIdx = i + 2;
                const size = endIdx - startIdx;
                
                // Procuramos a maior imagem JPEG (o preview principal de alta qualidade)
                if (size > bestSize) {
                  bestSize = size;
                  bestStart = startIdx;
                  bestEnd = endIdx;
                }
              }
            }
          }
        }
        
        // Passada 2 (Fallback Menos Estrito): Executado apenas se a busca estrita falhar.
        // Varre buscando qualquer padrão SOI / EOI utilizando a pilha.
        if (bestStart === -1) {
          console.warn(`[RAW Carver] Busca estrita falhou para ${file.name}. Tentando busca menos estrita...`);
          soiStack.length = 0; // Limpar pilha
          for (let i = 0; i < len - 4; i++) {
            if (buffer[i] === 0xFF) {
              if (buffer[i+1] === 0xD8 && buffer[i+2] === 0xFF) {
                soiStack.push(i);
                i += 2;
              }
              else if (buffer[i+1] === 0xD9) {
                if (soiStack.length > 0) {
                  const startIdx = soiStack.pop();
                  const endIdx = i + 2;
                  const size = endIdx - startIdx;
                  
                  if (size > bestSize) {
                    bestSize = size;
                    bestStart = startIdx;
                    bestEnd = endIdx;
                  }
                }
              }
            }
          }
        }
        
        if (bestStart !== -1 && bestEnd !== -1) {
          console.log(`[RAW Carver] Sucesso ao extrair JPEG de ${file.name} (Tamanho: ${(bestSize / 1024 / 1024).toFixed(2)} MB, Offsets: ${bestStart} - ${bestEnd})`);
          const jpegBytes = buffer.subarray(bestStart, bestEnd);
          const blob = new Blob([jpegBytes], { type: "image/jpeg" });
          resolve(blob);
        } else {
          reject(new Error("Nenhuma imagem JPEG de visualização embutida encontrada no arquivo RAW."));
        }
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Erro ao ler dados binários do arquivo RAW."));
    reader.readAsArrayBuffer(file);
  });
}

// Função para extrair a orientação EXIF de arquivos Canon CR3 (estrutura ISOBMFF / CMT1)
async function extractCr3Orientation(file) {
  try {
    // Ler os primeiros 4MB do arquivo (o box moov/uuid/CMT1 com metadados EXIF TIFF fica no início)
    const sliceSize = Math.min(file.size, 4 * 1024 * 1024);
    const slice = file.slice(0, sliceSize);
    const arrayBuffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const len = bytes.length;

    // 1. Procurar pela assinatura da caixa "CMT1" (Canon Metadata 1)
    let tiffOffset = -1;
    for (let i = 0; i < len - 16; i++) {
      if (bytes[i] === 0x43 && bytes[i+1] === 0x4D && bytes[i+2] === 0x54 && bytes[i+3] === 0x31) {
        // Encontrou "CMT1" (o conteúdo TIFF inicia imediatamente após ou com um pequeno deslocamento de box)
        const candidateOffset = i + 4;
        if (candidateOffset + 8 <= len) {
          if ((bytes[candidateOffset] === 0x49 && bytes[candidateOffset+1] === 0x49 && bytes[candidateOffset+2] === 0x2A && bytes[candidateOffset+3] === 0x00) ||
              (bytes[candidateOffset] === 0x4D && bytes[candidateOffset+1] === 0x4D && bytes[candidateOffset+2] === 0x00 && bytes[candidateOffset+3] === 0x2A)) {
            tiffOffset = candidateOffset;
            break;
          }
        }
      }
    }

    // 2. Se não encontrou 'CMT1' diretamente colado no TIFF, procurar qualquer assinatura TIFF válida nos primeiros MBs
    if (tiffOffset === -1) {
      for (let i = 0; i < len - 16; i++) {
        if ((bytes[i] === 0x49 && bytes[i+1] === 0x49 && bytes[i+2] === 0x2A && bytes[i+3] === 0x00) ||
            (bytes[i] === 0x4D && bytes[i+1] === 0x4D && bytes[i+2] === 0x00 && bytes[i+3] === 0x2A)) {
          tiffOffset = i;
          break;
        }
      }
    }

    if (tiffOffset === -1) {
      console.warn(`[CR3 Orientation] Cabeçalho TIFF não encontrado nos primeiros 4MB de ${file.name}`);
      return null;
    }

    // 3. Parser TIFF manual para tag 0x0112 (Orientation)
    const isLittleEndian = (bytes[tiffOffset] === 0x49 && bytes[tiffOffset+1] === 0x49);
    const view = new DataView(arrayBuffer, tiffOffset);
    const ifd0Offset = view.getUint32(4, isLittleEndian);
    if (ifd0Offset >= 0 && tiffOffset + ifd0Offset + 2 <= len) {
      const numEntries = view.getUint16(ifd0Offset, isLittleEndian);
      for (let j = 0; j < numEntries; j++) {
        const entryPos = ifd0Offset + 2 + (j * 12);
        if (entryPos + 12 > view.byteLength) break;
        const tag = view.getUint16(entryPos, isLittleEndian);
        if (tag === 0x0112) {
          const orientation = view.getUint16(entryPos + 8, isLittleEndian);
          console.log(`[CR3 Orientation manual] Orientação detectada para ${file.name}: ${orientation}`);
          return orientation;
        }
      }
    }

    // 4. Fallback via exifr caso disponível passando o chunk TIFF
    if (window.exifr && window.exifr.orientation) {
      try {
        const tiffChunk = bytes.subarray(tiffOffset);
        const exifrVal = await window.exifr.orientation(tiffChunk);
        if (exifrVal) {
          console.log(`[CR3 Orientation via exifr] Orientação detectada para ${file.name}: ${exifrVal}`);
          return parseInt(exifrVal);
        }
      } catch (e) {
        // Ignorar
      }
    }
  } catch (err) {
    console.warn(`[CR3 Orientation] Falha ao extrair orientação de ${file.name}:`, err);
  }
  return null;
}

// Helper para obter a fonte de imagem (Object URL), extraindo de arquivos RAW se necessario ou convertendo HEIC
async function getImageSrc(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  
  // 1. Tratamento de HEIC/HEIF usando a biblioteca HeicTo
  const isHeic = ["heic", "heif"].includes(ext);
  if (isHeic) {
    if (window.HeicTo) {
      try {
        console.log(`[HEIC] Convertendo arquivo HEIC: ${file.name}`);
        const convertedBlob = await window.HeicTo({
          blob: file,
          type: "image/jpeg",
          quality: 0.8
        });
        const singleBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
        return URL.createObjectURL(singleBlob);
      } catch (e) {
        console.error("Falha ao converter arquivo HEIC via HeicTo:", e);
        throw new Error(`Erro na conversão HEIC: ${e.message || e}`);
      }
    } else {
      console.warn("HEIC detectado, mas HeicTo não está disponível.");
      throw new Error("Conversão HEIC indisponível (biblioteca heic-to.js não carregada).");
    }
  }

  // 2. Tratamento de RAW usando carveJpegFromRaw com exifr de fallback secundário
  const isRaw = ["cr2", "nef", "arw", "dng", "pef", "orf", "rw2", "raf", "crw", "erf", "mrw", "sr2", "srf", "raw", "cr3"].includes(ext);
  if (isRaw) {
    // Tentativa 1: Nosso decodificador universal (file carving) buscando o preview em ALTA RESOLUÇÃO
    try {
      console.log(`[RAW Carver] Iniciando decodificador binário universal para ${file.name}`);
      const carvedBlob = await carveJpegFromRaw(file);
      return URL.createObjectURL(carvedBlob);
    } catch (carverErr) {
      console.warn(`[RAW Carver] Falha no carving de ${file.name}. Acionando exifr de fallback...`, carverErr);
      
      // Tentativa 2: Fallback secundário usando exifr (pode retornar thumbnail pequena)
      if (window.exifr) {
        try {
          const thumbBytes = await window.exifr.thumbnail(file);
          if (thumbBytes && thumbBytes.byteLength > 0) {
            const blob = new Blob([thumbBytes], { type: "image/jpeg" });
            return URL.createObjectURL(blob);
          }
        } catch (exifrErr) {
          console.error(`[RAW exifr Fallback] Falha total na extração exifr para ${file.name}:`, exifrErr);
        }
      }
      
      throw new Error(`Erro ao extrair preview RAW: ${carverErr.message || carverErr}`);
    }
  }
  return URL.createObjectURL(file);
}

// App State
let imagesData = [];
let watermarkVertical = null;
let watermarkHorizontal = null;
let watermarkReels = null;
let watermarkWide = null;
let exportQuality = 1.0;
let exportBaseName = "TOP1001_A_D1";
let exportMethod = "folder"; // "folder" or "zip"
let activeTab = "all"; // "all", "review", "done"
let currentEditorIndex = -1;
let isProcessing = false;
let editorShowFaces = false; // Controla overlay de rostos no editor (desabilitado por padrão)
let editorShowWatermark = true; // Controla visibilidade do overlay da marca d'água no editor manual

// ==============================================================
// Persistência de Marcas d'Água (IndexedDB + LocalStorage)
// ==============================================================
const WM_DB_NAME = "MidiaLGND_WatermarksDB";
const WM_STORE_NAME = "wm_images";

function openWmDB() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(WM_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(WM_STORE_NAME)) {
          db.createObjectStore(WM_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

async function persistWatermarkImage(type, dataUrl, label) {
  try {
    const db = await openWmDB();
    if (!db) return;
    const tx = db.transaction(WM_STORE_NAME, "readwrite");
    tx.objectStore(WM_STORE_NAME).put({ dataUrl, label, timestamp: Date.now() }, type);
  } catch (e) {
    console.warn("[WM] Falha ao persistir marca d'água:", e);
  }
}

async function deletePersistedWatermark(type) {
  try {
    const db = await openWmDB();
    if (!db) return;
    const tx = db.transaction(WM_STORE_NAME, "readwrite");
    tx.objectStore(WM_STORE_NAME).delete(type);
  } catch (e) {}
}

async function loadPersistedWatermarks() {
  try {
    const db = await openWmDB();
    if (!db) return;
    const types = ["vertical", "horizontal", "reels", "wide"];
    for (const type of types) {
      const entry = await new Promise((res) => {
        const tx = db.transaction(WM_STORE_NAME, "readonly");
        const req = tx.objectStore(WM_STORE_NAME).get(type);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => res(null);
      });

      if (entry && entry.dataUrl) {
        const img = new Image();
        img.onload = () => {
          if (type === "vertical") {
            watermarkVertical = img;
            if (wmBadgeVertical) wmBadgeVertical.classList.add("active");
            if (wmLabelVertical) wmLabelVertical.innerText = entry.label || "✔ Carregada";
          } else if (type === "horizontal") {
            watermarkHorizontal = img;
            if (wmBadgeHorizontal) wmBadgeHorizontal.classList.add("active");
            if (wmLabelHorizontal) wmLabelHorizontal.innerText = entry.label || "✔ Carregada";
          } else if (type === "reels") {
            watermarkReels = img;
            if (wmBadgeReels) wmBadgeReels.classList.add("active");
            if (wmLabelReels) wmLabelReels.innerText = entry.label || "✔ Carregada";
          } else if (type === "wide") {
            watermarkWide = img;
            if (wmBadgeWide) wmBadgeWide.classList.add("active");
            if (wmLabelWide) wmLabelWide.innerText = entry.label || "✔ Carregada";
          }
          checkReadyToExport();
          updateWatermarkThumbnails();
        };
        img.src = entry.dataUrl;
      }
    }
  } catch (e) {
    console.warn("[WM] Erro ao restaurar marcas d'água persistidas:", e);
  }
}

// Atualizar mini-prévias visuais das marcas d'água na barra lateral
function updateWatermarkThumbnails() {
  const items = [
    { obj: watermarkVertical, box: document.getElementById("wm-thumb-box-vertical"), img: document.getElementById("wm-thumb-img-vertical") },
    { obj: watermarkHorizontal, box: document.getElementById("wm-thumb-box-horizontal"), img: document.getElementById("wm-thumb-img-horizontal") },
    { obj: watermarkReels, box: document.getElementById("wm-thumb-box-reels"), img: document.getElementById("wm-thumb-img-reels") },
    { obj: watermarkWide, box: document.getElementById("wm-thumb-box-wide"), img: document.getElementById("wm-thumb-img-wide") }
  ];
  items.forEach(({ obj, box, img }) => {
    if (!box || !img) return;
    if (obj && obj.src) {
      img.src = obj.src;
      box.style.display = "flex";
    } else {
      box.style.display = "none";
      img.src = "";
    }
  });
}

function saveWmConfigToStorage(opts) {
  try {
    localStorage.setItem("midia_lgnd_wm_config", JSON.stringify(opts));
  } catch (e) {}
}

function loadWmConfigFromStorage() {
  try {
    const raw = localStorage.getItem("midia_lgnd_wm_config");
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
// DOM Elements
const bodyDragOverlay = document.getElementById("body-drag-overlay");
const dropzonePhotos = document.getElementById("dropzone-photos");
const inputFolderPicker = document.getElementById("input-folder-picker");
const inputFilesPicker = document.getElementById("input-files-picker");
const linkChooseFolder = document.getElementById("link-choose-folder");
const linkChooseFiles = document.getElementById("link-choose-files");
const btnStartProcess = document.getElementById("btn-start-process");

const inputWmVertical = document.getElementById("input-wm-vertical");
const inputWmHorizontal = document.getElementById("input-wm-horizontal");
const inputWmReels = document.getElementById("input-wm-reels");
const inputWmWide = document.getElementById("input-wm-wide");
const wmBadgeVertical = document.getElementById("wm-badge-vertical");
const wmBadgeHorizontal = document.getElementById("wm-badge-horizontal");
const wmBadgeReels = document.getElementById("wm-badge-reels");
const wmBadgeWide = document.getElementById("wm-badge-wide");

const exportQualitySlider = document.getElementById("export-quality");
const exportQualityVal = document.getElementById("export-quality-val");
const exportBaseNameInput = document.getElementById("export-base-name");
const methodFolderBtn = document.getElementById("method-folder");
const methodZipBtn = document.getElementById("method-zip");

const progressPanel = document.getElementById("progress-panel");
const progressBar = document.getElementById("progress-bar");
const progressPercent = document.getElementById("progress-percent");
const progressStatusText = document.getElementById("progress-status-text");
const progressSpeed = document.getElementById("progress-speed");
const progressEta = document.getElementById("progress-eta");

const gridContainer = document.getElementById("grid-container");
const thumbnailsGrid = document.getElementById("thumbnails-grid");
const tabAll = document.getElementById("tab-all");
const tabReview = document.getElementById("tab-review");
const tabDone = document.getElementById("tab-done");
const tabRejected = document.getElementById("tab-rejected");

const badgeAll = document.getElementById("badge-all");
const badgeReviewTab = document.getElementById("badge-review-tab");
const badgeDone = document.getElementById("badge-done");
const badgeRejectedTab = document.getElementById("badge-rejected-tab");
const tabPending = document.getElementById("tab-pending");
const badgePending = document.getElementById("badge-pending");
const btnEliminateFiltered = document.getElementById("btn-eliminate-filtered");
const btnApproveFiltered = document.getElementById("btn-approve-filtered");

const statTotal = document.getElementById("stat-total");
const statProcessed = document.getElementById("stat-processed");
const statHoriz = document.getElementById("stat-horiz");
const statVert = document.getElementById("stat-vert");
const statReview = document.getElementById("stat-review");
const statCardReview = document.getElementById("stat-card-review");
const statRejected = document.getElementById("stat-rejected");
const statCardRejected = document.getElementById("stat-card-rejected");

// Detectar se está rodando online (ex: midia.legendariosjapan.jp) para exibir botão de download da versão offline
const btnDownloadOffline = document.getElementById("btn-download-offline");
if (btnDownloadOffline) {
  const isLocal = ["localhost", "127.0.0.1", "", "::1"].includes(window.location.hostname);
  if (!isLocal) {
    btnDownloadOffline.style.display = "inline-flex";
  } else {
    btnDownloadOffline.style.display = "none";
  }
}

// Editor Modal Elements
const editorModal = document.getElementById("editor-modal");
const editorCanvas = document.getElementById("editor-canvas");
const canvasWrapper = document.getElementById("canvas-wrapper");
const editorThirds = document.getElementById("editor-thirds");
const btnCloseEditor = document.getElementById("btn-close-editor");
const editorFilename = document.getElementById("editor-filename");
const editorOrientationBadge = document.getElementById("editor-orientation-badge");
const editorZoomSlider = document.getElementById("editor-zoom");
const editorZoomVal = document.getElementById("editor-zoom-val");
const editorRotateSlider = document.getElementById("editor-rotate");
const editorRotateVal = document.getElementById("editor-rotate-val");
const btnApproveCrop = document.getElementById("btn-approve-crop");
const btnPrevCrop = document.getElementById("btn-prev-crop");
const btnNextCrop = document.getElementById("btn-next-crop");
const btnToggleOrientation = document.getElementById("btn-toggle-orientation");
const btnToggleWmOverlay = document.getElementById("btn-toggle-wm-overlay");
const toggleWmText = document.getElementById("toggle-wm-text");
const toggleWmIcon = document.getElementById("toggle-wm-icon");
const btnApplyColorToAll = document.getElementById("btn-apply-color-to-all");

// Canvas Dimmers
const dimmerTop = document.getElementById("crop-dimmer-top");
const dimmerBottom = document.getElementById("crop-dimmer-bottom");
const dimmerLeft = document.getElementById("crop-dimmer-left");
const dimmerRight = document.getElementById("crop-dimmer-right");

// Auto-analysis display elements
const autoZoomDisplay = document.getElementById("auto-zoom-display");
const autoRotateDisplay = document.getElementById("auto-rotate-display");
const autoFacesDisplay = document.getElementById("auto-faces-display");
const zoomAutoTag = document.getElementById("zoom-auto-tag");
const rotateAutoTag = document.getElementById("rotate-auto-tag");
const wmLabelVertical = document.getElementById("wm-label-vertical");
const wmLabelHorizontal = document.getElementById("wm-label-horizontal");
const wmLabelReels = document.getElementById("wm-label-reels");
const wmLabelWide = document.getElementById("wm-label-wide");
const editorColorGrading = document.getElementById("editor-color-grading");
const autoRejectionRow = document.getElementById("auto-rejection-row");
const autoRejectionDisplay = document.getElementById("auto-rejection-display");

// Editor Manual Color Corrections Elements
const editorBrightness = document.getElementById("editor-brightness");
const editorBrightnessVal = document.getElementById("editor-brightness-val");
const editorContrast = document.getElementById("editor-contrast");
const editorContrastVal = document.getElementById("editor-contrast-val");
const editorSaturation = document.getElementById("editor-saturation");
const editorSaturationVal = document.getElementById("editor-saturation-val");

// Initialize Face Finder Model (Offline)
let poseLandmarker = null;
let faceDetector = null;
let isModelLoading = false;

async function initMediaPipePose() {
  if (poseLandmarker || isModelLoading) return;
  isModelLoading = true;
  
  const badge = document.getElementById("mp-status-badge");
  if (badge) {
    badge.innerText = "MediaPipe: Carregando...";
    badge.style.color = "var(--warning-color)";
  }
  
  let poseLoaded = false;
  let faceLoaded = false;
  let useGpu = false;
  
  try {
    console.log("Obtendo classes do escopo global...");
    const FilesetResolver = window.FilesetResolver;
    const PoseLandmarker = window.PoseLandmarker;
    const FaceDetector = window.FaceDetector;

    if (!FilesetResolver || !PoseLandmarker || !FaceDetector) {
      throw new Error("Classes do MediaPipe não encontradas no escopo global (verifique se o vision_bundle.js foi carregado no index.html).");
    }
    
    // Resolver arquivos WASM locais (servidos pelo nosso http://localhost:5005/ ou caminhos file://)
    const vision = await FilesetResolver.forVisionTasks("./wasm");
    
    // 1. Carregar detector de pose
    try {
      poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "./models/pose_landmarker_lite.task",
          delegate: "GPU" // Utilizar aceleração por GPU se disponível
        },
        runningMode: "IMAGE",
        numPoses: 10, // Permitir detecção de múltiplos corpos (grupos de até 10 pessoas)
        minPoseDetectionConfidence: CONFIG.poseMinConfidence,
        minPosePresenceConfidence: CONFIG.poseMinConfidence
      });
      console.log("✔ MediaPipe Pose Landmarker inicializado com GPU!");
      poseLoaded = true;
      useGpu = true;
    } catch (gpuErr) {
      console.warn("Falha ao inicializar PoseLandmarker com GPU, tentando CPU...", gpuErr);
      poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "./models/pose_landmarker_lite.task",
          delegate: "CPU"
        },
        runningMode: "IMAGE",
        numPoses: 10,
        minPoseDetectionConfidence: CONFIG.poseMinConfidence,
        minPosePresenceConfidence: CONFIG.poseMinConfidence
      });
      console.log("✔ MediaPipe Pose Landmarker inicializado com CPU!");
      poseLoaded = true;
    }

    if (badge) {
      badge.innerText = "MediaPipe: Pose OK...";
    }

    // 2. Carregar detector de face como fallback
    try {
      faceDetector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "./models/blaze_face_short_range.tflite",
          delegate: "GPU"
        },
        runningMode: "IMAGE",
        minDetectionConfidence: CONFIG.faceMinConfidence
      });
      console.log("✔ MediaPipe Face Detector inicializado com GPU!");
      faceLoaded = true;
      useGpu = useGpu && true;
    } catch (gpuErr) {
      console.warn("Falha ao inicializar FaceDetector com GPU, tentando CPU...", gpuErr);
      faceDetector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "./models/blaze_face_short_range.tflite",
          delegate: "CPU"
        },
        runningMode: "IMAGE",
        minDetectionConfidence: CONFIG.faceMinConfidence
      });
      console.log("✔ MediaPipe Face Detector inicializado com CPU!");
      faceLoaded = true;
      useGpu = false;
    }
    
    if (badge) {
      badge.innerText = `MediaPipe: Pronto (${useGpu ? "GPU" : "CPU"})`;
      badge.style.color = useGpu ? "var(--success-color)" : "var(--warning-color)";
      badge.style.borderColor = useGpu ? "var(--success-color)" : "var(--warning-color)";
    }
  } catch (err) {
    console.error("Falha ao inicializar modelos MediaPipe:", err);
    if (badge) {
      badge.innerText = "MediaPipe: Erro";
      badge.style.color = "red";
      badge.style.borderColor = "red";
    }
    throw err; // Lançar erro para ser capturado pelo painel de diagnóstico
  } finally {
    isModelLoading = false;
  }
}

// Analisar pontos anatômicos da pose detectada pelo MediaPipe
function analyzePoseLandmarks(landmarks, imgWidth, imgHeight) {
  let minX = 1.0, maxX = 0.0;
  let minY = 1.0, maxY = 0.0;
  let visibleCount = 0;
  
  // Helper seguro para obter a visibilidade ou confiança de um marco anatômico
  const getVis = (lm) => {
    if (!lm) return 0;
    const v = (lm.visibility !== undefined) ? lm.visibility : ((lm.score !== undefined) ? lm.score : 1.0);
    return isNaN(v) ? 1.0 : v;
  };
  
  // 1. Encontrar caixa delimitadora do corpo baseada nos pontos visíveis
  landmarks.forEach((lm) => {
    const vis = getVis(lm);
    // Considerar pontos com visibilidade/confiança razoável
    if (vis > CONFIG.landmarkVisThreshold) {
      if (lm.x < minX) minX = lm.x;
      if (lm.x > maxX) maxX = lm.x;
      if (lm.y < minY) minY = lm.y;
      if (lm.y > maxY) maxY = lm.y;
      visibleCount++;
    }
  });
  
  // Se houver pouquíssimos pontos visíveis, mas temos landmarks, e todos vieram sem visibilidade/confiança
  // (ou seja, getVis retornou 1.0 para todos, fazendo visibleCount ser > 0), isso funciona perfeitamente!
  if (visibleCount < 4) return null; // Poucos pontos detectados, não é uma pessoa visível
  
  // Coordenadas absolutas em pixels da imagem
  const boxX = minX * imgWidth;
  const boxY = minY * imgHeight;
  const boxW = (maxX - minX) * imgWidth;
  const boxH = (maxY - minY) * imgHeight;
  
  // 2. Extrair pontos específicos (Cabeça, Ombros, Tronco)
  const nose = landmarks[0];
  const lEye = landmarks[2];
  const rEye = landmarks[5];
  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];
  const lHip = landmarks[23];
  const rHip = landmarks[24];
  
  // Avaliar se a cabeça e olhos estão visíveis
  let hasEyes = getVis(lEye) > CONFIG.landmarkVisThreshold && getVis(rEye) > CONFIG.landmarkVisThreshold;
  let hasHead = getVis(nose) > CONFIG.landmarkVisThreshold || hasEyes;
  let headX = hasHead ? (nose.x * imgWidth) : (((lShoulder.x + rShoulder.x) / 2) * imgWidth);
  let headY = hasHead ? (nose.y * imgHeight) : (Math.min(lShoulder.y, rShoulder.y) * imgHeight - 40);

  // Olhos precisos para a Regra dos Terços (Linha dos Olhos)
  let eyeCenterX = hasEyes ? (((lEye.x + rEye.x) / 2) * imgWidth) : headX;
  let eyeCenterY = hasEyes ? (((lEye.y + rEye.y) / 2) * imgHeight) : (headY - 10);

  // Vetor de direção do olhar (Looking Room): negativo = olhando à esquerda, positivo = olhando à direita
  let gazeDirection = 0.0;
  if (hasEyes && getVis(nose) > CONFIG.landmarkVisThreshold) {
    const eyeDist = Math.abs(rEye.x - lEye.x);
    if (eyeDist > 0.005) {
      const eyeMidX = (lEye.x + rEye.x) / 2;
      const rawGaze = (nose.x - eyeMidX) / eyeDist;
      gazeDirection = Math.max(-1.0, Math.min(1.0, rawGaze * 2.0));
    }
  }
  
  // Ombros
  let hasShoulders = getVis(lShoulder) > CONFIG.landmarkVisThreshold && getVis(rShoulder) > CONFIG.landmarkVisThreshold;
  const shoulderCX = ((lShoulder.x + rShoulder.x) / 2) * imgWidth;
  const shoulderCY = ((lShoulder.y + rShoulder.y) / 2) * imgHeight;
  
  // Quadril / Tronco
  let hasTorso = getVis(lHip) > CONFIG.landmarkVisThreshold && getVis(rHip) > CONFIG.landmarkVisThreshold;
  const hipCX = hasTorso ? (((lHip.x + rHip.x) / 2) * imgWidth) : shoulderCX;
  const hipCY = hasTorso ? (((lHip.y + rHip.y) / 2) * imgHeight) : (shoulderCY + boxH * 0.4);

  // Pernas, Pés e Calçados (Detecção de Corpo Inteiro para evitar amputação de sapatos)
  const lAnkle = landmarks[27];
  const rAnkle = landmarks[28];
  const lHeel  = landmarks[29];
  const rHeel  = landmarks[30];
  const lFoot  = landmarks[31];
  const rFoot  = landmarks[32];

  const footVis = [getVis(lAnkle), getVis(rAnkle), getVis(lHeel), getVis(rHeel), getVis(lFoot), getVis(rFoot)];
  const hasFeet = footVis.some(v => v > 0.35);
  let lowestFootY = null;
  if (hasFeet) {
    const footLms = [lAnkle, rAnkle, lHeel, rHeel, lFoot, rFoot].filter(lm => lm && getVis(lm) > 0.30);
    if (footLms.length > 0) {
      lowestFootY = Math.max(...footLms.map(lm => lm.y * imgHeight));
    }
  }
  
  // Estimar tamanho aproximado da cabeça
  let headSize = 50;
  if (hasHead && hasShoulders) {
    headSize = Math.abs(shoulderCY - headY) * 0.75;
  } else if (hasHead) {
    // Estimativa por raio ocular
    headSize = Math.hypot(lEye.x - rEye.x, lEye.y - rEye.y) * imgWidth * 2.0;
  }
  
  // Média de visibilidade dos pontos chave
  const keyVisibilities = [
    getVis(nose),
    getVis(lShoulder),
    getVis(rShoulder),
    getVis(lHip),
    getVis(rHip)
  ];
  const confidence = keyVisibilities.reduce((a, b) => a + b, 0) / keyVisibilities.length;

  // 3. Cálculo de Inclinação / Ângulo do Sujeito (Auto-Leveling)
  let tiltAngle = 0.0;
  let hasTiltAngle = false;
  if (hasEyes) {
    const dx = (lEye.x - rEye.x) * imgWidth;
    const dy = (lEye.y - rEye.y) * imgHeight;
    const eyeDist = Math.hypot(dx, dy);
    if (eyeDist > 15) {
      const eyeAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
      // Ângulos suaves de desnível de câmera (entre -12° e +12°)
      if (Math.abs(eyeAngle) <= 12.0) {
        tiltAngle = eyeAngle;
        hasTiltAngle = true;
      }
    }
  }

  if (hasShoulders) {
    const sDx = (lShoulder.x - rShoulder.x) * imgWidth;
    const sDy = (lShoulder.y - rShoulder.y) * imgHeight;
    const sDist = Math.hypot(sDx, sDy);
    if (sDist > 30) {
      const shoulderAngle = (Math.atan2(sDy, sDx) * 180) / Math.PI;
      if (Math.abs(shoulderAngle) <= 12.0) {
        if (hasTiltAngle) {
          if (Math.sign(shoulderAngle) === Math.sign(tiltAngle) || Math.abs(shoulderAngle - tiltAngle) < 5.0) {
            tiltAngle = (tiltAngle * 0.65) + (shoulderAngle * 0.35);
          }
        } else {
          tiltAngle = shoulderAngle;
          hasTiltAngle = true;
        }
      }
    }
  }
  
  return {
    x: boxX,
    y: boxY,
    width: boxW,
    height: boxH,
    
    hasHead: hasHead,
    headX: headX,
    headY: headY,
    headSize: headSize,

    hasEyes: hasEyes,
    eyeCenterX: eyeCenterX,
    eyeCenterY: eyeCenterY,
    gazeDirection: gazeDirection,
    
    hasShoulders: hasShoulders,
    shoulderX: shoulderCX,
    shoulderY: shoulderCY,
    
    hasTorso: hasTorso,
    hipX: hipCX,
    hipY: hipCY,

    hasFeet: hasFeet,
    lowestFootY: lowestFootY,

    hasTiltAngle: hasTiltAngle,
    tiltAngle: tiltAngle,
    
    confidence: confidence,
    landmarks: landmarks // Salvar para desenho do esqueleto se necessário
  };
}

// Helper to convert Image to GrayScale pixels for pico.js
function getGrayscalePixels(ctx, width, height) {
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < width * height; ++i) {
    // Grayscale formula: (R+G+B)/3
    pixels[i] = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
  }
  return pixels;
}

// Quality checking algorithms (Blur, Exposure and Color Grading Analysis)
function calculateSharpness(pixels, width, height, startX, startY, spanW, spanH) {
  const x0 = Math.max(1, Math.min(width - 2, Math.round(startX)));
  const y0 = Math.max(1, Math.min(height - 2, Math.round(startY)));
  const x1 = Math.max(x0 + 2, Math.min(width - 2, Math.round(startX + spanW)));
  const y1 = Math.max(y0 + 2, Math.min(height - 2, Math.round(startY + spanH)));

  let minVal = 255;
  let maxVal = 0;
  let totalPixels = 0;

  // 1. Medição da faixa dinâmica local para normalização de contraste
  for (let y = y0; y < y1; y++) {
    const rowOffset = y * width;
    for (let x = x0; x < x1; x++) {
      const v = pixels[rowOffset + x];
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
      totalPixels++;
    }
  }

  if (totalPixels < 10) return 40;
  const localRange = maxVal - minVal;
  // Se a região for completamente plana/sem textura
  if (localRange < 10) return 20;

  // Fator de escala para normalizar o contraste local para 0-255:
  // Isso DESACOPLA totalmente a iluminação da nitidez! Fotos escuras em foco mantêm arestas normalizadas nítidas.
  const normScale = 255.0 / Math.max(28, localRange);

  let sumGradSq = 0;
  let edgePixelCount = 0;
  // Limiar de corte de ruído sobre a escala normalizada
  const NOISE_THRESHOLD = 20;

  for (let y = y0; y < y1; y++) {
    const rowOffset = y * width;
    const topOffset = (y - 1) * width;
    const btmOffset = (y + 1) * width;
    for (let x = x0; x < x1; x++) {
      // Sobel 3x3
      const gx = (pixels[topOffset + x + 1] + 2 * pixels[rowOffset + x + 1] + pixels[btmOffset + x + 1])
               - (pixels[topOffset + x - 1] + 2 * pixels[rowOffset + x - 1] + pixels[btmOffset + x - 1]);

      const gy = (pixels[btmOffset + x - 1] + 2 * pixels[btmOffset + x] + pixels[btmOffset + x + 1])
               - (pixels[topOffset + x - 1] + 2 * pixels[topOffset + x] + pixels[btmOffset + x + 1]);

      const rawGrad = Math.hypot(gx, gy);
      const normGrad = rawGrad * normScale;

      if (normGrad > NOISE_THRESHOLD) {
        sumGradSq += normGrad * normGrad;
        edgePixelCount++;
      }
    }
  }

  const edgeDensity = edgePixelCount / totalPixels;
  const avgEnergy = edgePixelCount > 0 ? (sumGradSq / edgePixelCount) : 0;
  const sharpnessIndex = Math.sqrt(avgEnergy) * Math.sqrt(edgeDensity);
  return sharpnessIndex;
}

function calculateBrightness(ctx, width, height, startX, startY, spanW, spanH) {
  const x0 = Math.max(0, Math.min(width - 1, Math.round(startX)));
  const y0 = Math.max(0, Math.min(height - 1, Math.round(startY)));
  const w = Math.max(1, Math.min(width - x0, Math.round(spanW)));
  const h = Math.max(1, Math.min(height - y0, Math.round(spanH)));

  try {
    const imgData = ctx.getImageData(x0, y0, w, h);
    const data = imgData.data;
    const pixelCount = w * h;

    let totalLuminance = 0;
    let crushedBlacks = 0;   // < 8 (preto absoluto empastado sem detalhe)
    let blownHighlights = 0; // > 248 (branco puro queimado)
    let rSum = 0, gSum = 0, bSum = 0;
    let midtoneCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i+1];
      const b = data[i+2];
      // Luminância ponderada ITU-R BT.709
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      totalLuminance += luminance;

      if (luminance < 8) {
        crushedBlacks++;
      } else if (luminance > 248) {
        blownHighlights++;
      } else if (luminance >= 35 && luminance <= 220) {
        midtones++;
        rSum += r;
        gSum += g;
        bSum += b;
        midtoneCount++;
      }
    }

    const meanLuminance = totalLuminance / pixelCount;
    const shadowClipRatio = crushedBlacks / pixelCount;
    const highlightClipRatio = blownHighlights / pixelCount;

    // Estimativa de Balanço de Branco (AWB) em tons médios
    let colorCast = "neutral";
    if (midtoneCount > 30) {
      const avgR = rSum / midtoneCount;
      const avgG = gSum / midtoneCount;
      const avgB = bSum / midtoneCount;
      const avgM = (avgR + avgG + avgB) / 3 || 1;
      if (avgR / avgM > 1.25 && avgB / avgM < 0.85) colorCast = "warm";
      else if (avgB / avgM > 1.25 && avgR / avgM < 0.85) colorCast = "cool";
    }

    return {
      meanLuminance: meanLuminance,
      shadowClipRatio: shadowClipRatio,
      highlightClipRatio: highlightClipRatio,
      colorCast: colorCast
    };
  } catch (err) {
    return {
      meanLuminance: 127,
      shadowClipRatio: 0,
      highlightClipRatio: 0,
      colorCast: "neutral"
    };
  }
}

function analyzeQuality(ctx, width, height, faces, pixels, poses) {
  let isBlurry = false;
  let isTooDark = false;
  let isTooBright = false;
  let isBacklit = false;
  let reason = "";
  let sharpness = 0;
  let exposure = { meanLuminance: 127, shadowClipRatio: 0, highlightClipRatio: 0, colorCast: "neutral" };

  // Medir iluminação global da cena para detecção de silhueta/contra-luz
  const overallExposure = calculateBrightness(ctx, width, height, 0, 0, width, height);

  if (poses && poses.length > 0) {
    // Sujeito principal detectado pelo Pose Landmarker
    const primary = poses[0];
    const hSize = primary.headSize || 60;
    
    // 1. Região dos Olhos / Terço Superior da Face
    const eyeX = (primary.eyeCenterX || primary.headX) - hSize * 0.55;
    const eyeY = (primary.eyeCenterY || (primary.headY - hSize * 0.15)) - hSize * 0.35;
    const eyeW = hSize * 1.1;
    const eyeH = hSize * 0.7;
    const sharpEyes = calculateSharpness(pixels, width, height, eyeX, eyeY, eyeW, eyeH);

    // 2. Região Completa da Cabeça (Boca, Nariz, Cabelo, Barba)
    const faceX = primary.headX - hSize * 0.6;
    const faceY = primary.headY - hSize * 0.6;
    const faceW = hSize * 1.2;
    const faceH = hSize * 1.4;
    const sharpFace = calculateSharpness(pixels, width, height, faceX, faceY, faceW, faceH);

    // 3. Região do Tronco / Peito (onde roupas, emblemas e crachás têm alto contraste)
    const torsoX = (primary.shoulderX || primary.headX) - hSize * 0.9;
    const torsoY = (primary.shoulderY || (primary.headY + hSize * 0.8)) - hSize * 0.2;
    const torsoW = hSize * 1.8;
    const torsoH = hSize * 1.2;
    const sharpTorso = calculateSharpness(pixels, width, height, torsoX, torsoY, torsoW, torsoH);

    // O sujeito está em foco se QUALQUER uma das regiões principais estiver nítida
    // Evita falsos positivos se os olhos estiverem sob a sombra de um boné/chapéu
    sharpness = Math.max(sharpEyes, sharpFace, sharpTorso);

    // Medir exposição no rosto e tronco da pessoa
    exposure = calculateBrightness(ctx, width, height, faceX, faceY, faceW, faceH);

    // Identificar contra-luz (céu/fundo muito claro e pessoa na sombra)
    if (overallExposure.meanLuminance > 135 && exposure.meanLuminance < 95) {
      isBacklit = true;
    }
  } else if (faces && faces.length > 0) {
    // Sujeito detectado via FaceDetector fallback
    const primary = faces.slice().sort((a, b) => b[2] - a[2])[0];
    const y = primary[0];
    const x = primary[1];
    const r = primary[2] / 2;

    const fx = x - r;
    const fy = y - r;
    const fw = r * 2;
    const fh = r * 2;

    sharpness = calculateSharpness(pixels, width, height, fx, fy, fw, fh);
    exposure = calculateBrightness(ctx, width, height, fx, fy, fw, fh);

    if (overallExposure.meanLuminance > 135 && exposure.meanLuminance < 95) {
      isBacklit = true;
    }
  } else {
    // Foto sem pessoas (decoração, troféus, paisagens, detalhes da pista)
    // Avaliar 5 zonas de composição fotográfica (regra dos terços) e usar a zona mais nítida
    const zones = [
      { x: width * 0.25, y: height * 0.25, w: width * 0.50, h: height * 0.50 },
      { x: width * 0.15, y: height * 0.15, w: width * 0.35, h: height * 0.35 },
      { x: width * 0.50, y: height * 0.15, w: width * 0.35, h: height * 0.35 },
      { x: width * 0.15, y: height * 0.50, w: width * 0.35, h: height * 0.35 },
      { x: width * 0.50, y: height * 0.50, w: width * 0.35, h: height * 0.35 }
    ];

    let maxSharp = 0;
    zones.forEach(z => {
      const s = calculateSharpness(pixels, width, height, z.x, z.y, z.w, z.h);
      if (s > maxSharp) maxSharp = s;
    });
    sharpness = maxSharp;
    exposure = calculateBrightness(ctx, width, height, width * 0.15, height * 0.15, width * 0.70, height * 0.70);
  }

  const brightness = Math.round(exposure.meanLuminance);

  // Limiar de nitidez dinâmico: em fotos escuras, a tolerância é ainda maior para nunca confundir baixa luz com falta de foco
  const effectiveBlurThreshold = brightness < 65 ? Math.max(7, CONFIG.blurThreshold - 4) : CONFIG.blurThreshold;

  // Critérios de rejeição:
  // 1. Nitidez óptica insuficiente (somente borrão óptico severo real)
  if (sharpness < effectiveBlurThreshold) {
    isBlurry = true;
    reason = "Desfocada (sujeito sem nitidez)";
  }

  // 2. Subexposição irrecuperável (somente se muito escura E com perda total de textura)
  if (brightness < CONFIG.darkThreshold && exposure.shadowClipRatio > 0.70) {
    isTooDark = true;
    reason = "Subexposta (escura demais e sem textura)";
  }

  // 3. Superexposição irrecuperável (somente se sujeito estiver com pele totalmente queimada)
  if (brightness > CONFIG.brightThreshold && exposure.highlightClipRatio > 0.55) {
    isTooBright = true;
    reason = "Superexposta (sujeito queimado)";
  }

  return {
    rejected: isBlurry || isTooDark || isTooBright,
    reason: reason,
    sharpness: Math.round(sharpness),
    brightness: brightness,
    overallBrightness: Math.round(overallExposure.meanLuminance),
    shadowClipRatio: exposure.shadowClipRatio,
    highlightClipRatio: exposure.highlightClipRatio,
    isBacklit: isBacklit,
    colorCast: exposure.colorCast
  };
}

// Heurística de tons de pele humana para filtragem de falsos positivos
function isSkinColor(r, g, b) {
  if (r < 40 && g < 40 && b < 40) return false; // Descartar sombras/pretos (ex: alças de mochila)
  if (r <= g || r <= b) return false;           // Tons de pele são quentes (vermelho é o canal dominante)
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 12) return false;             // Descartar escala de cinza/madeiras cinzentas (baixo contraste de cor)
  
  if (g > r * 0.95 && g > b) return false;      // Descartar verde (folhagens/gramado de fundo)
  
  // Descartar laranjas e vermelhos ultra-saturados de uniformes (azul B é muito baixo em relação ao vermelho R)
  // Na pele humana, mesmo sob luz intensa, há uma proporção saudável de azul nos capilares e pigmentação.
  if (r > 150 && b < r * 0.25) return false;
  
  return true;
}

function validateSkinTone(ctx, cx, cy, size) {
  try {
    const imgData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    const data = imgData.data;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    
    // Amostrar 5 pontos próximos ao centro do rosto candidato
    const offset = Math.round(size * 0.12);
    const points = [
      { x: cx, y: cy },
      { x: cx - offset, y: cy - offset },
      { x: cx + offset, y: cy - offset },
      { x: cx - offset, y: cy + offset },
      { x: cx + offset, y: cy + offset }
    ];
    
    let skinPoints = 0;
    points.forEach(pt => {
      const px = Math.max(0, Math.min(w - 1, Math.round(pt.x)));
      const py = Math.max(0, Math.min(h - 1, Math.round(pt.y)));
      const idx = (py * w + px) * 4;
      
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      
      if (isSkinColor(r, g, b)) {
        skinPoints++;
      }
    });
    
    // Se pelo menos 3 dos 5 pontos forem compatíveis com tom de pele, a detecção é considerada válida
    return skinPoints >= 3;
  } catch (err) {
    return true; // Fallback seguro caso haja erro na leitura de pixels
  }
}

// Smart Crop Logic — Motor de Composição Fotográfica Profissional com Regra dos Terços
function computeSmartCrop(imgWidth, imgHeight, targetRatio, poses, orientation) {
  // --- Dimensões base do enquadramento na proporção desejada ---
  let cropWidth, cropHeight;
  if (imgWidth / imgHeight > targetRatio) {
    cropHeight = imgHeight;
    cropWidth  = imgHeight * targetRatio;
  } else {
    cropWidth  = imgWidth;
    cropHeight = imgWidth / targetRatio;
  }

  // Ponto de partida padrão (para fotos de objetos/cenários/paisagens sem pessoas):
  // Na fotografia, a linha do horizonte ou centro de interesse fica no terço superior (~40-42%)
  let cropX = (imgWidth  - cropWidth)  / 2;
  let cropY = (imgHeight - cropHeight) * 0.40;

  let confidence  = "high";
  let autoZoom    = 1.0;
  let autoRotate  = 0.0;
  const origRatio = imgWidth / imgHeight;

  // --- Poses e Rostos detectados ---
  if (poses && poses.length > 0) {
    // Filtrar apenas poses com confiança razoável (>= 0.20)
    let validPoses = poses.filter(p => p.confidence >= CONFIG.poseConfidenceFilter);

    if (validPoses.length > 0) {
      const imgCenterX = imgWidth / 2;
      const imgCenterY = imgHeight / 2;

      // 1. CÁLCULO DE SALIÊNCIA VISUAL (Identificação Real de Quem é o Sujeito da Foto)
      // O sujeito principal em primeiro plano tem muito mais área no quadro do que passantes no fundo.
      // Score = Área do corpo (35%) + Área da cabeça (65%) + Bônus de olhos/rosto visíveis + Bônus suave de centralidade
      const scoredPoses = validPoses.map(p => {
        const bodyArea = (p.width || 100) * (p.height || 100);
        const headArea = (p.headSize || 50) * (p.headSize || 50);
        const hasFaceBonus = p.hasHead ? 1.4 : 1.0;
        const distFromCenter = Math.hypot((p.x + p.width / 2) - imgCenterX, (p.y + p.height / 2) - imgCenterY);
        const maxDist = Math.hypot(imgCenterX, imgCenterY) || 1;
        const centerWeight = Math.max(0.65, 1.0 - (distFromCenter / maxDist) * 0.35);
        
        const saliency = (bodyArea * 0.35 + headArea * 0.65) * hasFaceBonus * centerWeight * (p.confidence || 0.8);
        return { pose: p, saliency: saliency };
      });

      // Ordenar por saliência decrescente
      scoredPoses.sort((a, b) => b.saliency - a.saliency);
      const primaryPose = scoredPoses[0].pose;
      const maxSaliency = scoredPoses[0].saliency;

      // 1.1 AUTO-NIVELAMENTO DO HORIZONTE E SUJEITO (AUTO-ROTATE)
      // Se a pose principal tiver desnível de câmera/cabeça detectado (entre -12° e +12°)
      if (primaryPose.hasTiltAngle && Math.abs(primaryPose.tiltAngle) >= 0.5 && Math.abs(primaryPose.tiltAngle) <= 12.0) {
        // Compensação com sinal oposto para desentortar e nivelar a foto
        autoRotate = Math.round((-primaryPose.tiltAngle) * 10) / 10;
      }

      // 2. FILTRAR TRANSEUNTES / PASSANTES ACIDENTAIS NO FUNDO
      // Se houver alguém no fundo com menos de 15% da saliência do sujeito principal, ignorar no cálculo de grupo
      const mainPoses = scoredPoses
        .filter(sp => sp.saliency >= maxSaliency * 0.15)
        .map(sp => sp.pose);

      const isGroup = mainPoses.length > 1;

      // 3. CAIXA DELIMITADORA E PONTOS CRÍTICOS DOS SUJEITOS PRINCIPAIS
      let groupMinX = Infinity, groupMaxX = -Infinity;
      let groupMinY = Infinity, groupMaxY = -Infinity;
      let highestHeadTop = Infinity;
      let lowestFootY = -Infinity;
      let hasFeetAny = false;

      mainPoses.forEach(p => {
        if (p.x < groupMinX) groupMinX = p.x;
        if (p.x + p.width > groupMaxX) groupMaxX = p.x + p.width;
        if (p.y < groupMinY) groupMinY = p.y;
        if (p.y + p.height > groupMaxY) groupMaxY = p.y + p.height;

        const hSize = p.headSize || 60;
        // Bonés, chapéus e penteados sobem pelo menos 1.55x headSize a partir do centro facial/nariz
        const hTop = p.hasHead ? (p.headY - hSize * 1.55) : p.y;
        if (hTop < highestHeadTop) highestHeadTop = hTop;

        if (p.hasFeet && p.lowestFootY) {
          hasFeetAny = true;
          if (p.lowestFootY > lowestFootY) lowestFootY = p.lowestFootY;
        }
      });

      const groupWidth = groupMaxX - groupMinX;
      const groupHeight = groupMaxY - groupMinY;

      // 4. AUTO-ZOOM DINÂMICO CONSCIENTE DA COMPOSIÇÃO
      if (!isGroup) {
        // Sujeito individual:
        const personHeightRatio = primaryPose.height / cropHeight;
        if (primaryPose.hasFeet && primaryPose.lowestFootY) {
          // Corpo inteiro: se a pessoa estiver muito distante (ocupando < 56% da altura do quadro),
          // aplica zoom equilibrado para valorizar a pessoa, mantendo sapatos e boné intactos
          if (personHeightRatio < 0.56) {
            const targetHeight = cropHeight * 0.70;
            const rawZoom = targetHeight / Math.max(1, primaryPose.height);
            autoZoom = Math.min(1.25, Math.max(1.0, rawZoom));
          } else {
            autoZoom = 1.0;
          }
        } else {
          // Retrato fechado / Meio-corpo: zoom proporcional até maxZoomSolo (1.45x)
          const targetHeight = cropHeight * CONFIG.subjectHeightTarget;
          const rawZoom = targetHeight / Math.max(1, primaryPose.height);
          autoZoom = Math.min(CONFIG.maxZoomSolo, Math.max(1.0, rawZoom));
        }
      } else {
        // Grupo de pessoas (dupla, família, equipe):
        // Se a largura do grupo já ocupa mais de 72% da largura do corte, mantém zoom 1.0 para não prensar ombros
        const groupOccupancy = groupWidth / cropWidth;
        if (groupOccupancy > 0.72) {
          autoZoom = 1.0;
        } else {
          const targetWidth = cropWidth * 0.84;
          const rawZoom = targetWidth / Math.max(1, groupWidth);
          autoZoom = Math.min(CONFIG.maxZoomGroup, Math.max(1.0, rawZoom));
        }
      }

      // Aplicar o zoom às dimensões do enquadramento
      const baseCropW = cropWidth;
      const baseCropH = cropHeight;
      cropWidth  = baseCropW / autoZoom;
      cropHeight = baseCropH / autoZoom;

      // 5. ENQUADRAMENTO HORIZONTAL (Centralização e Looking Room)
      if (isGroup) {
        // Grupos: centralização rigorosa no centro de massa do grupo com margem de segurança
        const groupCenterX = (groupMinX + groupMaxX) / 2;
        cropX = groupCenterX - cropWidth / 2;
      } else {
        // Solo: Centralização com compensação de Direção do Olhar (Lead Room / Looking Room)
        let anchorX = primaryPose.eyeCenterX || primaryPose.headX || (primaryPose.x + primaryPose.width / 2);
        
        // Se a pessoa estiver olhando expressivamente para a esquerda ou direita:
        // Dá respiro extra na direção para onde ela olha (evita sensação de sufocamento na borda)
        if (primaryPose.gazeDirection) {
          const lookShift = cropWidth * 0.05 * primaryPose.gazeDirection; // até 5% de deslocamento
          anchorX += lookShift;
        }
        
        cropX = anchorX - cropWidth / 2;
      }

      // 6. ENQUADRAMENTO VERTICAL & REGRA DOS TERÇOS
      // Definir a linha dos olhos ideal (Upper Third):
      // No 4:5 (feed) os olhos ficam a ~35-37% do topo (área de ouro, folga para marca d'água superior).
      // No 9:16 (Stories/Reels) os olhos ficam a ~38-40% para descer a cabeça e não bater no cabeçalho do Instagram.
      const isStories = (targetRatio < 0.65);
      const targetEyePercent = isStories ? 0.39 : 0.36;

      // Respiro superior (Headroom) seguro e generoso:
      // As marcas d'água no topo (TOP XX, Sol Nascente / Fonte da Vida) ocupam ~14% da foto.
      // Logo, o topo da cabeça/boné precisa ficar a pelo menos 16-17% do teto para nunca colidir com badges!
      const desiredHeadroom = cropHeight * (isStories ? 0.20 : 0.18); // 18% a 20%
      const minHeadroom     = cropHeight * (isStories ? 0.17 : 0.16); // 16% a 17%
      const maxHeadroom     = cropHeight * (isStories ? 0.26 : 0.23); // 23% a 26%

      // Ponto de referência do topo da cabeça/boné mais alto:
      const refHeadTop = Math.min(highestHeadTop, primaryPose.headY - (primaryPose.headSize || 60) * 1.55);

      // Uma foto é considerada de corpo inteiro se o SUJEITO PRINCIPAL tiver pés visíveis
      const isFullBody = Boolean(primaryPose.hasFeet && primaryPose.lowestFootY && (primaryPose.height / cropHeight > 0.60));

      if (!isFullBody) {
        // --- CENÁRIO: RETRATOS / MEIO-CORPO / CASAIS / GRUPOS ---
        const eyeY = primaryPose.eyeCenterY || (primaryPose.headY - (primaryPose.headSize || 60) * 0.15) || (primaryPose.y + primaryPose.height * 0.25);
        cropY = eyeY - (cropHeight * targetEyePercent);

        // 1. Garantir que a cabeça/boné NUNCA fique colada no teto nem encostando nas marcas d'água:
        if (cropY > refHeadTop - minHeadroom) {
          cropY = refHeadTop - desiredHeadroom;
        }

        // 2. Garantir que o topo não fique com espaço vazio exagerado:
        if (cropY < refHeadTop - maxHeadroom) {
          cropY = refHeadTop - desiredHeadroom;
        }

        // 3. Se for plano americano (meio corpo), evitar corte no queixo/garganta:
        const minBottom = primaryPose.shoulderY ? (primaryPose.shoulderY + (primaryPose.headSize || 60) * 0.8) : (primaryPose.y + (primaryPose.headSize || 60) * 1.8);
        if (cropY + cropHeight < minBottom) {
          cropY = minBottom - cropHeight;
        }
      } else {
        // --- CENÁRIO: CORPO INTEIRO REAL ---
        // Posiciona a cabeça com headroom seguro de pelo menos desiredHeadroom:
        cropY = refHeadTop - desiredHeadroom;

        // Se os pés do sujeito estiverem sendo cortados e houver margem para descer sem violar minHeadroom:
        const footMargin = cropHeight * 0.045; // 4.5% de respiro seguro abaixo do solado
        const neededY = (primaryPose.lowestFootY + footMargin) - cropHeight;
        
        if (neededY > cropY) {
          cropY = Math.min(refHeadTop - minHeadroom, neededY);
        }
      }

      // Clampar limites da imagem física para não criar faixas pretas
      cropX = Math.max(0, Math.min(imgWidth  - cropWidth,  cropX));
      cropY = Math.max(0, Math.min(imgHeight - cropHeight, cropY));

      // 7. SCORE DE CONFIANÇA E REVISÃO MANUAL
      mainPoses.forEach(p => {
        const tolX = cropWidth * 0.02;
        if (p.x + tolX < cropX || p.x + p.width - tolX > cropX + cropWidth) {
          confidence = "low"; // Corpo cortado nas laterais
        }
        if (p.hasHead && p.headY - p.headSize * 0.8 < cropY) {
          confidence = "low"; // Cabeça cortada no topo
        }
        if (p.confidence < 0.50) {
          confidence = "low";
        }
      });

      if (groupWidth > cropWidth * 1.15 || groupHeight > cropHeight * 1.15) {
        confidence = "low";
      }

    } else {
      confidence = "low";
    }
  } else {
    confidence = "low"; // Nenhuma pessoa detectada
  }

  // Se a proporção for muito extrema, marcar para revisão por segurança
  if (origRatio > 1.6 || origRatio < 0.6) {
    confidence = "low";
  }

  return {
    x:        Math.round(cropX),
    y:        Math.round(cropY),
    width:    Math.round(cropWidth),
    height:   Math.round(cropHeight),
    zoom:     autoZoom,
    rotate:   autoRotate,
    confidence: confidence
  };
}

// File loading & initial analysis
async function processSelectedFiles(filesList, append = false) {
  if (filesList.length === 0) return;
  
  // Proteção contra arquivos duplicados (nome + tamanho)
  let filesToProcess = filesList;
  if (append && imagesData.length > 0) {
    const existingKeys = new Set(imagesData.map(d => `${d.file ? d.file.name : d.name}_${d.file ? d.file.size : 0}`));
    const duplicates = [];
    const unique = [];
    for (const f of filesList) {
      const key = `${f.name}_${f.size}`;
      if (existingKeys.has(key)) {
        duplicates.push(f.name);
      } else {
        existingKeys.add(key);
        unique.push(f);
      }
    }
    if (duplicates.length > 0) {
      const msg = duplicates.length === 1
        ? `1 foto duplicada foi ignorada automaticamente (${duplicates[0]}).`
        : `${duplicates.length} fotos duplicadas foram ignoradas automaticamente.`;
      if (window.showSettingsToast) window.showSettingsToast(msg);
      console.log(`[Duplicatas] ${msg}`);
    }
    filesToProcess = unique;
  } else {
    // Remover duplicatas internas na própria seleção
    const seen = new Set();
    const unique = [];
    for (const f of filesList) {
      const key = `${f.name}_${f.size}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(f);
      }
    }
    if (unique.length < filesList.length) {
      const diff = filesList.length - unique.length;
      console.log(`[Duplicatas] ${diff} arquivo(s) idêntico(s) na seleção foram ignorados.`);
    }
    filesToProcess = unique;
  }

  if (filesToProcess.length === 0) {
    if (window.showSettingsToast) window.showSettingsToast("Nenhuma foto nova para adicionar (todas já existiam no lote).");
    return;
  }

  if (!append) {
    imagesData = [];
    thumbnailsGrid.innerHTML = "";
  }
  gridContainer.style.display = "flex";
  dropzonePhotos.style.display = "none";
  progressPanel.style.display = "block";
  btnStartProcess.disabled = true;
  
  updateStats();
  
  const total = filesToProcess.length;
  progressBar.style.width = "0%";
  progressPercent.innerText = "0%";
  
  let processedCount = 0;
  let startTime = Date.now();
  
  // Fila paralela assíncrona (processar de 3 em 3)
  const batchSize = 3;
  for (let i = 0; i < total; i += batchSize) {
    const batch = filesToProcess.slice(i, i + batchSize);
    await Promise.all(batch.map(file => processImageFile(file)));
    
    processedCount += batch.length;
    
    // Atualizar Barra de Progresso
    const pct = Math.round((processedCount / total) * 100);
    progressBar.style.width = `${pct}%`;
    progressPercent.innerText = `${pct}%`;
    
    // Calcular velocidade e ETA
    const elapsedSecs = (Date.now() - startTime) / 1000;
    const speed = processedCount / elapsedSecs;
    progressSpeed.innerText = `Velocidade: ${speed.toFixed(1)} img/s`;
    
    const remainingCount = total - processedCount;
    const etaSecs = remainingCount / speed;
    progressEta.innerText = `Tempo restante: ${Math.round(etaSecs)}s`;
    
    progressStatusText.innerText = `Analisando fotos (${processedCount} de ${total})...`;
  }
  
  progressPanel.style.display = "none";
  renderGrid();
  updateStats();
  checkReadyToExport();
}

// =====================================================================
// Gerador de Miniatura com Enquadramento Real, Filtros e Marca d'Água
// =====================================================================
function generateCroppedThumbnail(data, img) {
  if (!img) return data.thumbnailUrl || "";
  
  try {
    let targetWidth, targetHeight;
    if (data.orientation === "vertical") {
      if (data.targetRatio && Math.abs(data.targetRatio - 9/16) < 0.01) {
        targetHeight = 480;
        targetWidth = Math.round(480 * 9 / 16); // 270
      } else {
        targetWidth = 320;
        targetHeight = 400; // 4:5
      }
    } else {
      if (data.targetRatio && Math.abs(data.targetRatio - 16/9) < 0.01) {
        targetWidth = 480;
        targetHeight = Math.round(480 * 9 / 16); // 270
      } else {
        targetWidth = 400;
        targetHeight = 320; // 5:4
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#0c0c12";
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    ctx.save();
    ctx.translate(targetWidth / 2, targetHeight / 2);

    const cropRotate = (data.crop && data.crop.rotate) ? data.crop.rotate : 0;
    if (cropRotate) {
      ctx.rotate((cropRotate * Math.PI) / 180);
    }

    const cropW = (data.crop && data.crop.width) ? data.crop.width : data.origWidth;
    const cropH = (data.crop && data.crop.height) ? data.crop.height : data.origHeight;
    const cropScaleX = targetWidth / cropW;
    const cropScaleY = targetHeight / cropH;

    const rotationRad = (cropRotate * Math.PI) / 180;
    const rotationZoomCompensation = Math.abs(Math.cos(rotationRad)) + Math.abs(Math.sin(rotationRad)) * 1.30;
    ctx.scale(cropScaleX * rotationZoomCompensation, cropScaleY * rotationZoomCompensation);

    const defaultCenterX = data.origWidth / 2;
    const defaultCenterY = data.origHeight / 2;

    const cropCenterX = data.crop ? (data.crop.x + data.crop.width / 2) : defaultCenterX;
    const cropCenterY = data.crop ? (data.crop.y + data.crop.height / 2) : defaultCenterY;

    const deltaX = defaultCenterX - cropCenterX;
    const deltaY = defaultCenterY - cropCenterY;

    if (typeof buildImageFilter === "function") {
      ctx.filter = buildImageFilter(data);
    }

    const imgX = -data.origWidth / 2 + deltaX;
    const imgY = -data.origHeight / 2 + deltaY;
    const imgCX = imgX + data.origWidth / 2;
    const imgCY = imgY + data.origHeight / 2;

    ctx.save();
    ctx.translate(imgCX, imgCY);
    if (data.exifOrientation === 6) {
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -data.origHeight / 2, -data.origWidth / 2, data.origHeight, data.origWidth);
    } else if (data.exifOrientation === 8) {
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, -data.origHeight / 2, -data.origWidth / 2, data.origHeight, data.origWidth);
    } else if (data.exifOrientation === 3) {
      ctx.rotate(Math.PI);
      ctx.drawImage(img, -data.origWidth / 2, -data.origHeight / 2, data.origWidth, data.origHeight);
    } else {
      ctx.drawImage(img, -data.origWidth / 2, -data.origHeight / 2, data.origWidth, data.origHeight);
    }
    ctx.restore();
    ctx.restore();

    ctx.filter = "none";

    // Overlay Marca d'água em tempo real
    if (typeof getWatermarkForImage === "function") {
      const wm = getWatermarkForImage(data);
      if (wm) {
        ctx.save();
        const wmRatio = wm.width / wm.height;
        const canvasRatio = targetWidth / targetHeight;
        let drawW, drawH, drawX, drawY;

        if (wmRatio > canvasRatio) {
          drawH = targetHeight;
          drawW = targetHeight * wmRatio;
          drawX = (targetWidth - drawW) / 2;
          drawY = 0;
        } else {
          drawW = targetWidth;
          drawH = targetWidth / wmRatio;
          drawX = 0;
          drawY = (targetHeight - drawH) / 2;
        }
        ctx.drawImage(wm, drawX, drawY, drawW, drawH);
        ctx.restore();
      }
    }

    return canvas.toDataURL("image/jpeg", 0.82);
  } catch (e) {
    console.warn("[Thumbnail] Erro ao gerar thumbnail com crop:", e);
    return data.thumbnailUrl || "";
  }
}

async function processImageFile(file) {
  const id = "img_" + Math.random().toString(36).substr(2, 9);
  
  let url = null;
  try {
    // Obter Object URL (seja do RAW extraído via exifr, HEIC via HeicTo ou original)
    url = await getImageSrc(file);
    
    // Obter orientação EXIF usando exifr (estratégia robusta original + carver fallback)
    let exifOrientation = 1;
    try {
      const ext = file.name.split('.').pop().toLowerCase();

      // Se for Canon CR3, ler a orientação do container ISOBMFF / CMT1
      if (ext === "cr3") {
        const cr3Orient = await extractCr3Orientation(file);
        if (cr3Orient) {
          exifOrientation = parseInt(cr3Orient);
          console.log(`[CR3 Orientation] Orientação de ${file.name} obtida com sucesso: ${exifOrientation}`);
        }
      }

      if (exifOrientation === 1 && window.exifr) {
        let orientVal = null;
        try {
          orientVal = await window.exifr.orientation(file);
        } catch (exifrErr) {
          console.warn(`[exifr.orientation file] Falha:`, exifrErr);
        }
        
        // Se falhar ou for indefinido/1, tentar extrair do blob JPEG esculpido
        if ((!orientVal || orientVal === 1) && url && url.startsWith("blob:")) {
          try {
            const blobResponse = await fetch(url);
            const carvedBlob = await blobResponse.blob();
            orientVal = await window.exifr.orientation(carvedBlob);
          } catch (carvedExifErr) {
            console.warn(`[exifr.orientation carved] Falha:`, carvedExifErr);
          }
        }
        
        if (orientVal) {
          exifOrientation = parseInt(orientVal);
          console.log(`[EXIF Orientation] Orientação de ${file.name}: ${exifOrientation}`);
        }
      }
    } catch (exifErr) {
      console.warn(`[EXIF Orientation] Falha ao extrair orientação de ${file.name}:`, exifErr);
    }
    
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = function() {
        try {
          let renderWidth = img.width;
          let renderHeight = img.height;
          
          // Detectar se o navegador já auto-rotacionou a imagem nativamente com base no EXIF
          const isPhysicallyVertical = (exifOrientation === 5 || exifOrientation === 6 || exifOrientation === 7 || exifOrientation === 8);
          let browserAutoRotated = false;
          if (isPhysicallyVertical && renderWidth < renderHeight) {
            browserAutoRotated = true;
          } else if (exifOrientation === 3 || exifOrientation === 4) {
            const ext = file.name.split('.').pop().toLowerCase();
            const isRaw = ["cr2", "nef", "arw", "dng", "pef", "orf", "rw2", "raf", "crw", "erf", "mrw", "sr2", "srf", "raw", "cr3"].includes(ext);
            if (!isRaw) {
              browserAutoRotated = true;
            }
          }
          
          if (browserAutoRotated) {
            console.log(`[Orientation] O navegador auto-rotacionou nativamente a imagem ${file.name}. Usando orientação efetiva 1.`);
            exifOrientation = 1;
          } else if (isPhysicallyVertical && renderWidth > renderHeight) {
            // Compensação do quirk do navegador se ele NÃO tiver auto-rotacionado (ex: previews de RAWs esculpidos sem metadados legíveis)
            renderWidth = img.height;
            renderHeight = img.width;
            console.log(`[Orientation Fix] Corrigida orientação de ${file.name} de horizontal para vertical devido a metadados EXIF (${exifOrientation})`);
          }
          
          const orientation = renderWidth < renderHeight ? "vertical" : "horizontal";
          const targetRatio = orientation === "vertical" ? 4/5 : 5/4;
          
          // 1. Criar canvas de detecção de alta resolução (1024px) para preservar detalhes faciais
          const detectCanvas = document.createElement("canvas");
          const detectCtx = detectCanvas.getContext("2d");
          const maxDetectSize = 1024;
          
          let detectWidth, detectHeight;
          if (renderWidth > renderHeight) {
            detectWidth = maxDetectSize;
            detectHeight = (renderHeight / renderWidth) * maxDetectSize;
          } else {
            detectHeight = maxDetectSize;
            detectWidth = (renderWidth / renderHeight) * maxDetectSize;
          }
          detectCanvas.width = detectWidth;
          detectCanvas.height = detectHeight;
          
          if (exifOrientation === 6) {
            detectCtx.save();
            detectCtx.translate(detectWidth / 2, detectHeight / 2);
            detectCtx.rotate(Math.PI / 2);
            detectCtx.drawImage(img, -detectHeight / 2, -detectWidth / 2, detectHeight, detectWidth);
            detectCtx.restore();
          } else if (exifOrientation === 8) {
            detectCtx.save();
            detectCtx.translate(detectWidth / 2, detectHeight / 2);
            detectCtx.rotate(-Math.PI / 2);
            detectCtx.drawImage(img, -detectHeight / 2, -detectWidth / 2, detectHeight, detectWidth);
            detectCtx.restore();
          } else if (exifOrientation === 3) {
            detectCtx.save();
            detectCtx.translate(detectWidth / 2, detectHeight / 2);
            detectCtx.rotate(Math.PI);
            detectCtx.drawImage(img, -detectWidth / 2, -detectHeight / 2, detectWidth, detectHeight);
            detectCtx.restore();
          } else {
            detectCtx.drawImage(img, 0, 0, detectWidth, detectHeight);
          }
          
          // 2. Criar canvas da miniatura para exibição visual na UI (450px)
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          const maxThumbSize = 450;
          
          let thumbWidth, thumbHeight;
          if (renderWidth > renderHeight) {
            thumbWidth = maxThumbSize;
            thumbHeight = (renderHeight / renderWidth) * maxThumbSize;
          } else {
            thumbHeight = maxThumbSize;
            thumbWidth = (renderWidth / renderHeight) * maxThumbSize;
          }
          
          canvas.width = thumbWidth;
          canvas.height = thumbHeight;
          
          if (exifOrientation === 6) {
            ctx.save();
            ctx.translate(thumbWidth / 2, thumbHeight / 2);
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(img, -thumbHeight / 2, -thumbWidth / 2, thumbHeight, thumbWidth);
            ctx.restore();
          } else if (exifOrientation === 8) {
            ctx.save();
            ctx.translate(thumbWidth / 2, thumbHeight / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.drawImage(img, -thumbHeight / 2, -thumbWidth / 2, thumbHeight, thumbWidth);
            ctx.restore();
          } else if (exifOrientation === 3) {
            ctx.save();
            ctx.translate(thumbWidth / 2, thumbHeight / 2);
            ctx.rotate(Math.PI);
            ctx.drawImage(img, -thumbWidth / 2, -thumbHeight / 2, thumbWidth, thumbHeight);
            ctx.restore();
          } else {
            ctx.drawImage(img, 0, 0, thumbWidth, thumbHeight);
          }
          
          let poses = [];
          let facesInThumb = [];
          
          // Escalas do Canvas de Detecção (Alta Resolução)
          const scaleX = renderWidth / detectWidth;
          const scaleY = renderHeight / detectHeight;
          
          // Escalas do Canvas de Miniatura (Exibição UI)
          const thumbScaleX = renderWidth / thumbWidth;
          const thumbScaleY = renderHeight / thumbHeight;
          
          if (poseLandmarker) {
            try {
              console.log(`[MP Debug] Iniciando detecção para "${file.name}" (Alta Resolução: ${detectWidth}x${detectHeight})`);
              // Executar detecção da pose no canvas de alta resolução
              const poseResult = poseLandmarker.detect(detectCanvas);
              
              console.log(`[MP Debug] Resultado do PoseLandmarker:`, poseResult);
              if (poseResult && poseResult.landmarks) {
                console.log(`[MP Debug] Quantidade de poses detectadas: ${poseResult.landmarks.length}`);
                if (poseResult.landmarks.length > 0 && poseResult.landmarks[0].length > 0) {
                  console.log(`[MP Debug] Estrutura do Landmark[0][0]:`, JSON.stringify(poseResult.landmarks[0][0]));
                }
              }
              
              if (poseResult && poseResult.landmarks && poseResult.landmarks.length > 0) {
                poseResult.landmarks.forEach((lm, idx) => {
                  const analysis = analyzePoseLandmarks(lm, renderWidth, renderHeight);
                  if (analysis) {
                    poses.push(analysis);
                    console.log(`[MP Debug] Pose válida #${idx} detectada com confiança: ${analysis.confidence.toFixed(3)}`);
                    
                    // Alimentar facesInThumb para compatibilidade com análise de qualidade (focado na cabeça)
                    const yThumb = analysis.headY / thumbScaleY;
                    const xThumb = analysis.headX / thumbScaleX;
                    const sThumb = analysis.headSize / thumbScaleX;
                    facesInThumb.push([yThumb, xThumb, sThumb, analysis.confidence]);
                  } else {
                    console.warn(`[MP Debug] Pose #${idx} descartada por analyzePoseLandmarks (pontos visíveis insuficientes)`);
                  }
                });
              }
              
              // Fallback: se o Pose Detector não encontrar corpos, rodar o Face Detector (somente se habilitado)
              if (poses.length === 0 && faceDetector && CONFIG.faceDetectionEnabled) {
                console.log(`[MP Debug] Nenhuma pose corporal encontrada. Rodando FaceDetector como fallback...`);
                const faceResult = faceDetector.detect(detectCanvas);
                console.log(`[MP Debug] Resultado do FaceDetector:`, faceResult);
                
                if (faceResult && faceResult.detections) {
                  console.log(`[MP Debug] Quantidade de rostos detectados: ${faceResult.detections.length}`);
                  faceResult.detections.forEach((detection, idx) => {
                    const faceX = detection.boundingBox.originX * scaleX;
                    const faceY = detection.boundingBox.originY * scaleY;
                    const faceW = detection.boundingBox.width * scaleX;
                    const faceH = detection.boundingBox.height * scaleY;
                    
                    const headX = faceX + faceW / 2;
                    const headY = faceY + faceH * 0.45;
                    const headSize = Math.max(faceW, faceH) * 1.25;
                    const score = detection.categories[0] ? detection.categories[0].score : 0.8;
                    
                    console.log(`[MP Debug] Rosto #${idx} encontrado no canvas: x=${detection.boundingBox.originX.toFixed(0)}, y=${detection.boundingBox.originY.toFixed(0)}, w=${detection.boundingBox.width.toFixed(0)}, h=${detection.boundingBox.height.toFixed(0)}, score=${score.toFixed(3)}`);
                    
                    const simPose = {
                      x: Math.max(0, faceX - faceW * 0.1),
                      y: Math.max(0, faceY - faceH * 0.1),
                      width: faceW * 1.2,
                      height: faceH * 1.6,
                      
                      hasHead: true,
                      headX: headX,
                      headY: headY,
                      headSize: headSize,

                      hasEyes: true,
                      eyeCenterX: headX,
                      eyeCenterY: headY - headSize * 0.08,
                      gazeDirection: 0.0,
                      
                      hasShoulders: false,
                      shoulderX: headX,
                      shoulderY: headY + headSize * 0.8,
                      
                      hasTorso: false,
                      hipX: headX,
                      hipY: headY + headSize * 2.0,

                      hasFeet: false,
                      lowestFootY: null,
                      
                      confidence: score,
                      landmarks: null
                    };
                    
                    // Ignorar rostos extremamente pequenos (menores que 2% da dimensão menor da foto)
                    const minDim = Math.min(renderWidth, renderHeight);
                    if (headSize >= minDim * 0.02) {
                      poses.push(simPose);
                      
                      const yThumb = headY / thumbScaleY;
                      const xThumb = headX / thumbScaleX;
                      const sThumb = headSize / thumbScaleX;
                      facesInThumb.push([yThumb, xThumb, sThumb, simPose.confidence]);
                      console.log(`[MP Debug] Rosto #${idx} aceito como simPose!`);
                    } else {
                      console.warn(`[MP Debug] Rosto #${idx} descartada por ser pequeno demais (${headSize.toFixed(0)}px < ${(minDim * 0.02).toFixed(0)}px)`);
                    }
                  });
                }
              } else if (poses.length > 0) {
                console.log(`[MP Debug] Evitando FaceDetector pois ${poses.length} pose(s) já foram encontradas.`);
              }
            } catch (err) {
              console.error("[MP Debug] Erro durante o processo de detecção:", err);
            }
          }
          
          // Escalar poses para o canvas de detecção de alta resolução (1024px) para análise ultra-precisa de nitidez e exposição
          const detectScaleX = detectWidth / renderWidth;
          const detectScaleY = detectHeight / renderHeight;
          const detectPoses = poses.map(p => ({
            ...p,
            headX: p.headX * detectScaleX,
            headY: p.headY * detectScaleY,
            headSize: (p.headSize || 50) * detectScaleX,
            eyeCenterX: (p.eyeCenterX || p.headX) * detectScaleX,
            eyeCenterY: (p.eyeCenterY || p.headY) * detectScaleY,
            x: p.x * detectScaleX,
            y: p.y * detectScaleY,
            width: p.width * detectScaleX,
            height: p.height * detectScaleY
          }));

          // Executar a análise de qualidade óptica (Tenengrad Sobel e Histograma de Exposição Zonal) no canvas de 1024px
          const detectGrayPixels = getGrayscalePixels(detectCtx, detectWidth, detectHeight);
          const quality = analyzeQuality(detectCtx, detectWidth, detectHeight, facesInThumb, detectGrayPixels, detectPoses);

          // CÁLCULO DE EXPOSIÇÃO, CONTRASTE E COR AUTOMÁTICA INTELIGENTE (Auto-Grading Profissional)
          let initialBrightness = 2; // Padrão
          let initialContrast = 5;
          let initialSaturation = 6;

          const subLum = quality.brightness || 120;

          if (subLum < 118) {
            // Foto subexposta ou sujeito na sombra: elevação com curva compensatória proporcional à falta de luz
            const lumDeficit = 120 - subLum;
            // Multiplicador calculado: ex. def=60 -> bVal=+26 (1.52x); def=90 -> bVal=+40 (1.80x)
            initialBrightness = Math.min(50, Math.max(4, Math.round(lumDeficit * 0.44)));
            // Contraste dinâmico: evita que sombras clareadas fiquem esbranquiçadas ou leitosas
            initialContrast = Math.min(18, Math.round(5 + initialBrightness * 0.28));
          } else if (subLum > 142) {
            // Foto superexposta ou sol forte direto: atenuação suave de altas luzes
            const lumExcess = subLum - 138;
            initialBrightness = Math.max(-20, -Math.round(lumExcess * 0.32));
            initialContrast = 4;
          }

          // Compensação de contra-luz (sujeito escuro com céu/fundo muito claro)
          if (quality.isBacklit) {
            initialBrightness = Math.min(52, initialBrightness + 8);
            initialContrast = Math.min(20, initialContrast + 3);
          }

          // Saturação equilibrada e consciente do tom de pele natural
          if (quality.colorCast === "warm") {
            initialSaturation = 4; // Suave em ambientes quentes/amarelados
          } else if (quality.colorCast === "cool") {
            initialSaturation = 6; // Toque saudável em dias nublados ou sombra fria
          } else {
            initialSaturation = 6;
          }

          // Calcular o Crop Inteligente Inicial com as poses detectadas
          const smartCrop = computeSmartCrop(renderWidth, renderHeight, targetRatio, poses, orientation);
          
          const imgData = {
            id: id,
            file: file,
            name: file.name,
            orientation: orientation,
            origWidth: renderWidth,
            origHeight: renderHeight,
            exifOrientation: exifOrientation,
            targetRatio: targetRatio,
            poses: poses,
            faces: facesInThumb.map(f => [f[0]*thumbScaleY, f[1]*thumbScaleX, f[2]*thumbScaleX, f[3]]), // Mantido para retrocompatibilidade
            faceDetected: poses.length > 0,
            confidence: quality.rejected ? "rejected" : smartCrop.confidence,
            rejectionReason: quality.rejected ? quality.reason : "",
            colorGradingEnabled: true,
            colorBrightness: initialBrightness,
            colorContrast: initialContrast,
            colorSaturation: initialSaturation,
            qualityData: quality,
            autoZoom:   smartCrop.zoom,     // store auto-computed values separately
            autoRotate: smartCrop.rotate,
            status: quality.rejected ? "rejected" : "pending",
            crop: {
              x:      smartCrop.x,
              y:      smartCrop.y,
              width:  smartCrop.width,
              height: smartCrop.height,
              zoom:   smartCrop.zoom,
              rotate: smartCrop.rotate
            },
            thumbnailUrl: ""
          };
          imgData._sourceImg = img;
          imgData.thumbnailUrl = generateCroppedThumbnail(imgData, img);
          
          imagesData.push(imgData);
          
          if (url.startsWith("blob:")) {
            URL.revokeObjectURL(url);
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      
      img.onerror = function() {
        reject(new Error("Falha ao renderizar imagem no navegador (formato inválido, sem thumbnail ou corrompido)."));
      };
      
      img.src = url;
    });
    
  } catch (error) {
    console.error(`Erro ao processar imagem "${file.name}":`, error);
    
    if (url && url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
    
    // Prazos e fallbacks em caso de erro na extração RAW, HEIC ou carregamento de imagem no navegador
    const imgData = {
      id: id,
      file: file,
      name: file.name,
      orientation: "vertical", // default
      origWidth: 0,
      origHeight: 0,
      exifOrientation: 1,
      targetRatio: 4/5,
      poses: [],
      faces: [],
      faceDetected: false,
      confidence: "rejected",
      rejectionReason: error.message || "Erro inesperado ao decodificar imagem.",
      colorGradingEnabled: false,
      colorBrightness: 0,
      colorContrast: 0,
      colorSaturation: 0,
      qualityData: { brightness: 120, blur: 0, rejected: true, reason: error.message || "Erro inesperado" },
      autoZoom: 1.0,
      autoRotate: 0.0,
      status: "rejected",
      crop: { x: 0, y: 0, width: 1, height: 1, zoom: 1, rotate: 0 },
      thumbnailUrl: ERROR_THUMBNAIL_SVG
    };
    imagesData.push(imgData);
  }
}

// Alternar orientação de uma imagem (Vertical 4:5 <-> Horizontal 5:4)
function toggleImageOrientation(id) {
  const data = imagesData.find(d => d.id === id);
  if (!data) return;

  data.orientation = data.orientation === "vertical" ? "horizontal" : "vertical";
  const targetRatio = data.orientation === "vertical" ? 4/5 : 5/4;
  data.targetRatio = targetRatio;

  const oldCenterX = data.crop.x + data.crop.width / 2;
  const oldCenterY = data.crop.y + data.crop.height / 2;

  let newWidth, newHeight;
  if (data.origWidth / data.origHeight > targetRatio) {
    newHeight = data.origHeight;
    newWidth = data.origHeight * targetRatio;
  } else {
    newWidth = data.origWidth;
    newHeight = data.origWidth / targetRatio;
  }

  const zoom = data.crop.zoom || 1.0;
  data.crop.width = Math.round(newWidth / zoom);
  data.crop.height = Math.round(newHeight / zoom);

  data.crop.x = Math.round(oldCenterX - data.crop.width / 2);
  data.crop.y = Math.round(oldCenterY - data.crop.height / 2);

  if (data.crop.x < 0) data.crop.x = 0;
  if (data.crop.y < 0) data.crop.y = 0;
  if (data.crop.x + data.crop.width > data.origWidth) data.crop.x = data.origWidth - data.crop.width;
  if (data.crop.y + data.crop.height > data.origHeight) data.crop.y = data.origHeight - data.crop.height;

  if (data._sourceImg) {
    data.thumbnailUrl = generateCroppedThumbnail(data, data._sourceImg);
  }

  updateStats();
  renderGrid();

  if (currentEditorIndex !== -1 && imagesData[currentEditorIndex].id === id) {
    editorOrientationBadge.innerText = data.orientation === "vertical" ? "Retrato 4:5" : "Paisagem 5:4";
    editorOrientationBadge.className = data.orientation === "vertical" ? "badge-v" : "badge-h";
    resizeEditorCanvas();
    drawEditorFrame();
  }
}

// Render the grid based on activeTab
function renderGrid() {
  thumbnailsGrid.innerHTML = "";
  
  let filtered = imagesData;
  if (activeTab === "pending") {
    filtered = imagesData.filter(d => d.confidence !== "rejected" && d.status !== "processed");
  } else if (activeTab === "review") {
    filtered = imagesData.filter(d => d.confidence === "low" && d.status !== "processed");
  } else if (activeTab === "done") {
    filtered = imagesData.filter(d => d.status === "processed");
  } else if (activeTab === "rejected") {
    filtered = imagesData.filter(d => d.confidence === "rejected" && d.status !== "processed");
  }
  
  if (filtered.length === 0) {
    thumbnailsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px; font-size: 14px;">Nenhuma foto nesta categoria.</div>`;
    return;
  }
  
  filtered.forEach(data => {
    const card = document.createElement("div");
    let borderClass = "";
    if (data.confidence === "low") borderClass = "low-confidence";
    if (data.confidence === "rejected") borderClass = "rejected";

    let orientClass = "vertical";
    if (data.targetRatio && Math.abs(data.targetRatio - 9/16) < 0.01) {
      orientClass = "story";
    } else if (data.targetRatio && Math.abs(data.targetRatio - 16/9) < 0.01) {
      orientClass = "wide";
    } else if (data.orientation === "horizontal") {
      orientClass = "horizontal";
    } else {
      orientClass = "vertical";
    }

    card.className = `thumb-card ${orientClass} ${borderClass}`;
    card.id = `card-${data.id}`;
    
    card.innerHTML = `
      <img src="${data.thumbnailUrl}" class="thumb-img" alt="${data.name}">
      <button class="thumb-quick-rotate" title="Girar enquadramento (Vertical / Horizontal)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
      </button>
      <span class="card-badge ${data.orientation === 'vertical' ? 'badge-v' : 'badge-h'}">
        ${(data.targetRatio && Math.abs(data.targetRatio - 9/16) < 0.01) ? 'Stories 9:16' : 
          (data.targetRatio && Math.abs(data.targetRatio - 16/9) < 0.01) ? 'Wide 16:9' : 
          (data.orientation === 'vertical' ? 'Vertical 4:5' : 'Horizontal 5:4')}
      </span>
      ${data.confidence === 'low' && data.status !== 'processed' ? '<span class="badge-review">Revisar</span>' : ''}
      ${data.confidence === 'rejected' && data.status !== 'processed' ? '<span class="badge-rejected">Reprovada</span>' : ''}
      ${data.status === 'processed' ? `
        <span class="badge-processed" title="Foto aprovada e conferida">
          <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
        </span>
      ` : ''}
    `;

    const rotateBtn = card.querySelector(".thumb-quick-rotate");
    if (rotateBtn) {
      rotateBtn.onclick = (e) => {
        e.stopPropagation();
        toggleImageOrientation(data.id);
      };
    }
    
    card.onclick = () => {
      const idx = imagesData.findIndex(d => d.id === data.id);
      openEditor(idx);
    };
    
    thumbnailsGrid.appendChild(card);
  });
}

// Atualizar todas as miniaturas do grid (ex: quando marcas d'água são aplicadas ou removidas)
function refreshAllThumbnails() {
  if (!imagesData || imagesData.length === 0) return;
  imagesData.forEach(d => {
    if (d._sourceImg) {
      d.thumbnailUrl = generateCroppedThumbnail(d, d._sourceImg);
    }
  });
  renderGrid();
}

// Update counters and statistics
function updateStats() {
  const total = imagesData.length;
  const processed = imagesData.filter(d => d.status === "processed").length;
  const horiz = imagesData.filter(d => d.orientation === "horizontal").length;
  const vert = imagesData.filter(d => d.orientation === "vertical").length;
  const review = imagesData.filter(d => d.confidence === "low" && d.status !== "processed").length;
  const rejected = imagesData.filter(d => d.confidence === "rejected" && d.status !== "processed").length;
  
  if (statTotal) statTotal.innerText = total;
  if (statProcessed) statProcessed.innerText = processed;
  if (statHoriz) statHoriz.innerText = horiz;
  if (statVert) statVert.innerText = vert;
  if (statReview) statReview.innerText = review;
  if (statRejected) statRejected.innerText = rejected;
  
  if (badgeAll) badgeAll.innerText = total;
  if (badgeReviewTab) badgeReviewTab.innerText = review;
  if (badgeDone) badgeDone.innerText = processed;
  if (badgeRejectedTab) badgeRejectedTab.innerText = rejected;
  if (badgePending) {
    const pending = imagesData.filter(d => d.confidence !== "rejected" && d.status !== "processed").length;
    badgePending.innerText = pending;
  }
  
  if (statCardReview) {
    if (review > 0) {
      statCardReview.classList.add("glow");
    } else {
      statCardReview.classList.remove("glow");
    }
  }
  
  if (statCardRejected) {
    if (rejected > 0) {
      statCardRejected.classList.add("glow");
    } else {
      statCardRejected.classList.remove("glow");
    }
  }
}

// Enable/Disable main button based on watermarks loaded
function checkReadyToExport() {
  const ready = imagesData.length > 0 && (watermarkVertical || watermarkHorizontal || watermarkReels || watermarkWide);
  btnStartProcess.disabled = !ready;
  if (ready) {
    btnStartProcess.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      Processar ${imagesData.length} Fotos
    `;
  } else {
    btnStartProcess.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      Processar Fotos
    `;
  }
}

// Obter a melhor marca d'água disponível para a proporção da foto
function getWatermarkForImage(data) {
  if (data.orientation === "vertical") {
    if (data.targetRatio && Math.abs(data.targetRatio - 9/16) < 0.01 && watermarkReels) {
      return watermarkReels;
    }
    if (watermarkVertical) return watermarkVertical;
    if (watermarkReels) return watermarkReels;
  } else {
    if (data.targetRatio && Math.abs(data.targetRatio - 16/9) < 0.01 && watermarkWide) {
      return watermarkWide;
    }
    if (watermarkHorizontal) return watermarkHorizontal;
    if (watermarkWide) return watermarkWide;
  }
  // Fallback: usar qualquer marca d'água carregada
  return watermarkVertical || watermarkHorizontal || watermarkReels || watermarkWide || null;
}

// Load watermarks PNG
function handleWatermarkUpload(file, type) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      if (type === "vertical") {
        if (img.width === 3648 && img.height === 4560) {
          watermarkVertical = img;
          wmBadgeVertical.classList.add("active");
          const lbl = `✔ ${file.name}`;
          if (wmLabelVertical) wmLabelVertical.innerText = lbl;
          persistWatermarkImage("vertical", e.target.result, lbl);
          console.log("✔ Marca d'água Post vertical (4:5) carregada com sucesso.");
        } else {
          alert(`Erro: A marca d'água Post vertical (4:5) deve ter a dimensão EXATA de 3648 x 4560 px. (Carregada: ${img.width}x${img.height})`);
          watermarkVertical = null;
          wmBadgeVertical.classList.remove("active");
          if (wmLabelVertical) wmLabelVertical.innerText = "Não carregada";
          deletePersistedWatermark("vertical");
        }
      } else if (type === "reels") {
        if (img.width === 2565 && img.height === 4560) {
          watermarkReels = img;
          if (wmBadgeReels) wmBadgeReels.classList.add("active");
          const lbl = `✔ ${file.name}`;
          if (wmLabelReels) wmLabelReels.innerText = lbl;
          persistWatermarkImage("reels", e.target.result, lbl);
          console.log("✔ Marca d'água Story (9:16) carregada com sucesso.");
        } else {
          alert(`Erro: A marca d'água Story (9:16) deve ter a dimensão EXATA de 2565 x 4560 px. (Carregada: ${img.width}x${img.height})`);
          watermarkReels = null;
          if (wmBadgeReels) wmBadgeReels.classList.remove("active");
          if (wmLabelReels) wmLabelReels.innerText = "Não carregada";
          deletePersistedWatermark("reels");
        }
      } else if (type === "wide") {
        if (img.width === 4560 && img.height === 2565) {
          watermarkWide = img;
          if (wmBadgeWide) wmBadgeWide.classList.add("active");
          const lbl = `✔ ${file.name}`;
          if (wmLabelWide) wmLabelWide.innerText = lbl;
          persistWatermarkImage("wide", e.target.result, lbl);
          console.log("✔ Marca d'água Widescreen (16:9) carregada com sucesso.");
        } else {
          alert(`Erro: A marca d'água Widescreen (16:9) deve ter a dimensão EXATA de 4560 x 2565 px. (Carregada: ${img.width}x${img.height})`);
          watermarkWide = null;
          if (wmBadgeWide) wmBadgeWide.classList.remove("active");
          if (wmLabelWide) wmLabelWide.innerText = "Não carregada";
          deletePersistedWatermark("wide");
        }
      } else {
        if (img.width === 4560 && img.height === 3648) {
          watermarkHorizontal = img;
          wmBadgeHorizontal.classList.add("active");
          const lbl = `✔ ${file.name}`;
          if (wmLabelHorizontal) wmLabelHorizontal.innerText = lbl;
          persistWatermarkImage("horizontal", e.target.result, lbl);
          console.log("✔ Marca d'água Post horizontal (5:4) carregada com sucesso.");
        } else {
          alert(`Erro: A marca d'água Post horizontal (5:4) deve ter a dimensão EXATA de 4560 x 3648 px. (Carregada: ${img.width}x${img.height})`);
          watermarkHorizontal = null;
          wmBadgeHorizontal.classList.remove("active");
          if (wmLabelHorizontal) wmLabelHorizontal.innerText = "Não carregada";
          deletePersistedWatermark("horizontal");
        }
      }
      checkReadyToExport();
      updateWatermarkThumbnails();
      refreshAllThumbnails();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// -------------------------------------------------------------
// Interactive Crop Editor Modal Logic
// -------------------------------------------------------------
let editorImage = new Image();
let isDragging = false;
let startDragX = 0, startDragY = 0;
let cropStartOffset = { x: 0, y: 0 };

// Retorna a lista filtrada de imagens conforme a aba ativa
function getFilteredImages() {
  if (activeTab === "pending") {
    return imagesData.filter(d => d.confidence !== "rejected" && d.status !== "processed");
  } else if (activeTab === "review") {
    return imagesData.filter(d => d.confidence === "low" && d.status !== "processed");
  } else if (activeTab === "done") {
    return imagesData.filter(d => d.status === "processed");
  } else if (activeTab === "rejected") {
    return imagesData.filter(d => d.confidence === "rejected" && d.status !== "processed");
  }
  return imagesData;
}

function openEditor(index) {
  if (index < 0 || index >= imagesData.length) return;
  currentEditorIndex = index;
  const data = imagesData[index];

  editorFilename.innerText = data.name;
  let badgeText = "";
  if (data.orientation === "vertical") {
    badgeText = Math.abs((data.targetRatio || 4/5) - 9/16) < 0.01 ? "Stories 9:16" : "Retrato 4:5";
  } else {
    badgeText = Math.abs((data.targetRatio || 5/4) - 16/9) < 0.01 ? "Wide 16:9" : "Paisagem 5:4";
  }
  editorOrientationBadge.innerText = badgeText;
  editorOrientationBadge.className  = data.orientation === "vertical" ? "badge-v"     : "badge-h";

  // Contador de fotos relativo a aba ativa
  const counterEl = document.getElementById("editor-counter");
  if (counterEl) {
    const filteredList = getFilteredImages();
    const filteredIndex = filteredList.findIndex(d => d.id === data.id);
    if (filteredIndex !== -1) {
      counterEl.innerText = `${filteredIndex + 1} de ${filteredList.length}`;
    } else {
      counterEl.innerText = `${index + 1} de ${imagesData.length}`;
    }
  }

  // Badge de aprovada
  const approvedBadge = document.getElementById("editor-approved-badge");
  if (approvedBadge) approvedBadge.style.display = (data.status === "processed") ? "inline-block" : "none";

  // Sync sliders with saved state
  const zoom   = data.crop.zoom   || 1.0;
  const rotate = data.crop.rotate || 0.0;
  editorZoomSlider.value   = zoom;
  editorZoomVal.innerText  = `${zoom.toFixed(2)}x`;
  editorRotateSlider.value = rotate;
  editorRotateVal.innerText = `${rotate.toFixed(1)}°`;

  // Sync color grading checkbox
  if (editorColorGrading) {
    editorColorGrading.checked = data.colorGradingEnabled !== false;
  }

  // Sync manual color grading sliders
  const cBrightness = data.colorBrightness || 0;
  const cContrast   = data.colorContrast   || 0;
  const cSaturation = data.colorSaturation || 0;

  if (editorBrightness) {
    editorBrightness.value = cBrightness;
    editorBrightnessVal.innerText = cBrightness > 0 ? `+${cBrightness}` : cBrightness;
  }
  if (editorContrast) {
    editorContrast.value = cContrast;
    editorContrastVal.innerText = cContrast > 0 ? `+${cContrast}` : cContrast;
  }
  if (editorSaturation) {
    editorSaturation.value = cSaturation;
    editorSaturationVal.innerText = cSaturation > 0 ? `+${cSaturation}` : cSaturation;
  }

  // --- Auto-rejection banner (Sempre visível com altura fixa para não deslocar os botões abaixo) ---
  if (autoRejectionRow && autoRejectionDisplay) {
    autoRejectionRow.style.display = "flex";
    const qualityLabel = document.getElementById("auto-quality-label");
    if (data.confidence === "rejected" || data.status === "rejected") {
      autoRejectionRow.style.borderTop = "1px dashed rgba(255,77,77,0.35)";
      if (qualityLabel) qualityLabel.style.color = "#ff4d4d";
      autoRejectionDisplay.style.color = "#ff4d4d";
      autoRejectionDisplay.innerText = data.rejectionReason || "Qualidade Baixa";
    } else {
      autoRejectionRow.style.borderTop = "1px solid rgba(255,255,255,0.08)";
      if (qualityLabel) qualityLabel.style.color = "var(--text-secondary)";
      autoRejectionDisplay.style.color = "#4ade80";
      autoRejectionDisplay.innerText = "✓ Aprovada (Nítida)";
    }
  }

  // --- Auto-analysis panel ---
  const autoZ = data.autoZoom   != null ? data.autoZoom   : zoom;
  const autoR = data.autoRotate != null ? data.autoRotate : rotate;

  // Zoom display
  if (autoZ > 1.005) {
    const isApplied = Math.abs(zoom - autoZ) < 0.01;
    autoZoomDisplay.innerText = `${autoZ.toFixed(2)}x ${isApplied ? "(Aplicado)" : "(Customizado)"}`;
    autoZoomDisplay.style.color = isApplied ? "var(--accent-color)" : "var(--text-secondary)";
  } else {
    autoZoomDisplay.innerText = "Nenhum (1.00x)";
    autoZoomDisplay.style.color = "var(--text-muted)";
  }

  // Rotation display
  if (Math.abs(autoR) > 0.3) {
    const isApplied = Math.abs(rotate - autoR) < 0.3;
    autoRotateDisplay.innerText = `${autoR.toFixed(1)}° ${isApplied ? "(Aplicada)" : "(Customizada)"}`;
    autoRotateDisplay.style.color = isApplied ? "var(--accent-color)" : "var(--text-secondary)";
  } else {
    autoRotateDisplay.innerText = "Nenhuma (0.0°)";
    autoRotateDisplay.style.color = "var(--text-muted)";
  }

  // Pose count - usar detecção de poses
  const nPoses = (data.poses || []).filter(p => p.confidence >= 0.45).length;
  autoFacesDisplay.innerText = nPoses > 0 ? `${nPoses} pessoa(s) detectada(s)` : "Não detectado";
  autoFacesDisplay.style.color = nPoses > 0 ? "var(--success-color)" : "var(--text-muted)";

  // Show tag on label if auto value is active (untouched by user)
  zoomAutoTag.innerText   = (Math.abs(zoom - autoZ) < 0.01 && autoZ > 1.005) ? "⚡ auto" : "";
  rotateAutoTag.innerText = (Math.abs(rotate - autoR) < 0.3 && Math.abs(autoR) > 0.3) ? "⚡ auto" : "";

  // Resetar o toggle de rostos para desabilitado ao abrir o editor
  if (typeof resetEditorFacesToggle === "function") resetEditorFacesToggle();
  if (typeof updateToggleWmBtnUI === "function") updateToggleWmBtnUI();

  editorModal.style.display = "flex";


  getImageSrc(data.file).then(url => {
    editorImage = new Image();
    editorImage.onload = function() {
      data._sourceImg = editorImage;
      resizeEditorCanvas();
      drawEditorFrame();
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    };
    editorImage.onerror = function() {
      console.error(`Erro ao carregar imagem no editor para o arquivo: ${data.name}`);
      const ctx = editorCanvas.getContext("2d");
      ctx.fillStyle = "#1e1e2e";
      ctx.fillRect(0, 0, editorCanvas.width, editorCanvas.height);
      ctx.fillStyle = "#ff6600";
      ctx.font = "bold 16px Outfit, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Erro ao carregar a imagem.", editorCanvas.width / 2, editorCanvas.height / 2 - 10);
      ctx.fillStyle = "#a6adc8";
      ctx.font = "12px Outfit, sans-serif";
      ctx.fillText(data.rejectionReason || "Arquivo incompatível ou corrompido.", editorCanvas.width / 2, editorCanvas.height / 2 + 15);
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    };
    editorImage.src = url;
  }).catch(err => {
    console.error(`Erro na obtenção da imagem para o editor:`, err);
    const ctx = editorCanvas.getContext("2d");
    ctx.fillStyle = "#1e1e2e";
    ctx.fillRect(0, 0, editorCanvas.width, editorCanvas.height);
    ctx.fillStyle = "#ff6600";
    ctx.font = "bold 16px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Erro de Leitura / Conversão.", editorCanvas.width / 2, editorCanvas.height / 2 - 10);
    ctx.fillStyle = "#a6adc8";
    ctx.font = "12px Outfit, sans-serif";
    ctx.fillText(err.message || "Falha ao obter dados da imagem.", editorCanvas.width / 2, editorCanvas.height / 2 + 15);
  });
}

// Refactored to completely avoid ClientHeight Container Shrinking loops
function resizeEditorCanvas() {
  const data = imagesData[currentEditorIndex];
  
  // 1. Definir tamanho físico constante e de ALTA resolução para o canvas de edição
  // Evita loops geométricos do navegador. O CSS cuidará do encaixe proporcional fluido.
  const ratio = data.targetRatio || (data.orientation === "vertical" ? 4/5 : 5/4);
  if (data.orientation === "vertical") {
    if (Math.abs(ratio - 9/16) < 0.01) {
      editorCanvas.width = 900;
      editorCanvas.height = 1600;
    } else {
      editorCanvas.width = 1200;
      editorCanvas.height = 1500;
    }
  } else {
    if (Math.abs(ratio - 16/9) < 0.01) {
      editorCanvas.width = 1600;
      editorCanvas.height = 900;
    } else {
      editorCanvas.width = 1500;
      editorCanvas.height = 1200;
    }
  }
  
  // Ocultar dimmers visuais pois o próprio canvas representa os limites exatos do crop
  dimmerTop.style.display = "none";
  dimmerBottom.style.display = "none";
  dimmerLeft.style.display = "none";
  dimmerRight.style.display = "none";
  
  // 2. Ajustar a grade da regra dos terços de forma fluida de acordo com o tamanho real visível do Canvas (CSS)
  requestAnimationFrame(() => {
    const rect = editorCanvas.getBoundingClientRect();
    editorThirds.style.width = `${rect.width}px`;
    editorThirds.style.height = `${rect.height}px`;
  });
}

function buildImageFilter(data) {
  if (!data) return "none";

  // Mapear sliders de ajuste para multiplicadores CSS
  // Para brilho: valores positivos permitem clarear significativamente fotos escuras (até 3.0x no +100)
  const bVal = data.colorBrightness || 0;
  const manualBrightness = bVal >= 0
    ? 1.0 + (bVal / 50)
    : Math.max(0.1, 1.0 + (bVal / 100)); // -50 dá 0.5x
  const manualContrast   = 1.0 + (data.colorContrast || 0) / 50;     // -100% a +100%
  const manualSaturation = 1.0 + (data.colorSaturation || 0) / 50;   // -100% a +100%

  let finalContrast, finalSaturation, finalBrightness;

  if (data.colorGradingEnabled !== false) {
    finalContrast   = manualContrast;
    finalSaturation = manualSaturation;
    finalBrightness = manualBrightness;
  } else {
    // Se o Color Grading estiver desativado para esta foto, usa cores 100% originais
    finalContrast   = 1.0;
    finalSaturation = 1.0;
    finalBrightness = 1.0;
  }

  // Garantir limites seguros para os filtros CSS
  finalContrast   = Math.max(0.1, finalContrast);
  finalSaturation = Math.max(0.0, finalSaturation);
  finalBrightness = Math.max(0.1, finalBrightness);

  return `contrast(${finalContrast.toFixed(2)}) saturate(${finalSaturation.toFixed(2)}) brightness(${finalBrightness.toFixed(2)})`;
}

function drawEditorFrame() {
  if (!editorImage.src || currentEditorIndex === -1) return;
  
  const ctx = editorCanvas.getContext("2d");
  const data = imagesData[currentEditorIndex];
  const zoom = parseFloat(editorZoomSlider.value);
  const rotationRad = (parseFloat(editorRotateSlider.value) * Math.PI) / 180;
  
  ctx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
  ctx.save();
  
  // 1. Centralizar contexto no canvas
  ctx.translate(editorCanvas.width / 2, editorCanvas.height / 2);
  
  // 2. Aplicar rotação manual do usuário
  ctx.rotate(rotationRad);
  
  // 3. Calcular escala base (A foto original já vem auto-orientada pelo navegador!)
  const canvasRatio = editorCanvas.width / editorCanvas.height;
  const imageRatio = data.origWidth / data.origHeight;
  
  let drawWidth, drawHeight;
  let baseScale;
  
  if (imageRatio > canvasRatio) {
    // Foto mais larga que enquadramento: fixar altura
    drawHeight = editorCanvas.height;
    drawWidth = drawHeight * imageRatio;
    baseScale = editorCanvas.height / data.origHeight;
  } else {
    // Foto mais alta que enquadramento: fixar largura
    drawWidth = editorCanvas.width;
    drawHeight = drawWidth / imageRatio;
    baseScale = editorCanvas.width / data.origWidth;
  }
  
  // COMPENSAÇÃO DE ROTAÇÃO: Zoom matemático preciso baseado na inclinação para eliminar 100% das bordas pretas nos cantos
  const rotationZoomCompensation = Math.abs(Math.cos(rotationRad)) + Math.abs(Math.sin(rotationRad)) * 1.30;
  const finalZoom = zoom * rotationZoomCompensation;
  
  // Aplicar zoom total
  ctx.scale(finalZoom, finalZoom);
  
  // 4. Calcular o deslocamento interativo ajustado
  const defaultCenterX = data.origWidth / 2;
  const defaultCenterY = data.origHeight / 2;
  
  const cropCenterX = data.crop.x + data.crop.width / 2;
  const cropCenterY = data.crop.y + data.crop.height / 2;
  
  const deltaX = defaultCenterX - cropCenterX;
  const deltaY = defaultCenterY - cropCenterY;
  
  ctx.filter = buildImageFilter(data);

  const imgX = -drawWidth / 2 + deltaX * baseScale;
  const imgY = -drawHeight / 2 + deltaY * baseScale;
  const imgCX = imgX + drawWidth / 2;
  const imgCY = imgY + drawHeight / 2;
  
  ctx.save();
  ctx.translate(imgCX, imgCY);
  if (data.exifOrientation === 6) {
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(editorImage, -drawHeight / 2, -drawWidth / 2, drawHeight, drawWidth);
  } else if (data.exifOrientation === 8) {
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(editorImage, -drawHeight / 2, -drawWidth / 2, drawHeight, drawWidth);
  } else if (data.exifOrientation === 3) {
    ctx.rotate(Math.PI);
    ctx.drawImage(editorImage, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  } else {
    ctx.drawImage(editorImage, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  }
  ctx.restore();
  
  ctx.restore();

  // Desenhar marca d'água fixa como overlay de referência em modo 'cover'
  const wm = getWatermarkForImage(data);
  if (wm && editorShowWatermark) {
    ctx.save();
    ctx.globalAlpha = 1.0;
    const wmRatio = wm.width / wm.height;
    const canvasRatio = editorCanvas.width / editorCanvas.height;
    let drawW, drawH, drawX, drawY;
    
    if (wmRatio > canvasRatio) {
      drawH = editorCanvas.height;
      drawW = editorCanvas.height * wmRatio;
      drawX = (editorCanvas.width - drawW) / 2;
      drawY = 0;
    } else {
      drawW = editorCanvas.width;
      drawH = editorCanvas.width / wmRatio;
      drawX = 0;
      drawY = (editorCanvas.height - drawH) / 2;
    }
    ctx.drawImage(wm, drawX, drawY, drawW, drawH);
    ctx.restore();
  }

  // --- Desenhar overlay de poses detectadas (MediaPipe Pose) ---
  if (editorShowFaces) {
    const validPoses = (data.poses || []).filter(p => p.confidence >= 0.45);
    if (validPoses.length > 0) {
    const canvasRatioOvl = editorCanvas.width / editorCanvas.height;
    const imageRatioOvl = data.origWidth / data.origHeight;
    let baseScaleOvl;
    if (imageRatioOvl > canvasRatioOvl) {
      baseScaleOvl = editorCanvas.height / data.origHeight;
    } else {
      baseScaleOvl = editorCanvas.width / data.origWidth;
    }
    const finalZoomOvl = zoom * (Math.abs(Math.cos(rotationRad)) + Math.abs(Math.sin(rotationRad)) * 1.30);

    // Centro do canvas
    const canvasCX = editorCanvas.width / 2;
    const canvasCY = editorCanvas.height / 2;

    // Deslocamento do crop (em coordenadas do canvas)
    const cropCenterX = data.crop.x + data.crop.width / 2;
    const cropCenterY = data.crop.y + data.crop.height / 2;
    const deltaX = (data.origWidth / 2 - cropCenterX) * baseScaleOvl * finalZoomOvl;
    const deltaY = (data.origHeight / 2 - cropCenterY) * baseScaleOvl * finalZoomOvl;

    // Identificar a pose principal (mais próxima do centro da imagem)
    const imgCX = data.origWidth / 2;
    const imgCY = data.origHeight / 2;
    const sortedByCenter = validPoses.slice().sort((a, b) => {
      const distA = Math.hypot((a.x + a.width/2) - imgCX, (a.y + a.height/2) - imgCY);
      const distB = Math.hypot((b.x + b.width/2) - imgCX, (b.y + b.height/2) - imgCY);
      return distA - distB;
    });
    const primaryPose = sortedByCenter[0];

    const ctx2 = editorCanvas.getContext("2d");

    // Função auxiliar para converter coordenadas da imagem para o canvas (com rotação e crop)
    function toScreenCoords(px, py) {
      const relX = (px - data.origWidth / 2) * baseScaleOvl * finalZoomOvl + deltaX;
      const relY = (py - data.origHeight / 2) * baseScaleOvl * finalZoomOvl + deltaY;

      // Aplicar rotação
      const cosR = Math.cos(rotationRad);
      const sinR = Math.sin(rotationRad);
      const rotX = relX * cosR - relY * sinR;
      const rotY = relX * sinR + relY * cosR;

      return {
        x: canvasCX + rotX,
        y: canvasCY + rotY
      };
    }

    validPoses.forEach((p) => {
      const isPrimary = p === primaryPose;
      
      ctx2.save();
      ctx2.strokeStyle = isPrimary ? "#ff6600" : "rgba(255,255,255,0.6)";
      ctx2.lineWidth = isPrimary ? 3 : 2;
      ctx2.setLineDash(isPrimary ? [] : [5, 4]);
      ctx2.shadowBlur = isPrimary ? 12 : 6;
      ctx2.shadowColor = isPrimary ? "#ff6600" : "rgba(255,255,255,0.5)";

      // 1. Desenhar a Bounding Box do Corpo (conectando os 4 cantos convertidos)
      const corners = [
        { x: p.x, y: p.y },
        { x: p.x + p.width, y: p.y },
        { x: p.x + p.width, y: p.y + p.height },
        { x: p.x, y: p.y + p.height }
      ];
      const screenCorners = corners.map(c => toScreenCoords(c.x, c.y));
      ctx2.beginPath();
      ctx2.moveTo(screenCorners[0].x, screenCorners[0].y);
      ctx2.lineTo(screenCorners[1].x, screenCorners[1].y);
      ctx2.lineTo(screenCorners[2].x, screenCorners[2].y);
      ctx2.lineTo(screenCorners[3].x, screenCorners[3].y);
      ctx2.closePath();
      ctx2.stroke();

      // 2. Desenhar a cabeça (círculo) se disponível
      if (p.hasHead) {
        const headCenter = toScreenCoords(p.headX, p.headY);
        const screenHeadR = (p.headSize / 2) * baseScaleOvl * finalZoomOvl;
        
        ctx2.save();
        ctx2.strokeStyle = isPrimary ? "#ff6600" : "rgba(255,255,255,0.6)";
        ctx2.lineWidth = isPrimary ? 2 : 1.5;
        ctx2.setLineDash([]);
        ctx2.beginPath();
        ctx2.arc(headCenter.x, headCenter.y, screenHeadR, 0, 2 * Math.PI);
        ctx2.stroke();
        ctx2.restore();
      }

      // 3. Desenhar esqueleto (conexões anatômicas)
      if (p.landmarks) {
        ctx2.save();
        ctx2.strokeStyle = isPrimary ? "rgba(255, 102, 0, 0.5)" : "rgba(255, 255, 255, 0.4)";
        ctx2.lineWidth = isPrimary ? 2 : 1.5;
        ctx2.setLineDash([3, 3]);

        function getLandmarkScreen(idx) {
          const lm = p.landmarks[idx];
          if (!lm || lm.visibility < 0.45) return null;
          return toScreenCoords(lm.x * data.origWidth, lm.y * data.origHeight);
        }

        const connections = [
          [11, 12], // ombros
          [11, 23], // tronco esquerdo
          [12, 24], // tronco direito
          [23, 24], // quadris
          
          // Braços
          [11, 13], [13, 15],
          [12, 14], [14, 16],
          
          // Pernas
          [23, 25], [25, 27],
          [24, 26], [26, 28]
        ];

        connections.forEach(([i1, i2]) => {
          const pt1 = getLandmarkScreen(i1);
          const pt2 = getLandmarkScreen(i2);
          if (pt1 && pt2) {
            ctx2.beginPath();
            ctx2.moveTo(pt1.x, pt1.y);
            ctx2.lineTo(pt2.x, pt2.y);
            ctx2.stroke();
          }
        });

        // Conectar cabeça/nariz (0) ao ponto médio dos ombros
        const nosePt = getLandmarkScreen(0);
        const lShoulderPt = getLandmarkScreen(11);
        const rShoulderPt = getLandmarkScreen(12);
        if (nosePt && lShoulderPt && rShoulderPt) {
          const shMidX = (lShoulderPt.x + rShoulderPt.x) / 2;
          const shMidY = (lShoulderPt.y + rShoulderPt.y) / 2;
          ctx2.beginPath();
          ctx2.moveTo(nosePt.x, nosePt.y);
          ctx2.lineTo(shMidX, shMidY);
          ctx2.stroke();
        }

        ctx2.restore();
      }

      // 4. Desenhar rótulo identificador (★ para primário, nº para secundários)
      const label = isPrimary ? "★ Corpo Principal" : `Pessoa ${validPoses.indexOf(p) + 1}`;
      const firstCorner = screenCorners[0]; // Canto superior esquerdo da bounding box
      
      ctx2.save();
      ctx2.setLineDash([]);
      ctx2.font = `bold 12px Outfit, sans-serif`;
      ctx2.fillStyle = isPrimary ? "#ff6600" : "rgba(255,255,255,0.9)";
      ctx2.shadowBlur = 4;
      ctx2.shadowColor = "rgba(0,0,0,0.8)";
      ctx2.fillText(label, firstCorner.x, firstCorner.y - 6);
      ctx2.restore();

      ctx2.restore();
    });
  }
  }
}

// Reposicionar enquadramento por Drag-and-Drop no Canvas
editorCanvas.onmousedown = function(e) {
  if (currentEditorIndex === -1) return;
  isDragging = true;
  startDragX = e.clientX;
  startDragY = e.clientY;
  
  cropStartOffset.x = imagesData[currentEditorIndex].crop.x;
  cropStartOffset.y = imagesData[currentEditorIndex].crop.y;
  editorCanvas.style.cursor = "grabbing";
};

window.onmousemove = function(e) {
  if (!isDragging || currentEditorIndex === -1) return;
  
  const data = imagesData[currentEditorIndex];
  const deltaX = e.clientX - startDragX;
  const deltaY = e.clientY - startDragY;
  
  const canvasRatio = editorCanvas.width / editorCanvas.height;
  const imageRatio = data.origWidth / data.origHeight;
  
  let baseScale;
  if (imageRatio > canvasRatio) {
    baseScale = editorCanvas.height / data.origHeight;
  } else {
    baseScale = editorCanvas.width / data.origWidth;
  }
  
  const zoom = parseFloat(editorZoomSlider.value);
  const rect = editorCanvas.getBoundingClientRect();
  const screenToCanvasScale = editorCanvas.width / rect.width;
  const rotationRad = (parseFloat(editorRotateSlider.value) * Math.PI) / 180;
  const rotationZoomCompensation = Math.abs(Math.cos(rotationRad)) + Math.abs(Math.sin(rotationRad)) * 1.30;
  const finalZoom = zoom * rotationZoomCompensation;
  
  let newCropX = cropStartOffset.x - (deltaX * screenToCanvasScale) / baseScale / finalZoom;
  let newCropY = cropStartOffset.y - (deltaY * screenToCanvasScale) / baseScale / finalZoom;
  
  const maxCropX = data.origWidth - data.crop.width;
  const maxCropY = data.origHeight - data.crop.height;
  
  if (newCropX < 0) newCropX = 0;
  if (newCropY < 0) newCropY = 0;
  if (newCropX > maxCropX) newCropX = maxCropX;
  if (newCropY > maxCropY) newCropY = maxCropY;
  
  data.crop.x = Math.round(newCropX);
  data.crop.y = Math.round(newCropY);
  
  drawEditorFrame();
};

window.onmouseup = function() {
  if (isDragging) {
    isDragging = false;
    editorCanvas.style.cursor = "grab";
  }
};

// Alternar entre proporções Vertical 4:5 e Horizontal 5:4 na tela de revisão
btnToggleOrientation.onclick = function() {
  if (currentEditorIndex === -1) return;
  toggleImageOrientation(imagesData[currentEditorIndex].id);
};

// Alternar visualização da marca d'água no editor manual
function updateToggleWmBtnUI() {
  if (!btnToggleWmOverlay || !toggleWmText) return;
  if (editorShowWatermark) {
    btnToggleWmOverlay.classList.remove("wm-hidden");
    toggleWmText.innerText = "Ocultar Marca d'Água (W)";
    if (toggleWmIcon) {
      toggleWmIcon.innerHTML = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
    }
  } else {
    btnToggleWmOverlay.classList.add("wm-hidden");
    toggleWmText.innerText = "Mostrar Marca d'Água (W)";
    if (toggleWmIcon) {
      toggleWmIcon.innerHTML = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;
    }
  }
}

if (btnToggleWmOverlay) {
  btnToggleWmOverlay.onclick = function() {
    editorShowWatermark = !editorShowWatermark;
    updateToggleWmBtnUI();
    drawEditorFrame();
  };
}

// Alternar aspect ratio especial (Reels/Widescreen)
const btnToggleSpecialRatio = document.getElementById("btn-toggle-special-ratio");
if (btnToggleSpecialRatio) {
  btnToggleSpecialRatio.onclick = function() {
    if (currentEditorIndex === -1) return;
    const data = imagesData[currentEditorIndex];
    
    if (data.orientation === "vertical") {
      // Alternar entre 4:5 e 9:16
      data.targetRatio = Math.abs((data.targetRatio || 4/5) - 4/5) < 0.01 ? 9/16 : 4/5;
    } else {
      // Alternar entre 5:4 e 16:9
      data.targetRatio = Math.abs((data.targetRatio || 5/4) - 5/4) < 0.01 ? 16/9 : 5/4;
    }
    
    // Atualizar texto do badge
    let badgeText = "";
    if (data.orientation === "vertical") {
      badgeText = Math.abs(data.targetRatio - 9/16) < 0.01 ? "Stories 9:16" : "Retrato 4:5";
    } else {
      badgeText = Math.abs(data.targetRatio - 16/9) < 0.01 ? "Wide 16:9" : "Paisagem 5:4";
    }
    editorOrientationBadge.innerText = badgeText;
    
    // Recalcular crop box centrado na posição atual
    const oldCenterX = data.crop.x + data.crop.width / 2;
    const oldCenterY = data.crop.y + data.crop.height / 2;
    
    let newWidth, newHeight;
    if (data.origWidth / data.origHeight > data.targetRatio) {
      newHeight = data.origHeight;
      newWidth = data.origHeight * data.targetRatio;
    } else {
      newWidth = data.origWidth;
      newHeight = data.origWidth / data.targetRatio;
    }
    
    const zoom = data.crop.zoom || 1.0;
    data.crop.width = Math.round(newWidth / zoom);
    data.crop.height = Math.round(newHeight / zoom);
    
    data.crop.x = Math.round(oldCenterX - data.crop.width / 2);
    data.crop.y = Math.round(oldCenterY - data.crop.height / 2);
    
    // Clampar limites
    if (data.crop.x < 0) data.crop.x = 0;
    if (data.crop.y < 0) data.crop.y = 0;
    if (data.crop.x + data.crop.width > data.origWidth) data.crop.x = data.origWidth - data.crop.width;
    if (data.crop.y + data.crop.height > data.origHeight) data.crop.y = data.origHeight - data.crop.height;
    
    // Redesenhar
    resizeEditorCanvas();
    drawEditorFrame();
    
    updateStats();
    renderGrid();
  };
}

// Sliders de controle manual do modal
editorZoomSlider.oninput = function() {
  const val = parseFloat(this.value);
  editorZoomVal.innerText = `${val.toFixed(2)}x`;
  if (currentEditorIndex !== -1) {
    const data = imagesData[currentEditorIndex];
    const oldWidth  = data.crop.width;
    const oldHeight = data.crop.height;

    const targetRatio = data.targetRatio || (data.orientation === "vertical" ? 4/5 : 5/4);
    let baseWidth, baseHeight;
    if (data.origWidth / data.origHeight > targetRatio) {
      baseHeight = data.origHeight;
      baseWidth  = data.origHeight * targetRatio;
    } else {
      baseWidth  = data.origWidth;
      baseHeight = data.origWidth / targetRatio;
    }

    data.crop.width  = Math.round(baseWidth  / val);
    data.crop.height = Math.round(baseHeight / val);
    data.crop.zoom   = val;

    data.crop.x += Math.round((oldWidth  - data.crop.width)  / 2);
    data.crop.y += Math.round((oldHeight - data.crop.height) / 2);

    if (data.crop.x < 0) data.crop.x = 0;
    if (data.crop.y < 0) data.crop.y = 0;
    if (data.crop.x + data.crop.width  > data.origWidth)  data.crop.x = data.origWidth  - data.crop.width;
    if (data.crop.y + data.crop.height > data.origHeight) data.crop.y = data.origHeight - data.crop.height;

    // Update "auto" tag: remove it when user has moved slider away from auto value
    const autoZ = data.autoZoom != null ? data.autoZoom : 1.0;
    zoomAutoTag.innerText = (Math.abs(val - autoZ) < 0.01 && autoZ > 1.005) ? "⚡ auto" : "";

    drawEditorFrame();
  }
};

editorRotateSlider.oninput = function() {
  const val = parseFloat(this.value);
  editorRotateVal.innerText = `${val.toFixed(1)}°`;
  if (currentEditorIndex !== -1) {
    imagesData[currentEditorIndex].crop.rotate = val;

    // Update "auto" tag
    const autoR = imagesData[currentEditorIndex].autoRotate != null ? imagesData[currentEditorIndex].autoRotate : 0.0;
    rotateAutoTag.innerText = (Math.abs(val - autoR) < 0.3 && Math.abs(autoR) > 0.3) ? "⚡ auto" : "";

    drawEditorFrame();
  }
};

if (editorColorGrading) {
  editorColorGrading.onchange = function() {
    if (currentEditorIndex !== -1) {
      imagesData[currentEditorIndex].colorGradingEnabled = this.checked;
      drawEditorFrame();
    }
  };
}

if (editorBrightness) {
  editorBrightness.oninput = function() {
    const val = parseInt(this.value);
    editorBrightnessVal.innerText = val > 0 ? `+${val}` : val;
    if (currentEditorIndex !== -1) {
      imagesData[currentEditorIndex].colorBrightness = val;
      drawEditorFrame();
    }
  };
}

if (editorContrast) {
  editorContrast.oninput = function() {
    const val = parseInt(this.value);
    editorContrastVal.innerText = val > 0 ? `+${val}` : val;
    if (currentEditorIndex !== -1) {
      imagesData[currentEditorIndex].colorContrast = val;
      drawEditorFrame();
    }
  };
}

if (editorSaturation) {
  editorSaturation.oninput = function() {
    const val = parseInt(this.value);
    editorSaturationVal.innerText = val > 0 ? `+${val}` : val;
    if (currentEditorIndex !== -1) {
      imagesData[currentEditorIndex].colorSaturation = val;
      drawEditorFrame();
    }
  };
}

// Copiar ajustes de cor da foto atual para todas as fotos da sessão
if (btnApplyColorToAll) {
  btnApplyColorToAll.onclick = function() {
    if (currentEditorIndex === -1 || imagesData.length === 0) return;
    const current = imagesData[currentEditorIndex];
    const b = current.colorBrightness || 0;
    const c = current.colorContrast || 0;
    const s = current.colorSaturation || 0;
    const grading = current.colorGradingEnabled !== false;

    imagesData.forEach(d => {
      d.colorBrightness = b;
      d.colorContrast = c;
      d.colorSaturation = s;
      d.colorGradingEnabled = grading;
    });

    const bStr = b > 0 ? `+${b}` : `${b}`;
    const cStr = c > 0 ? `+${c}` : `${c}`;
    const sStr = s > 0 ? `+${s}` : `${s}`;
    const msg = `✔ Ajustes de cor aplicados a todas as ${imagesData.length} fotos! (Brilho: ${bStr}, Contraste: ${cStr}, Saturação: ${sStr})`;
    if (window.showSettingsToast) {
      window.showSettingsToast(msg);
    } else {
      console.log(msg);
    }
  };
}

// Salvar / Aprovar Crop
btnApproveCrop.onclick = function() {
  if (currentEditorIndex === -1) return;
  
  const filteredList = getFilteredImages();
  const currentItem = imagesData[currentEditorIndex];
  const filteredIndex = filteredList.findIndex(d => d.id === currentItem.id);
  
  let nextGlobalIndex = -1;
  if (filteredIndex !== -1 && filteredIndex + 1 < filteredList.length) {
    const nextItem = filteredList[filteredIndex + 1];
    nextGlobalIndex = imagesData.findIndex(d => d.id === nextItem.id);
  }
  
  currentItem.status = "processed";
  currentItem.confidence = "high";
  if (currentItem._sourceImg) {
    currentItem.thumbnailUrl = generateCroppedThumbnail(currentItem, currentItem._sourceImg);
  }
  
  updateStats();
  renderGrid();
  
  if (nextGlobalIndex !== -1) {
    openEditor(nextGlobalIndex);
  } else {
    closeEditorModal();
  }
};

btnNextCrop.onclick = function() {
  if (currentEditorIndex === -1) return;
  
  const filteredList = getFilteredImages();
  const currentItem = imagesData[currentEditorIndex];
  if (currentItem && currentItem._sourceImg) {
    currentItem.thumbnailUrl = generateCroppedThumbnail(currentItem, currentItem._sourceImg);
  }
  const filteredIndex = filteredList.findIndex(d => d.id === currentItem.id);
  
  if (filteredIndex !== -1 && filteredIndex + 1 < filteredList.length) {
    const nextItem = filteredList[filteredIndex + 1];
    const nextGlobalIndex = imagesData.findIndex(d => d.id === nextItem.id);
    openEditor(nextGlobalIndex);
  } else {
    closeEditorModal();
  }
};

btnPrevCrop.onclick = function() {
  if (currentEditorIndex === -1) return;
  
  const filteredList = getFilteredImages();
  const currentItem = imagesData[currentEditorIndex];
  if (currentItem && currentItem._sourceImg) {
    currentItem.thumbnailUrl = generateCroppedThumbnail(currentItem, currentItem._sourceImg);
  }
  const filteredIndex = filteredList.findIndex(d => d.id === currentItem.id);
  
  if (filteredIndex > 0) {
    const prevItem = filteredList[filteredIndex - 1];
    const prevGlobalIndex = imagesData.findIndex(d => d.id === prevItem.id);
    openEditor(prevGlobalIndex);
  }
};

function closeEditorModal() {
  if (currentEditorIndex !== -1 && imagesData[currentEditorIndex]) {
    const cur = imagesData[currentEditorIndex];
    if (cur._sourceImg) {
      cur.thumbnailUrl = generateCroppedThumbnail(cur, cur._sourceImg);
    }
  }
  editorModal.style.display = "none";
  currentEditorIndex = -1;
  checkReadyToExport();
  renderGrid();
}

btnCloseEditor.onclick = closeEditorModal;

// Botão "Voltar à Grade" — fecha o editor e retorna à tela principal
const btnBackToGrid = document.getElementById("btn-back-to-grid");
if (btnBackToGrid) {
  btnBackToGrid.onclick = closeEditorModal;
}


// Checkbox "Rostos Detectados" no editor — controla a visualização das marcações faciais
// A variável editorShowFaces está declarada no topo (estado global)

function updateEditorFacesToggleUI(checked) {
  const track = document.getElementById("editor-faces-track");
  const thumb = document.getElementById("editor-faces-thumb");
  const checkbox = document.getElementById("editor-show-faces");
  if (!track || !thumb || !checkbox) return;
  checkbox.checked = checked;
  if (checked) {
    track.style.background = "rgba(255, 102, 0, 0.6)";
    thumb.style.transform = "translateX(15px)";
    thumb.style.background = "var(--accent-color)";
  } else {
    track.style.background = "rgba(255,255,255,0.1)";
    thumb.style.transform = "translateX(0)";
    thumb.style.background = "#666";
  }
}

const editorFacesCheckbox = document.getElementById("editor-show-faces");
if (editorFacesCheckbox) {
  // Inicializa com desabilitado
  updateEditorFacesToggleUI(false);

  // Clique no label/track dispara mudança no checkbox
  editorFacesCheckbox.addEventListener("change", function() {
    editorShowFaces = this.checked;
    updateEditorFacesToggleUI(editorShowFaces);
    drawEditorFrame();
  });

  // Permite clicar no track visual também
  const track = document.getElementById("editor-faces-track");
  if (track) {
    track.addEventListener("click", function(e) {
      e.preventDefault();
      editorFacesCheckbox.checked = !editorFacesCheckbox.checked;
      editorFacesCheckbox.dispatchEvent(new Event("change"));
    });
  }
}

// Ao abrir o editor, resetar o toggle de rostos para desabilitado
function resetEditorFacesToggle() {
  editorShowFaces = false;
  updateEditorFacesToggleUI(false);
}


// Atalhos rápidos
window.onkeydown = function(e) {
  if (currentEditorIndex === -1) return;
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
  
  if (e.key === "Enter") {
    btnApproveCrop.click();
  } else if (e.key === "ArrowRight") {
    btnNextCrop.click();
  } else if (e.key === "ArrowLeft") {
    btnPrevCrop.click();
  } else if (e.key === "Escape") {
    closeEditorModal();
  } else if (e.key === "w" || e.key === "W" || e.key === " ") {
    e.preventDefault();
    if (btnToggleWmOverlay) btnToggleWmOverlay.click();
  }
};

// -------------------------------------------------------------
// Render & Export Engine
// -------------------------------------------------------------
async function handleBatchExport() {
  if (imagesData.length === 0 || isProcessing) return;
  
  // Filtrar apenas fotos aprovadas (status === "processed")
  const exportableImages = imagesData.filter(d => d.status === "processed");
  const total = exportableImages.length;
  
  if (total === 0) {
    alert("Nenhuma foto aprovada para exportação! Vá na aba 'A Aprovar' ou 'Revisão' e aprove as fotos antes de exportar.");
    return;
  }

  isProcessing = true;
  progressPanel.style.display = "block";
  btnStartProcess.disabled = true;
  
  progressBar.style.width = "0%";
  progressPercent.innerText = "0%";
  
  let processedCount = 0;
  let startTime = Date.now();
  
  let directoryHandle = null;
  let zip = null;
  let selectedFolderName = "";
  
  // Configurar método de saída
  if (exportMethod === "folder") {
    try {
      directoryHandle = await window.showDirectoryPicker();
      selectedFolderName = directoryHandle.name;
      console.log(`✔ Acesso concedido à pasta: ${selectedFolderName}`);
    } catch (err) {
      alert("Acesso ao diretório cancelado ou não suportado. O export foi interrompido.");
      isProcessing = false;
      progressPanel.style.display = "none";
      checkReadyToExport();
      return;
    }
  } else {
    zip = new JSZip();
    if (total > 300) {
      const confirmZip = confirm("Atenção: Exportar mais de 300 fotos de alta resolução em um ZIP pode fazer o navegador esgotar a memória. Recomenda-se utilizar o método 'Direto na Pasta'. Deseja continuar?");
      if (!confirmZip) {
        isProcessing = false;
        progressPanel.style.display = "none";
        checkReadyToExport();
        return;
      }
    }
  }
  
  // Loop de renderização sequencial
  for (let i = 0; i < total; i++) {
    const data = exportableImages[i];
    progressStatusText.innerText = `Exportando e aplicando marca d'água (${i + 1} de ${total})...`;
    
    // 1. Renderizar foto final
    const jpegBlob = await renderFinalHighResPhoto(data);
    
    // 2. Definir nomenclatura: <exportBaseName>_<numero>_<horizontal/vertical>.jpg (Sem Parêntesis!)
    const fileNum = String(i + 1).padStart(4, "0");
    const suffix = data.orientation === "vertical" ? "_vertical" : "_horizontal";
    const filename = `${exportBaseName}_${fileNum}${suffix}.jpg`;
    
    // 3. Gravar
    if (exportMethod === "folder" && directoryHandle) {
      const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(jpegBlob);
      await writable.close();
    } else if (exportMethod === "zip" && zip) {
      zip.file(filename, jpegBlob);
    }
    
    data.status = "processed";
    processedCount++;
    
    const pct = Math.round((processedCount / total) * 100);
    progressBar.style.width = `${pct}%`;
    progressPercent.innerText = `${pct}%`;
    
    const elapsedSecs = (Date.now() - startTime) / 1000;
    const speed = processedCount / elapsedSecs;
    progressSpeed.innerText = `Velocidade: ${speed.toFixed(1)} img/s`;
    
    const remainingCount = total - processedCount;
    const etaSecs = remainingCount / speed;
    progressEta.innerText = `Tempo restante: ${Math.round(etaSecs)}s`;
  }
  
  // Salvar ZIP se for o caso
  if (exportMethod === "zip" && zip) {
    progressStatusText.innerText = "Empacotando arquivo ZIP (pode demorar alguns segundos)...";
    const zipBlob = await zip.generateAsync({ type: "blob" });
    
    const link = document.createElement("a");
    link.href = URL.createObjectURL(zipBlob);
    link.download = `${exportBaseName}_instagram_export.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  
  // Enviar comando para a ponte inteligente de automação local (PowerShell) para abrir o Explorer automaticamente
  try {
    if (exportMethod === "folder") {
      fetch(`http://localhost:5150/open?name=${encodeURIComponent(selectedFolderName)}`).catch(() => {});
    } else {
      fetch(`http://localhost:5150/open?zip=true`).catch(() => {});
    }
  } catch (e) {}

  // Apresentar conclusão
  let completionMessage = `🎉 Lote de ${total} fotos processado com sucesso!\n\n`;
  if (exportMethod === "folder") {
    completionMessage += `📂 Destino: Diretório selecionado "${selectedFolderName}".\n\n`;
    completionMessage += `⚡ Sucesso: Tentamos disparar a abertura física da pasta automaticamente no seu Windows Explorer!`;
  } else {
    completionMessage += `📦 Arquivo ZIP baixado automaticamente no seu diretório de downloads!\n\n💡 Dica: Se o Explorer não tiver aberto automaticamente na pasta Downloads, você pode clicar com o botão direito no arquivo baixado e escolher "Mostrar na pasta" para abrir o local instantaneamente!`;
  }
  
  alert(completionMessage);
  
  isProcessing = false;
  renderGrid();
  updateStats();
  checkReadyToExport();
}

// Rendering canvas (Photo is already post-oriented by the browser!)
async function renderFinalHighResPhoto(data) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = function() {
      // Liberar Object URL para economizar memoria
      if (img.src.startsWith("blob:")) {
        URL.revokeObjectURL(img.src);
      }
      
      let targetWidth, targetHeight;
      if (data.orientation === "vertical") {
        if (data.targetRatio && Math.abs(data.targetRatio - 9/16) < 0.01) {
          targetHeight = 4560;
          targetWidth = Math.round(4560 * 9 / 16); // 2565
        } else {
          targetWidth = 3648;
          targetHeight = 4560;
        }
      } else {
        if (data.targetRatio && Math.abs(data.targetRatio - 16/9) < 0.01) {
          targetWidth = 4560;
          targetHeight = Math.round(4560 * 9 / 16); // 2565
        } else {
          targetWidth = 4560;
          targetHeight = 3648;
        }
      }
      
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      
      ctx.save();
      
      // Mover centro para transformações
      ctx.translate(targetWidth / 2, targetHeight / 2);
      
      // Rotação manual do editor
      if (data.crop.rotate) {
        ctx.rotate((data.crop.rotate * Math.PI) / 180);
      }
      
      // NO MORE MANUAL EXIF ROTATION DRAWING! NATIVE AUTO-ORIENTATION ALREADY APPLIED.
      
      const cropScaleX = targetWidth / data.crop.width;
      const cropScaleY = targetHeight / data.crop.height;
      
      const rotationRad = ((data.crop.rotate || 0) * Math.PI) / 180;
      const rotationZoomCompensation = Math.abs(Math.cos(rotationRad)) + Math.abs(Math.sin(rotationRad)) * 1.30;
      
      // FIX CRÍTICO: Não multiplicar pelo zoom (já embutido no crop.width), mas aplicar compensação geométrica de rotação para cobrir cantos pretos!
      ctx.scale(cropScaleX * rotationZoomCompensation, cropScaleY * rotationZoomCompensation);
      
      const defaultCenterX = data.origWidth / 2;
      const defaultCenterY = data.origHeight / 2;
      
      const cropCenterX = data.crop.x + data.crop.width / 2;
      const cropCenterY = data.crop.y + data.crop.height / 2;
      
      const deltaX = defaultCenterX - cropCenterX;
      const deltaY = defaultCenterY - cropCenterY;
      
      ctx.filter = buildImageFilter(data);

      const imgX = -data.origWidth / 2 + deltaX;
      const imgY = -data.origHeight / 2 + deltaY;
      const imgCX = imgX + data.origWidth / 2;
      const imgCY = imgY + data.origHeight / 2;
      
      ctx.save();
      ctx.translate(imgCX, imgCY);
      if (data.exifOrientation === 6) {
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(img, -data.origHeight / 2, -data.origWidth / 2, data.origHeight, data.origWidth);
      } else if (data.exifOrientation === 8) {
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(img, -data.origHeight / 2, -data.origWidth / 2, data.origHeight, data.origWidth);
      } else if (data.exifOrientation === 3) {
        ctx.rotate(Math.PI);
        ctx.drawImage(img, -data.origWidth / 2, -data.origHeight / 2, data.origWidth, data.origHeight);
      } else {
        ctx.drawImage(img, -data.origWidth / 2, -data.origHeight / 2, data.origWidth, data.origHeight);
      }
      ctx.restore();
      
      ctx.restore();
      
      // Limpar o filtro para não alterar as cores da marca d'água PNG
      ctx.filter = "none";
      
      // Aplicar marca d'água PNG em modo 'cover' para manter a proporção sem distorcer o logo
      const wm = getWatermarkForImage(data);
      if (wm) {
        ctx.save();
        const wmRatio = wm.width / wm.height;
        const canvasRatio = targetWidth / targetHeight;
        let drawW, drawH, drawX, drawY;
        
        if (wmRatio > canvasRatio) {
          // Watermark is wider: fit height, crop sides
          drawH = targetHeight;
          drawW = targetHeight * wmRatio;
          drawX = (targetWidth - drawW) / 2;
          drawY = 0;
        } else {
          // Watermark is taller: fit width, crop top/bottom
          drawW = targetWidth;
          drawH = targetWidth / wmRatio;
          drawX = 0;
          drawY = (targetHeight - drawH) / 2;
        }
        ctx.drawImage(wm, drawX, drawY, drawW, drawH);
        ctx.restore();
      }
      
      canvas.toBlob((blob) => {
        resolve(blob);
      }, "image/jpeg", exportQuality);
    };
    
    const failBlob = () => {
      const dummyCanvas = document.createElement("canvas");
      dummyCanvas.width = 1;
      dummyCanvas.height = 1;
      return new Promise((r) => dummyCanvas.toBlob(r, "image/jpeg"));
    };

    getImageSrc(data.file).then(url => {
      img.onerror = async function() {
        console.error("Erro ao carregar imagem para exportação:", data.name);
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
        resolve(await failBlob());
      };
      img.src = url;
    }).catch(async (err) => {
      console.error("Erro na obtenção do ImageSrc para exportação:", err);
      resolve(await failBlob());
    });
  });
}

// -------------------------------------------------------------
// Event Listeners & UI Binding
// -------------------------------------------------------------

window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  bodyDragOverlay.classList.add("active");
});

bodyDragOverlay.addEventListener("dragleave", (e) => {
  e.preventDefault();
  bodyDragOverlay.classList.remove("active");
});

window.addEventListener("dragover", (e) => {
  e.preventDefault();
});

window.addEventListener("drop", async (e) => {
  e.preventDefault();
  bodyDragOverlay.classList.remove("active");
  
  const files = Array.from(e.dataTransfer.files);
  const allowedExtensions = [".jpg", ".jpeg", ".png", ".cr2", ".nef", ".arw", ".dng", ".pef", ".orf", ".rw2", ".raf", ".heic", ".heif", ".cr3"];
  const droppedPhotos = [];
  
  for (const file of files) {
    const nameLower = file.name.toLowerCase();
    const isImage = allowedExtensions.some(ext => nameLower.endsWith(ext));
    if (!isImage) continue;
    
    if (nameLower.endsWith(".png")) {
      await new Promise((resolvePng) => {
        const img = new Image();
        img.onload = function() {
          const isWMVertical = img.width === 3648 && img.height === 4560;
          const isWMHorizontal = img.width === 4560 && img.height === 3648;
          const isWMReels = img.width === 2565 && img.height === 4560;
          const isWMWide = img.width === 4560 && img.height === 2565;
          if (isWMVertical) {
            handleWatermarkUpload(file, "vertical");
          } else if (isWMReels) {
            handleWatermarkUpload(file, "reels");
          } else if (isWMHorizontal) {
            handleWatermarkUpload(file, "horizontal");
          } else if (isWMWide) {
            handleWatermarkUpload(file, "wide");
          } else {
            droppedPhotos.push(file);
          }
          resolvePng();
        };
        img.onerror = function() {
          droppedPhotos.push(file);
          resolvePng();
        };
        img.src = URL.createObjectURL(file);
      });
    } else {
      droppedPhotos.push(file);
    }
  }
  
  if (droppedPhotos.length > 0) {
    processSelectedFiles(droppedPhotos);
  }
});

linkChooseFolder.onclick = (e) => {
  e.preventDefault();
  inputFolderPicker.click();
};

linkChooseFiles.onclick = (e) => {
  e.preventDefault();
  inputFilesPicker.click();
};

inputFolderPicker.onchange = (e) => {
  const files = Array.from(e.target.files);
  const allowedExtensions = [".jpg", ".jpeg", ".png", ".cr2", ".nef", ".arw", ".dng", ".pef", ".orf", ".rw2", ".raf", ".heic", ".heif", ".cr3"];
  const imageFiles = files.filter(f => {
    const nameLower = f.name.toLowerCase();
    return allowedExtensions.some(ext => nameLower.endsWith(ext));
  });
  processSelectedFiles(imageFiles);
};

inputFilesPicker.onchange = (e) => {
  const files = Array.from(e.target.files);
  const allowedExtensions = [".jpg", ".jpeg", ".png", ".cr2", ".nef", ".arw", ".dng", ".pef", ".orf", ".rw2", ".raf", ".heic", ".heif", ".cr3"];
  const imageFiles = files.filter(f => {
    const nameLower = f.name.toLowerCase();
    return allowedExtensions.some(ext => nameLower.endsWith(ext));
  });
  processSelectedFiles(imageFiles);
};

const inputFilesAppend = document.getElementById("input-files-append");
if (inputFilesAppend) {
  inputFilesAppend.onchange = (e) => {
    const files = Array.from(e.target.files);
    const allowedExtensions = [".jpg", ".jpeg", ".png", ".cr2", ".nef", ".arw", ".dng", ".pef", ".orf", ".rw2", ".raf", ".heic", ".heif", ".cr3"];
    const imageFiles = files.filter(f => {
      const nameLower = f.name.toLowerCase();
      return allowedExtensions.some(ext => nameLower.endsWith(ext));
    });
    processSelectedFiles(imageFiles, true); // true = append
    inputFilesAppend.value = ""; // clear value
  };
}

const btnAddPhotos = document.getElementById("btn-add-photos");
if (btnAddPhotos && inputFilesAppend) {
  btnAddPhotos.onclick = () => {
    inputFilesAppend.click();
  };
}

const btnClearBatch = document.getElementById("btn-clear-batch");
if (btnClearBatch) {
  btnClearBatch.onclick = () => {
    if (imagesData.length === 0) return;
    if (confirm("Tem certeza que deseja remover todas as fotos deste lote? As configurações de marca d'água e nome de arquivo serão mantidas.")) {
      clearCurrentBatch();
    }
  };
}

function clearCurrentBatch() {
  imagesData = [];
  isProcessing = false;
  thumbnailsGrid.innerHTML = "";
  gridContainer.style.display = "none";
  dropzonePhotos.style.display = "flex";
  updateStats();
  checkReadyToExport();
}

dropzonePhotos.onclick = (e) => {
  if (e.target !== linkChooseFolder && e.target !== linkChooseFiles) {
    inputFolderPicker.click();
  }
};

inputWmVertical.onchange = (e) => {
  if (e.target.files.length > 0) {
    handleWatermarkUpload(e.target.files[0], "vertical");
  }
};

if (inputWmReels) {
  inputWmReels.onchange = (e) => {
    if (e.target.files.length > 0) {
      handleWatermarkUpload(e.target.files[0], "reels");
    }
  };
}

inputWmHorizontal.onchange = (e) => {
  if (e.target.files.length > 0) {
    handleWatermarkUpload(e.target.files[0], "horizontal");
  }
};

if (inputWmWide) {
  inputWmWide.onchange = (e) => {
    if (e.target.files.length > 0) {
      handleWatermarkUpload(e.target.files[0], "wide");
    }
  };
}

// Permite clicar na linha inteira para abrir o seletor de arquivos
[
  { badge: wmBadgeVertical, input: inputWmVertical },
  { badge: wmBadgeHorizontal, input: inputWmHorizontal },
  { badge: wmBadgeReels, input: inputWmReels },
  { badge: wmBadgeWide, input: inputWmWide }
].forEach(item => {
  if (item.badge && item.input) {
    item.badge.addEventListener("click", (e) => {
      // Evita disparo se o clique foi no botão de excluir ou no label[for] ou no input
      if (e.target.closest('.wm-delete-btn') || e.target.closest('label[for]') || e.target === item.input) {
        return;
      }
      item.input.click();
    });
  }
});

// Função para remover uma marca d'água específica
function removeWatermark(type) {
  if (type === "vertical") {
    watermarkVertical = null;
    if (inputWmVertical) inputWmVertical.value = "";
    if (wmBadgeVertical) wmBadgeVertical.classList.remove("active");
    if (wmLabelVertical) wmLabelVertical.innerText = "Não carregada";
    if (window.showSettingsToast) window.showSettingsToast("Marca d'água Post vertical (4:5) removida.");
  } else if (type === "horizontal") {
    watermarkHorizontal = null;
    if (inputWmHorizontal) inputWmHorizontal.value = "";
    if (wmBadgeHorizontal) wmBadgeHorizontal.classList.remove("active");
    if (wmLabelHorizontal) wmLabelHorizontal.innerText = "Não carregada";
    if (window.showSettingsToast) window.showSettingsToast("Marca d'água Post horizontal (5:4) removida.");
  } else if (type === "reels") {
    watermarkReels = null;
    if (inputWmReels) inputWmReels.value = "";
    if (wmBadgeReels) wmBadgeReels.classList.remove("active");
    if (wmLabelReels) wmLabelReels.innerText = "Não carregada";
    if (window.showSettingsToast) window.showSettingsToast("Marca d'água Story (9:16) removida.");
  } else if (type === "wide") {
    watermarkWide = null;
    if (inputWmWide) inputWmWide.value = "";
    if (wmBadgeWide) wmBadgeWide.classList.remove("active");
    if (wmLabelWide) wmLabelWide.innerText = "Não carregada";
    if (window.showSettingsToast) window.showSettingsToast("Marca d'água Widescreen (16:9) removida.");
  }
  deletePersistedWatermark(type);
  checkReadyToExport();
  updateWatermarkThumbnails();
  refreshAllThumbnails();
  if (editorModal && editorModal.style.display !== "none" && typeof drawEditorFrame === "function") {
    drawEditorFrame();
  }
}

// Botões de excluir marcas d'água
const btnDelWmVertical = document.getElementById("btn-del-wm-vertical");
const btnDelWmHorizontal = document.getElementById("btn-del-wm-horizontal");
const btnDelWmReels = document.getElementById("btn-del-wm-reels");
const btnDelWmWide = document.getElementById("btn-del-wm-wide");

if (btnDelWmVertical) {
  btnDelWmVertical.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    removeWatermark("vertical");
  });
}
if (btnDelWmHorizontal) {
  btnDelWmHorizontal.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    removeWatermark("horizontal");
  });
}
if (btnDelWmReels) {
  btnDelWmReels.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    removeWatermark("reels");
  });
}
if (btnDelWmWide) {
  btnDelWmWide.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    removeWatermark("wide");
  });
}

if (exportQualitySlider) {
  exportQualitySlider.oninput = function() {
    const val = this.value;
    if (exportQualityVal) exportQualityVal.innerText = `${val}%`;
    exportQuality = val / 100;
  };
}

if (exportBaseNameInput) {
  // Restaurar nome base do arquivo salvo no navegador
  try {
    const savedBase = localStorage.getItem("midia_lgnd_export_base_name");
    if (savedBase) {
      exportBaseName = savedBase;
      exportBaseNameInput.value = savedBase;
    }
  } catch (e) {}

  exportBaseNameInput.oninput = function() {
    exportBaseName = this.value.trim() || "TOP1001_A_D1";
    try {
      localStorage.setItem("midia_lgnd_export_base_name", this.value.trim());
    } catch (e) {}
    syncNameChips();
  };
}

// Sincronizar estado visual dos botões de preset de nomenclatura
function syncNameChips() {
  const val = (exportBaseNameInput ? exportBaseNameInput.value : "").trim();
  
  // Identificar dia (D1..D4)
  const dayMatch = val.match(/_D(\d+)/i);
  const currentDay = dayMatch ? `D${dayMatch[1]}`.toUpperCase() : "";
  document.querySelectorAll("#chips-days .chip-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.day.toUpperCase() === currentDay);
  });
  const chipDayPreview = document.getElementById("preview-chip-day");
  if (chipDayPreview) chipDayPreview.textContent = currentDay || "D1";
  const legendDayPreview = document.getElementById("preview-legend-day");
  if (legendDayPreview) legendDayPreview.textContent = currentDay || "D1";

  // Identificar inicial do fotógrafo (ex: TOP1001_A_D1 -> A ou TOP1001_K_D1 -> K)
  let currentPhotog = "";
  const photogMatch = val.match(/_([A-Za-z0-9]+)(?:_D\d+|$)/i);
  if (photogMatch) {
    currentPhotog = photogMatch[1].toUpperCase();
  }
  const photogInput = document.getElementById("input-photog-initial");
  if (photogInput && document.activeElement !== photogInput) {
    photogInput.value = currentPhotog;
  }
  const chipPhotogPreview = document.getElementById("preview-chip-photog");
  if (chipPhotogPreview) chipPhotogPreview.textContent = currentPhotog || "A";
  const legendPhotogPreview = document.getElementById("preview-legend-photog");
  if (legendPhotogPreview) legendPhotogPreview.textContent = currentPhotog || "A";
}

function setNomenclatureDay(day) {
  if (!exportBaseNameInput) return;
  let val = exportBaseNameInput.value.trim() || "TOP1001_A_D1";
  if (/_D\d+/i.test(val)) {
    val = val.replace(/_D\d+/i, `_${day}`);
  } else {
    val = `${val}_${day}`;
  }
  exportBaseNameInput.value = val;
  exportBaseName = val;
  try {
    localStorage.setItem("midia_lgnd_export_base_name", val);
  } catch (e) {}
  syncNameChips();
}

function setNomenclaturePhotog(letter) {
  if (!exportBaseNameInput) return;
  let val = exportBaseNameInput.value.trim() || "TOP1001_A_D1";
  if (/_([A-Za-z0-9]+)(_D\d+)/i.test(val)) {
    val = val.replace(/_([A-Za-z0-9]+)(_D\d+)/i, `_${letter}$2`);
  } else if (/_([A-Za-z0-9]+)$/i.test(val)) {
    val = val.replace(/_([A-Za-z0-9]+)$/i, `_${letter}`);
  } else {
    val = val.replace(/^(TOP\d*)_?/, `$1_${letter}_`);
  }
  exportBaseNameInput.value = val;
  exportBaseName = val;
  try {
    localStorage.setItem("midia_lgnd_export_base_name", val);
  } catch (e) {}
  syncNameChips();
}

document.querySelectorAll("#chips-days .chip-btn").forEach(btn => {
  btn.onclick = () => setNomenclatureDay(btn.dataset.day);
});

const photogInputEl = document.getElementById("input-photog-initial");
if (photogInputEl) {
  photogInputEl.addEventListener("input", function() {
    const clean = this.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    this.value = clean;
    setNomenclaturePhotog(clean || "A");
  });
}

syncNameChips();

// =========================================================
// Controle de Zoom / Escala do Grid de Miniaturas
// =========================================================
const GRID_ZOOM_LEVELS = [120, 150, 180, 220, 280, 360];
let currentGridZoom = parseInt(localStorage.getItem("midia_lgnd_grid_zoom"), 10) || 180;
if (!GRID_ZOOM_LEVELS.includes(currentGridZoom)) {
  currentGridZoom = 180;
}

function applyGridZoom(size) {
  currentGridZoom = size;
  document.documentElement.style.setProperty("--grid-card-size", `${size}px`);
  const zoomLabel = document.getElementById("grid-zoom-label");
  if (zoomLabel) zoomLabel.textContent = `${size}px`;
  try {
    localStorage.setItem("midia_lgnd_grid_zoom", size);
  } catch (e) {}
}

const btnZoomGridOut = document.getElementById("btn-zoom-grid-out");
const btnZoomGridIn = document.getElementById("btn-zoom-grid-in");

if (btnZoomGridOut) {
  btnZoomGridOut.onclick = function() {
    const idx = GRID_ZOOM_LEVELS.indexOf(currentGridZoom);
    if (idx > 0) {
      applyGridZoom(GRID_ZOOM_LEVELS[idx - 1]);
    }
  };
}

if (btnZoomGridIn) {
  btnZoomGridIn.onclick = function() {
    const idx = GRID_ZOOM_LEVELS.indexOf(currentGridZoom);
    if (idx < GRID_ZOOM_LEVELS.length - 1) {
      applyGridZoom(GRID_ZOOM_LEVELS[idx + 1]);
    }
  };
}

// Inicializar zoom salvo
applyGridZoom(currentGridZoom);


if (methodFolderBtn) {
  methodFolderBtn.onclick = function() {
    exportMethod = "folder";
    methodFolderBtn.classList.add("selected");
    if (methodZipBtn) methodZipBtn.classList.remove("selected");
  };
}

if (methodZipBtn) {
  methodZipBtn.onclick = function() {
    exportMethod = "zip";
    methodZipBtn.classList.add("selected");
    if (methodFolderBtn) methodFolderBtn.classList.remove("selected");
  };
}

if (tabRejected) {
  tabRejected.onclick = function() {
    activeTab = "rejected";
    tabRejected.classList.add("active");
    tabAll.classList.remove("active");
    tabReview.classList.remove("active");
    tabDone.classList.remove("active");
    if (tabPending) tabPending.classList.remove("active");
    renderGrid();
  };
}

// Tab "A Aprovar"
if (tabPending) {
  tabPending.onclick = function() {
    activeTab = "pending";
    tabPending.classList.add("active");
    tabAll.classList.remove("active");
    tabReview.classList.remove("active");
    tabDone.classList.remove("active");
    if (tabRejected) tabRejected.classList.remove("active");
    renderGrid();
  };
}

// Atualizar outros tabs para desmarcar tabPending
tabAll.onclick = function() {
  activeTab = "all";
  tabAll.classList.add("active");
  tabReview.classList.remove("active");
  tabDone.classList.remove("active");
  if (tabRejected) tabRejected.classList.remove("active");
  if (tabPending) tabPending.classList.remove("active");
  renderGrid();
};
tabReview.onclick = function() {
  activeTab = "review";
  tabReview.classList.add("active");
  tabAll.classList.remove("active");
  tabDone.classList.remove("active");
  if (tabRejected) tabRejected.classList.remove("active");
  if (tabPending) tabPending.classList.remove("active");
  renderGrid();
};
tabDone.onclick = function() {
  activeTab = "done";
  tabDone.classList.add("active");
  tabAll.classList.remove("active");
  tabReview.classList.remove("active");
  if (tabRejected) tabRejected.classList.remove("active");
  if (tabPending) tabPending.classList.remove("active");
  renderGrid();
};

// Botão "Reprovar" no editor
const btnRejectCrop = document.getElementById("btn-reject-crop");
if (btnRejectCrop) {
  btnRejectCrop.onclick = function() {
    if (currentEditorIndex === -1) return;
    
    const filteredList = getFilteredImages();
    const currentItem = imagesData[currentEditorIndex];
    const filteredIndex = filteredList.findIndex(d => d.id === currentItem.id);
    
    let nextGlobalIndex = -1;
    if (filteredIndex !== -1 && filteredIndex + 1 < filteredList.length) {
      const nextItem = filteredList[filteredIndex + 1];
      nextGlobalIndex = imagesData.findIndex(d => d.id === nextItem.id);
    }
    
    currentItem.confidence = "rejected";
    currentItem.status = "pending";
    if (!currentItem.rejectionReason) currentItem.rejectionReason = "Reprovada manualmente";
    
    // Atualizar badge
    const approvedBadge = document.getElementById("editor-approved-badge");
    if (approvedBadge) approvedBadge.style.display = "none";
    
    updateStats();
    renderGrid();
    
    if (nextGlobalIndex !== -1) {
      openEditor(nextGlobalIndex);
    } else {
      closeEditorModal();
    }
  };
}

// Botão "Excluir" no editor
const btnDeletePhoto = document.getElementById("btn-delete-photo");
if (btnDeletePhoto) {
  btnDeletePhoto.onclick = function() {
    if (currentEditorIndex === -1) return;
    if (!confirm(`Excluir "${imagesData[currentEditorIndex].name}" do lote? Esta ação não pode ser desfeita.`)) return;
    
    const filteredList = getFilteredImages();
    const currentItem = imagesData[currentEditorIndex];
    const filteredIndex = filteredList.findIndex(d => d.id === currentItem.id);
    
    let nextItemId = null;
    if (filteredIndex !== -1) {
      if (filteredIndex + 1 < filteredList.length) {
        nextItemId = filteredList[filteredIndex + 1].id;
      } else if (filteredIndex > 0) {
        nextItemId = filteredList[filteredIndex - 1].id;
      }
    }
    
    imagesData.splice(currentEditorIndex, 1);
    
    updateStats();
    renderGrid();
    checkReadyToExport();
    
    if (imagesData.length === 0) {
      closeEditorModal();
      return;
    }
    
    if (nextItemId) {
      const nextGlobalIndex = imagesData.findIndex(d => d.id === nextItemId);
      if (nextGlobalIndex !== -1) {
        openEditor(nextGlobalIndex);
        return;
      }
    }
    
    closeEditorModal();
  };
}

// Botão "Eliminar Filtradas"
if (btnEliminateFiltered) {
  btnEliminateFiltered.onclick = function() {
    const toEliminate = getFilteredImages();
    if (toEliminate.length === 0) {
      alert("Nenhuma foto para eliminar nesta aba.");
      return;
    }
    
    let label = "";
    if (activeTab === "all") label = "todas as";
    else if (activeTab === "pending") label = "a aprovar";
    else if (activeTab === "review") label = "em revisão";
    else if (activeTab === "done") label = "aprovadas";
    else if (activeTab === "rejected") label = "reprovadas";
    
    if (!confirm(`Eliminar ${toEliminate.length} foto(s) ${label} da lista? Esta ação não pode ser desfeita.`)) return;
    
    const idsToRemove = new Set(toEliminate.map(d => d.id));
    imagesData = imagesData.filter(d => !idsToRemove.has(d.id));
    
    updateStats();
    renderGrid();
    checkReadyToExport();
  };
}

// Botão "Aprovar Filtradas"
if (btnApproveFiltered) {
  btnApproveFiltered.onclick = function() {
    const toApprove = getFilteredImages().filter(d => d.status !== "processed");
    if (toApprove.length === 0) {
      alert("Nenhuma foto pendente para aprovar nesta aba.");
      return;
    }
    
    let label = "";
    if (activeTab === "all") label = "todas as";
    else if (activeTab === "pending") label = "a aprovar";
    else if (activeTab === "review") label = "em revisão";
    else if (activeTab === "rejected") label = "reprovadas";
    
    if (!confirm(`Aprovar ${toApprove.length} foto(s) ${label} do lote?`)) return;
    
    toApprove.forEach(d => {
      d.status = "processed";
      d.confidence = "high";
    });
    
    updateStats();
    renderGrid();
    checkReadyToExport();
  };
}

btnStartProcess.onclick = handleBatchExport;

window.onresize = function() {
  if (currentEditorIndex !== -1) {
    resizeEditorCanvas();
    drawEditorFrame();
  }
};

// Initialize
initMediaPipePose();
checkReadyToExport();

// ============================================================
// PAINEL DE CONFIGURAÇÕES DO MOTOR DE IA
// ============================================================
(function initSettingsPanel() {
  const settingsModal    = document.getElementById("settings-modal");
  const btnOpenSettings  = document.getElementById("btn-open-settings");
  const btnCloseSettings = document.getElementById("btn-close-settings");
  const btnSaveSettings  = document.getElementById("btn-settings-save");
  const btnResetSettings = document.getElementById("btn-settings-reset");

  // Toggle de deteccao de rosto
  const faceCheckbox     = document.getElementById("cfg-face-detection-enabled");
  const faceLabel        = document.getElementById("cfg-face-detection-label");
  const faceTrack        = document.getElementById("cfg-face-toggle-track");
  const faceThumb        = document.getElementById("cfg-face-toggle-thumb");

  // Toggle de exibicao de marcacoes no editor
  const annoCheckbox     = document.getElementById("cfg-show-annotations");
  const annoLabel        = document.getElementById("cfg-annotations-label");
  const annoTrack        = document.getElementById("cfg-annotations-toggle-track");
  const annoThumb        = document.getElementById("cfg-annotations-toggle-thumb");

  function updateFaceToggleUI(checked) {
    if (!faceCheckbox || !faceLabel || !faceTrack || !faceThumb) return;
    faceCheckbox.checked = checked;
    if (checked) {
      faceTrack.style.background = "var(--accent-color)";
      faceTrack.style.borderColor = "var(--accent-color)";
      faceThumb.style.left = "21px";
      faceThumb.style.background = "#fff";
      faceLabel.innerText = "Ativado";
      faceLabel.style.color = "var(--accent-color)";
    } else {
      faceTrack.style.background = "rgba(255,255,255,0.1)";
      faceTrack.style.borderColor = "rgba(255,255,255,0.15)";
      faceThumb.style.left = "3px";
      faceThumb.style.background = "#888";
      faceLabel.innerText = "Desativado";
      faceLabel.style.color = "var(--text-muted)";
    }
  }

  function updateAnnoToggleUI(checked) {
    if (!annoCheckbox || !annoLabel || !annoTrack || !annoThumb) return;
    annoCheckbox.checked = checked;
    if (checked) {
      annoTrack.style.background = "var(--accent-color)";
      annoTrack.style.borderColor = "var(--accent-color)";
      annoThumb.style.left = "21px";
      annoThumb.style.background = "#fff";
      annoLabel.innerText = "Ativado";
      annoLabel.style.color = "var(--accent-color)";
    } else {
      annoTrack.style.background = "rgba(255,255,255,0.1)";
      annoTrack.style.borderColor = "rgba(255,255,255,0.15)";
      annoThumb.style.left = "3px";
      annoThumb.style.background = "#888";
      annoLabel.innerText = "Desativado";
      annoLabel.style.color = "var(--text-muted)";
    }
  }

  if (faceTrack) {
    faceTrack.parentElement.addEventListener("click", (e) => {
      e.preventDefault();
      const newState = !faceCheckbox.checked;
      updateFaceToggleUI(newState);
    });
  }

  if (annoTrack) {
    annoTrack.parentElement.addEventListener("click", (e) => {
      e.preventDefault();
      const newState = !annoCheckbox.checked;
      updateAnnoToggleUI(newState);
    });
  }

  // Mapa: id-do-slider → { key: chave no CONFIG, display: id do span, fmt: formatador }
  const SLIDERS = [
    { id: "cfg-pose-confidence",  key: "poseMinConfidence",    fmt: v => parseFloat(v).toFixed(2) },
    { id: "cfg-face-confidence",  key: "faceMinConfidence",    fmt: v => parseFloat(v).toFixed(2) },
    { id: "cfg-landmark-vis",     key: "landmarkVisThreshold", fmt: v => parseFloat(v).toFixed(2) },
    { id: "cfg-pose-filter",      key: "poseConfidenceFilter", fmt: v => parseFloat(v).toFixed(2) },
    { id: "cfg-zoom-solo",        key: "maxZoomSolo",          fmt: v => parseFloat(v).toFixed(2) + "x" },
    { id: "cfg-zoom-group",       key: "maxZoomGroup",         fmt: v => parseFloat(v).toFixed(2) + "x" },
    { id: "cfg-subject-height",   key: "subjectHeightTarget",  fmt: v => Math.round(v) + "%" },
    { id: "cfg-face-third",       key: "faceThirdPosition",    fmt: v => Math.round(v) + "%" },
    { id: "cfg-blur-threshold",   key: "blurThreshold",        fmt: v => Math.round(v) },
    { id: "cfg-dark-threshold",   key: "darkThreshold",        fmt: v => Math.round(v) },
    { id: "cfg-bright-threshold", key: "brightThreshold",      fmt: v => Math.round(v) },
  ];

  // Converter chave do CONFIG → id do span de valor no HTML
  function keyToValId(key) {
    const map = {
      poseMinConfidence:    "cfg-pose-confidence-val",
      faceMinConfidence:    "cfg-face-confidence-val",
      landmarkVisThreshold: "cfg-landmark-vis-val",
      poseConfidenceFilter: "cfg-pose-filter-val",
      maxZoomSolo:          "cfg-zoom-solo-val",
      maxZoomGroup:         "cfg-zoom-group-val",
      subjectHeightTarget:  "cfg-subject-height-val",
      faceThirdPosition:    "cfg-face-third-val",
      blurThreshold:        "cfg-blur-threshold-val",
      darkThreshold:        "cfg-dark-threshold-val",
      brightThreshold:      "cfg-bright-threshold-val",
    };
    return map[key];
  }

  // Sincronizar sliders com os valores atuais do CONFIG
  function syncSlidersToConfig() {
    SLIDERS.forEach(({ id, key, fmt }) => {
      const slider = document.getElementById(id);
      const valEl  = document.getElementById(keyToValId(key));
      if (!slider || !valEl) return;

      // subjectHeightTarget e faceThirdPosition são 0–1 internamente, mas o slider usa %
      let sliderVal = CONFIG[key];
      if (key === "subjectHeightTarget") sliderVal = CONFIG[key] * 100;
      if (key === "faceThirdPosition")   sliderVal = CONFIG[key] * 100;

      slider.value = sliderVal;
      valEl.textContent = fmt(slider.value);
    });
    // Sincronizar toggle de detecção de rosto
    updateFaceToggleUI(CONFIG.faceDetectionEnabled);
    // Sincronizar toggle de exibição de marcações
    updateAnnoToggleUI(CONFIG.showAnnotations);
  }

  // Montar listeners de preview ao vivo nos sliders
  SLIDERS.forEach(({ id, key, fmt }) => {
    const slider = document.getElementById(id);
    const valEl  = document.getElementById(keyToValId(key));
    if (!slider || !valEl) return;

    slider.addEventListener("input", () => {
      valEl.textContent = fmt(slider.value);
    });
  });

  // Abrir modal
  if (btnOpenSettings) {
    btnOpenSettings.addEventListener("click", () => {
      syncSlidersToConfig();
      settingsModal.style.display = "flex";
    });
  }

  // Fechar modal
  function closeSettings() {
    settingsModal.style.display = "none";
  }
  if (btnCloseSettings) btnCloseSettings.addEventListener("click", closeSettings);
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeSettings();
  });

  // Salvar configurações
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener("click", () => {
      SLIDERS.forEach(({ id, key }) => {
        const slider = document.getElementById(id);
        if (!slider) return;
        let val = parseFloat(slider.value);
        // Converter % de volta para 0–1 para as chaves de fração
        if (key === "subjectHeightTarget") val = val / 100;
        if (key === "faceThirdPosition")   val = val / 100;
        CONFIG[key] = val;
      });
      if (faceCheckbox) {
        CONFIG.faceDetectionEnabled = faceCheckbox.checked;
      }
      if (annoCheckbox) {
        CONFIG.showAnnotations = annoCheckbox.checked;
      }

      closeSettings();
      showSettingsToast("✓ Configurações salvas! Serão aplicadas no próximo lote de fotos.");
      console.log("[CONFIG] Configurações atualizadas:", CONFIG);
    });
  }

  // Restaurar padrões
  if (btnResetSettings) {
    btnResetSettings.addEventListener("click", () => {
      CONFIG = { ...CONFIG_DEFAULTS };
      syncSlidersToConfig();
      showSettingsToast("Configurações restauradas para os valores padrão.");
    });
  }

  // Mini toast de confirmação
  function showSettingsToast(msg) {
    let toast = document.getElementById("settings-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "settings-toast";
      toast.style.cssText = [
        "position:fixed",
        "bottom:24px",
        "left:50%",
        "transform:translateX(-50%) translateY(20px)",
        "background:rgba(20,20,20,0.97)",
        "border:1px solid rgba(255,102,0,0.5)",
        "color:#fff",
        "padding:10px 22px",
        "border-radius:10px",
        "font-size:12px",
        "font-weight:600",
        "z-index:99999",
        "box-shadow:0 8px 32px rgba(0,0,0,0.6)",
        "opacity:0",
        "transition:opacity 0.3s, transform 0.3s",
        "pointer-events:none",
      ].join(";");
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateX(-50%) translateY(0)";
    });
    // Animate out after 3s
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(-50%) translateY(10px)";
    }, 3000);
  }
  window.showSettingsToast = showSettingsToast;
})();

// ======================================================
// Gerador Automático de Marcas d'Água (Sem Canva)
// ======================================================
(function initWatermarkGenerator() {
  const modal = document.getElementById("wm-generator-modal");
  const btnOpen = document.getElementById("btn-open-wm-generator");
  const btnClose = document.getElementById("btn-close-wm-gen");
  const btnCancel = document.getElementById("btn-cancel-wm-gen");
  const btnApply = document.getElementById("btn-apply-wm-gen");
  const btnDownload = document.getElementById("btn-download-wm-pngs");

  const inputEventNum = document.getElementById("wm-input-event-num");
  const inputTrackName = document.getElementById("wm-input-track-name");
  const inputEventDate = document.getElementById("wm-input-event-date");
  const inputTrackBadge = document.getElementById("wm-input-track-badge");
  const imgTrackPreview = document.getElementById("wm-gen-track-preview");
  const cfgDarkGradient = document.getElementById("wm-cfg-dark-gradient");

  const previewCanvas = document.getElementById("wm-preview-canvas");
  const previewDimsLabel = document.getElementById("wm-preview-dims-label");
  const tabsContainer = document.getElementById("wm-gen-tabs");
  const showSettingsToast = (msg) => window.showSettingsToast ? window.showSettingsToast(msg) : console.log(msg);

  if (!modal || !btnOpen) return;

  // Imagens base padrão
  const imgLeg = new Image();
  imgLeg.src = "assets/badge_legendarios.png";

  const imgTop = new Image();
  imgTop.src = "assets/badge_desafio_top.png";

  const imgFonte = new Image();
  imgFonte.src = "assets/track_fonte_da_vida.png";

  const imgSol = new Image();
  imgSol.src = "assets/track_sol_nascente.png";

  let imgCustom = null;
  let imgTrack = imgSol; // Padrão: Sol Nascente (Yamanashi)

  let currentFormat = "vertical"; // "vertical", "horizontal", "reels", "wide"

  const FORMAT_SPECS = {
    vertical:   { label: "Post vertical (4:5)", w: 3648, h: 4560, ratio: 0.8 },
    horizontal: { label: "Post horizontal (5:4)", w: 4560, h: 3648, ratio: 1.25 },
    reels:      { label: "Story / Reels (9:16)", w: 2565, h: 4560, ratio: 0.5625 },
    wide:       { label: "Widescreen (16:9)", w: 4560, h: 2565, ratio: 1.777 }
  };

  // Seleção de Cards de Logo da Pista
  const cardFonte = document.getElementById("card-track-fonte");
  const cardSol = document.getElementById("card-track-sol");
  const cardCustom = document.getElementById("card-track-custom");
  const customCardLabel = document.getElementById("wm-custom-card-label");

  let currentSelectedTrackId = "sol_nascente";

  function saveCurrentConfig() {
    saveWmConfigToStorage({
      eventNum: inputEventNum ? inputEventNum.value : "1001",
      trackName: inputTrackName ? inputTrackName.value : "Track Sol Nascente - Yamanashi / Japão",
      eventDate: inputEventDate ? inputEventDate.value : "19 a 22 de setembro de 2026",
      includeGradient: cfgDarkGradient ? cfgDarkGradient.checked : true,
      selectedTrackId: currentSelectedTrackId,
      customLabel: customCardLabel ? customCardLabel.innerText : null
    });
  }

  function selectTrackCard(cardId, skipTextUpdate = false) {
    currentSelectedTrackId = cardId;
    [cardSol, cardFonte, cardCustom].forEach(c => c && c.classList.remove("active"));
    if (cardId === "sol_nascente") {
      if (cardSol) cardSol.classList.add("active");
      imgTrack = imgSol;
      if (!skipTextUpdate && inputTrackName) inputTrackName.value = "Track Sol Nascente - Yamanashi / Japão";
    } else if (cardId === "fonte_da_vida") {
      if (cardFonte) cardFonte.classList.add("active");
      imgTrack = imgFonte;
      if (!skipTextUpdate && inputTrackName) inputTrackName.value = "Track Fonte da Vida - Aichi / Japão";
    } else if (cardId === "custom") {
      if (cardCustom) cardCustom.classList.add("active");
      if (imgCustom) imgTrack = imgCustom;
    }
    updatePreview();
    saveCurrentConfig();
  }

  // Restaurar dados salvos no localStorage
  const savedCfg = loadWmConfigFromStorage();
  if (savedCfg) {
    if (savedCfg.eventNum && inputEventNum) inputEventNum.value = savedCfg.eventNum;
    if (savedCfg.trackName && inputTrackName) inputTrackName.value = savedCfg.trackName;
    if (savedCfg.eventDate && inputEventDate) inputEventDate.value = savedCfg.eventDate;
    if (savedCfg.includeGradient !== undefined && cfgDarkGradient) cfgDarkGradient.checked = savedCfg.includeGradient;
    if (savedCfg.selectedTrackId) {
      selectTrackCard(savedCfg.selectedTrackId, true);
    } else {
      selectTrackCard("sol_nascente", true);
    }
    if (savedCfg.customLabel && customCardLabel) customCardLabel.innerText = savedCfg.customLabel;
  } else {
    selectTrackCard("sol_nascente", false);
  }

  if (cardSol) cardSol.addEventListener("click", () => selectTrackCard("sol_nascente"));
  if (cardFonte) cardFonte.addEventListener("click", () => selectTrackCard("fonte_da_vida"));

  // Upload de arquivo de logo da pista personalizado
  if (inputTrackBadge) {
    inputTrackBadge.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (evt) => {
          const newImg = new Image();
          newImg.onload = () => {
            imgCustom = newImg;
            imgTrack = newImg;
            if (customCardLabel) {
              customCardLabel.innerText = file.name.length > 10 ? file.name.substring(0, 10) + "..." : file.name;
            }
            selectTrackCard("custom");
          };
          newImg.src = evt.target.result;
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Abrir Modal
  function openModal() {
    const curSaved = loadWmConfigFromStorage();
    if (curSaved && curSaved.eventNum) {
      inputEventNum.value = curSaved.eventNum;
    } else if (exportBaseNameInput && exportBaseNameInput.value) {
      const match = exportBaseNameInput.value.match(/TOP(\d+)/i);
      if (match && match[1]) {
        inputEventNum.value = match[1];
      }
    }
    modal.style.display = "flex";
    if (document.fonts && document.fonts.load) {
      Promise.all([
        document.fonts.load("900 48px 'Nexa Black'"),
        document.fonts.load("bold 48px 'Nexa'"),
        document.fonts.ready
      ]).then(updatePreview).catch(updatePreview);
    } else {
      updatePreview();
    }
  }

  window.openWatermarkGenerator = openModal;
  btnOpen.addEventListener("click", openModal);

  // Fechar Modal
  function closeModal() {
    modal.style.display = "none";
  }
  window.closeWatermarkGenerator = closeModal;
  if (btnClose) btnClose.addEventListener("click", closeModal);
  if (btnCancel) btnCancel.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // Troca de abas de formato no preview
  if (tabsContainer) {
    const tabButtons = tabsContainer.querySelectorAll(".wm-tab-btn");
    tabButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        tabButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentFormat = btn.dataset.fmt;
        updatePreview();
      });
    });
  }

  // Atualizar preview e persistir ao digitar
  [inputEventNum, inputTrackName, inputEventDate].forEach(inp => {
    if (inp) inp.addEventListener("input", () => {
      updatePreview();
      saveCurrentConfig();
    });
  });
  if (cfgDarkGradient) cfgDarkGradient.addEventListener("change", () => {
    updatePreview();
    saveCurrentConfig();
  });

  // Renderiza a arte em qualquer canvas (preview ou resolução completa)
  function drawWatermarkArt(canvas, spec, options) {
    const w = spec.w;
    const h = spec.h;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);

    // 1. Gradiente escuro no rodapé (fade to black suave)
    if (options.includeGradient) {
      const gradStart = (spec === FORMAT_SPECS.reels) ? (h * 0.68) : (h * 0.62);
      const grad = ctx.createLinearGradient(0, gradStart, 0, h);
      grad.addColorStop(0, "rgba(0, 0, 0, 0)");
      grad.addColorStop(0.35, "rgba(0, 0, 0, 0.25)");
      grad.addColorStop(1, "rgba(0, 0, 0, 0.72)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, gradStart, w, h - gradStart);
    }

    // 2. Margens e proporções conforme o formato
    let safeTop, safeBottom, marginX, badgeH;

    if (spec === FORMAT_SPECS.reels) {
      // 9:16 Stories: Respiro seguro para interface do Instagram
      safeTop = h * 0.082;
      safeBottom = h * 0.082;
      marginX = w * 0.055;
      badgeH = h * 0.060;
    } else if (spec === FORMAT_SPECS.vertical) {
      // 4:5 Feed
      safeTop = h * 0.042;
      safeBottom = h * 0.042;
      marginX = w * 0.042;
      badgeH = h * 0.080;
    } else if (spec === FORMAT_SPECS.horizontal) {
      // 5:4 Feed
      safeTop = h * 0.044;
      safeBottom = h * 0.044;
      marginX = w * 0.038;
      badgeH = h * 0.090;
    } else {
      // 16:9 Widescreen
      safeTop = h * 0.050;
      safeBottom = h * 0.050;
      marginX = w * 0.035;
      badgeH = h * 0.110;
    }

    // 3. Logo da Pista (Topo Esquerdo)
    if (imgTrack && imgTrack.complete && imgTrack.naturalWidth > 0) {
      const trackAsp = imgTrack.naturalWidth / imgTrack.naturalHeight;
      const trackW = badgeH * trackAsp;
      ctx.drawImage(imgTrack, marginX, safeTop, trackW, badgeH);
    }

    // 4. Bandeira Legendários Japão (Topo Direito)
    if (imgLeg && imgLeg.complete && imgLeg.naturalWidth > 0) {
      const legAsp = imgLeg.naturalWidth / imgLeg.naturalHeight;
      const legW = badgeH * legAsp;
      ctx.drawImage(imgLeg, w - marginX - legW, safeTop, legW, badgeH);
    }

    // 5. Emblema DESAFIO TOP & Textos (Rodapé Esquerdo)
    const botY = h - safeBottom - badgeH;
    let textX = marginX;

    if (imgTop && imgTop.complete && imgTop.naturalWidth > 0) {
      const topAsp = imgTop.naturalWidth / imgTop.naturalHeight;
      const topW = badgeH * topAsp;
      ctx.drawImage(imgTop, marginX, botY, topW, badgeH);
      textX = marginX + topW + (w * 0.015);
    }

    // Textos informativos do evento
    const numStr = "#" + (options.eventNum || "1001").trim();
    const trackStr = (options.trackName || "Track Fonte da Vida - Aichi / Japão").trim();
    const dateStr = (options.eventDate || "19 a 22 de setembro de 2026").trim();

    // Família tipográfica oficial: Nexa (com fallbacks de sistema)
    const fontFamily = "'Nexa', 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
    const maxTextWidth = w - textX - marginX;

    // Função utilitária com auto-ajuste de largura para NUNCA cortar em Story ou telas estreitas
    function drawFittedText(text, baseY, baseFontSize, fontStyleWeight, fillStyle, customFamily) {
      let fs = baseFontSize;
      const fam = customFamily || fontFamily;
      ctx.font = `${fontStyleWeight} ${Math.round(fs)}px ${fam}`;
      let measured = ctx.measureText(text).width;
      if (measured > maxTextWidth && maxTextWidth > 50) {
        fs = Math.floor(baseFontSize * (maxTextWidth / measured) * 0.97);
        ctx.font = `${fontStyleWeight} ${Math.round(fs)}px ${fam}`;
      }
      ctx.fillStyle = fillStyle;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(text, textX, baseY);
    }

    // Linha 1: #1001 (Nexa Black, peso 900)
    const size1 = badgeH * 0.38;
    drawFittedText(numStr, botY + size1 * 0.95, size1, "900", "#ffffff", "'Nexa Black', 'Nexa', sans-serif");

    // Linha 2: Track Nome (Nexa Itálico Negrito, Laranja Vibrante, tamanho um pouco maior)
    const size2 = badgeH * 0.27;
    drawFittedText(trackStr, botY + size1 + size2 * 1.15, size2, "italic bold", "#ff4400");

    // Linha 3: Data do Evento (Nexa Itálico Negrito como o track, Branco, tamanho um pouco maior)
    const size3 = badgeH * 0.23;
    drawFittedText(dateStr, botY + size1 + size2 + size3 * 1.35, size3, "italic bold", "#ffffff");
  }

  // Atualiza o canvas de preview na tela
  function updatePreview() {
    if (!previewCanvas) return;
    const spec = FORMAT_SPECS[currentFormat] || FORMAT_SPECS.vertical;
    if (previewDimsLabel) {
      previewDimsLabel.innerText = `Dimensão final: ${spec.w} x ${spec.h} px (${spec.label})`;
    }

    // Renderiza em resolução moderada para preview suave
    const scale = 0.25;
    const pW = Math.round(spec.w * scale);
    const pH = Math.round(spec.h * scale);

    const tempCanvas = document.createElement("canvas");
    drawWatermarkArt(tempCanvas, { ...spec, w: pW, h: pH }, {
      eventNum: inputEventNum.value,
      trackName: inputTrackName.value,
      eventDate: inputEventDate.value,
      includeGradient: cfgDarkGradient.checked
    });

    previewCanvas.width = pW;
    previewCanvas.height = pH;
    const pCtx = previewCanvas.getContext("2d");
    pCtx.clearRect(0, 0, pW, pH);

    // Fundo simulado sutil (gradiente de foto fotográfica)
    const bgGrad = pCtx.createLinearGradient(0, 0, pW, pH);
    bgGrad.addColorStop(0, "#2a2220");
    bgGrad.addColorStop(0.5, "#3b2a26");
    bgGrad.addColorStop(1, "#181412");
    pCtx.fillStyle = bgGrad;
    pCtx.fillRect(0, 0, pW, pH);

    // Desenha a marca d'água por cima do fundo simulado
    pCtx.drawImage(tempCanvas, 0, 0);
  }

  // Converte canvas para objeto Image nativo
  function canvasToImage(canvas) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = URL.createObjectURL(blob);
      }, "image/png");
    });
  }

  // 1. APLICAR MARCAS D'ÁGUA AO PROGRAMA
  btnApply.addEventListener("click", async () => {
    btnApply.disabled = true;
    btnApply.innerText = "⏳ Gerando as 4 resoluções...";

    try {
      const opts = {
        eventNum: inputEventNum.value,
        trackName: inputTrackName.value,
        eventDate: inputEventDate.value,
        includeGradient: cfgDarkGradient.checked
      };

      const evNum = (opts.eventNum || "1001").trim();
      const statusText = `✔ Gerada (#${evNum})`;

      // 1. Post Vertical (4:5)
      const cVert = document.createElement("canvas");
      drawWatermarkArt(cVert, FORMAT_SPECS.vertical, opts);
      watermarkVertical = await canvasToImage(cVert);
      persistWatermarkImage("vertical", cVert.toDataURL("image/png"), statusText);

      // 2. Post Horizontal (5:4)
      const cHoriz = document.createElement("canvas");
      drawWatermarkArt(cHoriz, FORMAT_SPECS.horizontal, opts);
      watermarkHorizontal = await canvasToImage(cHoriz);
      persistWatermarkImage("horizontal", cHoriz.toDataURL("image/png"), statusText);

      // 3. Story (9:16)
      const cReels = document.createElement("canvas");
      drawWatermarkArt(cReels, FORMAT_SPECS.reels, opts);
      watermarkReels = await canvasToImage(cReels);
      persistWatermarkImage("reels", cReels.toDataURL("image/png"), statusText);

      // 4. Widescreen (16:9)
      const cWide = document.createElement("canvas");
      drawWatermarkArt(cWide, FORMAT_SPECS.wide, opts);
      watermarkWide = await canvasToImage(cWide);
      persistWatermarkImage("wide", cWide.toDataURL("image/png"), statusText);

      // Atualizar interface lateral
      if (wmBadgeVertical) { wmBadgeVertical.classList.add("active"); if (wmLabelVertical) wmLabelVertical.innerText = statusText; }
      if (wmBadgeHorizontal) { wmBadgeHorizontal.classList.add("active"); if (wmLabelHorizontal) wmLabelHorizontal.innerText = statusText; }
      if (wmBadgeReels) { wmBadgeReels.classList.add("active"); if (wmLabelReels) wmLabelReels.innerText = statusText; }
      if (wmBadgeWide) { wmBadgeWide.classList.add("active"); if (wmLabelWide) wmLabelWide.innerText = statusText; }
      updateWatermarkThumbnails();
      refreshAllThumbnails();

      // Salvar estado atual dos campos
      saveCurrentConfig();

      // Atualizar sugestão do nome base e salvar no localStorage
      if (exportBaseNameInput) {
        const newBase = `TOP${evNum}_A_D1`;
        exportBaseNameInput.value = newBase;
        exportBaseName = newBase;
        try {
          localStorage.setItem("midia_lgnd_export_base_name", newBase);
        } catch (e) {}
        syncNameChips();
      }

      checkReadyToExport();
      closeModal();

      // Feedback toast
      showSettingsToast(`✔ As 4 marcas d'água do Desafio #${evNum} foram geradas e salvas com sucesso!`);
      console.log(`✔ 4 Marcas d'água geradas com sucesso para #${evNum}`);

    } catch (err) {
      console.error("Erro ao gerar marcas d'água:", err);
      alert("Ocorreu um erro ao gerar as marcas d'água: " + err.message);
    } finally {
      btnApply.disabled = false;
      btnApply.innerText = "✓ Aplicar";
    }
  });

  // 2. BAIXAR OS 4 PNGs (.ZIP)
  if (btnDownload) {
    btnDownload.addEventListener("click", async () => {
      btnDownload.disabled = true;
      btnDownload.innerText = "⏳ Compactando...";

      try {
        const opts = {
          eventNum: inputEventNum.value,
          trackName: inputTrackName.value,
          eventDate: inputEventDate.value,
          includeGradient: cfgDarkGradient.checked
        };
        const evNum = (opts.eventNum || "1759").trim();

        const zip = new JSZip();

        // Gerar os 4 blobs
        const formats = [
          { spec: FORMAT_SPECS.vertical, name: `1_Post_Vertical_4x5_TOP${evNum}.png` },
          { spec: FORMAT_SPECS.horizontal, name: `2_Post_Horizontal_5x4_TOP${evNum}.png` },
          { spec: FORMAT_SPECS.reels, name: `3_Story_Reels_9x16_TOP${evNum}.png` },
          { spec: FORMAT_SPECS.wide, name: `4_Widescreen_16x9_TOP${evNum}.png` }
        ];

        for (const item of formats) {
          const cvs = document.createElement("canvas");
          drawWatermarkArt(cvs, item.spec, opts);
          const blob = await new Promise(r => cvs.toBlob(r, "image/png"));
          zip.file(item.name, blob);
        }

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(zipBlob);
        a.download = `Marcas_Dagua_TOP${evNum}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        showSettingsToast(`✔ Arquivo Marcas_Dagua_TOP${evNum}.zip baixado com sucesso!`);
      } catch (err) {
        console.error("Erro ao baixar zip:", err);
        alert("Erro ao compactar as marcas d'água: " + err.message);
      } finally {
        btnDownload.disabled = false;
        btnDownload.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Baixar 4 PNGs (.zip)</span>`;
      }
    });
  }

  // Pre-load assets
  imgLeg.onload = updatePreview;
  imgTop.onload = updatePreview;
  imgTrack.onload = updatePreview;
})();

// Restaurar marcas d'água persistidas ao iniciar a aplicação
if (typeof loadPersistedWatermarks === "function") {
  loadPersistedWatermarks();
}

