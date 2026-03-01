/**
 * Speech Synthesis Wrapper V4
 * Supports dynamic language locales based on global mapping.
 */

class SpeechService {
    constructor() {
        this.synth = window.speechSynthesis;
        this.utterance = new SpeechSynthesisUtterance();
    }

    speak(text, rate = 1.0) {
        if (this.synth.speaking) {
            this.synth.cancel();
        }

        if (text !== '') {
            this.utterance.text = text;
            this.utterance.rate = rate;

            // V4 Multi-Language Mapping
            if (window.globals && window.globals.getActiveLanguageMap) {
                this.utterance.lang = window.globals.getActiveLanguageMap().speech;
            } else {
                this.utterance.lang = 'en-US'; // Fallback
            }

            this.synth.speak(this.utterance);
        }
    }

    stop() {
        if (this.synth.speaking) {
            this.synth.cancel();
        }
    }
}

// Global instance
window.speechAPI = new SpeechService();
