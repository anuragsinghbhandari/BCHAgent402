// Payment utility functions — BCH chipnet version

/**
 * Format a USD cost amount for display.
 * Amount is stored as USD (e.g. "0.01" = $0.01 USD).
 * @param {number|string} amount - USD amount
 * @returns {string} formatted string e.g. "$0.01 USD"
 */
export const formatSFUEL = (amount) => {
    try {
        if (!amount && amount !== 0) return '$0.00 USD';
        const num = parseFloat(amount);
        if (isNaN(num)) return `$${amount} USD`;
        if (num === 0) return 'Free';
        // Show 2 decimal places for amounts >= $0.01, otherwise show more precision
        if (num >= 0.01) return `$${num.toFixed(2)} USD`;
        return `$${num.toFixed(4)} USD`;
    } catch (e) {
        console.warn('Error formatting cost:', e);
        return `$${amount} USD`;
    }
};
