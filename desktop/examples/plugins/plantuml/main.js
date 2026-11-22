const templates = [
  {
    id: "sequence",
    name: "sekvensdiagram",
    source: "@startuml\nactor Bruker\nparticipant Noteriv\nBruker -> Noteriv: Åpne notat\nNoteriv --> Bruker: Vis notat\n@enduml",
  },
  {
    id: "class",
    name: "klassediagram",
    source: "@startuml\nclass Vault\nclass Notat {\n  +tittel: String\n}\nVault \"1\" o-- \"*\" Notat\n@enduml",
  },
  {
    id: "activity",
    name: "aktivitetsdiagram",
    source: "@startuml\nstart\n:Skriv notat;\nif (Klar?) then (ja)\n  :Publiser;\nelse (nei)\n  :Lagre kladd;\nendif\nstop\n@enduml",
  },
];

let cleanup;
module.exports = {
  onLoad(api) {
    cleanup = registerDiagramPlugin(api, {
      language: "plantuml", title: "PlantUML", templates,
    });
  },
  onUnload() { cleanup?.(); },
};
