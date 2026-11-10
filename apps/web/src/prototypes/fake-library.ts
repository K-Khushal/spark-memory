// A fake Library for the design prototypes: realistic, deliberately awkward
// Memories (long titles, non-Latin text, emoji, every kind and Index state).
// Throwaway: deleted with the losing prototypes.
import type { IndexState, MemoryKind, Preservation } from "@spark/core";

export type Look =
  "photo" | "screenshot" | "article" | "pdf" | "video" | "post" | "text";

export type FakeMemory = {
  id: string;
  kind: MemoryKind;
  look: Look;
  title: string;
  source?: string;
  /** Days before "today". */
  daysAgo: number;
  /** width / height of the visual. */
  aspect: number;
  image?: string;
  /** Screenshot mock: accent colour and layout. */
  shot?: { accent: string; layout: "dashboard" | "chat" | "settings" };
  excerpt?: string;
  duration?: string;
  pages?: number;
  captureNote?: string;
  colours: string[];
  categories: string[];
  tags: string[];
  /** Query words that Indexing would connect to this Memory, with the why-chip each produces. */
  signals: Record<string, string>;
  preservation: Preservation;
  indexState: IndexState;
};

// One Memory per line: id | kind | look | title | source | days ago | aspect |
// picsum image path | excerpt | colours | Categories | Tags | signals | extras.
const TABLE = `
m01 | image | screenshot | Analytics dashboard with an orange sidebar | dribbble.com | 0 | 1.6 |  |  | Orange,White | Design reference | dashboard,sidebar,charts | orange=colour: orange;dashboard=looks like: dashboard;sidebar=looks like: sidebar;analytics=text in image: Analytics | shot=dashboard:#EE7A1C;note=the sidebar density is right
m02 | image | photo | Petunias on the balcony |  | 0 | 1.33 | 152/851/481 |  | Purple,Green | Garden | flowers,petunia | purple=colour: purple;flowers=looks like: flowers;petunia=Tag: petunia;balcony=title | 
m03 | link | article | The unreasonable effectiveness of just showing the thing | rauno.me | 0 | 0.8 |  | Interfaces feel fast when they respond on press, not on release. Most perceived latency hides in the gap between intent and feedback. | White | Article,Design reference | interaction,latency | latency=passage: “perceived latency”;interaction=Tag: interaction;fast=passage: “feel fast”;press=passage: “respond on press” | index=indexing
m04 | social_post | post | पनीर टिक्का बिना तंदूर के — 20 मिनट में 🔥 | instagram.com/@ranveerbrar | 1 | 0.8 | 292/512/800 |  | Red,Green | Recipe | paneer,tikka,indian | paneer=text in image: पनीर;recipe=Category: Recipe;tikka=title;instagram=Source: Instagram;red=colour: red | preservation=reference_only
m05 | video | video | Designing fluid interfaces | developer.apple.com | 1 | 1.78 | 1060/1024/360 | …the thought and the gesture happen in parallel… | Black,Brown | Talk | motion,gestures,wwdc | motion=passage at 12:40;gestures=passage at 21:05;talk=Category: Talk;springs=passage at 31:12;wwdc=Tag: wwdc | duration=44:51
m06 | pdf | pdf | Lease agreement — Flat 4B, Koramangala (signed) |  | 2 | 0.71 |  | The Tenant shall pay a monthly rent of ₹38,000 on or before the 5th day of each calendar month. | White | Document | lease,rent,contract | lease=title;rent=passage on page 3;contract=Tag: contract;flat=title | pages=14
m07 | image | photo | Raspberries, morning light |  | 2 | 0.75 | 102/480/853 |  | Red,Yellow | Photo | fruit,raspberries | red=colour: red;raspberries=looks like: raspberries;fruit=looks like: fruit | 
m08 | image | screenshot | Slack thread: launch checklist | Slack | 3 | 0.62 |  |  | Purple,White | Work | chat,checklist | purple=colour: purple;sidebar=looks like: sidebar;checklist=text in image: checklist;launch=text in image: launch | shot=chat:#7B4FD6
m09 | image | photo | Prekestolen at 6am — worth the climb |  | 4 | 1.5 | 1015/960/427 |  | Blue,Green | Travel | fjord,norway,hike | blue=colour: blue;fjord=looks like: fjord;norway=Tag: norway;hike=Tag: hike | 
m10 | link | article | 東京のおすすめ喫茶店 10選：昭和レトロな空間でゆっくり | tabelog.com | 4 | 0.66 | 431/896/457 | 純喫茶の魅力は、時間がゆっくり流れること。 | Brown,Black | Travel,Food | coffee,tokyo,kissaten | coffee=looks like: coffee;tokyo=text: 東京;cafe=Category: Food | 
m11 | image | photo | Pug in a blanket |  | 5 | 1 | 1025/640/640 |  | Green,Brown | Photo | dog,pug | dog=looks like: dog;pug=looks like: pug;blanket=looks like: blanket | 
m12 | image | screenshot | Settings page — toggles with inline descriptions | linear.app | 5 | 1.45 |  |  | Blue,White | Design reference | settings,toggles,form | settings=text in image: Settings;toggles=looks like: toggles;blue=colour: blue;form=looks like: form | shot=settings:#2F6FE0
m13 | text | text | Gift ideas for Amma |  | 6 | 1 |  | Silk saree from Nalli (not red) · Kindle Paperwhite · the brass diya set from that shop in Jayanagar |  | Note | gifts,family | gift=title;amma=title;saree=text: saree | 
m14 | image | photo | Jellyfish, Osaka Aquarium Kaiyukan |  | 7 | 0.8 | 1069/512/800 |  | Blue,Orange | Travel | jellyfish,aquarium,japan | orange=colour: orange;blue=colour: blue;jellyfish=looks like: jellyfish;aquarium=title | 
m15 | video | video | How to cold brew (the lazy way) | youtube.com | 8 | 1.78 | 425/1024/360 |  | Brown | Recipe | coffee,cold brew | coffee=looks like: coffee;recipe=Category: Recipe;brew=title;youtube=Source: YouTube | duration=6:12
m16 | image | photo | Hot-air balloon over Cappadocia |  | 9 | 0.67 | 401/429/955 |  | Blue,Orange,Yellow | Travel | balloon,turkey | balloon=looks like: balloon;orange=colour: orange;blue=colour: blue | 
m17 | pdf | pdf | Invoice INV-2026-0419 | Figma | 10 | 0.71 |  | Professional plan · 1 editor · $15.00 | White | Receipt | invoice,figma | invoice=title;receipt=Category: Receipt;figma=Source: Figma | pages=1
m18 | link | article | مقدمة في تصميم الخطوط العربية | arabictypography.com | 11 | 0.8 |  | الخط العربي فن قائم على التوازن بين الكتلة والفراغ. | Black,White | Article,Typography | typography,arabic | typography=Category: Typography;arabic=Tag: arabic;type=Category: Typography | 
m19 | image | photo | Strawberries at Crawford Market |  | 12 | 1.33 | 1080/851/481 |  | Red,Green | Food | strawberries,market | red=colour: red;strawberries=looks like: strawberries;fruit=looks like: fruit;market=title | 
m20 | image | screenshot | Onboarding — empty state illustration | mobbin.com | 13 | 0.56 |  |  | Pink,White | Design reference | onboarding,empty state,mobile | pink=colour: pink;onboarding=text in image: Welcome;empty=looks like: empty state;mobile=looks like: phone screen | shot=settings:#E25C9E;index=failed
m21 | image | photo | Desk setup inspo | pinterest.com | 14 | 1.33 | 180/851/481 |  | Brown,White | Design reference | desk,laptop,notebook | desk=looks like: desk;laptop=looks like: laptop;workspace=looks like: workspace | preservation=reference_only
m22 | link | article | A really, genuinely, extraordinarily long article title that someone wrote for search engines rather than people: the complete 2026 guide to sourdough hydration, levain timing, and why your crumb is gummy | theperfectloaf.com | 15 | 0.8 |  | If your crumb is gummy, the loaf is almost always under-baked or cut too warm. | Brown | Recipe,Article | sourdough,bread,baking | sourdough=title;bread=Tag: bread;recipe=Category: Recipe;gummy=passage: “crumb is gummy” | 
m23 | image | photo | Coyote, Yellowstone |  | 18 | 1 | 582/640/640 |  | Grey,Brown | Photo | coyote,wildlife | dog=looks like: dog-like animal;wildlife=Tag: wildlife;coyote=looks like: coyote | 
m24 | video | video | Ghibli-style rain ambience 🌧️ 3 hours | youtube.com | 20 | 1.78 | 543/1024/360 |  | Green,Grey | Music | ambience,rain,focus | rain=title;focus=Tag: focus;forest=looks like: forest;green=colour: green | duration=3:00:00;preservation=reference_only
m25 | image | photo | Neuschwanstein from Marienbrücke |  | 22 | 1.5 | 1040/960/427 |  | Green,White | Travel | castle,germany | castle=looks like: castle;germany=Tag: germany;green=colour: green | 
m26 | pdf | pdf | Practical Typography — Butterick (excerpt) |  | 24 | 0.71 |  | Typography is the visual component of the written word. Body text matters most. | White | Book,Typography | typography,book | typography=title;type=Category: Typography;book=Category: Book;talk=passage on page 12 | pages=212
m27 | image | photo | Tiger, Ranthambore — the one that walked right past the jeep |  | 26 | 1.33 | 593/851/481 |  | Orange,Brown,Black | Travel,Photo | tiger,wildlife,india | orange=colour: orange;tiger=looks like: tiger;wildlife=Tag: wildlife | 
m28 | social_post | post | “Taste is trained, not innate.” — a thread on building taste as an engineer 🧵 | x.com/emilkowalski | 28 | 1.1 |  | Study why great interfaces feel the way they do. Reverse engineer animations. Inspect interactions. | White,Black | Design reference | taste,thread | taste=passage: “Taste is trained”;motion=passage: “animations”;interaction=passage: “interactions” | 
m29 | image | photo | Walruses sunbathing, Svalbard |  | 31 | 1.5 | 1084/960/427 |  | Brown,Grey | Photo | walrus,arctic | walrus=looks like: walrus;arctic=Tag: arctic | 
m30 | image | photo | Granola bowl |  | 33 | 0.8 | 493/512/800 |  | Red,White | Recipe,Food | breakfast,strawberries | recipe=Category: Recipe;strawberries=looks like: strawberries;breakfast=looks like: breakfast | 
m31 | image | photo | Kayak on Lake Bled |  | 36 | 1.33 | 1011/851/481 |  | Blue,Green,Red | Travel | lake,kayak | blue=colour: blue;lake=looks like: lake;kayak=looks like: kayak | 
m32 | text | text | wifi at the Goa place |  | 40 | 1.4 |  | network: Casa_Azul_5G · password: sunsetbeach2026 🌅 |  | Note | wifi,goa | wifi=title;goa=title;password=text: password | 
m33 | image | photo | Orange tree, Valencia |  | 44 | 0.75 | 517/480/853 |  | Orange,Green,Blue | Travel | oranges,tree | orange=colour: orange;tree=looks like: tree;oranges=looks like: oranges | 
m34 | image | photo | IMG_4471.HEIC |  | 50 | 0.75 | 237/480/853 |  | Black,Brown | Photo | dog,puppy | dog=looks like: dog;puppy=looks like: puppy;black=colour: black | 
m35 | video | video | Clivia care — repotting after flowering | youtube.com | 55 | 1.78 | 360/1024/360 |  | Orange,Green | Garden | clivia,repotting | orange=colour: orange;flowers=looks like: flowers;repotting=passage at 4:10 | duration=11:48
m36 | image | photo | Grapes from the Nashik farm visit |  | 60 | 1.33 | 674/851/481 |  | Purple,Blue | Food | grapes,farm | purple=colour: purple;grapes=looks like: grapes;fruit=looks like: fruit |
`;

const list = (cell = "") => cell.split(",").filter(Boolean);
const pairs = (cell = "") =>
  Object.fromEntries(
    cell
      .split(";")
      .filter(Boolean)
      .map((pair) => [
        pair.slice(0, pair.indexOf("=")),
        pair.slice(pair.indexOf("=") + 1),
      ])
  );

export const LIBRARY: FakeMemory[] = TABLE.trim()
  .split("\n")
  .map((line) => {
    const [
      id,
      kind,
      look,
      title,
      source,
      days,
      aspect,
      image,
      excerpt,
      colours,
      categories,
      tags,
      signals,
      extras,
    ] = line.split(" | ").map((cell) => cell.trim());
    const x = pairs(extras);
    const [layout, accent] = (x.shot ?? "").split(":");
    return {
      id: id!,
      kind: kind as MemoryKind,
      look: look as Look,
      title: title!,
      source: source || undefined,
      daysAgo: Number(days),
      aspect: Number(aspect),
      image: image ? `https://picsum.photos/id/${image}` : undefined,
      shot: layout
        ? { layout: layout as "dashboard", accent: accent! }
        : undefined,
      excerpt: excerpt || undefined,
      duration: x.duration,
      pages: x.pages ? Number(x.pages) : undefined,
      captureNote: x.note,
      colours: list(colours),
      categories: list(categories),
      tags: list(tags),
      signals: pairs(signals),
      preservation: (x.preservation ?? "preserved") as Preservation,
      indexState: (x.index ?? "searchable") as IndexState,
    };
  });

export const DAY_GROUPS: { label: string; from: number; to: number }[] = [
  { label: "Today", from: 0, to: 0 },
  { label: "Yesterday", from: 1, to: 1 },
  { label: "Earlier this week", from: 2, to: 6 },
  { label: "Last week", from: 7, to: 13 },
  { label: "October", from: 14, to: 40 },
  { label: "September", from: 41, to: 999 },
];

export const SAMPLE_SEARCHES = [
  "orange dashboard with a sidebar",
  "paneer recipe from instagram",
  "purple flowers",
  "that talk about motion and springs",
  "blue dog",
];

export const CATEGORIES = [
  ...new Set(LIBRARY.flatMap((x) => x.categories)),
].sort();

export type Result = { memory: FakeMemory; why: string[] };
export type Results = { direct: Result[]; related: Result[] };

const STOP = new Set([
  "the",
  "and",
  "with",
  "that",
  "about",
  "from",
  "for",
  "this",
  "was",
  "some",
  "one",
]);
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w));

/** Fake search: Direct when two signals match, Related when one does. */
export function fakeSearch(
  library: FakeMemory[],
  query: string,
  colour?: string
): Results {
  const terms = words(query);
  const results: { result: Result; score: number }[] = [];
  for (const memory of library) {
    if (colour && !memory.colours.includes(colour)) continue;
    const why = new Set<string>();
    for (const term of terms) {
      const stem = term.replace(/s$/, "");
      const chip =
        memory.signals[term] ??
        memory.signals[stem] ??
        (words(memory.title).includes(term) ? "title" : undefined);
      if (chip) why.add(chip === "title" ? `title: “${term}”` : chip);
    }
    if (colour) why.add(`colour: ${colour.toLowerCase()}`);
    if (why.size > 0 || (!terms.length && colour))
      results.push({ result: { memory, why: [...why] }, score: why.size });
  }
  results.sort((a, b) => b.score - a.score);
  const threshold = terms.length ? 2 : 1;
  return {
    direct: results.filter((r) => r.score >= threshold).map((r) => r.result),
    related: results.filter((r) => r.score < threshold).map((r) => r.result),
  };
}

/** Split `text` into plain and highlighted runs for the query's words. */
export function highlight(text: string, query: string) {
  const terms = words(query).filter((t) => t.length > 2);
  if (!terms.length) return [{ text, hit: false }];
  const re = new RegExp(
    `(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "giu"
  );
  return text.split(re).map((part, i) => ({ text: part, hit: i % 2 === 1 }));
}

export const LOOK_LABEL: Record<Look, string> = {
  photo: "Image",
  screenshot: "Screenshot",
  article: "Article",
  pdf: "PDF",
  video: "Video",
  post: "Social post",
  text: "Text",
};

export function sourceLabel(memory: FakeMemory) {
  return memory.source ?? (memory.look === "text" ? "Text" : "Upload");
}

export function capturedLabel(daysAgo: number) {
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo < 7) return `${daysAgo} days ago`;
  const date = new Date(Date.UTC(2026, 10, 10 - daysAgo));
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** True when the visual itself shows the title (articles, notes, PDFs). */
export function showsTitle(memory: FakeMemory) {
  if (memory.look === "screenshot") return false;
  return (
    memory.look === "article" ||
    memory.look === "text" ||
    memory.look === "pdf" ||
    !memory.image
  );
}
