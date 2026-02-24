import React from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/Button';
import './Landing.css';

const Landing = () => {
    const navigate = useNavigate();

    return (
        <div className="landing">
            {/* Hero Section */}
            <section className="hero">
                <div className="container">
                    <h1 className="hero-title">
                        MONETIZE AI AGENTS<br />
                        WITH INTERNET-NATIVE<br />
                        PAYMENTS
                    </h1>
                    <p className="hero-subtitle">
                        The open standard for machine-to-machine commerce. <br />
                        Powered by BCH chipnet — real micropayments, no smart contracts needed.
                    </p>
                    <div className="hero-ctas">
                        <Button
                            className="btn-primary-glow"
                            variant="primary"
                            size="lg"
                            onClick={() => navigate('/agent')}
                        >
                            Launch Agent 402
                        </Button>
                        <Button
                            variant="secondary"
                            size="lg"
                            onClick={() => navigate('/marketplace')}
                        >
                            View Marketplace
                        </Button>
                    </div>
                </div>
            </section>

            {/* SECTION 1: x402 Protocol Flow */}
            <section className="protocol-section">
                <div className="container">
                    <span className="section-label">THE PROTOCOL</span>
                    <h2 className="section-title">x402 ON BCH CHIPNET</h2>
                    <p className="section-subtitle">
                        A standardized HTTP 402 implementation for autonomous agent transactions,
                        settled in native BCH — fast, cheap, and censorship-resistant.
                    </p>

                    <div className="step-list">
                        <div className="step-item">
                            <div className="step-number">01</div>
                            <div className="step-title">INTENT</div>
                            <div className="step-desc">
                                Agent discovers tool via AI marketplace. <br />
                                Server runs the tool immediately — <strong>no payment needed yet</strong>.
                            </div>
                        </div>
                        <div className="step-item">
                            <div className="step-number">02</div>
                            <div className="step-title">402 CHALLENGE</div>
                            <div className="step-desc">
                                If the tool succeeds, the server returns HTTP 402 with a <strong>resultId</strong>
                                and a BCH payment address. Tool cost displayed in USD.
                            </div>
                        </div>
                        <div className="step-item">
                            <div className="step-number">03</div>
                            <div className="step-title">BCH PAYMENT</div>
                            <div className="step-desc">
                                Worker wallet sends <strong>native tBCH</strong> directly to the tool provider.
                                No EVM. No gas. Transaction confirms in seconds.
                            </div>
                        </div>
                        <div className="step-item">
                            <div className="step-number">04</div>
                            <div className="step-title">DELIVER</div>
                            <div className="step-desc">
                                Agent sends the <strong>tx hash + resultId</strong> to claim the pre-executed result.
                                Verifiable on BCH chipnet explorer.
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* SECTION 2: Refund Guarantee (BCH-native, no smart contracts) */}
            <section className="protocol-section" style={{ background: '#000', color: '#fff' }}>
                <div className="container">
                    <span className="section-label" style={{ color: '#ccc' }}>THE GUARANTEE</span>
                    <h2 className="section-title" style={{ color: '#fff' }}>EXECUTE-FIRST · PAY-TO-CLAIM</h2>
                    <p className="section-subtitle" style={{ color: '#ccc', borderLeftColor: '#fff' }}>
                        Refund-safe by design — no smart contract or escrow needed on native BCH.
                    </p>

                    <div className="swiss-grid">
                        <div className="grid-cell dark">
                            <h3 className="cell-title">NO UPFRONT RISK</h3>
                            <p className="cell-desc">
                                Tools run <strong>before payment is charged</strong>. If the tool fails,
                                no BCH is spent — the agent simply receives an error, not a bill.
                            </p>
                        </div>
                        <div className="grid-cell dark">
                            <h3 className="cell-title">ON-CHAIN PROOF</h3>
                            <p className="cell-desc">
                                Every successful payment generates a BCH transaction hash,
                                verifiable on <strong>chipnet.imaginary.cash</strong> — a permanent, immutable record.
                            </p>
                        </div>
                        <div className="grid-cell dark">
                            <h3 className="cell-title">PARALLEL WORKERS</h3>
                            <p className="cell-desc">
                                4 independent worker wallets run tool calls concurrently.
                                Each funded from the agent wallet on demand — budget stays in control.
                            </p>
                        </div>
                        <div className="grid-cell dark">
                            <h3 className="cell-title">5-MIN RESULT WINDOW</h3>
                            <p className="cell-desc">
                                Pre-executed results are cached for 5 minutes. Pay and claim with the
                                resultId. Expired results are discarded — no runaway charges.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* SECTION 3: Use Cases */}
            <section className="protocol-section">
                <div className="container">
                    <span className="section-label">UTILITY</span>
                    <h2 className="section-title">USE CASES</h2>

                    <div className="swiss-grid col-2">
                        <div className="grid-cell">
                            <h3 className="cell-title">API MONETIZATION</h3>
                            <p className="cell-desc">Charge BCH per API call. No user accounts, no subscriptions, no middlemen.</p>
                        </div>
                        <div className="grid-cell">
                            <h3 className="cell-title">AGENT SWARMS</h3>
                            <p className="cell-desc">Orchestrate multi-agent systems with a shared BCH bankroll and worker pool.</p>
                        </div>
                        <div className="grid-cell">
                            <h3 className="cell-title">PAY-PER-PROMPT</h3>
                            <p className="cell-desc">Metered AI tool access for cents per call — priced in USD, settled in BCH.</p>
                        </div>
                        <div className="grid-cell">
                            <h3 className="cell-title">ZERO-RISK TRIALS</h3>
                            <p className="cell-desc">Execute-first model means failed tools never charge the agent. Test freely.</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="footer">
                <div className="container">
                    <div className="footer-content">
                        <div className="footer-brand">
                            <div className="footer-logo">
                                AGENT PAY
                            </div>
                            <p style={{ maxWidth: '300px', lineHeight: '1.6' }}>
                                The financial layer for the autonomous agent economy. Built on BCH &amp; x402.
                            </p>
                        </div>

                        <div className="footer-links">
                            <div className="footer-column">
                                <h4>PRODUCT</h4>
                                <a href="/agent">Agent Interface</a>
                                <a href="/marketplace">Marketplace</a>
                                <a href="/add-tool">Add Tool</a>
                            </div>

                            <div className="footer-column">
                                <h4>RESOURCES</h4>
                                <a href="https://chipnet.imaginary.cash" target="_blank" rel="noopener noreferrer">BCH Chipnet Explorer</a>
                                <a href="https://tbch.googol.cash" target="_blank" rel="noopener noreferrer">Get tBCH (Faucet)</a>
                                <a href="https://x402.org" target="_blank" rel="noopener noreferrer">x402 Protocol</a>
                            </div>
                        </div>
                    </div>

                    <div className="footer-bottom">
                        <p>
                            POWERED BY <span className="stellar-badge">BCH CHIPNET</span> <span className="x402-badge">x402</span>
                        </p>
                        <div style={{ marginTop: '16px' }}>
                            © 2026 AGENT402. PAY PER USE AGENT ECONOMY
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default Landing;
