import { QRCodeSVG } from "qrcode.react";
import type { BuilderNode, FundIntentResponse } from "../types/pipeline";

interface FundingModalProps {
  node: BuilderNode | null;
  fundIntent: FundIntentResponse | null;
  onClose: () => void;
}

export function FundingModal({ node, fundIntent, onClose }: FundingModalProps) {
  if (!node) {
    return null;
  }

  const walletAddress = node.data.walletAddress ?? fundIntent?.address;
  const balance = node.data.balanceAlgo ?? 0;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal-card" onClick={(event) => event.stopPropagation()} role="dialog">
        <div className="panel-header">
          <span className="eyebrow">Wallet Funding</span>
          <h2>{node.data.label}</h2>
        </div>
        <div className="funding-grid">
          <div className="qr-card">
            <QRCodeSVG size={180} value={fundIntent?.qrValue ?? walletAddress ?? "unavailable"} />
          </div>
          <div className="funding-details">
            <div className="stat-card">
              <span>Address</span>
              <strong>{walletAddress ?? "Deploy the pipeline to mint a wallet."}</strong>
            </div>
            <div className="stat-row">
              <div className="stat-card">
                <span>Balance</span>
                <strong>{balance.toFixed(3)} ALGO</strong>
              </div>
              <div className="stat-card">
                <span>Network</span>
                <strong>Algorand Testnet</strong>
              </div>
            </div>
            <label className="field">
              <span>Deposit amount</span>
              <input defaultValue="1.0" min="0" step="0.1" type="number" />
            </label>
            <div className="funding-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  if (walletAddress) {
                    navigator.clipboard.writeText(walletAddress);
                  }
                }}
                type="button"
              >
                Copy address
              </button>
              <button className="secondary-button disabled-button" disabled type="button">
                Pera direct send next
              </button>
            </div>
            <div className="funding-links">
              <a
                href={fundIntent?.faucetUrl ?? "https://bank.testnet.algorand.network/"}
                rel="noreferrer"
                target="_blank"
              >
                Open testnet faucet
              </a>
              {fundIntent?.loraUrl ? (
                <a href={fundIntent.loraUrl} rel="noreferrer" target="_blank">
                  View on Lora
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
