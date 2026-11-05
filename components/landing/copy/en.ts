import type { LandingCopy } from "@/components/landing/copy/es";

/**
 * Landing en inglés (/en, 1-nov-2026). Misma página y mismas maquetas que la
 * española. El creador, el panel y la invitación siguen en español: lo dicen
 * `hero.note`, la última pregunta y el pie, para no prometer lo que no hay.
 */
export const en: LandingCopy = {
  lang: "en",
  home: "/en",
  skip: "Skip to content",
  nav: {
    label: "Main",
    homeLabel: "vinklo, home",
    templates: "Templates",
    faq: "FAQ",
    login: "Log in",
    createShort: "Create",
    create: "Create our website",
    language: { href: "/", lang: "es", text: "ES", label: "Versión en español" },
  },
  hero: {
    title: { pre: "Your wedding website. Every detail, ", em: "under control." },
    lead: "Create your invitation, share it on WhatsApp and organise replies, plus-ones and tables from your dashboard.",
    demo: "See an example wedding",
    note: "For now, the builder and your dashboard are in Spanish.",
  },
  know: {
    intro: "You’ll know",
    items: [
      { text: "who’s coming and who isn’t", sep: "," },
      { text: "who has allergies", sep: "," },
      { text: "who’s taking the coach", sep: "," },
      { text: "where everyone sits", sep: " and" },
      { text: "who has given you a gift", sep: "." },
    ],
  },
  mark: [
    { lead: "Your website", rest: "with a style of its own and everything in one place." },
    { lead: "Your guests", rest: "keep track with less effort and focus on what matters: making your day special." },
    { lead: "Your big day", rest: "all the key information: table plan, venue, coaches, allergies, music…" },
  ],
  flight: {
    label: "How vinklo works",
    steps: [
      { kicker: "01 · Tell us about your wedding", title: "An envelope that opens", body: "When they open your link, each guest sees an envelope sealed with your initials and opens it with a tap on their phone." },
      { kicker: "02 · Make it yours", title: "Your photo, your colours", body: "Three styles and eight palettes. Pick a palette and the whole invitation changes instantly." },
      { kicker: "03 · Send it and follow every reply", title: "Replies come in on their own", body: "Each guest replies from their own link. You see who has opened it, who’s coming and who needs a reminder." },
    ],
    listKicker: "Your guests",
    ofConfirmed: (total: number) => `of ${total} confirmed`,
    invited: (n: number) => `${n} ${n === 1 ? "guest" : "guests"}`,
  },
  guests: {
    names: ["Elena’s family", "Marta and her plus-one", "Juan’s aunts and uncles", "Jorge Lee", "Uni friends"],
    confirmed: (n: number) => `${n} confirmed`,
    sent: "Sent",
    opened: "Opened",
  },
  switcher: {
    label: "Make it yours",
    off: { pre: "If only planning a wedding were as easy as ", em: "flipping a switch.", post: "" },
    on: { pre: "With vinklo, ", em: "it really is that easy.", post: " Invitation, guests and replies in one place." },
    offSub: "The guest list, the messages, the replies, the tables… it all adds up very quickly.",
    onSub: "Start in a minute, without signing up. Replies come in on their own.",
  },
  styles: {
    kicker: "Templates",
    title: { pre: "Wedding websites ", em: "to remember." },
    sub: "And behind them, your own dashboard connected to your guest list and everything else: every guest’s status in one place. Forget the spreadsheet.",
    ideaLabel: "Or describe your wedding in one sentence and we’ll set it up for you:",
    ideaPlaceholder: "Dinner under the olive trees…",
    ideaSubmit: "Set it up",
  },
  templates: {
    label: "Wedding website templates",
    kicker: "Wedding website",
    byId: {
      origen: { styleLabel: "Editorial", description: "Editorial and cinematic, built around the story that brought you here.", alt: "Lucía and Juan in a green valley between mountains" },
      "hora-dorada": { styleLabel: "Calligraphic", description: "Warm and nostalgic, with the softness of your favourite photo.", alt: "Lucía and Juan in a field at sunset" },
      vinedo: { styleLabel: "Serene", description: "The best of both: a full-bleed photo and a mosaic that closes in, with calligraphy and arches.", alt: "Lucía and Juan walking through vineyards" },
    },
  },
  statement: {
    label: "Your wedding lives in the details",
    a: "Your wedding lives",
    aEm: "in the details.",
    b: "vinklo brings them together in a place that already",
    bEm: "feels",
    cEm: "yours.",
  },
  bento: {
    kicker: "For the whole celebration",
    title: { pre: "Everything your wedding needs, ", em: "well connected." },
    sub: "From the first idea to the last reply: your invitation and your guest management are one and the same.",
    guests: {
      title: "Guests and replies, together",
      body: "Groups, plus-ones, allergies and who’s coming, in a single list that fills itself in with every reply.",
      confirmed: "confirmed",
      of: (n: number) => `of ${n} guests`,
    },
    whatsapp: {
      title: "WhatsApp, in a single message",
      body: "A thoughtful message with their name and their personal link inside. Tweak it to your liking, open WhatsApp with the text already written and send it yourselves.",
      edit: "Editable",
      message: "Hi Marta! We’re getting married and we’d love you to be there. It’ll be on Saturday 12 June 2027. Your invitation has the venue, the times and everything else, and you can reply in a moment: ",
      signature: "Love, Lucía and Juan",
    },
    day: {
      title: "The whole day, in order",
      body: "The schedule, the venue with a “Get directions” button and the date, ready for each guest to save to their calendar.",
      town: "Cercedilla, Madrid",
      go: "Get directions",
      agenda: [
        ["11:45", "Coaches to the venue"],
        ["13:00", "Ceremony"],
        ["14:15", "Drinks in the garden"],
        ["16:00", "Wedding dinner"],
        ["19:30", "Dancing"],
        ["01:00", "Coaches back"],
      ],
      calendar: "Added to calendar · Sat 12 Jun",
    },
    envelope: {
      title: "An envelope that opens",
      body: "When they open your link, each guest sees an envelope sealed with your initials and opens it with a tap.",
    },
    remind: {
      title: "Remind without chasing",
      body: "Who opened it and hasn’t replied, with the reminder already written, group by group.",
      rows: ["Opened it and hasn’t replied", "Person to remind"],
    },
    tables: {
      title: "Tables, without spreadsheets",
      body: "Seat each group, see how full every table is and export the plan for the caterer.",
    },
  },
  gifts: {
    kicker: "One more thing",
    soon: "Coming soon",
    title: { pre: "Let the gifts pay for your wedding. ", em: "Not the bank." },
    subs: [
      "Your guests will give you their gift through vinklo instead of by bank transfer, and you’ll pay your suppliers directly with that money. No loans and no asking your parents for money.",
      "They’ll be able to pay over up to 3 months. You receive the full amount straight away.",
    ],
  },
  notify: {
    email: "Your email",
    sending: "Sending…",
    submit: "Let me know when it’s ready",
    consentPre: "I’d like you to email me when gifts are available. I have read the ",
    privacy: "privacy policy",
    consentPost: " (in Spanish).",
    needConsent: "We need your permission to email you.",
    offline: "We couldn’t connect. Check your connection and try again.",
    done: "Done. We’ll let you know as soon as it’s ready.",
    serverError: "We couldn’t save your request. Please try again in a moment.",
  },
  faq: {
    title: { pre: "Questions, ", em: "answered." },
    askPre: "Anything else? Write to us at ",
    askPost: ".",
    items: [
      { q: "What can we do with vinklo?", a: "You create your wedding website with guided questions and share it on WhatsApp. Replies arrive on their own in a single dashboard (who’s coming and who isn’t, plus-ones and allergies), and that’s also where you organise tables and gifts, instead of having everything split between WhatsApp and a spreadsheet." },
      { q: "How much does it cost?", a: "Right now, creating your website and managing your guests is free." },
      { q: "Do we need to sign up to get started?", a: "You can try the builder without signing up. To publish your website and manage replies, sign in with your email. Your guests reply without creating an account." },
      { q: "What about gifts?", a: "Today you can note in your dashboard who has given you a gift and how much. Soon, your guests will be able to give you their gift through vinklo and you’ll pay your suppliers with that money: guests will be able to pay over up to 3 months and you’ll receive the full amount up front." },
      { q: "How do our guests receive the invitation?", a: "From your dashboard you open WhatsApp with each guest’s message already written, including their personal link, and you send it yourselves. They open it on their phone, see your website and reply in a moment, with plus-ones and allergies." },
      { q: "Is vinklo available in English?", a: "This page is. For now, the builder, your dashboard and the buttons and forms of the invitation your guests see are in Spanish. Everything you write yourselves (names, your story, the details, the WhatsApp message) appears exactly as you write it." },
    ],
  },
  finale: {
    line: "Every guest, every detail and every moment, lovingly connected. From the first idea to the last reply.",
    linksLabel: "Links",
    links: [
      [{ href: "/en#estilos", label: "Templates" }, { href: "/en/faq", label: "FAQ" }, { href: "/login", label: "Log in" }],
      [{ href: "/privacidad", label: "Privacy" }, { href: "/terminos", label: "Terms" }, { href: "/aviso-legal", label: "Legal notice" }],
    ],
    made: "Made unhurriedly, in Spain",
    note: "Legal pages are in Spanish.",
  },
};
