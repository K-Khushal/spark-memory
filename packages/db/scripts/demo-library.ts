// A demo Library of text Memories for local development. Invented or public
// domain text only: no real personal data. Deliberately mixed (long, short,
// titled, untitled, Hindi, Japanese, Arabic, emoji, code) so the UI is seen
// against the awkward cases.
import type { TextCapture } from "@spark/core";

export const DEMO_EMAIL = "demo@example.com";

export const DEMO_LIBRARY: TextCapture[] = [
  {
    title: "Smoky tomato soup",
    body: "Roast 1 kg tomatoes, 2 red onions and a head of garlic at 220°C for 40 minutes. Blend with smoked paprika, a splash of sherry vinegar and enough stock to loosen. Finish with olive oil.",
    captureNote: "winter dinners",
  },
  {
    body: "The best time to plant a tree was twenty years ago. The second best time is now.",
  },
  {
    title: "Walden, on simplicity",
    body: "Our life is frittered away by detail. An honest man has hardly need to count more than his ten fingers, or in extreme cases he may add his ten toes, and lump the rest. Simplicity, simplicity, simplicity!",
  },
  {
    body: "git log --oneline --graph --decorate --all\n\nShows every branch as a tree. Add -n 30 to keep it short.",
    captureNote: "keep forgetting this one",
  },
  {
    title: "Kyoto, day two",
    body: "Fushimi Inari before 7am, before the crowds. Walk past the first gates to the Yotsutsuji intersection for the view over the city. Lunch at the small udon place by the station.",
  },
  { body: "दाल में तड़का आख़िर में डालो, तभी ख़ुशबू आती है।" },
  { body: "猫は液体である。箱があれば、必ず入る。" },
  { body: "القراءة غذاء العقل" },
  {
    title: "Pricing page ideas",
    body: "Three plans max. Name them by who they are for, not by size. Show the yearly price first but let the toggle remember the choice. Put the FAQ under the table, never beside it.",
  },
  {
    body: "Wi-Fi at the cabin: network CedarLodge, the password is on the fridge magnet.",
  },
  {
    title: "Sourdough schedule",
    body: "Feed the starter at 9pm. Mix at 8am, bulk ferment until it has grown by half (about 5 hours at 24°C), shape, then into the fridge overnight. Bake straight from cold at 250°C, lid on for 20 minutes, lid off for 25.",
  },
  {
    body: "Pride and Prejudice: It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
  },
  {
    title: "Books to read next",
    body: "The Remains of the Day\nPiranesi\nA Psalm for the Wild-Built\nThe Dispossessed\nKlara and the Sun",
  },
  {
    body: "Ship small. A change you can describe in one sentence is a change you can review, revert and explain.",
    captureNote: "for the team retro",
  },
  {
    title: "Paint colours for the hallway",
    body: "Warm white on the ceiling, a muted sage green on the walls, and the skirting in the same green one shade darker. Matte everywhere except the doors, which get eggshell.",
  },
  {
    body: "🌶️🌶️🌶️ The chilli oil: 1 cup neutral oil, heat to 120°C, pour over chilli flakes, Sichuan pepper, sesame, star anise and a cinnamon stick. Wait a day before using.",
  },
  {
    title: "Interview questions I liked",
    body: "What did you change your mind about this year? What is something you are bad at that you have decided not to fix? Tell me about a decision you made with too little information.",
  },
  {
    body: "const debounce = (fn, ms) => {\n  let t;\n  return (...args) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(...args), ms);\n  };\n};",
  },
  {
    title: "Marathon training, week 6",
    body: "Long run 24 km at easy pace. Tuesday intervals: 6 × 800 m with 400 m jog. Thursday tempo 8 km. Remember gels every 40 minutes on the long run.",
  },
  {
    body: "Hope is the thing with feathers / That perches in the soul / And sings the tune without the words / And never stops at all.",
  },
  {
    title:
      "A very long title that keeps going well past the width of any tile in the wall, to see how it truncates and whether the full title still reaches screen readers",
    body: "Short body.",
  },
  {
    body: "Supercalifragilisticexpialidociousandthenwordsjoinedwithoutanyspacesatallsothattheyneverwrapanywhereinthetileunlesswebreakthem",
  },
  {
    title: "Meeting notes, design review",
    body: "Agreed: the sidebar keeps its width on tablets. Open: whether the search field should show the last query. Next: prototype the empty state with only one action and no explanation.",
  },
  {
    body: "Bike shop on Elm Street fixes wheels same day if you drop it before 10.",
  },
  {
    title: "Cold brew ratio",
    body: "1 part coarse ground coffee to 8 parts cold water. Steep 16 hours in the fridge, strain twice. Dilute 1:1 with milk or water.",
  },
];
