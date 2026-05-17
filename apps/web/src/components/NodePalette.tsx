import type { NodeKind } from "../types/pipeline";

interface PaletteSection {
  title: string;
  items: Array<{
    kind: NodeKind;
    title: string;
    subtitle: string;
    dotClass: string;
  }>;
}

const sections: PaletteSection[] = [
  {
    title: "Triggers",
    items: [
      {
        kind: "trigger",
        title: "Webhook Trigger",
        subtitle: "Kick off a run from an incoming HTTP call.",
        dotClass: "dot-trigger",
      },
      {
        kind: "trigger",
        title: "Manual Trigger",
        subtitle: "Test your workflow from the studio.",
        dotClass: "dot-trigger",
      },
      {
        kind: "trigger",
        title: "Chat Trigger",
        subtitle: "Start a run from an incoming chat message.",
        dotClass: "dot-trigger",
      },
    ],
  },
  {
    title: "AI Agents",
    items: [
      {
        kind: "agent",
        title: "AI Agent",
        subtitle: "Wallet-backed autonomous operator on Algorand.",
        dotClass: "dot-agent",
      },
    ],
  },
  {
    title: "AI Models",
    items: [
      {
        kind: "service",
        title: "Gemini",
        subtitle: "Connect Google Gemini as the agent's LLM.",
        dotClass: "dot-agent",
      },
      {
        kind: "service",
        title: "OpenAI",
        subtitle: "Connect OpenAI GPT as the agent's LLM.",
        dotClass: "dot-agent",
      },
      {
        kind: "service",
        title: "Claude",
        subtitle: "Connect Anthropic Claude as the agent's LLM.",
        dotClass: "dot-agent",
      },
      {
        kind: "service",
        title: "Mistral",
        subtitle: "Connect Mistral as the agent's LLM.",
        dotClass: "dot-agent",
      },
    ],
  },
  {
    title: "Tools & APIs",
    items: [
      {
        kind: "api",
        title: "API",
        subtitle: "Generic HTTP endpoint with optional x402 pricing.",
        dotClass: "dot-service",
      },
      {
        kind: "api",
        title: "Weather API",
        subtitle: "Open-Meteo weather lookup preset.",
        dotClass: "dot-service",
      },
      {
        kind: "api",
        title: "Search API",
        subtitle: "DuckDuckGo instant answers preset.",
        dotClass: "dot-service",
      },
      {
        kind: "api",
        title: "Crypto Prices API",
        subtitle: "CoinGecko price lookup preset.",
        dotClass: "dot-service",
      },
      {
        kind: "api",
        title: "Chart Signal API",
        subtitle: "Technical bias from recent market data.",
        dotClass: "dot-service",
      },
      {
        kind: "api",
        title: "Risk Model API",
        subtitle: "Volatility, sizing, and risk preset.",
        dotClass: "dot-service",
      },
      {
        kind: "api",
        title: "Gmail API",
        subtitle: "Draft or send email updates preset.",
        dotClass: "dot-service",
      },
    ],
  },
  {
    title: "End",
    items: [
      {
        kind: "end",
        title: "HTTP Response",
        subtitle: "Return the final result.",
        dotClass: "dot-end",
      },
    ],
  },
];


interface NodePaletteProps {
  onQuickAdd: (kind: NodeKind, presetTitle?: string) => void;
}

export function NodePalette({ onQuickAdd }: NodePaletteProps) {
  function handleDragStart(
    event: React.DragEvent<HTMLButtonElement>,
    kind: NodeKind,
    presetTitle: string,
  ) {
    event.dataTransfer.setData("application/agentmesh-node", JSON.stringify({ kind, presetTitle }));
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <aside className="studio-panel panel-pad">
      <div className="panel-header-block">
        <span className="eyebrow">Palette</span>
        <h2>Workflow blocks</h2>
      </div>
      {sections.map((section) => (
        <section key={section.title} className="palette-section">
          <h3>{section.title}</h3>
          <div className="palette-list">
            {section.items.map((item) => (
              <button
                key={`${section.title}-${item.title}`}
                className="palette-item compact-palette-item"
                draggable
                onClick={() => onQuickAdd(item.kind, item.title)}
                onDragStart={(event) => handleDragStart(event, item.kind, item.title)}
                type="button"
              >
                <span className={`palette-dot ${item.dotClass}`} />
                <span className="palette-copy">
                  <strong>{item.title}</strong>
                  <span>{item.subtitle}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <div className="panel-note">Drag blocks into the canvas or click to place them instantly.</div>
    </aside>
  );
}
