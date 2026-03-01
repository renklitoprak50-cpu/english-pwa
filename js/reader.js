/**
 * Reader Component Logic V2
 * Handles EPUB and PDF rendering, Cloud bounds, and Premium Checks (TTS + Dict)
 */

let currentBookMeta = null;
let currentWordData = null;

// EPUB state
let epubBook = null;
let epubRendition = null;

// PDF state
let pdfDoc = null;
let pdfPageNum = 1;
let pdfCanvas = null;
let pdfCtx = null;

document.addEventListener('DOMContentLoaded', async () => {
    const viewer = document.getElementById('viewer');
    if (!viewer) return;

    setupControls();

    document.getElementById('dict-play').addEventListener('click', () => {
        if (!window.globals.checkPremiumAction('Text-to-Speech')) {
            showPremiumModal();
            return;
        }
        if (currentWordData && currentWordData.word && window.speechAPI) {
            window.speechAPI.speak(currentWordData.word, 0.9);
        }
    });

    const bookId = localStorage.getItem('activeBookId');
    if (!bookId) {
        alert("No book selected.");
        window.location.href = 'index.html';
        return;
    }

    try {
        const db = await window.dbAPI.initDB();
        const bookData = await db.get('books', bookId);

        if (bookData) {
            currentBookMeta = bookData.meta;
            document.getElementById('book-title').textContent = currentBookMeta.title;

            if (currentBookMeta.type === 'pdf') {
                initPDFReader(bookData.data);
            } else {
                initEpubReader(bookData.data);
            }
        } else {
            alert("Book data not found locally.");
            window.location.href = 'index.html';
        }
    } catch (err) {
        console.error("Error loading book:", err);
    }
});

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
        if (!window.globals.checkPremiumAction('Unlimited Flashcards')) {
            showPremiumModal();
            return;
        }
        if (currentWordData) {
            await window.dbAPI.saveWord(
                currentWordData.word, currentWordData.context, currentWordData.definitionData
            );
            e.target.textContent = 'Saved!';
            e.target.style.background = 'var(--success)';
            setTimeout(() => {
                e.target.textContent = 'Save to Flashcards';
                e.target.style.background = '';
                closeDictModal();
            }, 1000);
        }
    });

    document.getElementById('dict-close')?.addEventListener('click', closeDictModal);
    document.getElementById('premium-close')?.addEventListener('click', () => document.getElementById('premium-modal').classList.add('hidden'));
}

// =====================================
// PDF JS Logic
// =====================================
function initPDFReader(arrayBuffer) {
    document.getElementById('pdf-canvas').style.display = 'block';
    pdfCanvas = document.getElementById('pdf-canvas');
    pdfCtx = pdfCanvas.getContext('2d');

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    loadingTask.promise.then(function (pdf) {
        pdfDoc = pdf;

        // Restore progress
        window.dbAPI.getProgress('currentBook').then(prog => {
            if (prog && prog.location) pdfPageNum = parseInt(prog.location);
            renderPDFPage(pdfPageNum);
        });
    }, function (reason) {
        console.error(reason);
    });

    // Mock PDF click logic (Since PDF.js paints to canvas, actual text selection requires the TextLayerBuilder. 
    // For this lightweight Vanilla PWA, we'll listen for highlights if they select text manually 
    // or simulate a double click if we build a text overlay).
    // For simplicity & performance, we listen to standard window selection.
    document.addEventListener("dblclick", () => {
        const selection = window.getSelection();
        if (!selection) return;
        const text = selection.toString().trim();
        if (text && text.length > 0) {
            handleWordSelection(text, "PDF Context capturing requires full text-layer, extracting selected word.");
        }
    });
}

function renderPDFPage(num) {
    pdfDoc.getPage(num).then(function (page) {
        const viewport = page.getViewport({ scale: 1.5 });
        pdfCanvas.height = viewport.height;
        pdfCanvas.width = viewport.width;

        const renderContext = {
            canvasContext: pdfCtx,
            viewport: viewport
        };
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
// EPUB JS Logic
// =====================================
function initEpubReader(arrayBuffer) {
    document.getElementById('pdf-canvas').style.display = 'none';
    epubBook = ePub(arrayBuffer);

    epubRendition = epubBook.renderTo("viewer", {
        width: "100%", height: "100%", spread: "none"
    });

    // load progress
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
                // extract context
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
// DICTIONARY / SAAS GATING
// =====================================

async function handleWordSelection(word, context) {
    word = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
    if (word.length < 2) return;

    // SaaS PREMIUM CHECK
    if (!window.globals.checkPremiumAction('Smart Dictionary Translation')) {
        showPremiumModal();
        return;
    }

    currentWordData = { word, context, definitionData: null };
    openDictModal(word);

    const defData = await window.dictionaryAPI.fetchDefinition(word);

    if (defData && !defData.error) {
        currentWordData.definitionData = defData;
        const phoneticEl = document.getElementById('dict-phonetic');
        const defEl = document.getElementById('dict-definition');

        let phonetic = defData.phonetic || (defData.phonetics[0] ? defData.phonetics[0].text : '');
        phoneticEl.textContent = phonetic || "(no phonetic available)";

        try { defEl.textContent = defData.meanings[0].definitions[0].definition; }
        catch (e) { defEl.textContent = "Could not parse definition."; }
    } else {
        document.getElementById('dict-definition').textContent = "Word not found in dictionary.";
        document.getElementById('dict-phonetic').textContent = "";
    }

    document.getElementById('dict-context').textContent = `"${context}"`;
}

function openDictModal(word) {
    const modal = document.getElementById('dict-modal');
    document.getElementById('dict-word').textContent = word;
    document.getElementById('dict-definition').textContent = "Loading definition...";
    document.getElementById('dict-context').textContent = "...";
    document.getElementById('dict-phonetic').textContent = "...";
    modal.classList.remove('hidden');
}

function closeDictModal() {
    document.getElementById('dict-modal').classList.add('hidden');
    currentWordData = null;
    if (window.speechAPI) window.speechAPI.stop();
}

function showPremiumModal() {
    document.getElementById('premium-modal').classList.remove('hidden');
}
