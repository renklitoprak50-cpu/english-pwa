/**
 * LingoBooks - Avatar & XP Gamification Engine
 * Handles XP gaining, Level calculation, Streaks, and Avatar evolution mapping.
 */

const AVATAR_STAGES = [
    { minLevel: 0, icon: '🥚', name: 'Egg' },
    { minLevel: 1, icon: '🐣', name: 'Hatching' },
    { minLevel: 2, icon: '🐥', name: 'Chick' },
    { minLevel: 5, icon: '🐓', name: 'Rooster' },
    { minLevel: 10, icon: '🦉', name: 'Owl' },
    { minLevel: 20, icon: '🦅', name: 'Eagle' },
    { minLevel: 30, icon: '🐲', name: 'Dragon' },
    { minLevel: 50, icon: '👑', name: 'Master' }
];

const XP_PER_LEVEL = 100;

class GameEngine {
    constructor() {
        this.profile = null;
        this.callbacks = [];
    }

    async init() {
        this.profile = await window.dbAPI.getUserProfile();
        this.checkStreak();
        this.notifyUpdate();
    }

    async checkStreak() {
        if (!this.profile) return;
        const today = new Date().toDateString();

        if (this.profile.lastActiveDate !== today) {
            const lastActive = new Date(this.profile.lastActiveDate);
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            if (this.profile.lastActiveDate === yesterday.toDateString()) {
                // Maintained streak
                this.profile.streak += 1;
            } else if (this.profile.lastActiveDate !== null) {
                // Lost streak
                this.profile.streak = 1;
            } else {
                // First day
                this.profile.streak = 1;
            }
            this.profile.lastActiveDate = today;
            await window.dbAPI.saveUserProfile(this.profile);
        }
    }

    getAvatar() {
        let currentStage = AVATAR_STAGES[0];
        for (let stage of AVATAR_STAGES) {
            if (this.profile && this.profile.level >= stage.minLevel) {
                currentStage = stage;
            } else {
                break; // Because array is sorted
            }
        }
        return currentStage;
    }

    async addXP(amount) {
        if (!this.profile) return;

        const previousLevel = this.profile.level;
        this.profile.xp += amount;
        this.profile.level = Math.floor(this.profile.xp / XP_PER_LEVEL);

        await window.dbAPI.saveUserProfile(this.profile);

        if (this.profile.level > previousLevel) {
            this.triggerLevelUp();
        }

        this.notifyUpdate();
    }

    triggerLevelUp() {
        const avatar = this.getAvatar();
        // Play sound or show simple alert for now
        alert(`🎉 Level Up! You are now Level ${this.profile.level}. Avatar: ${avatar.icon} ${avatar.name}`);
    }

    onUpdate(callback) {
        this.callbacks.push(callback);
    }

    notifyUpdate() {
        if (!this.profile) return;
        const avatar = this.getAvatar();
        const nextLevelXP = (this.profile.level + 1) * XP_PER_LEVEL;
        const currentLevelProgress = this.profile.xp % XP_PER_LEVEL;
        const progressPercent = (currentLevelProgress / XP_PER_LEVEL) * 100;

        const stateObj = {
            xp: this.profile.xp,
            level: this.profile.level,
            streak: this.profile.streak,
            avatarIcon: avatar.icon,
            avatarName: avatar.name,
            progressPercent: progressPercent,
            nextLevelXP: nextLevelXP
        };

        this.callbacks.forEach(cb => cb(stateObj));
    }
}

// Expose globally
window.GameEngine = new GameEngine();
document.addEventListener('DOMContentLoaded', () => {
    window.GameEngine.init();
});
