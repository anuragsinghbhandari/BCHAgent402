// Smart Bitcoin Cash Testnet Configuration
export const BCH_CHAIN = {
    id: 10001,
    name: "Smart Bitcoin Cash Testnet",
    rpcUrls: ["http://127.0.0.1:3000/rpc", "https://10001.rpc.thirdweb.com", "https://moeing.tech:9545", "https://rpc-testnet.smartbch.org", "http://35.220.203.194:8545"],
    blockExplorerUrls: ["https://blockhead.info/explorer/smartbch-testnet"], // Correct block explorer
    nativeCurrency: {
        name: "BCHT",
        symbol: "BCHT",
        decimals: 18
    }
};

// Payment token on Smart Bitcoin Cash Testnet (replaces previous tokens)
// Token decimals: 18
export const TOKEN_ADDRESS = "0x84b9B910527Ad5C03A9Ca831909E21e236EA7b06";
export const TOKEN_DECIMALS = 18;
export const TOKEN_SYMBOL = "TOKEN";
