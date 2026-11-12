"use client";

import { useFormStatus } from "react-dom";

function Submit({ labels }: { labels: AskLabels }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn primary" type="submit" disabled={pending}>
      {pending ? labels.thinking : labels.ask}
    </button>
  );
}

function Example({ text }: { text: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" name="question" value={text} disabled={pending} style={{ fontSize: 13, minBlockSize: 36, padding: "4px 12px" }}>
      {text}
    </button>
  );
}

export interface AskLabels {
  ask: string;
  thinking: string;
  question: string;
  followUp: string;
  placeholder: string;
}

export function AskForm({ action, conversationId, examples, labels }: { action: (f: FormData) => Promise<void>; conversationId?: string; examples: string[]; labels: AskLabels }) {
  return (
    <form action={action} className="card stack">
      {conversationId && <input type="hidden" name="conversationId" value={conversationId} />}
      <label htmlFor="question">{conversationId ? labels.followUp : labels.question}</label>
      <textarea id="question" name="question" className="field" rows={3} maxLength={2000} style={{ paddingBlock: 10, resize: "vertical" }} placeholder={labels.placeholder} />
      <div className="row spread">
        <Submit labels={labels} />
      </div>
      {examples.length > 0 && (
        <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
          {examples.map((e) => <Example key={e} text={e} />)}
        </div>
      )}
    </form>
  );
}
