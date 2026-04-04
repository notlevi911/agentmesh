interface PromptRunnerProps {
  prompt: string;
  onChange: (value: string) => void;
  onRun: () => void;
  runPending: boolean;
}

export function PromptRunner({ prompt, onChange, onRun, runPending }: PromptRunnerProps) {
  return (
    <section className="studio-panel panel-pad prompt-runner">
      <div className="panel-header-block">
        <span className="eyebrow">Runtime Input</span>
        <h2>Prompt to agent</h2>
      </div>
      <textarea
        className="prop-input prompt-textarea"
        onChange={(event) => onChange(event.target.value)}
        placeholder="Ask for weather in Bengaluru, or search for recent BTC sentiment context..."
        value={prompt}
      />
      <button className="primary-button" disabled={runPending} onClick={onRun} type="button">
        {runPending ? "Running..." : "Run Workflow"}
      </button>
    </section>
  );
}
