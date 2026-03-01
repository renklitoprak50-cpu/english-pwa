/**
 * Global State & SaaS Layer (Free vs Premium)
 */

// Toggle this to test Free vs Premium features
const isPremiumUser = false;

// UI Helper: Check permission and show alert/prompt if restricted
function checkPremiumAction(actionName) {
    if (isPremiumUser) return true;

    // Create a toast or alert for restricted actions
    alert(`👑 Premium Feature: ${actionName} is only available to Premium users.`);
    return false;
}

// Global scope
window.globals = {
    isPremium: isPremiumUser,
    checkPremiumAction
};
