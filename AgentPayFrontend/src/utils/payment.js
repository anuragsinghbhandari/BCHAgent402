// Payment utility functions

export const formatSFUEL = (amount) => {
    try {
        if (!amount) return "0 LINK";
        // Amount is already in human-readable LINK (e.g. "1" = 1 LINK)
        const num = parseFloat(amount);
        if (isNaN(num)) return `${amount} LINK`;
        // Show up to 4 decimals, trim trailing zeros
        return `${parseFloat(num.toFixed(4))} LINK`;
    } catch (e) {
        console.warn("Error formatting LINK:", e);
        return `${amount} LINK`;
    }
};
