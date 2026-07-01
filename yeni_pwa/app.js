// --- STATE ---
let book = null;
let rendition = null;
let currentTextContents = ""; // Bütün sayfanın metni
let ttsUtterance = null;
let isPlayingTTS = false;

// RSVP State
let rsvpWords = [];
let rsvpIndex = 0;
let rsvpTimer = null;
let isRsvpPlaying = false;
let currentWpm = 300;

// --- DOM ELEMENTS ---
const uploadInput = document.getElementById('upload-input');
const viewer = document.getElementById('viewer');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const progressInfo = document.getElementById('progress-info');
const bookTitle = document.getElementById('book-title');
const themeToggle = document.getElementById('theme-toggle');

const btnTts = document.getElementById('btn-tts');
const ttsSpeedInput = document.getElementById('tts-speed');
const ttsSpeedLabel = document.getElementById('tts-speed-label');

const btnRsvp = document.getElementById('btn-rsvp');
const rsvpModal = document.getElementById('rsvp-modal');
const btnRsvpClose = document.getElementById('btn-rsvp-close');
const rsvpDisplay = document.getElementById('rsvp-display');
const rsvpWpmInput = document.getElementById('rsvp-wpm');
const rsvpWpmLabel = document.getElementById('rsvp-wpm-label');
const btnRsvpPlay = document.getElementById('btn-rsvp-play');
const btnRsvpRewind = document.getElementById('btn-rsvp-rewind');
const btnRsvpForward = document.getElementById('btn-rsvp-forward');
const rsvpProgressText = document.getElementById('rsvp-progress-text');

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    // Check Dark Mode
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }

    setupEventListeners();
});

function setupEventListeners() {
    themeToggle.addEventListener('click', () => {
        document.documentElement.classList.toggle('dark');
        if (document.documentElement.classList.contains('dark')) {
            localStorage.theme = 'dark';
            if (rendition) rendition.themes.select('dark');
        } else {
            localStorage.theme = 'light';
            if (rendition) rendition.themes.select('light');
        }
    });

    uploadInput.addEventListener('change', handleFileUpload);

    prevBtn.addEventListener('click', () => { if (rendition) rendition.prev(); });
    nextBtn.addEventListener('click', () => { if (rendition) rendition.next(); });

    // TTS
    btnTts.addEventListener('click', toggleTTS);
    ttsSpeedInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value).toFixed(2);
        ttsSpeedLabel.textContent = `${val}x`;
        if (ttsUtterance && isPlayingTTS) {
            // Can't dynamically change rate in most browsers reliably without restarting
            window.speechSynthesis.cancel();
            playTTS();
        }
    });

    // RSVP
    btnRsvp.addEventListener('click', openRsvpModal);
    btnRsvpClose.addEventListener('click', closeRsvpModal);
    rsvpWpmInput.addEventListener('input', (e) => {
        currentWpm = parseInt(e.target.value);
        rsvpWpmLabel.textContent = `${currentWpm} WPM`;
        if (isRsvpPlaying) {
            pauseRsvp();
            playRsvp(); // Restart with new interval
        }
    });

    btnRsvpPlay.addEventListener('click', () => {
        if (isRsvpPlaying) pauseRsvp();
        else playRsvp();
    });

    btnRsvpRewind.addEventListener('click', () => {
        rsvpIndex = Math.max(0, rsvpIndex - 10);
        updateRsvpDisplay();
    });

    btnRsvpForward.addEventListener('click', () => {
        rsvpIndex = Math.min(rsvpWords.length - 1, rsvpIndex + 10);
        updateRsvpDisplay();
    });
}

// --- EPUB HANDLING ---
function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (window.FileReader) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const buffer = e.target.result;
            loadBook(buffer);
            bookTitle.textContent = file.name.replace(/\.[^/.]+$/, "");
        };
        reader.readAsArrayBuffer(file);
    }
}

function loadBook(bookData) {
    if (book) {
        book.destroy();
        viewer.innerHTML = '';
    }

    book = ePub(bookData);

    rendition = book.renderTo("viewer", {
        width: "100%",
        height: "100%",
        spread: "none",
        manager: "default",
        flow: "paginated"
    });

    rendition.themes.register("light", {
        "body": { "background": "transparent", "color": "#0f172a", "font-family": "ui-sans-serif, system-ui, sans-serif", "padding": "0 4%", "line-height": "1.6" }
    });
    rendition.themes.register("dark", {
        "body": { "background": "transparent", "color": "#f8fafc", "font-family": "ui-sans-serif, system-ui, sans-serif", "padding": "0 4%", "line-height": "1.6" }
    });

    const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    rendition.themes.select(currentTheme);
    rendition.themes.fontSize("110%");

    rendition.display();

    book.ready.then(() => {
        return book.locations.generate(1600);
    }).then(() => {
        updateProgress();
    });

    rendition.on("relocated", (location) => {
        updateProgress(location);
        extractCurrentText();

        // Stop TTS/RSVP on page turn
        if (isPlayingTTS) {
            window.speechSynthesis.cancel();
            isPlayingTTS = false;
            btnTts.innerHTML = '<i class="fa-solid fa-volume-high"></i> Dinle';
            btnTts.classList.replace('bg-red-500', 'bg-green-600');
            btnTts.classList.replace('hover:bg-red-600', 'hover:bg-green-700');
        }
    });
}

function updateProgress(location) {
    if (!book || !book.locations || book.locations.length() === 0) return;

    if (location) {
        const percentage = Math.round(book.locations.percentageFromCfi(location.start.cfi) * 100);
        progressInfo.textContent = `%${percentage}`;
    }
}

// A helper to grab all text from current rendered view
async function extractCurrentText() {
    currentTextContents = "";
    if (!rendition) return;

    try {
        // ePub.js getContents returns array of iframes/views
        const contentsList = rendition.getContents();
        if (contentsList && contentsList.length > 0) {
            const doc = contentsList[0].document;
            if (doc && doc.body) {
                currentTextContents = doc.body.innerText || doc.body.textContent || '';
            }
        }
    } catch (e) {
        console.error("Text extraction failed", e);
    }
}


// --- TTS (DINLEME) ---
function toggleTTS() {
    if (!currentTextContents.trim()) {
        alert("Okunacak metin bulunamadı.");
        return;
    }

    if (isPlayingTTS) {
        window.speechSynthesis.cancel();
        isPlayingTTS = false;
        btnTts.innerHTML = '<i class="fa-solid fa-volume-high"></i> Dinle';
        btnTts.classList.replace('bg-red-500', 'bg-green-600');
        btnTts.classList.replace('hover:bg-red-600', 'hover:bg-green-700');
    } else {
        playTTS();
    }
}

function playTTS() {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel(); // Clear queue

    // Clean text a bit
    const textToSpeak = currentTextContents.replace(/\s+/g, ' ').trim();
    if (!textToSpeak) return;

    ttsUtterance = new SpeechSynthesisUtterance(textToSpeak);
    // Try to set language to Turkish by default if we don't know it, but let browser auto-detect if possible
    // Note: Better to just use default or 'tr-TR'
    ttsUtterance.lang = 'tr-TR';
    ttsUtterance.rate = parseFloat(ttsSpeedInput.value);

    ttsUtterance.onstart = () => {
        isPlayingTTS = true;
        btnTts.innerHTML = '<i class="fa-solid fa-stop"></i> Durdur';
        btnTts.classList.replace('bg-green-600', 'bg-red-500');
        btnTts.classList.replace('hover:bg-green-700', 'hover:bg-red-600');
    };

    ttsUtterance.onend = () => {
        isPlayingTTS = false;
        btnTts.innerHTML = '<i class="fa-solid fa-volume-high"></i> Dinle';
        btnTts.classList.replace('bg-red-500', 'bg-green-600');
        btnTts.classList.replace('hover:bg-red-600', 'hover:bg-green-700');
    };

    ttsUtterance.onerror = (e) => {
        console.warn("TTS Error", e);
        isPlayingTTS = false;
        btnTts.innerHTML = '<i class="fa-solid fa-volume-high"></i> Dinle';
        btnTts.classList.replace('bg-red-500', 'bg-green-600');
        btnTts.classList.replace('hover:bg-red-600', 'hover:bg-green-700');
    };

    window.speechSynthesis.speak(ttsUtterance);
}

// --- RSVP (HIZLI OKUMA) ---
function openRsvpModal() {
    if (!currentTextContents.trim()) {
        alert("Okunacak metin bulunamadı.");
        return;
    }

    // Stop TTS if playing
    if (isPlayingTTS) {
        window.speechSynthesis.cancel();
        isPlayingTTS = false;
        btnTts.innerHTML = '<i class="fa-solid fa-volume-high"></i> Dinle';
        btnTts.classList.replace('bg-red-500', 'bg-green-600');
        btnTts.classList.replace('hover:bg-red-600', 'hover:bg-green-700');
    }

    // Prepare Words
    const rawText = currentTextContents.replace(/\s+/g, ' ').trim();
    // Regex matches words and attached punctuation
    rsvpWords = rawText.match(/[\wğüşöçIİı]+[.,!?;:]*|[\S]+/gi) || [];

    if (rsvpWords.length === 0) {
        alert("Geçerli kelime bulunamadı.");
        return;
    }

    rsvpIndex = 0;
    rsvpModal.classList.remove('hidden');
    rsvpModal.classList.add('flex');
    document.body.style.overflow = 'hidden'; // prevent bg scroll

    updateRsvpDisplay();
}

function closeRsvpModal() {
    pauseRsvp();
    rsvpModal.classList.add('hidden');
    rsvpModal.classList.remove('flex');
    document.body.style.overflow = '';
}

function updateRsvpDisplay() {
    if (rsvpIndex >= rsvpWords.length) {
        pauseRsvp();
        rsvpDisplay.innerHTML = "<em>Bölüm Sonu</em>";
        rsvpProgressText.textContent = `Kalan: 0 kelime`;
        return;
    }

    const word = rsvpWords[rsvpIndex];

    // Calculate ORP (Optimal Recognition Point)
    // Roughly 35% of the word length
    let focusIndex = Math.floor((word.length - 1) * 0.35);
    if (focusIndex < 0) focusIndex = 0;

    const pre = word.substring(0, focusIndex);
    const focus = word.substring(focusIndex, focusIndex + 1);
    const post = word.substring(focusIndex + 1);

    rsvpDisplay.innerHTML = `<span>${pre}</span><span class="rsvp-focus">${focus}</span><span>${post}</span>`;

    const remaining = rsvpWords.length - rsvpIndex;
    rsvpProgressText.textContent = `Kalan: ${remaining} kelime`;
}

function playRsvp() {
    if (rsvpIndex >= rsvpWords.length) {
        rsvpIndex = 0; // reset if at end
    }

    isRsvpPlaying = true;
    btnRsvpPlay.innerHTML = '<i class="fa-solid fa-pause ml-0"></i>';

    const intervalMs = 60000 / currentWpm;

    rsvpTimer = setTimeout(function tick() {
        updateRsvpDisplay();

        // Add slight pause for punctuation
        let delay = intervalMs;
        const currentWord = rsvpWords[rsvpIndex];
        if (currentWord) {
            if (currentWord.endsWith('.') || currentWord.endsWith('!') || currentWord.endsWith('?')) {
                delay *= 2; // Double delay on sentence end
            } else if (currentWord.endsWith(',') || currentWord.endsWith(';')) {
                delay *= 1.5; // 1.5x delay on comma
            }
        }

        rsvpIndex++;

        if (rsvpIndex < rsvpWords.length && isRsvpPlaying) {
            rsvpTimer = setTimeout(tick, delay);
        } else {
            if (rsvpIndex >= rsvpWords.length) updateRsvpDisplay(); // Show end state
        }
    }, intervalMs);
}

function pauseRsvp() {
    isRsvpPlaying = false;
    clearTimeout(rsvpTimer);
    btnRsvpPlay.innerHTML = '<i class="fa-solid fa-play ml-1"></i>';
}
