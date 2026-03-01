/**
 * Reader Component Logic V3.4 (Fail-Safe Stabilization API)
 */

let currentBookMeta = null;
let currentWordData = null;

let epubBook = null;
let epubRendition = null;
let pdfDoc = null;
let pdfPageNum = 1;
let pdfCanvas = null;
let pdfCtx = null;

document.addEventListener('DOMContentLoaded', async () => {
    setupControls();
    setupAudioPlayer();

    document.getElementById('dict-play').addEventListener('click', () => {
        if (currentWordData && currentWordData.word && window.speechAPI) {
            window.speechAPI.speak(currentWordData.word, 0.9);
        }
    });

    const bookId = localStorage.getItem('activeBookId');
    if (!bookId) {
        alert("Lütfen kütüphaneden bir kitap seçin.");
        window.location.href = 'index.html';
        return;
    }

    try {
        const db = await window.dbAPI.initDB();
        const bookData = await db.get('books', bookId);

        if (bookData) {
            currentBookMeta = bookData.meta;
            document.getElementById('book-title').textContent = currentBookMeta.title;

            if (currentBookMeta.audio_url) {
                initAudioPlayer(currentBookMeta.audio_url);
            }

            if (bookData.data) {
                document.getElementById('local-viewer-layer').classList.remove('hidden');
                document.getElementById('book-progress').classList.remove('hidden');
                if (currentBookMeta.type === 'pdf') initPDFReader(bookData.data);
                else initEpubReader(bookData.data);

            } else if (currentBookMeta.ia_id) {
                initEmbedReader(currentBookMeta.ia_id);
            } else if (currentBookMeta.audio_url) {
                document.getElementById('error-viewer').classList.remove('hidden');
                document.getElementById('error-title').textContent = "🎧 Sadece Sesli Kitap";
                document.getElementById('error-desc').textContent = "Dinlemek için aşağıdaki oynatıcıyı kullanın.";
            } else {
                document.getElementById('error-viewer').classList.remove('hidden');
            }
        } else {
            alert("Kitap verisi bulunamadı.");
            window.location.href = 'index.html';
        }
    } catch (err) {
        console.error("Kitap yükleme hatası:", err);
    }
});

// =====================================
// EMBED LAYER (PLANS B & C) - V3.4
// =====================================
function initEmbedReader(ia_id) {
    const iframe = document.getElementById('embed-viewer');
    const fallbackBar = document.getElementById('embed-fallback-bar');
    const fallbackBtn = document.getElementById('btn-fallback-server');

    document.getElementById('local-viewer-layer').classList.add('hidden');
    document.getElementById('book-progress').classList.add('hidden');

    iframe.classList.remove('hidden');
    fallbackBar.classList.remove('hidden');

    // Fallback UI State Reset
    fallbackBar.style.background = 'var(--warning)';
    fallbackBar.style.color = '#000';
    fallbackBar.innerHTML = `
        Görüntü yüklenmediyse: 
        <button id="btn-fallback-server" class="btn primary" style="padding:4px 8px; font-size:0.8rem; margin-left:10px; background:#000; color:#fff;">
            Alternatif Sunucuyu Dene (Plan C)
        </button>
    `;

    // V3.4: Reconnect listener due to innerHTML reset
    const newFallbackBtn = document.getElementById('btn-fallback-server');

    // Archive.org (Plan B)
    iframe.src = `https://archive.org/embed/${ia_id}?ui=embed`;

    // Auto hint transition after 6 seconds
    let hintTimeout = setTimeout(() => {
        if (newFallbackBtn) newFallbackBtn.style.animation = 'pulse 1.5s infinite';
    }, 6000);

    // Manual click: Fallback to OpenLibrary (Plan C)
    newFallbackBtn.addEventListener('click', () => {
        clearTimeout(hintTimeout);
        newFallbackBtn.textContent = "Alternatif Yükleniyor...";
        newFallbackBtn.disabled = true;
        newFallbackBtn.style.animation = 'none';
        iframe.src = `https://openlibrary.org/embed/${ia_id}`;

        // Deep fail detection (Plan D)
        setTimeout(() => {
            newFallbackBtn.textContent = "Hala çalışmıyor mu? İptal Et (Plan D)";
            newFallbackBtn.disabled = false;
            newFallbackBtn.onclick = () => {
                iframe.classList.add('hidden');
                fallbackBar.classList.add('hidden');
                document.getElementById('error-viewer').classList.remove('hidden');
            };
        }, 3500);
    });
}

// =====================================
// AUDIO PLAYER LOGIC
// =====================================
function initAudioPlayer(url) {
    const deck = document.getElementById('audio-player-deck');
    const audioEl = document.getElementById('combo-audio');
    if (deck && audioEl) {
        deck.classList.remove('hidden');
        audioEl.src = url;
    }
}

function setupAudioPlayer() {
    const audioEl = document.getElementById('combo-audio');
    const speedBtns = document.querySelectorAll('.speed-btn');
    if (!audioEl || speedBtns.length === 0) return;

    speedBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            speedBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            audioEl.playbackRate = parseFloat(btn.getAttribute('data-speed'));
        });
    });
}

// =====================================
// STANDARD CONTROLS (Common)
// =====================================
function setupControls() {
    document.getElementById('btn-back')?.addEventListener('click', () => window.location.href = 'index.html');

    document.getElementById('next-page')?.addEventListener('click', () => {
        if (currentBookMeta?.type === 'pdf') pdfNextPage();
        else if (epubRendition) epubRendition.next();
    });

    document.getElementById('prev-page')?.addEventListener('click', () => {
        if (currentBookMeta?.type === 'pdf') pdfPrevPage();
        else if (epubRendition) epubRendition.prev();
    });

    document.getElementById('dict-save')?.addEventListener('click', async (e) => {
        if (currentWordData) {
            await window.dbAPI.saveWord(
                currentWordData.word, currentWordData.context, currentWordData.definitionData
            );
            e.target.textContent = 'Kaydedildi!';
            e.target.style.background = 'var(--success)';
            setTimeout(() => {
                e.target.textContent = 'Kelime Kartını Kaydet';
                e.target.style.background = '';
                closeDictModal();
            }, 1000);
        }
    });

    document.getElementById('dict-close')?.addEventListener('click', closeDictModal);
}

// =====================================
// PLAN A: PDF JS Logic
// =====================================
function initPDFReader(arrayBuffer) {
    document.getElementById('pdf-canvas').style.display = 'block';
    pdfCanvas = document.getElementById('pdf-canvas');
    pdfCtx = pdfCanvas.getContext('2d');

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    loadingTask.promise.then(function (pdf) {
        pdfDoc = pdf;
        window.dbAPI.getProgress('currentBook').then(prog => {
            if (prog && prog.location) pdfPageNum = parseInt(prog.location);
            renderPDFPage(pdfPageNum);
        });
    }, function (reason) { });

    document.addEventListener("dblclick", () => {
        const selection = window.getSelection();
        if (!selection) return;
        const text = selection.toString().trim();
        if (text && text.length > 0) handleWordSelection(text, "PDF: Tam bağlam okunamadı.");
    });
}

function renderPDFPage(num) {
    pdfDoc.getPage(num).then(function (page) {
        const viewport = page.getViewport({ scale: 1.5 });
        pdfCanvas.height = viewport.height;
        pdfCanvas.width = viewport.width;

        const renderContext = { canvasContext: pdfCtx, viewport: viewport };
        page.render(renderContext);

        window.dbAPI.saveProgress('currentBook', num.toString());
    });
}

function pdfPrevPage() {
    if (pdfPageNum <= 1) return;
    pdfPageNum--;
    renderPDFPage(pdfPageNum);
}
function pdfNextPage() {
    if (pdfPageNum >= pdfDoc.numPages) return;
    pdfPageNum++;
    renderPDFPage(pdfPageNum);
}

// =====================================
// PLAN A: EPUB JS Logic
// =====================================
function initEpubReader(arrayBuffer) {
    document.getElementById('pdf-canvas').style.display = 'none';
    epubBook = ePub(arrayBuffer);

    epubRendition = epubBook.renderTo("epub-render-target", {
        width: "100%", height: "100%", spread: "none"
    });

    window.dbAPI.getProgress('currentBook').then(prog => {
        if (prog && prog.location) epubRendition.display(prog.location);
        else epubRendition.display();
    });

    epubRendition.on("relocated", (location) => {
        window.dbAPI.saveProgress('currentBook', location.start.cfi);
    });

    epubRendition.hooks.content.register((contents, view) => {
        contents.addStylesheetRules([
            ['body', ['background-color: transparent !important', 'color: var(--text-primary) !important', 'font-size: 1.1rem !important']],
            ['p', ['line-height: 1.8 !important', 'margin-bottom: 1.5em !important']]
        ]);

        const doc = contents.document;
        doc.addEventListener("dblclick", (e) => {
            const selection = contents.window.getSelection();
            if (!selection) return;
            const text = selection.toString().trim();
            if (text && text.length > 0) {
                let node = selection.anchorNode;
                let context = "";
                while (node && node.nodeName !== 'P' && node.nodeName !== 'DIV') node = node.parentNode;
                if (node) context = node.textContent.trim().substring(0, 150) + "...";
                handleWordSelection(text, context);
            }
        });
    });
}

// =====================================
// DICTIONARY (V4)
// =====================================
async function handleWordSelection(word, context) {
    word = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
    if (word.length < 2) return;

    currentWordData = { word, context, definitionData: null };
    openDictModal(word);

    const transData = await window.dictionaryAPI.fetchDefinition(word);

    if (transData && !transData.error) {
        currentWordData.definitionData = transData;
        const phoneticEl = document.getElementById('dict-phonetic');
        const defEl = document.getElementById('dict-definition');

        phoneticEl.textContent = transData.phonetic || `[${window.globals.activeContentLang.toUpperCase()}]`;
        defEl.textContent = transData.translation;

        if (transData.match < 0.5) {
            document.getElementById('dict-context').textContent = `(Düşük Güvenilirlik Çevirisi) "${context}"`;
        } else {
            document.getElementById('dict-context').textContent = `"${context}"`;
        }
    } else {
        document.getElementById('dict-definition').textContent = "Çeviri bulunamadı.";
        document.getElementById('dict-phonetic').textContent = "";
        document.getElementById('dict-context').textContent = `"${context}"`;
    }
}

function openDictModal(word) {
    const modal = document.getElementById('dict-modal');
    document.getElementById('dict-word').textContent = word;
    document.getElementById('dict-definition').textContent = "Çevriliyor...";
    document.getElementById('dict-context').textContent = "...";
    document.getElementById('dict-phonetic').textContent = "...";
    modal.classList.remove('hidden');
}

function closeDictModal() {
    document.getElementById('dict-modal').classList.add('hidden');
    currentWordData = null;
    if (window.speechAPI) window.speechAPI.stop();
}
