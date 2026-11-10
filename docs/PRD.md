# Product Requirements Document (PRD)

## Working Title

Personal Memory Search

**Product promise:**\
\> Save anything. Find it whenever you need it.\
\> **Describe anything you vaguely remember. We'll find it.**

**Status:** Product direction defined; discovery and validation still
required.\
**Date:** 8 November 2026

------------------------------------------------------------------------

## 1. Product Vision

Build a personal storage and retrieval layer for a person's digital
life.

People encounter useful, interesting, or memorable things across many
platforms: social posts, videos, articles, websites, images,
screenshots, documents, conversations, code snippets, and more. Today,
these things are scattered across apps, bookmarks, downloads, messages,
and browser history. Even when someone saves something, they may not
remember where it was saved, what it was called, or the keywords needed
to find it again.

The product gives people one place to save things from anywhere,
preserve them, sync them across devices, and retrieve them later using
natural descriptions---even when their memory is vague or primarily
visual.

This is **not an AI summarizer** and should not become another
content-consumption or knowledge-management app. Its central job is
reliable capture, preservation, and retrieval of the user's original
material.

## 2. Problem

People often remember the substance or appearance of something but not
its metadata.

Examples: - "That Instagram video about a website with orange
animations." - "The article I saved about local-first apps." - "That
screenshot with a dark dashboard and purple sidebar." - "The YouTube
video where someone explained database indexing." - "The post with a
blue illustration about database scaling."

Traditional search depends on remembered keywords, titles, filenames,
creators, or platforms. Those are exactly the details people often
forget.

The product should let users search by what they remember---not require
them to remember how or where they saved it.

## 3. Target User and Use Cases

### Primary user

A digitally active person who regularly encounters and saves useful or
interesting content across multiple apps and devices, then struggles to
retrieve it later.

### Core jobs to be done

1.  Save something interesting from whichever app or device the user is
    using.
2.  Trust that the saved item will remain accessible and synced.
3.  Find a saved item later using an incomplete or approximate
    description.
4.  Retrieve the original item and return to its source or preserved
    copy.
5.  Allow an AI coding assistant or other connected tool to retrieve
    relevant saved material when the user asks.

### Example scenarios

-   A developer remembers a design reference but not the platform or
    creator.
-   Someone remembers a visual detail in a screenshot and wants to find
    it.
-   A user remembers a point made somewhere in a long video.
-   A user wants Claude or Codex to find a reference they saved earlier
    and use it as context.

## 4. Product Principles

1.  **Capture first, organize later---or not at all.** Saving should be
    effortless. Folders and manual tags must not be prerequisites.
2.  **Originals matter.** Return the saved source or preserved content,
    not merely an AI-generated answer.
3.  **Search by memory.** Users should be able to describe an item
    naturally and imprecisely.
4.  **Multimodal retrieval.** Search should ultimately understand text,
    visual content, and relevant audio/video content.
5.  **User control over AI costs.** Core product functionality must not
    depend on expensive, always-on generative AI.
6.  **Cross-device continuity.** A user's memory should be available
    across supported clients.
7.  **Privacy and permission matter.** Capture and preservation must
    respect user consent, platform restrictions, copyright, and
    applicable law.

## 5. Product Scope

### 5.1 Capture

The product should make it possible to save a broad range of
content---effectively anything the supported platforms and permissions
allow.

Planned clients: - Android app, including system share-sheet capture. -
iOS app, including share-sheet capture. - Browser extension. - A
cloud-backed account and sync service.

Potential capture types: - Social posts and short-form videos. - YouTube
videos and other video links. - Articles and web pages. - Images and
screenshots. - PDFs, documents, and files. - Text, notes, code snippets,
and copied content. - Links to conversations or other supported sources.

Capture should be quick, predictable, and require minimal user effort.
The system should clearly communicate when an item has been saved, when
preservation is still processing, and when only a reference could be
retained.

### 5.2 Preservation: Hybrid model

Use a hybrid preservation approach:

-   Keep the original URL or source reference whenever one exists.
-   Store available metadata and capture context.
-   Preserve a copy of the content, media, or a useful extract when
    technically possible and legally permitted.
-   If full preservation is unavailable or disallowed, retain the
    reference and any permitted metadata or user-provided content.
-   Make the preservation status visible to the user.

The product must not promise that every third-party item can always be
copied or retained. Platform access, permissions, copyright, and
technical limitations will vary.

### 5.3 Cloud sync

The user's saved memory should sync across Android, iOS, and browser
clients.

Requirements: - A consistent account-level library. - Reliable sync of
saved items and their metadata. - Clear handling of upload, processing,
and sync failures. - Access to saved items from supported devices. - A
way to identify items that are references only versus items with
preserved content.

### 5.4 Retrieval and search

Search is the primary differentiator and the core product experience.

The user should be able to search with: - Natural-language
descriptions. - Approximate or incomplete phrases. - Visual descriptions
and visual attributes. - Concepts or meaning rather than exact
keywords. - A combination of text, visual clues, and remembered context.

Examples: - "Find that dark dashboard screenshot with a purple
sidebar." - "The Reel where someone showed a smooth page transition." -
"An article about local-first architecture." - "A video where the
speaker discussed database indexing."

Search should work across content types and platforms, rather than
requiring the user to select the source app first.

#### Result behavior

The agreed direction is a **personal search engine**: 1. Show the
strongest exact or near-exact matches first. 2. Show related saved items
after the strongest matches. 3. Make it easy to open the original source
or preserved content.

Related results should be useful, but must not obscure the direct match.
The product should distinguish direct matches from related suggestions
so users understand why each result appeared.

#### Multimodal search

Visual search is a core requirement, not merely a future enhancement. A
user should be able to find an image or screenshot by describing what it
looks like, even when its text or filename contains none of those words.

The product direction also includes search within video and audio---for
example, finding a specific moment in a long video based on something
said or shown. This is an intended capability, but its initial release
priority and implementation boundaries remain to be validated.

### 5.5 AI assistant access and integrations

Users should be able to make their saved memory available to external AI
assistants and coding tools, especially Claude and Codex.

Desired experience: - The assistant can search the user's library when
asked. - It can retrieve relevant saved items and their original
references. - It can provide the actual source material or accessible
extracts as context, rather than only a generated summary. - The user
remains in control of what is connected and what is shared.

MCP is a potential integration path, but the product requirement is
broader: make personal memory accessible to external assistants through
a clear, permissioned interface.

## 6. AI and Cost Philosophy

The product must not require the company to pay for unlimited AI usage
on behalf of every user.

Principles: - Capture, storage, sync, and baseline retrieval are core
product responsibilities. - Avoid mandatory generative summaries or
constant AI conversations. - Make expensive AI-powered operations
optional where possible. - Prefer a user-pays model for optional AI
usage, such as user-provided API credentials or an appropriate
bring-your-own-provider connection. - Explain any third-party AI costs
before the user incurs them. - Do not assume that users' existing Claude
or ChatGPT subscriptions automatically cover API usage; subscription and
API billing may be separate. - Evaluate the cost of indexing and
multimodal search carefully. Search may require machine-learning
processing, but it should be designed around predictable unit economics.

The experience should remain useful even when a user has not connected
an AI provider.

## 7. What This Product Is Not

The product is not primarily: - An AI summarizer. - A chatbot that talks
about saved links without reliably retrieving them. - A conventional
bookmark manager that depends on folders and manual tags. - A
note-taking app that requires users to organize everything. - A social
feed or content recommendation platform. - A system that silently
monitors or captures everything a person does.

The user explicitly chose a save-oriented product: people decide what to
put into their memory. Broader automatic capture of digital activity is
not part of the agreed core direction.

## 8. Prioritization

### Core product direction

-   Capture content from Android, iOS, and browser extension.
-   Hybrid source-reference and permitted-content preservation.
-   Cloud sync across devices.
-   Powerful natural-language and fuzzy retrieval.
-   Visual-description search.
-   Exact matches first, related items second.
-   Access to saved items through Claude and Codex or other external
    assistants.
-   Cost-conscious operation without mandatory generative AI.

### Later or optional capabilities

-   Personal context: understanding why the user saved something, their
    projects, interests, and history.
-   Connecting saved items to the user's projects or goals.
-   Proactive resurfacing and discovery of forgotten items.
-   Broader personal knowledge graph or personal-life understanding.

**Important prioritization decision:** Search over the content of saved
items (Direction A) is the primary focus. Understanding the user's
personal context (Direction B) is a later feature, not a dependency for
the core product.

## 9. Quality and Experience Requirements

-   Saving should feel nearly effortless.
-   Search should accept ordinary descriptions, not demand query syntax.
-   Search should tolerate incomplete, approximate, and imperfect
    recollection.
-   Search should cover different supported media types in one
    experience.
-   Direct matches should be ranked ahead of loosely related content.
-   Results should clearly identify the source and preservation status.
-   Opening a result should take the user to the original source or
    preserved item.
-   Sync and processing state should be understandable.
-   The product should not invent matches or imply that a result is
    exact when it is only related.
-   Users must have clear control over connected assistants and shared
    data.

## 10. Success Measures

The product's success should be measured by whether people can reliably
recover things they previously saved.

Candidate metrics: - Save success rate. - Time from initiating capture
to item being searchable. - Search success rate (user finds the intended
item). - Median time to find a saved item. - Search reformulation
rate. - Rate of searches that result in opening or using a relevant
item. - Percentage of users who successfully retrieve an item saved on
another device. - Retention of users who repeatedly save and retrieve
items. - Storage, processing, and retrieval cost per active user.

A particularly important qualitative test:

> Can a user describe something they vaguely remember, without knowing
> its title, platform, creator, or keywords---and reliably find the item
> they meant?

## 11. Open Product Questions

These questions are intentionally unresolved and should be answered
through product discovery and validation:

1.  **Video and audio depth:** Should the first search experience find
    videos by title and available transcript, or also locate specific
    moments using visual and spoken content?
2.  **Preservation boundaries:** For each source type, what can be
    retained reliably and lawfully: URL, metadata, extracted text,
    thumbnails, media, or a user-provided copy?
3.  **Search expectations:** How should the product communicate
    confidence and distinguish exact matches from related results?
4.  **Initial supported sources:** Which sources should be supported
    first to prove the universal capture experience?
5.  **Free and paid boundaries:** What storage and baseline search
    allowance can be offered sustainably?
6.  **Assistant access:** What is the simplest secure experience for
    connecting Claude and Codex, and how should permissions be scoped?
7.  **Privacy and deletion:** How can users export, delete, and control
    their saved data and connected integrations?

## 12. Product Positioning

### Primary promise

**Save anything. Find it whenever you need it.**

### Signature search promise

**Describe anything you vaguely remember. We'll find it.**

### Short explanation

A personal memory library that captures things from across your digital
life, keeps them synced, and helps you find them later---even when you
only remember what they looked like or what they were about.

------------------------------------------------------------------------

## 13. Decisions Captured from Product Discussion

  -----------------------------------------------------------------------
  Area                                Decision
  ----------------------------------- -----------------------------------
  Product identity                    Personal memory + utility

  Primary platform direction          Android and iOS apps, plus browser
                                      extension

  Capture philosophy                  Save anything the supported
                                      platforms and permissions allow

  Preservation                        Hybrid: source reference plus
                                      permitted copy or extract

  Cloud                               Sync memory across devices

  Main differentiator                 Retrieval, especially vague and
                                      imaginative search

  Search scope                        Text and visual search; video/audio
                                      search is an intended direction to
                                      validate

  Result ranking                      Exact matches first, related
                                      memories afterwards

  Personal context                    Secondary feature; content-based
                                      search comes first

  AI summaries                        Not the product; no mandatory
                                      summarization

  AI economics                        Avoid company-funded, unlimited AI;
                                      let users bear optional AI-provider
                                      costs

  External assistants                 Make saved memory accessible to
                                      Claude and Codex

  Product focus                       Capture, preserve, sync, retrieve
  -----------------------------------------------------------------------
