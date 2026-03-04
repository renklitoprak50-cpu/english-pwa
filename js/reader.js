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
        console.error("Kitap yükleme hatası:", err);
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

    const bookId = meta.id || meta.ia_id;

    // V8 True EPUB Logic
    if (meta.epub_url) {
        fallbackBar.classList.remove('hidden');
        if (fallbackText) fallbackText.textContent = "Okuyucu Yükleniyor (EPUB)...";
        fallbackBar.style.background = 'var(--accent-primary)';
        fallbackBar.style.color = '#fff';
        if (textLayer) textLayer.classList.add('hidden');

        try {
            // Check cache for arrayBuffer
            const cachedEpub = await window.dbAPI.getBookContent(bookId + "_epub");
            let arrayBuffer;
            if (cachedEpub) {
                arrayBuffer = cachedEpub;
            } else {
                const proxyUrl = '/api/proxy?url=' + encodeURIComponent(meta.epub_url);
                const res = await fetch(proxyUrl);
                if (!res.ok) throw new Error("EPUB Fetch failed");
                arrayBuffer = await res.arrayBuffer();
                await window.dbAPI.saveBookContent(bookId + "_epub", arrayBuffer);
            }
            fallbackBar.classList.add('hidden');
            initEpubReader(arrayBuffer);
            return;
        } catch (e) {
            console.warn("EPUB failed, falling back to text", e);
        }
    }

    // 1. Check Local DB (Single-Fetch constraint)
    const cachedText = await window.dbAPI.getBookContent(bookId);
    if (cachedText) {
        renderNativeText(cachedText, textLayer, textTarget, ttsController);
        return;
    }

    // 2. Client-Side Fetch
    fallbackBar.classList.remove('hidden');
    if (fallbackText) fallbackText.textContent = "Kitap indiriliyor...";
    fallbackBar.style.background = 'var(--accent-primary)';
    fallbackBar.style.color = '#fff';
    if (textLayer) textLayer.classList.add('hidden');

    try {
        let textResult = null;
        let res;

        // V8: Attempt 1 - Format URL from Gutendex via LingoBooks Proxy
        if (meta.format_url) {
            const proxyUrl = '/api/proxy?url=' + encodeURIComponent(meta.format_url);
            res = await fetch(proxyUrl);
            if (res.ok) {
                textResult = await res.text();
                // Strip HTML if it's an HTML format
                if (meta.format_url.includes('html')) {
                    const temp = document.createElement('div');
                    temp.innerHTML = textResult;
                    textResult = temp.textContent || temp.innerText || "";
                }
            }
        }

        // V8: Attempt 2 - Direct Gutenberg HTML Fallback via LingoBooks Proxy
        if (!textResult && meta.ia_id) {
            if (fallbackText) fallbackText.textContent = "Doğrudan Gutenberg bağlantısı deneniyor...";
            const directHtmlUrl = `https://www.gutenberg.org/files/${meta.ia_id}/${meta.ia_id}-h/${meta.ia_id}-h.htm`;
            const proxyHtmlUrl = '/api/proxy?url=' + encodeURIComponent(directHtmlUrl);

            res = await fetch(proxyHtmlUrl);
            if (res.ok) {
                textResult = await res.text();
                const temp = document.createElement('div');
                temp.innerHTML = textResult;
                textResult = temp.textContent || temp.innerText || "";
            }
        }

        // Attempt 3: Fallback Archive.org _djvu.txt & .txt
        if (!textResult && meta.ia_id) {
            if (fallbackText) fallbackText.textContent = "Alternatif Arşiv metni aranıyor...";
            res = await fetch(`https://archive.org/cors/${meta.ia_id}/${meta.ia_id}_djvu.txt`);
            if (res.ok) textResult = await res.text();

            if (!textResult || textResult.trim().length === 0) {
                res = await fetch(`https://archive.org/cors/${meta.ia_id}/${meta.ia_id}.txt`);
                if (res.ok) textResult = await res.text();
            }
        }

        if (textResult && textResult.trim().length > 50) {
            await window.dbAPI.saveBookContent(bookId, textResult);
            fallbackBar.classList.add('hidden');
            renderNativeText(textResult, textLayer, textTarget, ttsController);
        } else {
            throw new Error("Text not found or empty");
        }
    } catch (e) {
        console.warn("Direct fetch failed", e);
        if (fallbackText) fallbackText.textContent = "Metin okunamadı, eski sürüm Embed deneniyor...";
        fallbackBar.style.background = 'var(--warning)';
        fallbackBar.style.color = '#000';
        if (meta.ia_id) {
            const iframe = document.getElementById('embed-viewer');
            if (iframe) iframe.classList.remove('hidden');
            loadPlanC(meta.ia_id, iframe, fallbackBar);
        } else {
            showFinalError();
        }
    }
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

        // V8 Apple Books Style: Select to Translate
        span.addEventListener('pointerup', (e) => {
            const selection = window.getSelection();
            const word = selection.toString().trim();
            if (word && word.length > 0) {
                handleWordSelection(word, chunk.trim());
                e.stopPropagation();
            }
        });

        target.appendChild(span);
        ttsSpans.push(span);
    });

    setupSonicTTS(target);

    // V8 Elite Pagination init
    setTimeout(() => {
        initPaginationControls();
        window.dbAPI.getProgress('currentBook').then(prog => {
            if (prog && prog.location) {
                currentColumnIndex = parseInt(prog.location) || 0;
                updatePagination();
            }
        });
    }, 150);
}

// =====================================
// V8 ELITE NATIVE PAGINATION
// =====================================
let currentColumnIndex = 0;
let totalColumns = 1;

function updatePagination() {
    const target = document.getElementById('text-render-target');
    if (!target) return;

    totalColumns = Math.ceil(target.scrollWidth / window.innerWidth);
    if (currentColumnIndex >= totalColumns) currentColumnIndex = Math.max(0, totalColumns - 1);
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

function setupSonicTTS(container) {
    const playBtn = document.getElementById('tts-play');
    const stopBtn = document.getElementById('tts-stop');
    const nextBtn = document.getElementById('tts-next');
    const prevBtn = document.getElementById('tts-prev');

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
        if (ttsSpans[index]) {
            ttsSpans[index].classList.add('tts-highlight');
            ttsSpans[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        window.speechSynthesis.cancel();
        if (currentSpanIndex >= ttsSpans.length) {
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

        ttsUtterance.onstart = () => {
            highlightSpan(currentSpanIndex);
        };

        ttsUtterance.onend = () => {
            if (isPlaying) {
                currentSpanIndex++;
                speakCurrent();
            }
        };

        ttsUtterance.onerror = (e) => {
            console.warn("TTS Error", e);
            resetPlayBtn();
        };

        window.speechSynthesis.speak(ttsUtterance);
        setPlayBtnActive();
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

    document.getElementById('drawer-dict-save')?.addEventListener('click', async (e) => {
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

    document.getElementById('drawer-close')?.addEventListener('click', closeSideDrawer);
    document.getElementById('drawer-overlay')?.addEventListener('click', closeSideDrawer);

    // V8 Theme Settings
    const themeBtns = document.querySelectorAll('.theme-btn');
    themeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const theme = e.target.getAttribute('data-theme');
            document.body.className = theme === 'light' ? '' : `${theme}-theme`;
            themeBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            // Apply to EPUB if active
            if (epubRendition) {
                let color = theme === 'dark' ? '#fff' : '#3d3024';
                if (theme === 'light') color = '#000';
                epubRendition.themes.default({ body: { "color": `${color} !important` } });
            }
        });
    });

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
            if (progressText) progressText.textContent = `${e.target.value}%`;
        });

        window.addEventListener('epub-relocated', (e) => {
            if (epubBook && epubBook.locations && epubBook.locations.length() > 0) {
                const percentage = epubBook.locations.percentageFromCfi(e.detail.start.cfi);
                const val = Math.round(percentage * 100);
                slider.value = val;
                if (progressText) progressText.textContent = `${val}%`;
            }
        });
        // V9 Settings Sync UI 
        document.getElementById('toggle-spread')?.addEventListener('click', (e) => {
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

        const zoomSlider = document.getElementById('zoom-slider');
        const zoomVal = document.getElementById('zoom-text-val');
        if (zoomSlider && zoomVal) {
            zoomSlider.addEventListener('input', (e) => {
                zoomVal.textContent = `${e.target.value}%`;
            });
            zoomSlider.addEventListener('change', (e) => {
                if (!epubRendition) return;
                const newZoom = `${e.target.value}%`;
                epubRendition.themes.fontSize(newZoom);

                const currentSettings = JSON.parse(localStorage.getItem('epub_settings') || '{}');
                currentSettings.zoom = e.target.value;
                localStorage.setItem('epub_settings', JSON.stringify(currentSettings));
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

        epubBook = ePub(arrayBuffer);

        // V9 True EPUB Settings defaults
        let defaultSpread = 'auto'; // Will be mapped to 'none' or 'auto'
        let defaultZoom = '100%';

        try {
            const storedSettings = localStorage.getItem('epub_settings');
            if (storedSettings) {
                const parsed = JSON.parse(storedSettings);
                if (parsed.spread === false) defaultSpread = 'none';
                if (parsed.zoom) defaultZoom = `${parsed.zoom}%`;

                // Sync UI state
                const toggleSpreadBtn = document.getElementById('toggle-spread');
                if (toggleSpreadBtn) {
                    toggleSpreadBtn.textContent = parsed.spread === false ? '📖 Çift Sayfa Görünümü: Kapalı' : '📖 Çift Sayfa Görünümü: Açık';
                }
                const zoomSlider = document.getElementById('zoom-slider');
                const zoomVal = document.getElementById('zoom-text-val');
                if (zoomSlider && zoomVal) {
                    zoomSlider.value = parsed.zoom || 100;
                    zoomVal.textContent = defaultZoom;
                }
            }
        } catch (e) {
            console.warn("Failed to load epub settings from localStorage", e);
        }

        epubRendition = epubBook.renderTo("epub-render-target", {
            width: "100%", height: "100%", spread: defaultSpread
        });

        epubRendition.themes.fontSize(defaultZoom);

        epubBook.ready.then(() => {
            // Generate locations for slider logic
            return epubBook.locations.generate(1600);
        }).then(() => {
            // Locations generated, slider is now ready to use percentage
        });

        window.dbAPI.getProgress('currentBook').then(prog => {
            if (prog && prog.location) epubRendition.display(prog.location);
            else epubRendition.display();
        });

        epubRendition.on("relocated", (location) => {
            window.dbAPI.saveProgress('currentBook', location.start.cfi);
            // Dispatch event for Slider to update
            window.dispatchEvent(new CustomEvent('epub-relocated', { detail: location }));
        });

        epubRendition.hooks.content.register((contents, view) => {
            // V8: Let the book breathe, minimal overrides to keep original book layout
            contents.addStylesheetRules([
                ['body', ['background-color: transparent !important', 'color: var(--text-primary) !important']]
            ]);

            const doc = contents.document;
            // V8 Apple Books Style: Select to Translate
            doc.addEventListener('pointerup', (e) => {
                const selection = contents.window.getSelection();
                if (!selection) return;
                const text = selection.toString().trim();
                if (text && text.length > 0) {
                    let node = selection.anchorNode;
                    let context = "";
                    while (node && node.nodeName !== 'P' && node.nodeName !== 'DIV') node = node.parentNode;
                    if (node) context = node.textContent.trim().substring(0, 150) + "...";
                    handleWordSelection(text, context);
                    e.stopPropagation();
                }
            });

            // Tap to toggle menu or turn pages
            doc.addEventListener('click', (e) => {
                if (contents.window.getSelection().toString().trim().length > 0) return;
                const x = e.clientX;
                const width = contents.window.innerWidth;
                if (x < width * 0.2) epubRendition.prev();
                else if (x > width * 0.8) epubRendition.next();
                else {
                    document.querySelectorAll('.floating-ui').forEach(ui => ui.classList.toggle('active'));
                }
            });

            // V9 Swipe to turn pages
            let touchStartX = 0;
            let touchEndX = 0;

            doc.addEventListener('touchstart', e => {
                touchStartX = e.changedTouches[0].screenX;
            }, false);

            doc.addEventListener('touchend', e => {
                touchEndX = e.changedTouches[0].screenX;
                handleSwipe();
            }, false);

            function handleSwipe() {
                const swipeThreshold = 50;
                if (touchEndX < touchStartX - swipeThreshold) {
                    epubRendition.next(); // Swipe left -> next
                }
                if (touchEndX > touchStartX + swipeThreshold) {
                    epubRendition.prev(); // Swipe right -> prev
                }
            }
        });
    }

    // =====================================
    // DICTIONARY (V8 Side Drawer)
    // =====================================
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
});
