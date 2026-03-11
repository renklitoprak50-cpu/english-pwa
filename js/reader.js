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

    // V9 Legacy Metadata Patch: Reconstruct EPUB URL if missing from Old Caches
    if (meta.isGutenberg && !meta.epub_url && meta.ia_id) {
        meta.epub_url = `https://www.gutenberg.org/ebooks/${meta.ia_id}.epub.images`;
    }

    // V8 True EPUB Logic
    if (meta.epub_url) {
        fallbackBar.classList.remove('hidden');
        if (fallbackText) fallbackText.textContent = "Okuyucu Yükleniyor (EPUB)...";
        fallbackBar.style.background = 'var(--accent-primary)';
        fallbackBar.style.color = '#fff';
        if (textLayer) textLayer.classList.add('hidden');

        try {
            // Check cache for arrayBuffer with Mühür (Sealed) priority
            const cachedEpub = await window.dbAPI.getBookContent(cacheKey + "_epub");
            let arrayBuffer;
            if (cachedEpub) {
                arrayBuffer = cachedEpub;
            } else {
                // Try Vercel Serverless Proxy
                let res = await fetch('/api/proxy?url=' + encodeURIComponent(meta.epub_url), { redirect: 'follow' });

                // If Vercel Proxy fails (e.g., 4.5MB payload limit on Serverless Functions), fallback to allorigins.win
                if (!res.ok) {
                    console.warn("Vercel proxy failed, trying allorigins fallback...");
                    res = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(meta.epub_url), { redirect: 'follow' });
                }

                // Final fallback just in case
                if (!res.ok) {
                    console.warn("Allorigins failed, trying corsproxy.io...");
                    res = await fetch('https://corsproxy.io/?' + encodeURIComponent(meta.epub_url), { redirect: 'follow' });
                }

                if (!res.ok) throw new Error("All EPUB Proxies Failed");

                arrayBuffer = await res.arrayBuffer();
                await window.dbAPI.saveBookContent(cacheKey + "_epub", arrayBuffer);
            }
            fallbackBar.classList.add('hidden');
            initEpubReader(arrayBuffer);
            return; // STRICT RETURN: We NEVER fall back to text if EPUB is available.
        } catch (e) {
            console.error("CRITICAL: EPUB Download completely failed. Falling back to text as last resort.", e);
        }
    }

    // 1. Check Local DB (Single-Fetch constraint)
    const cachedText = await window.dbAPI.getBookContent(cacheKey);
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
            res = await fetch(proxyUrl, { redirect: 'follow' });
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

            res = await fetch(proxyHtmlUrl, { redirect: 'follow' });
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
            res = await fetch(`https://archive.org/cors/${meta.ia_id}/${meta.ia_id}_djvu.txt`, { redirect: 'follow' });
            if (res.ok) textResult = await res.text();

            if (!textResult || textResult.trim().length === 0) {
                res = await fetch(`https://archive.org/cors/${meta.ia_id}/${meta.ia_id}.txt`, { redirect: 'follow' });
                if (res.ok) textResult = await res.text();
            }
        }

        if (textResult && textResult.trim().length > 50) {
            await window.dbAPI.saveBookContent(cacheKey, textResult);
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

        if (window.GameEngine) {
            window.GameEngine.addXP(Math.round(finalScore / 10));
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
function setupControls() {
    const btnBack = document.getElementById('btn-back');
    if (btnBack) btnBack.addEventListener('click', () => window.location.href = 'index.html');

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
                if (!epubRendition) return;
                const newZoom = `${e.target.value}%`;
                epubRendition.themes.fontSize(newZoom);

                const currentSettings = JSON.parse(localStorage.getItem('epub_settings') || '{}');
                currentSettings.zoom = e.target.value;
                localStorage.setItem('epub_settings', JSON.stringify(currentSettings));
            });
        }
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

    // V9 Native EPUB.js Selection Event (Dictionary Integration)
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
        // V8: Let the book breathe, minimal overrides to keep original book layout
        contents.addStylesheetRules([
            ['body', ['background-color: transparent !important', 'color: var(--text-primary) !important']]
        ]);

        const doc = contents.document;

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
