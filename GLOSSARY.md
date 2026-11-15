# Spark

Spark is a personal memory library: people save things they come across anywhere, and find them again later by describing what they vaguely remember.

## Language

### Saving

**Library**:
Everything one user has saved in Spark, synced across all their clients.
_Avoid_: memory (for the whole collection), account, vault

**Memory**:
One thing a user chose to save: a link, a page, a post, a video, an image, a screenshot, a PDF or a piece of text.
_Avoid_: item, bookmark, save, post, content, note

**Sample**:
A Memory Spark wrote for a new Library so a first search has something to find. Marked in data, never sent to an AI provider, not counted in the Free allowance, left out of export, and removed all at once.
_Avoid_: demo data, example, placeholder

**Capture**:
The act of putting a new Memory into the Library from any client (paste, drop, upload, extension, share sheet).
_Avoid_: import, ingest, clip

**Source**:
The original place a Memory came from, such as a URL or a reference to an app, kept whenever one exists.
_Avoid_: origin, link (when meaning the reference itself)

**Preserved copy**:
The copy of a Memory's content that Spark keeps, such as the file, the readable text, a screenshot or a transcript, so the Memory survives if the Source disappears.
_Avoid_: archive, backup, snapshot

**Preservation**:
Whether Spark holds a Preserved copy of a Memory: either **Preserved** or **Reference only** (just the Source and whatever metadata was allowed).
_Avoid_: status, sync state

**User-provided copy**:
A file the user's own browser fetched with their own session and gave to Spark only so Indexing can read it, such as a reel's video. It is deleted when Indexing ends and is never a Preserved copy.
_Avoid_: download, scrape, archive

**Capture note**:
An optional line the user writes at Capture time about why they saved a Memory.
_Avoid_: description, comment, annotation

**Free allowance**:
The storage and Capture limits a user gets without paying. Text counts toward storage with the files. Text and links beyond the day's Captures are still kept, as Reference only or partly indexed, up to a small daily number more; after that, like files, they are refused with a clear reason, because there is no Source to fall back on.
_Avoid_: quota, plan limit

### Making Memories findable

**Indexing**:
The one-time background work after Capture that makes a Memory searchable: describing what it shows, reading the text inside it, and placing it in the search space.
_Avoid_: enrichment, analysis, processing, summarisation

**Deep fetch**:
The heavier second attempt to retrieve a Memory's content when normal Capture and Indexing came back with too little.
_Avoid_: scrape, crawl, ingest pipeline

**AI opt-out**:
A Memory the user has chosen not to send to any AI provider. It is findable only by its own text, title and Capture note.
_Avoid_: private memory, sensitive mode

**Index state**:
How far Indexing has got for a Memory: **Indexing**, **Searchable** or **Failed**. Independent of Preservation.
_Avoid_: status, processing state

**Category**:
A broad kind of Memory (Recipe, Design reference, Receipt...). Spark assigns Categories automatically and the user can change them. Users can also create their own. A Memory can have several.
_Avoid_: folder, collection, type

**Locked categories**:
A Memory whose Categories the user has set by hand; Spark never changes them automatically again.
_Avoid_: pinned, manual override

**Tag**:
A free-form descriptive label on a Memory, suggested by Indexing or added by the user.
_Avoid_: keyword, label

### Finding

**Direct match**:
A search result that strongly matches what the user described, shown first.
_Avoid_: exact match, top result

**Related match**:
A search result that is similar in meaning or appearance but not a confident match, always shown apart from Direct matches.
_Avoid_: suggestion, recommendation

**Overview, Visual and Passage vectors**:
Where a Memory sits in the search space: one Overview (its title, description, Tags and Capture note), a Visual for its image, and a Passage for each stretch of its text or of the text in its image. Search scores a Memory by whichever of them is closest.
_Avoid_: embeddings (in UI copy), chunks

**Instant search / full search**:
Instant search matches words as they are typed; full search, once typing pauses, also matches by meaning. Full results reorder the instant ones rather than replace them.
_Avoid_: quick search, deep search, semantic search (in UI copy)

**Why-chip**:
The few words under a search result that say what matched: a field, the passage, or the image.
_Avoid_: reason, explanation, score

**Filter chip**:
A one-tap narrowing of the Library by kind, Source, when it was saved, colour or (later) Category. It works with an empty search box, and the same filters can be typed ("pdfs from last month").
_Avoid_: facet, tag filter

**Recent searches**:
The few searches a person has run, offered when Search opens, each deletable. Kept thirty days.
_Avoid_: search history, queries

**More Like This**:
Search with a Memory itself as the query, for the Memories nearest it in meaning and look.
_Avoid_: similar items, recommendations

**Connected assistant**:
An external AI tool (such as Claude or Codex) that the user has allowed to search and read their Library.
_Avoid_: integration, bot, agent
