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
        title: "Agent Request",
        subtitle: "Kick off a run from an incoming API call.",
        dotClass: "dot-trigger",
      },
    ],
  },
  {
    title: "Agents",
    items: [
      {
        kind: "agent",
        title: "AI Agent",
        subtitle: "Wallet-backed autonomous operator.",
        dotClass: "dot-agent",
      },
    ],
  },
  {
    title: "Services",
    items: [
      {
        kind: "service",
        title: "Weather API",
        subtitle: "Open-Meteo weather lookup.",
        dotClass: "dot-service",
      },
      {
        kind: "service",
        title: "Search API",
        subtitle: "DuckDuckGo instant answers.",
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
