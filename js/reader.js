/**
 * Reader Component Logic V4 (Anti-Limited Preview Fix)
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
    try {
        setupControls();
        setupAudioPlayer();

        const dictPlayBtn = document.getElementById('dict-play');
        if (dictPlayBtn) {
            dictPlayBtn.addEventListener('click', () => {
                if (currentWordData && currentWordData.word && window.speechAPI) {
                    window.speechAPI.speak(currentWordData.word, 0.9);
                }
            });
        }

        const bookId = localStorage.getItem('activeBookId');
        if (!bookId) {
            alert("Lütfen kütüphaneden bir kitap seçin.");
            window.location.href = 'index.html';
            return;
        }

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

            } else if (currentBookMeta.format_url || currentBookMeta.ia_id) {
                initNativeReader(currentBookMeta);
            } else if (currentBookMeta.audio_url) {
                document.getElementById('error-viewer').classList.remove('hidden');
                document.getElementById('error-title').textContent = "🎧 Sadece Sesli Kitap";
                document.getElementById('error-desc').textContent = "Dinlemek için aşağıdaki oynatıcıyı kullanın.";
            } else {
                showFinalError();
            }
        } else {
            alert("Kitap verisi bulunamadı.");
            window.location.href = 'index.html';
        }
    } catch (err) {
        console.error("CRITICAL READER BOOT ERROR:", err);
        const fallbackBar = document.getElementById('embed-fallback-bar');
        if (fallbackBar) {
            fallbackBar.classList.remove('hidden');
            fallbackBar.style.background = 'var(--error)';
            const text = document.getElementById('fallback-text');
            if (text) text.textContent = "Kitap yüklenirken kritik bir hata oluştu: " + err.message;
        }
    }
});

function showFinalError() {
    document.getElementById('error-viewer').classList.remove('hidden');
    document.getElementById('error-title').textContent = "📖 Kitap Önizlemeye Kapalı";
    document.getElementById('error-desc').textContent = "Bu kitap telif hakları nedeniyle kapalı, lütfen listenizdeki diğer (Açık kaynaklı) kitapları deneyin.";
}

// =====================================
// NATIVE READER & SONIC TTS (V8 True EPUB)
// =====================================
let ttsUtterance = null;
let ttsSpans = [];
let currentSpanIndex = 0;
let isPlaying = false;

async function initNativeReader(meta) {
    const fallbackBar = document.getElementById('embed-fallback-bar');
    const textLayer = document.getElementById('text-viewer-layer');
    const textTarget = document.getElementById('text-render-target');
    const fallbackText = document.getElementById('fallback-text');
    const ttsController = document.getElementById('tts-controller');

    document.getElementById('local-viewer-layer').classList.add('hidden');
    document.getElementById('book-progress').classList.add('hidden');

    const baseBookId = meta.id || meta.ia_id;
    const activeBookId = localStorage.getItem('activeBookId') || baseBookId;
    const cacheKey = activeBookId.startsWith('off_') ? activeBookId : baseBookId;

    // V10: Strict IndexedDB (Mühürlü) Data Priority. No More Direct Internet Downloads.
    // All downloading is now exclusively handled by app.js (Hemen İndir ve Oku) via api/proxy

    // 1. Check For EPUB Buffer
    if (meta.epub_url) {
        fallbackBar.classList.remove('hidden');
        if (fallbackText) fallbackText.textContent = "Yerel Okuyucu Yükleniyor (EPUB)...";
        fallbackBar.style.background = 'var(--accent-primary)';
        fallbackBar.style.color = '#fff';
        if (textLayer) textLayer.classList.add('hidden');

        try {
            const cachedEpub = await window.dbAPI.getBookContent(cacheKey + "_epub");
            if (cachedEpub) {
                fallbackBar.classList.add('hidden');
                initEpubReader(cachedEpub);
                return;
            } else {
                // If it reaches here, the book wasn't properly downloaded by app.js
                throw new Error("EPUB Verisi Yerel Veritabanında Bulunamadı (Not Sealed properly).");
            }
        } catch (e) {
            console.error("CRITICAL: EPUB Local Load failed.", e);
            alert("Kitap yerel bellekte bulunamadı. Lütfen kütüphaneden tekrar indiriniz.");
            window.location.href = 'index.html';
            return;
        }
    }

    // 2. Check Local DB for Text
    const cachedText = await window.dbAPI.getBookContent(cacheKey);
    if (cachedText) {
        renderNativeText(cachedText, textLayer, textTarget, ttsController);
        return;
    }

    // 3. Absolute Fallback: If no local data exists at all
    fallbackBar.classList.remove('hidden');
    if (fallbackText) fallbackText.textContent = "Veri Mühürlenmemiş!";
    fallbackBar.style.background = 'var(--error)';
    fallbackBar.style.color = '#fff';

    alert("Hata: Kitap yerel veritabanında (Mühürlü) değil. Lütfen vitrine dönüp 'Hemen İndir ve Oku' butonunu kullanın.");
    setTimeout(() => { window.location.href = 'index.html'; }, 2000);
}

function renderNativeText(text, layer, target, ttsController) {
    if (!layer || !target) return;
    layer.classList.remove('hidden');
    if (ttsController) ttsController.classList.remove('hidden');

    // Split text into sentences/chunks for TTS and span wrapping
    // We match sentences ending with . ! ? followed by space or newline
    const chunks = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];

    target.innerHTML = '';
    ttsSpans = [];
    currentSpanIndex = 0;

    chunks.forEach((chunk, index) => {
        const span = document.createElement('span');
        span.textContent = chunk;
        span.className = 'tts-chunk cursor-pointer';
        span.dataset.index = index;

        // Inline Microphone Button for Shadowing per sentence
        const wrapper = document.createElement('span');
        wrapper.className = 'sentence-wrapper';
        wrapper.style.position = 'relative';
        wrapper.style.display = 'inline';

        const micBtn = document.createElement('button');
        micBtn.innerHTML = '🎙️';
        micBtn.style.fontSize = '0.9rem';
        micBtn.style.background = 'transparent';
        micBtn.style.border = 'none';
        micBtn.style.cursor = 'pointer';
        micBtn.style.marginLeft = '4px';
        micBtn.style.opacity = '0.6';
        micBtn.title = 'Shadowing Test';

        // V8 Apple Books Style: Select to Translate
        span.addEventListener('pointerup', (e) => {
            const selection = window.getSelection();
            const word = selection.toString().trim();
            if (word && word.length > 0) {
                handleWordSelection(word, chunk.trim());
                e.stopPropagation();
            }
        });

        micBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startSentenceShadowing(chunk.trim(), micBtn);
        });

        wrapper.appendChild(span);
        wrapper.appendChild(micBtn);
        target.appendChild(wrapper);
        ttsSpans.push(span);
    });

    setupSonicTTS(target);
    setupRSVPMode();

    // V8 Elite Pagination init
    // FIX: Wait for the actual web fonts (Merriweather/Lora) to finish loading
    // before measuring column widths. A blind setTimeout(150) races against
    // font loading: text first renders with a fallback font, scrollWidth gets
    // measured against that, then the real font swaps in and reflows the
    // text into a different number of columns -- which desyncs
    // currentColumnIndex from what's actually on screen and breaks page
    // turning/swiping. document.fonts.ready resolves only once web fonts are
    // truly ready, so pagination is computed against the final layout.
    let paginationAlreadyInitialized = false;
    const initPaginationWhenReady = () => {
        if (paginationAlreadyInitialized) return;
        paginationAlreadyInitialized = true;
        // Double rAF ensures the browser has painted the final layout too,
        // not just resolved the fonts promise.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                initPaginationControls();
                window.dbAPI.getProgress('currentBook').then(prog => {
                    if (prog && prog.location) {
                        currentColumnIndex = parseInt(prog.location) || 0;
                        updatePagination();
                    }
                });
            });
        });
    };

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(initPaginationWhenReady);
        // Safety net: if fonts.ready hangs for any reason, don't leave the
        // reader stuck with no pagination at all.
        setTimeout(initPaginationWhenReady, 1200);
    } else {
        setTimeout(initPaginationWhenReady, 150);
    }
}

// =====================================
// SHADOWING API LOGIC
// =====================================
function startSentenceShadowing(targetText, micBtn) {
    if (!targetText) return;

    if (window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
    }

    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
        alert("Tarayıcınız ses tanıma (SpeechRecognition) özelliğini desteklemiyor.");
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;

    if (currentBookMeta && currentBookMeta.langMap && currentBookMeta.langMap.speech) {
        recognition.lang = currentBookMeta.langMap.speech;
    } else {
        recognition.lang = window.globals.getActiveLanguageMap().speech;
    }

    micBtn.innerHTML = '🔴';
    micBtn.style.opacity = '1';

    recognition.start();

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.toLowerCase();
        const targetLower = targetText.toLowerCase().replace(/[.,!?;:]/g, '');

        const words1 = transcript.split(' ');
        const words2 = targetLower.split(' ');
        let matches = 0;
        words1.forEach(w => { if (words2.includes(w)) matches++; });

        const score = Math.round((matches / Math.max(1, words2.length)) * 100);
        const finalScore = Math.min(100, score);

        let color = finalScore > 70 ? 'var(--success)' : 'var(--warning)';
        micBtn.innerHTML = `<span style="font-size:0.75rem; color:${color}; font-weight:bold;">%${finalScore}</span>`;

        // 1. Local RPG Integration
        if (window.GameEngine) {
            window.GameEngine.addXP(Math.round(finalScore / 10));
        }

        // 2. Supabase Integration (Zorunlu Bağlantı)
        if (window.supabaseSync && window.supabaseSync.saveShadowScore) {
            window.supabaseSync.saveShadowScore(targetText, transcript, finalScore);
        } else {
            // Fallback mock if Supabase script isn't loaded yet
            console.log(`[Supabase Mühür] Score: ${finalScore}% | Target: "${targetText}" | Spoken: "${transcript}"`);
        }

        setTimeout(() => {
            micBtn.innerHTML = '🎙️';
            micBtn.style.opacity = '0.6';
        }, 5000);
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        micBtn.innerHTML = '🎙️';
        micBtn.style.opacity = '0.6';
    };
}

// =====================================
// V8 ELITE NATIVE PAGINATION
// =====================================
let currentColumnIndex = 0;
let totalColumns = 1;

// FIX: Figure out which paginated "page" (CSS column) a given span sits in.
// getBoundingClientRect() reflects the *visual* position (after the
// translateX transform that pages use), so we add back the current page's
// offset to recover the span's true position in the text flow, then divide
// by the page width to get its column index. This is what lets TTS know
// which page a sentence belongs to, so it can keep the visible page in sync
// with what's being read instead of reading from one page while a
// different page is shown on screen.
function getSpanColumn(span) {
    if (!span) return currentColumnIndex;
    const rect = span.getBoundingClientRect();
    const trueLeft = rect.left + (currentColumnIndex * window.innerWidth);
    return Math.max(0, Math.round(trueLeft / window.innerWidth));
}

function updatePagination() {
    const target = document.getElementById('text-render-target');
    if (!target) return;

    totalColumns = Math.ceil(target.scrollWidth / window.innerWidth);
    if (currentColumnIndex >= totalColumns - 1) {
        currentColumnIndex = Math.max(0, totalColumns - 1);
        if (window.BossFight && (!window.BossFight.isDefeated)) {
            window.BossFight.initFight();
        }
    }
    if (currentColumnIndex < 0) currentColumnIndex = 0;

    target.style.transform = `translateX(-${currentColumnIndex * 100}vw)`;
    window.dbAPI.saveProgress('currentBook', currentColumnIndex.toString());
}

function initPaginationControls() {
    const target = document.getElementById('text-render-target');
    const layer = document.getElementById('text-scroll-area');
    if (!target || !layer) return;

    totalColumns = Math.ceil(target.scrollWidth / window.innerWidth);
    currentColumnIndex = 0;

    // Tap Zones & Menu Toggle
    layer.onclick = (e) => {
        if (window.getSelection().toString().trim().length > 0) return; // Wait if selecting text

        const x = e.clientX;
        const width = window.innerWidth;

        if (x < width * 0.25) {
            // Left Zone: Prev Page
            if (currentColumnIndex > 0) {
                currentColumnIndex--;
                updatePagination();
            }
        } else if (x > width * 0.75) {
            // Right Zone: Next Page
            if (currentColumnIndex < totalColumns - 1) {
                currentColumnIndex++;
                updatePagination();
            }
        } else {
            // Center Zone: Toggle Menu
            document.querySelectorAll('.floating-ui').forEach(ui => {
                ui.classList.toggle('active');
            });
        }
    };

    // Recalibrate columns on resize
    window.addEventListener('resize', () => {
        setTimeout(updatePagination, 50);
    });

    // Also support smooth horizontal swipes for pages
    let touchStartX = 0;
    layer.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
    layer.addEventListener('touchend', e => {
        const touchEndX = e.changedTouches[0].screenX;
        if (touchEndX < touchStartX - 50 && currentColumnIndex < totalColumns - 1) {
            currentColumnIndex++; updatePagination();
        } else if (touchEndX > touchStartX + 50 && currentColumnIndex > 0) {
            currentColumnIndex--; updatePagination();
        }
    }, { passive: true });
}

// =====================================
// RSVP SPEED-READING MODE
// (separate feature from TTS -- flashes one word at a time; fully
// configurable speed/color/size, persisted in localStorage)
// =====================================
let rsvpInitialized = false;
let rsvpWords = [];
let rsvpIndex = 0;
let rsvpTimer = null;
let rsvpPlaying = false;

function getRSVPWordsSource() {
    // Native/plain-text paginated reader: start from whatever sentence is
    // currently on screen (same page-sync idea as the TTS fix above) so
    // speed-reading picks up where you already are, not always page 1.
    if (typeof ttsSpans !== 'undefined' && ttsSpans.length > 0) {
        let startIdx = 0;
        if (typeof currentColumnIndex !== 'undefined' && typeof getSpanColumn === 'function') {
            const found = ttsSpans.findIndex(s => getSpanColumn(s) === currentColumnIndex);
            if (found !== -1) startIdx = found;
        }
        return ttsSpans.slice(startIdx).map(s => s.textContent).join(' ');
    }
    // EPUB: pull the visible page's text directly from the rendition.
    if (window.epubRendition) {
        try {
            const contents = window.epubRendition.getContents();
            if (contents && contents[0] && contents[0].document && contents[0].document.body) {
                return contents[0].document.body.innerText || contents[0].document.body.textContent || '';
            }
        } catch (e) { /* ignore, fall through to empty */ }
    }
    return '';
}

function rsvpShowWord() {
    const displayEl = document.getElementById('rsvp-word-display');
    const fillEl = document.getElementById('rsvp-progress-fill');
    if (!displayEl) return;
    if (rsvpIndex >= rsvpWords.length) {
        rsvpPause();
        displayEl.textContent = '✓ Bitti';
        return;
    }
    displayEl.textContent = rsvpWords[rsvpIndex];
    if (fillEl) {
        const pct = Math.round((rsvpIndex / Math.max(1, rsvpWords.length - 1)) * 100);
        fillEl.style.width = `${pct}%`;
    }
}

function rsvpScheduleNext() {
    const wpm = parseInt(localStorage.getItem('rsvpWpm') || '300', 10);
    const word = rsvpWords[rsvpIndex] || '';
    const baseDelay = 60000 / Math.max(50, wpm);
    // A slightly longer pause at sentence/clause boundaries reads more
    // naturally than a perfectly constant word rate.
    const extra = /[.!?]$/.test(word) ? baseDelay * 0.9 : /[,;:]$/.test(word) ? baseDelay * 0.4 : 0;
    rsvpTimer = setTimeout(() => {
        rsvpIndex++;
        rsvpShowWord();
        if (rsvpPlaying) rsvpScheduleNext();
    }, baseDelay + extra);
}

function rsvpPlay() {
    if (rsvpWords.length === 0) return;
    if (rsvpIndex >= rsvpWords.length) rsvpIndex = 0;
    rsvpPlaying = true;
    const btn = document.getElementById('rsvp-play-pause-btn');
    if (btn) btn.textContent = '⏸️';
    rsvpScheduleNext();
}

function rsvpPause() {
    rsvpPlaying = false;
    if (rsvpTimer) clearTimeout(rsvpTimer);
    const btn = document.getElementById('rsvp-play-pause-btn');
    if (btn) btn.textContent = '▶️';
}

function applyRSVPSettings() {
    const wpm = localStorage.getItem('rsvpWpm') || '300';
    const size = localStorage.getItem('rsvpSize') || '3rem';
    const color = localStorage.getItem('rsvpColor') || '#3B82F6';
    document.documentElement.style.setProperty('--rsvp-size', size);
    document.documentElement.style.setProperty('--rsvp-color', color);

    const slider = document.getElementById('rsvp-wpm-slider');
    const wpmValueEl = document.getElementById('rsvp-wpm-value');
    if (slider) slider.value = wpm;
    if (wpmValueEl) wpmValueEl.textContent = wpm;

    document.querySelectorAll('.rsvp-size-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-size') === size);
    });
    document.querySelectorAll('.rsvp-color-swatch').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-color') === color);
    });
}

function setupRSVPMode() {
    if (rsvpInitialized) return;
    const toggleBtn = document.getElementById('rsvp-toggle-btn');
    const overlay = document.getElementById('rsvp-overlay');
    if (!toggleBtn || !overlay) return; // markup not in DOM yet, try again later
    rsvpInitialized = true;

    const closeBtn = document.getElementById('rsvp-close-btn');
    const settingsBtn = document.getElementById('rsvp-settings-btn');
    const settingsPanel = document.getElementById('rsvp-settings-panel');
    const playPauseBtn = document.getElementById('rsvp-play-pause-btn');
    const prevBtn = document.getElementById('rsvp-prev-btn');
    const nextBtn = document.getElementById('rsvp-next-btn');
    const wpmSlider = document.getElementById('rsvp-wpm-slider');

    applyRSVPSettings();

    toggleBtn.addEventListener('click', () => {
        // RSVP and TTS are separate features but shouldn't talk over each
        // other -- stop any speech before opening speed-reading mode.
        if (window.speechSynthesis) window.speechSynthesis.cancel();

        const sourceText = getRSVPWordsSource();
        rsvpWords = sourceText.split(/\s+/).filter(w => w.length > 0);
        rsvpIndex = 0;
        overlay.classList.remove('hidden');
        if (rsvpWords.length === 0) {
            document.getElementById('rsvp-word-display').textContent = 'Metin bulunamadı';
        } else {
            rsvpShowWord();
        }
    });

    if (closeBtn) closeBtn.addEventListener('click', () => {
        rsvpPause();
        overlay.classList.add('hidden');
        if (settingsPanel) settingsPanel.classList.add('hidden');
    });

    if (settingsBtn) settingsBtn.addEventListener('click', () => {
        if (settingsPanel) settingsPanel.classList.toggle('hidden');
    });

    if (playPauseBtn) playPauseBtn.addEventListener('click', () => {
        if (rsvpPlaying) rsvpPause(); else rsvpPlay();
    });

    if (prevBtn) prevBtn.addEventListener('click', () => {
        rsvpPause();
        rsvpIndex = Math.max(0, rsvpIndex - 10);
        rsvpShowWord();
    });

    if (nextBtn) nextBtn.addEventListener('click', () => {
        rsvpPause();
        rsvpIndex = Math.min(Math.max(0, rsvpWords.length - 1), rsvpIndex + 10);
        rsvpShowWord();
    });

    if (wpmSlider) wpmSlider.addEventListener('input', () => {
        localStorage.setItem('rsvpWpm', wpmSlider.value);
        const wpmValueEl = document.getElementById('rsvp-wpm-value');
        if (wpmValueEl) wpmValueEl.textContent = wpmSlider.value;
    });

    document.querySelectorAll('.rsvp-size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            localStorage.setItem('rsvpSize', btn.getAttribute('data-size'));
            applyRSVPSettings();
        });
    });

    document.querySelectorAll('.rsvp-color-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
            localStorage.setItem('rsvpColor', btn.getAttribute('data-color'));
            applyRSVPSettings();
        });
    });
}

// The RSVP toggle button lives in static HTML (not re-rendered per
// chapter/page), so it only needs to be wired up once. setupRSVPMode()
// itself is guarded against double-init.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupRSVPMode);
} else {
    setupRSVPMode();
}

function setupSonicTTS(container) {
    const playBtn = document.getElementById('tts-play');
    const stopBtn = document.getElementById('tts-stop');
    const nextBtn = document.getElementById('tts-next');
    const prevBtn = document.getElementById('tts-prev');

    // FIX: incremented on every speakCurrent() call so a delayed/stale
    // speak() (see setTimeout below) can detect it's no longer the latest
    // request and bail out instead of stepping on a newer one.
    let speakToken = 0;

    if (!window.speechSynthesis) {
        if (playBtn) playBtn.style.display = 'none';
        return;
    }

    const resetPlayBtn = () => {
        isPlaying = false;
        if (playBtn) {
            playBtn.textContent = '▶️';
            playBtn.classList.remove('active-play');
        }
    };

    const setPlayBtnActive = () => {
        isPlaying = true;
        if (playBtn) {
            playBtn.textContent = '⏸';
            playBtn.classList.add('active-play');
        }
    };

    const highlightSpan = (index) => {
        ttsSpans.forEach(s => s.classList.remove('tts-highlight'));
        const span = ttsSpans[index];
        if (!span) return;
        span.classList.add('tts-highlight');

        // FIX: scrollIntoView does nothing useful here because pages are
        // turned with a CSS transform inside an overflow:hidden container,
        // not with real scrolling. That's why TTS used to keep talking
        // while the screen sat on a totally different page ("sayfa atlıyor,
        // başka yerden okuyor"). Instead, work out which page this sentence
        // actually lives on and flip to that page if we're not already
        // there, so what's on screen always matches what's being read.
        const spanColumn = getSpanColumn(span);
        if (spanColumn !== currentColumnIndex && spanColumn < totalColumns) {
            currentColumnIndex = spanColumn;
            updatePagination();
        }
    };

    // V8 Media Session API Integration for Shadowing
    const updateMediaSession = () => {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: currentBookMeta ? currentBookMeta.title : 'LingoBooks',
                artist: 'Sonic Reader (TTS)',
                album: 'Shadowing Mode',
                artwork: [
                    { src: 'assets/icon-192.png', sizes: '192x192', type: 'image/png' }
                ]
            });

            navigator.mediaSession.setActionHandler('play', () => {
                if (window.speechSynthesis.paused) {
                    window.speechSynthesis.resume();
                    setPlayBtnActive();
                } else if (!isPlaying) {
                    syncSpanToCurrentPage();
                    speakCurrent();
                }
                updateMediaSession();
            });

            navigator.mediaSession.setActionHandler('pause', () => {
                window.speechSynthesis.pause();
                resetPlayBtn();
                updateMediaSession();
            });

            navigator.mediaSession.setActionHandler('previoustrack', () => {
                if (currentSpanIndex > 0) {
                    currentSpanIndex--;
                    if (isPlaying) speakCurrent();
                    else highlightSpan(currentSpanIndex);
                }
            });

            navigator.mediaSession.setActionHandler('nexttrack', () => {
                if (currentSpanIndex < ttsSpans.length - 1) {
                    currentSpanIndex++;
                    if (isPlaying) speakCurrent();
                    else highlightSpan(currentSpanIndex);
                }
            });

            navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
        }
    };

    const speakCurrent = () => {
        const myToken = ++speakToken;
        window.speechSynthesis.cancel();

        if (currentSpanIndex >= ttsSpans.length) {
            resetPlayBtn();
            return;
        }

        // FIX: calling speak() in the same tick as cancel() is a known
        // Web Speech API race in Chrome/Edge -- the new utterance can be
        // silently dropped, which is why play "çok nadir başlıyor" (rarely
        // starts). Waiting one tick lets the cancel actually flush first.
        setTimeout(() => {
            // A newer speakCurrent()/rate-change/next/prev call has already
            // taken over -- don't let this stale one speak on top of it.
            if (myToken !== speakToken) return;
            if (!ttsSpans[currentSpanIndex]) {
                resetPlayBtn();
                return;
            }

            const text = ttsSpans[currentSpanIndex].textContent;
            ttsUtterance = new SpeechSynthesisUtterance(text);

            if (currentBookMeta && currentBookMeta.langMap && currentBookMeta.langMap.speech) {
                ttsUtterance.lang = currentBookMeta.langMap.speech;
            } else {
                ttsUtterance.lang = window.globals.getActiveLanguageMap().speech;
            }

            ttsUtterance.rate = window.ttsRate || parseFloat(localStorage.getItem('ttsRate')) || 1.0;

            ttsUtterance.onstart = () => {
                if (myToken !== speakToken) return;
                highlightSpan(currentSpanIndex);
            };

            ttsUtterance.onend = () => {
                // FIX: only advance on a real end. Chrome fires 'end' with
                // no error for genuine completion, but our own cancel()
                // calls (sentence-advance, rate change, stop) should not
                // double-advance here since they're already handled by the
                // code that triggered the cancel.
                if (myToken !== speakToken) return;
                if (isPlaying) {
                    currentSpanIndex++;
                    speakCurrent();
                }
            };

            ttsUtterance.onerror = (e) => {
                if (myToken !== speakToken) return;
                // FIX: 'canceled'/'interrupted' fire whenever we intentionally
                // call speechSynthesis.cancel() (every sentence change, every
                // speed change, every stop/next/prev). Treating those as
                // real errors reset the play button and silently killed
                // playback -- which is why changing the TTS speed while
                // playing used to just stop reading ("ayarları çalışmıyor").
                // Only genuine failures should reset the UI.
                if (e.error === 'canceled' || e.error === 'interrupted') return;
                console.warn("TTS Error", e);
                resetPlayBtn();
            };

            window.speechSynthesis.speak(ttsUtterance);
            setPlayBtnActive();
        }, 50);
    };

    // FIX: exposed so the TTS speed drawer (and any other settings UI) can
    // actually apply a rate change mid-playback instead of just cancelling
    // and going silent. Cancelling speechSynthesis fires 'onerror' (not
    // 'onend') in most browsers, so without this hook nothing ever called
    // speakCurrent() again after a rate change while playing.
    window.ttsApplyRateChange = () => {
        if (isPlaying) {
            speakCurrent();
        }
    };

    // FIX: when Play is pressed fresh (not resuming from pause), make sure
    // TTS actually starts from a sentence that's on the page currently on
    // screen. Previously it always continued from wherever currentSpanIndex
    // last was (often page 1) regardless of which page the user had
    // manually swiped/tapped to, which is the other half of "sayfa atlıyor,
    // başka yerden okuyor".
    const syncSpanToCurrentPage = () => {
        const onCurrentPage = ttsSpans[currentSpanIndex] &&
            getSpanColumn(ttsSpans[currentSpanIndex]) === currentColumnIndex;
        if (onCurrentPage) return;

        const firstOnPage = ttsSpans.findIndex(s => getSpanColumn(s) === currentColumnIndex);
        if (firstOnPage !== -1) currentSpanIndex = firstOnPage;
    };

    if (playBtn) {
        // Remove old listeners by cloning
        const newPlayBtn = playBtn.cloneNode(true);
        playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
        newPlayBtn.addEventListener('click', () => {
            if (isPlaying) {
                window.speechSynthesis.pause();
                resetPlayBtn();
            } else {
                if (window.speechSynthesis.paused) {
                    window.speechSynthesis.resume();
                    setPlayBtnActive();
                } else {
                    syncSpanToCurrentPage();
                    speakCurrent();
                }
            }
        });
    }

    if (stopBtn) {
        const newStopBtn = stopBtn.cloneNode(true);
        stopBtn.parentNode.replaceChild(newStopBtn, stopBtn);
        newStopBtn.addEventListener('click', () => {
            window.speechSynthesis.cancel();
            resetPlayBtn();
            ttsSpans.forEach(s => s.classList.remove('tts-highlight'));
        });
    }

    if (nextBtn) {
        const newNextBtn = nextBtn.cloneNode(true);
        nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);
        newNextBtn.addEventListener('click', () => {
            if (currentSpanIndex < ttsSpans.length - 1) {
                currentSpanIndex++;
                if (isPlaying) speakCurrent();
                else highlightSpan(currentSpanIndex);
            }
        });
    }

    if (prevBtn) {
        const newPrevBtn = prevBtn.cloneNode(true);
        prevBtn.parentNode.replaceChild(newPrevBtn, prevBtn);
        newPrevBtn.addEventListener('click', () => {
            if (currentSpanIndex > 0) {
                currentSpanIndex--;
                if (isPlaying) speakCurrent();
                else highlightSpan(currentSpanIndex);
            }
        });
    }

    // V7.8 Action Bar Integrations
    const startListenBtn = document.getElementById('btn-start-listening');
    const clearTextBtn = document.getElementById('btn-clear-text');

    if (startListenBtn) {
        const newStartBtn = startListenBtn.cloneNode(true);
        startListenBtn.parentNode.replaceChild(newStartBtn, startListenBtn);
        newStartBtn.addEventListener('click', () => {
            if (window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
                setPlayBtnActive();
            } else if (!isPlaying) {
                if (currentSpanIndex >= ttsSpans.length) currentSpanIndex = 0;
                speakCurrent();
            }
        });
    }

                            if (clearTextBtn) {
                                const newClearBtn = clearTextBtn.cloneNode(true);
                                clearTextBtn.parentNode.replaceChild(newClearBtn, clearTextBtn);
                                newClearBtn.addEventListener('click', () => {
                                    document.getElementById('text-render-target').innerHTML = '';
                                    document.getElementById('text-viewer-layer').classList.add('hidden');
                                    window.speechSynthesis.cancel();
                                    resetPlayBtn();
                                    ttsSpans = [];
                                });
                            }

                            const micBtn = document.getElementById('tts-mic');
                            if (micBtn) {
                                const newMicBtn = micBtn.cloneNode(true);
                                micBtn.parentNode.replaceChild(newMicBtn, micBtn);

                                if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                                    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                                    const recognition = new SpeechRecognition();
                                    recognition.continuous = false;
                                    recognition.interimResults = false;

                                    newMicBtn.addEventListener('click', () => {
                                        if (!ttsSpans[currentSpanIndex]) return;

                                        const targetText = ttsSpans[currentSpanIndex].textContent.trim();
                                        if (!targetText) return;

                                        if (window.speechSynthesis.speaking) {
                                            window.speechSynthesis.cancel();
                                            resetPlayBtn();
                                        }

                                        if (currentBookMeta && currentBookMeta.langMap && currentBookMeta.langMap.speech) {
                                            recognition.lang = currentBookMeta.langMap.speech;
                                        } else {
                                            recognition.lang = window.globals.getActiveLanguageMap().speech;
                                        }

                                        newMicBtn.style.color = 'var(--error)';
                                        newMicBtn.textContent = '🔴';

                                        recognition.start();

                                        recognition.onresult = (event) => {
                                            const transcript = event.results[0][0].transcript.toLowerCase();
                                            const targetLower = targetText.toLowerCase().replace(/[.,!?;:]/g, '');

                                            const words1 = transcript.split(' ');
                                            const words2 = targetLower.split(' ');
                                            let matches = 0;
                                            words1.forEach(w => { if (words2.includes(w)) matches++; });

                                            const score = Math.round((matches / Math.max(1, words2.length)) * 100);
                                            const finalScore = Math.min(100, score);

                                            const accuracyUi = document.getElementById('tts-accuracy');
                                            if (accuracyUi) {
                                                accuracyUi.classList.remove('hidden');
                                                accuracyUi.textContent = `🎯 Skor: %${finalScore}`;
                                                if (finalScore > 70) {
                                                    accuracyUi.style.color = 'var(--success)';
                                                    accuracyUi.style.borderColor = 'var(--success)';
                                                } else {
                                                    accuracyUi.style.color = 'var(--warning)';
                                                    accuracyUi.style.borderColor = 'var(--warning)';
                                                }

                                                setTimeout(() => accuracyUi.classList.add('hidden'), 3000);
                                            }

                                            if (window.GameEngine) {
                                                window.GameEngine.addXP(Math.round(finalScore / 10));
                                            }
                                        };

                                        recognition.onend = () => {
                                            newMicBtn.style.color = '';
                                            newMicBtn.textContent = '🎙️';
                                        };

                                        recognition.onerror = (event) => {
                                            console.error("Speech recognition error", event.error);
                                            newMicBtn.style.color = '';
                                            newMicBtn.textContent = '🎙️';
                                        };
                                    });
                                } else {
                                    newMicBtn.style.opacity = '0.5';
                                    newMicBtn.title = "Tarayıcı desteklemiyor";
                                }
                            }
}

                            function loadPlanC(ia_id, iframe, fallbackBar) {
                                iframe.classList.remove('hidden');
                                fallbackBar.classList.remove('hidden');

                                fallbackBar.style.background = 'var(--primary)';
                                fallbackBar.innerHTML = `
        Alternatif sunucudasınız.
        <button id="btn-final-cancel" class="btn text-btn" style="padding:4px 8px; font-size:0.8rem; margin-left:10px; color:#fff;">
            Hala çalışmıyor mu? İptal (Plan D)
        </button>
    `;

                                iframe.src = `https://openlibrary.org/embed/${ia_id}`;

                                document.getElementById('btn-final-cancel').addEventListener('click', () => {
                                    iframe.classList.add('hidden');
                                    fallbackBar.classList.add('hidden');
                                    showFinalError();
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
                            // Global TTS speed (shared between EPUB and text TTS)
                            window.ttsRate = parseFloat(localStorage.getItem('ttsRate') || '1.0');

                            function setupControls() {
                                const btnBack = document.getElementById('btn-back');
                                if (btnBack) btnBack.addEventListener('click', () => window.location.href = 'index.html');

                                // ✅ FIX: Wire the toolbar gear icon to open settings drawer
                                const btnSettings = document.getElementById('btn-settings');
                                if (btnSettings) btnSettings.addEventListener('click', () => {
                                    document.getElementById('side-drawer').classList.add('open');
                                    document.getElementById('drawer-overlay').classList.add('active');
                                });

                                const btnNext = document.getElementById('next-page');
                                if (btnNext) btnNext.addEventListener('click', () => {
                                    if (currentBookMeta?.type === 'pdf') pdfNextPage();
                                    else if (epubRendition) epubRendition.next();
                                });

                                const btnPrev = document.getElementById('prev-page');
                                if (btnPrev) btnPrev.addEventListener('click', () => {
                                    if (currentBookMeta?.type === 'pdf') pdfPrevPage();
                                    else if (epubRendition) epubRendition.prev();
                                });

                                const dictSave = document.getElementById('drawer-dict-save');
                                if (dictSave) dictSave.addEventListener('click', async (e) => {
                                    if (currentWordData) {
                                        await window.dbAPI.saveWord(
                                            currentWordData.word, currentWordData.context, currentWordData.definitionData
                                        );
                                        e.target.textContent = 'Kaydedildi!';
                                        e.target.style.background = 'var(--success)';
                                        setTimeout(() => {
                                            e.target.textContent = 'Kelime Kartını Kaydet';
                                            e.target.style.background = '';
                                        }, 1000);
                                    }
                                });

                                const drawerClose = document.getElementById('drawer-close');
                                if (drawerClose) drawerClose.addEventListener('click', closeSideDrawer);

                                const drawerOverlay = document.getElementById('drawer-overlay');
                                if (drawerOverlay) drawerOverlay.addEventListener('click', closeSideDrawer);

                                // V12 Modern Theme Switch logic
                                const themeBtns = document.querySelectorAll('.theme-btn');
                                themeBtns.forEach(btn => {
                                    btn.addEventListener('click', (e) => {
                                        const theme = e.target.getAttribute('data-theme');

                                        // Keep reader-mode class to prevent black-screen
                                        document.body.className = (theme === 'light' ? 'light-theme' : (theme === 'sepia' ? 'sepia-theme' : 'dark-theme')) + ' reader-mode';
                                        document.body.style.background = theme === 'light' ? '#f4f4f9' : (theme === 'sepia' ? '#fbf0d9' : '#111827');

                                        // Also apply text colour to native text viewer
                                        const textTarget = document.getElementById('text-render-target');
                                        if (textTarget) textTarget.style.color = theme === 'light' ? '#1a1a1a' : (theme === 'sepia' ? '#3d3024' : '#f9fafb');

                                        themeBtns.forEach(b => b.classList.remove('active'));
                                        e.target.classList.add('active');

                                        if (window.epubRendition) window.epubRendition.themes.select(theme);

                                        try {
                                            const s = JSON.parse(localStorage.getItem('epub_settings') || '{}');
                                            s.theme = theme;
                                            localStorage.setItem('epub_settings', JSON.stringify(s));
                                        } catch (err) { }
                                    });
                                });

                                // V15 Custom Color Picker Logic
                                const btnApplyCustom = document.getElementById('btn-apply-custom-colors');
                                if (btnApplyCustom) {
                                    btnApplyCustom.addEventListener('click', () => {
                                        const textColor = document.getElementById('custom-text-color').value;
                                        const bgColor = document.getElementById('custom-bg-color').value;

                                        // Update main body
                                        document.body.style.background = bgColor;
                                        themeBtns.forEach(b => b.classList.remove('active'));

                                        if (window.epubRendition) {
                                            window.epubRendition.themes.register("custom", {
                                                "body": {
                                                    "background": `${bgColor} !important`,
                                                    "color": `${textColor} !important`,
                                                    "padding": "0 5% !important",
                                                    "line-height": "1.6 !important",
                                                    "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important"
                                                },
                                                "p": { "color": `${textColor} !important`, "background": "transparent !important" },
                                                "span": { "color": `${textColor} !important`, "background": "transparent !important" },
                                                "div": { "color": `${textColor} !important`, "background": "transparent !important" },
                                                "h1": { "color": `${textColor} !important` }, "h2": { "color": `${textColor} !important` }, "h3": { "color": `${textColor} !important` }
                                            });
                                            window.epubRendition.themes.select("custom");
                                        }

                                        try {
                                            const storedSettings = JSON.parse(localStorage.getItem('epub_settings') || '{}');
                                            storedSettings.theme = 'custom';
                                            storedSettings.customText = textColor;
                                            storedSettings.customBg = bgColor;
                                            localStorage.setItem('epub_settings', JSON.stringify(storedSettings));
                                        } catch (err) { }

                                        // Close Drawer
                                        document.getElementById('side-drawer').classList.remove('open');
                                        document.getElementById('drawer-overlay').classList.remove('active');
                                    });
                                }

                                // V8 EPUB Slider Navigation
                                const slider = document.getElementById('epub-slider');
                                const progressText = document.getElementById('epub-progress-text');

                                if (slider) {
                                    slider.addEventListener('change', (e) => {
                                        if (epubBook && epubRendition) {
                                            const percentage = e.target.value / 100;
                                            const cfi = epubBook.locations.cfiFromPercentage(percentage);
                                            if (cfi) {
                                                epubRendition.display(cfi);
                                            }
                                        }
                                    });

                                    slider.addEventListener('input', (e) => {
                                        if (progressText) {
                                            if (epubBook && epubBook.locations && epubBook.locations.total) {
                                                const total = epubBook.locations.total;
                                                const approxPage = Math.round((e.target.value / 100) * total);
                                                progressText.textContent = `Sayfa ${approxPage} / ${total}`;
                                            } else {
                                                progressText.textContent = `${e.target.value}%`;
                                            }
                                        }
                                    });

                                    window.addEventListener('epub-relocated', (e) => {
                                        if (epubBook && epubBook.locations && epubBook.locations.length() > 0) {
                                            const percentage = epubBook.locations.percentageFromCfi(e.detail.start.cfi);
                                            const val = Math.round(percentage * 100);
                                            slider.value = val;

                                            if (progressText) {
                                                const currentPage = epubBook.locations.locationFromCfi(e.detail.start.cfi);
                                                const totalPages = epubBook.locations.total;
                                                progressText.textContent = totalPages ? `Sayfa ${currentPage} / ${totalPages}` : `${val}%`;
                                            }

                                            if (val >= 99 && window.BossFight && !window.BossFight.isDefeated) {
                                                window.BossFight.initFight();
                                            }
                                        }

                                        // V10 RPG Integration: Add 1 XP per page turn
                                        if (window.GameEngine) {
                                            window.GameEngine.addXP(1);
                                        }
                                    });
                                    // V9 Settings Sync UI
                                    const toggleSpreadBtn = document.getElementById('toggle-spread');
                                    if (toggleSpreadBtn) {
                                        toggleSpreadBtn.addEventListener('click', (e) => {
                                            if (!epubRendition) return;
                                            const currentSettings = JSON.parse(localStorage.getItem('epub_settings') || '{}');
                                            const isCurrentlyOff = currentSettings.spread === false;

                                            if (isCurrentlyOff) {
                                                currentSettings.spread = true;
                                                e.target.textContent = '📖 Çift Sayfa Görünümü: Açık';
                                                epubRendition.spread('auto');
                                            } else {
                                                currentSettings.spread = false;
                                                e.target.textContent = '📖 Çift Sayfa Görünümü: Kapalı';
                                                epubRendition.spread('none');
                                            }
                                            localStorage.setItem('epub_settings', JSON.stringify(currentSettings));
                                        });
                                    }

                                    const zoomSlider = document.getElementById('zoom-slider');
                                    const zoomVal = document.getElementById('zoom-text-val');
                                    if (zoomSlider && zoomVal) {
                                        zoomSlider.addEventListener('input', (e) => {
                                            zoomVal.textContent = `${e.target.value}%`;
                                        });
                                        zoomSlider.addEventListener('change', (e) => {
                                            const newZoom = `${e.target.value}%`;
                                            if (window.epubRendition) window.epubRendition.themes.fontSize(newZoom);
                                            // ✅ FIX: Also apply to native text viewer
                                            const textTarget = document.getElementById('text-render-target');
                                            if (textTarget) textTarget.style.fontSize = newZoom;

                                            const s = JSON.parse(localStorage.getItem('epub_settings') || '{}');
                                            s.zoom = e.target.value;
                                            localStorage.setItem('epub_settings', JSON.stringify(s));
                                        });
                                    }
                                }

                                // ✅ NEW: Line-height slider — applies to text viewer and EPUB
                                const lineHeightSlider = document.getElementById('line-height-slider');
                                const lineHeightVal = document.getElementById('line-height-val');
                                if (lineHeightSlider && lineHeightVal) {
                                    lineHeightSlider.addEventListener('input', (e) => {
                                        const lh = (e.target.value / 10).toFixed(1);
                                        lineHeightVal.textContent = `${lh}x`;
                                        const textTarget = document.getElementById('text-render-target');
                                        if (textTarget) textTarget.style.lineHeight = lh;
                                    });
                                }

                                // ✅ NEW: Margin slider
                                const marginSlider = document.getElementById('margin-slider');
                                const marginVal = document.getElementById('margin-val');
                                if (marginSlider && marginVal) {
                                    marginSlider.addEventListener('input', (e) => {
                                        const m = `${e.target.value}%`;
                                        marginVal.textContent = m;
                                        const textTarget = document.getElementById('text-render-target');
                                        if (textTarget) textTarget.style.padding = `40px ${m}`;
                                    });
                                }

                                // ✅ NEW: Autoscroll toggle
                                const toggleAutoscroll = document.getElementById('toggle-autoscroll');
                                let autoscrollTimer = null;
                                if (toggleAutoscroll) {
                                    toggleAutoscroll.addEventListener('click', () => {
                                        if (autoscrollTimer) {
                                            clearInterval(autoscrollTimer);
                                            autoscrollTimer = null;
                                            toggleAutoscroll.textContent = '🔄 Otomatik Kaydırma: Kapalı';
                                        } else {
                                            toggleAutoscroll.textContent = '⏹ Otomatik Kaydırma: Açık';
                                            const scrollArea = document.getElementById('text-scroll-area');
                                            if (scrollArea) autoscrollTimer = setInterval(() => scrollArea.scrollBy(0, 1), 50);
                                        }
                                    });
                                }

                                // ✅ NEW: TTS Speed section in the settings drawer
                                const drawerSidebar = document.getElementById('side-drawer');
                                if (drawerSidebar && !document.getElementById('tts-speed-section')) {
                                    const speedSection = document.createElement('div');
                                    speedSection.id = 'tts-speed-section';
                                    speedSection.className = 'drawer-section';
                                    speedSection.innerHTML = `
            <h4>🔊 Dinleme Hızı</h4>
            <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                <button class="btn secondary tts-speed-drawer-btn" data-rate="0.75" style="flex:1;">0.75x</button>
                <button class="btn secondary tts-speed-drawer-btn" data-rate="1.0" style="flex:1;">1x</button>
                <button class="btn secondary tts-speed-drawer-btn" data-rate="1.25" style="flex:1;">1.25x</button>
                <button class="btn secondary tts-speed-drawer-btn" data-rate="1.5" style="flex:1;">1.5x</button>
                <button class="btn secondary tts-speed-drawer-btn" data-rate="2.0" style="flex:1;">2x</button>
            </div>
            <p id="tts-speed-label" style="font-size:0.8rem; color:var(--text-secondary); margin-top:6px; text-align:center;">Şu an: ${window.ttsRate}x</p>
        `;
                                    const firstSection = drawerSidebar.querySelector('.drawer-section');
                                    if (firstSection && firstSection.nextSibling) drawerSidebar.insertBefore(speedSection, firstSection.nextSibling);
                                    else drawerSidebar.appendChild(speedSection);

                                    const updateSpeedUI = () => {
                                        const label = document.getElementById('tts-speed-label');
                                        if (label) label.textContent = `Şu an: ${window.ttsRate}x`;
                                        speedSection.querySelectorAll('.tts-speed-drawer-btn').forEach(b => {
                                            const isActive = parseFloat(b.dataset.rate) === window.ttsRate;
                                            b.style.background = isActive ? 'var(--accent-primary)' : '';
                                            b.style.color = isActive ? '#fff' : '';
                                        });
                                    };
                                    updateSpeedUI();

                                    speedSection.querySelectorAll('.tts-speed-drawer-btn').forEach(btn => {
                                        btn.addEventListener('click', () => {
                                            window.ttsRate = parseFloat(btn.dataset.rate);
                                            localStorage.setItem('ttsRate', window.ttsRate.toString());
                                            updateSpeedUI();
                                            // FIX: previously this just called cancel() and stopped --
                                            // speechSynthesis fires 'onerror' (not 'onend') on a manual
                                            // cancel, so nothing ever restarted speech, making it look
                                            // like changing the speed "didn't work". ttsApplyRateChange
                                            // (exposed by setupSonicTTS) re-speaks the current sentence
                                            // at the new rate if TTS was already playing.
                                            if (window.ttsApplyRateChange) {
                                                window.ttsApplyRateChange();
                                            } else if (window.speechSynthesis.speaking) {
                                                window.speechSynthesis.cancel();
                                            }
                                            if (window.ttsApplyRateChangeEpub) {
                                                window.ttsApplyRateChangeEpub();
                                            }
                                        });
                                    });
                                }
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

                                // V8: Unhide EPUB layers
                                document.getElementById('text-viewer-layer').classList.add('hidden');
                                document.getElementById('local-viewer-layer').classList.remove('hidden');

                                // V13 Dynamic TTS Action Bar specifically for EPUBs
                                let epubActionBar = document.getElementById('epub-action-bar');
                                if (!epubActionBar) {
                                    epubActionBar = document.createElement('div');
                                    epubActionBar.id = 'epub-action-bar';
                                    epubActionBar.className = 'floating-ui floating-top';
                                    epubActionBar.style.cssText = 'position:absolute; gap: 8px; padding: calc(10px + env(safe-area-inset-top)) 15px 15px 15px; z-index: 200; display: flex; justify-content: center; align-items: center; top: 0; width: 100%; pointer-events: none; flex-wrap: wrap; background: linear-gradient(to bottom, rgba(10,10,10,0.85) 0%, rgba(10,10,10,0) 100%); transition: opacity 0.3s;';

                                    // EXIT BUTTON
                                    const exitBtn = document.createElement('button');
                                    exitBtn.id = 'btn-epub-exit';
                                    exitBtn.className = 'btn secondary';
                                    exitBtn.style.cssText = 'pointer-events: auto; font-weight: bold; border-radius: 20px; background: rgba(220, 38, 38, 0.8); color: white; border: 1px solid rgba(255,255,255,0.3); padding: 6px 12px; font-size: 0.85rem; display: flex; align-items: center; gap: 4px;';
                                    exitBtn.innerHTML = '🏠 Kütüphane';
                                    epubActionBar.appendChild(exitBtn);

                                    exitBtn.addEventListener('click', () => {
                                        window.speechSynthesis.cancel();
                                        window.location.href = 'index.html';
                                    });

                                    // LISTEN BUTTON
                                    let listenBtn = document.createElement('button');
                                    listenBtn.id = 'btn-epub-listen';
                                    listenBtn.className = 'btn primary';
                                    listenBtn.style.cssText = 'pointer-events: auto; font-weight: bold; border-radius: 20px; box-shadow: 0 4px 10px rgba(59, 130, 246, 0.4); padding: 6px 12px; display: flex; align-items: center; gap: 4px; font-size: 0.85rem;';
                                    listenBtn.innerHTML = '🔊 Dinle';
                                    epubActionBar.appendChild(listenBtn);

                                    // SHADOWING BUTTON
                                    const shadowBtn = document.createElement('button');
                                    shadowBtn.id = 'btn-epub-shadow';
                                    shadowBtn.className = 'btn secondary';
                                    shadowBtn.style.cssText = 'pointer-events: auto; font-weight: bold; border-radius: 20px; background: rgba(139,92,246,0.85); color: white; border: 1px solid rgba(255,255,255,0.3); padding: 6px 12px; display: flex; align-items: center; gap: 4px; font-size: 0.85rem;';
                                    shadowBtn.innerHTML = '🎤 Söyle';
                                    epubActionBar.appendChild(shadowBtn);

                                    // SETTINGS BUTTON
                                    const settingsBtn = document.createElement('button');
                                    settingsBtn.id = 'btn-epub-settings';
                                    settingsBtn.className = 'btn secondary';
                                    settingsBtn.style.cssText = 'pointer-events: auto; font-weight: bold; border-radius: 20px; background: rgba(50,50,50,0.8); color: white; border: 1px solid rgba(255,255,255,0.3); padding: 6px 12px; display: flex; align-items: center; gap: 4px; font-size: 0.85rem;';
                                    settingsBtn.innerHTML = '⚙️ Ayarlar';
                                    epubActionBar.appendChild(settingsBtn);

                                    document.getElementById('local-viewer-layer').appendChild(epubActionBar);

                                    settingsBtn.addEventListener('click', () => {
                                        document.getElementById('side-drawer').classList.add('open');
                                        document.getElementById('drawer-overlay').classList.add('active');
                                    });

                                    // Shadowing button logic: read current sentence, then listen
                                    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                                        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                                        let shadowRecognition = null;
                                        shadowBtn.addEventListener('click', () => {
                                            if (shadowRecognition) {
                                                try { shadowRecognition.stop(); } catch (e) { }
                                                shadowRecognition = null;
                                                shadowBtn.innerHTML = '🎤 Söyle';
                                                return;
                                            }
                                            // Get current sentence from page
                                            let targetText = '';
                                            try {
                                                const contents = epubRendition.getContents();
                                                if (contents && contents[0] && contents[0].document) {
                                                    const doc = contents[0].document;
                                                    const body = doc.body;
                                                    const fullText = body.innerText || body.textContent || '';
                                                    const sents = fullText.match(/[^.!?\n]+[.!?]?/g) || [];
                                                    const filtered = sents.map(s => s.trim()).filter(s => s.length > 8 && /[a-zA-Z]/.test(s));
                                                    targetText = filtered[0] || '';
                                                }
                                            } catch (e) { }
                                            if (!targetText) { alert('Bu sayfa’da okunacak metin bulunamadı.'); return; }

                                            // First speak it, then listen
                                            const u = new SpeechSynthesisUtterance(targetText);
                                            u.lang = window.globals.getActiveLanguageMap().speech;
                                            u.rate = window.ttsRate;
                                            shadowBtn.innerHTML = '🔊 Dinle...';
                                            u.onend = () => {
                                                shadowBtn.innerHTML = '🔴 Sizi Dinliyorum...';
                                                shadowRecognition = new SpeechRecognition();
                                                shadowRecognition.lang = window.globals.getActiveLanguageMap().speech;
                                                shadowRecognition.continuous = false;
                                                shadowRecognition.interimResults = false;
                                                shadowRecognition.onresult = (event) => {
                                                    const transcript = event.results[0][0].transcript.toLowerCase();
                                                    const targetLower = targetText.toLowerCase().replace(/[.,!?;:]/g, '');
                                                    const w1 = transcript.split(' '), w2 = targetLower.split(' ');
                                                    let matches = 0;
                                                    w1.forEach(w => { if (w2.includes(w)) matches++; });
                                                    const score = Math.min(100, Math.round((matches / Math.max(1, w2.length)) * 100));
                                                    shadowBtn.innerHTML = `🎤 ${score}% - Tekrar Söyle`;
                                                    if (window.GameEngine) window.GameEngine.addXP(Math.round(score / 10));
                                                    shadowRecognition = null;
                                                };
                                                shadowRecognition.onerror = () => { shadowBtn.innerHTML = '🎤 Söyle'; shadowRecognition = null; };
                                                shadowRecognition.onend = () => { if (shadowRecognition) { shadowBtn.innerHTML = '🎤 Söyle'; shadowRecognition = null; } };
                                                shadowRecognition.start();
                                            };
                                            window.speechSynthesis.cancel();
                                            // FIX: same cancel()+speak() race as the main reader TTS --
                                            // a short delay lets the cancel flush so the new utterance
                                            // isn't silently dropped.
                                            setTimeout(() => {
                                                window.speechSynthesis.speak(u);
                                            }, 50);
                                        });
                                    } else {
                                        shadowBtn.style.opacity = '0.5';
                                        shadowBtn.title = 'Tarayıcı ses tanıma desteklemiyor';
                                    }
                                } // Closing epubActionBar block

                                    // V19 Audio engine injected below after Epub.js instantiation.    // V19 Audio Engine & Strict Single Page Overwrite
                                    epubBook = ePub(arrayBuffer);

                                    let defaultTheme = 'dark';
                                    let customTextColor = '#ffffff';
                                    let customBgColor = '#111827';
                                    try {
                                        const storedSettings = localStorage.getItem('epub_settings');
                                        if (storedSettings) {
                                            const parsed = JSON.parse(storedSettings);
                                            if (parsed.theme) defaultTheme = parsed.theme;
                                            if (parsed.customText) customTextColor = parsed.customText;
                                            if (parsed.customBg) customBgColor = parsed.customBg;

                                            const zoomSlider = document.getElementById('zoom-slider');
                                            const zoomVal = document.getElementById('zoom-text-val');
                                            if (zoomSlider && parsed.zoom) {
                                                zoomSlider.value = parsed.zoom;
                                                if (zoomVal) zoomVal.textContent = `${parsed.zoom}%`;
                                            }
                                        }
                                    } catch (err) { console.warn("EPUB Settings load error", err); }

                                    // 2. Tek Sayfa Düzeni (Spread Fix)
                                    epubRendition = epubBook.renderTo("epub-render-target", {
                                        width: "100%",
                                        height: "100%",
                                        spread: "none",
                                        manager: "default",
                                        flow: "paginated",
                                        allowScriptedContent: true
                                    });
                                    window.epubRendition = epubRendition; // Ayarlar paneli için global referans

                                    // 1. Dinleme (TTS) Aktivasyonu
                                    listenBtn = document.getElementById('btn-epub-listen');
                                    if (listenBtn) {
                                        let currentSentenceIndex = 0;
                                        let sentences = [];
                                        let isEpubTtsPlaying = false;
                                        let epubSpeakToken = 0;
                                        let currentHighlightElements = [];

                                        const clearHighlights = () => {
                                            currentHighlightElements.forEach(el => {
                                                el.style.backgroundColor = '';
                                                el.style.textDecoration = '';
                                            });
                                            currentHighlightElements = [];
                                        };

                                        const getSentencesFromCurrentPage = () => {
                                            try {
                                                // epubRendition.getContents() returns array of content objects for rendered views
                                                const contentsList = epubRendition.getContents();
                                                if (!contentsList || contentsList.length === 0) return [];
                                                const doc = contentsList[0].document;
                                                if (!doc || !doc.body) return [];

                                                // Extract all visible text
                                                const fullText = doc.body.innerText || doc.body.textContent || '';
                                                // Split into sentences on . ! ?
                                                const rawSentences = fullText.match(/[^.!?\n]+[.!?]?/g) || [];
                                                return rawSentences
                                                    .map(s => s.trim())
                                                    .filter(s => s.length > 8 && /[a-zA-Z]/.test(s));
                                            } catch (err) {
                                                console.error('[TTS] getSentencesFromCurrentPage error:', err);
                                                return [];
                                            }
                                        };

                                        const speakSentence = (index) => {
                                            currentSentenceIndex = index;
                                            if (index >= sentences.length) {
                                                // Sayfa bitti, sonraki sayfaya geç
                                                isEpubTtsPlaying = false;
                                                listenBtn.innerHTML = '&#x1F50A; Dinle';
                                                clearHighlights();
                                                epubRendition.next();
                                                return;
                                            }

                                            const sentence = sentences[index];
                                            if (!sentence || sentence.trim().length === 0) {
                                                speakSentence(index + 1);
                                                return;
                                            }

                                            clearHighlights();

                                            // Try to highlight in iframe
                                            try {
                                                const contentsList = epubRendition.getContents();
                                                if (contentsList && contentsList.length > 0) {
                                                    const doc = contentsList[0].document;
                                                    if (doc && doc.body) {
                                                        const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
                                                        let node;
                                                        while ((node = walk.nextNode())) {
                                                            const nodeText = node.nodeValue;
                                                            const startIndex = nodeText.indexOf(sentence);
                                                            if (startIndex !== -1) {
                                                                try {
                                                                    const range = doc.createRange();
                                                                    range.setStart(node, startIndex);
                                                                    range.setEnd(node, startIndex + sentence.length);
                                                                    const span = doc.createElement('span');
                                                                    span.style.cssText = 'background:rgba(250,204,21,0.7)!important; color:#000!important; border-radius:3px; transition:all 0.3s;';
                                                                    range.surroundContents(span);
                                                                    currentHighlightElements.push(span);
                                                                    span.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                } catch (e) { /* range surroundContents may fail across nodes */ }
                                                                break;
                                                            }
                                                        }
                                                    }
                                                }
                                            } catch (err) {
                                                console.warn('[TTS] Highlight error (non-fatal):', err);
                                            }

                                            const utterance = new SpeechSynthesisUtterance(sentence);
                                            utterance.lang = window.globals.getActiveLanguageMap().speech || "en-US";
                                            utterance.rate = window.ttsRate || 1.0;
                                            const myEpubToken = ++epubSpeakToken;

                                            utterance.onend = () => {
                                                if (myEpubToken !== epubSpeakToken) return;
                                                // Mark as done with strikethrough
                                                currentHighlightElements.forEach(el => {
                                                    el.style.backgroundColor = 'transparent';
                                                    el.style.textDecoration = 'line-through';
                                                    el.style.opacity = '0.6';
                                                });
                                                speakSentence(index + 1);
                                            };

                                            utterance.onerror = (e) => {
                                                if (myEpubToken !== epubSpeakToken) return;
                                                console.warn('[TTS] Speech error:', e.error);
                                                if (e.error !== 'interrupted' && e.error !== 'canceled') {
                                                    isEpubTtsPlaying = false;
                                                    listenBtn.innerHTML = '&#x1F50A; Dinle';
                                                    clearHighlights();
                                                }
                                            };

                                            window.speechSynthesis.speak(utterance);
                                            isEpubTtsPlaying = true;
                                        };

                                        // FIX: exposed so the TTS speed drawer can restart the current
                                        // epub sentence at the new rate instead of the audio just dying
                                        // (same 'cancel() fires onerror not onend' issue as the native
                                        // reader).
                                        window.ttsApplyRateChangeEpub = () => {
                                            if (isEpubTtsPlaying) {
                                                speakSentence(currentSentenceIndex);
                                            }
                                        };

                                        listenBtn.addEventListener('click', () => {
                                            if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
                                                window.speechSynthesis.pause();
                                                listenBtn.innerHTML = '&#x25B6;&#xFE0F; Devam Et';
                                            } else if (window.speechSynthesis.paused) {
                                                window.speechSynthesis.resume();
                                                listenBtn.innerHTML = '&#x23F8; Duraklat';
                                            } else {
                                                window.speechSynthesis.cancel();
                                                clearHighlights();
                                                sentences = getSentencesFromCurrentPage();
                                                currentSentenceIndex = 0;
                                                if (sentences.length > 0) {
                                                    listenBtn.innerHTML = '&#x23F8; Duraklat';
                                                    // FIX: same cancel()+speak() race as elsewhere -- give
                                                    // the cancel a tick to flush first, this is part of why
                                                    // TTS "rarely starts".
                                                    setTimeout(() => speakSentence(0), 50);
                                                } else {
                                                    listenBtn.innerHTML = '&#x1F50A; Dinle';
                                                }
                                            }
                                        });

                                        // Reset TTS & highlights on page change
                                        epubRendition.on('relocated', () => {
                                            window.speechSynthesis.cancel();
                                            isEpubTtsPlaying = false;
                                            clearHighlights();
                                            sentences = [];
                                            currentSentenceIndex = 0;
                                            listenBtn.innerHTML = '&#x1F50A; Dinle';
                                        });
                                    }
                                    // V12: Dynamic Theme Selection with Strict Overrides
                                    const commonStyles = {
                                        "padding": "0 5% !important",
                                        "line-height": "1.6 !important",
                                        "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important"
                                    };

                                    epubRendition.themes.register("light", {
                                        "body": { "background": "#f4f4f9 !important", "color": "#000000 !important", ...commonStyles },
                                        "*": { "color": "#000000 !important", "background": "transparent !important" }
                                    });

                                    epubRendition.themes.register("sepia", {
                                        "body": { "background": "#fbf0d9 !important", "color": "#3d3024 !important", ...commonStyles },
                                        "*": { "color": "#3d3024 !important", "background": "transparent !important" }
                                    });

                                    epubRendition.themes.register("dark", {
                                        "body": { "background": "#111827 !important", "color": "#f9fafb !important", ...commonStyles },
                                        "*": { "color": "#f9fafb !important", "background": "transparent !important" }
                                    });

                                    epubRendition.themes.register("custom", {
                                        "body": { "background": `${customBgColor} !important`, "color": `${customTextColor} !important`, ...commonStyles },
                                        "*": { "color": `${customTextColor} !important`, "background": "transparent !important" },
                                        "img, svg, video, iframe, canvas, figure, picture, .ignore-color": { "background": "initial !important", "color": "initial !important" }
                                    });

                                    epubRendition.themes.select(defaultTheme);
                                    const defaultZoom = (function () { try { const s = JSON.parse(localStorage.getItem('epub_settings') || '{}'); return s.zoom ? s.zoom + '%' : '100%'; } catch (e) { return '100%'; } })();
                                    epubRendition.themes.fontSize(defaultZoom);

                                    // V9 Swipe to turn pages
                                    let touchStartX = 0; let touchEndX = 0;

                                    epubBook.ready.then(() => {
                                        return epubBook.locations.generate(1600);
                                    }).then(() => {
                                        if (epubRendition && epubBook && epubBook.locations && epubBook.locations.length() > 0 && epubRendition.currentLocation()) {
                                            window.dispatchEvent(new CustomEvent('epub-relocated', { detail: epubRendition.currentLocation() }));
                                        }
                                    });

                                    window.dbAPI.getProgress('currentBook').then(prog => {
                                        if (prog && prog.location) epubRendition.display(prog.location);
                                        else epubRendition.display();
                                    });

                                    epubRendition.on("relocated", (location) => {
                                        window.speechSynthesis.cancel();
                                        window.dbAPI.saveProgress('currentBook', location.start.cfi);
                                        window.dispatchEvent(new CustomEvent('epub-relocated', { detail: location }));
                                    });

                                    // V9 Native EPUB.js Selection Event
                                    epubRendition.on("selected", async (cfiRange, contents) => {
                                        epubBook.getRange(cfiRange).then(range => {
                                            const word = range.toString().trim();
                                            if (word) {
                                                let context = "";
                                                if (range.commonAncestorContainer && range.commonAncestorContainer.textContent) {
                                                    context = range.commonAncestorContainer.textContent.trim().substring(0, 150) + "...";
                                                }
                                                handleWordSelection(word, context);
                                            }
                                        });
                                    });

                                    epubRendition.hooks.content.register((contents, view) => {
                                        const doc = contents.document;

                                        // V17 Universal Mobile Selection Fix (Failsafe for epubRendition.on selected missing events on Android/iOS)
                                        doc.addEventListener('selectionchange', () => {
                                            clearTimeout(window.epubSelectionTimeout);
                                            window.epubSelectionTimeout = setTimeout(() => {
                                                const sel = contents.window.getSelection();
                                                if (sel) {
                                                    const word = sel.toString().trim();
                                                    if (word && word.length > 1 && word.length < 30) {
                                                        try {
                                                            const range = sel.getRangeAt(0);
                                                            let context = "";
                                                            if (range.commonAncestorContainer && range.commonAncestorContainer.textContent) {
                                                                context = range.commonAncestorContainer.textContent.trim().substring(0, 150) + "...";
                                                            }
                                                            if (window.parent && window.parent.handleWordSelection) {
                                                                window.parent.handleWordSelection(word, context);
                                                            }
                                                        } catch (err) { }
                                                    }
                                                }
                                            }, 600);
                                        });

                                        // ✅ REMOVED: Per-paragraph mic buttons removed. Use the dedicated Shadowing button instead.
                                        // Shadowing is now accessible via the "🎤 Söyle" button in the action bar.

                                        // Tap to toggle menu or turn pages
                                        doc.addEventListener('click', (e) => {
                                            const target = e.target;
                                            if (target.className === 'epub-mic-btn' || target.closest('.epub-mic-btn')) return;
                                            if (contents.window.getSelection().toString().trim().length > 0) return;

                                            const x = e.clientX;
                                            const width = contents.window.innerWidth;
                                            if (x < width * 0.2) epubRendition.prev();
                                            else if (x > width * 0.8) epubRendition.next();
                                            else {
                                                const isUIActive = document.querySelector('.floating-ui').classList.contains('active');
                                                document.querySelectorAll('.floating-ui').forEach(ui => ui.classList.toggle('active'));
                                            }
                                        });

                                        doc.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, false);
                                        doc.addEventListener('touchend', e => {
                                            if (e.target.className === 'epub-mic-btn' || e.target.closest('.epub-mic-btn')) return;
                                            touchEndX = e.changedTouches[0].screenX;
                                            handleSwipe();
                                        }, false);

                                        function handleSwipe() {
                                            const swipeThreshold = 50;
                                            if (touchEndX < touchStartX - swipeThreshold) epubRendition.next();
                                            if (touchEndX > touchStartX + swipeThreshold) epubRendition.prev();
                                        }
                                    });

                                // =====================================
                                // DICTIONARY (V8 Side Drawer)
                                // =====================================
                            } // end initEpubReader

                            async function handleWordSelection(word, context) {
                                word = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
                                if (word.length < 2) return;

                                currentWordData = { word, context, definitionData: null };
                                openSideDrawer(word);

                                const transData = await window.dictionaryAPI.fetchDefinition(word);

                                if (transData && !transData.error) {
                                    currentWordData.definitionData = transData;
                                    const phoneticEl = document.getElementById('drawer-dict-phonetic');
                                    const defEl = document.getElementById('drawer-dict-def');

                                    phoneticEl.textContent = transData.phonetic || `[${window.globals.activeContentLang.toUpperCase()}]`;
                                    defEl.textContent = transData.translation;

                                } else {
                                    document.getElementById('drawer-dict-def').textContent = "Çeviri bulunamadı.";
                                    document.getElementById('drawer-dict-phonetic').textContent = "";
                                }
                            }

                            function openSideDrawer(word = null) {
                                const drawer = document.getElementById('side-drawer');
                                const overlay = document.getElementById('drawer-overlay');

                                if (word) {
                                    document.getElementById('drawer-dict-word').textContent = word;
                                    document.getElementById('drawer-dict-def').textContent = "Çevriliyor...";
                                    document.getElementById('drawer-dict-phonetic').textContent = "...";
                                }

                                drawer.classList.add('open');
                                overlay.classList.add('active');
                            }

                            function closeSideDrawer() {
                                document.getElementById('side-drawer').classList.remove('open');
                                document.getElementById('drawer-overlay').classList.remove('active');
                                currentWordData = null;
                                if (window.speechAPI) window.speechAPI.stop();
                            }
