// The screenshots in the sample Library are drawn here from small HTML pages
// (so they are ours, CC0) and rendered by assemble.ts. `ocr` is read back from
// the page, so the text a model should find in the image is known exactly.
export type Screen = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  width: number;
  height: number;
  html: string;
};

const page = (css: string, body: string) =>
  `<style>*{box-sizing:border-box;margin:0}body{font:15px/1.45 system-ui,sans-serif;${css}}h1{font-size:22px}h2{font-size:17px}.mono{font-family:ui-monospace,monospace}.row{display:flex;justify-content:space-between;gap:12px}</style>${body}`;

export const SCREENS: Screen[] = [
  {
    id: "shot-cafe-receipt",
    title: "Marigold Cafe receipt",
    description:
      "A cream paper receipt from Marigold Cafe listing two flat whites, a lemon tart and a banana bread, total 18.40.",
    tags: ["receipt", "cafe", "payment"],
    width: 480,
    height: 560,
    html: page(
      "background:#e9e4d8;padding:30px;color:#222;font-family:ui-monospace,monospace",
      `<div style="background:#fffdf7;padding:24px;box-shadow:0 2px 8px #0003"><h1 style="text-align:center">MARIGOLD CAFE</h1><p style="text-align:center">14 Orchard Lane</p><p style="text-align:center">12 March 2026  09:41</p><hr style="margin:12px 0"><div class="row"><span>2 x Flat white</span><span>7.00</span></div><div class="row"><span>1 x Lemon tart</span><span>4.90</span></div><div class="row"><span>1 x Banana bread</span><span>3.50</span></div><div class="row"><span>Service</span><span>3.00</span></div><hr style="margin:12px 0"><div class="row"><b>TOTAL</b><b>18.40</b></div><p style="margin-top:14px">Paid by card ending 4417</p><p style="text-align:center;margin-top:18px">Thank you, see you soon!</p></div>`
    ),
  },
  {
    id: "shot-boarding-pass",
    title: "Skyline Air boarding pass Delhi to Bengaluru",
    description:
      "A boarding pass for Skyline Air flight SK 482 from Delhi to Bengaluru on 9 April, seat 14C, gate B7, in dark blue and white.",
    tags: ["boarding pass", "flight", "travel"],
    width: 720,
    height: 300,
    html: page(
      "background:#fff;color:#0b2a5b",
      `<div style="display:flex;height:300px"><div style="flex:1;padding:24px 28px"><h2>SKYLINE AIR</h2><div class="row" style="margin-top:20px;font-size:34px;font-weight:700"><span>DEL</span><span>→</span><span>BLR</span></div><div class="row"><span>Delhi</span><span>Bengaluru</span></div><div class="row" style="margin-top:24px"><span>Flight SK 482</span><span>9 Apr 2026</span><span>Boards 06:15</span></div><div class="row" style="margin-top:8px"><span>Seat 14C</span><span>Gate B7</span><span>Priya Nair</span></div></div><div style="width:150px;background:#0b2a5b;color:#fff;padding:24px"><b>SEAT</b><div style="font-size:42px">14C</div><p>GATE B7</p></div></div>`
    ),
  },
  {
    id: "shot-wifi-card",
    title: "Guest Wi-Fi card",
    description:
      "A printed guest Wi-Fi card on a teal background with the network name and password.",
    tags: ["wifi", "password", "card"],
    width: 520,
    height: 320,
    html: page(
      "background:#0f766e;color:#fff;padding:32px",
      `<h1>Guest Wi-Fi</h1><p style="margin-top:18px">Network</p><p class="mono" style="font-size:26px">Lighthouse_5G</p><p style="margin-top:14px">Password</p><p class="mono" style="font-size:26px">orange-falcon-27</p><p style="margin-top:20px;opacity:.8">Please do not share outside the house.</p>`
    ),
  },
  {
    id: "shot-postgres-error",
    title: "Postgres connection refused error",
    description:
      "A dark terminal window showing a Node stack trace with the error ECONNREFUSED 127.0.0.1:5432 while connecting to Postgres.",
    tags: ["terminal", "error", "postgres", "node"],
    width: 760,
    height: 380,
    html: page(
      "background:#14161a;color:#d7dae0;padding:22px;font-family:ui-monospace,monospace;font-size:14px",
      `<p style="color:#7ee787">$ pnpm dev</p><p>&gt; spark@0.0.0 dev</p><p style="color:#ff7b72">Error: connect ECONNREFUSED 127.0.0.1:5432</p><p>    at TCPConnectWrap.afterConnect (node:net:1555:16)</p><p>    at Pool._pulseQueue (pg-pool/index.js:148:28)</p><p style="color:#ff7b72;margin-top:12px">database "spark" is not accepting connections</p><p style="color:#e3b341">hint: run docker compose up -d db</p>`
    ),
  },
  {
    id: "shot-git-log",
    title: "Terminal git log",
    description:
      "A terminal showing a short git log with three commits about fixing the login redirect, adding dark mode and bumping dependencies.",
    tags: ["terminal", "git", "code"],
    width: 760,
    height: 300,
    html: page(
      "background:#1e1e2e;color:#cdd6f4;padding:22px;font-family:ui-monospace,monospace;font-size:14px",
      `<p style="color:#a6e3a1">$ git log --oneline -3</p><p><span style="color:#f9e2af">a41c9e2</span> Fix login redirect loop on expired session</p><p><span style="color:#f9e2af">7be03d1</span> Add dark mode toggle to settings</p><p><span style="color:#f9e2af">19dd5f8</span> Bump dependencies</p>`
    ),
  },
  {
    id: "shot-code-debounce",
    title: "TypeScript debounce function in an editor",
    description:
      "A code editor with a TypeScript function named debounce that delays calling a callback, on a dark purple theme.",
    tags: ["code", "typescript", "editor"],
    width: 700,
    height: 360,
    html: page(
      "background:#282a36;color:#f8f8f2;padding:22px;font-family:ui-monospace,monospace;font-size:15px;white-space:pre",
      `<span style="color:#6272a4">// utils/debounce.ts</span>\n<span style="color:#ff79c6">export function</span> <span style="color:#50fa7b">debounce</span>(fn, wait = 200) {\n  <span style="color:#ff79c6">let</span> timer;\n  <span style="color:#ff79c6">return</span> (...args) =&gt; {\n    clearTimeout(timer);\n    timer = setTimeout(() =&gt; fn(...args), wait);\n  };\n}`
    ),
  },
  {
    id: "shot-chat-hinglish",
    title: "Chat about dinner plans in Hinglish",
    description:
      "A green chat screen between two friends planning dinner in Hinglish, deciding on paneer tikka at 8 baje.",
    tags: ["chat", "hinglish", "dinner"],
    width: 420,
    height: 520,
    html: page(
      "background:#ece5dd;padding:18px",
      `<div style="background:#075e54;color:#fff;padding:12px;margin:-18px -18px 14px"><b>Rohan</b></div><p style="background:#fff;padding:8px 12px;border-radius:10px;width:78%">Bhai aaj dinner ka kya plan hai?</p><p style="background:#dcf8c6;padding:8px 12px;border-radius:10px;width:78%;margin:10px 0 10px auto">Paneer tikka khate hain, wahi naya wala restaurant</p><p style="background:#fff;padding:8px 12px;border-radius:10px;width:78%">Done, 8 baje milte hain. Table main book kar deta hoon</p><p style="background:#dcf8c6;padding:8px 12px;border-radius:10px;width:78%;margin:10px 0 10px auto">Perfect, paise kal de dunga</p>`
    ),
  },
  {
    id: "shot-chat-address",
    title: "Chat with an address and door code",
    description:
      "A chat screen where a friend sends a flat address and a door code for a party.",
    tags: ["chat", "address", "party"],
    width: 420,
    height: 420,
    html: page(
      "background:#1c1c1e;color:#fff;padding:18px",
      `<div style="text-align:center;opacity:.7;margin-bottom:14px">Meera</div><p style="background:#2c2c2e;padding:8px 12px;border-radius:14px;width:85%">Party is at Flat 6B, 22 Chestnut Road</p><p style="background:#0a84ff;padding:8px 12px;border-radius:14px;width:75%;margin:10px 0 10px auto">What time should I come?</p><p style="background:#2c2c2e;padding:8px 12px;border-radius:14px;width:85%">Anytime after 7. Door code is 4821#</p>`
    ),
  },
  {
    id: "shot-upi-payment",
    title: "UPI payment confirmation",
    description:
      "A payment confirmation screen with a green tick showing 1,250 rupees paid to Sharma Electricals.",
    tags: ["payment", "upi", "receipt"],
    width: 420,
    height: 520,
    html: page(
      "background:#fff;text-align:center;padding:50px 20px;color:#202124",
      `<div style="width:84px;height:84px;border-radius:50%;background:#1e8e3e;color:#fff;font-size:52px;line-height:84px;margin:0 auto 20px">✓</div><h1>Payment successful</h1><p style="font-size:40px;margin:14px 0">₹1,250</p><p>Paid to Sharma Electricals</p><p style="margin-top:20px;color:#5f6368">UPI Ref 4093 5521 7718</p><p style="color:#5f6368">3 February 2026, 6:12 pm</p>`
    ),
  },
  {
    id: "shot-calendar-invite",
    title: "Calendar invite for the quarterly planning meeting",
    description:
      "A calendar event card for the quarterly planning meeting on Thursday 20 June at 3 pm in Meeting Room Cedar.",
    tags: ["calendar", "meeting", "invite"],
    width: 520,
    height: 340,
    html: page(
      "background:#f1f3f4;padding:28px;color:#202124",
      `<div style="background:#fff;border-left:8px solid #1a73e8;padding:22px;border-radius:8px"><h1>Quarterly planning</h1><p style="margin-top:8px">Thursday 20 June · 3:00 – 4:30 pm</p><p>Meeting Room Cedar, 3rd floor</p><p style="margin-top:12px;color:#5f6368">Agenda: roadmap, hiring, budget</p></div>`
    ),
  },
  {
    id: "shot-recipe-card",
    title: "Handwritten-style recipe card for lemon rice",
    description:
      "A yellow recipe card for South Indian lemon rice listing ingredients like mustard seeds, curry leaves, peanuts and turmeric.",
    tags: ["recipe", "lemon rice", "food"],
    width: 480,
    height: 520,
    html: page(
      "background:#fde68a;padding:28px;color:#4a2c0a;font-family:Georgia,serif",
      `<h1 style="font-size:28px">Lemon Rice</h1><p style="margin:6px 0 14px"><i>Serves 4 · 20 minutes</i></p><p>• 2 cups cooked rice</p><p>• 2 tbsp oil, 1 tsp mustard seeds</p><p>• curry leaves, 2 green chillies</p><p>• handful of roasted peanuts</p><p>• ½ tsp turmeric, juice of 1 lemon</p><p style="margin-top:14px">Temper the seeds, add everything, toss with rice, finish with lemon.</p>`
    ),
  },
  {
    id: "shot-budget-sheet",
    title: "Household budget spreadsheet",
    description:
      "A spreadsheet of monthly household spending with rent, groceries, transport and utilities, and a total of 2,340.",
    tags: ["spreadsheet", "budget", "finance"],
    width: 640,
    height: 340,
    html: page(
      "background:#fff;color:#202124",
      `<table style="border-collapse:collapse;width:100%"><tr style="background:#188038;color:#fff"><th style="text-align:left;padding:10px">Category</th><th style="padding:10px;text-align:right">Amount</th></tr><tr><td style="padding:9px;border-bottom:1px solid #ddd">Rent</td><td style="text-align:right;padding:9px;border-bottom:1px solid #ddd">1,200</td></tr><tr><td style="padding:9px;border-bottom:1px solid #ddd">Groceries</td><td style="text-align:right;padding:9px;border-bottom:1px solid #ddd">540</td></tr><tr><td style="padding:9px;border-bottom:1px solid #ddd">Transport</td><td style="text-align:right;padding:9px;border-bottom:1px solid #ddd">210</td></tr><tr><td style="padding:9px;border-bottom:1px solid #ddd">Utilities</td><td style="text-align:right;padding:9px;border-bottom:1px solid #ddd">390</td></tr><tr><td style="padding:9px"><b>Total</b></td><td style="text-align:right;padding:9px"><b>2,340</b></td></tr></table>`
    ),
  },
  {
    id: "shot-dashboard-purple",
    title: "Analytics dashboard with a purple sidebar",
    description:
      "A web analytics dashboard with a dark purple sidebar, white cards and a line chart of weekly signups.",
    tags: ["dashboard", "design reference", "purple", "analytics"],
    width: 760,
    height: 440,
    html: page(
      "background:#f5f3ff;display:flex;height:440px;color:#2e1065",
      `<div style="width:170px;background:#4c1d95;color:#ede9fe;padding:22px"><b style="font-size:18px">Orbit</b><p style="margin-top:22px">Overview</p><p>Signups</p><p>Revenue</p><p>Settings</p></div><div style="flex:1;padding:24px"><h1>Weekly signups</h1><div style="display:flex;gap:14px;margin:16px 0"><div style="background:#fff;padding:14px;border-radius:10px;flex:1"><small>This week</small><div style="font-size:28px"><b>1,284</b></div></div><div style="background:#fff;padding:14px;border-radius:10px;flex:1"><small>Growth</small><div style="font-size:28px"><b>+12%</b></div></div></div><svg width="100%" height="170" viewBox="0 0 500 170"><polyline fill="none" stroke="#7c3aed" stroke-width="4" points="0,140 80,120 160,126 240,80 320,90 400,40 500,20"/></svg></div>`
    ),
  },
  {
    id: "shot-dashboard-dark",
    title: "Dark mode server monitoring dashboard",
    description:
      "A dark mode monitoring dashboard with green status indicators and CPU, memory and uptime tiles.",
    tags: ["dashboard", "dark mode", "monitoring"],
    width: 740,
    height: 380,
    html: page(
      "background:#0d1117;color:#c9d1d9;padding:26px",
      `<h1>Servers</h1><div style="display:flex;gap:14px;margin-top:18px"><div style="background:#161b22;border:1px solid #30363d;padding:16px;border-radius:8px;flex:1"><small>CPU</small><div style="font-size:30px;color:#3fb950">34%</div></div><div style="background:#161b22;border:1px solid #30363d;padding:16px;border-radius:8px;flex:1"><small>Memory</small><div style="font-size:30px;color:#e3b341">71%</div></div><div style="background:#161b22;border:1px solid #30363d;padding:16px;border-radius:8px;flex:1"><small>Uptime</small><div style="font-size:30px;color:#3fb950">99.98%</div></div></div><p style="margin-top:22px">● api-1 healthy &nbsp; ● api-2 healthy &nbsp; <span style="color:#f85149">● worker-3 down</span></p>`
    ),
  },
  {
    id: "shot-pricing-page",
    title: "SaaS pricing page with three plans",
    description:
      "A pricing page with three plan cards, Starter free, Pro at 12 dollars a month highlighted in orange, and Team at 29 dollars.",
    tags: ["pricing", "landing page", "design reference", "orange"],
    width: 760,
    height: 420,
    html: page(
      "background:#fff;padding:28px;color:#1f2937;text-align:center",
      `<h1>Simple pricing</h1><div style="display:flex;gap:16px;margin-top:22px"><div style="flex:1;border:1px solid #e5e7eb;border-radius:12px;padding:20px"><h2>Starter</h2><p style="font-size:30px;margin:10px 0">Free</p><p>1 project</p></div><div style="flex:1;border:3px solid #f97316;border-radius:12px;padding:20px;background:#fff7ed"><h2 style="color:#c2410c">Pro</h2><p style="font-size:30px;margin:10px 0">$12/mo</p><p>Unlimited projects</p></div><div style="flex:1;border:1px solid #e5e7eb;border-radius:12px;padding:20px"><h2>Team</h2><p style="font-size:30px;margin:10px 0">$29/mo</p><p>Shared workspace</p></div></div>`
    ),
  },
  {
    id: "shot-weather",
    title: "Weather app for Pune",
    description:
      "A weather app screen on a blue gradient showing 31 degrees and partly cloudy in Pune with a five day forecast.",
    tags: ["weather", "app", "blue"],
    width: 400,
    height: 560,
    html: page(
      "background:linear-gradient(#1d4ed8,#60a5fa);color:#fff;padding:40px 28px;text-align:center",
      `<h2>Pune</h2><p style="font-size:84px;margin:10px 0">31°</p><p>Partly cloudy</p><div style="display:flex;justify-content:space-between;margin-top:40px"><span>Mon 32°</span><span>Tue 30°</span><span>Wed 28°</span><span>Thu 29°</span><span>Fri 31°</span></div>`
    ),
  },
  {
    id: "shot-music-player",
    title: "Music player showing Midnight Drive",
    description:
      "A music player with pink and orange sunset artwork, the track Midnight Drive by Neon Harbour paused at 1:42.",
    tags: ["music", "player", "app"],
    width: 420,
    height: 560,
    html: page(
      "background:#111;color:#fff;padding:30px;text-align:center",
      `<div style="height:260px;border-radius:16px;background:linear-gradient(135deg,#f472b6,#fb923c)"></div><h2 style="margin-top:22px">Midnight Drive</h2><p style="opacity:.7">Neon Harbour</p><div style="height:4px;background:#444;margin:22px 0 6px"><div style="width:40%;height:4px;background:#fb923c"></div></div><div class="row" style="opacity:.7"><span>1:42</span><span>4:15</span></div>`
    ),
  },
  {
    id: "shot-map-directions",
    title: "Map directions to the vet",
    description:
      "A map with a blue route line and a banner saying 12 minutes by car to Paws and Claws Vet, 4.3 km.",
    tags: ["map", "directions", "vet"],
    width: 520,
    height: 420,
    html: page(
      "background:#e8efe6;position:relative;height:420px",
      `<svg width="520" height="420" style="position:absolute"><rect width="520" height="420" fill="#e8efe6"/><path d="M0 300 L200 260 L320 120 L520 80" stroke="#fff" stroke-width="26" fill="none"/><path d="M0 300 L200 260 L320 120 L520 80" stroke="#1a73e8" stroke-width="7" fill="none"/><circle cx="520" cy="80" r="12" fill="#ea4335"/></svg><div style="position:absolute;top:0;left:0;right:0;background:#fff;padding:14px 18px;box-shadow:0 2px 6px #0003"><b>12 min</b> · 4.3 km<br>Paws and Claws Vet</div>`
    ),
  },
  {
    id: "shot-settings-screen",
    title: "Phone settings with a battery saver toggle",
    description:
      "A phone settings list with toggles for Wi-Fi, Bluetooth and battery saver, which is switched on in green.",
    tags: ["settings", "toggle", "phone"],
    width: 420,
    height: 440,
    html: page(
      "background:#f2f2f7;padding:26px;color:#111",
      `<h1 style="margin-bottom:16px">Settings</h1><div style="background:#fff;border-radius:12px;padding:6px 16px"><div class="row" style="padding:12px 0;border-bottom:1px solid #eee"><span>Wi-Fi</span><span style="color:#8e8e93">On</span></div><div class="row" style="padding:12px 0;border-bottom:1px solid #eee"><span>Bluetooth</span><span style="color:#8e8e93">Off</span></div><div class="row" style="padding:12px 0"><span>Battery saver</span><span style="background:#34c759;color:#fff;padding:2px 12px;border-radius:14px">ON</span></div></div>`
    ),
  },
  {
    id: "shot-notes-grocery",
    title: "Notes app grocery list",
    description:
      "A yellow notes app page with a grocery list: milk, eggs, spinach, rice, tomatoes and green tea.",
    tags: ["notes", "grocery", "list"],
    width: 420,
    height: 460,
    html: page(
      "background:#fef9c3;padding:28px;color:#422006;font-family:Georgia,serif;font-size:19px",
      `<h1>Grocery list</h1><p style="margin-top:12px">☐ Milk</p><p>☐ Eggs</p><p>☐ Spinach</p><p>☑ Rice</p><p>☐ Tomatoes</p><p>☐ Green tea</p>`
    ),
  },
  {
    id: "shot-kindle-highlight",
    title: "E-reader highlight about deliberate practice",
    description:
      "An e-reader page with a highlighted sentence about deliberate practice requiring full attention, from the book Peak Performance Notes.",
    tags: ["book", "highlight", "quote"],
    width: 480,
    height: 440,
    html: page(
      "background:#f6f1e7;padding:34px;color:#2b2b2b;font-family:Georgia,serif;font-size:18px;line-height:1.7",
      `<p>Most people practise by repeating what they can already do.</p><p><mark style="background:#fde047">Deliberate practice demands your full attention and a task just beyond your reach.</mark></p><p style="font-size:13px;margin-top:20px;color:#777">Peak Performance Notes · Location 1042</p>`
    ),
  },
  {
    id: "shot-product-shoes",
    title: "Running shoes product page",
    description:
      "A shop product page for red trail running shoes priced 89 dollars with size and add to cart buttons.",
    tags: ["product", "shopping", "shoes", "red"],
    width: 720,
    height: 400,
    html: page(
      "background:#fff;display:flex;color:#111",
      `<div style="width:300px;background:#fee2e2;display:flex;align-items:center;justify-content:center;font-size:90px">👟</div><div style="flex:1;padding:30px"><h1>Ridgeline Trail Runner</h1><p style="margin:8px 0;color:#b91c1c;font-size:26px">$89</p><p>Colour: Crimson red</p><p style="margin-top:10px">Sizes 7 8 9 10 11</p><p style="background:#111;color:#fff;display:inline-block;padding:10px 22px;border-radius:6px;margin-top:20px">Add to cart</p></div>`
    ),
  },
  {
    id: "shot-concert-ticket",
    title: "Concert ticket for Neon Harbour",
    description:
      "A purple concert ticket for Neon Harbour live at Riverside Hall on 18 October, doors 7 pm, row F seat 12.",
    tags: ["ticket", "concert", "event", "purple"],
    width: 680,
    height: 280,
    html: page(
      "background:linear-gradient(90deg,#6d28d9,#c026d3);color:#fff;padding:28px",
      `<h1 style="font-size:34px">NEON HARBOUR LIVE</h1><p style="margin-top:8px">Riverside Hall · 18 October 2026 · Doors 7 pm</p><div class="row" style="margin-top:34px"><span>Row F · Seat 12</span><span class="mono">Order 88-4410-27</span></div>`
    ),
  },
  {
    id: "shot-parking-sign",
    title: "Parking rules sign",
    description:
      "A blue and white street sign listing parking rules: two hour limit Monday to Saturday, 8 am to 6 pm, permit holders excepted.",
    tags: ["sign", "parking", "rules"],
    width: 420,
    height: 460,
    html: page(
      "background:#1d4ed8;color:#fff;padding:30px;text-align:center",
      `<div style="border:4px solid #fff;padding:20px"><p style="font-size:60px;font-weight:700">P</p><h2>2 HOUR LIMIT</h2><p>Mon – Sat</p><p>8 am – 6 pm</p><p style="margin-top:12px">Permit holders excepted</p></div>`
    ),
  },
  {
    id: "shot-error-dialog",
    title: "Disk full error dialog",
    description:
      "A desktop error dialog with a red icon saying there is not enough disk space to save the file, with a Free up space button.",
    tags: ["error", "dialog", "disk"],
    width: 520,
    height: 260,
    html: page(
      "background:#c7d2fe;padding:36px",
      `<div style="background:#fff;border-radius:10px;padding:22px;box-shadow:0 8px 24px #0004"><div style="display:flex;gap:14px"><div style="width:44px;height:44px;border-radius:50%;background:#dc2626;color:#fff;font-size:28px;text-align:center;line-height:44px">!</div><div><b>Not enough disk space</b><p>Could not save “thesis-final-v7.docx”. Free up 240 MB and try again.</p></div></div><p style="text-align:right;margin-top:16px"><span style="background:#2563eb;color:#fff;padding:8px 16px;border-radius:6px">Free up space</span></p></div>`
    ),
  },
  {
    id: "shot-newsletter-email",
    title: "Newsletter email about winter gardening",
    description:
      "An email in a mail client from The Greenhouse Weekly with the subject Five jobs for the winter garden.",
    tags: ["email", "newsletter", "gardening"],
    width: 600,
    height: 360,
    html: page(
      "background:#fff;padding:26px;color:#202124",
      `<h2>Five jobs for the winter garden</h2><p style="color:#5f6368;margin:4px 0 14px">The Greenhouse Weekly · 2 December 2025</p><p>1. Prune apple trees while they are dormant.</p><p>2. Mulch beds with leaf mould.</p><p>3. Clean and oil your tools.</p><p>4. Order seeds before the rush.</p><p>5. Wrap pots against frost.</p>`
    ),
  },
  {
    id: "shot-tweet-post",
    title: "Social post about an octopus escaping a tank",
    description:
      "A social media post with a short thread about an octopus that escaped its tank overnight, with 24 thousand likes.",
    tags: ["social post", "octopus", "thread"],
    width: 520,
    height: 320,
    html: page(
      "background:#fff;padding:22px;color:#0f1419",
      `<p><b>Dr. Anika Rao</b> <span style="color:#536471">@anika_marine · 5h</span></p><p style="margin:10px 0;font-size:18px">Update from the lab: the octopus opened its tank lid, walked across the floor to the next tank, ate two crabs and went home. Nobody saw it happen.</p><p style="color:#536471">♥ 24K &nbsp; ↻ 6.1K</p>`
    ),
  },
];
