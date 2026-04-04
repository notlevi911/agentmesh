# Demo Flow

## Golden Path

1. Open the builder and deploy the default Market Analyzer pipeline.
2. Fund the Analyzer wallet from the funding modal using the QR code or testnet faucet.
3. Copy the generated endpoint from the right-hand deployment panel.
4. Trigger `Run Demo Request` to simulate a paid call and inspect the runtime log panel.
5. Watch balance polling refresh agent wallets every five seconds.

## Builder Defaults

- Trigger node for inbound API requests
- Analyzer agent priced at `0.01 ALGO`
- Weather service priced at `0.001 ALGO`
- Responder agent for the final answer
- End node for the HTTP response
