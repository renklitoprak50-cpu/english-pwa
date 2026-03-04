/**
 * LingoBooks - Boss Fight Module
 * Generates a Boss Fight from the top 5 most errored words in the dictionary.
 * Includes Health mechanics, Tailwind Modal rendering, and XP rewards.
 */

class BossFight {
    constructor() {
        this.bossMaxHP = 100;
        this.bossCurrentHP = 100;
        this.playerMaxHearts = 3;
        this.playerCurrentHearts = 3;

        this.words = [];
        this.currentWordIndex = 0;

        this.isDefeated = false;
    }

    async initFight() {
        // Fetch Top 5 words with most errors
        const allWords = await window.dbAPI.getAllWords();
        if (!allWords || allWords.length < 5) {
            alert("Önce kitap okuyup en az 5 kelimenin anlamına bakmalısın!");
            return false; // Not enough words
        }

        // Sort descending by errorCount, fallback to timestamp if no errors
        const sortedWords = allWords.sort((a, b) => {
            const errA = a.errorCount || 0;
            const errB = b.errorCount || 0;
            if (errA === errB) return b.timestamp - a.timestamp;
            return errB - errA;
        });

        this.words = sortedWords.slice(0, 5);
        this.bossCurrentHP = 100;
        this.playerCurrentHearts = 3;
        this.currentWordIndex = 0;
        this.isDefeated = false;

        this.renderModal();
        this.nextQuestion();
        return true;
    }

    renderModal() {
        // Remove existing if any
        let modal = document.getElementById('boss-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'boss-modal';
        modal.className = 'fixed inset-0 z-[9999] p-4 flex items-center justify-center bg-gray-900 bg-opacity-90';

        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-6 w-full max-w-lg flex flex-col items-center">
                <!-- Header / Titles -->
                <div class="text-center mb-6 w-full">
                    <h2 class="text-3xl font-black text-red-600 tracking-tighter uppercase mb-1 drop-shadow-sm">Bölüm Sonu Canavarı</h2>
                    <p class="text-gray-500 dark:text-gray-300 text-sm font-medium">Zorlandığın kelimeleri yen!</p>
                </div>

                <!-- Battle Arena Status -->
                <div class="w-full flex justify-between items-center mb-8 px-2">
                    <!-- Player Hearts -->
                    <div class="flex flex-col items-start gap-1">
                        <span class="text-xs font-bold text-gray-500 uppercase tracking-widest">Sen</span>
                        <div id="boss-player-hearts" class="flex gap-1 text-2xl drop-shadow-md">
                            ❤️❤️❤️
                        </div>
                    </div>

                    <!-- VS -->
                    <div class="text-xl font-black text-gray-300 italic px-2">VS</div>

                    <!-- Boss Health -->
                    <div class="flex flex-col items-end gap-1 w-1/2">
                        <span class="text-xs font-bold text-gray-500 uppercase tracking-widest">Canavar (👿)</span>
                        <div class="w-full bg-gray-200 rounded-full h-4 overflow-hidden border border-gray-300 shadow-inner">
                            <div id="boss-hp-bar" class="bg-red-500 h-full transition-all duration-300 ease-out" style="width: 100%"></div>
                        </div>
                    </div>
                </div>

                <!-- Question Area -->
                <div id="boss-question-area" class="w-full text-center flex flex-col gap-6 w-full">
                    <div class="bg-blue-50 dark:bg-blue-900/30 p-6 rounded-2xl border-2 border-blue-100 dark:border-blue-800">
                        <span class="text-xs font-bold text-blue-500 dark:text-blue-400 uppercase tracking-widest mb-2 block">Hedef Kelime</span>
                        <h3 id="boss-target-word" class="text-4xl font-black text-gray-800 dark:text-white capitalize">Loading...</h3>
                    </div>
                    
                    <div id="boss-options" class="flex flex-col gap-3 w-full">
                        <!-- Buttons injected here -->
                    </div>
                </div>

                <!-- Result Message -->
                 <div id="boss-result-message" class="hidden w-full text-center mt-6">
                    <h3 id="boss-result-title" class="text-3xl font-black mb-2 uppercase"></h3>
                    <p id="boss-result-subtitle" class="text-gray-600 dark:text-gray-300 mb-6 font-medium"></p>
                    <button id="boss-btn-close" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg transition-transform active:scale-95 text-xl">
                        Savaştan Çık
                    </button>
                 </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('boss-btn-close').addEventListener('click', () => {
            modal.remove();
        });
    }

    updateUI() {
        const heartsContainer = document.getElementById('boss-player-hearts');
        if (heartsContainer) {
            let heartsHtml = '';
            for (let i = 0; i < this.playerMaxHearts; i++) {
                heartsHtml += i < this.playerCurrentHearts ? '❤️' : '🤍';
            }
            heartsContainer.innerHTML = heartsHtml;
        }

        const hpBar = document.getElementById('boss-hp-bar');
        if (hpBar) {
            const pct = Math.max(0, (this.bossCurrentHP / this.bossMaxHP) * 100);
            hpBar.style.width = pct + '%';
        }
    }

    async nextQuestion() {
        if (this.playerCurrentHearts <= 0) {
            this.endFight(false);
            return;
        }

        if (this.bossCurrentHP <= 0 || this.currentWordIndex >= this.words.length) {
            // If we went through all 5 without dying, boss is defeated. Boss HP logic: -20 per hit. 5 hits = 100.
            if (this.bossCurrentHP > 0) {
                this.bossCurrentHP = 0;
                this.updateUI();
            }
            this.endFight(true);
            return;
        }

        const currentWordObj = this.words[this.currentWordIndex];
        document.getElementById('boss-target-word').textContent = currentWordObj.word;

        // Generate options (1 correct, 3 random wrong from DB)
        const allWords = await window.dbAPI.getAllWords();
        let options = [currentWordObj.definition ? currentWordObj.definition.translation : 'Bilinmeyen Çeviri (Veri hatası)'];

        while (options.length < 4 && options.length < allWords.length) {
            const randomWord = allWords[Math.floor(Math.random() * allWords.length)];
            const rndTra = randomWord.definition ? randomWord.definition.translation : null;
            if (rndTra && options.indexOf(rndTra) === -1) {
                options.push(rndTra);
            }
        }

        // Shuffle options
        options = options.sort(() => .5 - Math.random());

        const optionsContainer = document.getElementById('boss-options');
        optionsContainer.innerHTML = '';

        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 font-bold py-4 px-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-600 text-lg transition-all active:scale-[0.98]';
            btn.textContent = opt;
            btn.onclick = () => this.handleAnswer(opt, currentWordObj);
            optionsContainer.appendChild(btn);
        });
    }

    async handleAnswer(selectedOption, wordObj) {
        const isCorrect = selectedOption === (wordObj.definition ? wordObj.definition.translation : '');

        // Update DB word stats
        await window.dbAPI.updateWordCount(wordObj.id, isCorrect);

        const optionsContainer = document.getElementById('boss-options');
        Array.from(optionsContainer.children).forEach(btn => {
            btn.disabled = true;
            if (btn.textContent === (wordObj.definition ? wordObj.definition.translation : '')) {
                btn.classList.add('!bg-green-500', '!text-white', '!border-green-600');
            } else if (btn.textContent === selectedOption && !isCorrect) {
                btn.classList.add('!bg-red-500', '!text-white', '!border-red-600');
            }
        });

        if (isCorrect) {
            this.bossCurrentHP -= 20; // 5 kelime, 20 damage each
        } else {
            this.playerCurrentHearts -= 1;
        }

        this.updateUI();
        this.currentWordIndex++;

        setTimeout(() => {
            this.nextQuestion();
        }, 1500);
    }

    async endFight(won) {
        document.getElementById('boss-question-area').classList.add('hidden');
        const resDiv = document.getElementById('boss-result-message');
        resDiv.classList.remove('hidden');

        const title = document.getElementById('boss-result-title');
        const sub = document.getElementById('boss-result-subtitle');

        if (won) {
            this.isDefeated = true;
            title.textContent = "🏆 Zafer!";
            title.classList.add('text-green-600');
            sub.textContent = "+100 XP Kazandın! Canavarı dize getirdin.";
            if (window.GameEngine) {
                await window.GameEngine.addXP(100);
            }
        } else {
            title.textContent = "💀 Yenilgi...";
            title.classList.add('text-red-600');
            sub.textContent = "Kelimelere biraz daha çalışıp tekrar gel!";
        }
    }
}

// Global exposure
window.BossFight = new BossFight();
