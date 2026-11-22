const templates = [
  {
    id: "flowchart",
    name: "flytskjema",
    source: "flowchart TD\n  A[Skriv et notat] --> B{Klar?}\n  B -->|Ja| C[Publiser]\n  B -->|Nei| D[Lagre kladd]",
  },
  {
    id: "sequence",
    name: "sekvensdiagram",
    source: "sequenceDiagram\n  actor B as Bruker\n  participant N as Noteriv\n  B->>N: Åpne notat\n  N-->>B: Vis notat",
  },
  {
    id: "state",
    name: "tilstandsdiagram",
    source: "stateDiagram-v2\n  [*] --> Kladd\n  Kladd --> TilGjennomgang\n  TilGjennomgang --> Kladd: Endringer\n  TilGjennomgang --> Publisert: Godkjent\n  Publisert --> [*]",
  },
];

let cleanup;
module.exports = {
  onLoad(api) {
    cleanup = registerDiagramPlugin(api, {
      language: "mermaid-offline", title: "Mermaid", templates,
    });
  },
  onUnload() { cleanup?.(); },
};
