/** Pure client/server contract. No SDK, validation library or secrets here. */
export type CrmProposal =
  | { kind: "add-guest"; name: string; companions: number }
  | { kind: "add-task"; title: string }
  | { kind: "draft-message"; text: string };

export type CrmAssistantResult =
  | { ok: true; answer: string; proposal?: CrmProposal; receipt?: string; link?: { label: string; href: string } }
  | { ok: false; error: string };

export type CrmApplyResult = { ok: true; message: string } | { ok: false; error: string };
