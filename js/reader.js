/**
 * Reader Component Logic
 * Responsible for loading EPUB, rendering it, and handling word clicks for Dictionary lookup.
 */

let book = null;
let rendition = null;
let currentWordData = null; // Store current word context

document.addEventListener('DOMContentLoaded', async () => {
    const viewer = document.getElementById('viewer');
    if (!viewer) return; // Not on reader page

    // Setup UI Controls
    setupControls();

    // Setup Modal Audio
    document.getElementById('dict-play').addEventListener('click', () => {
        if (currentWordData && currentWordData.word && window.speechAPI) {
            window.speechAPI.speak(currentWordData.word, 0.9);
        }
    });

    // Retrieve file from temporary IDB
    try {
        const tempDb = await idb.openDB('bookStore', 1);
        const arrayBuffer = await tempDb.get('files', 'currentBook');

        if (arrayBuffer) {
            initReader(arrayBuffer);
        } else {
            // Fallback: If no book found, go back
            alert("No EPUB file loaded.");
            window.location.href = 'index.html';
        }
    } catch (err) {
        console.error("Error loading book:", err);
    }
});

function setupControls() {
    const nextBtn = document.getElementById('next-page');
    const prevBtn = document.getElementById('prev-page');
    const backBtn = document.getElementById('btn-back');

    if (backBtn) backBtn.addEventListener('click', () => window.location.href = 'index.html');

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (rendition) rendition.next();
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (rendition) rendition.prev();
        });
    }

    // Handle Save Word
    const saveBtn = document.getElementById('dict-save');
    saveBtn.addEventListener('click', async () => {
        if (currentWordData) {
            await window.dbAPI.saveWord(
                currentWordData.word,
                currentWordData.context,
                currentWordData.definitionData
            );

            // Show feedback
            const origText = saveBtn.textContent;
            saveBtn.textContent = 'Saved!';
            saveBtn.style.background = 'var(--success)';
            setTimeout(() => {
                saveBtn.textContent = origText;
                saveBtn.style.background = '';
                closeDictModal();
            }, 1000);
        }
    });

    // Handle Modal Close
    const closeBtn = document.getElementById('dict-close');
    closeBtn.addEventListener('click', closeDictModal);

    // Close modal on outside click
    document.getElementById('dict-modal').addEventListener('click', (e) => {
        if (e.target.id === 'dict-modal') {
            closeDictModal();
        }
    });
}

function initReader(arrayBuffer) {
    // ePub.js needs an ArrayBuffer when passed directly
    book = ePub(arrayBuffer);

    rendition = book.renderTo("viewer", {
        width: "100%",
        height: "100%",
        spread: "none",
        manager: "continuous",
        flow: "paginated",
        // Force styling inside iframe
        stylesheet: window.location.origin + "/css/main.css"
    });

    rendition.display();

    // Hook book metadata
    book.loaded.metadata.then((meta) => {
        document.getElementById('book-title').textContent = meta.title || "Unknown Title";
    });

    // Handle Page Turning Progress and Caching Location
    rendition.on("relocated", (location) => {
        // ePub.js doesn't provide perfect % easily out of the box without generating locations first.
        // For a seamless experience, we just track CFI
        window.dbAPI.saveProgress('currentBook', location.start.cfi);

        // Hide/Show controls
        document.getElementById('prev-page').style.opacity = location.atStart ? '0.1' : '1';
        document.getElementById('next-page').style.opacity = location.atEnd ? '0.1' : '1';
    });

    /**
     * SMART CARD SYSTEM - Intercepting Interactions
     * When rendition loads a section (view), hook into its contents
     */
    rendition.hooks.content.register((contents, view) => {
        // Apply custom styles directly into the iframe payload
        contents.addStylesheetRules([
            ['body', ['background-color: transparent !important', 'color: var(--text-primary) !important', 'font-size: 1.1rem !important']],
            ['p', ['line-height: 1.8 !important', 'margin-bottom: 1.5em !important']],
            ['::selection', ['background: var(--accent-glow) !important']]
        ]);

        // Add Click listener for words
        const doc = contents.document;
        doc.addEventListener("click", async (e) => {
            const selection = contents.window.getSelection();
            if (!selection || selection.rangeCount === 0) return;

            const text = selection.toString().trim();
            if (text && text.length > 0 && !text.includes(' ')) {
                // If user highlighted a single word
                handleWordSelection(text, getContextSentence(selection.anchorNode));
            } else if (e.target && e.target.nodeType === 1) {
                // If user clicked normally, try to snap to word (Requires advanced range manipulation, 
                // simpler approach is to rely on user highlighting a word specifically).
                // Let's implement double click instead for easier UX
            }
        });

        doc.addEventListener("dblclick", (e) => {
            const selection = contents.window.getSelection();
            if (!selection) return;
            const text = selection.toString().trim();
            if (text && text.length > 0) {
                handleWordSelection(text, getContextSentence(selection.anchorNode));
            }
        });
    });
}

function getContextSentence(node) {
    if (!node) return "";
    let n = node;
    // Go up until we find a paragraph or a block element
    while (n && n.nodeName !== 'P' && n.nodeName !== 'DIV' && n.nodeName !== 'BODY') {
        n = n.parentNode;
    }
    return n ? n.textContent.trim().substring(0, 150) + "..." : "";
}

async function handleWordSelection(word, context) {
    word = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
    if (word.length < 2) return;

    currentWordData = { word, context, definitionData: null };

    // Automatically speak the word (Shadowing mode feature)
    if (window.speechAPI) window.speechAPI.speak(word);

    // Show modal loading state
    openDictModal(word);

    const defData = await window.dictionaryAPI.fetchDefinition(word);

    if (defData && !defData.error) {
        currentWordData.definitionData = defData;

        // Update Modal
        const phoneticEl = document.getElementById('dict-phonetic');
        const defEl = document.getElementById('dict-definition');

        // Try getting phonetic
        let phonetic = "";
        if (defData.phonetic) phonetic = defData.phonetic;
        else if (defData.phonetics && defData.phonetics.length > 0) {
            const found = defData.phonetics.find(p => p.text);
            phonetic = found ? found.text : "";
        }
        phoneticEl.textContent = phonetic ? phonetic : "(no phonetic available)";

        // Try getting meaning
        try {
            const meaning = defData.meanings[0].definitions[0].definition;
            defEl.textContent = meaning;
        } catch (e) {
            defEl.textContent = "Could not parse definition structure.";
        }
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
