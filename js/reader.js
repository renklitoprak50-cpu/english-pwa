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
        
        ttsUtterance.rate = window.ttsRate || parseFloat(localStorage.getItem('ttsRate')) || 1.0;

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

    // V12 Modern Theme Switch logic
    const themeBtns = document.querySelectorAll('.theme-btn');
    themeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const theme = e.target.getAttribute('data-theme');

            // Adjust body class (if we need it for outer UI)
            document.body.className = theme === 'light' ? 'light-theme' : (theme === 'sepia' ? 'sepia-theme' : 'dark-theme');
            document.body.style.background = theme === 'light' ? '#f4f4f9' : (theme === 'sepia' ? '#fbf0d9' : '#111827');

            themeBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            // Apply to EPUB explicitly using predefined themes
            if (window.epubRendition) {
                window.epubRendition.themes.select(theme);
            }

            try {
                const storedSettings = JSON.parse(localStorage.getItem('epub_settings') || '{}');
                storedSettings.theme = theme;
                localStorage.setItem('epub_settings', JSON.stringify(storedSettings));
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
        const listenBtn = document.createElement('button');
        listenBtn.id = 'btn-epub-listen';
        listenBtn.className = 'btn primary';
        listenBtn.style.cssText = 'pointer-events: auto; font-weight: bold; border-radius: 20px; box-shadow: 0 4px 10px rgba(59, 130, 246, 0.4); padding: 6px 12px; display: flex; align-items: center; gap: 4px; font-size: 0.85rem;';
        listenBtn.innerHTML = '🔊 Dinle';
        epubActionBar.appendChild(listenBtn);

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

        // 1. Dinleme (TTS) Aktivasyonu
        const listenBtn = document.getElementById('btn-epub-listen');
        if (listenBtn) {
            listenBtn.addEventListener('click', async () => {
                if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
                    window.speechSynthesis.pause();
                    listenBtn.innerHTML = '▶️ Devam Et';
                } else if (window.speechSynthesis.paused) {
                    window.speechSynthesis.resume();
                    listenBtn.innerHTML = '⏸ Duraklat';
                } else {
                    listenBtn.innerHTML = '⏳ Yükleniyor...';
                    window.speechSynthesis.cancel();

                    if (epubRendition && epubRendition.currentLocation()) {
                        const loc = epubRendition.currentLocation();
                        try {
                            const range = await epubBook.getRange(loc.start.cfi, loc.end.cfi);
                            const text = range.toString().trim();

                            if (text.length > 5) {
                                const utterance = new SpeechSynthesisUtterance(text);

                                // V20: Dynamic TTS Language Detection
                                let bookLang = 'en-US';
                                try {
                                    const meta = await epubBook.loaded.metadata;
                                    if (meta && meta.language) {
                                        bookLang = meta.language;
                                    }
                                } catch (e) { console.warn("TTS Language read failed, defaulting to en-US"); }

                                utterance.lang = bookLang;

                                // V20: Universal Voice Matching
                                const voices = window.speechSynthesis.getVoices();
                                let selectedVoice = voices.find(v => v.lang.toLowerCase() === bookLang.toLowerCase());
                                if (!selectedVoice && bookLang.length >= 2) {
                                    const prefix = bookLang.substring(0, 2).toLowerCase();
                                    selectedVoice = voices.find(v => v.lang.toLowerCase().startsWith(prefix));
                                }
                                if (selectedVoice) {
                                    utterance.voice = selectedVoice;
                                }

                                utterance.rate = 1.0;

                                window._currentMobileUtterance = utterance; // Failsafe

                                utterance.onend = () => {
                                    listenBtn.innerHTML = '🔊 Dinle';

                                    // V20: TTS Synchronized Auto-Scroll Hook
                                    if (window.autoScrollInterval) {
                                        if (epubRendition) {
                                            epubRendition.next();
                                            setTimeout(() => {
                                                if (listenBtn) listenBtn.click();
                                            }, 1500); // Allow page turn to render
                                        }
                                    }
                                };
                                utterance.onerror = (e) => {
                                    console.warn('TTS Error:', e);
                                    listenBtn.innerHTML = '🔊 Dinle';
                                };

                                window.speechSynthesis.speak(utterance);
                                listenBtn.innerHTML = '⏸ Duraklat';
                            } else {
                                listenBtn.innerHTML = '🔊 Dinle';
                            }
                        } catch (e) {
                            console.error("Metin okuma hatası:", e);
                            listenBtn.innerHTML = '🔊 Dinle';
                        }
                    }
                }
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
        epubRendition.themes.fontSize(defaultZoom);

        // V9 Swipe to turn pages
        let touchStartX = 0; let touchEndX = 0;

        epubBook.ready.then(() => {
            return epubBook.locations.generate(1600);
        }).then(() => {
            if (epubRendition && window.epubBook.locations.length() > 0 && epubRendition.currentLocation()) {
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

            // Shadowing & RPG Iframe Entegrasyonu: Paragrafların sonuna mikrofon ekle
            requestAnimationFrame(() => {
                const paragraphs = doc.querySelectorAll('p, li, h1, h2, h3, div.text');
                paragraphs.forEach(p => {
                    const text = p.textContent.trim();
                    // Sadece yeterli uzunluktaki ve henüz mikrofon eklenmemiş cümlelere mühürle
                    if (text.length > 5 && !p.dataset.shadowEngaged) {
                        p.dataset.shadowEngaged = "true";

                        const micBtn = doc.createElement('button');
                        micBtn.innerHTML = '🎙️';
                        micBtn.className = 'epub-mic-btn';
                        micBtn.style.cssText = 'background:transparent; border:none; cursor:pointer; font-size:1rem; margin-left:8px; display:inline-block; opacity:0.6; padding:2px; vertical-align:middle;';

                        micBtn.onclick = (e) => {
                            e.stopPropagation();
                            // Iframe'den ana pencereye geçiş yapıp Shadowing fonksiyonunu tetikle
                            window.parent.startSentenceShadowing(text, micBtn);
                        };

                        p.style.position = 'relative'; // Stabil görünüm için
                        p.appendChild(micBtn);
                    }
                });
            });

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
