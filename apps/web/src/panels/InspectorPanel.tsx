import type { DeployResponse } from "../types/pipeline";
import type { BuilderNode, PipelineNodeData } from "../types/pipeline";

interface InspectorPanelProps {
  selectedNode: BuilderNode | null;
  deployment: DeployResponse | null;
  onCopyEndpoint: () => void;
  onNodeChange: (nodeId: string, updates: Partial<PipelineNodeData>) => void;
}

export function InspectorPanel({
  selectedNode,
  deployment,
  onCopyEndpoint,
  onNodeChange,
}: InspectorPanelProps) {
  return (
    <aside className="studio-panel panel-pad inspector-panel">
      <div className="panel-header-block">
        <span className="eyebrow">Inspector</span>
        <h2>Properties</h2>
      </div>

      {selectedNode ? (
        <div className="inspector-form">
          <label className="field">
            <span>Name</span>
            <input
              className="prop-input"
              onChange={(event) => onNodeChange(selectedNode.id, { label: event.target.value })}
              value={selectedNode.data.label}
            />
          </label>

          <label className="field">
            <span>Description</span>
            <textarea
              className="prop-input prop-textarea"
              onChange={(event) =>
                onNodeChange(selectedNode.id, { description: event.target.value })
              }
              value={selectedNode.data.description ?? ""}
            />
          </label>

          {selectedNode.type === "agent" ? (
            <>
              <label className="field">
                <span>Role</span>
                <input
                  className="prop-input"
                  onChange={(event) => onNodeChange(selectedNode.id, { role: event.target.value })}
                  value={selectedNode.data.role ?? ""}
                />
              </label>
              <label className="field">
                <span>Prompt</span>
                <textarea
                  className="prop-input prop-textarea tall-textarea"
                  onChange={(event) =>
                    onNodeChange(selectedNode.id, { systemPrompt: event.target.value })
                  }
                  value={selectedNode.data.systemPrompt ?? ""}
                />
              </label>
              <label className="field">
                <span>Price per call (ALGO)</span>
                <input
                  className="prop-input"
                  min="0"
                  onChange={(event) =>
                    onNodeChange(selectedNode.id, { priceAlgo: Number(event.target.value) || 0 })
                  }
                  step="0.001"
                  type="number"
                  value={selectedNode.data.priceAlgo ?? 0}
                />
              </label>
              <label className="field">
                <span>Treasury wallet</span>
                <input
                  className="prop-input"
                  onChange={(event) =>
                    onNodeChange(selectedNode.id, { treasuryAddress: event.target.value })
                  }
                  placeholder="Optional Algorand address for storing earned funds"
                  value={selectedNode.data.treasuryAddress ?? ""}
                />
              </label>
              <div className="field">
                <span>Tool access</span>
                <p className="empty-state">
                  Connect tools from the canvas using the agent&apos;s top dot. Side dots stay reserved for workflow routing.
                </p>
              </div>
              <div className="wallet-summary">
                <span>Wallet</span>
                <strong>{selectedNode.data.walletAddress ?? "Deploy to create wallet"}</strong>
                <span>Treasury</span>
                <strong>{selectedNode.data.treasuryAddress ?? "Uses agent wallet by default"}</strong>
                <span>Balance</span>
                <strong>{(selectedNode.data.balanceAlgo ?? 0).toFixed(3)} ALGO</strong>
              </div>
            </>
          ) : null}

          {selectedNode.type === "trigger" ? (
            <>
              <label className="field">
                <span>HTTP method</span>
                <select
                  className="prop-input"
                  onChange={(event) =>
                    onNodeChange(selectedNode.id, {
                      requestMethod: event.target.value as PipelineNodeData["requestMethod"],
                    })
                  }
                  value={selectedNode.data.requestMethod ?? "POST"}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                </select>
              </label>
              <label className="field">
                <span>Test request</span>
                <textarea
                  className="prop-input prop-textarea tall-textarea"
                  onChange={(event) =>
                    onNodeChange(selectedNode.id, { testRequestBody: event.target.value })
                  }
                  value={selectedNode.data.testRequestBody ?? ""}
                />
              </label>
            </>
          ) : null}

          {selectedNode.type === "service" || selectedNode.type === "api" ? (
            ["gemini", "openai", "claude", "mistral"].includes(selectedNode.data.serviceKind as string) ? (
              <p className="empty-state">Configure your API key directly on the node block.</p>
            ) : (
              <>
                <label className="field">
                  <span>API kind</span>
                  <select
                    className="prop-input"
                    onChange={(event) =>
                      onNodeChange(selectedNode.id, {
                        serviceKind: event.target.value as PipelineNodeData["serviceKind"],
                      })
                    }
                    value={selectedNode.data.serviceKind ?? "custom"}
                  >
                    <option value="weather">Weather</option>
                    <option value="search">Search</option>
                    <option value="crypto">Crypto</option>
                    <option value="chart">Chart</option>
                    <option value="risk">Risk</option>
                    <option value="gmail">Gmail</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>
                <label className="field">
                  <span>API endpoint</span>
                  <input
                    className="prop-input"
                    onChange={(event) =>
                      onNodeChange(selectedNode.id, { serviceUrl: event.target.value })
                    }
                    value={selectedNode.data.serviceUrl ?? ""}
                  />
                </label>
                <label className="field">
                  <span>Price per call (ALGO)</span>
                  <input
                    className="prop-input"
                    min="0"
                    onChange={(event) =>
                      onNodeChange(selectedNode.id, { priceAlgo: Number(event.target.value) || 0 })
                    }
                    step="0.001"
                    type="number"
                    value={selectedNode.data.priceAlgo ?? 0}
                  />
                </label>
                {selectedNode.data.serviceKind === "gmail" ? (
                  <label className="field">
                    <span>Fallback Gmail to</span>
                    <input
                      className="prop-input"
                      onChange={(event) =>
                        onNodeChange(selectedNode.id, { gmailTo: event.target.value })
                      }
                      placeholder="Optional fallback if prompt has no email address"
                      value={selectedNode.data.gmailTo ?? ""}
                    />
                  </label>
                ) : null}
                {selectedNode.data.serviceKind === "crypto" ||
                selectedNode.data.serviceKind === "chart" ||
                selectedNode.data.serviceKind === "risk" ? (
                  <label className="field">
                    <span>Symbols</span>
                    <input
                      className="prop-input"
                      onChange={(event) =>
                        onNodeChange(selectedNode.id, { cryptoSymbols: event.target.value })
                      }
                      placeholder="BTC,ETH,ALGO"
                      value={selectedNode.data.cryptoSymbols ?? ""}
                    />
                  </label>
                ) : null}
                <label className="field">
                  <span className="checkbox-label">
                    <input
                      checked={Boolean(selectedNode.data.upstreamX402)}
                      onChange={(event) =>
                        onNodeChange(selectedNode.id, { upstreamX402: event.target.checked })
                      }
                      type="checkbox"
                    />
                    <span>Already x402 paywalled upstream</span>
                  </span>
                </label>
              </>
            )
          ) : null}
        </div>
      ) : (
        <p className="empty-state">Select a node to edit prompts, tools, pricing, and service settings.</p>
      )}

      <div className="deploy-card">
        <span className="eyebrow">Deploy</span>
        {deployment ? (
          <>
            <strong>{deployment.pipelineId}</strong>
            <p>{deployment.endpoint}</p>
            <div className="deploy-meta">
              <span>{deployment.priceAlgo.toFixed(3)} ALGO per call</span>
              <span>{deployment.paymentWallet ?? "No paid entry wallet yet"}</span>
            </div>
            <div className="deploy-actions">
              <button className="secondary-button" onClick={onCopyEndpoint} type="button">
                Copy endpoint
              </button>
              {deployment.loraUrl ? (
                <a className="secondary-button link-button" href={deployment.loraUrl} rel="noreferrer" target="_blank">
                  View on Lora
                </a>
              ) : null}
            </div>
          </>
        ) : (
          <p>The deploy panel will appear here after you publish the workflow.</p>
        )}
      </div>
    </aside>
  );
}
